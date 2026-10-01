const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { BACKUPS_DIR } = require("../../config");
const { readGuildFile, writeGuildFile } = require("../../guildDb");
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_GROUPS = 3;
const CODE_GROUP_SIZE = 4;
const MAX_INDEX_ENTRIES = 200;
function ensureBackupsDir() {
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }
}
function backupFilePath(code) {
  return path.join(BACKUPS_DIR, `${code}.json`);
}
function atomicWrite(filePath, content) {
  const dir = path.dirname(filePath);
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmpPath, content);
  try { fs.renameSync(tmpPath, filePath); } catch (err) {
    if (err.code === "EEXIST" || err.code === "EPERM") { try { fs.unlinkSync(filePath); } catch {} fs.renameSync(tmpPath, filePath); }
    else { try { fs.unlinkSync(tmpPath); } catch {} throw err; }
  }
}
function randomCode() {
  const groups = [];
  for (let g = 0; g < CODE_GROUPS; g += 1) {
    let group = "";
    for (let i = 0; i < CODE_GROUP_SIZE; i += 1) {
      const index = crypto.randomInt(CODE_ALPHABET.length);
      group += CODE_ALPHABET[index];
    }
    groups.push(group);
  }
  return groups.join("-");
}
function generateBackupCode() {
  ensureBackupsDir();
  let code = randomCode();
  let attempts = 0;
  while (fs.existsSync(backupFilePath(code)) && attempts < 20) {
    code = randomCode();
    attempts += 1;
  }
  return code;
}
function saveBackup(backup) {
  ensureBackupsDir();
  atomicWrite(backupFilePath(backup.code), JSON.stringify(backup, null, 2));
  const index = readGuildFile(backup.guildId, "backups", () => []);
  const list = Array.isArray(index) ? index : [];
  list.unshift({
    code: backup.code,
    guildId: backup.guildId,
    guildName: backup.guildName,
    createdBy: backup.createdBy,
    createdByTag: backup.createdByTag,
    createdAt: backup.createdAt,
    stats: backup.stats
  });
  writeGuildFile(backup.guildId, "backups", list.slice(0, MAX_INDEX_ENTRIES));
  return backup;
}
function getBackup(code) {
  const filePath = backupFilePath(String(code || "").trim().toUpperCase());
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(`[Backup] Arquivo de backup corrompido (${filePath}):`, error.message);
    return null;
  }
}
function listGuildBackups(guildId) {
  const index = readGuildFile(guildId, "backups", () => []);
  return Array.isArray(index) ? index : [];
}
module.exports = {
  generateBackupCode,
  saveBackup,
  getBackup,
  listGuildBackups
};
