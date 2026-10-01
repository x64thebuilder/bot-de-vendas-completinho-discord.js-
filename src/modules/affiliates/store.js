const { readGuildFile, writeGuildFile } = require("../../guildDb");
const NAMESPACE = "affiliates";
const CONFIRM_AFTER_MS = 24 * 3600 * 1000;
function defaultStore() {
  return {
    config: { enabled: false, amountPerInvite: 0 },
    pending: {},
    paid: {},
    earnings: {}
  };
}
function getStore() {
  const data = readGuildFile(null, NAMESPACE, defaultStore);
  const fresh = defaultStore();
  const rawConfig = data.config || {};
  return {
    ...fresh,
    ...data,
    config: {
      enabled: Boolean(rawConfig.enabled),
      amountPerInvite: Number(rawConfig.amountPerInvite) || 0
    },
    pending: data.pending && typeof data.pending === "object" ? data.pending : {},
    paid: data.paid && typeof data.paid === "object" ? data.paid : {},
    earnings: data.earnings && typeof data.earnings === "object" ? data.earnings : {}
  };
}
function setStore(updater) {
  const current = getStore();
  const next = typeof updater === "function" ? updater(current) : updater;
  writeGuildFile(null, NAMESPACE, next);
  return next;
}
function getConfig() {
  return getStore().config;
}
function setConfig(patch) {
  return setStore((s) => ({ ...s, config: { ...s.config, ...patch } }));
}
function getEarnings(userId) {
  const e = getStore().earnings[String(userId)];
  return e ? { total: Number(e.total) || 0, count: Number(e.count) || 0 } : { total: 0, count: 0 };
}
function topAffiliates(limit = 10) {
  return Object.entries(getStore().earnings)
    .map(([userId, e]) => ({ userId, total: Number(e.total) || 0, count: Number(e.count) || 0 }))
    .sort((a, b) => b.total - a.total || b.count - a.count)
    .slice(0, limit);
}
module.exports = {
  CONFIRM_AFTER_MS,
  getStore,
  setStore,
  getConfig,
  setConfig,
  getEarnings,
  topAffiliates
};
