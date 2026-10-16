const config = require('./config');

/**
 * Menghitung RMS (Root Mean Square) amplitudo dari buffer PCM 16-bit signed little-endian.
 * Digunakan untuk mengabaikan suara kresek mic atau hening agar tidak membuang kuota STT.
 *
 * @param {Buffer} pcmBuffer
 * @returns {number}
 */
function calculateRms(pcmBuffer) {
  const sampleCount = Math.floor(pcmBuffer.length / 2);
  if (sampleCount === 0) return 0;

  let sumSquares = 0;
  for (let i = 0; i < sampleCount * 2; i += 2) {
    const sample = pcmBuffer.readInt16LE(i);
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / sampleCount);
}

/**
 * Mengubah raw PCM 16-bit mono 48kHz dari Discord menjadi WAV 16-bit mono 16kHz di memori.
 *
 * @param {Buffer} pcm48kBuffer - Raw PCM s16le 48000Hz mono
 * @returns {Buffer} WAV file buffer siap kirim ke STT API
 */
function pcm48kToWav16k(pcm48kBuffer) {
  const ratio = 3; // 48000 / 16000 = 3
  const inputSamples = Math.floor(pcm48kBuffer.length / 2);
  const outputSamples = Math.floor(inputSamples / ratio);
  const pcm16kBuffer = Buffer.alloc(outputSamples * 2);

  for (let i = 0; i < outputSamples; i++) {
    const srcIdx = i * ratio;
    const s0 = pcm48kBuffer.readInt16LE(srcIdx * 2);
    const s1 = pcm48kBuffer.readInt16LE((srcIdx + 1) * 2);
    const s2 = pcm48kBuffer.readInt16LE((srcIdx + 2) * 2);
    const avg = Math.round((s0 + s1 + s2) / 3);
    pcm16kBuffer.writeInt16LE(Math.max(-32768, Math.min(32767, avg)), i * 2);
  }

  const sampleRate = 16000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcm16kBuffer.length;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size (16 untuk PCM)
  header.writeUInt16LE(1, 20); // AudioFormat (1 = PCM)
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm16kBuffer]);
}

/**
 * Transkripsi menggunakan Groq Whisper API (whisper-large-v3-turbo)
 * Gratis & sangat cepat (< 300ms)
 */
async function transcribeWithGroq(wavBuffer) {
  if (!config.groqApiKey || config.groqApiKey.includes('masukkan_api_key')) {
    console.warn('⚠️  [STT] GROQ_API_KEY belum diisi di file .env!');
    return '';
  }

  const formData = new FormData();
  const blob = new Blob([wavBuffer], { type: 'audio/wav' });
  formData.append('file', blob, 'speech.wav');
  formData.append('model', 'whisper-large-v3-turbo');
  formData.append('language', 'id');
  formData.append('prompt', 'Prabowo, Prabowo Subianto, Pak Prabowo');
  formData.append('response_format', 'json');
  formData.append('temperature', '0');

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.groqApiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq STT Error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return (data.text || '').trim();
}

/**
 * Transkripsi menggunakan OpenAI Whisper API (whisper-1)
 */
async function transcribeWithOpenAI(wavBuffer) {
  if (!config.openaiApiKey) {
    console.warn('⚠️  [STT] OPENAI_API_KEY belum diisi di file .env!');
    return '';
  }

  const formData = new FormData();
  const blob = new Blob([wavBuffer], { type: 'audio/wav' });
  formData.append('file', blob, 'speech.wav');
  formData.append('model', 'whisper-1');
  formData.append('language', 'id');
  formData.append('prompt', 'Prabowo, Prabowo Subianto, Pak Prabowo');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI STT Error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return (data.text || '').trim();
}

/**
 * Transkripsi menggunakan Wit.ai API (Gratis untuk Bahasa Indonesia)
 */
async function transcribeWithWit(wavBuffer) {
  if (!config.witApiKey) {
    console.warn('⚠️  [STT] WIT_API_KEY belum diisi di file .env!');
    return '';
  }

  const response = await fetch('https://api.wit.ai/speech?v=20240304', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.witApiKey}`,
      'Content-Type': 'audio/wav',
    },
    body: wavBuffer,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Wit.ai STT Error (${response.status}): ${errText}`);
  }

  const rawText = await response.text();
  // Wit.ai mengembalikan streaming JSON objects yang dipisahkan oleh newline/chunk
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]);
      if (parsed.text) {
        return parsed.text.trim();
      }
    } catch {
      // Lanjut cek baris berikutnya jika JSON terpotong
    }
  }
  return '';
}

/**
 * Mengubah buffer PCM 48kHz dari pembicaraan user di Discord menjadi teks.
 *
 * @param {Buffer} pcmBuffer - Raw 48kHz 16-bit mono PCM buffer
 * @returns {Promise<string>} Hasil transkripsi teks
 */
async function transcribeAudio(pcmBuffer) {
  // Minimal ~0.35 detik suara pada 48000Hz 16-bit mono (48000 * 2 * 0.35 = 33600 bytes)
  if (!pcmBuffer || pcmBuffer.length < 33600) {
    return '';
  }

  // Abaikan jika suara terlalu pelan / hanya noise mic
  const rms = calculateRms(pcmBuffer);
  if (rms < 350) {
    return '';
  }

  const wavBuffer = pcm48kToWav16k(pcmBuffer);

  try {
    switch (config.sttProvider) {
      case 'openai':
        return await transcribeWithOpenAI(wavBuffer);
      case 'wit':
        return await transcribeWithWit(wavBuffer);
      case 'groq':
      default:
        return await transcribeWithGroq(wavBuffer);
    }
  } catch (err) {
    console.error('❌ [STT] Gagal mentranskripsi suara:', err.message);
    return '';
  }
}

/**
 * Mengecek apakah teks transkripsi mengandung kata "prabowo" (atau variasi fonetiknya)
 *
 * @param {string} transcript
 * @returns {boolean}
 */
function containsPrabowoKeyword(transcript) {
  if (!transcript) return false;

  const normalized = transcript
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Cek dari daftar kata kunci di config (.env)
  for (const keyword of config.triggerKeywords) {
    if (normalized.includes(keyword)) {
      return true;
    }
  }

  // Regex tambahan untuk variasi tangkapan STT terhadap "Prabowo"
  const phoneticRegex = /\b(prabow[oa]|perabow[oa]|pra\s*bow[oa]|prabov[oa])\b/i;
  return phoneticRegex.test(normalized);
}

module.exports = {
  transcribeAudio,
  containsPrabowoKeyword,
};
