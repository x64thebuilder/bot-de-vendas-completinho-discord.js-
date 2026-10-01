const { getGuildConfig } = require("./storage");
function isHomeGuildStaff() {
  return false;
}
function botOwnerIds(guild) {
  const ids = [
    process.env.OWNER_ID,
    ...(process.env.OWNER_IDS || "").split(/[,\s]+/),
    guild?.ownerId
  ];
  if (guild?.id || guild === null || guild === undefined) {
    try {
      const config = getGuildConfig(null);
      if (config.botOwnerId) ids.push(config.botOwnerId);
    } catch {}
  }
  return Array.from(new Set(ids.map((id) => String(id || "").trim()).filter(Boolean)));
}
module.exports = {
  isHomeGuildStaff,
  botOwnerIds
};
