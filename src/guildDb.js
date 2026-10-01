const fs = require("node:fs");
const path = require("node:path");
const { DATA_DIR } = require("./config");
function atomicWriteFileSync(filePath, content) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmpPath, content);
  try {
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    if (err.code === "EEXIST" || err.code === "EPERM") {
      try { fs.unlinkSync(filePath); } catch {}
      fs.renameSync(tmpPath, filePath);
    } else {
      try { fs.unlinkSync(tmpPath); } catch {}
      throw err;
    }
  }
}
function filePathFor(namespace) {
  return path.join(DATA_DIR, `${namespace}.json`);
}
function guildDir(_guildId) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  return DATA_DIR;
}
function guildFilePath(_guildId, namespace) {
  return filePathFor(namespace);
}
const readCache = new Map(); 
const CACHE_TTL_MS = 1800;
function readGuildFile(_guildId, namespace, fallback) {
  const cached = readCache.get(namespace);
  if (cached && cached.expires > Date.now()) {
    try { return JSON.parse(JSON.stringify(cached.data)); } catch { return cached.data; }
  }
  const filePath = filePathFor(namespace);
  if (!fs.existsSync(filePath)) {
    const initial = typeof fallback === "function" ? fallback() : (fallback ?? {});
    atomicWriteFileSync(filePath, JSON.stringify(initial, null, 2));
    readCache.set(namespace, { data: initial, expires: Date.now() + CACHE_TTL_MS });
    return JSON.parse(JSON.stringify(initial));
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    readCache.set(namespace, { data: parsed, expires: Date.now() + CACHE_TTL_MS });
    return JSON.parse(JSON.stringify(parsed));
  } catch (error) {
    const backupPath = `${filePath}.corrompido.${Date.now()}.bak`;
    console.error(`[guildDb] ${filePath} esta com JSON invalido (${error.message}). Guardando copia em ${backupPath} e usando valores padrao.`);
    try {
      fs.copyFileSync(filePath, backupPath);
    } catch (copyError) {
      console.error(`[guildDb] Nao foi possivel fazer backup do arquivo corrompido:`, copyError.message);
    }
    const fb = typeof fallback === "function" ? fallback() : (fallback ?? {});
    readCache.set(namespace, { data: fb, expires: Date.now() + CACHE_TTL_MS });
    return JSON.parse(JSON.stringify(fb));
  }
}
function invalidateCache(namespace){
  if (namespace) readCache.delete(namespace);
  else readCache.clear();
}
const writeQueues = new Map();
function queuedWrite(filePath, content) {
  const prev = writeQueues.get(filePath) || Promise.resolve();
  const next = prev.then(() => {
    atomicWriteFileSync(filePath, content);
    try { const ns = path.basename(filePath, ".json"); invalidateCache(ns); } catch {}
  }).catch((e) => { console.error(`[guildDb] queuedWrite falhou ${filePath}:`, e.message); });
  writeQueues.set(filePath, next);
  next.finally(() => { if (writeQueues.get(filePath) === next) writeQueues.delete(filePath); });
  return next;
}
function writeGuildFile(_guildId, namespace, data) {
  atomicWriteFileSync(filePathFor(namespace), JSON.stringify(data, null, 2));
  invalidateCache(namespace);
}
function writeGuildFileAsync(_guildId, namespace, data) {
  return queuedWrite(filePathFor(namespace), JSON.stringify(data, null, 2));
}
function updateGuildFile(_guildId, namespace, updater, fallback) {
  const filePath = filePathFor(namespace);
  const prev = writeQueues.get(filePath) || Promise.resolve();
  const next = prev.then(() => {
    invalidateCache(namespace);
    const current = readGuildFile(_guildId, namespace, fallback);
    const updated = typeof updater === "function" ? updater(JSON.parse(JSON.stringify(current))) : updater;
    atomicWriteFileSync(filePath, JSON.stringify(updated, null, 2));
    invalidateCache(namespace);
    return JSON.parse(JSON.stringify(updated));
  }).catch((e) => { console.error(`[guildDb] updateGuildFile falhou ${filePath}:`, e.message); throw e; });
  writeQueues.set(filePath, next);
  next.finally(() => { if (writeQueues.get(filePath) === next) writeQueues.delete(filePath); });
  return next;
}
function readFile(namespace, fallback) {
  return readGuildFile(null, namespace, fallback);
}
function writeFile(namespace, data) {
  return writeGuildFile(null, namespace, data);
}
function listGuildIds() {
  return [];
}
const ROUTING_INDEX_DIR = path.join(DATA_DIR, "_routing");
function routingIndexPath(namespace) {
  if (!fs.existsSync(ROUTING_INDEX_DIR)) fs.mkdirSync(ROUTING_INDEX_DIR, { recursive: true });
  return path.join(ROUTING_INDEX_DIR, `${namespace}.json`);
}
function readRoutingIndex(namespace) {
  const filePath = routingIndexPath(namespace);
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(`[guildDb] Indice de roteamento ${filePath} invalido (${error.message}). Recriando vazio.`);
    return {};
  }
}
function writeRoutingIndex(namespace, map) {
  atomicWriteFileSync(routingIndexPath(namespace), JSON.stringify(map, null, 2));
}
function getRoutedGuildId(_namespace, _id) {
  return readRoutingIndex(_namespace)[_id] || null;
}
function setRoutedGuildId(namespace, id, guildId) {
  const idx = readRoutingIndex(namespace);
  idx[id] = guildId;
  writeRoutingIndex(namespace, idx);
}
function deleteRoutedGuildId(namespace, id) {
  const idx = readRoutingIndex(namespace);
  delete idx[id];
  writeRoutingIndex(namespace, idx);
}
module.exports = {
  guildDir,
  guildFilePath,
  readGuildFile,
  writeGuildFile,
  writeGuildFileAsync,
  updateGuildFile,
  readFile,
  writeFile,
  listGuildIds,
  getRoutedGuildId,
  setRoutedGuildId,
  deleteRoutedGuildId,
  atomicWriteFileSync,
};
