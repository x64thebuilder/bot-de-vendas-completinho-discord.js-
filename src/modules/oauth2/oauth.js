const { getStore } = require("./store");
const DISCORD_API = "https://discord.com/api/v10";
function getSiteUrl() {
  const raw = (process.env.OAUTH2_SITE_URL || "").trim().replace(/\/+$/, "");
  return raw || null;
}
function getVerifyCallbackUrl() {
  const base = getSiteUrl();
  return base ? `${base}/verify/callback` : null;
}
function getSiteBotId() {
  return getStore().bot?.siteBotId || null;
}
function buildAuthorizeUrl(guildId, userId) {
  const base = getSiteUrl();
  const siteBotId = getSiteBotId();
  if (!base || !siteBotId) return null;
  const params = new URLSearchParams({
    bot: siteBotId,
    guild: String(guildId),
    user: String(userId)
  });
  return `${base}/verify?${params.toString()}`;
}
function slugify(raw, fallback) {
  const s = String(raw || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return s || fallback;
}
async function validateBotToken(token) {
  const res = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bot ${token}` }
  });
  if (!res.ok) throw new Error("Token invalido — confira e tente de novo.");
  return res.json();
}
async function registerSiteBot({ name, clientId, clientSecret, botToken }) {
  const base = getSiteUrl();
  const secret = process.env.DASHBOARD_API_SECRET || "";
  if (!base) {
    throw new Error("Configure OAUTH2_SITE_URL no .env apontando para o site (ex: https://seu-app.shardweb.app).");
  }
  if (!secret) {
    throw new Error("Configure DASHBOARD_API_SECRET no .env (igual ao do site).");
  }
  const id = slugify(name, "authbot");
  const payload = {
    id,
    name: String(name || id).slice(0, 80),
    clientId,
    clientSecret,
    botToken
  };
  let res;
  try {
    res = await fetch(`${base}/internal/bots`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    throw new Error(`Não consegui falar com o site (${base}): ${e.message}`);
  }
  if (res.status === 401) {
    throw new Error("O site recusou o registro (401) — DASHBOARD_API_SECRET não bate com o do site.");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`O site recusou o registro (HTTP ${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return { id: data?.bot?.id || id, bot: data?.bot || null };
}
function avatarUrl(id, hash, size = 256) {
  if (!hash) return null;
  const ext = String(hash).startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${id}/${hash}.${ext}?size=${size}`;
}
function bannerUrl(id, hash, size = 512) {
  if (!hash) return null;
  const ext = String(hash).startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/banners/${id}/${hash}.${ext}?size=${size}`;
}
async function isAuthBotInGuild(guildId) {
  const { bot } = getStore();
  if (!bot.token) throw new Error("Bot auth sem token.");
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}`, {
    headers: { Authorization: `Bot ${bot.token}` }
  });
  if (res.status === 401) throw new Error("Token do bot auth inválido.");
  return res.ok;
}
function buildBotInviteUrl(guildId) {
  const { bot } = getStore();
  if (!bot.clientId) return null;
  const params = new URLSearchParams({
    client_id: bot.clientId,
    permissions: "8",
    scope: "bot applications.commands",
    guild_id: String(guildId),
    disable_guild_select: "true"
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}
async function refreshAccessToken(refreshToken) {
  const { bot } = getStore();
  if (!bot.clientId || !bot.clientSecret) throw new Error("Bot auth sem credenciais.");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: bot.clientId,
    client_secret: bot.clientSecret
  });
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!res.ok) throw new Error(`Refresh recusado (HTTP ${res.status}).`);
  return res.json();
}
async function addGuildMember(guildId, userId, accessToken) {
  const { bot } = getStore();
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${userId}`, {
    method: "PUT",
    headers: { Authorization: `Bot ${bot.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: accessToken })
  });
  if (res.status === 201) return "added";
  if (res.status === 204) return "already";
  if (res.status === 429) {
    const data = await res.json().catch(() => ({}));
    const err = new Error("Rate limited.");
    err.retryAfterMs = Math.ceil(Number(data.retry_after || 5) * 1000);
    throw err;
  }
  if (res.status === 403) throw new Error("Sem permissão (bot precisa estar no servidor).");
  if (res.status === 404) throw new Error("Servidor ou usuário não encontrado.");
  throw new Error(`Discord recusou (HTTP ${res.status}).`);
}
module.exports = {
  getSiteUrl,
  getVerifyCallbackUrl,
  getSiteBotId,
  buildAuthorizeUrl,
  validateBotToken,
  registerSiteBot,
  avatarUrl,
  bannerUrl,
  isAuthBotInGuild,
  buildBotInviteUrl,
  refreshAccessToken,
  addGuildMember
};
