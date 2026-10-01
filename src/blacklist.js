const fs = require("node:fs");
const path = require("node:path");
const { DATA_DIR } = require("./config");
const BLACKLIST_PATH = path.join(DATA_DIR, "blacklist.json");
function atomicWriteFileSync(filePath, content) {
  const tmpPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmpPath, content);
  fs.renameSync(tmpPath, filePath);
}
function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(BLACKLIST_PATH)) {
    atomicWriteFileSync(BLACKLIST_PATH, JSON.stringify({ guilds: {}, users: {} }, null, 2));
  }
}
function readBlacklist() {
  ensureFile();
  try {
    const data = JSON.parse(fs.readFileSync(BLACKLIST_PATH, "utf8"));
    data.guilds ||= {};
    data.users ||= {};
    return data;
  } catch (error) {
    console.error(`[blacklist] ${BLACKLIST_PATH} esta com JSON invalido (${error.message}). Usando lista vazia.`);
    return { guilds: {}, users: {} };
  }
}
function writeBlacklist(data) {
  ensureFile();
  atomicWriteFileSync(BLACKLIST_PATH, JSON.stringify(data, null, 2));
}
function banGuild(guildId, { reason, bannedBy, guildName } = {}) {
  const data = readBlacklist();
  data.guilds[guildId] = {
    guildId,
    guildName: guildName || null,
    reason: reason || "Nao informado",
    bannedBy: bannedBy || null,
    bannedAt: Date.now()
  };
  writeBlacklist(data);
  return data.guilds[guildId];
}
function unbanGuild(guildId) {
  const data = readBlacklist();
  const existed = Boolean(data.guilds[guildId]);
  delete data.guilds[guildId];
  writeBlacklist(data);
  return existed;
}
function banUser(userId, { reason, bannedBy, sourceGuildId, tag } = {}) {
  const data = readBlacklist();
  data.users[userId] = {
    userId,
    tag: tag || null,
    reason: reason || "Nao informado",
    bannedBy: bannedBy || null,
    sourceGuildId: sourceGuildId || null,
    bannedAt: Date.now()
  };
  writeBlacklist(data);
  return data.users[userId];
}
function unbanUser(userId) {
  const data = readBlacklist();
  const existed = Boolean(data.users[userId]);
  delete data.users[userId];
  writeBlacklist(data);
  return existed;
}
function isGuildBanned(guildId) {
  return Boolean(readBlacklist().guilds[guildId]);
}
function isUserBanned(userId) {
  return Boolean(readBlacklist().users[userId]);
}
function listBannedGuilds() {
  return Object.values(readBlacklist().guilds).sort((a, b) => b.bannedAt - a.bannedAt);
}
function listBannedUsers() {
  return Object.values(readBlacklist().users).sort((a, b) => b.bannedAt - a.bannedAt);
}
module.exports = {
  banGuild,
  unbanGuild,
  banUser,
  unbanUser,
  isGuildBanned,
  isUserBanned,
  listBannedGuilds,
  listBannedUsers
};
