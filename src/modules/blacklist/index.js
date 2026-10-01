const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags
} = require("discord.js");
const { isHomeGuildStaff } = require("../../botOwners");
const { sendModLog } = require("../../modLog");
const {
  banGuild,
  unbanGuild,
  banUser,
  unbanUser,
  isGuildBanned,
  listBannedGuilds,
  listBannedUsers
} = require("../../blacklist");
const PREFIX = ".";
const PAGE_SIZE = 6;
const DANGER_COLOR = 0xe74c3c;
const OK_COLOR = 0x2ecc71;
function isGlobalOwner(_client, userId) {
  const envOwners = [process.env.OWNER_ID, ...(process.env.OWNER_IDS || "").split(/[,\s]+/)]
    .map((id) => String(id || "").trim())
    .filter(Boolean);
  return envOwners.includes(userId);
}
function formatTimestamp(ms) {
  return `<t:${Math.floor(ms / 1000)}:R>`;
}
function buildUsersPage(page) {
  const users = listBannedUsers();
  const totalPages = Math.max(1, Math.ceil(users.length / PAGE_SIZE));
  const clamped = Math.min(Math.max(0, page), totalPages - 1);
  const slice = users.slice(clamped * PAGE_SIZE, clamped * PAGE_SIZE + PAGE_SIZE);
  const embed = new EmbedBuilder()
    .setTitle("🔒 Usuarios banidos")
    .setColor(DANGER_COLOR)
    .setDescription(slice.length
      ? slice.map((u) => `**${u.tag || "Usuario"}** — \`${u.userId}\`\n> Motivo: ${u.reason}\n> Banido ${formatTimestamp(u.bannedAt)}`).join("\n\n")
      : "Nenhum usuario banido no momento.")
    .setFooter({ text: `Pagina ${clamped + 1}/${totalPages} • ${users.length} usuario(s) banido(s)` });
  return { embed, page: clamped, totalPages };
}
function buildGuildsPage(page) {
  const guilds = listBannedGuilds();
  const totalPages = Math.max(1, Math.ceil(guilds.length / PAGE_SIZE));
  const clamped = Math.min(Math.max(0, page), totalPages - 1);
  const slice = guilds.slice(clamped * PAGE_SIZE, clamped * PAGE_SIZE + PAGE_SIZE);
  const embed = new EmbedBuilder()
    .setTitle("🚫 Servidores banidos")
    .setColor(DANGER_COLOR)
    .setDescription(slice.length
      ? slice.map((g) => `**${g.guildName || "Servidor desconhecido"}** — \`${g.guildId}\`\n> Motivo: ${g.reason}\n> Banido ${formatTimestamp(g.bannedAt)}`).join("\n\n")
      : "Nenhum servidor banido no momento.")
    .setFooter({ text: `Pagina ${clamped + 1}/${totalPages} • ${guilds.length} servidor(es) banido(s)` });
  return { embed, page: clamped, totalPages };
}
function buildComponents(view, page, totalPages) {
  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`blacklist:page:${view}:${page - 1}`)
      .setLabel("◀ Anterior")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`blacklist:page:${view}:${page + 1}`)
      .setLabel("Proxima ▶")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1)
  );
  const viewRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("blacklist:view:users")
      .setLabel("👤 Usuarios")
      .setStyle(view === "users" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("blacklist:view:guilds")
      .setLabel("🏠 Servidores")
      .setStyle(view === "guilds" ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );
  return [navRow, viewRow];
}
function buildDmBanEmbed(guildName, guildId, reason) {
  return new EmbedBuilder()
    .setTitle("🚫 Voce foi banido de usar este bot")
    .setColor(DANGER_COLOR)
    .setDescription(
      `Voce era o dono do servidor **${guildName || guildId}** (\`${guildId}\`), que foi banido de usar este bot.\n\n` +
      `Como dono daquele servidor, voce tambem foi banido de usar o bot em qualquer outro servidor.`
    )
    .addFields({ name: "Motivo", value: reason || "Nao informado" })
    .setTimestamp();
}
async function banGuildAndOwner(client, guildId, reason, bannedByUserId) {
  const guild = client.guilds.cache.get(guildId)
    || await client.guilds.fetch(guildId).catch(() => null);
  const guildName = guild?.name || null;
  const ownerId = guild?.ownerId || null;
  banGuild(guildId, { reason, bannedBy: bannedByUserId, guildName });
  let ownerUser = null;
  let dmSent = false;
  if (ownerId) {
    ownerUser = await client.users.fetch(ownerId).catch(() => null);
    banUser(ownerId, {
      reason: `Dono do servidor banido: ${guildName || guildId}`,
      bannedBy: bannedByUserId,
      sourceGuildId: guildId,
      tag: ownerUser?.tag || null
    });
    if (ownerUser) {
      dmSent = await ownerUser.send({ embeds: [buildDmBanEmbed(guildName, guildId, reason)] })
        .then(() => true)
        .catch(() => false);
    }
  }
  if (guild) {
    await guild.leave().catch(() => null);
  }
  return { guild, guildName, ownerId, dmSent };
}
async function handleBanCommand(message, args) {
  const guildId = args[0];
  const reason = args.slice(1).join(" ").trim();
  if (!guildId || !/^\d{15,20}$/.test(guildId)) {
    await message.reply("Uso: `.ban <id_do_servidor> <motivo>` — o motivo e obrigatorio.");
    return;
  }
  if (!reason) {
    await message.reply("Voce precisa informar um motivo. Uso: `.ban <id_do_servidor> <motivo>`");
    return;
  }
  if (isGuildBanned(guildId)) {
    await message.reply("Esse servidor ja esta banido.");
    return;
  }
  const { guildName, ownerId, dmSent } = await banGuildAndOwner(message.client, guildId, reason, message.author.id);
  const embed = new EmbedBuilder()
    .setTitle("🚫 Servidor banido")
    .setColor(DANGER_COLOR)
    .addFields(
      { name: "Servidor", value: `${guildName || "Desconhecido (bot nao estava nele)"}\n\`${guildId}\``, inline: true },
      { name: "Dono banido junto", value: ownerId ? `Sim — <@${ownerId}> (\`${ownerId}\`)` : "Nao foi possivel identificar o dono", inline: true },
      { name: "Aviso enviado no PV", value: dmSent ? "Sim" : "Nao (DMs fechadas ou dono nao identificado)", inline: true },
      { name: "Motivo", value: reason },
      { name: "Banido por", value: `<@${message.author.id}>` }
    )
    .setTimestamp();
  await message.reply({ embeds: [embed] });
  await sendModLog(message.client, embed).catch(() => null);
}
async function handleUnbanCommand(message, args) {
  const id = args[0];
  if (!id || !/^\d{15,20}$/.test(id)) {
    await message.reply("Uso: `.unban <id_do_servidor_ou_usuario>`");
    return;
  }
  const guildRemoved = unbanGuild(id);
  const userRemoved = unbanUser(id);
  if (!guildRemoved && !userRemoved) {
    await message.reply("Esse ID nao esta banido.");
    return;
  }
  const parts = [];
  if (guildRemoved) parts.push("servidor");
  if (userRemoved) parts.push("usuario");
  const embed = new EmbedBuilder()
    .setTitle("✅ Removido da blacklist")
    .setColor(OK_COLOR)
    .setDescription(`\`${id}\` foi desbanido (${parts.join(" e ")}).`)
    .addFields({ name: "Desbanido por", value: `<@${message.author.id}>` })
    .setTimestamp();
  await message.reply({ embeds: [embed] });
  await sendModLog(message.client, embed).catch(() => null);
}
async function handleViolationsCommand(message, args) {
  const guildId = args[0];
  if (!guildId || !/^\d{15,20}$/.test(guildId)) {
    await message.reply("Uso: `.violations <id_do_servidor>`");
    return;
  }
  const { getViolations, getRestrictionLevel } = require("../../violations");
  const violations = getViolations(guildId);
  const level = getRestrictionLevel(guildId);
  const guild = message.client.guilds.cache.get(guildId) || await message.client.guilds.fetch(guildId).catch(() => null);
  const levelLabel = level === 2 ? "Nivel 2 (rate limit 4s)" : level === 1 ? "Nivel 1 (rate limit 2s)" : "Sem restricao";
  const embed = new EmbedBuilder()
    .setTitle(`📋 Violacoes — ${guild?.name || "Servidor desconhecido"}`)
    .setColor(violations.length ? DANGER_COLOR : OK_COLOR)
    .setDescription(
      `**ID:** \`${guildId}\`\n**Nivel atual:** ${levelLabel}\n**Violacoes ativas:** ${violations.length}/3\n\n` +
      (violations.length
        ? violations.slice(-15).map((v, i) => `**${i + 1}.** ${v.rule}\n> ${v.description || "Sem detalhes."}\n> ${v.reportedBy ? `<@${v.reportedBy}> — ` : ""}<t:${Math.floor(v.at / 1000)}:f>`).join("\n\n")
        : "Nenhuma violacao ativa (violacoes expiram apos 30 dias).")
    )
    .setTimestamp();
  await message.reply({ embeds: [embed] });
}
async function handleBlacklistCheckCommand(message) {
  const { embed, page, totalPages } = buildUsersPage(0);
  await message.reply({ embeds: [embed], components: buildComponents("users", page, totalPages) });
}
async function handleOverviewCommand(message) {
  const { getStrikeCount } = require("../../violations");
  const bannedGuilds = listBannedGuilds();
  const bannedUsers = listBannedUsers();
  const guildId = message.client.guilds.cache.first()?.id || null;
  let level1 = 0;
  let level2 = 0;
  if (guildId) {
    const strikes = getStrikeCount(guildId);
    if (strikes >= 2) level2 = 1;
    else if (strikes >= 1) level1 = 1;
  }
  const client = message.client;
  const embed = new EmbedBuilder()
    .setTitle("📊 Visao geral do bot")
    .setColor(OK_COLOR)
    .addFields(
      { name: "Servidor conectado", value: guildId ? `<t:0> \`${guildId}\`` : "Nenhum", inline: true },
      { name: "Servidores banidos", value: String(bannedGuilds.length), inline: true },
      { name: "Usuarios banidos", value: String(bannedUsers.length), inline: true },
      { name: "Nivel atual", value: level2 ? "Nivel 2 (rate limit 4s)" : level1 ? "Nivel 1 (rate limit 2s)" : "Sem restricao", inline: true }
    )
    .setTimestamp();
  await message.reply({ embeds: [embed] });
}
async function handlePrefixCommand(message) {
  if (message.author.bot) return false;
  if (!message.content.startsWith(PREFIX)) return false;
  const [cmdRaw, ...args] = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = (cmdRaw || "").toLowerCase();
  if (!["ban", "unban", "blacklistcheck", "violations", "overview"].includes(cmd)) return false;
  if (message.guild) return false;
  if (!isGlobalOwner(message.client, message.author.id)) {
    return true;
  }
  if (cmd === "ban") await handleBanCommand(message, args);
  else if (cmd === "unban") await handleUnbanCommand(message, args);
  else if (cmd === "blacklistcheck") await handleBlacklistCheckCommand(message);
  else if (cmd === "violations") await handleViolationsCommand(message, args);
  else if (cmd === "overview") await handleOverviewCommand(message);
  return true;
}
async function handleBlacklistButton(interaction) {
  if (!interaction.isButton()) return false;
  const [prefix, action, view, pageStr] = interaction.customId.split(":");
  if (prefix !== "blacklist") return false;
  if (!isGlobalOwner(interaction.client, interaction.user.id)) {
    await interaction.reply({ content: "Apenas donos do bot podem usar isso.", flags: MessageFlags.Ephemeral });
    return true;
  }
  const targetView = view === "guilds" ? "guilds" : "users";
  const targetPage = action === "view" ? 0 : Number(pageStr || 0);
  const { embed, page, totalPages } = targetView === "guilds" ? buildGuildsPage(targetPage) : buildUsersPage(targetPage);
  await interaction.update({ embeds: [embed], components: buildComponents(targetView, page, totalPages) });
  return true;
}
module.exports = {
  handlePrefixCommand,
  handleBlacklistButton,
  isGlobalOwner,
  banGuildAndOwner
};
