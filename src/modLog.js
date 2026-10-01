async function sendModLog(client, embed) {
  const channelId = process.env.MOD_LOG_CHANNEL_ID;
  if (!channelId) return false;
  try {
    const channel = client.channels.cache.get(channelId)
      || await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased?.()) return false;
    await channel.send({ embeds: [embed] });
    return true;
  } catch (error) {
    console.warn("[ModLog] Falha ao enviar log:", error.message);
    return false;
  }
}
module.exports = { sendModLog };
