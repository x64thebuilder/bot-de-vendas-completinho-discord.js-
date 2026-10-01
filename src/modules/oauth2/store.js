const { readGuildFile, writeGuildFile } = require("../../guildDb");
const NAMESPACE = "oauth2";
function defaultStore() {
  return {
    bot: {
      token: null,
      clientId: null,
      clientSecret: null,
      confirmed: false,
      botId: null,
      botName: null,
      botAvatar: null,
      siteBotId: null
    },
    require: {
      cart: false,
      ticket: false
    },
    panel: {
      title: "Verificação de Membro",
      description: "Clique no botão abaixo e autorize com sua conta Discord para se verificar no servidor.",
      color: 0xffffff,
      banner: null,
      thumbnail: null,
      buttonLabel: "Verificar",
      buttonStyle: 2,
      buttonEmoji: null,
      channelId: null
    },
    verified: {}
  };
}
function getStore() {
  const data = readGuildFile(null, NAMESPACE, defaultStore);
  const fresh = defaultStore();
  return {
    ...fresh,
    ...data,
    bot: { ...fresh.bot, ...(data.bot || {}) },
    require: { ...fresh.require, ...(data.require || {}) },
    panel: { ...fresh.panel, ...(data.panel || {}) },
    verified: data.verified && typeof data.verified === "object" ? data.verified : {},
    recovery: {
      history: Array.isArray(data.recovery?.history) ? data.recovery.history : []
    }
  };
}
function setStore(updater) {
  const current = getStore();
  const next = typeof updater === "function" ? updater(current) : updater;
  writeGuildFile(null, NAMESPACE, next);
  return next;
}
function isBotConfigured() {
  const { bot } = getStore();
  return Boolean(bot.token && bot.clientId && bot.clientSecret && bot.confirmed);
}
function hasBotCredentials() {
  const { bot } = getStore();
  return Boolean(bot.token && bot.clientId && bot.clientSecret);
}
function isVerified(_guildId, userId) {
  if (!userId) return false;
  return Boolean(getStore().verified[String(userId)]);
}
function getVerifiedList() {
  const verified = getStore().verified;
  return Object.values(verified).sort((a, b) => (b.verifiedAt || 0) - (a.verifiedAt || 0));
}
function maskToken(token) {
  const t = String(token || "");
  if (t.length <= 10) return "••••••";
  return `${t.slice(0, 6)}••••••${t.slice(-4)}`;
}
module.exports = {
  getStore,
  setStore,
  isBotConfigured,
  hasBotCredentials,
  isVerified,
  getVerifiedList,
  maskToken
};
