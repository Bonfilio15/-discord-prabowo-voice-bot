const fs = require('fs');
const path = require('path');
const ffmpegStatic = require('ffmpeg-static');
const googleTTS = require('google-tts-api');
const {
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
} = require('@discordjs/voice');
const config = require('./config');

// Pastikan prism-media / @discordjs/voice otomatis memakai ffmpeg-static bawaan
if (ffmpegStatic && !process.env.FFMPEG_PATH) {
  process.env.FFMPEG_PATH = ffmpegStatic;
}

// Menyimpan AudioPlayer & status cooldown per Guild (Server Discord)
const guildPlayers = new Map();
const guildLastPlayed = new Map();

/**
 * Mencari file audio khas Prabowo di folder assets/ atau membuat fallback TTS otomatis
 * jika user belum menaruh file antek_asing.mp3 / antek_asing.wav.
 *
 * @returns {Promise<string>} Path ke file audio yang siap diputar
 */
async function resolveAudioFile() {
  // 1. Cek path dari .env (default: ./assets/antek_asing.mp3)
  if (fs.existsSync(config.audioFilePath)) {
    return config.audioFilePath;
  }

  // 2. Cek ekstensi alternatif (.wav / .ogg) di folder assets/
  const assetsDir = path.dirname(config.audioFilePath);
  const altCandidates = ['antek_asing.wav', 'antek_asing.ogg', 'prabowo.mp3', 'prabowo.wav'];
  for (const filename of altCandidates) {
    const fullPath = path.join(assetsDir, filename);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }

  // 3. Jika belum ada file audio kustom, gunakan / buat fallback TTS
  if (fs.existsSync(config.fallbackAudioPath)) {
    return config.fallbackAudioPath;
  }

  console.log(
    'ℹ️  [Audio] File assets/antek_asing.mp3 belum ditemukan. Membuat audio fallback TTS sementara...'
  );
  fs.mkdirSync(path.dirname(config.fallbackAudioPath), { recursive: true });

  const base64Audio = await googleTTS.getAudioBase64(config.fallbackTtsText, {
    lang: 'id',
    slow: false,
    host: 'https://translate.google.com',
    timeout: 10000,
  });

  const audioBuffer = Buffer.from(base64Audio, 'base64');
  fs.writeFileSync(config.fallbackAudioPath, audioBuffer);
  console.log(`✅ [Audio] Fallback TTS berhasil disimpan di: ${config.fallbackAudioPath}`);
  console.log(
    '💡 Tips: Taruh file suara asli/meme Prabowo di "assets/antek_asing.mp3" untuk menggunakan suara khas Prabowo!'
  );

  return config.fallbackAudioPath;
}

/**
 * Memutar suara "Hey antek-antek asing!" di Voice Channel pada koneksi yang aktif.
 *
 * @param {import('@discordjs/voice').VoiceConnection} connection
 * @param {string} guildId
 * @param {boolean} [ignoreCooldown=false]
 * @returns {Promise<boolean>} true jika suara diputar, false jika masih cooldown/sedang memutar
 */
async function playPrabowoVoice(connection, guildId, ignoreCooldown = false) {
  const now = Date.now();
  const lastPlayed = guildLastPlayed.get(guildId) || 0;

  if (!ignoreCooldown && now - lastPlayed < config.cooldownMs) {
    return false;
  }

  let player = guildPlayers.get(guildId);
  if (!player) {
    player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Pause,
      },
    });

    player.on('error', (err) => {
      console.error(`❌ [AudioPlayer] Error di server ${guildId}:`, err.message);
    });

    guildPlayers.set(guildId, player);
  }

  // Jangan tumpuk suara jika bot sedang berbicara
  if (player.state.status === AudioPlayerStatus.Playing) {
    return false;
  }

  try {
    const filePath = await resolveAudioFile();
    const resource = createAudioResource(filePath, {
      inlineVolume: true,
    });
    if (resource.volume) {
      resource.volume.setVolume(1.2); // Sedikit diperkeras agar lantang di Voice Channel
    }

    connection.subscribe(player);
    player.play(resource);
    guildLastPlayed.set(guildId, now);

    return true;
  } catch (err) {
    console.error('❌ [AudioPlayer] Gagal memutar file audio:', err.message);
    return false;
  }
}

module.exports = {
  playPrabowoVoice,
  resolveAudioFile,
};
