# 🎙️ Bot Discord Voice Detector "Prabowo" -> "Hey Antek-Antek Asing!"

Bot Discord berbasis **Node.js (`discord.js` v14 + `@discordjs/voice`)** yang mendengarkan pembicaraan mic user secara *real-time* di dalam **Voice Channel**. Ketika ada user yang mengucapkan kata **"Prabowo"**, bot **langsung membalas dengan suara (voice)** *"Hey antek-antek asing!"* di Voice Channel tersebut (bukan lewat chat teks).

---

## ✨ Fitur Utama
1. **Real-Time Voice Recognition (Speech-to-Text Bahasa Indonesia)**
   - Mendengarkan stream audio dari setiap user di Voice Channel (`selfDeaf: false`).
   - Memotong rekaman otomatis saat user selesai bicara (jeda 0.75 detik) atau setiap 4.5 detik jika bicara panjang tanpa henti.
   - Mendukung **Groq Whisper (`whisper-large-v3-turbo`)** (Gratis & super cepat `< 0.3 detik`), **Wit.ai** (Gratis), atau **OpenAI Whisper**.
2. **Suara Khas Prabowo + Fallback TTS Otomatis**
   - Memutar klip audio `assets/antek_asing.mp3` (atau `.wav`/`.ogg`) dengan lantang di Voice Channel.
   - Jika file `assets/antek_asing.mp3` belum dimasukkan, bot otomatis men-generate suara fallback TTS Bahasa Indonesia (*"Hey! Antek antek asing!"*) agar bot bisa langsung dites.
3. **Auto-Join & Slash Commands**
   - Otomatis masuk ke Voice Channel saat ada user yang join (bisa diatur lewat `AUTO_JOIN_VOICE=true`).
   - Tersedia perintah `/join`, `/leave`, dan `/tes-suara`.
4. **Tanpa Perlu Install FFmpeg Manual**
   - Sudah dilengkapi `ffmpeg-static` dan `opusscript` bawaan di dalam `package.json`.

---

## 🚀 Cara Menjalankan

### 1. Pastikan Node.js Terinstal
Pastikan **Node.js v18+** sudah terinstal di komputer Anda:
- Jika belum ada di macOS, bisa instal lewat [nodejs.org](https://nodejs.org/) atau via Homebrew:
  ```bash
  brew install node
  ```

### 2. Instal Dependensi
Buka terminal di folder proyek ini, lalu jalankan:
```bash
npm install
```

### 3. Siapkan File `.env`
Salin file `.env.example` menjadi `.env`:
```bash
cp .env.example .env
```
Lalu isi konfigurasi berikut di dalam `.env`:
- `DISCORD_TOKEN`: Token bot dari [Discord Developer Portal](https://discord.com/developers/applications) (di tab **Bot** -> **Reset Token**).
- `GROQ_API_KEY`: Buat API Key gratis di [Groq Console](https://console.groq.com/keys) untuk transkripsi suara Bahasa Indonesia instan (`whisper-large-v3-turbo`).

> **Permission Bot saat Invite ke Server:**
> Di Discord Developer Portal -> **OAuth2** -> **URL Generator**:
> - Scopes: `bot`, `applications.commands`
> - Bot Permissions: `View Channels`, `Connect`, `Speak`, `Use Voice Activity`

### 4. Masukkan File Suara Khas Prabowo
Masukkan file MP3/WAV meme atau suara asli Prabowo *"Hey antek-antek asing!"* ke:
```text
assets/antek_asing.mp3
```
*(Jika belum ada, bot akan otomatis membuat file suara fallback TTS sementara saat dinyalakan).*

### 5. Jalankan Bot
```bash
npm start
```
Atau mode development (auto-restart):
```bash
npm run dev
```
