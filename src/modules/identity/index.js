const fs = require("node:fs");
const path = require("node:path");
const { DATA_DIR } = require("../../config");
const IDENTITY_PATH = path.join(DATA_DIR, "bot-identity.json");
function atomicWriteFileSync(filePath, content) {
  const tmpPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmpPath, content);
  fs.renameSync(tmpPath, filePath);
}
function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(IDENTITY_PATH)) {
    atomicWriteFileSync(IDENTITY_PATH, JSON.stringify({}, null, 2));
  }
}
function readIdentity() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(IDENTITY_PATH, "utf8"));
  } catch (error) {
    const backupPath = `${IDENTITY_PATH}.corrompido.${Date.now()}.bak`;
    console.error(`[identity] ${IDENTITY_PATH} esta com JSON invalido (${error.message}). Guardando copia em ${backupPath}.`);
    try {
      fs.copyFileSync(IDENTITY_PATH, backupPath);
    } catch {   }
    return {};
  }
}
function writeIdentity(data) {
  ensureStore();
  atomicWriteFileSync(IDENTITY_PATH, JSON.stringify(data, null, 2));
}
function generateBotId() {
  const timestamp = Date.now().toString();
  const random = Math.floor(Math.random() * 1e5).toString().padStart(5, "0");
  return `dex${timestamp}${random}`;
}
function ensureBotIdentity(client) {
  const data = readIdentity();
  if (!data.botId) {
    data.botId = generateBotId();
    data.createdAt = Date.now();
    data.tutorialSeenBy = [];
  }
  if (!Array.isArray(data.tutorialSeenBy)) {
    data.tutorialSeenBy = [];
  }
  data.applicationId = client?.application?.id || data.applicationId || null;
  data.lastBootAt = Date.now();
  data.bootCount = Number(data.bootCount || 0) + 1;
  writeIdentity(data);
  return data;
}
function getBotIdentity() {
  const data = readIdentity();
  if (!data.botId) {
    return ensureBotIdentity(null);
  }
  if (!Array.isArray(data.tutorialSeenBy)) {
    data.tutorialSeenBy = [];
  }
  return data;
}
function checkAndUpdateVersion(currentVersion) {
  const data = readIdentity();
  const previousVersion = data.botVersion || null;
  const changed = previousVersion !== currentVersion;
  data.botVersion = currentVersion;
  writeIdentity(data);
  return { changed, previousVersion, currentVersion };
}
function hasSeenTutorial(userId) {
  const data = readIdentity();
  return Array.isArray(data.tutorialSeenBy) && data.tutorialSeenBy.includes(userId);
}
function markTutorialSeen(userId) {
  const data = readIdentity();
  if (!Array.isArray(data.tutorialSeenBy)) {
    data.tutorialSeenBy = [];
  }
  if (!data.tutorialSeenBy.includes(userId)) {
    data.tutorialSeenBy.push(userId);
    writeIdentity(data);
  }
}
module.exports = {
  ensureBotIdentity,
  getBotIdentity,
  checkAndUpdateVersion,
  hasSeenTutorial,
  markTutorialSeen
};
