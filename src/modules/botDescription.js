const fs = require("node:fs");
const path = require("node:path");
const DESIRED_DESCRIPTION = "credits: x64";
const BANNER_FILE = path.join(__dirname, "..", "..", "assets", "painel-banner.png");
const DISCORD_API = "https://discord.com/api/v10";
async function enforceBotDescription(client) {
  try {
    if (!client.application) {
      await client.application?.fetch().catch(() => null);
    }
    let app = client.application;
    if (!app) return false;
    try {
      app = await app.fetch();
    } catch {}
    const current = (app.description ?? "").trim();
    const desired = DESIRED_DESCRIPTION.trim();
    if (current === desired) {
      return false;
    }
    console.log(`[Descricao] Detectada alteracao (atual: ${JSON.stringify(current.slice(0,80))}). Restaurando para descricao padrao...`);
    await client.application.edit({ description: DESIRED_DESCRIPTION });
    console.log("[Descricao] Descricao restaurada com sucesso.");
    return true;
  } catch (error) {
    console.error("[Descricao] Falha ao forcar descricao:", error.message);
    return false;
  }
}
function startDescriptionWatcher(client, intervalMs = 60_000) {
  const run = () => {
    enforceBotDescription(client).catch(() => null);
    enforceBotBanner(client).catch(() => null);
  };
  setTimeout(run, 5000);
  const timer = setInterval(run, intervalMs);
  if (timer.unref) timer.unref();
  console.log(`[Descricao] Watcher iniciado - verificacao a cada ${Math.round(intervalMs/1000)}s | descricao travada em: ${JSON.stringify(DESIRED_DESCRIPTION)}`);
  return timer;
}
async function enforceBotBanner(client) {
  try {
    if (!fs.existsSync(BANNER_FILE)) return false;
    const buffer = fs.readFileSync(BANNER_FILE);
    if (!buffer.length || buffer.length > 8 * 1024 * 1024) return false;
    const token = client.token || process.env.DISCORD_TOKEN;
    if (!token) return false;
    const appRes = await fetch(`${DISCORD_API}/applications/@me`, {
      headers: { Authorization: `Bot ${token}` }
    }).catch(() => null);
    if (!appRes || !appRes.ok) return false;
    const app = await appRes.json().catch(() => null);
    if (!app) return false;
    if (app.cover) {
      const ext = String(app.cover).startsWith("a_") ? "gif" : "png";
      const current = await fetch(`https://cdn.discordapp.com/app-icons/${app.id}/${app.cover}.${ext}`).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
      if (current && Buffer.from(current).equals(buffer)) return false;
    }
    console.log("[Descricao] Banner do bot diferente - aplicando assets/painel-banner.png...");
    const patch = await fetch(`${DISCORD_API}/applications/@me`, {
      method: "PATCH",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ cover_image: `data:image/png;base64,${buffer.toString("base64")}` })
    }).catch(() => null);
    if (!patch || !patch.ok) {
      console.error("[Descricao] Falha ao aplicar banner do bot.");
      return false;
    }
    console.log("[Descricao] Banner do bot aplicado com sucesso.");
    return true;
  } catch (error) {
    console.error("[Descricao] Falha ao forcar banner:", error.message);
    return false;
  }
}
module.exports = {
  DESIRED_DESCRIPTION,
  BANNER_FILE,
  enforceBotDescription,
  enforceBotBanner,
  startDescriptionWatcher,
};
