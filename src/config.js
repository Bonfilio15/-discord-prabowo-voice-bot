const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const triggerKeywordsRaw =
  process.env.TRIGGER_KEYWORDS || 'prabowo,pra bowo,perabowo,pak bowo,prabowo subianto';

const config = {
  discordToken: (process.env.DISCORD_TOKEN || '').trim(),
  autoJoinVoice: (process.env.AUTO_JOIN_VOICE || 'true').toLowerCase() === 'true',
  cooldownMs: parseInt(process.env.COOLDOWN_MS || '3000', 10),
  triggerKeywords: triggerKeywordsRaw
    .split(',')
    .map((kw) => kw.trim().toLowerCase())
    .filter(Boolean),

  sttProvider: (process.env.STT_PROVIDER || 'groq').trim().toLowerCase(),
  groqApiKey: (process.env.GROQ_API_KEY || '').trim(),
  witApiKey: (process.env.WIT_API_KEY || '').trim(),
  openaiApiKey: (process.env.OPENAI_API_KEY || '').trim(),

  audioFilePath: path.resolve(
    __dirname,
    '..',
    process.env.AUDIO_FILE_PATH || './assets/antek_asing.mp3'
  ),
  fallbackAudioPath: path.resolve(__dirname, '../assets/fallback_tts.mp3'),
  fallbackTtsText: process.env.FALLBACK_TTS_TEXT || 'Hey! Antek antek asing!',
};

module.exports = config;
