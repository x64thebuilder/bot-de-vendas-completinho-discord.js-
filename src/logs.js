const { ContainerBuilder, MessageFlags, SectionBuilder, SeparatorBuilder, TextDisplayBuilder, ThumbnailBuilder, Events } = require("discord.js");
const { getGuildConfig } = require("./storage");
const colors = {
  general: 0x3498db,
  create: 0x2ecc71,
  update: 0xf1c40f,
  delete: 0xe74c3c,
  message: 0xffffff
};
function setupLogs(client) {
  client.on(Events.GuildMemberAdd, async (member) => {
    const config = getGuildConfig(member.guild.id);
    if (config.roles.autoRole) {
      const role = member.guild.roles.cache.get(config.roles.autoRole);
      if (role) {
        await member.roles.add(role).catch(() => null);
      }
    }
    await sendLog(member.guild, "generalLogs", {
      title: "Membro entrou",
      color: colors.general,
      description: `${member} entrou no servidor.`,
      fields: [
        { name: "Usuario", value: `${member.user.tag}\n${member.id}`, inline: true },
        { name: "Conta criada", value: time(member.user.createdTimestamp), inline: true }
      ],
      thumbnail: member.user.displayAvatarURL()
    });
  });
  client.on(Events.GuildMemberRemove, async (member) => {
    await sendLog(member.guild, "generalLogs", {
      title: "Membro saiu",
      color: colors.delete,
      description: `${member.user.tag} saiu do servidor.`,
      fields: [
        { name: "Usuario", value: `${member.user.tag}\n${member.id}`, inline: true },
        { name: "Entrou em", value: member.joinedTimestamp ? time(member.joinedTimestamp) : "Desconhecido", inline: true }
      ],
      thumbnail: member.user.displayAvatarURL()
    });
  });
  client.on(Events.ChannelCreate, async (channel) => {
    if (!channel.guild) return;
    await sendLog(channel.guild, "moderationLogs", {
      title: "Canal criado",
      color: colors.create,
      description: `${channel} foi criado.`,
      fields: channelFields(channel)
    });
  });
  client.on(Events.ChannelDelete, async (channel) => {
    if (!channel.guild) return;
    await sendLog(channel.guild, "moderationLogs", {
      title: "Canal apagado",
      color: colors.delete,
      description: `O canal **${channel.name}** foi apagado.`,
      fields: channelFields(channel)
    });
  });
  client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
    if (!newChannel.guild) return;
    const changes = diffChannel(oldChannel, newChannel);
    if (!changes.length) return;
    await sendLog(newChannel.guild, "moderationLogs", {
      title: "Canal editado",
      color: colors.update,
      description: `${newChannel} foi atualizado.`,
      fields: changes
    });
  });
  function redactSensitive(text) {
    let out = String(text || "");
    out = out.replace(/000201[\dA-Z\s.]{20,}6304[0-9A-F]{4}/gi, "[PIX REDACTED]");
    if (out.length > 500 && /[0-9A-F]{80,}/i.test(out)) out = out.slice(0, 200) + "... [CONTEUDO LONGO REDACTED]";
    return out;
  }
  client.on(Events.MessageDelete, async (message) => {
    if (!message.guild || message.author?.bot) return;
    await sendLog(message.guild, "messageLogs", {
      title: "Mensagem apagada",
      color: colors.delete,
      description: `Uma mensagem foi apagada em ${message.channel}.`,
      fields: [
        { name: "Autor", value: message.author ? `${message.author.tag}\n${message.author.id}` : "Desconhecido", inline: true },
        { name: "Canal", value: `${message.channel}`, inline: true },
        { name: "Conteudo", value: truncate(redactSensitive(message.content || "Sem conteudo de texto."), 1000) }
      ],
      thumbnail: message.author?.displayAvatarURL()
    });
  });
  client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
    if (!newMessage.guild || newMessage.author?.bot) return;
    if (oldMessage.content === newMessage.content) return;
    await sendLog(newMessage.guild, "messageLogs", {
      title: "Mensagem editada",
      color: colors.message,
      description: `Uma mensagem foi editada em ${newMessage.channel}.`,
      fields: [
        { name: "Autor", value: `${newMessage.author.tag}\n${newMessage.author.id}`, inline: true },
        { name: "Canal", value: `${newMessage.channel}`, inline: true },
        { name: "Antes", value: truncate(redactSensitive(oldMessage.content || "Sem conteudo anterior."), 900) },
        { name: "Depois", value: truncate(redactSensitive(newMessage.content || "Sem conteudo novo."), 900) }
      ],
      thumbnail: newMessage.author.displayAvatarURL()
    });
  });
}
function wIcon(client, name) {
  try {
    const found = client.appEmojis?.get(name);
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
const LOG_ICONS = { generalLogs: "w_users", moderationLogs: "w_shield", messageLogs: "w_eye" };
async function sendLog(guild, channelKey, data) {
  const config = getGuildConfig(guild.id);
  const channelId = config.channels[channelKey];
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const ts = Math.floor(Date.now() / 1000);
  const icon = wIcon(guild.client, LOG_ICONS[channelKey] || "w_bulb");
  const panel = new ContainerBuilder().setAccentColor(data.color);
  try {
    if (data.thumbnail) {
      const section = new SectionBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## ${icon}${data.title}`),
        new TextDisplayBuilder().setContent(data.description)
      );
      section.setThumbnailAccessory(new ThumbnailBuilder().setURL(data.thumbnail).setDescription(data.title));
      panel.addSectionComponents(section);
    } else {
      panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${icon}${data.title}\n${data.description}`));
    }
  } catch {
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${icon}${data.title}\n${data.description}`));
  }
  if (data.fields?.length) {
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(compactLines(data.fields)));
  }
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${guild.name} • <t:${ts}:R>`));
  await channel.send({ components: [panel], flags: MessageFlags.IsComponentsV2 }).catch(() => null);
}
function channelFields(channel) {
  return [
    { name: "Nome", value: channel.name || "Desconhecido", inline: true },
    { name: "ID", value: channel.id, inline: true },
    { name: "Tipo", value: String(channel.type), inline: true },
    { name: "Categoria", value: channel.parent?.name || "Nenhuma", inline: true }
  ];
}
function diffChannel(oldChannel, newChannel) {
  const fields = [];
  pushDiff(fields, "Nome", oldChannel.name, newChannel.name);
  pushDiff(fields, "Topico", oldChannel.topic, newChannel.topic);
  pushDiff(fields, "Categoria", oldChannel.parent?.name, newChannel.parent?.name);
  pushDiff(fields, "NSFW", oldChannel.nsfw, newChannel.nsfw);
  pushDiff(fields, "Slowmode", oldChannel.rateLimitPerUser, newChannel.rateLimitPerUser);
  return fields;
}
function pushDiff(fields, name, before, after) {
  if (before === after) return;
  fields.push({
    name,
    value: `Antes: **${before ?? "Nenhum"}**\nDepois: **${after ?? "Nenhum"}**`
  });
}
function truncate(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}
function time(timestamp) {
  return `<t:${Math.floor(timestamp / 1000)}:F>`;
}
module.exports = {
  setupLogs
};
