const fs = require('fs');
const { execSync } = require('child_process');

// 1. Pastikan @discordjs/voice v0.19.0+ (Protokol Voice v8 + DAVE) terinstal di Node 22
try {
  const voicePkg = JSON.parse(
    fs.readFileSync('./node_modules/@discordjs/voice/package.json', 'utf8')
  );
  console.log(`ℹ️  [Startup] Versi @discordjs/voice saat ini: v${voicePkg.version}`);
  if (voicePkg.version.startsWith('0.17') || voicePkg.version.startsWith('0.18')) {
    console.log('📦 [Startup] Mengupgrade @discordjs/voice ke v0.19.0 (Voice Gateway v8 + DAVE)...');
    execSync(
      'npm install @discordjs/voice@0.19.0 @snazzah/davey@latest @stablelib/xchacha20poly1305 --save --no-audit --no-fund',
      { stdio: 'inherit' }
    );
    console.log('✅ [Startup] Upgrade @discordjs/voice v0.19.0 berhasil!');
  }
} catch (err) {
  console.error('⚠️  [Startup] Gagal mengecek/mengupgrade @discordjs/voice:', err.message);
}

// 2. Pastikan binary ffmpeg-static terunduh (karena Wispbyte memblokir postinstall script npm)
try {
  const ffmpegPath = require('ffmpeg-static');
  if (ffmpegPath && !fs.existsSync(ffmpegPath)) {
    console.log('📦 [Startup] Mengunduh binary FFmpeg untuk pemutar suara...');
    execSync('node ./node_modules/ffmpeg-static/install.js', { stdio: 'inherit' });
    console.log('✅ [Startup] Binary FFmpeg siap digunakan!');
  }
} catch (err) {
  console.error('⚠️  [Startup] Gagal mengunduh binary FFmpeg:', err.message);
}

require('./src/index.js');
