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

// Batas maksimal durasi 1 potongan rekaman (4.5 detik pada 48kHz 16-bit mono = 432.000 bytes)
// Agar jika user bicara panjang tanpa henti, kata "Prabowo" tetap langsung terdeteksi!
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
 *
 * @param {import('@discordjs/voice').VoiceConnection} connection
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').Client} client
 */
function attachReceiverListener(connection, guild, client) {
  if (initializedConnections.has(connection)) return;
  initializedConnections.add(connection);

  const receiver = connection.receiver;

  receiver.speaking.on('start', (userId) => {
    // Abaikan suara dari bot sendiri atau bot lain
    if (userId === client.user.id) return;
    const member = guild.members.cache.get(userId);
    if (member?.user?.bot) return;

    const streamKey = `${guild.id}:${userId}`;
    if (activeStreams.has(streamKey)) return;
    activeStreams.add(streamKey);

    const opusStream = receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: 750, // Berhenti merekam setelah 750ms hening
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

      // Jika user berbicara panjang tanpa jeda > 4.5 detik, langsung proses potongan ini
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
 *
 * @param {import('discord.js').VoiceBasedChannel} channel
 * @param {import('discord.js').Client} client
 * @returns {Promise<import('@discordjs/voice').VoiceConnection>}
 */
async function connectAndListen(channel, client) {
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false, // WAJIB false agar bot bisa mendengar suara mic user
    selfMute: false,
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
    console.log(
      `🔊 [Voice] Terhubung & mendengarkan di channel "${channel.name}" (Server: ${channel.guild.name})`
    );
    attachReceiverListener(connection, channel.guild, client);
  } catch (err) {
    console.error(`❌ [Voice] Gagal terhubung ke channel "${channel.name}":`, err.message);
    connection.destroy();
    throw err;
  }

  // Handle reconnect otomatis jika koneksi terputus sementara
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      connection.destroy();
    }
  });

  return connection;
}

/**
 * Keluar dari Voice Channel di server tertentu
 *
 * @param {string} guildId
 */
function disconnectVoice(guildId) {
  const connection = getVoiceConnection(guildId);
  if (connection) {
    connection.destroy();
    return true;
  }
  return false;
}

module.exports = {
  connectAndListen,
  disconnectVoice,
};
