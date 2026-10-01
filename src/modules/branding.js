const fs = require("node:fs");
const path = require("node:path");
const { DATA_DIR, ASSETS_DIR } = require("../config");
const { getBotIdentity } = require("./identity");
const AVATAR_FILE = path.join(ASSETS_DIR, "sync-avatar.png");
const FLAG_FILE = path.join(DATA_DIR, "branding.json");
const FRESH_WINDOW_MS = 3600 * 1000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
function flagMode() {
  return String(process.env.SYNC_BRANDING || "").trim().toLowerCase();
}
function readFlag() {
  try {
    return JSON.parse(fs.readFileSync(FLAG_FILE, "utf8"));
  } catch {
    return null;
  }
}
function writeFlag(data) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FLAG_FILE, JSON.stringify({ ...data, at: Date.now() }, null, 2));
  } catch (error) {
    console.error("[Branding] Não consegui gravar o flag:", error.message);
  }
}
async function applyFirstBootBranding(client) {
  const force = flagMode();
  if (["0", "false", "off", "no"].includes(force)) {
    console.log("[Branding] Desativado via SYNC_BRANDING=0.");
    return;
  }
  const existing = readFlag();
  if (existing?.appliedAt && !["1", "true", "on", "yes"].includes(force)) {
    return; 
  }
  let identity = {};
  try {
    identity = getBotIdentity() || {};
  } catch {
    identity = {};
  }
  const isFresh = !identity.createdAt || (Date.now() - Number(identity.createdAt) < FRESH_WINDOW_MS);
  if (!isFresh && !["1", "true", "on", "yes"].includes(force)) {
    writeFlag({ appliedAt: null, skipped: "existing" });
    console.log("[Branding] Bot já existente — avatar e nome mantidos como estão.");
    return;
  }
  if (!fs.existsSync(AVATAR_FILE)) {
    console.warn("[Branding] Arquivo assets/sync-avatar.png não encontrado — pulei a marca inicial. Coloque o arquivo e reinicie.");
    return; 
  }
  let buffer;
  try {
    buffer = fs.readFileSync(AVATAR_FILE);
  } catch (error) {
    console.warn("[Branding] Não consegui ler o avatar:", error.message);
    return;
  }
  if (buffer.length > MAX_FILE_BYTES) {
    console.warn("[Branding] Avatar maior que 8MB — comprima e tente de novo.");
    return;
  }
  try {
    await client.user.setAvatar(buffer);
    console.log("[Branding] Avatar do bot aplicado (Sync).");
  } catch (error) {
    console.warn("[Branding] Não consegui trocar o avatar do bot:", error.message);
  }
  try {
    if (client.application?.edit) {
      await client.application.edit({ icon: buffer });
      console.log("[Branding] Ícone da aplicação aplicado (Sync).");
    }
  } catch (error) {
    console.warn("[Branding] Não consegui trocar o ícone da aplicação:", error.message);
  }
  writeFlag({ appliedAt: Date.now(), forced: ["1", "true", "on", "yes"].includes(force) });
}
module.exports = {
  applyFirstBootBranding,
  AVATAR_FILE
};
