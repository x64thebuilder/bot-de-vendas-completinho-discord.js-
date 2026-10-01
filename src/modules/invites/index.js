const { ContainerBuilder, EmbedBuilder, MessageFlags, SectionBuilder, SeparatorBuilder, TextDisplayBuilder, ThumbnailBuilder, Events } = require("discord.js");
const { getGuildConfig } = require("../../storage");
const { readGuildFile, writeGuildFile } = require("../../guildDb");
const { canUseAdminCommand } = require("../stats");
const COLOR = 0xffffff;
const OK_COLOR = 0x2ecc71;
const WARN_COLOR = 0xf1c40f;
const DANGER_COLOR = 0xe74c3c;
const inviteCache = new Map();
function setupInvites(client) {
  client.once(Events.ClientReady, async () => {
    for (const guild of client.guilds.cache.values()) {
      await refreshInviteCache(guild);
    }
  });
  client.on(Events.InviteCreate, async (invite) => {
    await refreshInviteCache(invite.guild);
  });
  client.on(Events.InviteDelete, async (invite) => {
    await refreshInviteCache(invite.guild);
  });
  client.on(Events.GuildMemberAdd, async (member) => {
    await trackMemberJoin(member);
  });
  client.on(Events.GuildMemberRemove, async (member) => {
    await trackMemberLeave(member);
  });
  client.on(Events.GuildDelete, (guild) => {
    inviteCache.delete(guild.id);
  });
}
async function handleInviteCommand(interaction) {
  if (!interaction.isChatInputCommand()) return false;
  if (interaction.commandName === "convites") {
    await showUserInvites(interaction);
    return true;
  }
  if (interaction.commandName === "rank_invites") {
    await showInviteRank(interaction);
    return true;
  }
  return false;
}
async function trackMemberJoin(member) {
  const before = inviteCache.get(member.guild.id) || new Map();
  const afterInvites = await fetchGuildInvites(member.guild);
  const used = findUsedInvite(before, afterInvites);
  inviteCache.set(member.guild.id, afterInvites);
  const inviterId = used?.inviterId || null;
  const accountAge = Date.now() - member.user.createdTimestamp;
  const blocked = false;
  const data = readInvites(member.guild.id);
  const store = guildStore(data);
  store.joins[member.id] = {
    userId: member.id,
    inviterId,
    code: used?.code || null,
    joinedAt: Date.now(),
    accountCreatedAt: member.user.createdTimestamp,
    valid: !blocked && Boolean(inviterId),
    blocked,
    left: false
  };
  if (inviterId) {
    const inviter = userStats(store, inviterId);
    inviter.total += 1;
    if (blocked) inviter.blocked += 1;
    else inviter.valid += 1;
  }
  writeInvites(member.guild.id, data);
  try {
    await require("../affiliates").onJoin(member, store.joins[member.id]);
  } catch {   }
  await sendInviteLog(member.guild, {
    title: blocked ? "Conta bloqueada por idade" : "Novo membro convidado",
    color: blocked ? DANGER_COLOR : OK_COLOR,
    description: blocked
      ? `${member} entrou por convite, mas a conta tem menos de 3 meses.`
      : `${member} entrou usando um convite rastreado.`,
    fields: [
      { name: "Membro", value: `${member.user.tag}\n${member.id}`, inline: true },
      { name: "Convidado por", value: inviterId ? `<@${inviterId}>\n${inviterId}` : "Nao identificado", inline: true },
      { name: "Codigo", value: used?.code ? `\`${used.code}\`` : "`desconhecido`", inline: true },
      { name: "Conta criada", value: time(member.user.createdTimestamp), inline: true },
      { name: "Idade da conta", value: accountAgeText(accountAge), inline: true },
      { name: "Status", value: blocked ? "`bloqueada`" : "`valida`", inline: true }
    ],
    thumbnail: member.user.displayAvatarURL()
  });
  if (blocked) {
  }
}
async function trackMemberLeave(member) {
  const data = readInvites(member.guild.id);
  const store = guildStore(data);
  const join = store.joins[member.id];
  if (!join || join.left) return;
  join.left = true;
  join.leftAt = Date.now();
  if (join.blocked) {
    writeInvites(member.guild.id, data);
    return;
  }
  if (join.inviterId) {
    const inviter = userStats(store, join.inviterId);
    if (join.valid) inviter.valid = Math.max(0, inviter.valid - 1);
    inviter.left += 1;
  }
  writeInvites(member.guild.id, data);
  try {
    await require("../affiliates").onLeave(member);
  } catch {   }
  await sendInviteLog(member.guild, {
    title: "Convite perdido",
    color: WARN_COLOR,
    description: `${member.user.tag} saiu do servidor e o convite deixou de contar.`,
    fields: [
      { name: "Usuario", value: `${member.user.tag}\n${member.id}`, inline: true },
      { name: "Convidado por", value: join.inviterId ? `<@${join.inviterId}>\n${join.inviterId}` : "Nao identificado", inline: true },
      { name: "Codigo", value: join.code ? `\`${join.code}\`` : "`desconhecido`", inline: true }
    ],
    thumbnail: member.user.displayAvatarURL()
  });
}
async function showUserInvites(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: "Use este comando dentro de um servidor.", flags: MessageFlags.Ephemeral });
    return;
  }
  const target = interaction.options.getUser("usuario") || interaction.user;
  const data = readInvites(interaction.guildId);
  const stats = userStats(guildStore(data), target.id);
  const activeInvited = Object.values(guildStore(data).joins || {}).filter((join) => join.inviterId === target.id && join.valid && !join.left).length;
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setAuthor({ name: target.username, iconURL: target.displayAvatarURL() })
    .setTitle("📨 Convites do usuário")
    .setDescription(`Resumo de convites rastreados para ${target}.`)
    .addFields(
      { name: "✅ Válidos", value: `**${stats.valid}**`, inline: true },
      { name: "🟢 Ativos agora", value: `**${activeInvited}**`, inline: true },
      { name: "📊 Total usado", value: `**${stats.total}**`, inline: true },
      { name: "📉 Perdidos", value: `**${stats.left}**`, inline: true },
      { name: "⛔ Bloqueados", value: `**${stats.blocked}**`, inline: true }
    )
    .setFooter({ text: "🌨️ Sync", iconURL: interaction.client.user.displayAvatarURL() })
    .setTimestamp();
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
async function showInviteRank(interaction) {
  if (!canUseAdminCommand(interaction)) {
    await interaction.reply({ content: "Somente administradores ou usuarios com /perms podem usar este comando.", flags: MessageFlags.Ephemeral });
    return;
  }
  const store = guildStore(readInvites(interaction.guildId));
  const rows = Object.entries(store.users || {})
    .map(([userId, stats]) => ({ userId, ...stats }))
    .filter((row) => Number(row.valid || 0) > 0 || Number(row.total || 0) > 0)
    .sort((a, b) => Number(b.valid || 0) - Number(a.valid || 0) || Number(b.total || 0) - Number(a.total || 0))
    .slice(0, 10);
  const MEDALS = ["🥇", "🥈", "🥉"];
  const description = rows.length
    ? rows.map((row, index) => `**${MEDALS[index] || `${index + 1}.`}** <@${row.userId}> — **${row.valid || 0} válidos**\n📊 Total: \`${row.total || 0}\` | 📉 Perdidos: \`${row.left || 0}\` | ⛔ Bloqueados: \`${row.blocked || 0}\``).join("\n\n")
    : "Ainda não existem convites rastreados.";
  const embed = new EmbedBuilder()
    .setColor(OK_COLOR)
    .setTitle("📈 Rank de invites")
    .setDescription(description)
    .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL() || undefined })
    .setTimestamp();
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
async function refreshInviteCache(guild) {
  if (!guild) return;
  inviteCache.set(guild.id, await fetchGuildInvites(guild));
}
async function fetchGuildInvites(guild) {
  const invites = await guild.invites.fetch().catch(() => null);
  const mapped = new Map();
  if (!invites) return mapped;
  for (const invite of invites.values()) {
    mapped.set(invite.code, {
      code: invite.code,
      uses: invite.uses || 0,
      inviterId: invite.inviter?.id || null,
      channelId: invite.channelId || invite.channel?.id || null
    });
  }
  return mapped;
}
function findUsedInvite(before, after) {
  for (const invite of after.values()) {
    const previous = before.get(invite.code);
    if (!previous && invite.uses > 0) return invite;
    if (previous && invite.uses > previous.uses) return invite;
  }
  return null;
}
async function sendInviteLog(guild, data) {
  const channelId = getGuildConfig(guild.id).channels.inviteLogs;
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const ts = Math.floor(Date.now() / 1000);
  const panel = new ContainerBuilder().setAccentColor(data.color);
  try {
    if (data.thumbnail) {
      const section = new SectionBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## ${wIcon(guild.client, "w_users")}${data.title}`),
        new TextDisplayBuilder().setContent(data.description)
      );
      section.setThumbnailAccessory(new ThumbnailBuilder().setURL(data.thumbnail).setDescription(data.title));
      panel.addSectionComponents(section);
    } else {
      panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${wIcon(guild.client, "w_users")}${data.title}\n${data.description}`));
    }
  } catch {
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${data.title}\n${data.description}`));
  }
  if (data.fields?.length) {
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(compactLines(data.fields)));
  }
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${guild.name} • <t:${ts}:R>`));
  await channel.send({ components: [panel], flags: MessageFlags.IsComponentsV2 }).catch(() => null);
}
function wIcon(client, name) {
  try {
    const found = client?.appEmojis?.get(name);
    return found ? `<:${found.name}:${found.id}> ` : "";
  } catch {
    return "";
  }
}
function compactLines(fields) {
  const lines = [];
  let pending = null;
  for (const f of fields || []) {
    const v = String(f.value ?? "—");
    if (v.includes("\n") || v.length > 60) {
      if (pending) {
        lines.push(pending);
        pending = null;
      }
      lines.push(`**${f.name}:** ${v}`);
    } else if (!pending) {
      pending = `**${f.name}:** ${v}`;
    } else {
      lines.push(`${pending} ╺╸ **${f.name}:** ${v}`);
      pending = null;
    }
  }
  if (pending) lines.push(pending);
  return lines.join("\n");
}
function readInvites(guildId) {
  return readGuildFile(guildId, "invites", () => ({ users: {}, joins: {} }));
}
function writeInvites(guildId, data) {
  writeGuildFile(guildId, "invites", data);
}
function guildStore(data) {
  data.users ||= {};
  data.joins ||= {};
  return data;
}
function userStats(store, userId) {
  store.users[userId] ||= { total: 0, valid: 0, left: 0, blocked: 0 };
  return store.users[userId];
}
function accountAgeText(ms) {
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days < 1) return "menos de 1 dia";
  if (days < 30) return `${days} dia(s)`;
  return `${Math.floor(days / 30)} mes(es) e ${days % 30} dia(s)`;
}
function time(timestamp) {
  return `<t:${Math.floor(timestamp / 1000)}:F>`;
}
module.exports = {
  setupInvites,
  handleInviteCommand
};
