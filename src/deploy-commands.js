require("dotenv").config();
const { registerCommands } = require("./commands");
const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID, GUILD_ID } = process.env;
(async () => {
  try {
    if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) throw new Error("Configure DISCORD_TOKEN e DISCORD_CLIENT_ID no .env");
    const raw = (GUILD_ID || DISCORD_GUILD_ID || "");
    const devGuildIds = raw.split(/[,\s]+/).filter(Boolean).filter(id => /^\d{15,25}$/.test(id));
    if (devGuildIds.length) {
      console.log(`[Deploy] Registrando comandos no servidor ${devGuildIds.join(", ")} (instantâneo).`);
    } else {
      console.warn(`[Deploy] GUILD_ID não definido — registrando globalmente (pode levar 1h). Defina GUILD_ID no .env.`);
    }
    const registeredCommands = await registerCommands({
      token: DISCORD_TOKEN,
      clientId: DISCORD_CLIENT_ID,
      guildIds: devGuildIds
    });
    console.log(`Comandos registrados ${registeredCommands.scope}: ${registeredCommands.names.map((name) => `/${name}`).join(", ")}.`);
  } catch (e) {
    console.error("[Deploy] Falha:", e.message);
    process.exit(1);
  }
})();
