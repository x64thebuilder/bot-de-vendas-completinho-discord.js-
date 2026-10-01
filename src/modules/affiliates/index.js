const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const { ids } = require("../../config");
const { getGuildConfig } = require("../../storage");
const { parseCustomId, panelPayload, inlineEmoji } = require("../panel");
const { CONFIRM_AFTER_MS, getStore, setStore, getConfig, setConfig } = require("./store");
const panels = require("./panel");
const V2 = MessageFlags.IsComponentsV2;
const V2_EPHEMERAL = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
function rootPanel(client, guildId, userId) {
  return panels.rootPanel(client, guildId, userId);
}
async function safeUpdate(interaction, payload) {
  try {
    if (!interaction.isRepliable()) return null;
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ ...payload, flags: V2_EPHEMERAL }).catch(() => null);
    } else {
      await interaction.update(payload).catch(() => null);
    }
  } catch { return null; }
}
async function safeReply(interaction, payload) {
  try {
    if (!interaction.isRepliable()) return;
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => null);
    } else {
      await interaction.reply(payload).catch(() => null);
    }
  } catch {   }
}
async function onJoin(member, join) {
  try {
    const cfg = getConfig();
    if (!cfg.enabled) return;
    if (!join || !join.valid || !join.inviterId) return;
    if (String(join.inviterId) === String(member.id)) return;
    if (Number(cfg.amountPerInvite) <= 0) return;
    const store = getStore();
    if (store.paid[member.id]) return; 
    if (store.pending[member.id]) return;
    setStore((s) => ({
      ...s,
      pending: { ...s.pending, [member.id]: { inviterId: join.inviterId, joinedAt: Date.now() } }
    }));
  } catch (e) {
    console.error("[Affiliates] onJoin:", e.message);
  }
}
async function onLeave(member) {
  try {
    const store = getStore();
    const pending = store.pending[member.id];
    if (!pending) return;
    setStore((s) => {
      const next = { ...s.pending };
      delete next[member.id];
      return { ...s, pending: next };
    });
    await sendAffLog(member.guild, {
      title: "Comissão cancelada",
      description: `<@${pending.inviterId}> perdeu a comissão: <@${member.id}> saiu antes de 24h.`,
      color: 0xf1c40f
    });
  } catch (e) {
    console.error("[Affiliates] onLeave:", e.message);
  }
}
async function sweep(client) {
  try {
    const cfg = getConfig();
    if (!cfg.enabled) return;
    const store = getStore();
    const ids = Object.keys(store.pending);
    if (!ids.length) return;
    const guildId = defaultGuildId();
    if (!guildId) return;
    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return;
    for (const inviteeId of ids.slice(0, 20)) {
      const pending = getStore().pending[inviteeId];
      if (!pending) continue;
      if (Date.now() - pending.joinedAt < CONFIRM_AFTER_MS) continue;
      const member = await guild.members.fetch(inviteeId).catch(() => null);
      if (!member) {
        setStore((s) => {
          const next = { ...s.pending };
          delete next[inviteeId];
          return { ...s, pending: next };
        });
        continue;
      }
      const amount = Math.round(Number(cfg.amountPerInvite) * 100) / 100;
      try {
        const saldoStore = require("../saldo/store");
        await saldoStore.addBalanceAtomic(pending.inviterId, amount, `Comissão afiliado: convite de ${inviteeId}`, { affiliate: true });
      } catch (e) {
        console.error("[Affiliates] crédito:", e.message);
        continue;
      }
      setStore((s) => {
        const next = { ...s.pending };
        delete next[inviteeId];
        const prev = s.earnings[pending.inviterId] || { total: 0, count: 0 };
        return {
          ...s,
          pending: next,
          paid: { ...s.paid, [inviteeId]: { inviterId: pending.inviterId, paidAt: Date.now(), amount } },
          earnings: { ...s.earnings, [pending.inviterId]: { total: Math.round((Number(prev.total) + amount) * 100) / 100, count: Number(prev.count) + 1 } }
        };
      });
      await sendAffLog(guild, {
        title: "Comissão paga",
        description: `<@${pending.inviterId}> ganhou **R$ ${amount.toFixed(2).replace(".", ",")}** — <@${inviteeId}> completou 24h no servidor.`,
        color: 0x2ecc71
      });
    }
  } catch (e) {
    console.error("[Affiliates] sweep:", e.message);
  }
}
function defaultGuildId() {
  const raw = (process.env.GUILD_ID || process.env.DISCORD_GUILD_ID || "").trim();
  const match = raw.match(/\d{15,25}/);
  return match ? match[0] : null;
}
async function sendAffLog(guild, { title, description, color }) {
  try {
    const { EmbedBuilder } = require("discord.js");
    const channelId = getGuildConfig(guild.id).channels?.inviteLogs;
    if (!channelId) return;
    const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    await channel.send({
      embeds: [new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp()]
    }).catch(() => null);
  } catch {   }
}
function startAffiliates(client) {
  sweep(client).catch(() => null);
  const timer = setInterval(() => sweep(client).catch(() => null), 60 * 1000);
  if (timer.unref) timer.unref();
  console.log("[Affiliates] Scheduler iniciado.");
  return timer;
}
function parseBRLInput(raw) {
  const n = String(raw || "").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return v < 0 || !Number.isFinite(v) ? 0 : v;
}
async function handleAffPanelComponent(interaction, baseId) {
  const client = interaction.client;
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  if (baseId === ids.affToggle) {
    const cfg = getConfig();
    setConfig({ enabled: !cfg.enabled });
    await safeUpdate(interaction, panelPayload(rootPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.affAmount) {
    try {
      await interaction.showModal(panels.amountModal(userId, getConfig().amountPerInvite));
    } catch {   }
    return true;
  }
  return false;
}
async function handleAffModal(interaction) {
  const { baseId, ownerId } = parseCustomId(String(interaction.customId || ""));
  if (baseId !== ids.affAmountModal) return false;
  if (ownerId && ownerId !== interaction.user.id) {
    await safeReply(interaction, { content: "Este modal pertence a outra pessoa.", flags: MessageFlags.Ephemeral });
    return true;
  }
  const client = interaction.client;
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  if (baseId === ids.affAmountModal) {
    setConfig({ amountPerInvite: parseBRLInput(interaction.fields.getTextInputValue("amount")) });
    await safeUpdate(interaction, panelPayload(rootPanel(client, guildId, userId)));
    return true;
  }
  return false;
}
module.exports = {
  rootPanel,
  onJoin,
  onLeave,
  sweep,
  startAffiliates,
  handleAffPanelComponent,
  handleAffModal
};
