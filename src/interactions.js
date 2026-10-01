const {
  ModalBuilder,
  MessageFlags,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  ChannelType
} = require("discord.js");
const { ids, SALES_LOG_KEYS } = require("./config");
const { getGuildConfig, setGuildConfig, isStoreOpen } = require("./storage");
const { isGuildBanned, isUserBanned } = require("./blacklist");
const { handleBlacklistButton } = require("./modules/blacklist");
const { getRestrictionLevel, reportViolation, requestRestoration, handleViolationButton } = require("./violations");
const {
  parseCustomId,
  panelPayload,
  replyPanelPayload,
  mainPanel,
  mainPanelPayload,
  startPanelAutoRefresh,
  stopPanelAutoRefresh,
  tutorialPanelPayload,
  earningsPanel,
  settingsPanel,
  channelsPanel,
  channelPickerPanel,
  rolesPanel,
  rolePickerPanel,
  paymentProviderPanel,
  pixPanel,
  mercadoPagoPanel,
  efiBankPanel,
  stripePanel,
  customizeProfileModal,
  customizePanel,
  storeHoursPanel,
  storeHoursModal,
  systemsPanel,
  middlemanAdminPanel,
  middlemanAppearancePanel,
  middlemanManagePanel,
  middlemanFeesPanel,
  middlemanModePanel,
  middlemanSendChannelPanel,
  automationsRootPanel,
  autoMessagesRootPanel,
  repostRootPanel,
  inlineEmoji,
  prettyPayload
} = require("./panel");
const {
  handleAutomationComponent,
  handleAutomationModal
} = require("./modules/automations");
const {
  publicMiddlemanPanel,
  handleMiddlemanInteraction,
  handleMiddlemanModal
} = require("./middleman");
const { handleProfileCommand } = require("./modules/profile");
const {
  handleSalesInteraction,
  handleSalesPanelComponent,
  handleSalesModal
} = require("./sales");
const {
  handleTicketInteraction,
  handleTicketPanelComponent,
  handleTicketModal
} = require("./tickets");
const {
  handlePermsCommand,
  handlePermsInteraction,
  handlePermsModal,
  hasBotPermission
} = require("./perms");
const { handleStatsCommand } = require("./stats");
const { handleInviteCommand } = require("./invites");
const { handleModerationCommand } = require("./modules/moderation");
const { hasSeenTutorial, markTutorialSeen } = require("./modules/identity");
const { handleSuggestionsInteraction, suggestionConfigPanel } = require("./modules/suggestions");
const {
  handleProductRequestCommand,
  handleProductRequestInteraction,
  productRequestConfigPanel
} = require("./modules/productRequest");
const {
  handleBackupCommand,
  handleBackupInteraction,
  handleBackupModal
} = require("./modules/backup");
const saldo = require("./modules/saldo");
const oauth2 = require("./modules/oauth2");
const giveaways = require("./modules/giveaways");
const affiliates = require("./modules/affiliates");
const qrcodeMod = require("./modules/qrcode");
const restrictionCooldowns = new Map();
const RESTRICTION_COOLDOWN_MS = { 1: 2000, 2: 4000 };
const userCooldowns = new Map();
const USER_COOLDOWN_MS = 800;
async function safeReply(interaction, payload) {
  try {
    if (!interaction.isRepliable()) return;
    payload = prettyPayload(interaction.client, payload);
    if (interaction.replied || interaction.deferred) return await interaction.followUp(payload).catch(() => null);
    return await interaction.reply(payload).catch(() => null);
  } catch { return null; }
}
async function safeUpdate(interaction, payload) {
  try {
    if (!interaction.isRepliable()) return;
    payload = prettyPayload(interaction.client, payload);
    if (interaction.replied || interaction.deferred) return await interaction.followUp(payload).catch(() => null);
    return await interaction.update(payload).catch(() => null);
  } catch { return null; }
}
async function safeShowModal(interaction, modal) {
  try {
    if (interaction.replied || interaction.deferred) return;
    return await interaction.showModal(modal).catch(() => null);
  } catch { return null; }
}
function isPublicCustomId(customId) {
  return customId.startsWith("sales:") || customId.startsWith("ticket:") || customId.startsWith("mm:") || customId.startsWith("vorkbux:") || customId.startsWith("saldo:") || customId.startsWith("painelsaldo:") || customId.startsWith("oauth2:") || customId.startsWith("giveaway:");
}
function checkGuildRestriction(interaction) {
  if (!interaction.guildId) return null;
  const level = getRestrictionLevel(interaction.guildId);
  if (level === 0) return null;
  const cooldownMs = RESTRICTION_COOLDOWN_MS[level];
  const lastUse = restrictionCooldowns.get(interaction.guildId) || 0;
  const now = Date.now();
  if (now - lastUse < cooldownMs) {
    const secondsLeft = Math.ceil((cooldownMs - (now - lastUse)) / 1000);
    return `Este servidor esta com rate limit por violacoes de regras. Tente novamente em ${secondsLeft}s.`;
  }
  restrictionCooldowns.set(interaction.guildId, now);
  return null;
}
function thankYouEmbed() {
  return new EmbedBuilder()
    .setColor(0x3498db)
    .setDescription("ðŸ’™ **Obrigado por usar o nosso bot!**");
}
const PRETTIED = Symbol("prettied");
function prettifyInteraction(interaction) {
  if (!interaction || interaction[PRETTIED]) return interaction;
  for (const method of ["reply", "followUp", "update", "editReply"]) {
    const original = interaction[method];
    if (typeof original !== "function") continue;
    interaction[method] = function (payload, ...rest) {
      return original.call(this, prettyPayload(this.client, payload, { ephemeralDefault: false }), ...rest);
    };
  }
  Object.defineProperty(interaction, PRETTIED, { value: true, configurable: true });
  return interaction;
}
async function handleInteraction(interaction) {
  prettifyInteraction(interaction);
  if (interaction.guildId && isGuildBanned(interaction.guildId)) {
    if (interaction.isRepliable()) {
      await interaction.reply({ content: "Este servidor foi banido de usar este bot.", flags: MessageFlags.Ephemeral }).catch(() => null);
    }
    await interaction.guild?.leave().catch(() => null);
    return;
  }
  if (interaction.user && isUserBanned(interaction.user.id)) {
    if (interaction.isRepliable()) {
      await interaction.reply({ content: "Voce foi banido de usar este bot.", flags: MessageFlags.Ephemeral }).catch(() => null);
    }
    return;
  }
  if (await handleViolationButton(interaction)) return;
  if (await handleBlacklistButton(interaction)) return;
  if (await handlePermsCommand(interaction)) return;
  if (await handleStatsCommand(interaction)) return;
  if (await handleInviteCommand(interaction)) return;
  if (await handleModerationCommand(interaction)) return;
  if (await handleProductRequestCommand(interaction)) return;
  if (await handleBackupCommand(interaction)) return;
  if (await giveaways.handleEncerrarCommand(interaction)) return;
  if (await qrcodeMod.handleQrcodeCommand(interaction)) return;
  if (await handleProfileCommand(interaction)) return;
  if (await handleCalcularCommand(interaction)) return;
  if (await saldo.handleSaldoCommand(interaction)) return;
  if (await saldo.handlePainelSaldoCommand(interaction)) return;
  const vorkbuxEnt = require("./modules/vorkbux");
  if (await vorkbuxEnt.handleEntregue(interaction)) return;
  if (interaction.isChatInputCommand() && interaction.commandName === "panel") {
    if (!interaction.inGuild() || !interaction.guildId) {
      await safeReply(interaction, { content: "Use o /panel dentro de um servidor.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (!canUsePanel(interaction)) {
      await safeReply(interaction, { content: "Voce nao tem permissao para usar este painel.", flags: MessageFlags.Ephemeral });
      return;
    }
    const config = getGuildConfig(interaction.guildId);
    let justClaimedOwnership = false;
    if (!config.botOwnerId && interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      setGuildConfig(interaction.guildId, (current) => {
        if (!current.botOwnerId) current.botOwnerId = interaction.user.id;
        return current;
      });
      justClaimedOwnership = true;
    }
    if (!hasSeenTutorial(interaction.user.id)) {
      await interaction.reply(tutorialPanelPayload(interaction.client, interaction.user.id));
      if (justClaimedOwnership) {
        await interaction.followUp({ embeds: [thankYouEmbed()], flags: MessageFlags.Ephemeral }).catch(() => null);
      }
      return;
    }
    await interaction.reply(mainPanelPayload(interaction.client, interaction.guildId, interaction.user.id, interaction.user, true));
    startPanelAutoRefresh(interaction, interaction.client, interaction.guildId, interaction.user.id, interaction.user);
    if (justClaimedOwnership) {
      await interaction.followUp({ embeds: [thankYouEmbed()], flags: MessageFlags.Ephemeral }).catch(() => null);
    }
    return;
  }
  if (interaction.isButton() || interaction.isAnySelectMenu()) {
    if (interaction.isButton() && String(interaction.customId || "").startsWith("sales:copydelivered:")) {
      const sales = require("./sales");
      if (await sales.handleSalesInteraction(interaction)) return;
    }
    if (!interaction.inGuild() || !interaction.guildId) {
      await safeReply(interaction, { content: "Use este painel dentro de um servidor.", flags: MessageFlags.Ephemeral });
      return;
    }
    const now = Date.now();
    const last = userCooldowns.get(interaction.user.id) || 0;
    if (now - last < USER_COOLDOWN_MS) {
      await safeReply(interaction, { content: `Calma! Aguarde ${Math.ceil((USER_COOLDOWN_MS - (now - last))/1000)}s entre aÃ§Ãµes.`, flags: MessageFlags.Ephemeral });
      return;
    }
    userCooldowns.set(interaction.user.id, now);
    setTimeout(() => { if (userCooldowns.get(interaction.user.id) === now) userCooldowns.delete(interaction.user.id); }, USER_COOLDOWN_MS);
    if (interaction.message) stopPanelAutoRefresh(interaction.message.id);
    const restrictionMessage = checkGuildRestriction(interaction);
    if (restrictionMessage) {
      await safeReply(interaction, { content: restrictionMessage, flags: MessageFlags.Ephemeral });
      return;
    }
    if (interaction.isAnySelectMenu() && (!interaction.values || interaction.values.length === 0)) {
      await safeReply(interaction, { content: "SeleÃ§Ã£o invÃ¡lida. Tente novamente.", flags: MessageFlags.Ephemeral });
      return;
    }
    const _customId = String(interaction.customId || "");
    const isPublicPanel = isPublicCustomId(_customId);
    if (!isPublicPanel) {
      const parsedEarly = parseCustomId(_customId);
      if (parsedEarly.ownerId && parsedEarly.ownerId !== interaction.user.id) {
        await safeReply(interaction, { content: "Este painel pertence a outra pessoa.", flags: MessageFlags.Ephemeral });
        return;
      }
      if (_customId.startsWith("panel:") && !canUsePanel(interaction)) {
        await safeReply(interaction, { content: "Voce perdeu a permissÃ£o para usar este painel.", flags: MessageFlags.Ephemeral });
        return;
      }
    }
    if (await handleSuggestionsInteraction(interaction)) return;
    if (await handleProductRequestInteraction(interaction)) return;
    if (await handleBackupInteraction(interaction)) return;
    if (await handlePermsInteraction(interaction)) return;
    if (await handleTicketInteraction(interaction)) return;
    if (await handleSalesInteraction(interaction)) return;
    if (await handleMiddlemanInteraction(interaction)) return;
    if (await saldo.handleSaldoInteraction(interaction)) return;
    const vorkbux = require("./modules/vorkbux");
    if (await vorkbux.handleVorkbuxPublic(interaction)) return;
    if (await vorkbux.handleVorkbuxSelect(interaction)) return;
    if (await vorkbux.handleVorkbuxButton(interaction)) return;
    if (await vorkbux.handleVorkbuxPanelComponent(interaction, parseCustomId(interaction.customId).baseId)) return;
    const partnership = require("./modules/partnerships");
    if (await partnership.handlePartnershipPanelComponent(interaction, parseCustomId(interaction.customId).baseId)) return;
    if (await affiliates.handleAffPanelComponent(interaction, parseCustomId(interaction.customId).baseId)) return;
    if (await oauth2.handleOAuth2Interaction(interaction)) return;
    if (await giveaways.handleGiveawayInteraction(interaction)) return;
    if (interaction.customId.startsWith("vorkbux:open:max")) {
      await interaction.showModal(new (require("discord.js").ModalBuilder)().setCustomId(`${ids.vorkbuxMaxModal}:${interaction.user.id}`).setTitle("MÃ¡ximo de Robux").addComponents(new (require("discord.js").ActionRowBuilder)().addComponents(new (require("discord.js").TextInputBuilder)().setCustomId("max").setLabel("MÃ¡ximo de Robux").setStyle(require("discord.js").TextInputStyle.Short).setRequired(true).setValue(String(getGuildConfig(interaction.guildId).vorkbux.maxRobux)))));
      return;
    }
    const parsed = parseCustomId(interaction.customId);
    if (parsed.ownerId && parsed.ownerId !== interaction.user.id) {
      await safeReply(interaction, { content: "Este painel pertence a outra pessoa.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (parsed.baseId === ids.panelTutorialContinue) {
      markTutorialSeen(interaction.user.id);
      await interaction.update(mainPanelPayload(interaction.client, interaction.guildId, interaction.user.id, interaction.user, false));
      startPanelAutoRefresh(interaction, interaction.client, interaction.guildId, interaction.user.id, interaction.user);
      return;
    }
    if (parsed.baseId === "panel:automation") {
      await interaction.update(panelPayload(automationsRootPanel(interaction.client, interaction.guildId, interaction.user.id)));
      return;
    }
    if (parsed.baseId === "panel:auto:auto:root") {
      await interaction.update(panelPayload(autoMessagesRootPanel(interaction.client, interaction.guildId, interaction.user.id)));
      return;
    }
    if (parsed.baseId === "panel:auto:repost:root") {
      await interaction.update(panelPayload(repostRootPanel(interaction.client, interaction.guildId, interaction.user.id)));
      return;
    }
    await handlePanelComponent(interaction, parsed.baseId);
    return;
  }
  if (interaction.isModalSubmit()) {
    if (!interaction.inGuild() || !interaction.guildId) {
      await safeReply(interaction, { content: "Use dentro de um servidor.", flags: MessageFlags.Ephemeral });
      return;
    }
    const earlyParsed = parseCustomId(interaction.customId);
    if (earlyParsed.ownerId && earlyParsed.ownerId !== interaction.user.id) {
      const isPublicModal = interaction.customId.startsWith("sales:") || interaction.customId.startsWith("ticket:") || interaction.customId.startsWith("mmmodal:");
      if (!isPublicModal) {
        await safeReply(interaction, { content: "Este modal pertence a outra pessoa.", flags: MessageFlags.Ephemeral });
        return;
      }
    }
    if (await handleProductRequestInteraction(interaction)) return;
    if (await handleBackupModal(interaction)) return;
    if (await handlePermsModal(interaction)) return;
    if (await handleTicketModal(interaction)) return;
    if (await handleSalesModal(interaction)) return;
    if (await handleMiddlemanModal(interaction)) return;
    if (await saldo.handleSaldoModal(interaction)) return;
    const vorkbuxM = require("./modules/vorkbux");
    if (await vorkbuxM.handleVorkbuxModal(interaction)) return;
    if (await vorkbuxM.handleVorkbuxModalQty(interaction)) return;
    const partnershipM = require("./modules/partnerships");
    if (await partnershipM.handlePartnershipModal(interaction)) return;
    if (await oauth2.handleOAuth2Modal(interaction)) return;
    if (await giveaways.handleGiveawayModal(interaction)) return;
    if (await affiliates.handleAffModal(interaction)) return;
    const parsed = parseCustomId(interaction.customId);
    if (parsed.ownerId && parsed.ownerId !== interaction.user.id) {
      await safeReply(interaction, { content: "Este modal pertence a outra pessoa.", flags: MessageFlags.Ephemeral });
      return;
    }
    await handleModal(interaction, parsed.baseId);
  }
}
async function handleCalcularCommand(interaction){
  if(!interaction.isChatInputCommand() || interaction.commandName!=="calcular") return false;
  const qty = interaction.options.getInteger("quantidade");
  const guildId = interaction.guildId;
  const cfg = getGuildConfig(guildId);
  const pricePer1000 = Number(cfg.vorkbux?.pricePer1000 || 0);
  if(!pricePer1000){
    await interaction.reply({ content: "⚠️ Preço por 1000 Robux não configurado em `/panel` → SyncBuxx → Produtos → Configurar preço.", flags: MessageFlags.Ephemeral });
    return true;
  }
  const totalCom = Math.round((qty/1000)*pricePer1000*100)/100;
  const totalSem = Math.round(totalCom*0.7*100)/100;
  const giftTotal = Math.round(totalCom*0.85*100)/100;
  const gamepassCom = Math.ceil(qty/0.7);
  const gamepassSem = qty;
  const botAvatar = interaction.client.user.displayAvatarURL({extension:"png", size:128}) || null;
  const botName = interaction.client.user.username || "SyncBuxx";
  const guild = interaction.client.guilds.cache.get(guildId);
  const accent = cfg.customColor || 0x1a1d23;
  const container = new (require("discord.js").ContainerBuilder)().setAccentColor(accent);
  try{
    const header = new (require("discord.js").SectionBuilder)()
      .addTextDisplayComponents(
        new (require("discord.js").TextDisplayBuilder)().setContent(`## ${inlineEmoji(interaction.client,"robux")} SyncBuxx • Cálculo Premium`),
        new (require("discord.js").TextDisplayBuilder)().setContent(`Bot: **${botName}** • Guild: **${guild?.name||"Servidor"}**`),
        new (require("discord.js").TextDisplayBuilder)().setContent(`-# ${inlineEmoji(interaction.client,"casa")} Use `/panel` → SyncBuxx para configurar preço/1000`)
      );
    if(botAvatar) header.setThumbnailAccessory(new (require("discord.js").ThumbnailBuilder)().setURL(botAvatar).setDescription(botName));
    container.addSectionComponents(header);
  } catch{
    container.addTextDisplayComponents(new (require("discord.js").TextDisplayBuilder)().setContent(`## ${inlineEmoji(interaction.client,"robux")} SyncBuxx — ${qty} Robux`));
  }
  container.addSeparatorComponents(new (require("discord.js").SeparatorBuilder)().setDivider(true).setSpacing(1));
  container.addTextDisplayComponents(new (require("discord.js").TextDisplayBuilder)().setContent(`### ${inlineEmoji(interaction.client,"sparkles")} ${qty} Robux — Detalhes`));
  container.addSeparatorComponents(new (require("discord.js").SeparatorBuilder)().setDivider(false).setSpacing(1));
  const line1 = `${inlineEmoji(interaction.client,"robux")} **${qty} Robux (Taxados)** • ${inlineEmoji(interaction.client,"pricep")} **R\$ ${totalCom.toFixed(2).replace(".",",")}**`;
  const line2 = `${inlineEmoji(interaction.client,"caixa")} **Colocar na Gamepass:** (${gamepassCom}) • ${inlineEmoji(interaction.client,"pix")} Taxa 30% incluída`;
  const line3 = `${inlineEmoji(interaction.client,"gift")} **Preço em (Gift.):** **R\$ ${giftTotal.toFixed(2).replace(".",",")}** • ${inlineEmoji(interaction.client,"users")} Grupo • Recebe **${qty}**`;
  const line4 = `${inlineEmoji(interaction.client,"negativo")} **Sem taxa:** **R\$ ${totalSem.toFixed(2).replace(".",",")}** • Gamepass **${gamepassSem}** → Recebe **${Math.floor(qty*0.7)}**`;
  container.addTextDisplayComponents(new (require("discord.js").TextDisplayBuilder)().setContent([line1, line2, line3, line4].join("\n")));
  container.addSeparatorComponents(new (require("discord.js").SeparatorBuilder)().setDivider(false).setSpacing(1));
  container.addTextDisplayComponents(new (require("discord.js").TextDisplayBuilder)().setContent(`-# ${inlineEmoji(interaction.client,"lightbulb")} **Base:** R\$ ${pricePer1000.toFixed(2).replace(".",",")}/1000 • <t:${Math.floor(Date.now()/1000)}:R> • SyncBuxx Premium`));
  await interaction.reply({ components:[container], flags: require("discord.js").MessageFlags.IsComponentsV2 });
  return true;
}
function canUsePanel(interaction) {
  if (!interaction.inGuild()) return false;
  if (hasBotPermission(interaction)) return true;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  const config = getGuildConfig(interaction.guildId);
  return Boolean(config.roles.admin && interaction.member.roles.cache.has(config.roles.admin));
}
async function handlePanelComponent(interaction, baseId) {
  const client = interaction.client;
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  if (baseId === ids.panelMainSelect || baseId === ids.panelControlSelect) {
    const v = interaction.values?.[0];
    if (v === "sales") {
      if (await handleSalesPanelComponent(interaction, ids.panelSales)) return;
    }
    if (v === "customize") {
      await interaction.update(panelPayload(customizePanel(client, guildId, userId)));
      return;
    }
    if (v === "tickets") {
      if (await handleTicketPanelComponent(interaction, ids.panelTickets)) return;
    }
    if (v === "automation") {
      await interaction.update(panelPayload(automationsRootPanel(client, guildId, userId)));
      return;
    }
    if (v === "settings") {
      await interaction.update(panelPayload(settingsPanel(client, guildId, userId)));
      return;
    }
    if (v === "systems") {
      await interaction.update(panelPayload(systemsPanel(client, guildId, userId)));
      return;
    }
    if (v === "storehours") {
      await interaction.update(panelPayload(storeHoursPanel(client, guildId, userId)));
      return;
    }
    if (v === "vorkbux") {
      const { vorkbuxMainPanel } = require("./modules/vorkbux/panel");
      await interaction.update(panelPayload(vorkbuxMainPanel(client, guildId, userId)));
      return;
    }
    return;
  }
  if (baseId === ids.panelStoreHoursToggle) {
    setGuildConfig(guildId, (c) => { c.storeHours.enabled = !c.storeHours.enabled; return c; });
    await interaction.update(panelPayload(storeHoursPanel(client, guildId, userId)));
    return;
  }
  if (baseId === ids.panelStoreHoursConfig) {
    await safeShowModal(interaction, storeHoursModal(userId, getGuildConfig(guildId).storeHours));
    return;
  }
  if (baseId === ids.panelControlClose) {
    const cfg = getGuildConfig(guildId);
    const next = !cfg.storeClosed;
    setGuildConfig(guildId, (c) => {
      c.storeClosed = next;
      c.sales.closed = next;
      return c;
    });
    await interaction.update(mainPanelPayload(client, guildId, userId, interaction.user, false));
    return;
  }
  if (baseId === ids.panelControlNotifs) {
    return;
  }
  if (await handleSalesPanelComponent(interaction, baseId)) return;
  if (await handleTicketPanelComponent(interaction, baseId)) return;
  if (await handleAutomationComponent(interaction, baseId)) return;
  if (baseId === ids.panelSettings) {
    await interaction.update(panelPayload(settingsPanel(client, guildId, userId)));
    return;
  }
  if (baseId === ids.moderationRestoreRequest) {
    const result = await requestRestoration(client, guildId, userId);
    if (result.reason === "already_used") {
      await interaction.reply({ content: "Este servidor ja usou seu unico pedido de restauracao. Nao e possivel pedir novamente.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (result.reason === "already_requested") {
      await interaction.reply({ content: "Ja existe um pedido de restauracao aguardando resposta do dono do bot.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (result.reason === "no_violations") {
      await interaction.update(panelPayload(settingsPanel(client, guildId, userId)));
      return;
    }
    await interaction.update(panelPayload(settingsPanel(client, guildId, userId)));
    await interaction.followUp({
      content: result.dmSent
        ? "Pedido de restauracao enviado ao dono do bot (este era seu unico pedido disponivel). Aguarde a resposta."
        : "Nao foi possivel enviar o pedido ao dono do bot (PV fechado). Este era seu unico pedido disponivel.",
      flags: MessageFlags.Ephemeral
    }).catch(() => null);
    return;
  }
  if (baseId === ids.panelCustomize) {
    await interaction.update(panelPayload(customizePanel(client, guildId, userId)));
    return;
  }
  if (baseId === ids.panelSystems) {
    await interaction.update(panelPayload(systemsPanel(client, guildId, userId)));
    return;
  }
  if (baseId === ids.panelStats) {
    await interaction.update(panelPayload(earningsPanel(client, guildId, userId)));
    return;
  }
  if (baseId === ids.suggestionsConfig) {
    await interaction.update(panelPayload(suggestionConfigPanel(client, guildId, userId)));
    return;
  }
  if (baseId === ids.suggestionsToggle) {
    setGuildConfig(guildId, (config) => {
      config.suggestions.enabled = !config.suggestions.enabled;
      return config;
    });
    await interaction.update(panelPayload(suggestionConfigPanel(client, guildId, userId)));
    return;
  }
  if (baseId === ids.suggestionsAutoThreadToggle) {
    setGuildConfig(guildId, (config) => {
      config.suggestions.autoThread = config.suggestions.autoThread === false;
      return config;
    });
    await interaction.update(panelPayload(suggestionConfigPanel(client, guildId, userId)));
    return;
  }
  if (baseId === ids.productRequestConfig) {
    await interaction.update(panelPayload(productRequestConfigPanel(client, guildId, userId)));
    return;
  }
  if (baseId === ids.panelBackMain) {
    await interaction.update(mainPanelPayload(client, guildId, userId, interaction.user, false));
    startPanelAutoRefresh(interaction, client, guildId, userId, interaction.user);
    return;
  }
  if (baseId === ids.panelBackSettings) {
    await interaction.update(panelPayload(settingsPanel(client, guildId, userId)));
    return;
  }
  if (baseId === ids.panelBackCustomize) {
    await interaction.update(panelPayload(customizePanel(client, guildId, userId)));
    return;
  }
  if (baseId === "panel:mm:back") {
    await interaction.update(panelPayload(middlemanAdminPanel(client, guildId, userId)));
    return;
  }
  if (baseId === ids.settingsSelect) {
    const selected = interaction.values[0];
    const next = selected === "channels"
      ? channelsPanel(client, guildId, userId)
      : selected === "suggestions"
        ? suggestionConfigPanel(client, guildId, userId)
        : selected === "productrequest"
          ? productRequestConfigPanel(client, guildId, userId)
          : rolesPanel(client, guildId, userId);
    await interaction.update(panelPayload(next));
    return;
  }
  if (baseId === ids.channelsSelect) {
    await interaction.update(panelPayload(channelPickerPanel(client, guildId, userId, interaction.values[0])));
    return;
  }
  if (baseId.startsWith("panel:channelpicker:")) {
    const target = baseId.replace("panel:channelpicker:", "");
    const channelId = interaction.values[0];
    if (isMiddlemanConfigTarget(target) && !getGuildConfig(guildId).middleman.enabled) {
      await interaction.reply({ content: "Ative o sistema de Middleman antes de configurar canais dele.", flags: MessageFlags.Ephemeral });
      return;
    }
    setGuildConfig(guildId, (config) => {
      if (target === "sales:all") {
        for (const key of SALES_LOG_KEYS) config.sales.channels[key] = channelId;
      } else if (target.startsWith("sales:")) {
        config.sales.channels[target.replace("sales:", "")] = channelId;
      } else if (target.startsWith("tickets:")) {
        config.tickets.channels[target.replace("tickets:", "")] = channelId;
      } else if (target === "vouchChannel" || target === "bigVouchChannel") {
        config.middleman[target] = channelId;
      } else if (target === "suggestions") {
        config.suggestions.channelId = channelId;
        config.suggestions.enabled = true;
      } else {
        config.channels[target] = channelId;
      }
      return config;
    });
    await interaction.update(panelPayload(settingsPanel(client, guildId, userId)));
    return;
  }
  if (baseId === ids.rolesSelect) {
    await interaction.update(panelPayload(rolePickerPanel(client, guildId, userId, interaction.values[0])));
    return;
  }
  if (baseId === ids.channelsCreateLogs) {
    await handleCreateLogChannels(interaction);
    return;
  }
  if (baseId === ids.rolesCreate) {
    await handleCreateRoles(interaction);
    return;
  }
  if (baseId.startsWith("panel:rolepicker:")) {
    const target = baseId.replace("panel:rolepicker:", "");
    const roleId = interaction.values[0];
    if (isMiddlemanConfigTarget(target) && !getGuildConfig(guildId).middleman.enabled) {
      await interaction.reply({ content: "Ative o sistema de Middleman antes de configurar cargos dele.", flags: MessageFlags.Ephemeral });
      return;
    }
    setGuildConfig(guildId, (config) => {
      if (target.startsWith("sales:")) {
        config.sales.roles[target.replace("sales:", "")] = roleId;
      } else if (target.startsWith("tickets:")) {
        config.tickets.roles[target.replace("tickets:", "")] = roleId;
      } else {
        config.roles[target] = roleId;
      }
      return config;
    });
    await interaction.update(panelPayload(settingsPanel(client, guildId, userId)));
    return;
  }
  if (baseId === ids.paymentOpen) {
    const payload = paymentProviderPanel(client, guildId, userId);
    if (interaction.message?.flags?.has?.(MessageFlags.IsComponentsV2)) {
      await interaction.reply({ ...payload, flags: (payload.flags || 0) | MessageFlags.Ephemeral });
    } else {
      await interaction.update(payload);
    }
    return;
  }
  if (baseId === ids.paymentClose) {
    await interaction.update({ content: "Painel de pagamentos fechado.", embeds: [], components: [] });
    return;
  }
  if (baseId === ids.paymentProviderSelect) {
    const selected = interaction.values[0];
    const panel = selected === "mercado_pago"
      ? mercadoPagoPanel(client, guildId, userId)
      : selected === "efi"
        ? efiBankPanel(client, guildId, userId)
        : selected === "stripe"
          ? stripePanel(client, guildId, userId)
          : pixPanel(client, guildId, userId);
    await interaction.update(panel);
    return;
  }
  if (baseId === ids.pixTypeSelect) {
    setGuildConfig(guildId, (config) => {
      config.payments.pix.type = interaction.values[0];
      return config;
    });
    await interaction.update(pixPanel(client, guildId, userId));
    return;
  }
  if (baseId === ids.paymentToggle) {
    setGuildConfig(guildId, (config) => {
      config.payments.pix.enabled = !config.payments.pix.enabled;
      return config;
    });
    await interaction.update(pixPanel(client, guildId, userId));
    return;
  }
  if (baseId === ids.paymentConfigure) {
    await safeShowModal(interaction, pixKeyModal(userId));
    return;
  }
  if (baseId === ids.mercadoPagoConfigure) {
    await safeShowModal(interaction, mercadoPagoModal(userId));
    return;
  }
  if (baseId === ids.mercadoPagoToggle) {
    setGuildConfig(guildId, (config) => {
      config.payments.mercadoPago.enabled = !config.payments.mercadoPago.enabled;
      return config;
    });
    await interaction.update(mercadoPagoPanel(client, guildId, userId));
    return;
  }
  if (baseId === ids.efiConfigure) {
    await safeShowModal(interaction, efiBankModal(userId));
    return;
  }
  if (baseId === ids.efiCertificateUpload) {
    setGuildConfig(guildId, (config) => {
      config.payments.efi.pendingCertificateUserId = interaction.user.id;
      config.payments.efi.pendingCertificateChannelId = interaction.channelId;
      config.payments.efi.pendingCertificateAt = Date.now();
      return config;
    });
    await interaction.reply({
      content: "Envie o certificado `.p12` ou `.pem` neste canal como anexo. Eu vou salvar automaticamente e usar na EfÃ­.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }
  if (baseId === ids.efiToggle) {
    setGuildConfig(guildId, (config) => {
      config.payments.efi.enabled = !config.payments.efi.enabled;
      if (!config.payments.efi.enabled && config.middleman.mode === "automatic") {
        config.middleman.mode = "manual";
      }
      return config;
    });
    await interaction.update(efiBankPanel(client, guildId, userId));
    return;
  }
  if (baseId === ids.stripeConfigure) {
    await safeShowModal(interaction, stripeModal(userId));
    return;
  }
  if (baseId === ids.stripeToggle) {
    setGuildConfig(guildId, (config) => {
      config.payments.stripe.enabled = !config.payments.stripe.enabled;
      return config;
    });
    await interaction.update(stripePanel(client, guildId, userId));
    return;
  }
  if (baseId === ids.stripeCurrencySelect) {
    const cur = interaction.values[0];
    if (!["brl", "usd"].includes(cur)) return;
    setGuildConfig(guildId, (c) => { c.payments.stripe.currency = cur; return c; });
    await interaction.update(stripePanel(client, guildId, userId));
    return;
  }
  if (baseId === ids.customizeColor) {
    await safeShowModal(interaction, customColorModal(userId, getGuildConfig(guildId)));
    return;
  }
  if (baseId === ids.customizeProfile) {
    await safeShowModal(interaction, customizeProfileModal(userId));
    return;
  }
  if (baseId === ids.systemsSelect) {
    const val = interaction.values?.[0];
    if (val === "middleman") {
      await interaction.update(panelPayload(middlemanAdminPanel(client, guildId, userId)));
      return;
    }
    if (val === "partnership") {
      const { partnershipMainPanel } = require("./modules/partnerships/panel");
      await interaction.update({ components:[partnershipMainPanel(client, guildId, userId)], flags: require("discord.js").MessageFlags.IsComponentsV2 });
      return;
    }
    if (val === "oauth2") {
      await interaction.update(panelPayload(oauth2.rootPanel(client, guildId, userId)));
      return;
    }
    if (val === "giveaway") {
      await interaction.update(panelPayload(giveaways.rootPanel(client, guildId, userId)));
      return;
    }
    if (val === "affiliates") {
      await interaction.update(panelPayload(affiliates.rootPanel(client, guildId, userId)));
      return;
    }
    return;
  }
  if (baseId === ids.mmToggle) {
    setGuildConfig(guildId, (config) => {
      config.middleman.enabled = !config.middleman.enabled;
      return config;
    });
    await interaction.update(panelPayload(middlemanAdminPanel(client, guildId, userId)));
    return;
  }
  if (baseId === ids.mmAppearance) {
    await interaction.update(panelPayload(middlemanAppearancePanel(client, guildId, userId)));
    return;
  }
  if (baseId === ids.mmManage) {
    await interaction.update(panelPayload(middlemanManagePanel(client, guildId, userId)));
    return;
  }
  if (baseId === ids.mmPreview) {
    await interaction.reply({ components: [publicMiddlemanPanel(client, guildId)], flags: 32768 | 64 });
    return;
  }
  if (baseId === ids.mmSendPanel) {
    await interaction.update(panelPayload(middlemanSendChannelPanel(client, guildId, userId)));
    return;
  }
  if (baseId === ids.mmSendChannel) {
    const channel = await interaction.guild.channels.fetch(interaction.values[0]).catch(() => null);
    if (!channel?.isTextBased()) {
      await interaction.reply({ content: "Selecione um canal de texto valido.", flags: MessageFlags.Ephemeral });
      return;
    }
    await channel.send({ components: [publicMiddlemanPanel(client, guildId)], flags: 32768 });
    await interaction.update(panelPayload(middlemanAdminPanel(client, guildId, userId)));
    return;
  }
  if (baseId === ids.mmAppearanceSelect) {
    const selected = interaction.values[0];
    if (selected === "description") {
      await safeShowModal(interaction, mmDescriptionModal(userId));
      return;
    }
    if (selected === "color") {
      await safeShowModal(interaction, mmColorModal(userId));
      return;
    }
    await safeShowModal(interaction, mmImageModal(userId, selected));
    return;
  }
  if (baseId === ids.mmManageFees) {
    await interaction.update(panelPayload(middlemanFeesPanel(client, guildId, userId)));
    return;
  }
  if (baseId === ids.mmManageMode) {
    await interaction.update(panelPayload(middlemanModePanel(client, guildId, userId)));
    return;
  }
  if (baseId === ids.mmFeesSelect) {
    const selected = interaction.values[0];
    if (selected === "toggle") {
      setGuildConfig(guildId, (config) => {
        config.middleman.fees = config.middleman.fees === "none" ? "custom" : "none";
        return config;
      });
      await interaction.update(panelPayload(middlemanFeesPanel(client, guildId, userId)));
      return;
    }
    await safeShowModal(interaction, mmFeeModal(userId, selected));
    return;
  }
  if (baseId === "unused:mmFeesSelect") {
    setGuildConfig(guildId, (config) => {
      config.middleman.fees = interaction.values[0];
      return config;
    });
    await interaction.update(panelPayload(middlemanAdminPanel(client, guildId, userId)));
    return;
  }
  if (baseId === ids.mmModeSelect) {
    if (interaction.values[0] === "automatic") {
      const efi = getGuildConfig(guildId).payments.efi;
      if (!efi.enabled || !efi.clientId || !efi.clientSecret || !efi.certificatePath) {
        await interaction.reply({ content: "Configure e habilite EfÃ­ Bank em Formas de Pagamento antes de ativar o Middleman automatico.", flags: MessageFlags.Ephemeral });
        return;
      }
    }
    setGuildConfig(guildId, (config) => {
      config.middleman.mode = interaction.values[0];
      return config;
    });
    await interaction.update(panelPayload(middlemanAdminPanel(client, guildId, userId)));
    return;
  }
}
async function handleModal(interaction, baseId) {
  const client = interaction.client;
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  if (await handleAutomationModal(interaction, baseId)) return;
  if (baseId === ids.pixKeyModal) {
    const key = interaction.fields.getTextInputValue("pixKey").trim();
    if (!key) {
      await safeReply(interaction, { content: `${inlineEmoji(client, "negativo")} Chave Pix nÃ£o pode ficar vazia.`, flags: MessageFlags.Ephemeral });
      return;
    }
    if (key.length < 5 || key.length > 149) {
      await safeReply(interaction, { content: "Chave Pix invÃ¡lida (5-149 caracteres).", flags: MessageFlags.Ephemeral });
      return;
    }
    setGuildConfig(guildId, (config) => {
      config.payments.pix.key = key.slice(0, 149);
      return config;
    });
    await interaction.update(pixPanel(client, guildId, userId));
    return;
  }
  if (baseId === ids.mercadoPagoModal) {
    const accessToken = interaction.fields.getTextInputValue("accessToken").trim();
    const payerEmail = interaction.fields.getTextInputValue("payerEmail").trim();
    if (!accessToken) {
      await safeReply(interaction, { content: "Access Token Ã© obrigatÃ³rio.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (accessToken.length < 10 || accessToken.length > 500) {
      await safeReply(interaction, { content: "Access Token invÃ¡lido.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (payerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail)) {
      await safeReply(interaction, { content: "Email pagador invÃ¡lido.", flags: MessageFlags.Ephemeral });
      return;
    }
    setGuildConfig(guildId, (config) => {
      config.payments.mercadoPago.accessToken = accessToken.slice(0, 500);
      config.payments.mercadoPago.payerEmail = payerEmail ? payerEmail.slice(0, 254) : "comprador@example.com";
      return config;
    });
    await interaction.update(mercadoPagoPanel(client, guildId, userId));
    return;
  }
  if (baseId === ids.efiModal) {
    const cId = interaction.fields.getTextInputValue("clientId").trim();
    const cSecret = interaction.fields.getTextInputValue("clientSecret").trim();
    const cPass = interaction.fields.getTextInputValue("certificatePassphrase").trim();
    if (!cId || !cSecret) {
      await safeReply(interaction, { content: "Client ID e Client Secret sÃ£o obrigatÃ³rios.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (cId.length > 128 || cSecret.length > 128) {
      await safeReply(interaction, { content: "ID/Secret muito longo (mÃ¡x 128).", flags: MessageFlags.Ephemeral });
      return;
    }
    setGuildConfig(guildId, (config) => {
      config.payments.efi.clientId = cId.slice(0, 128);
      config.payments.efi.clientSecret = cSecret.slice(0, 128);
      config.payments.efi.certificatePassphrase = cPass ? cPass.slice(0, 128) : null;
      return config;
    });
    await interaction.update(efiBankPanel(client, guildId, userId));
    return;
  }
  if (baseId === ids.stripeModal) {
    const secretKey = interaction.fields.getTextInputValue("secretKey").trim();
    const webhookSecret = interaction.fields.getTextInputValue("webhookSecret").trim();
    if (!secretKey) {
      await safeReply(interaction, { content: "Secret Key nÃ£o pode ficar vazia.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (!secretKey.startsWith("sk_")) {
      await safeReply(interaction, { content: "Secret Key invÃ¡lida. Use sk_test_... ou sk_live_...", flags: MessageFlags.Ephemeral });
      return;
    }
    if (secretKey.length < 20 || secretKey.length > 200) {
      await safeReply(interaction, { content: "Secret Key invÃ¡lida.", flags: MessageFlags.Ephemeral });
      return;
    }
    setGuildConfig(guildId, (config) => {
      config.payments.stripe.secretKey = secretKey.slice(0, 200);
      config.payments.stripe.webhookSecret = webhookSecret ? webhookSecret.slice(0, 200) : null;
      return config;
    });
    await interaction.update(stripePanel(client, guildId, userId));
    return;
  }
  if (baseId === ids.mmDescriptionModal) {
    const description = interaction.fields.getTextInputValue("description").trim().replace(/@everyone|@here/g, "@\u200beveryone");
    if (!description) {
      await safeReply(interaction, { content: "DescriÃ§Ã£o nÃ£o pode ficar vazia.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (description.length > 1500) {
      await safeReply(interaction, { content: "DescriÃ§Ã£o muito longa (mÃ¡x 1500).", flags: MessageFlags.Ephemeral });
      return;
    }
    setGuildConfig(guildId, (config) => {
      config.middleman.description = description.slice(0, 1500);
      return config;
    });
    await interaction.update(panelPayload(middlemanAdminPanel(client, guildId, userId)));
    return;
  }
  if (baseId.startsWith(ids.mmImageModal)) {
    const target = baseId.replace(`${ids.mmImageModal}:`, "");
    const url = interaction.fields.getTextInputValue("imageUrl").trim();
    if (url && !/^https?:\/\/.+\..+/i.test(url)) {
      await safeReply(interaction, { content: "URL invÃ¡lida. Use https://exemplo.com/imagem.png", flags: MessageFlags.Ephemeral });
      return;
    }
    if (url && url.length > 500) {
      await safeReply(interaction, { content: "URL muito longa (mÃ¡x 500).", flags: MessageFlags.Ephemeral });
      return;
    }
    setGuildConfig(guildId, (config) => {
      config.middleman[target] = url ? url.slice(0, 500) : null;
      return config;
    });
    await interaction.update(panelPayload(middlemanAdminPanel(client, guildId, userId)));
    return;
  }
  if (baseId === ids.mmColorModal) {
    let color = interaction.fields.getTextInputValue("color").trim().replace("#", "");
    if (!/^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(color)) {
      await safeReply(interaction, { content: "Use #FFFFFF ou #FFF (3 ou 6 hex).", flags: MessageFlags.Ephemeral });
      return;
    }
    if (color.length === 3) color = color.split("").map(c => c + c).join("");
    const parsed = Number.parseInt(color, 16);
    setGuildConfig(guildId, (config) => {
      config.middleman.color = parsed;
      return config;
    });
    await interaction.update(panelPayload(middlemanAdminPanel(client, guildId, userId)));
    return;
  }
  if (baseId === ids.customizeProfileModal) {
    const avatarUrl = interaction.fields.getTextInputValue("avatar").trim();
    const bannerUrl = interaction.fields.getTextInputValue("banner").trim();
    if(!avatarUrl && !bannerUrl){
      await safeReply(interaction, { content: "Informe pelo menos uma URL (avatar ou banner).", flags: MessageFlags.Ephemeral });
      return;
    }
    const urlRe = /^https?:\/\/.+\..+/i;
    if(avatarUrl && !urlRe.test(avatarUrl)){
      await safeReply(interaction, { content: "URL do avatar invÃ¡lida. Use https://...", flags: MessageFlags.Ephemeral }); return;
    }
    if(bannerUrl && !urlRe.test(bannerUrl)){
      await safeReply(interaction, { content: "URL do banner invÃ¡lida. Use https://...", flags: MessageFlags.Ephemeral }); return;
    }
    const client = interaction.client;
    let changed=[];
    let errors=[];
    if(avatarUrl){
      try{
        await client.user.setAvatar(avatarUrl);
        changed.push("Avatar");
      }catch(e){
        errors.push(`Avatar: ${e.message}`);
      }
    }
    if(bannerUrl){
      try{
        if(typeof client.user.setBanner === 'function'){
          await client.user.setBanner(bannerUrl);
        } else if(typeof client.user.edit === 'function'){
          await client.user.edit({ banner: bannerUrl });
        } else {
          throw new Error("Banner nÃ£o suportado nesta versÃ£o");
        }
        changed.push("Banner");
      }catch(e){
        errors.push(`Banner: ${e.message}`);
      }
    }
    const okMsg = changed.length ? `âœ… ${changed.join(" e ")} atualizado(s)!` : "";
    const errMsg = errors.length ? `\nâš ï¸ Erros: ${errors.join("; ")}` : "";
    await interaction.reply({ content: okMsg + errMsg + (changed.length? "\n-# Pode levar alguns minutos para propagar." : ""), flags: MessageFlags.Ephemeral }).catch(()=>null);
    try{
      const refreshed = customizePanel(client, guildId, userId);
      await interaction.followUp({ components:[refreshed], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }).catch(()=>null);
    }catch{}
    return;
  }
  if (baseId === ids.customColorModal) {
    const raw = interaction.fields.getTextInputValue("color").trim().replace("#", "");
    if (!raw) {
      setGuildConfig(guildId, (config) => {
        config.customColor = null;
        return config;
      });
      await interaction.update(panelPayload(customizePanel(client, guildId, userId)));
      return;
    }
    let color = raw;
    if (!/^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(color)) {
      await safeReply(interaction, { content: "Use #FFFFFF, #FFF ou vazio para remover.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (color.length === 3) color = color.split("").map(c => c + c).join("");
    const parsed = Number.parseInt(color, 16);
    setGuildConfig(guildId, (config) => {
      config.customColor = parsed;
      return config;
    });
    await interaction.update(panelPayload(customizePanel(client, guildId, userId)));
    return;
  }
  if (baseId === ids.panelStoreHoursModal) {
    const open = interaction.fields.getTextInputValue("open").trim();
    const close = interaction.fields.getTextInputValue("close").trim();
    const daysRaw = interaction.fields.getTextInputValue("days").trim();
    const timeRe = /^([01]?\d|2[0-3]):[0-5]\d$/;
    if (!timeRe.test(open) || !timeRe.test(close)) {
      await safeReply(interaction, { content: "HorÃ¡rio invÃ¡lido. Use HH:MM (ex: 09:00).", flags: MessageFlags.Ephemeral });
      return;
    }
    const days = daysRaw.split(/[,\s]+/).map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n >= 0 && n <= 6);
    if (!days.length) {
      await safeReply(interaction, { content: "Dias invÃ¡lidos. Use 0=Dom atÃ© 6=SÃ¡b, ex: 1,2,3,4,5", flags: MessageFlags.Ephemeral });
      return;
    }
    const norm = (t) => t.split(":").map(s => s.padStart(2, "0")).join(":");
    setGuildConfig(guildId, (c) => {
      c.storeHours.open = norm(open);
      c.storeHours.close = norm(close);
      c.storeHours.days = [...new Set(days)].sort((a,b)=>a-b);
      c.storeHours.enabled = true;
      return c;
    });
    await interaction.update(panelPayload(storeHoursPanel(client, guildId, userId)));
    return;
  }
  if (baseId.startsWith(ids.mmFeeModal)) {
    const target = baseId.replace(`${ids.mmFeeModal}:`, "");
    const above = parseMoneyInput(interaction.fields.getTextInputValue("above"));
    const value = parseMoneyInput(interaction.fields.getTextInputValue("value"));
    const typeRaw = interaction.fields.getTextInputValue("type")?.trim().toLowerCase();
    const type = typeRaw.startsWith("p") || typeRaw.includes("%") ? "percent" : "fixed";
    if (value === null || (target !== "account" && above === null)) {
      await interaction.reply({ content: "Use valores validos. Exemplo: minimo `100`, taxa `2,15`, tipo `fixa` ou `porcentagem`.", flags: MessageFlags.Ephemeral });
      return;
    }
    setGuildConfig(guildId, (config) => {
      if (target === "account") {
        config.middleman.accountExtraFee = value;
      } else {
        const index = Number(target.replace("rule:", ""));
        config.middleman.feeRules[index] = { above, value, type };
        config.middleman.fees = "custom";
      }
      return config;
    });
    await interaction.update(panelPayload(middlemanFeesPanel(client, guildId, userId)));
  }
}
function pixKeyModal(userId) {
  return new ModalBuilder()
    .setCustomId(`${ids.pixKeyModal}:${userId}`)
    .setTitle("Configurar Pix")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("pixKey")
          .setLabel("Chave Pix")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("email@dominio.com, CPF, telefone ou chave aleatoria")
          .setRequired(true)
      )
    );
}
function mercadoPagoModal(userId) {
  return new ModalBuilder()
    .setCustomId(`${ids.mercadoPagoModal}:${userId}`)
    .setTitle("Configurar Mercado Pago")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("accessToken")
          .setLabel("Access Token")
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder("APP_USR-...")
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("payerEmail")
          .setLabel("Email pagador padrao")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("comprador@example.com")
          .setRequired(false)
      )
    );
}
function stripeModal(userId) {
  return new ModalBuilder()
    .setCustomId(`${ids.stripeModal}:${userId}`)
    .setTitle("Configurar Stripe")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("secretKey")
          .setLabel("Secret Key")
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder("sk_live_... ou sk_test_...")
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("webhookSecret")
          .setLabel("Webhook Secret (opcional)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("whsec_... (deixe vazio se nÃ£o usar)")
          .setRequired(false)
      )
    );
}
function efiBankModal(userId) {
  return new ModalBuilder()
    .setCustomId(`${ids.efiModal}:${userId}`)
    .setTitle("Configurar EfÃ­ Bank")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("clientId")
          .setLabel("Client ID")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("clientSecret")
          .setLabel("Client Secret")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("certificatePassphrase")
          .setLabel("Senha do certificado")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("deixe vazio se nao tiver senha")
          .setRequired(false)
      )
    );
}
function mmDescriptionModal(userId) {
  return new ModalBuilder()
    .setCustomId(`${ids.mmDescriptionModal}:${userId}`)
    .setTitle("Descricao do Middleman")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("description")
          .setLabel("Descricao do container")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1500)
      )
    );
}
function mmImageModal(userId, target) {
  return new ModalBuilder()
    .setCustomId(`${ids.mmImageModal}:${target}:${userId}`)
    .setTitle(target === "banner" ? "Banner" : "Thumbnail")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("imageUrl")
          .setLabel("URL da imagem")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("https://exemplo.com/imagem.png")
          .setRequired(false)
      )
    );
}
function mmColorModal(userId) {
  return new ModalBuilder()
    .setCustomId(`${ids.mmColorModal}:${userId}`)
    .setTitle("Cor padrao")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("color")
          .setLabel("Cor hexadecimal")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("#FFFFFF")
          .setRequired(true)
          .setMaxLength(7)
      )
    );
}
function customColorModal(userId, config) {
  return new ModalBuilder()
    .setCustomId(`${ids.customColorModal}:${userId}`)
    .setTitle("Mudar cor do /panel")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("color")
          .setLabel("Cor hexadecimal (opcional)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("#FFFFFF")
          .setValue(config?.customColor ? `#${Number(config.customColor).toString(16).padStart(6, "0").toUpperCase()}` : "")
          .setRequired(false)
          .setMaxLength(7)
      )
    );
}
function mmFeeModal(userId, target) {
  const isAccount = target === "account";
  const modal = new ModalBuilder()
    .setCustomId(`${ids.mmFeeModal}:${target}:${userId}`)
    .setTitle(isAccount ? "Taxa extra de conta" : "Editar taxa");
  if (!isAccount) {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("above")
          .setLabel("Acima de qual valor?")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Ex: 100")
          .setRequired(true)
      )
    );
  } else {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("above")
          .setLabel("Ignorar este campo")
          .setStyle(TextInputStyle.Short)
          .setValue("0")
          .setRequired(false)
      )
    );
  }
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("value")
        .setLabel(isAccount ? "Taxa extra em reais" : "Valor da taxa")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(isAccount ? "Ex: 4" : "Ex: 2,15 ou 1,2")
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("type")
        .setLabel("Tipo: fixa ou porcentagem")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(isAccount ? "fixa" : "fixa ou porcentagem")
        .setValue("fixa")
        .setRequired(!isAccount)
    )
  );
  return modal;
}
function parseMoneyInput(value) {
  const parsed = Number(String(value || "").replace(/[^\d,.]/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : null;
}
function isMiddlemanConfigTarget(target) {
  return ["middleman", "trader", "vouchChannel", "bigVouchChannel", "middlemanLogs"].includes(target);
}
const LOG_CHANNEL_DEFS = [
  { name: "💸〃logs-vendas", apply: (cfg, id) => { for (const k of SALES_LOG_KEYS) cfg.sales.channels[k] = id; } },
  { name: "🎫〃logs-tickets", apply: (cfg, id) => { cfg.tickets.channels.logs = id; } },
  { name: "🛡️〃logs-moderacao", apply: (cfg, id) => { cfg.channels.moderationLogs = id; } },
  { name: "💬〃logs-mensagens", apply: (cfg, id) => { cfg.channels.messageLogs = id; } },
  { name: "📨〃logs-invites", apply: (cfg, id) => { cfg.channels.inviteLogs = id; } },
  { name: "⚙️〃logs-sistemas", apply: (cfg, id) => { cfg.channels.systemLogs = id; } },
  { name: "✅〃logs-verificacao", apply: (cfg, id) => { cfg.channels.verificationLogs = id; } },
  { name: "📝〃logs-gerais", apply: (cfg, id) => { cfg.channels.generalLogs = id; } },
  { name: "🤝〃logs-middleman", apply: (cfg, id) => { cfg.channels.middlemanLogs = id; } }
];
const ROLE_DEFS = [
  { name: "Administrador", apply: (cfg, id) => { cfg.roles.admin = id; } },
  { name: "Suporte", apply: (cfg, id) => { cfg.tickets.roles.support = id; cfg.sales.roles.staff = id; } },
  { name: "Membro", apply: (cfg, id) => { cfg.roles.autoRole = id; } },
  { name: "Cliente", apply: (cfg, id) => { cfg.sales.roles.customer = id; } },
  { name: "Middleman", apply: (cfg, id) => { cfg.roles.middleman = id; } },
  { name: "Trader", apply: (cfg, id) => { cfg.roles.trader = id; } }
];
async function handleCreateLogChannels(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  try {
    if (!interaction.replied && !interaction.deferred) await interaction.deferUpdate().catch(() => null);
  } catch {   }
  const done = async (payload) => {
    try {
      await interaction.editReply(payload).catch(() => null);
    } catch {   }
  };
  const me = interaction.guild?.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.followUp({ content: "Preciso da permissão **Gerenciar Canais** para criar a categoria LOGS.", flags: MessageFlags.Ephemeral }).catch(() => null);
    return;
  }
  await interaction.guild.channels.fetch().catch(() => null);
  let category = interaction.guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === "logs");
  if (!category) {
    category = await interaction.guild.channels.create({ name: "LOGS", type: ChannelType.GuildCategory, reason: "Categoria de logs criada pelo bot" }).catch(() => null);
    if (category) {
      await category.permissionOverwrites.edit(interaction.guild.roles.everyone, { ViewChannel: false }).catch(() => null);
    }
  }
  if (!category) {
    await interaction.followUp({ content: "Não consegui criar nem encontrar a categoria LOGS.", flags: MessageFlags.Ephemeral }).catch(() => null);
    return;
  }
  const lines = [];
  for (const def of LOG_CHANNEL_DEFS) {
    let channel = interaction.guild.channels.cache.find((c) => c.name === def.name && c.parentId === category.id);
    let status;
    if (channel) {
      status = "já existia";
    } else {
      channel = await interaction.guild.channels.create({ name: def.name, type: ChannelType.GuildText, parent: category.id, reason: "Canal de log criado pelo bot" }).catch(() => null);
      status = channel ? "criado" : "FALHOU";
    }
    if (channel) {
      setGuildConfig(guildId, (cfg) => { def.apply(cfg, channel.id); return cfg; });
      lines.push(`${channel} — ${status}`);
    } else {
      lines.push(`\`${def.name}\` — FALHOU (verifique minhas permissões)`);
    }
  }
  await done(panelPayload(channelsPanel(interaction.client, guildId, userId)));
  await interaction.followUp({ content: `**Canais de logs:**\n${lines.join("\n")}`, flags: MessageFlags.Ephemeral }).catch(() => null);
}
async function handleCreateRoles(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  try {
    if (!interaction.replied && !interaction.deferred) await interaction.deferUpdate().catch(() => null);
  } catch {   }
  const me = interaction.guild?.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    await interaction.followUp({ content: "Preciso da permissão **Gerenciar Cargos** para criar os cargos.", flags: MessageFlags.Ephemeral }).catch(() => null);
    return;
  }
  await interaction.guild.roles.fetch().catch(() => null);
  const lines = [];
  for (const def of ROLE_DEFS) {
    let role = interaction.guild.roles.cache.find((r) => r.name.toLowerCase() === def.name.toLowerCase());
    let status;
    if (role) {
      status = "já existia";
    } else {
      role = await interaction.guild.roles.create({ name: def.name, reason: "Cargo criado pelo bot" }).catch(() => null);
      status = role ? "criado" : "FALHOU";
    }
    if (role) {
      setGuildConfig(guildId, (cfg) => { def.apply(cfg, role.id); return cfg; });
      lines.push(`<@&${role.id}> — ${status}`);
    } else {
      lines.push(`\`${def.name}\` — FALHOU (verifique minhas permissões)`);
    }
  }
  await interaction.editReply(panelPayload(rolesPanel(interaction.client, guildId, userId))).catch(() => null);
  await interaction.followUp({
    content: `**Cargos:**\n${lines.join("\n")}\n-# Suporte vale para tickets e vendas. Deixe meu cargo acima destes para eu entregar cargos.`,
    flags: MessageFlags.Ephemeral
  }).catch(() => null);
}
module.exports = {
  handleInteraction
};
