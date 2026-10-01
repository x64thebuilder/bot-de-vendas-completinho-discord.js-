const { readGuildFile, writeGuildFile } = require("../../guildDb");
const NAMESPACE = "giveaways";
function defaultStore() {
  return { giveaways: {}, history: [] };
}
function getStore() {
  const data = readGuildFile(null, NAMESPACE, defaultStore);
  return {
    giveaways: data.giveaways && typeof data.giveaways === "object" ? data.giveaways : {},
    history: Array.isArray(data.history) ? data.history : []
  };
}
function setStore(updater) {
  const current = getStore();
  const next = typeof updater === "function" ? updater(current) : updater;
  writeGuildFile(null, NAMESPACE, next);
  return next;
}
function newId() {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}
function defaultGiveaway() {
  return {
    id: null,
    guildId: null,
    channelId: null,
    messageId: null,
    prize: null,
    winnersCount: 1,
    endsAt: null,
    createdBy: null,
    createdAt: Date.now(),
    requirements: { roleId: null, minAccountDays: 0, verifiedOnly: false },
    appearance: { color: null, banner: null, thumbnail: null, buttonLabel: "Participar", description: "" },
    dmMessage: "",
    prizeType: "campo",
    saldoAmount: 0,
    stockBonus: null,
    bonusSaldo: 0,
    bonusStock: null,
    participants: [],
    status: "active",
    winners: [],
    endedAt: null,
    endedBy: null,
    rerolls: 0
  };
}
function getPrizeConfig(o = {}) {
  if (o.prizeType === "saldo") {
    return { type: "saldo", amount: Number(o.saldoAmount) || 0, stock: null };
  }
  if (o.prizeType === "estoque") {
    return { type: "estoque", amount: 0, stock: o.stockBonus || null };
  }
  if (o.prizeType === "campo") {
    return { type: "campo", amount: 0, stock: null };
  }
  if (Number(o.bonusSaldo) > 0) {
    return { type: "saldo", amount: Number(o.bonusSaldo), stock: null };
  }
  if (o.bonusStock) {
    return { type: "estoque", amount: 0, stock: o.bonusStock };
  }
  return { type: "campo", amount: 0, stock: null };
}
function getGiveaway(id) {
  return getStore().giveaways[String(id)] || null;
}
function saveGiveaway(giveaway) {
  setStore((s) => ({ ...s, giveaways: { ...s.giveaways, [giveaway.id]: giveaway } }));
  return giveaway;
}
function deleteGiveaway(id) {
  setStore((s) => {
    const next = { ...s.giveaways };
    delete next[String(id)];
    return { ...s, giveaways: next };
  });
}
function listActive() {
  return Object.values(getStore().giveaways)
    .filter((g) => g && g.status === "active")
    .sort((a, b) => (a.endsAt || 0) - (b.endsAt || 0));
}
function pushHistory(entry) {
  setStore((s) => ({ ...s, history: [...s.history, entry].slice(-50) }));
}
function getHistory() {
  return [...getStore().history].reverse();
}
module.exports = {
  getStore,
  setStore,
  newId,
  defaultGiveaway,
  getPrizeConfig,
  getGiveaway,
  saveGiveaway,
  deleteGiveaway,
  listActive,
  pushHistory,
  getHistory
};
