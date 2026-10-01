const fs = require("node:fs/promises");
const path = require("node:path");
const { EMOJIS_DIR } = require("./config");
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const DEFAULT_UPLOAD_CONCURRENCY = 5;
function normalizeEmojiName(fileName) {
  return path
    .parse(fileName)
    .name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase()
    .slice(0, 32);
}
async function syncApplicationEmojis(client) {
  await client.application.fetch();
  const files = await fs.readdir(EMOJIS_DIR).catch(() => []);
  const emojiFiles = files.filter((file) => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()));
  if (!emojiFiles.length) {
    console.log("[Emojis] Nenhum arquivo encontrado para sincronizar.");
    return new Map();
  }
  const existing = await client.application.emojis.fetch();
  const byName = new Map(existing.map((emoji) => [normalizeEmojiName(emoji.name), emoji]));
  const missing = emojiFiles
    .map((file) => ({
      file,
      name: normalizeEmojiName(file),
      attachment: path.join(EMOJIS_DIR, file)
    }))
    .filter((emojiFile) => emojiFile.name && !byName.has(emojiFile.name));
  if (!missing.length) {
    console.log(`[Emojis] Todos os ${emojiFiles.length} emojis ja estao enviados.`);
    return byName;
  }
  const concurrency = getUploadConcurrency();
  console.log(`[Emojis] Enviando ${missing.length} emoji(s) com ate ${concurrency} upload(s) ao mesmo tempo.`);
  await runPool(missing, concurrency, async ({ file, name, attachment }) => {
    try {
      const emoji = await client.application.emojis.create({
        name,
        attachment
      });
      byName.set(name, emoji);
      console.log(`[Emojis] Enviado: ${name}`);
    } catch (error) {
      console.warn(`[Emojis] Nao foi possivel enviar ${file}: ${error.message}`);
    }
  });
  return byName;
}
async function runPool(items, limit, worker) {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      await worker(item);
    }
  });
  await Promise.all(workers);
}
function getUploadConcurrency() {
  const value = Number(process.env.EMOJI_UPLOAD_CONCURRENCY || DEFAULT_UPLOAD_CONCURRENCY);
  if (!Number.isInteger(value) || value < 1) return DEFAULT_UPLOAD_CONCURRENCY;
  return Math.min(value, 10);
}
function emoji(client, name, fallback = "") {
  const normalized = normalizeEmojiName(name);
  const found = client.appEmojis?.get(normalized);
  return found ? found.toString() : fallback;
}
module.exports = {
  syncApplicationEmojis,
  emoji,
  normalizeEmojiName,
  getUploadConcurrency
};
