const http = require('http');
const {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  MessageFlags,
} = require('discord.js');
const { getVoiceConnection } = require('@discordjs/voice');
const libsodium = require('libsodium-wrappers');
const config = require('./config');
const { connectAndListen, disconnectVoice } = require('./voiceListener');
const { playPrabowoVoice, resolveAudioFile } = require('./audioPlayer');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

// Server HTTP Keep-Alive
const PORT = process.env.PORT || 3000;
const srv = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      status: 'ok',
      bot: client.user ? client.user.tag : 'starting',
      uptime: Math.floor(process.uptime()),
    })
  );
});
srv.on('error', (err) => {
  console.warn(`⚠️  [Keep-Alive] Port ${PORT} tidak digunakan:`, err.message);
});
srv.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 [Keep-Alive] HTTP Healthcheck aktif di port ${PORT}`);
});

const commands = [
  new SlashCommandBuilder()
    .setName('join')
    .setDescription('Panggil bot masuk ke Voice Channel kamu untuk mulai mendengarkan kata Prabowo'),
  new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Keluarkan bot dari Voice Channel'),
  new SlashCommandBuilder()
    .setName('tes-suara')
    .setDescription('Tes putar suara "Hey antek-antek asing!" langsung di Voice Channel'),
].map((cmd) => cmd.toJSON());

/**
 * Mendaftarkan Slash Commands (/join, /leave, /tes-suara) ke semua server tempat bot berada
 */
async function registerSlashCommands() {
  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  try {
    for (const guild of client.guilds.cache.values()) {
      await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), {
        body: commands,
      });
    }
    console.log('✅ [Commands] Slash command (/join, /leave, /tes-suara) siap digunakan.');
  } catch (err) {
    console.warn('⚠️  [Commands] Gagal mendaftarkan slash command:', err.message);
  }
}

/**
 * Jika AUTO_JOIN_VOICE=true, otomatis masuk ke Voice Channel yang sedang ada usernya saat bot nyala
 */
async function autoJoinPopulatedChannels() {
  if (!config.autoJoinVoice) return;

  for (const guild of client.guilds.cache.values()) {
    const existingConn = getVoiceConnection(guild.id);
    if (existingConn) continue;

    // Cari voice state dari user (bukan bot ini) yang sedang berada di Voice Channel
    const activeVoiceState = guild.voiceStates.cache.find(
      (vs) => vs.channelId && vs.id !== client.user.id && !vs.member?.user?.bot
    );

    if (activeVoiceState && activeVoiceState.channel && activeVoiceState.channel.joinable) {
      try {
        await connectAndListen(activeVoiceState.channel, client);
      } catch {}
    }
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  await libsodium.ready;

  console.log('====================================================');
  console.log(`🤖 Bot berhasil login sebagai: ${readyClient.user.tag}`);
  console.log(`🎙️  Provider Speech-to-Text : ${config.sttProvider.toUpperCase()}`);
  console.log(`🔑 Kata Kunci Pemicu       : ${config.triggerKeywords.join(', ')}`);
  console.log(`⚡ Auto-Join Voice Channel : ${config.autoJoinVoice ? 'AKTIF' : 'NONAKTIF'}`);
  console.log('====================================================');

  try {
    const audioPath = await resolveAudioFile();
    console.log(`🔊 [Audio] Menggunakan file suara: ${audioPath}`);
  } catch (err) {
    console.warn('⚠️  [Audio] Gagal menyiapkan fallback audio awal:', err.message);
  }

  await registerSlashCommands();
  await autoJoinPopulatedChannels();
});

// Otomatis masuk/keluar ketika ada user yang join/leave Voice Channel
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  if (!config.autoJoinVoice) return;

  // Abaikan event dari bot sendiri atau bot lain
  const userId = newState.id || oldState.id;
  if (userId === client.user?.id) return;
  if (newState.member?.user?.bot || oldState.member?.user?.bot) return;

  const guild = newState.guild || oldState.guild;
  const currentConnection = getVoiceConnection(guild.id);

  // 1. Jika ada user masuk ke Voice Channel & bot belum join di server tersebut
  if (newState.channelId && !currentConnection) {
    if (newState.channel && newState.channel.joinable) {
      try {
        await connectAndListen(newState.channel, client);
      } catch {}
    }
    return;
  }

  // 2. Hanya cek keluar jika user BENAR-BENAR pindah/keluar channel (oldState.channelId !== newState.channelId)
  if (
    oldState.channelId &&
    oldState.channelId !== newState.channelId &&
    currentConnection
  ) {
    const botChannelId = currentConnection.joinConfig.channelId;
    if (oldState.channelId === botChannelId) {
      // Gunakan voiceStates.cache agar akurat meskipun member belum ter-cache
      const remainingHumans = guild.voiceStates.cache.filter(
        (vs) => vs.channelId === botChannelId && vs.id !== client.user?.id && !vs.member?.user?.bot
      );

      if (remainingHumans.size === 0) {
        console.log(
          `👋 [Voice] Semua user telah keluar dari "${oldState.channel?.name || 'Voice Channel'}", bot ikut keluar.`
        );
        disconnectVoice(guild.id);
      }
    }
  }
});

// Handler untuk Slash Commands (/join, /leave, /tes-suara)
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, guild, member } = interaction;
  if (!guild) return;

  // Cari channel voice user dari voiceStates.cache atau member.voice
  const userVoiceState = guild.voiceStates.cache.get(interaction.user.id);
  const voiceChannel = userVoiceState?.channel || member?.voice?.channel;

  if (commandName === 'join') {
    if (!voiceChannel) {
      return interaction.reply({
        content: '❌ Kamu harus masuk ke Voice Channel terlebih dahulu!',
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await connectAndListen(voiceChannel, client);
      await interaction.editReply(
        `🔊 Siap! Bot sudah masuk ke **${voiceChannel.name}** dan mendengarkan jika ada yang menyebut kata **"Prabowo"**.`
      );
    } catch (err) {
      await interaction.editReply(`❌ Gagal masuk ke Voice Channel: ${err.message}`);
    }
  } else if (commandName === 'leave') {
    const left = disconnectVoice(guild.id);
    await interaction.reply({
      content: left
        ? '👋 Bot telah keluar dari Voice Channel.'
        : 'ℹ️ Bot sedang tidak berada di Voice Channel.',
      flags: MessageFlags.Ephemeral,
    });
  } else if (commandName === 'tes-suara') {
    if (!voiceChannel) {
      return interaction.reply({
        content: '❌ Kamu harus berada di Voice Channel untuk mengetes suara!',
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const connection = await connectAndListen(voiceChannel, client);
      await playPrabowoVoice(connection, guild.id, true);
      await interaction.editReply('🔊 Memutar suara **"Hey antek-antek asing!"** di Voice Channel.');
    } catch (err) {
      await interaction.editReply(`❌ Gagal memutar suara: ${err.message}`);
    }
  }
});

if (!config.discordToken || config.discordToken.includes('masukkan_token')) {
  console.error('❌ ERROR: DISCORD_TOKEN belum diatur!');
  console.error('👉 Silakan salin file .env.example menjadi .env lalu isi DISCORD_TOKEN Anda.');
  process.exit(1);
}

client.login(config.discordToken).catch((err) => {
  console.error('❌ Gagal login ke Discord. Pastikan DISCORD_TOKEN valid:', err.message);
  process.exit(1);
});
