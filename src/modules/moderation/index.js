const {
  ContainerBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  TextDisplayBuilder
} = require("discord.js");
const { getGuildConfig } = require("../../storage");
let _panelHelpers = null;
function panelHelpers() {
  if (!_panelHelpers) {
    _panelHelpers = require("../panel");
  }
  return _panelHelpers;
}
function inlineEmoji(client, name) {
  return panelHelpers().inlineEmoji(client, name);
}
const V2 = MessageFlags.IsComponentsV2;
const V2_EPHEMERAL = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
const COLOR_SUCCESS = 0x2ecc71;
const COLOR_DANGER = 0xe74c3c;
const COLOR_INFO = 0x3498db;
const COLOR_WARN = 0xe67e22;
function memberHasPermission(interaction, flag) {
  return Boolean(interaction.memberPermissions?.has(flag));
}
function botChannelPermission(channel, flag) {
  const me = channel.guild.members.me;
  if (!me) return false;
  return channel.permissionsFor(me)?.has(flag) ?? false;
}
function usableTextChannel(interaction) {
  const channel = interaction.channel;
  if (!channel || channel.isDMBased?.() || !channel.isTextBased?.()) return null;
  return channel;
}
async function replyDenied(interaction, content) {
  await interaction.reply({ content: `🚫 ${content}`, flags: MessageFlags.Ephemeral }).catch(() => null);
}
async function sendModerationLog(guild, embed) {
  try {
    const config = getGuildConfig(guild.id);
    const channelId = config.channels?.moderationLogs;
    if (!channelId) return;
    const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    await channel.send({ embeds: [embed] }).catch(() => null);
  } catch {
  }
}
function baseEmbed(color) {
  return new EmbedBuilder().setColor(color).setTimestamp();
}
async function cloneChannel(guild, channel) {
  const overwrites = channel.permissionOverwrites.cache.map((overwrite) => ({
    id: overwrite.id,
    allow: overwrite.allow,
    deny: overwrite.deny,
    type: overwrite.type
  }));
  const newChannel = await guild.channels.create({
    name: channel.name,
    type: channel.type,
    parent: channel.parentId,
    position: channel.position,
    topic: channel.topic,
    nsfw: channel.nsfw,
    rateLimitPerUser: channel.rateLimitPerUser,
    permissionOverwrites: overwrites
  });
  await channel.delete().catch(() => null);
  return newChannel;
}
function nukeAnnouncement(client, userId) {
  return new ContainerBuilder()
    .setAccentColor(COLOR_WARN)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## ${inlineEmoji(client, "reload")}Canal Reiniciado\nEste canal foi apagado e recriado do zero por <@${userId}>.\nTodo o histórico de mensagens anterior foi perdido.`
      )
    );
}
async function handleNukeCommand(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "nuke") return false;
  if (!interaction.inGuild()) {
    await replyDenied(interaction, "Use este comando dentro de um servidor.");
    return true;
  }
  const channel = usableTextChannel(interaction);
  if (!channel) {
    await replyDenied(interaction, "Este comando só pode ser usado em um canal de texto.");
    return true;
  }
  if (!memberHasPermission(interaction, PermissionFlagsBits.ManageChannels)) {
    await replyDenied(interaction, "Você precisa da permissão **Gerenciar Canais** para usar este comando.");
    return true;
  }
  if (!botChannelPermission(channel, PermissionFlagsBits.ManageChannels)) {
    await replyDenied(interaction, "Eu preciso da permissão **Gerenciar Canais** para recriar este canal.");
    return true;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
  let newChannel;
  try {
    newChannel = await cloneChannel(interaction.guild, channel);
  } catch (error) {
    await interaction.editReply({ content: `❌ Não foi possível recriar o canal: ${error.message}` }).catch(() => null);
    return true;
  }
  await newChannel.send({ components: [nukeAnnouncement(interaction.client, interaction.user.id)], flags: V2 }).catch(() => null);
  await interaction.editReply({ content: `${inlineEmoji(interaction.client, "reload")}Canal reiniciado com sucesso!` }).catch(() => null);
  await sendModerationLog(interaction.guild, baseEmbed(COLOR_WARN)
    .setTitle(`${inlineEmoji(interaction.client, "reload")}Canal reiniciado (nuke)`)
    .setDescription(`O canal **#${newChannel.name}** (${newChannel}) foi apagado e recriado.`)
    .addFields({ name: "Executado por", value: `<@${interaction.user.id}>\n${interaction.user.id}`, inline: true }));
  return true;
}
async function handleClearCommand(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "clear") return false;
  if (!interaction.inGuild()) {
    await replyDenied(interaction, "Use este comando dentro de um servidor.");
    return true;
  }
  const channel = usableTextChannel(interaction);
  if (!channel) {
    await replyDenied(interaction, "Este comando só pode ser usado em um canal de texto.");
    return true;
  }
  if (!memberHasPermission(interaction, PermissionFlagsBits.ManageMessages)) {
    await replyDenied(interaction, "Você precisa da permissão **Gerenciar Mensagens** para usar este comando.");
    return true;
  }
  if (!botChannelPermission(channel, PermissionFlagsBits.ManageMessages)) {
    await replyDenied(interaction, "Eu preciso da permissão **Gerenciar Mensagens** neste canal para apagar mensagens.");
    return true;
  }
  const amount = Math.min(Math.max(interaction.options.getInteger("quantidade", true), 1), 99);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
  let deleted;
  try {
    deleted = await channel.bulkDelete(amount, true);
  } catch (error) {
    await interaction.editReply({ content: `❌ Não foi possível apagar as mensagens: ${error.message}` }).catch(() => null);
    return true;
  }
  const embed = baseEmbed(COLOR_SUCCESS)
    .setTitle(`${inlineEmoji(interaction.client, "apagar")}Mensagens apagadas`)
    .setDescription(`Foram apagadas **${deleted.size}** mensagem(ns) de ${channel}.`)
    .setFooter({ text: deleted.size < amount ? "Mensagens com mais de 14 dias não podem ser apagadas em massa e foram ignoradas." : "Concluído com sucesso." });
  await interaction.editReply({ embeds: [embed] }).catch(() => null);
  return true;
}
function isChannelLocked(channel) {
  const everyoneId = channel.guild.roles.everyone.id;
  const overwrite = channel.permissionOverwrites.cache.get(everyoneId);
  return Boolean(overwrite?.deny?.has(PermissionFlagsBits.SendMessages));
}
function lockStateAnnouncement({ client, locked, userId, reason }) {
  const emojiName = locked ? "dnd" : "online";
  const title = locked ? "Canal Bloqueado" : "Canal Desbloqueado";
  const action = locked ? "bloqueado" : "desbloqueado";
  const lines = [
    `## ${inlineEmoji(client, emojiName)}${title}`,
    `Este canal foi ${action} por <@${userId}>.`,
    locked ? "Somente a equipe poderá enviar mensagens até o desbloqueio." : "Todos podem voltar a enviar mensagens normalmente."
  ];
  if (reason) lines.push(`\n**Motivo:** ${reason}`);
  return new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join("\n")));
}
async function setChannelLock(interaction, locked) {
  const commandName = locked ? "lock" : "unlock";
  if (!interaction.isChatInputCommand() || interaction.commandName !== commandName) return false;
  if (!interaction.inGuild()) {
    await replyDenied(interaction, "Use este comando dentro de um servidor.");
    return true;
  }
  const channel = usableTextChannel(interaction);
  if (!channel) {
    await replyDenied(interaction, "Este comando só pode ser usado em um canal de texto.");
    return true;
  }
  if (!memberHasPermission(interaction, PermissionFlagsBits.ManageChannels)) {
    await replyDenied(interaction, "Você precisa da permissão **Gerenciar Canais** para usar este comando.");
    return true;
  }
  if (!botChannelPermission(channel, PermissionFlagsBits.ManageRoles)) {
    await replyDenied(interaction, "Eu preciso da permissão **Gerenciar Cargos/Permissões** neste canal.");
    return true;
  }
  const currentlyLocked = isChannelLocked(channel);
  if (locked && currentlyLocked) {
    await replyDenied(interaction, "Este canal **já está bloqueado**.");
    return true;
  }
  if (!locked && !currentlyLocked) {
    await replyDenied(interaction, "Este canal **já está desbloqueado**.");
    return true;
  }
  const reason = interaction.options.getString("motivo") || null;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
  try {
    await channel.permissionOverwrites.edit(
      channel.guild.roles.everyone.id,
      locked
        ? { SendMessages: false, SendMessagesInThreads: false }
        : { SendMessages: null, SendMessagesInThreads: null },
      { reason: reason || (locked ? "Canal bloqueado via /lock" : "Canal desbloqueado via /unlock") }
    );
  } catch (error) {
    await interaction.editReply({ content: `❌ Não foi possível alterar as permissões do canal: ${error.message}` }).catch(() => null);
    return true;
  }
  await interaction.deleteReply().catch(() => null);
  await channel.send({
    components: [lockStateAnnouncement({ client: interaction.client, locked, userId: interaction.user.id, reason })],
    flags: V2
  }).catch(() => null);
  await sendModerationLog(interaction.guild, baseEmbed(locked ? COLOR_DANGER : COLOR_SUCCESS)
    .setTitle(`${inlineEmoji(interaction.client, locked ? "dnd" : "online")}Canal ${locked ? "bloqueado" : "desbloqueado"}`)
    .setDescription(`O canal ${channel} foi ${locked ? "bloqueado" : "desbloqueado"}.`)
    .addFields(
      { name: "Executado por", value: `<@${interaction.user.id}>\n${interaction.user.id}`, inline: true },
      { name: "Motivo", value: reason || "Nenhum motivo informado.", inline: true }
    ));
  return true;
}
async function handleLockCommand(interaction) {
  return setChannelLock(interaction, true);
}
async function handleUnlockCommand(interaction) {
  return setChannelLock(interaction, false);
}
async function handleBanCommand(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "ban") return false;
  if (!interaction.inGuild()) {
    await replyDenied(interaction, "Use este comando dentro de um servidor.");
    return true;
  }
  if (!memberHasPermission(interaction, PermissionFlagsBits.BanMembers)) {
    await replyDenied(interaction, "Você precisa da permissão **Banir Membros** para usar este comando.");
    return true;
  }
  const guild = interaction.guild;
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.BanMembers)) {
    await replyDenied(interaction, "Eu preciso da permissão **Banir Membros** para executar esta ação.");
    return true;
  }
  const target = interaction.options.getUser("usuario", true);
  const reason = interaction.options.getString("motivo") || "Nenhum motivo informado.";
  const deleteDays = interaction.options.getInteger("apagar_mensagens") ?? 0;
  if (target.id === interaction.user.id) {
    await replyDenied(interaction, "Você não pode banir a si mesmo.");
    return true;
  }
  if (target.id === interaction.client.user.id) {
    await replyDenied(interaction, "Eu não posso me banir.");
    return true;
  }
  const existingBan = await guild.bans.fetch(target.id).catch(() => null);
  if (existingBan) {
    await replyDenied(interaction, `<@${target.id}> já está banido deste servidor.`);
    return true;
  }
  const member = await guild.members.fetch(target.id).catch(() => null);
  if (member && !member.bannable) {
    await replyDenied(interaction, "Não posso banir esse usuário (cargo igual/maior que o meu ou permissões insuficientes).");
    return true;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
  try {
    await guild.bans.create(target.id, { reason, deleteMessageSeconds: deleteDays * 86400 });
  } catch (error) {
    await interaction.editReply({ content: `❌ Não foi possível banir o usuário: ${error.message}` }).catch(() => null);
    return true;
  }
  const embed = baseEmbed(COLOR_DANGER)
    .setTitle(`${inlineEmoji(interaction.client, "negativo")}Usuário banido`)
    .setThumbnail(target.displayAvatarURL())
    .setDescription(`${target.tag ? `**${target.tag}**` : `<@${target.id}>`} foi banido do servidor.`)
    .addFields(
      { name: "Usuário", value: `<@${target.id}>\n${target.id}`, inline: true },
      { name: "Executado por", value: `<@${interaction.user.id}>`, inline: true },
      { name: "Motivo", value: reason }
    );
  await interaction.editReply({ embeds: [embed] }).catch(() => null);
  await sendModerationLog(guild, baseEmbed(COLOR_DANGER)
    .setTitle(`${inlineEmoji(interaction.client, "negativo")}Usuário banido`)
    .addFields(
      { name: "Usuário", value: `<@${target.id}>\n${target.id}`, inline: true },
      { name: "Executado por", value: `<@${interaction.user.id}>`, inline: true },
      { name: "Motivo", value: reason }
    ));
  return true;
}
async function handleUnbanCommand(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "unban") return false;
  if (!interaction.inGuild()) {
    await replyDenied(interaction, "Use este comando dentro de um servidor.");
    return true;
  }
  if (!memberHasPermission(interaction, PermissionFlagsBits.BanMembers)) {
    await replyDenied(interaction, "Você precisa da permissão **Banir Membros** para usar este comando.");
    return true;
  }
  const guild = interaction.guild;
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.BanMembers)) {
    await replyDenied(interaction, "Eu preciso da permissão **Banir Membros** para executar esta ação.");
    return true;
  }
  const target = interaction.options.getUser("usuario", true);
  const reason = interaction.options.getString("motivo") || "Nenhum motivo informado.";
  const existingBan = await guild.bans.fetch(target.id).catch(() => null);
  if (!existingBan) {
    await replyDenied(interaction, `<@${target.id}> não está banido deste servidor.`);
    return true;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
  try {
    await guild.bans.remove(target.id, reason);
  } catch (error) {
    await interaction.editReply({ content: `❌ Não foi possível desbanir o usuário: ${error.message}` }).catch(() => null);
    return true;
  }
  const embed = baseEmbed(COLOR_SUCCESS)
    .setTitle(`${inlineEmoji(interaction.client, "positivo")}Usuário desbanido`)
    .setThumbnail(target.displayAvatarURL())
    .setDescription(`${target.tag ? `**${target.tag}**` : `<@${target.id}>`} foi desbanido e já pode voltar ao servidor.`)
    .addFields(
      { name: "Usuário", value: `<@${target.id}>\n${target.id}`, inline: true },
      { name: "Executado por", value: `<@${interaction.user.id}>`, inline: true },
      { name: "Motivo", value: reason }
    );
  await interaction.editReply({ embeds: [embed] }).catch(() => null);
  await sendModerationLog(guild, baseEmbed(COLOR_SUCCESS)
    .setTitle(`${inlineEmoji(interaction.client, "positivo")}Usuário desbanido`)
    .addFields(
      { name: "Usuário", value: `<@${target.id}>\n${target.id}`, inline: true },
      { name: "Executado por", value: `<@${interaction.user.id}>`, inline: true },
      { name: "Motivo", value: reason }
    ));
  return true;
}
async function handleModerationCommand(interaction) {
  if (!interaction.isChatInputCommand()) return false;
  if (await handleNukeCommand(interaction)) return true;
  if (await handleClearCommand(interaction)) return true;
  if (await handleLockCommand(interaction)) return true;
  if (await handleUnlockCommand(interaction)) return true;
  if (await handleBanCommand(interaction)) return true;
  if (await handleUnbanCommand(interaction)) return true;
  return false;
}
module.exports = {
  handleModerationCommand
};
