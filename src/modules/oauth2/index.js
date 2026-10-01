const { MessageFlags } = require("discord.js");
const { ids } = require("../../config");
const { getGuildConfig, setGuildConfig } = require("../../storage");
const { parseCustomId, panelPayload, inlineEmoji, prettyPayload } = require("../panel");
const {
  getStore,
  setStore,
  isBotConfigured,
  hasBotCredentials,
  isVerified,
  getVerifiedList
} = require("./store");
const {
  buildAuthorizeUrl,
  validateBotToken,
  registerSiteBot,
  avatarUrl,
  isAuthBotInGuild,
  buildBotInviteUrl,
  refreshAccessToken,
  addGuildMember
} = require("./oauth");
const panels = require("./panel");
const V2 = MessageFlags.IsComponentsV2;
const V2_EPHEMERAL = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
function rootPanel(client, guildId, userId) {
  if (!hasBotCredentials()) return panels.setupPanel(client, guildId, userId);
  const { bot } = getStore();
  if (!bot.confirmed) return panels.confirmPanel(client, guildId, userId);
  return panels.mainPanel(client, guildId, userId);
}
async function safeUpdate(interaction, payload) {
  try {
    payload = prettyPayload(interaction.client, payload);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ ...payload, flags: V2_EPHEMERAL }).catch(() => null);
    } else if (interaction.isRepliable()) {
      await interaction.update(payload).catch(() => null);
    }
  } catch {   }
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
function checkOwner(interaction, ownerId) {
  return !ownerId || ownerId === interaction.user.id;
}
async function handleOAuth2Interaction(interaction) {
  const customId = String(interaction.customId || "");
  if (customId === ids.oauth2Verify) return handleVerifyClick(interaction);
  if (!customId.startsWith("oauth2:") && !customId.startsWith("modal:oauth2:")) return false;
  const { baseId, ownerId } = parseCustomId(customId);
  if (!checkOwner(interaction, ownerId)) {
    await safeReply(interaction, { content: "Este painel pertence a outra pessoa.", flags: MessageFlags.Ephemeral });
    return true;
  }
  return handleOAuth2PanelComponent(interaction, baseId);
}
async function handleOAuth2PanelComponent(interaction, baseId) {
  const client = interaction.client;
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  if (baseId === ids.oauth2Entry) {
    await safeUpdate(interaction, panelPayload(rootPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.oauth2Back) {
    await safeUpdate(interaction, panelPayload(rootPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.oauth2Setup) {
    const { bot } = getStore();
    try {
      await interaction.showModal(panels.setupModal(userId, { token: "", clientId: bot.clientId || "", clientSecret: "" }));
    } catch {   }
    return true;
  }
  if (baseId === ids.oauth2ConfirmYes) {
    setStore((s) => ({ ...s, bot: { ...s.bot, confirmed: true } }));
    await safeUpdate(interaction, panelPayload(panels.mainPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.oauth2ConfirmNo) {
    setStore((s) => ({
      ...s,
      bot: { token: null, clientId: null, clientSecret: null, confirmed: false, botId: null, botName: null, botAvatar: null, siteBotId: null }
    }));
    await safeUpdate(interaction, panelPayload(panels.setupPanel(client, guildId, userId)));
    return true;
  }
  if (!isBotConfigured()) {
    await safeUpdate(interaction, panelPayload(rootPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.oauth2MainSelect) {
    const value = interaction.values?.[0];
    if (value === "send") {
      await safeUpdate(interaction, panelPayload(panels.sendPanel(client, guildId, userId)));
      return true;
    }
    if (value === "require") {
      await safeUpdate(interaction, panelPayload(panels.requirePanel(client, guildId, userId)));
      return true;
    }
    if (value === "recover") {
      await showRecoverRoot(interaction);
      return true;
    }
    if (value === "reconfig") {
      const { bot } = getStore();
      try {
        await interaction.showModal(panels.setupModal(userId, { token: "", clientId: bot.clientId || "", clientSecret: "" }));
      } catch {   }
      return true;
    }
    return true;
  }
  if (baseId === ids.oauth2Stats) {
    await safeUpdate(interaction, panelPayload(panels.statsPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.oauth2Members) {
    await safeUpdate(interaction, panelPayload(panels.membersPanel(client, guildId, userId, 0)));
    return true;
  }
  if (baseId.startsWith(ids.oauth2MembersPage)) {
    const page = Number(baseId.split(":").at(-1)) || 0;
    await safeUpdate(interaction, panelPayload(panels.membersPanel(client, guildId, userId, page)));
    return true;
  }
  if (baseId === ids.oauth2Recover) {
    await showRecoverRoot(interaction);
    return true;
  }
  if (baseId === ids.oauth2RecoverAsk) {
    const ready = getVerifiedList().filter((m) => m?.token?.refresh).length;
    if (!ready) {
      await safeReply(interaction, { content: "Ninguém pronto para recuperar (sem tokens — peça para se verificarem de novo).", flags: MessageFlags.Ephemeral });
      return true;
    }
    await safeUpdate(interaction, panelPayload(panels.recoverConfirmPanel(client, guildId, userId, ready)));
    return true;
  }
  if (baseId === ids.oauth2RecoverRun) {
    await runRecovery(interaction);
    return true;
  }
  if (baseId === ids.oauth2RecoverHistory) {
    await safeUpdate(interaction, panelPayload(panels.historyPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.oauth2Require) {
    await safeUpdate(interaction, panelPayload(panels.requirePanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.oauth2RequireSelect) {
    const value = interaction.values?.[0];
    if (value === "cart" || value === "ticket") {
      setStore((s) => ({ ...s, require: { ...s.require, [value]: !s.require[value] } }));
      await safeUpdate(interaction, panelPayload(panels.requirePanel(client, guildId, userId)));
      return true;
    }
    return true;
  }
  if (baseId === ids.oauth2Send) {
    await safeUpdate(interaction, panelPayload(panels.sendPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.oauth2Appearance) {
    const { panel: cfg } = getStore();
    try {
      await interaction.showModal(panels.appearanceModal(userId, cfg));
    } catch {   }
    return true;
  }
  if (baseId === ids.oauth2Button) {
    const { panel: cfg } = getStore();
    try {
      await interaction.showModal(panels.buttonModal(userId, cfg));
    } catch {   }
    return true;
  }
  if (baseId === ids.oauth2SendPanel) {
    await safeUpdate(interaction, panelPayload(panels.sendChannelPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.oauth2SendChannel) {
    const channelId = interaction.values?.[0];
    const channel = channelId ? await interaction.guild?.channels.fetch(channelId).catch(() => null) : null;
    if (!channel?.isTextBased()) {
      await safeReply(interaction, { content: "Selecione um canal de texto válido.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await sendPublicPanel(client, guildId, channel);
    setStore((s) => ({ ...s, panel: { ...s.panel, channelId: channel.id } }));
    await safeReply(interaction, { content: `Painel de verificação enviado em ${channel}.`, flags: MessageFlags.Ephemeral });
    return true;
  }
  if (baseId === ids.oauth2SendHere) {
    const channel = interaction.channel;
    if (!channel?.isTextBased()) {
      await safeReply(interaction, { content: "Canal inválido para envio.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await sendPublicPanel(client, guildId, channel);
    setStore((s) => ({ ...s, panel: { ...s.panel, channelId: channel.id } }));
    await safeReply(interaction, { content: `Painel de verificação enviado neste canal.`, flags: MessageFlags.Ephemeral });
    return true;
  }
  return false;
}
async function handleOAuth2Modal(interaction) {
  const { baseId, ownerId } = parseCustomId(String(interaction.customId || ""));
  if (!baseId.startsWith("modal:oauth2:")) return false;
  if (!checkOwner(interaction, ownerId)) {
    await safeReply(interaction, { content: "Este modal pertence a outra pessoa.", flags: MessageFlags.Ephemeral });
    return true;
  }
  const client = interaction.client;
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  if (baseId === ids.oauth2SetupModal) {
    const token = interaction.fields.getTextInputValue("token").trim();
    const clientId = interaction.fields.getTextInputValue("clientId").trim();
    const clientSecret = interaction.fields.getTextInputValue("clientSecret").trim();
    if (!token || !clientId || !clientSecret) {
      await safeReply(interaction, { content: "Preencha os 3 campos: token, client ID e client secret.", flags: MessageFlags.Ephemeral });
      return true;
    }
    let identity;
    try {
      identity = await validateBotToken(token);
    } catch (e) {
      await safeReply(interaction, { content: `Não consegui validar esse bot: ${e.message}`, flags: MessageFlags.Ephemeral });
      return true;
    }
    let siteReg;
    try {
      siteReg = await registerSiteBot({ name: identity.username, clientId, clientSecret, botToken: token });
    } catch (e) {
      await safeReply(interaction, { content: `Bot válido no Discord, mas ${e.message}`, flags: MessageFlags.Ephemeral });
      return true;
    }
    setStore((s) => ({
      ...s,
      bot: {
        token,
        clientId,
        clientSecret,
        confirmed: false,
        botId: identity.id || null,
        botName: identity.username || null,
        botAvatar: avatarUrl(identity.id, identity.avatar, 128),
        siteBotId: siteReg.id
      }
    }));
    await safeUpdate(interaction, panelPayload(panels.confirmPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.oauth2AppearanceModal) {
    const title = interaction.fields.getTextInputValue("title").trim().slice(0, 200);
    let colorRaw = "";
    try { colorRaw = (interaction.fields.getTextInputValue("color") || "").trim().replace("#", ""); } catch { colorRaw = ""; }
    let banner = "";
    try { banner = (interaction.fields.getTextInputValue("banner") || "").trim(); } catch { banner = ""; }
    let thumbnail = "";
    try { thumbnail = (interaction.fields.getTextInputValue("thumbnail") || "").trim(); } catch { thumbnail = ""; }
    if (!title) {
      await safeReply(interaction, { content: "O título não pode ficar vazio.", flags: MessageFlags.Ephemeral });
      return true;
    }
    let color = null;
    if (colorRaw) {
      if (!/^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(colorRaw)) {
        await safeReply(interaction, { content: "Cor inválida. Use #5865F2 ou #FFF.", flags: MessageFlags.Ephemeral });
        return true;
      }
      const hex = colorRaw.length === 3 ? colorRaw.split("").map((c) => c + c).join("") : colorRaw;
      color = Number.parseInt(hex, 16);
    }
    const urlRe = /^https?:\/\/.+\..+/i;
    if (banner && !urlRe.test(banner)) {
      await safeReply(interaction, { content: "URL do banner inválida. Use https://...", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (thumbnail && !urlRe.test(thumbnail)) {
      await safeReply(interaction, { content: "URL da thumbnail inválida. Use https://...", flags: MessageFlags.Ephemeral });
      return true;
    }
    setStore((s) => ({
      ...s,
      panel: {
        ...s.panel,
        title,
        description: interaction.fields.getTextInputValue("description").trim().slice(0, 3000),
        color,
        banner: banner || null,
        thumbnail: thumbnail || null
      }
    }));
    await safeUpdate(interaction, panelPayload(panels.sendPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.oauth2ButtonModal) {
    const label = interaction.fields.getTextInputValue("label").trim().slice(0, 80);
    const colorName = interaction.fields.getTextInputValue("color").trim().toLowerCase();
    let emoji = "";
    try { emoji = (interaction.fields.getTextInputValue("emoji") || "").trim().slice(0, 100); } catch { emoji = ""; }
    if (!label) {
      await safeReply(interaction, { content: "O título do botão não pode ficar vazio.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (!["cinza", "verde", "azul", "vermelho"].includes(colorName)) {
      await safeReply(interaction, { content: "Cor inválida. Use: cinza, verde, azul ou vermelho.", flags: MessageFlags.Ephemeral });
      return true;
    }
    setStore((s) => ({
      ...s,
      panel: { ...s.panel, buttonLabel: label, buttonStyle: panels.buttonStyleFromName(colorName), buttonEmoji: emoji || null }
    }));
    await safeUpdate(interaction, panelPayload(panels.sendPanel(client, guildId, userId)));
    return true;
  }
  return false;
}
async function showRecoverRoot(interaction) {
  const client = interaction.client;
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const list = getVerifiedList();
  const ready = list.filter((m) => m?.token?.refresh).length;
  let inGuild = false;
  try {
    inGuild = await isAuthBotInGuild(guildId);
  } catch (e) {
    await safeReply(interaction, { content: `Não consegui checar o bot auth: ${e.message}`, flags: MessageFlags.Ephemeral });
    return;
  }
  await safeUpdate(interaction, panelPayload(panels.recoverPanel(client, guildId, userId, {
    total: list.length,
    ready,
    noToken: list.length - ready,
    inGuild,
    inviteUrl: inGuild ? null : buildBotInviteUrl(guildId)
  })));
}
async function freshAccessToken(record) {
  const tok = record.token || {};
  if (tok.access && tok.expiresAt && tok.expiresAt > Date.now() + 60000) return tok.access;
  const data = await refreshAccessToken(tok.refresh);
  const next = {
    ...record,
    token: {
      access: data.access_token || null,
      refresh: data.refresh_token || tok.refresh,
      expiresAt: Date.now() + Number(data.expires_in || 604800) * 1000
    }
  };
  setStore((s) => ({ ...s, verified: { ...s.verified, [record.id]: next } }));
  if (!next.token.access) throw new Error("Refresh sem access_token.");
  return next.token.access;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function runRecovery(interaction) {
  const client = interaction.client;
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder } = require("discord.js");
  const ie = (name) => inlineEmoji(client, name);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
  const done = async (payload) => { try { await interaction.editReply(payload); } catch {   } };
  let inGuild = false;
  try {
    inGuild = await isAuthBotInGuild(guildId);
  } catch (e) {
    await done({ content: `Não consegui checar o bot auth: ${e.message}` });
    return;
  }
  if (!inGuild) {
    const url = buildBotInviteUrl(guildId);
    await done({ content: `O bot auth não está no servidor.${url ? ` Adicione aqui: ${url}` : ""}` });
    return;
  }
  const list = getVerifiedList();
  let added = 0, already = 0, failed = 0, noToken = 0;
  const failedSample = [];
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    try {
      const cached = interaction.guild?.members.cache.get(m.id);
      const member = cached || await interaction.guild?.members.fetch(m.id).catch(() => null);
      if (member) { already++; continue; }
      if (!m.token?.refresh) { noToken++; continue; }
      const access = await freshAccessToken(m);
      try {
        const res = await addGuildMember(guildId, m.id, access);
        if (res === "added") added++;
        else already++;
      } catch (e) {
        if (e.retryAfterMs) {
          await sleep(Math.min(e.retryAfterMs, 15000));
          const retry = await addGuildMember(guildId, m.id, access).catch((err) => err);
          if (retry === "added") added++;
          else if (retry === "already") already++;
          else { failed++; if (failedSample.length < 5) failedSample.push(`<@${m.id}>: limite excedido`); }
        } else {
          failed++;
          if (failedSample.length < 5) failedSample.push(`<@${m.id}>: ${e.message}`);
        }
      }
    } catch (e) {
      failed++;
      if (failedSample.length < 5) failedSample.push(`<@${m.id}>: ${e.message}`);
    }
    if (i < list.length - 1) await sleep(1200);
  }
  const total = list.length;
  setStore((s) => ({
    ...s,
    recovery: { history: [...(s.recovery?.history || []), { at: Date.now(), by: userId, total, added, already, failed, noToken }].slice(-20) }
  }));
  const result = new ContainerBuilder().setAccentColor(0xffffff);
  result.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${ie("w_users")}Recuperação concluída`
  ));
  result.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${ie("w_check")} **Adicionados:** ${added}\n` +
    `${ie("w_users")} **Já estavam:** ${already}\n` +
    `${ie("w_x")} **Falharam:** ${failed}` +
    (noToken ? `\n${ie("w_clock")} **Sem token:** ${noToken} (peça para se verificarem de novo)` : "") +
    (failedSample.length ? `\n\n${failedSample.join("\n")}` : "")
  ));
  result.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  result.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `-# ${ie("w_bulb")} Veja o detalhe em **Recuperar Membros → Histórico**.`
  ));
  await done({ components: [result], flags: V2 });
}
async function handleVerifyClick(interaction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await safeReply(interaction, { content: "Use a verificação dentro de um servidor.", flags: MessageFlags.Ephemeral });
    return true;
  }
  if (!isBotConfigured()) {
    await safeReply(interaction, { content: "O sistema de verificação ainda não foi configurado.", flags: MessageFlags.Ephemeral });
    return true;
  }
  const url = buildAuthorizeUrl(guildId, interaction.user.id);
  if (!url) {
    await safeReply(interaction, { content: "Não foi possível gerar o link (verifique OAUTH2_SITE_URL no .env e se o bot auth está confirmado).", flags: MessageFlags.Ephemeral });
    return true;
  }
  await safeReply(interaction, panels.verifyLinkPayload(interaction.client, guildId, interaction.user.id));
  return true;
}
async function sendPublicPanel(client, guildId, channel) {
  await channel.send({ components: [panels.publicVerifyPanel(client, guildId)], flags: V2 }).catch(() => null);
}
function verifyRequiredPayload(client, guildId) {
  return panels.verifyPromptPayload(client, guildId);
}
async function requireVerified(interaction, kind) {
  try {
    const guildId = interaction.guildId;
    if (!guildId) return false;
    const { require: req } = getStore();
    if (!req[kind]) return false;
    if (!isBotConfigured()) return false;
    if (isVerified(guildId, interaction.user.id)) return false;
    await safeReply(interaction, verifyRequiredPayload(interaction.client, guildId));
    return true;
  } catch {
    return false;
  }
}
function defaultGuildId() {
  const raw = (process.env.GUILD_ID || process.env.DISCORD_GUILD_ID || "").trim();
  const match = raw.match(/\d{15,25}/);
  return match ? match[0] : null;
}
async function flushVerificationLogs(client) {
  try {
    const store = getStore();
    const pending = Object.values(store.verified || {}).filter((m) => m && !m.logged).slice(0, 10);
    if (!pending.length) return;
    for (const record of pending) {
      try {
        const guildId = record.guildId || defaultGuildId();
        if (!guildId) continue;
        await sendVerificationLog(client, guildId, record);
        setStore((s) => ({
          ...s,
          verified: { ...s.verified, [record.id]: { ...s.verified[record.id], logged: true } }
        }));
      } catch {}
    }
  } catch {}
}
function startVerificationLogPoller(client) {
  flushVerificationLogs(client).catch(() => null);
  const timer = setInterval(() => {
    flushVerificationLogs(client).catch(() => null);
  }, 45 * 1000);
  if (timer.unref) timer.unref();
  return timer;
}
async function sendVerificationLog(client, guildId, record) {
  const config = getGuildConfig(guildId);
  const channelId = config.channels?.verificationLogs;
  if (!channelId) return;
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SectionBuilder, ThumbnailBuilder, MediaGalleryBuilder } = require("discord.js");
  const ie = (name) => inlineEmoji(client, name);
  const verifiedUnix = Math.floor((record.verifiedAt || Date.now()) / 1000);
  const member = await guild.members.fetch(record.id).catch(() => null);
  const createdUnix = member?.user?.createdTimestamp ? Math.floor(member.user.createdTimestamp / 1000) : null;
  const joinedUnix = member?.joinedTimestamp ? Math.floor(member.joinedTimestamp / 1000) : null;
  const displayName = record.globalName || (record.username ? `@${record.username}` : record.id);
  const log = new ContainerBuilder().setAccentColor(0xffffff);
  try {
    const section = new SectionBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## ${ie("w_shield")}Membro verificado`),
      new TextDisplayBuilder().setContent(`<@${record.id}> acabou de vincular a conta Discord.`)
    );
    if (record.avatar) section.setThumbnailAccessory(new ThumbnailBuilder().setURL(record.avatar).setDescription("Avatar"));
    log.addSectionComponents(section);
  } catch {
    log.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## ${ie("w_shield")}Membro verificado\n<@${record.id}>`
    ));
  }
  log.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  log.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${ie("w_user")} **Quem:** **${displayName}** • \`${record.id}\`\n` +
    `${ie("w_clock")} **Conta criada:** ${createdUnix ? `<t:${createdUnix}:F> (<t:${createdUnix}:R>)` : "—"}\n` +
    `${ie("w_users")} **No servidor desde:** ${joinedUnix ? `<t:${joinedUnix}:F> (<t:${joinedUnix}:R>)` : "—"}\n` +
    `${ie("w_check")} **Verificado em:** <t:${verifiedUnix}:F> (<t:${verifiedUnix}:R>)`
  ));
  if (createdUnix && Date.now() / 1000 - createdUnix < 30 * 24 * 3600) {
    log.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `-# ${ie("w_bulb")} **Atenção:** conta criada há poucos dias — confira antes de liberar cargos.`
    ));
  }
  if (record.banner) {
    try {
      log.addMediaGalleryComponents(new MediaGalleryBuilder({ items: [{ media: { url: record.banner }, description: "Banner do usuário" }] }));
      log.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${ie("w_eye")} Banner da conta acima.`));
    } catch {}
  }
  await channel.send({ components: [log], flags: V2 }).catch(() => null);
}
module.exports = {
  rootPanel,
  handleOAuth2Interaction,
  handleOAuth2PanelComponent,
  handleOAuth2Modal,
  requireVerified,
  isVerified,
  sendVerificationLog,
  sendPublicPanel,
  flushVerificationLogs,
  startVerificationLogPoller
};
