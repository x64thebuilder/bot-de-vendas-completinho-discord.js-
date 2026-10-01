require("dotenv").config();
const {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials
} = require("discord.js");
const { syncApplicationEmojis } = require("./emojis");
const { handlePartnershipMessage } = require("./modules/partnerships");
const { handleIAMessage } = require("./modules/automations");
const { ensureBotIdentity } = require("./modules/identity");
const { applyFirstBootBranding } = require("./modules/branding");
const { announceSystemBoot } = require("./modules/systemAnnounce");
const { handleInteraction } = require("./interactions");
const { setupLogs } = require("./logs");
const { setupCartCleanup } = require("./sales");
const { applyPresence } = require("./presence");
const { registerCommands } = require("./commands");
const automationScheduler = require("./modules/automations/scheduler");
const { startVerificationLogPoller } = require("./modules/oauth2");
const { startGiveaways } = require("./modules/giveaways");
const { startAffiliates } = require("./modules/affiliates");
const { handleMiddlemanMessage } = require("./middleman");
const { handleAutoReactMessage } = require("./modules/automations");
const { handlePaymentSetupMessage } = require("./payment-setup");
const { handleSuggestionMessage } = require("./modules/suggestions");
const { setupInvites } = require("./invites");
const { isGuildBanned, isUserBanned } = require("./blacklist");
const { handlePrefixCommand } = require("./modules/blacklist");
const { startDashboardApi } = require("./dashboardApi");
const { enforceBotDescription, enforceBotBanner, startDescriptionWatcher } = require("./modules/botDescription");
const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID } = process.env;
if (!DISCORD_TOKEN) {
  throw new Error("Configure DISCORD_TOKEN no arquivo .env.");
}
function getAllowedGuildId() {
  const rawEnv = (process.env.GUILD_ID || process.env.DISCORD_GUILD_ID || "").trim();
  const cleaned = rawEnv.replace(/^["']|["']$/g, "").trim();
  const first = cleaned.split(/[,\s]+/).filter(Boolean)[0];
  if (!first) return null;
  const match = first.match(/\d{15,25}/);
  return match ? match[0] : first;
}
const ALLOWED_GUILD_ID = getAllowedGuildId();
if (!ALLOWED_GUILD_ID) {
  throw new Error("Configure GUILD_ID no arquivo .env com o ID do servidor único onde este bot vai rodar. Ex: GUILD_ID=SEU_GUILD_ID_AQUI");
}
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildExpressions,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [
    Partials.Channel,
    Partials.GuildMember,
    Partials.Message,
    Partials.User
  ]
});
client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Bot online como ${readyClient.user.tag}.`);
  const identity = ensureBotIdentity(readyClient);
  console.log(`[Identidade] ID unico do bot: ${identity.botId}`);
  await applyFirstBootBranding(readyClient).catch((error) => console.error("[Branding]", error.message));
  const guildIds = [ALLOWED_GUILD_ID];
  console.log(`[Comandos] Modo single-server: registrando comandos no servidor ${ALLOWED_GUILD_ID} (instantâneo).`);
  try {
    const registeredCommands = await registerCommands({
      token: DISCORD_TOKEN,
      clientId: DISCORD_CLIENT_ID || readyClient.application.id,
      guildIds,
    });
    console.log(`[Comandos] Registrados ${registeredCommands.scope}: ${registeredCommands.names.map((name) => `/${name}`).join(", ")}.`);
  } catch (e) {
    console.error("[Comandos] Falha ao registrar — bot continua online, mas /panel pode não aparecer:", e.message);
  }
  console.log("[Emojis] Verificando emojis da aplicacao...");
  client.appEmojis = await syncApplicationEmojis(client);
  console.log(`[Emojis] Sincronizacao concluida com ${client.appEmojis.size} emoji(s) disponiveis.`);
  announceSystemBoot(client).catch((error) => console.error("[Sistema] Erro ao anunciar boot:", error));
  automationScheduler.start(client);
  startVerificationLogPoller(client);
  startGiveaways(client);
  startAffiliates(client);
  applyPresence(client);
  enforceBotDescription(readyClient).catch((e) => console.error("[Descricao] Erro inicial:", e.message));
  enforceBotBanner(readyClient).catch((e) => console.error("[Banner] Erro inicial:", e.message));
  startDescriptionWatcher(readyClient, 60_000);
  console.log(`[Single-Server] GUILD_ID configurado: ${ALLOWED_GUILD_ID}`);
  console.log(`[Single-Server] Servidores conectados: ${client.guilds.cache.size} — ${[...client.guilds.cache.values()].map(g => `${g.name} (${g.id})`).join(", ") || "nenhum"}`);
  if (client.guilds.cache.size === 1) {
    const soleId = [...client.guilds.cache.keys()][0];
    if (String(soleId) !== String(ALLOWED_GUILD_ID)) {
      console.warn(`[Single-Server] ATENÇÃO: GUILD_ID=${ALLOWED_GUILD_ID} não bate com o servidor atual ${soleId}. O bot vai recusar interações e sair. Corrija GUILD_ID no .env para ${soleId}.`);
      const wrong = client.guilds.cache.get(soleId);
      if (wrong) wrong.leave().catch(() => null);
    } else {
      console.log(`[Single-Server] OK: bot está no servidor correto.`);
    }
  } else if (client.guilds.cache.size > 1) {
    console.warn(`[Single-Server] Bot está em ${client.guilds.cache.size} servidores, mas só pode ficar em ${ALLOWED_GUILD_ID}. Saindo dos extras...`);
    for (const [id, guild] of client.guilds.cache) {
      if (String(id) !== String(ALLOWED_GUILD_ID)) {
        console.warn(`[Single-Server] Saindo de "${guild.name}" (${id})`);
        guild.leave().catch(() => null);
      }
    }
  }
});
client.on(Events.GuildCreate, (guild) => {
  console.log(`[Servidores] Bot adicionado ao servidor "${guild.name}" (${guild.id}).`);
  if (isGuildBanned(guild.id)) {
    console.log(`[Blacklist] Servidor "${guild.name}" (${guild.id}) banido. Saindo.`);
    guild.leave().catch(() => null);
    return;
  }
  if (guild.ownerId && isUserBanned(guild.ownerId)) {
    console.log(`[Blacklist] Dono do servidor "${guild.name}" banido. Saindo.`);
    guild.leave().catch(() => null);
    return;
  }
  if (String(guild.id) !== String(ALLOWED_GUILD_ID)) {
    console.log(`[Single-Server] Servidor "${guild.name}" (${guild.id}) não é o permitido (${ALLOWED_GUILD_ID}). Saindo.`);
    guild.leave().catch(() => null);
  }
});
client.on(Events.GuildDelete, (guild) => {
  console.log(`[Servidores] Bot removido do servidor "${guild.name}" (${guild.id}).`);
});
client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.guildId && String(interaction.guildId) !== String(ALLOWED_GUILD_ID)) {
    console.warn(`[Single-Server] Interação bloqueada: guild=${interaction.guildId} allowed=${ALLOWED_GUILD_ID} user=${interaction.user?.id}`);
    if (interaction.isRepliable()) {
      await interaction.reply({ content: `Este bot só funciona no servidor \`${ALLOWED_GUILD_ID}\`.`, flags: MessageFlags.Ephemeral }).catch(() => null);
    }
    return;
  }
  if (process.env.BOT_DEBUG === "1") {
    console.log(`[DEBUG] Interacao recebida: tipo=${interaction.type} comando=${interaction.commandName || interaction.customId || "?"} guild=${interaction.guildId}`);
  }
  try {
    await handleInteraction(interaction);
    if (process.env.BOT_DEBUG === "1") {
      console.log(`[DEBUG] Interacao processada: ${interaction.commandName || interaction.customId || "?"}`);
    }
  } catch (error) {
    console.error("[Interacao]", error);
    const isDebug = process.env.BOT_DEBUG === "1";
    const payload = {
      content: isDebug ? `Algo deu errado: ${error.message}` : `Algo deu errado. Código: ${Date.now().toString(36)}`,
      flags: MessageFlags.Ephemeral
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload).catch(() => null);
    } else {
      await interaction.reply(payload).catch(() => null);
    }
  }
});
client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.guildId && String(message.guildId) !== String(ALLOWED_GUILD_ID)) return;
    if (await handlePrefixCommand(message)) return;
    if (message.guild && isGuildBanned(message.guild.id)) return;
    if (isUserBanned(message.author.id)) return;
    if (await handlePartnershipMessage(message)) return;
    if (await handleIAMessage(message)) return;
    if (await handleSuggestionMessage(message)) return;
    if (await handlePaymentSetupMessage(message)) return;
    await handleAutoReactMessage(message).catch((error) => console.error("[Auto React]", error));
    await handleMiddlemanMessage(message);
  } catch (error) {
    console.error("[Middleman mensagem]", error);
  }
});
setupLogs(client);
setupInvites(client);
setupCartCleanup(client);
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (error) => {
  console.error("[uncaughtException]", error);
});
client.on(Events.Error, (error) => console.error("[Client Error]", error));
client.on(Events.Warn, (msg) => console.warn("[Client Warn]", msg));
client.on(Events.ShardError, (error) => console.error("[ShardError]", error));
client.on(Events.ShardDisconnect, (event, shardId) => console.warn(`[ShardDisconnect] shard ${shardId}`, event));
client.on(Events.ShardReconnecting, (shardId) => console.log(`[ShardReconnecting] shard ${shardId}`));
client.on(Events.ShardResume, (shardId) => console.log(`[ShardResume] shard ${shardId}`));
startDashboardApi(process.env.PORT || 80);
client.login(DISCORD_TOKEN);
