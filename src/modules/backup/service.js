const { ChannelType } = require("discord.js");
const TEXT_LIKE_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildMedia].filter(
  (type) => type !== undefined
);
const VOICE_LIKE_TYPES = [ChannelType.GuildVoice, ChannelType.GuildStageVoice].filter((type) => type !== undefined);
const SUPPORTED_CHANNEL_TYPES = new Set([
  ...TEXT_LIKE_TYPES,
  ...VOICE_LIKE_TYPES,
  ChannelType.GuildCategory
]);
const EVERYONE_SENTINEL = "everyone";
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function mapOverwritesForSave(channel, guildId) {
  return channel.permissionOverwrites.cache.map((overwrite) => ({
    id: overwrite.type === 0 && overwrite.id === guildId ? EVERYONE_SENTINEL : overwrite.id,
    type: overwrite.type,
    allow: overwrite.allow.bitfield.toString(),
    deny: overwrite.deny.bitfield.toString()
  }));
}
async function collectGuildSnapshot(guild) {
  await guild.channels.fetch().catch(() => null);
  await guild.roles.fetch().catch(() => null);
  await guild.emojis.fetch().catch(() => null);
  const roles = guild.roles.cache
    .filter((role) => role.id !== guild.id && !role.managed)
    .sort((a, b) => a.position - b.position)
    .map((role) => ({
      id: role.id,
      name: role.name,
      color: role.color,
      hoist: role.hoist,
      mentionable: role.mentionable,
      permissions: role.permissions.bitfield.toString(),
      position: role.position
    }));
  const allChannels = guild.channels.cache.filter((channel) => SUPPORTED_CHANNEL_TYPES.has(channel.type));
  const categories = allChannels
    .filter((channel) => channel.type === ChannelType.GuildCategory)
    .sort((a, b) => a.position - b.position)
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      position: channel.position,
      permissionOverwrites: mapOverwritesForSave(channel, guild.id)
    }));
  const channels = allChannels
    .filter((channel) => channel.type !== ChannelType.GuildCategory)
    .sort((a, b) => a.position - b.position)
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      parentId: channel.parentId || null,
      position: channel.position,
      topic: typeof channel.topic === "string" ? channel.topic : null,
      nsfw: Boolean(channel.nsfw),
      rateLimitPerUser: channel.rateLimitPerUser || 0,
      bitrate: channel.bitrate || null,
      userLimit: channel.userLimit || null,
      permissionOverwrites: mapOverwritesForSave(channel, guild.id)
    }));
  const emojis = guild.emojis.cache.map((emoji) => ({
    id: emoji.id,
    name: emoji.name,
    animated: emoji.animated,
    url: emoji.imageURL({ extension: emoji.animated ? "gif" : "png" })
  }));
  return {
    guildId: guild.id,
    guildName: guild.name,
    guildIconUrl: guild.iconURL({ extension: "png", size: 128 }) || null,
    stats: {
      roles: roles.length,
      categories: categories.length,
      channels: channels.length,
      emojis: emojis.length
    },
    payload: { roles, categories, channels, emojis }
  };
}
function mapOverwritesForRestore(list, roleMap, guild) {
  const result = [];
  for (const overwrite of list || []) {
    if (overwrite.type === 0) {
      const newRoleId = overwrite.id === EVERYONE_SENTINEL ? guild.roles.everyone.id : roleMap.get(overwrite.id)?.id;
      if (!newRoleId) continue;
      result.push({ id: newRoleId, type: 0, allow: BigInt(overwrite.allow), deny: BigInt(overwrite.deny) });
    } else if (overwrite.type === 1) {
      if (!guild.members.cache.has(overwrite.id)) continue;
      result.push({ id: overwrite.id, type: 1, allow: BigInt(overwrite.allow), deny: BigInt(overwrite.deny) });
    }
  }
  return result;
}
async function wipeGuild(guild, onProgress) {
  await guild.channels.fetch().catch(() => null);
  await guild.roles.fetch().catch(() => null);
  await guild.emojis.fetch().catch(() => null);
  const channels = [...guild.channels.cache.values()];
  for (let i = 0; i < channels.length; i += 1) {
    await channels[i].delete().catch(() => null);
    if (onProgress && i % 3 === 0) onProgress("Apagando canais e categorias", i + 1, channels.length);
    await sleep(120);
  }
  const roles = [...guild.roles.cache.values()].filter((role) => role.id !== guild.id && !role.managed);
  for (let i = 0; i < roles.length; i += 1) {
    await roles[i].delete().catch(() => null);
    if (onProgress && i % 3 === 0) onProgress("Apagando cargos", i + 1, roles.length);
    await sleep(180);
  }
  const emojis = [...guild.emojis.cache.values()];
  for (let i = 0; i < emojis.length; i += 1) {
    await emojis[i].delete().catch(() => null);
    if (onProgress && i % 3 === 0) onProgress("Apagando emojis", i + 1, emojis.length);
    await sleep(180);
  }
}
async function restoreGuildSnapshot(guild, backup, onProgress) {
  const summary = { roles: 0, categories: 0, channels: 0, emojis: 0, failed: 0 };
  const { roles = [], categories = [], channels = [], emojis = [] } = backup.payload || {};
  const roleMap = new Map();
  for (let i = 0; i < roles.length; i += 1) {
    const role = roles[i];
    const created = await guild.roles
      .create({
        name: role.name,
        color: role.color,
        hoist: role.hoist,
        mentionable: role.mentionable,
        permissions: BigInt(role.permissions),
        reason: `Restauracao de backup ${backup.code}`
      })
      .catch(() => null);
    if (created) {
      roleMap.set(role.id, created);
      summary.roles += 1;
    } else {
      summary.failed += 1;
    }
    if (onProgress) onProgress("Recriando cargos", i + 1, roles.length);
    await sleep(250);
  }
  if (roleMap.size) {
    const positions = roles
      .filter((role) => roleMap.has(role.id))
      .map((role, index) => ({ role: roleMap.get(role.id).id, position: index + 1 }));
    await guild.roles.setPositions(positions).catch(() => null);
  }
  const categoryMap = new Map();
  for (let i = 0; i < categories.length; i += 1) {
    const category = categories[i];
    const created = await guild.channels
      .create({
        name: category.name,
        type: ChannelType.GuildCategory,
        permissionOverwrites: mapOverwritesForRestore(category.permissionOverwrites, roleMap, guild),
        reason: `Restauracao de backup ${backup.code}`
      })
      .catch(() => null);
    if (created) {
      categoryMap.set(category.id, created.id);
      summary.categories += 1;
    } else {
      summary.failed += 1;
    }
    if (onProgress) onProgress("Recriando categorias", i + 1, categories.length);
    await sleep(250);
  }
  for (let i = 0; i < channels.length; i += 1) {
    const channel = channels[i];
    const options = {
      name: channel.name,
      type: channel.type,
      parent: channel.parentId ? categoryMap.get(channel.parentId) || null : null,
      permissionOverwrites: mapOverwritesForRestore(channel.permissionOverwrites, roleMap, guild),
      reason: `Restauracao de backup ${backup.code}`
    };
    if (TEXT_LIKE_TYPES.includes(channel.type)) {
      options.topic = channel.topic || undefined;
      options.nsfw = channel.nsfw;
      options.rateLimitPerUser = channel.rateLimitPerUser || 0;
    }
    if (VOICE_LIKE_TYPES.includes(channel.type)) {
      if (channel.bitrate) options.bitrate = channel.bitrate;
      if (channel.userLimit) options.userLimit = channel.userLimit;
    }
    const created = await guild.channels.create(options).catch(() => null);
    if (created) {
      summary.channels += 1;
    } else {
      summary.failed += 1;
    }
    if (onProgress) onProgress("Recriando canais", i + 1, channels.length);
    await sleep(250);
  }
  for (let i = 0; i < emojis.length; i += 1) {
    const emoji = emojis[i];
    const created = await guild.emojis
      .create({ attachment: emoji.url, name: emoji.name, reason: `Restauracao de backup ${backup.code}` })
      .catch(() => null);
    if (created) {
      summary.emojis += 1;
    } else {
      summary.failed += 1;
    }
    if (onProgress) onProgress("Recriando emojis", i + 1, emojis.length);
    await sleep(450);
  }
  return summary;
}
module.exports = {
  collectGuildSnapshot,
  wipeGuild,
  restoreGuildSnapshot
};
