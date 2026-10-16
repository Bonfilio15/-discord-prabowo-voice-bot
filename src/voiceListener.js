const {
  joinVoiceChannel,
  VoiceConnectionStatus,
  EndBehaviorType,
  entersState,
  getVoiceConnection,
} = require('@discordjs/voice');
const prism = require('prism-media');
const { transcribeAudio, containsPrabowoKeyword } = require('./stt');
const { playPrabowoVoice } = require('./audioPlayer');

// Mencegah duplikasi listener pada user yang sedang berbicara
const activeStreams = new Set();
// Mencegah duplikasi listener speaking pada koneksi guild yang sama
const initializedConnections = new WeakSet();
// Mencegah tabrakan koneksi paralel di guild yang sama
const connectingPromises = new Map();

// Batas maksimal durasi 1 potongan rekaman (4.5 detik pada 48kHz 16-bit mono = 432.000 bytes)
const MAX_CHUNK_BYTES = 48000 * 2 * 4.5;

/**
 * Memproses buffer PCM rekaman suara user: transkripsi & cek kata "Prabowo"
 */
async function processUserAudioChunk(pcmBuffer, connection, guild, userId) {
  const transcript = await transcribeAudio(pcmBuffer);
  if (!transcript) return;

  const member = guild.members.cache.get(userId);
  const displayName = member ? member.displayName : userId;

  console.log(`🎙️  [${guild.name}] ${displayName}: "${transcript}"`);

  if (containsPrabowoKeyword(transcript)) {
    console.log(
      `🔥 [DETEKSI PRABOWO] "${transcript}" oleh ${displayName} -> Memutar suara "Hey antek-antek asing!"`
    );
    await playPrabowoVoice(connection, guild.id);
  }
}

/**
 * Memasang pendengar suara (Voice Receiver) pada koneksi Voice Channel
 */
function attachReceiverListener(connection, guild, client) {
  if (initializedConnections.has(connection)) return;
  initializedConnections.add(connection);

  const receiver = connection.receiver;

  receiver.speaking.on('start', (userId) => {
    if (userId === client.user.id) return;
    const member = guild.members.cache.get(userId);
    if (member?.user?.bot) return;

    const streamKey = `${guild.id}:${userId}`;
    if (activeStreams.has(streamKey)) return;
    activeStreams.add(streamKey);

    const opusStream = receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: 750,
      },
    });

    const decoder = new prism.opus.Decoder({
      rate: 48000,
      channels: 1,
      frameSize: 960,
    });

    let chunks = [];
    let currentBytes = 0;

    const flushAudio = () => {
      if (chunks.length === 0) return;
      const pcmBuffer = Buffer.concat(chunks);
      chunks = [];
      currentBytes = 0;
      processUserAudioChunk(pcmBuffer, connection, guild, userId).catch((err) => {
        console.error('❌ [VoiceListener] Error saat memproses audio:', err.message);
      });
    };

    const pcmStream = opusStream.pipe(decoder);

    pcmStream.on('data', (chunk) => {
      chunks.push(chunk);
      currentBytes += chunk.length;

      if (currentBytes >= MAX_CHUNK_BYTES) {
        flushAudio();
      }
    });

    const cleanup = () => {
      if (!activeStreams.has(streamKey)) return;
      activeStreams.delete(streamKey);
      flushAudio();
      try {
        decoder.destroy();
      } catch {}
    };

    pcmStream.once('end', cleanup);
    pcmStream.once('close', cleanup);
    pcmStream.once('error', (err) => {
      console.error(`⚠️  [VoiceListener] Stream decode error (${userId}):`, err.message);
      cleanup();
    });
    opusStream.once('error', () => cleanup());
  });
}

/**
 * Bergabung ke Voice Channel dan mulai mendengarkan semua pembicaraan user
 */
async function connectAndListen(channel, client) {
  const guildId = channel.guild.id;

  // Jika sudah terhubung & Ready di channel yang sama, langsung pakai koneksi tersebut
  const existing = getVoiceConnection(guildId);
  if (
    existing &&
    existing.state.status === VoiceConnectionStatus.Ready &&
    existing.joinConfig.channelId === channel.id
  ) {
    attachReceiverListener(existing, channel.guild, client);
    return existing;
  }

  // Jika sedang dalam proses menghubungkan di server ini, tunggu proses yang sedang berjalan
  if (connectingPromises.has(guildId)) {
    return connectingPromises.get(guildId);
  }

  const connectTask = (async () => {
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guildId,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
      debug: true,
    });

    connection.on('debug', (msg) => {
      console.log(`🔍 [Voice Debug] ${msg}`);
    });

    connection.on('error', (err) => {
      console.error(`❌ [Voice Error]`, err.message);
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
      console.log(
        `🔊 [Voice] Terhubung & mendengarkan di channel "${channel.name}" (Server: ${channel.guild.name})`
      );
      attachReceiverListener(connection, channel.guild, client);
      return connection;
    } catch (err) {
      console.error(
        `❌ [Voice] Gagal terhubung ke channel "${channel.name}" (state terakhir: ${connection.state.status}):`,
        err.message
      );
      if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
        connection.destroy();
      }
      throw err;
    }
  })();

  connectingPromises.set(guildId, connectTask);
  try {
    return await connectTask;
  } finally {
    connectingPromises.delete(guildId);
  }
}

/**
 * Keluar dari Voice Channel di server tertentu
 */
function disconnectVoice(guildId) {
  const connection = getVoiceConnection(guildId);
  if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
    connection.destroy();
    return true;
  }
  return false;
}

module.exports = {
  connectAndListen,
  disconnectVoice,
};
