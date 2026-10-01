const { MessageFlags, ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");
const crypto = require("node:crypto");
const { ids } = require("../../config");
const { getGuildConfig } = require("../../storage");
const { parseCustomId, panelPayload, componentEmoji, prettyPayload } = require("../panel");
const store = require("./store");
const panels = require("./panel");
const V2 = MessageFlags.IsComponentsV2;
const V2_EPHEMERAL = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
const timers = new Map(); 
const drafts = new Map(); 
const DRAFT_TTL_MS = 15 * 60 * 1000;
function blankDraft() {
  return {
    prize: "",
    winnersCount: 1,
    durationMs: 3600000,
    minAccountDays: 0,
    roleId: null,
    verifiedOnly: false,
    appearance: { color: null, banner: null, thumbnail: null, buttonLabel: "Participar", description: "" },
    dmMessage: "",
    prizeType: "campo",
    saldoAmount: 0,
    stockBonus: null,
    createdAt: Date.now()
  };
}
function getDraft(userId) {
  const d = drafts.get(String(userId));
  if (!d || Date.now() - d.createdAt > DRAFT_TTL_MS) {
    drafts.delete(String(userId));
    return null;
  }
  return d;
}
async function showEdit(interaction) {
  const draft = getDraft(interaction.user.id);
  if (!draft) {
    await safeReply(interaction, { content: "Rascunho expirado. Clique em Criar Sorteio de novo.", flags: MessageFlags.Ephemeral });
    return false;
  }
  await safeUpdate(interaction, panelPayload(panels.editPanel(interaction.client, interaction.guildId, interaction.user.id, draft)));
  return true;
}
async function sendDraft(interaction, channel) {
  const client = interaction.client;
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const draft = getDraft(userId);
  if (!draft) {
    await safeReply(interaction, { content: "Rascunho expirado. Clique em Criar Sorteio de novo.", flags: MessageFlags.Ephemeral });
    return false;
  }
  const g = {
    ...store.defaultGiveaway(),
    id: store.newId(),
    guildId,
    channelId: channel.id,
    prize: draft.prize,
    winnersCount: draft.winnersCount,
    endsAt: Date.now() + draft.durationMs,
    createdBy: userId,
    createdAt: Date.now(),
    requirements: { roleId: draft.roleId, minAccountDays: draft.minAccountDays, verifiedOnly: draft.verifiedOnly },
    appearance: { ...draft.appearance },
    dmMessage: draft.dmMessage || "",
    prizeType: draft.prizeType || "campo",
    saldoAmount: Number(draft.saldoAmount) || 0,
    stockBonus: draft.stockBonus ? { ...draft.stockBonus } : null,
    participants: [],
    status: "active"
  };
  store.saveGiveaway(g);
  try {
    const message = await channel.send({ components: [panels.publicPanel(client, guildId, g)], flags: V2 });
    g.messageId = message.id;
    store.saveGiveaway(g);
  } catch (e) {
    store.deleteGiveaway(g.id);
    await safeReply(interaction, { content: `Não consegui postar nesse canal: ${e.message}`, flags: MessageFlags.Ephemeral });
    return false;
  }
  drafts.delete(userId);
  scheduleEnd(client, g);
  await safeUpdate(interaction, panelPayload(panels.detailPanel(client, guildId, userId, g)));
  return true;
}
function rootPanel(client, guildId, userId) {
  return panels.rootPanel(client, guildId, userId);
}
async function safeUpdate(interaction, payload) {
  try {
    if (!interaction.isRepliable()) return null;
    payload = prettyPayload(interaction.client, payload);
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
    payload = prettyPayload(interaction.client, payload);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => null);
    } else {
      await interaction.reply(payload).catch(() => null);
    }
  } catch {   }
}
function pickWinners(participants, count, exclude = []) {
  const pool = participants.filter((id) => !exclude.includes(id));
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.max(1, count));
}
async function checkRequirements(client, guildId, userId, g) {
  const req = g.requirements || {};
  if (Number(req.minAccountDays) > 0) {
    const user = await client.users.fetch(userId).catch(() => null);
    const ageDays = user?.createdTimestamp ? (Date.now() - user.createdTimestamp) / 86400000 : 0;
    if (ageDays < Number(req.minAccountDays)) {
      return `Sua conta é nova demais (mínimo ${req.minAccountDays} dias).`;
    }
  }
  if (req.roleId) {
    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
    const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
    if (!member?.roles.cache.has(req.roleId)) {
      return `Você precisa do cargo <@&${req.roleId}> para participar.`;
    }
  }
  if (req.verifiedOnly) {
    try {
      const oauth2 = require("../oauth2");
      if (!oauth2.isVerified(guildId, userId)) {
        return `Você precisa estar verificado (botão Verificar) para participar.`;
      }
    } catch {
      return `Verificação indisponível no momento. Tente de novo.`;
    }
  }
  return null;
}
async function handleEncerrarCommand(interaction) {
  if (!interaction.isChatInputCommand || !interaction.isChatInputCommand()) return false;
  if (interaction.commandName !== "encerrar-sorteio") return false;
  const client = interaction.client;
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  if (!guildId) {
    await safeReply(interaction, { content: "Use este comando dentro de um servidor.", flags: MessageFlags.Ephemeral });
    return true;
  }
  const active = store.listActive();
  if (!active.length) {
    await safeReply(interaction, { content: "Nenhum sorteio ativo no momento.", flags: MessageFlags.Ephemeral });
    return true;
  }
  if (active.length === 1) {
    const g = active[0];
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      }
    } catch {   }
    const ended = await endGiveaway(client, guildId, g.id, { by: userId });
    if (!ended) {
      await safeReply(interaction, { content: "Este sorteio já foi encerrado.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await safeReply(interaction, {
      content: ended.winners?.length
        ? `Sorteio **${ended.prize}** encerrado! Ganhadores: ${ended.winners.map((id) => `<@${id}>`).join(" ")} (anunciado no canal).`
        : `Sorteio **${ended.prize}** encerrado sem participantes.`,
      flags: MessageFlags.Ephemeral
    });
    return true;
  }
  const { scoped } = require("../panel");
  await safeReply(interaction, {
    content: `Há **${active.length}** sorteios ativos. Escolha qual encerrar:`,
    flags: MessageFlags.Ephemeral,
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(scoped(ids.giveawayManage, userId))
          .setPlaceholder("Escolha o sorteio")
          .addOptions(active.slice(0, 25).map((g) => ({
            label: String(g.prize || "Sorteio").slice(0, 100),
            value: g.id,
            description: `${g.participants.length} participante(s)`.slice(0, 100),
            emoji: componentEmoji(client, "w_party")
          })))
      )
    ]
  });
  return true;
}
async function handleGiveawayInteraction(interaction) {
  const customId = String(interaction.customId || "");
  if (customId.startsWith(`${ids.giveawayJoin}:`)) {
    return handleJoin(interaction, customId.split(":").at(-1));
  }
  if (!customId.startsWith("giveaway:") && !customId.startsWith("modal:giveaway:")) return false;
  const { baseId, ownerId } = parseCustomId(customId);
  if (ownerId && ownerId !== interaction.user.id) {
    await safeReply(interaction, { content: "Este painel pertence a outra pessoa.", flags: MessageFlags.Ephemeral });
    return true;
  }
  return handleGiveawayPanelComponent(interaction, baseId);
}
async function handleGiveawayPanelComponent(interaction, baseId) {
  const client = interaction.client;
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  if (baseId === ids.giveawayEntry) {
    await safeUpdate(interaction, panelPayload(rootPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.giveawayBack) {
    await safeUpdate(interaction, panelPayload(rootPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.giveawayCreate) {
    try {
      await interaction.showModal(panels.createModal(userId));
    } catch {}
    return true;
  }
  if (baseId === ids.giveawayEdit) {
    await showEdit(interaction);
    return true;
  }
  if (baseId === ids.giveawayEditSelect) {
    const value = interaction.values?.[0];
    const draft = getDraft(userId);
    if (!draft) {
      await safeReply(interaction, { content: "Rascunho expirado. Clique em Criar Sorteio de novo.", flags: MessageFlags.Ephemeral });
      return true;
    }
    try {
      if (value === "prizeconfig") await safeUpdate(interaction, panelPayload(panels.prizePanel(client, guildId, userId, draft)));
      else if (value === "duration") await interaction.showModal(panels.durationModal(userId, draft));
      else if (value === "winners") await interaction.showModal(panels.winnersModal(userId, draft));
      else if (value === "requirements") await safeUpdate(interaction, panelPayload(panels.reqPanel(client, guildId, userId, draft)));
      else if (value === "appearance") await interaction.showModal(panels.appearanceModal(userId, draft));
      else if (value === "dm") await interaction.showModal(panels.dmModal(userId, draft));
    } catch {}
    return true;
  }
  if (baseId === ids.giveawayEditRoleSelect) {
    const draft = getDraft(userId);
    if (!draft) {
      await safeReply(interaction, { content: "Rascunho expirado.", flags: MessageFlags.Ephemeral });
      return true;
    }
    draft.roleId = interaction.values?.[0] || null;
    drafts.set(userId, draft);
    await safeUpdate(interaction, panelPayload(panels.reqPanel(client, guildId, userId, draft)));
    return true;
  }
  if (baseId === ids.giveawayEditVerified) {
    const draft = getDraft(userId);
    if (!draft) {
      await safeReply(interaction, { content: "Rascunho expirado.", flags: MessageFlags.Ephemeral });
      return true;
    }
    draft.verifiedOnly = !draft.verifiedOnly;
    drafts.set(userId, draft);
    await safeUpdate(interaction, panelPayload(panels.reqPanel(client, guildId, userId, draft)));
    return true;
  }
  if (baseId === ids.giveawayEditAge) {
    const draft = getDraft(userId);
    if (!draft) {
      await safeReply(interaction, { content: "Rascunho expirado.", flags: MessageFlags.Ephemeral });
      return true;
    }
    try {
      await interaction.showModal(panels.ageModal(userId, draft));
    } catch {}
    return true;
  }
  if (baseId === ids.giveawayEditProduct) {
    const draft = getDraft(userId);
    if (!draft) {
      await safeReply(interaction, { content: "Rascunho expirado.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const value = interaction.values?.[0];
    if (value === "__none") {
      draft.stockBonus = null;
      if (draft.prizeType === "estoque") draft.prizeType = "campo";
      drafts.set(userId, draft);
      await safeUpdate(interaction, panelPayload(panels.prizePanel(client, guildId, userId, draft)));
      return true;
    }
    const sales = require("../sales");
    const product = sales.getProduct(guildId, value);
    if (!product) {
      await safeReply(interaction, { content: "Produto não encontrado.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const fields = sales.fieldsList(product);
    if (!fields.length) {
      await safeReply(interaction, { content: "Este produto não tem campos.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await safeUpdate(interaction, panelPayload(panels.stockFieldPanel(client, guildId, userId, product, fields)));
    return true;
  }
  if (baseId.startsWith(ids.giveawayEditField)) {
    const productId = baseId.split(":").at(-1);
    const draft = getDraft(userId);
    if (!draft) {
      await safeReply(interaction, { content: "Rascunho expirado.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const fieldId = interaction.values?.[0];
    if (!fieldId) return true;
    draft.pendingStock = { productId, fieldId };
    drafts.set(userId, draft);
    try {
      await interaction.showModal(panels.stockQtyModal(userId, draft.stockBonus?.qty || 1));
    } catch {}
    return true;
  }
  if (baseId === ids.giveawayPrizeType) {
    const value = interaction.values?.[0];
    const draft = getDraft(userId);
    if (!draft) {
      await safeReply(interaction, { content: "Rascunho expirado.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (value === "saldo") {
      try {
        await interaction.showModal(panels.saldoModal(userId, draft));
      } catch {}
      return true;
    }
    if (value === "estoque") {
      const sales = require("../sales");
      const products = sales.productsList(guildId).filter((p) => p && Object.keys(p.fields || {}).length);
      if (!products.length) {
        await safeReply(interaction, { content: "Nenhum produto com campo criado no Sales. Crie primeiro.", flags: MessageFlags.Ephemeral });
        return true;
      }
      await safeUpdate(interaction, panelPayload(panels.stockProductPanel(client, guildId, userId, products)));
      return true;
    }
    if (value === "campo") {
      draft.prizeType = "campo";
      draft.saldoAmount = 0;
      draft.stockBonus = null;
      drafts.set(userId, draft);
      await safeUpdate(interaction, panelPayload(panels.prizePanel(client, guildId, userId, draft)));
      return true;
    }
    return true;
  }
  if (baseId === ids.giveawayPrizeName) {
    const draft = getDraft(userId);
    if (!draft) {
      await safeReply(interaction, { content: "Rascunho expirado.", flags: MessageFlags.Ephemeral });
      return true;
    }
    try {
      await interaction.showModal(panels.prizeModal(userId, draft));
    } catch {}
    return true;
  }
  if (baseId === ids.giveawaySend) {
    const draft = getDraft(userId);
    if (!draft) {
      await safeReply(interaction, { content: "Rascunho expirado. Clique em Criar Sorteio de novo.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await safeUpdate(interaction, panelPayload(panels.sendPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.giveawaySendChannel) {
    const channelId = interaction.values?.[0];
    const channel = channelId ? await interaction.guild?.channels.fetch(channelId).catch(() => null) : null;
    if (!channel?.isTextBased()) {
      await safeReply(interaction, { content: "Selecione um canal de texto válido.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await sendDraft(interaction, channel);
    return true;
  }
  if (baseId === ids.giveawaySendHere) {
    const channel = interaction.channel;
    if (!channel?.isTextBased()) {
      await safeReply(interaction, { content: "Canal inválido para envio.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await sendDraft(interaction, channel);
    return true;
  }
  if (baseId === ids.giveawayDraftDelete) {
    drafts.delete(userId);
    await safeUpdate(interaction, panelPayload(rootPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.giveawayManage) {
    const g = store.getGiveaway(interaction.values?.[0]);
    if (!g) {
      await safeReply(interaction, { content: "Sorteio não encontrado.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await safeUpdate(interaction, panelPayload(panels.detailPanel(client, guildId, userId, g)));
    return true;
  }
  if (baseId.startsWith(ids.giveawayEnd)) {
    const id = baseId.split(":").at(-1);
    await endGiveaway(client, guildId, id, { by: userId, refreshPanel: true });
    const g = store.getGiveaway(id);
    if (g) await safeUpdate(interaction, panelPayload(panels.detailPanel(client, guildId, userId, g)));
    return true;
  }
  if (baseId.startsWith(ids.giveawayCancel)) {
    const id = baseId.split(":").at(-1);
    await cancelGiveaway(client, guildId, id, userId);
    await safeUpdate(interaction, panelPayload(rootPanel(client, guildId, userId)));
    return true;
  }
  if (baseId.startsWith(ids.giveawayReroll)) {
    const id = baseId.split(":").at(-1);
    await rerollGiveaway(client, guildId, id, userId);
    const g = store.getGiveaway(id);
    if (g) await safeUpdate(interaction, panelPayload(panels.detailPanel(client, guildId, userId, g)));
    return true;
  }
  if (baseId === ids.giveawayHistory) {
    await safeUpdate(interaction, panelPayload(panels.historyPanel(client, guildId, userId, 0)));
    return true;
  }
  if (baseId.startsWith(ids.giveawayHistoryPage)) {
    const page = Number(baseId.split(":").at(-1)) || 0;
    await safeUpdate(interaction, panelPayload(panels.historyPanel(client, guildId, userId, page)));
    return true;
  }
  return false;
}
function parseBRLInput(raw) {
  const n = String(raw || "").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return v < 0 || !Number.isFinite(v) ? 0 : v;
}
function parseHexColor(raw) {
  const hex = String(raw || "").trim().replace("#", "");
  if (!hex) return null;
  if (!/^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(hex)) return null;
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  return Number.parseInt(full, 16);
}
async function handleGiveawayModal(interaction) {
  const { baseId, ownerId } = parseCustomId(String(interaction.customId || ""));
  const isKnown = [
    ids.giveawayCreateModal, ids.giveawayPrizeModal, ids.giveawayDurationModal,
    ids.giveawayWinnersModal, ids.giveawayAgeModal, ids.giveawayAppearanceModal,
    ids.giveawayDmModal, ids.giveawaySaldoModal, ids.giveawayStockQtyModal
  ].includes(baseId);
  if (!isKnown) return false;
  if (ownerId && ownerId !== interaction.user.id) {
    await safeReply(interaction, { content: "Este modal pertence a outra pessoa.", flags: MessageFlags.Ephemeral });
    return true;
  }
  const client = interaction.client;
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  if (baseId === ids.giveawayCreateModal) {
    const prize = interaction.fields.getTextInputValue("prize").trim().slice(0, 200);
    const winners = Math.max(1, Math.min(25, Number.parseInt(interaction.fields.getTextInputValue("winners").trim(), 10) || 0));
    const durationMs = panels.parseDuration(interaction.fields.getTextInputValue("duration"));
    let minAge = 0;
    try { minAge = Math.max(0, Number.parseInt(interaction.fields.getTextInputValue("minAge").trim(), 10) || 0); } catch { minAge = 0; }
    if (!prize) {
      await safeReply(interaction, { content: "Informe o prêmio.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (!winners) {
      await safeReply(interaction, { content: "Nº de ganhadores inválido (1 a 25).", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (!durationMs || durationMs < panels.MIN_DURATION_MS || durationMs > panels.MAX_DURATION_MS) {
      await safeReply(interaction, { content: `Duração inválida. Use de 1 minuto até 30 dias (ex: 90, 2h30m, 1d).`, flags: MessageFlags.Ephemeral });
      return true;
    }
    drafts.set(userId, { ...blankDraft(), prize, winnersCount: winners, durationMs, minAccountDays: minAge, createdAt: Date.now() });
    await showEdit(interaction);
    return true;
  }
  const draft = getDraft(userId);
  if (!draft) {
    await safeReply(interaction, { content: "Rascunho expirado. Clique em Criar Sorteio de novo.", flags: MessageFlags.Ephemeral });
    return true;
  }
  if (baseId === ids.giveawayPrizeModal) {
    const prize = interaction.fields.getTextInputValue("prize").trim().slice(0, 200);
    if (!prize) {
      await safeReply(interaction, { content: "O prêmio não pode ficar vazio.", flags: MessageFlags.Ephemeral });
      return true;
    }
    draft.prize = prize;
    drafts.set(userId, draft);
    await safeUpdate(interaction, panelPayload(panels.prizePanel(client, guildId, userId, draft)));
    return true;
  }
  if (baseId === ids.giveawayDurationModal) {
    const durationMs = panels.parseDuration(interaction.fields.getTextInputValue("duration"));
    if (!durationMs || durationMs < panels.MIN_DURATION_MS || durationMs > panels.MAX_DURATION_MS) {
      await safeReply(interaction, { content: `Duração inválida. Use de 1 minuto até 30 dias.`, flags: MessageFlags.Ephemeral });
      return true;
    }
    draft.durationMs = durationMs;
    drafts.set(userId, draft);
    await showEdit(interaction);
    return true;
  }
  if (baseId === ids.giveawayWinnersModal) {
    const winners = Math.max(1, Math.min(25, Number.parseInt(interaction.fields.getTextInputValue("winners").trim(), 10) || 0));
    if (!winners) {
      await safeReply(interaction, { content: "Nº de ganhadores inválido (1 a 25).", flags: MessageFlags.Ephemeral });
      return true;
    }
    draft.winnersCount = winners;
    drafts.set(userId, draft);
    await showEdit(interaction);
    return true;
  }
  if (baseId === ids.giveawayAgeModal) {
    let minAge = 0;
    try { minAge = Math.max(0, Math.min(3650, Number.parseInt(interaction.fields.getTextInputValue("minAge").trim(), 10) || 0)); } catch { minAge = 0; }
    draft.minAccountDays = minAge;
    drafts.set(userId, draft);
    await safeUpdate(interaction, panelPayload(panels.reqPanel(client, guildId, userId, draft)));
    return true;
  }
  if (baseId === ids.giveawayAppearanceModal) {
    const get = (id) => {
      try { return (interaction.fields.getTextInputValue(id) || "").trim(); } catch { return ""; }
    };
    const colorRaw = get("color");
    let color = null;
    if (colorRaw) {
      color = parseHexColor(colorRaw);
      if (color == null) {
        await safeReply(interaction, { content: "Cor inválida. Use #FFFFFF, #FFF ou vazio.", flags: MessageFlags.Ephemeral });
        return true;
      }
    }
    const urlRe = /^https?:\/\/.+\..+/i;
    const banner = get("banner");
    const thumbnail = get("thumbnail");
    if (banner && !urlRe.test(banner)) {
      await safeReply(interaction, { content: "URL do banner inválida. Use https://...", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (thumbnail && !urlRe.test(thumbnail)) {
      await safeReply(interaction, { content: "URL da thumbnail inválida. Use https://...", flags: MessageFlags.Ephemeral });
      return true;
    }
    const button = get("button");
    draft.appearance = {
      color,
      banner: banner || null,
      thumbnail: thumbnail || null,
      buttonLabel: (button || "Participar").slice(0, 80),
      description: get("description").slice(0, 1000)
    };
    drafts.set(userId, draft);
    await showEdit(interaction);
    return true;
  }
  if (baseId === ids.giveawayDmModal) {
    let message = "";
    try { message = (interaction.fields.getTextInputValue("message") || "").trim().slice(0, 2000); } catch { message = ""; }
    draft.dmMessage = message;
    drafts.set(userId, draft);
    await showEdit(interaction);
    return true;
  }
  if (baseId === ids.giveawaySaldoModal) {
    draft.saldoAmount = parseBRLInput(interaction.fields.getTextInputValue("amount"));
    draft.prizeType = draft.saldoAmount > 0 ? "saldo" : "campo";
    draft.stockBonus = null;
    drafts.set(userId, draft);
    await safeUpdate(interaction, panelPayload(panels.prizePanel(client, guildId, userId, draft)));
    return true;
  }
  if (baseId === ids.giveawayStockQtyModal) {
    const pending = draft.pendingStock;
    const qty = Math.max(1, Math.min(99, Number.parseInt(interaction.fields.getTextInputValue("qty").trim(), 10) || 0));
    if (!qty || !pending?.productId || !pending?.fieldId) {
      await safeReply(interaction, { content: "Quantidade inválida (1 a 99).", flags: MessageFlags.Ephemeral });
      return true;
    }
    draft.stockBonus = { productId: pending.productId, fieldId: pending.fieldId, qty };
    draft.prizeType = "estoque";
    draft.saldoAmount = 0;
    delete draft.pendingStock;
    drafts.set(userId, draft);
    await safeUpdate(interaction, panelPayload(panels.prizePanel(client, guildId, userId, draft)));
    return true;
  }
  return false;
}
async function handleJoin(interaction, giveawayId) {
  const client = interaction.client;
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  if (!guildId) {
    await safeReply(interaction, { content: "Participe dentro do servidor.", flags: MessageFlags.Ephemeral });
    return true;
  }
  const g = store.getGiveaway(giveawayId);
  if (!g || g.status !== "active") {
    await safeReply(interaction, { content: "Este sorteio já encerrou.", flags: MessageFlags.Ephemeral });
    return true;
  }
  if (Date.now() >= g.endsAt) {
    await endGiveaway(client, guildId, g.id, {});
    await safeReply(interaction, { content: "Este sorteio acabou de encerrar.", flags: MessageFlags.Ephemeral });
    return true;
  }
  if (interaction.user.bot) return true;
  if (g.participants.includes(userId)) {
    await safeReply(interaction, { content: "Você já está participando. Boa sorte!", flags: MessageFlags.Ephemeral });
    return true;
  }
  const blockReason = await checkRequirements(client, guildId, userId, g);
  if (blockReason) {
    await safeReply(interaction, { content: blockReason, flags: MessageFlags.Ephemeral });
    return true;
  }
  g.participants.push(userId);
  store.saveGiveaway(g);
  await refreshPublicPanel(client, g);
  await safeReply(interaction, { title: "Inscrição confirmada", content: `**${g.prize}**! Boa sorte!`, flags: MessageFlags.Ephemeral });
  return true;
}
async function refreshPublicPanel(client, g) {
  try {
    if (!g.channelId || !g.messageId) return;
    const channel = await client.channels.fetch(g.channelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    const message = await channel.messages.fetch(g.messageId).catch(() => null);
    if (!message) return;
    const fresh = store.getGiveaway(g.id) || g;
    if (fresh.status === "active") {
      await message.edit({ components: [panels.publicPanel(client, fresh.guildId, fresh)], flags: V2 }).catch(() => null);
    }
  } catch {}
}
function formatSaldoBRL(value) {
  return `R$ ${Number(value || 0).toFixed(2).replace(".", ",")}`;
}
function renderWinnerDm(g, winnerId) {
  const raw = String(g.dmMessage || "").trim();
  if (raw) {
    return raw.split("{ganhador}").join(`<@${winnerId}>`).split("{premio}").join(`**${g.prize}**`).slice(0, 1800);
  }
  return `🎉 Você ganhou **${g.prize}**! Fale com a equipe para resgatar.`;
}
function bonusAnnounce(g) {
  const cfg = store.getPrizeConfig(g);
  if (cfg.type === "saldo" && cfg.amount > 0) return `\nBônus: ＋ ${formatSaldoBRL(cfg.amount)} em saldo`;
  if (cfg.type === "estoque" && cfg.stock) return `\nBônus: ＋ ${cfg.stock.qty}x item do estoque`;
  return "";
}
async function awardBonuses(client, guildId, g, winners) {
  const result = { saldo: [], stock: {}, stockFailed: [], dmFailed: [] };
  if (!winners.length) return result;
  const cfg = store.getPrizeConfig(g);
  const saldoAmount = cfg.type === "saldo" ? cfg.amount : 0;
  const stockCfg = cfg.type === "estoque" ? cfg.stock : null;
  let sales = null;
  try { sales = require("../sales"); } catch { sales = null; }
  let saldoStore = null;
  try { saldoStore = require("../saldo/store"); } catch { saldoStore = null; }
  for (const winnerId of winners) {
    const bonusLines = [];
    if (saldoAmount > 0 && saldoStore) {
      try {
        await saldoStore.addBalanceAtomic(winnerId, saldoAmount, `Prêmio sorteio: ${g.prize}`, { giveawayId: g.id });
        result.saldo.push(winnerId);
        bonusLines.push(`＋ ${formatSaldoBRL(saldoAmount)} em saldo`);
      } catch (e) {
        console.error("[Giveaways] bônus saldo:", e.message);
      }
    }
    if (stockCfg && sales) {
      try {
        const res = sales.takeStock(guildId, stockCfg.productId, stockCfg.fieldId, stockCfg.qty);
        if (res.ok && res.items?.length) {
          result.stock[winnerId] = res.items;
          bonusLines.push(`＋ ${stockCfg.qty}x item do estoque`);
        } else {
          result.stockFailed.push(winnerId);
        }
      } catch {
        result.stockFailed.push(winnerId);
      }
    }
    try {
      const user = await client.users.fetch(winnerId).catch(() => null);
      if (!user) {
        result.dmFailed.push(winnerId);
        continue;
      }
      let text = renderWinnerDm(g, winnerId);
      if (bonusLines.length) text += `\n\n**Bônus:**\n${bonusLines.join("\n")}`;
      const payload = { content: text };
      const items = result.stock[winnerId];
      if (items?.length) {
        const joined = items.join("\n");
        if (joined.length > 1500) {
          payload.files = [{ attachment: Buffer.from(joined, "utf8"), name: `premio-${g.id}.txt` }];
        } else {
          payload.content += `\n\`\`\`\n${joined}\n\`\`\``;
        }
      }
      await user.send(payload).catch(() => null);
    } catch {
      result.dmFailed.push(winnerId);
    }
  }
  return result;
}
async function endGiveaway(client, guildId, giveawayId, { by = null, refreshPanel = false } = {}) {
  const g = store.getGiveaway(giveawayId);
  if (!g || g.status !== "active") return null;
  clearTimer(g.id);
  const winners = pickWinners(g.participants, g.winnersCount);
  g.status = "ended";
  g.winners = winners;
  g.endedAt = Date.now();
  g.endedBy = by;
  store.saveGiveaway(g);
  store.pushHistory({
    id: g.id,
    prize: g.prize,
    winners,
    participantsCount: g.participants.length,
    endedAt: g.endedAt,
    endedBy: by,
    cancelled: false
  });
  try {
    if (g.channelId && g.messageId) {
      const channel = await client.channels.fetch(g.channelId).catch(() => null);
      if (channel?.isTextBased()) {
        const message = await channel.messages.fetch(g.messageId).catch(() => null);
        if (message) {
          await message.edit({ components: [panels.publicEndedPanel(client, guildId, g)], flags: V2 }).catch(() => null);
        }
        if (winners.length) {
          const awarded = await awardBonuses(client, guildId, g, winners);
          await channel.send({
            content: `🎉 **SORTEIO ENCERRADO — ${g.prize}**\nGanhadores: ${winners.map((id) => `<@${id}>`).join(" ")}${bonusAnnounce(g)}` +
              (awarded.stockFailed.length ? `\n-# Sem estoque para ${awarded.stockFailed.length} ganhador(es).` : ""),
            allowedMentions: { users: winners }
          }).catch(() => null);
        } else {
          await channel.send({ content: `🎉 Sorteio **${g.prize}** encerrado sem participantes.` }).catch(() => null);
        }
      }
    }
  } catch {}
  return g;
}
async function cancelGiveaway(client, guildId, giveawayId, by) {
  const g = store.getGiveaway(giveawayId);
  if (!g) return;
  clearTimer(g.id);
  g.status = "cancelled";
  g.endedAt = Date.now();
  g.endedBy = by;
  store.saveGiveaway(g);
  store.pushHistory({
    id: g.id,
    prize: g.prize,
    winners: [],
    participantsCount: g.participants.length,
    endedAt: g.endedAt,
    endedBy: by,
    cancelled: true
  });
  try {
    if (g.channelId && g.messageId) {
      const channel = await client.channels.fetch(g.channelId).catch(() => null);
      if (channel?.isTextBased()) {
        const message = await channel.messages.fetch(g.messageId).catch(() => null);
        if (message) await message.delete().catch(() => null);
        await channel.send({ content: `❌ Sorteio **${g.prize}** cancelado pela equipe.` }).catch(() => null);
      }
    }
  } catch {}
}
async function rerollGiveaway(client, guildId, giveawayId, by) {
  const g = store.getGiveaway(giveawayId);
  if (!g || g.status !== "ended") {
    return null;
  }
  const winners = pickWinners(g.participants, g.winnersCount, g.winners);
  const finalWinners = winners.length ? winners : pickWinners(g.participants, g.winnersCount);
  g.winners = finalWinners;
  g.rerolls = (g.rerolls || 0) + 1;
  store.saveGiveaway(g);
  try {
    if (g.channelId && g.messageId) {
      const channel = await client.channels.fetch(g.channelId).catch(() => null);
      if (channel?.isTextBased()) {
        const message = await channel.messages.fetch(g.messageId).catch(() => null);
        if (message) {
          await message.edit({ components: [panels.publicEndedPanel(client, guildId, g)], flags: V2 }).catch(() => null);
        }
        if (finalWinners.length) {
          await awardBonuses(client, guildId, g, finalWinners);
          await channel.send({
            content: `🎲 **RE-SORTEIO — ${g.prize}** (pedido por <@${by}>)\nNovos ganhadores: ${finalWinners.map((id) => `<@${id}>`).join(" ")}${bonusAnnounce(g)}`,
            allowedMentions: { users: finalWinners }
          }).catch(() => null);
        }
      }
    }
  } catch {}
  return g;
}
function clearTimer(id) {
  const t = timers.get(String(id));
  if (t) clearTimeout(t);
  timers.delete(String(id));
}
function scheduleEnd(client, g) {
  clearTimer(g.id);
  const delay = (g.endsAt || 0) - Date.now();
  if (delay <= 0) {
    endGiveaway(client, g.guildId, g.id, {}).catch(() => null);
    return;
  }
  const timer = setTimeout(() => {
    timers.delete(String(g.id));
    endGiveaway(client, g.guildId, g.id, {}).catch(() => null);
  }, Math.min(delay, 2147483647));
  if (timer.unref) timer.unref();
  timers.set(String(g.id), timer);
}
function sweep(client) {
  try {
    for (const g of store.listActive()) {
      if (!timers.has(String(g.id))) {
        if ((g.endsAt || 0) <= Date.now()) {
          endGiveaway(client, g.guildId, g.id, {}).catch(() => null);
        } else {
          scheduleEnd(client, g);
        }
      }
    }
  } catch (e) {
    console.error("[Giveaways] sweep:", e.message);
  }
}
function startGiveaways(client) {
  sweep(client);
  const timer = setInterval(() => sweep(client), 60 * 1000);
  if (timer.unref) timer.unref();
  console.log("[Giveaways] Scheduler iniciado.");
  return timer;
}
module.exports = {
  rootPanel,
  handleEncerrarCommand,
  handleGiveawayInteraction,
  handleGiveawayPanelComponent,
  handleGiveawayModal,
  endGiveaway,
  cancelGiveaway,
  rerollGiveaway,
  startGiveaways
};
