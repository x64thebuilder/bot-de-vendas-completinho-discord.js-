const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");
const { ids } = require("../../config");
const { getGuildConfig, setGuildConfig } = require("../../storage");
const { readGuildFile, writeGuildFile } = require("../../guildDb");
let _panelHelpers = null;
function panelHelpers() {
  if (!_panelHelpers) {
    _panelHelpers = require("../panel");
  }
  return _panelHelpers;
}
function componentEmoji(client, name) {
  if (!name) return undefined;
  return panelHelpers().componentEmoji(client, name);
}
function inlineEmoji(client, name){
  try{ const fn = panelHelpers().inlineEmoji; if(typeof fn==="function") return fn(client,name) || ""; }catch{}
  const e = componentEmoji(client,name);
  return e ? `<:${e.name}:${e.id}>` : "";
}
function scoped(id, userId) {
  return panelHelpers().scoped(id, userId);
}
function panelPayload(component) {
  return panelHelpers().panelPayload(component);
}
const V2 = MessageFlags.IsComponentsV2;
const FIXED_COLORS = {
  on: 0x2ecc71,
  off: 0xe74c3c,
  warn: 0xf1c40f,
  auto: 0xffffff,
  repost: 0x16a085,
  embed: 0xeb459e,
  button: 0xffffff,
  nuke: 0xe67e22,
  muted: 0x95a5a6
};
const PAGE_SIZE = 10;
const MAX_BUTTONS = 5;
const MAX_CHANNELS = 5;
function defaultGuildState() {
  return { lastSent: {}, sentMessages: {}, lastRepost: 0 };
}
function getGuildState(guildId) {
  const state = readGuildFile(guildId, "automation-state", defaultGuildState);
  state.sentMessages ||= {};
  return state;
}
function setGuildState(guildId, updater) {
  const current = getGuildState(guildId);
  const next = typeof updater === "function" ? updater(current) : updater;
  const merged = {
    lastSent: {},
    sentMessages: {},
    lastRepost: 0,
    ...(next || {})
  };
  merged.sentMessages ||= {};
  writeGuildFile(guildId, "automation-state", merged);
  return merged;
}
function getIAConfig(guildId){
  const data = readGuildFile(guildId, "automation-ia", ()=>({ apiKey:null, prompt:null, channelId:null, lockedUntil:null }));
  return { apiKey: data.apiKey||null, prompt: data.prompt||null, channelId: data.channelId||null, lockedUntil: data.lockedUntil||null };
}
function setIAConfig(guildId, updater){
  const cur = getIAConfig(guildId);
  const next = typeof updater==="function" ? updater(cur) : updater;
  writeGuildFile(guildId, "automation-ia", { apiKey: next.apiKey||null, prompt: next.prompt||null, channelId: next.channelId||null, lockedUntil: next.lockedUntil||null });
  if(cur.lockedUntil && !next.lockedUntil){
    try{
      const guild = require("../panel").getGuildConfig ? null : null;
    }catch{}
  }
  return next;
}
function getAccentColor(guildId, fallbackKey = null) {
  if (guildId) {
    const cfg = getGuildConfig(guildId);
    if (cfg?.customColor) return cfg.customColor;
  }
  return fallbackKey ? FIXED_COLORS[fallbackKey] : null;
}
function container(title, description, guildId, accentKey = null) {
  const builder = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${title}\n-# ${description}`)
  );
  const color = getAccentColor(guildId, accentKey);
  if (color) builder.setAccentColor(color);
  builder.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  return builder;
}
function button(client, customId, label, style, emojiName, disabled = false) {
  const builder = new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(style)
    .setDisabled(disabled);
  const emoji = componentEmoji(client, emojiName);
  return emoji ? builder.setEmoji(emoji) : builder;
}
function newId() {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}
function truncate(text, max) {
  if (!text) return "";
  const str = String(text);
  return str.length > max ? `${str.slice(0, max - 3)}…` : str;
}
function statusBadge(enabled) {
  return enabled ? "🟢 Ativado" : "🔴 Desativado";
}
function hexColor(value) {
  if (!value) return "—";
  return `#${Number(value).toString(16).padStart(6, "0").toUpperCase()}`;
}
function safeEmoji(client, name) {
  return componentEmoji(client, name);
}
function withAppEmoji(client, option, name) {
  const found = componentEmoji(client, name);
  if (found && found.id) option.emoji = found;
  return option;
}
function automationsRootPanel(client, guildId, userId) {
  const config = getGuildConfig(guildId);
  const am = config.automation.autoMessages;
  const repost = config.automation.repost;
  const reactChannels = Object.keys(config.automation.autoReact?.channels || {}).length;
  const panel = container(
    "Automações",
    "Central de automações do servidor. Escolha abaixo qual subsistema deseja gerenciar.",
    guildId,
    null
  );
  const iaCfg = getIAConfig(guildId);
  const iaEnabled = !!iaCfg.apiKey;
  const reestockCfg = getGuildConfig(guildId).reestock;
  const reestockReady = !!reestockCfg?.channelId;
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    "**▸ Mensagens Auto** — envio periódico de mensagens configuráveis.",
    "**▸ Repostagem** — reposiciona periodicamente os painéis públicos.",
    "**▸ Auto React** — reage automaticamente a mensagens em canais configurados.",
    "**▸ Reestoque** — avisa no canal quando um campo receber estoque (com botão Comprar).",
    "**▸ Sistema de IA** — responde com Groq AI no canal configurado (otimizado).",
    "",
    `Status atual  ·  ${statusBadge(am.enabled)}  **Mensagens Auto**  ·  ${statusBadge(repost.enabled)}  **Repostagem**  ·  ${reactChannels ? "🟢" : "🔴"}  **Auto React** (${reactChannels})  ·  ${reestockReady ? "🟢" : "🔴"}  **Reestoque** ${reestockReady ? `(<#${reestockCfg.channelId}> • ${reestockCfg.mode === "image" ? "imagem" : "container"})` : "(não configurado)"}  ·  ${iaEnabled ? "🟢" : "🔴"}  **IA** ${iaEnabled ? "(Groq OK)" : "(sem API)"}`
  ].join("\n")));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(scoped(ids.autoRootSelect, userId))
      .setPlaceholder("Selecione um subsistema")
      .addOptions(
        withAppEmoji(client, {
          label: "Mensagens Auto",
          value: "auto",
          description: "Crie, gerencie e envie mensagens periódicas."
        }, "recibo"),
        withAppEmoji(client, {
          label: "Repostagem",
          value: "repost",
          description: "Repostagem periódica dos painéis públicos."
        }, "reload"),
        withAppEmoji(client, {
          label: "Auto React",
          value: "reactauto",
          description: "Reaja automaticamente a mensagens em canais escolhidos."
        }, "mais2"),
        withAppEmoji(client, {
          label: "Reestoque",
          value: "reestock",
          description: "Avisa quando um campo receber estoque."
        }, "caixa"),
        withAppEmoji(client, {
          label: "Sistema de IA",
          value: "ia",
          description: "Groq AI • Respostas otimizadas no canal."
        }, "wand")
      )
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped("panel:back:main", userId), "Voltar ao painel principal", ButtonStyle.Secondary, "reload")
  ));
  return panel;
}
function iaRootPanel(client, guildId, userId){
  const cfg=getIAConfig(guildId);
  const hasApi=!!cfg.apiKey;
  const panel=container("Sistema de IA","IA Groq otimizada paraTokens mínimos • Estuda produtos/canais • Bloqueia palavrões/links",guildId, hasApi?"auto":"muted");
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `**▸ API Groq:** ${hasApi ? "🟢 Configurada" : "🔴 Não configurada"}`,
    `**▸ Prompt:** ${cfg.prompt ? "🟢 Personalizado" : "⚪ Padrão (estuda produtos/canais)"}`,
    `**▸ Canal IA:** ${cfg.channelId ? `<#${cfg.channelId}>` : "_nenhum_"}`
  ].join("\n")));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(ids.iaConfig, userId), "Configurar IA", ButtonStyle.Primary, "wand"),
    button(client, scoped(ids.iaChannel, userId), "Configurar Canal", ButtonStyle.Secondary, "canal")
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped("panel:automation", userId), "Voltar", ButtonStyle.Secondary, "reload")
  ));
  return panel;
}
function iaConfigPanel(client, guildId, userId){
  const cfg=getIAConfig(guildId);
  const hasApi=!!cfg.apiKey;
  const panel=container("Configurar IA","Como pegar API Key Groq + editar prompt otimizado",guildId, hasApi?"auto":"muted");
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `**Como pegar API Groq (grátis, 30s):**\n`+
    `1) Acesse https://console.groq.com/keys\n`+
    `2) Login → **Create API Key** → copie \`gsk_...\`\n`+
    `3) Cole no botão **Editar API** abaixo\n`+
    `-# Modelo usado: \`openai/gpt-oss-20b\` • \`max_tokens: 256\` • \`temperature: 0.6\` • Fallback automático • Estável`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `**▸ API:** ${hasApi ? "\`gsk_..."+cfg.apiKey.slice(-4)+"\` 🟢" : "\`não configurada\` 🔴"}\n`+
    `**▸ Prompt:** ${cfg.prompt ? truncate(cfg.prompt,80) : "_padrão: estuda produtos e canais_"}\n`+
    `**▸ Criar produto com IA:** ${hasApi ? "🟢 Liberado" : "🔴 Bloqueado (sem API)"}`
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(ids.iaApi, userId), hasApi?"Alterar API":"Editar API", ButtonStyle.Success, "wand"),
    button(client, scoped(ids.iaPrompt, userId), "Prompt", ButtonStyle.Secondary, "editar")
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(ids.iaRoot, userId), "Voltar", ButtonStyle.Secondary, "reload")
  ));
  return panel;
}
function iaChannelPanel(client, guildId, userId){
  const cfg=getIAConfig(guildId);
  if(!cfg.apiKey){
    const p=container("Canal IA — Bloqueado","Configure a API Groq primeiro",guildId,"warn");
    p.addTextDisplayComponents(new TextDisplayBuilder().setContent(`🔴 **Sem API** → clique em **Configurar IA** → **Editar API**`));
    p.addActionRowComponents(new ActionRowBuilder().addComponents(button(client, scoped(ids.iaConfig, userId), "Configurar IA", ButtonStyle.Primary, "wand")));
    return p;
  }
  const panel=container("Configurar Canal IA","Selecione onde o bot responde com IA",guildId,"auto");
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Canal atual:** ${cfg.channelId ? `<#${cfg.channelId}>` : "_nenhum_"}`));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder().setCustomId(scoped(ids.iaChannelSelect, userId)).setPlaceholder("Selecione um canal de texto").setChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1)
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Ou use ID manual abaixo`));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(ids.iaChannelAddId, userId), "Adicionar ID", ButtonStyle.Secondary, "mais2"),
    button(client, scoped(ids.iaConfig, userId), "Voltar", ButtonStyle.Secondary, "reload")
  ));
  return panel;
}
function iaApiModal(userId){
  return new ModalBuilder().setCustomId(`${ids.iaApiModal}:${userId}`).setTitle("Groq API Key").addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("apiKey").setLabel("gsk_...").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("gsk_...").setMaxLength(200))
  );
}
function iaPromptModal(userId, current){
  return new ModalBuilder().setCustomId(`${ids.iaPromptModal}:${userId}`).setTitle("Prompt da IA").addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("prompt").setLabel("Prompt (opcional)").setStyle(TextInputStyle.Paragraph).setRequired(false).setPlaceholder("Ex: Seja simpático, responda curto...").setValue(truncate(current||"", 1000)).setMaxLength(1000))
  );
}
function iaChannelIdModal(userId){
  return new ModalBuilder().setCustomId(`${ids.iaChannelIdModal}:${userId}`).setTitle("ID do Canal IA").addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("cid").setLabel("ID do canal").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("123456789012345678").setMaxLength(25))
  );
}
function autoMessagesRootPanel(client, guildId, userId) {
  const config = getGuildConfig(guildId);
  const am = config.automation.autoMessages;
  const enabled = am.enabled;
  const messageCount = Object.keys(am.messages || {}).length;
  const panel = container(
    "Mensagens Auto",
    "Envie mensagens automaticamente em canais específicos, em intervalos definidos.",
    guildId,
    enabled ? "auto" : "muted"
  );
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `**▸ Sistema:** ${statusBadge(enabled)}`,
    `**▸ Mensagens configuradas:** ${messageCount}`,
    "",
    enabled
      ? "O sistema está **ativo** e respeita o intervalo individual de cada mensagem."
      : "O sistema está **desativado**. Nenhuma mensagem será enviada mesmo que configurada.",
    "Cada mensagem aceita conteúdo, intervalo, embed, botões e múltiplos canais."
  ].join("\n")));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(
      client,
      scoped(ids.autoAutoToggle, userId),
      enabled ? "Desligar sistema" : "Ligar sistema",
      enabled ? ButtonStyle.Danger : ButtonStyle.Success,
      enabled ? "desligado" : "ligado"
    )
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent("**Gerenciamento**"));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(ids.autoAutoNew, userId), "Nova mensagem", ButtonStyle.Success, "mais2", !enabled),
    button(client, scoped(ids.autoAutoManage, userId), "Gerenciar mensagens", ButtonStyle.Primary, "config2", !enabled)
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(ids.autoAutoView, userId), "Visualizar todas", ButtonStyle.Secondary, "visible", !enabled),
    button(client, scoped("panel:automation", userId), "Voltar", ButtonStyle.Secondary, "reload")
  ));
  return panel;
}
function newMessageModal(userId) {
  return new ModalBuilder()
    .setCustomId(`${ids.modalAutoNew}:${userId}`)
    .setTitle("Nova mensagem automática")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("content")
          .setLabel("Conteúdo da mensagem")
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(2000)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("interval")
          .setLabel("Intervalo em minutos (ex: 30, 60, 120)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("30")
          .setRequired(true)
          .setMaxLength(5)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("imageUrl")
          .setLabel("Link de imagem/GIF (opcional)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder("https://exemplo.com/imagem.png")
      )
    );
}
function editMessageModal(userId, message) {
  return new ModalBuilder()
    .setCustomId(`${ids.modalAutoEdit}:${message.id}:${userId}`)
    .setTitle("Editar mensagem")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("content")
          .setLabel("Conteúdo")
          .setStyle(TextInputStyle.Paragraph)
          .setValue(truncate(message.content, 2000))
          .setMaxLength(2000)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("imageUrl")
          .setLabel("Imagem/GIF (opcional)")
          .setStyle(TextInputStyle.Short)
          .setValue(message.imageUrl || "")
          .setRequired(false)
          .setPlaceholder("https://exemplo.com/imagem.png")
      )
    );
}
function intervalModal(userId, message) {
  return new ModalBuilder()
    .setCustomId(`${ids.modalAutoInterval}:${message.id}:${userId}`)
    .setTitle("Alterar intervalo")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("interval")
          .setLabel("Intervalo em minutos")
          .setStyle(TextInputStyle.Short)
          .setValue(String(message.intervalMin))
          .setRequired(true)
          .setMaxLength(5)
      )
    );
}
function embedColorModal(userId, messageId, currentColor) {
  return new ModalBuilder()
    .setCustomId(`${ids.modalAutoEmbedColor}:${messageId}:${userId}`)
    .setTitle("Cor do embed")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("color")
          .setLabel("Cor hexadecimal (ex: FFFFFF)")
          .setStyle(TextInputStyle.Short)
          .setValue(currentColor ? hexColor(currentColor) : "")
          .setPlaceholder("#FFFFFF")
          .setRequired(false)
          .setMaxLength(7)
      )
    );
}
function btnLabelOnlyModal(userId, messageId) {
  return new ModalBuilder()
    .setCustomId(`${ids.modalAutoBtnLabel}:create:${messageId}:${userId}`)
    .setTitle("Adicionar botão")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("label")
          .setLabel("Texto do botão")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(80)
          .setPlaceholder("Ex: Abrir loja, Suporte, Ver mais")
      )
    );
}
function btnLabelModal(userId, messageId, buttonId, current) {
  return new ModalBuilder()
    .setCustomId(`${ids.modalAutoBtnLabel}:${messageId}:${buttonId}:${userId}`)
    .setTitle("Editar label")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("label")
          .setLabel("Texto do botão")
          .setStyle(TextInputStyle.Short)
          .setValue(current || "")
          .setRequired(true)
          .setMaxLength(80)
      )
    );
}
function btnEmojiIdModal(userId, messageId, buttonId) {
  return new ModalBuilder()
    .setCustomId(`${ids.modalAutoBtnEmojiAddId}:${messageId}:${buttonId}:${userId}`)
    .setTitle("Adicionar emoji por ID")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("emoji")
          .setLabel("ID numérico do emoji")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("123456789012345678")
      )
    );
}
function btnUrlModal(userId, messageId, buttonId, current) {
  return new ModalBuilder()
    .setCustomId(`${ids.modalAutoBtnUrl}:${messageId}:${buttonId}:${userId}`)
    .setTitle("Editar URL")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("url")
          .setLabel("URL (https://...)")
          .setStyle(TextInputStyle.Short)
          .setValue(current || "")
          .setRequired(true)
          .setPlaceholder("https://exemplo.com")
      )
    );
}
function addIdModal(userId, messageId) {
  return new ModalBuilder()
    .setCustomId(`${ids.modalAutoAddId}:${messageId}:${userId}`)
    .setTitle("Adicionar canal por ID")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("channelId")
          .setLabel("ID do canal de texto")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("123456789012345678")
      )
    );
}
function manageMessagesPanel(client, guildId, userId) {
  const config = getGuildConfig(guildId);
  const messages = Object.values(config.automation.autoMessages.messages || {});
  const enabled = config.automation.autoMessages.enabled;
  const panel = container(
    "Gerenciar mensagens",
    "Selecione uma mensagem abaixo para abrir o painel completo de edição.",
    guildId,
    messages.length ? "auto" : "muted"
  );
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `**▸ Sistema:** ${statusBadge(enabled)}`,
    `**▸ Total:** ${messages.length} mensagem(ns) salva(s)`
  ].join("\n")));
  if (!messages.length) {
    panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent("-# Nenhuma mensagem configurada ainda. Use **Nova mensagem** para começar."));
  } else {
    panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    panel.addActionRowComponents(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(scoped(`${ids.autoAutoManage}:select`, userId))
        .setPlaceholder("Selecione a mensagem")
        .addOptions(messages.slice(0, 25).map((m) => withAppEmoji(client, {
          label: truncate(m.content || "Mensagem sem conteúdo", 80),
          value: m.id,
          description: `${m.intervalMin} min · ${(m.channels || []).length} canais · ${(m.buttons || []).length} botões`
        }, "recibo")))
    ));
  }
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(ids.autoAutoNew, userId), "Nova mensagem", ButtonStyle.Success, "mais2", !enabled),
    button(client, scoped(ids.autoAutoRoot, userId), "Voltar", ButtonStyle.Secondary, "reload")
  ));
  return panel;
}
function manageOneMessagePanel(client, guildId, userId, messageId) {
  const config = getGuildConfig(guildId);
  const enabled = config.automation.autoMessages.enabled;
  const message = config.automation.autoMessages.messages?.[messageId];
  if (!message) return manageMessagesPanel(client, guildId, userId);
  const embedStatus = message.embed?.enabled
    ? `🟣 Ativado (${hexColor(message.embed.color)})`
    : "⚪ Desativado";
  const channels = message.channels || [];
  const channelsText = channels.length
    ? channels.map((id) => `<#${id}>`).join("  ·  ")
    : "_Nenhum canal configurado_";
  const buttons = message.buttons || [];
  const buttonsText = buttons.length
    ? buttons.map((b) => `\`${b.label || "Botão"}\``).join("  ·  ")
    : "_Nenhum botão_";
  const panel = container(
    "Editar mensagem",
    "Edite conteúdo, intervalo, embed, botões e canais da mensagem selecionada.",
    guildId,
    "auto"
  );
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    "**▸ Conteúdo**",
    truncate(message.content || "(vazio)", 240),
    "",
    `⏱️  **Intervalo:** ${message.intervalMin} minutos`,
    `🎨  **Embed:** ${embedStatus}`,
    `🔗  **Botões:** ${buttons.length}/${MAX_BUTTONS}  —  ${buttonsText}`,
    `📡  **Canais:** ${channels.length}/${MAX_CHANNELS}  —  ${channelsText}`,
    message.imageUrl ? `🖼️  **Imagem:** ${message.imageUrl}` : null
  ].filter(Boolean).join("\n")));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent("**Ações**"));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(`${ids.autoAutoEdit}:${messageId}`, userId), "Editar mensagem", ButtonStyle.Secondary, "editar", !enabled),
    button(client, scoped(`${ids.autoAutoInterval}:${messageId}`, userId), "Alterar intervalo", ButtonStyle.Secondary, "clock", !enabled)
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(
      client,
      scoped(`${ids.autoAutoEmbedToggle}:${messageId}`, userId),
      message.embed?.enabled ? "Desabilitar Embed" : "Habilitar Embed",
      message.embed?.enabled ? ButtonStyle.Danger : ButtonStyle.Success,
      message.embed?.enabled ? "desligado" : "embed",
      !enabled
    ),
    button(
      client,
      scoped(`${ids.autoAutoEmbedColor}:${messageId}`, userId),
      "Mudar cor",
      ButtonStyle.Primary,
      "wand",
      !enabled || !message.embed?.enabled
    )
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(`${ids.autoAutoButtons}:${messageId}`, userId), `Botões (${buttons.length}/${MAX_BUTTONS})`, ButtonStyle.Secondary, "mais2", !enabled),
    button(client, scoped(`${ids.autoAutoChannels}:${messageId}`, userId), `Canais (${channels.length}/${MAX_CHANNELS})`, ButtonStyle.Secondary, "canal", !enabled)
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(`${ids.autoAutoForceSend}:${messageId}`, userId), "Forçar envio", ButtonStyle.Success, "recibo", !enabled),
    button(client, scoped(`${ids.autoAutoRemove}:${messageId}`, userId), "Remover", ButtonStyle.Danger, "apagar", !enabled)
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(ids.autoAutoManage, userId), "Voltar", ButtonStyle.Secondary, "reload")
  ));
  return panel;
}
function buttonsPanel(client, guildId, userId, messageId) {
  const config = getGuildConfig(guildId);
  const enabled = config.automation.autoMessages.enabled;
  const message = config.automation.autoMessages.messages?.[messageId];
  if (!message) return manageOneMessagePanel(client, guildId, userId, messageId);
  const buttons = message.buttons || [];
  const panel = container(
    "Botões da mensagem",
    `Máximo de **${MAX_BUTTONS}** botões por mensagem. Use o botão abaixo para adicionar o primeiro.`,
    guildId,
    "button"
  );
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `**▸ Botões atuais:** ${buttons.length}/${MAX_BUTTONS}`
  ].join("\n")));
  if (buttons.length) {
    panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    panel.addActionRowComponents(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(scoped(`${ids.autoBtnManage}:${messageId}`, userId))
        .setPlaceholder("Selecione um botão para gerenciar")
        .addOptions(buttons.map((b) => withAppEmoji(client, {
          label: truncate(b.label || "Botão", 80),
          value: b.id,
          description: `${b.url ? "🔗 link" : "sem link"}  ·  ${b.emoji ? "com emoji" : "sem emoji"}`
        }, "mais2")))
    ));
  } else {
    panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent("-# Nenhum botão criado ainda. Adicione o primeiro abaixo."));
  }
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(
      client,
      scoped(`${ids.autoBtnAdd}:${messageId}`, userId),
      "Adicionar botão",
      ButtonStyle.Success,
      "mais2",
      buttons.length >= MAX_BUTTONS || !enabled
    )
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(`${ids.autoAutoManage}:open:${messageId}`, userId), "Voltar", ButtonStyle.Secondary, "reload")
  ));
  return panel;
}
function buttonManagePanel(client, guildId, userId, messageId, buttonId) {
  const config = getGuildConfig(guildId);
  const enabled = config.automation.autoMessages.enabled;
  const message = config.automation.autoMessages.messages?.[messageId];
  const btn = message?.buttons?.find((b) => b.id === buttonId);
  if (!btn) return buttonsPanel(client, guildId, userId, messageId);
  const panel = container(
    "Editar botão",
    "Personalize label, emoji e URL do botão selecionado.",
    guildId,
    "button"
  );
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `**▸ Label**  —  ${btn.label || "_sem label_"}`,
    `**▸ Emoji**  —  ${btn.emoji ? formatEmoji(btn.emoji) : "_nenhum_"}`,
    `**▸ URL**  —  ${btn.url || "_nenhuma_"}`
  ].join("\n")));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(`${ids.autoBtnLabel}:${messageId}:${buttonId}`, userId), "Editar label", ButtonStyle.Secondary, "editar", !enabled)
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(scoped(`${ids.autoBtnEmojiSelect}:${messageId}:${buttonId}`, userId))
      .setPlaceholder("Editar emoji")
      .setDisabled(!enabled)
      .addOptions(
        withAppEmoji(client, { label: "Adicionar por ID", value: "addid", description: "Cole o ID numérico do emoji customizado." }, "wand"),
        withAppEmoji(client, { label: "Lista de emojis da aplicação", value: "list", description: "Escolha um emoji já sincronizado." }, "recibo"),
        withAppEmoji(client, { label: "Remover emoji", value: "remove", description: "Tira o emoji deste botão." }, "apagar")
      )
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(`${ids.autoBtnUrl}:${messageId}:${buttonId}`, userId), "Editar URL", ButtonStyle.Secondary, "wand", !enabled),
    button(client, scoped(`${ids.autoBtnRemove}:${messageId}:${buttonId}`, userId), "Remover botão", ButtonStyle.Danger, "apagar", !enabled)
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(`${ids.autoAutoButtons}:${messageId}`, userId), "Voltar", ButtonStyle.Secondary, "reload")
  ));
  return panel;
}
function emojiPickerPanel(client, guildId, userId, messageId, buttonId) {
  const emojis = client.appEmojis ? [...client.appEmojis.values()].slice(0, 24) : [];
  const panel = container(
    "Escolher emoji",
    "Selecione um emoji da aplicação. Use **Adicionar por ID** se preferir colar um ID numérico.",
    guildId,
    "button"
  );
  if (emojis.length) {
    panel.addActionRowComponents(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(scoped(`${ids.autoBtnManage}:pick:${messageId}:${buttonId}`, userId))
        .setPlaceholder("Escolha um emoji da aplicação")
        .addOptions(emojis.map((e) => ({
          label: truncate(e.name, 80),
          value: e.id,
          description: `ID: ${e.id}`,
          emoji: { id: e.id, name: e.name, animated: e.animated }
        })))
    ));
  } else {
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent("-# Nenhum emoji sincronizado ainda."));
  }
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(`${ids.autoBtnEmojiAddId}:${messageId}:${buttonId}`, userId), "Adicionar por ID", ButtonStyle.Primary, "wand")
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(`${ids.autoBtnManage}:${messageId}:${buttonId}`, userId), "Voltar", ButtonStyle.Secondary, "reload")
  ));
  return panel;
}
function channelsPanel(client, guildId, userId, messageId) {
  const config = getGuildConfig(guildId);
  const enabled = config.automation.autoMessages.enabled;
  const message = config.automation.autoMessages.messages?.[messageId];
  if (!message) return manageOneMessagePanel(client, guildId, userId, messageId);
  const channels = message.channels || [];
  const remaining = Math.max(0, MAX_CHANNELS - channels.length);
  const panel = container(
    "Canais da mensagem",
    `Selecione até **${MAX_CHANNELS}** canais de texto onde a mensagem será enviada.`,
    guildId,
    "auto"
  );
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `**▸ Canais atuais:** ${channels.length}/${MAX_CHANNELS}`,
    `**▸ Vagas restantes:** ${remaining}`
  ].join("\n")));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(scoped(`${ids.autoAutoChannelSelect}:${messageId}`, userId))
      .setPlaceholder(remaining ? `Adicionar até ${remaining} canal(is)` : "Limite atingido")
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(1)
      .setMaxValues(Math.max(1, remaining))
      .setDisabled(!enabled || remaining === 0)
  ));
  if (channels.length) {
    panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent("**Remover canais**"));
    panel.addActionRowComponents(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(scoped(`${ids.autoAutoChannelRemove}:${messageId}`, userId))
        .setPlaceholder("Selecione para remover")
        .setDisabled(!enabled)
        .addOptions(channels.slice(0, 25).map((id) => ({
          label: `Canal #${id.slice(-4)}`,
          value: id,
          description: `ID: ${id}`
        })))
    ));
  }
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(`${ids.autoAutoChannelAddId}:${messageId}`, userId), "Adicionar por ID", ButtonStyle.Secondary, "mais2", !enabled)
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(`${ids.autoAutoManage}:open:${messageId}`, userId), "Voltar", ButtonStyle.Secondary, "reload")
  ));
  return panel;
}
function viewAllPanel(client, guildId, userId, page = 1) {
  const config = getGuildConfig(guildId);
  const messages = Object.values(config.automation.autoMessages.messages || {});
  const totalPages = Math.max(1, Math.ceil(messages.length / PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const slice = messages.slice(start, start + PAGE_SIZE);
  const panel = container(
    "Visualizar todas",
    `Lista completa das mensagens automáticas configuradas neste servidor.`,
    guildId,
    messages.length ? "auto" : "muted"
  );
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `**▸ Total:** ${messages.length} mensagem(ns)`,
    `**▸ Página:** ${currentPage}/${totalPages}`
  ].join("\n")));
  if (!slice.length) {
    panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent("-# Nenhuma mensagem configurada ainda."));
  } else {
    for (const m of slice) {
      const embedInfo = m.embed?.enabled ? `embed ${hexColor(m.embed.color)}` : "sem embed";
      const btns = (m.buttons || []).length;
      const chans = (m.channels || []).length;
      panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
      panel.addTextDisplayComponents(new TextDisplayBuilder().setContent([
        `**▸ #${m.id.slice(-6)}**`,
        truncate(m.content || "(vazio)", 220),
        `⏱️ ${m.intervalMin} min  ·  🎨 ${embedInfo}  ·  🔗 ${btns} botões  ·  📡 ${chans} canais`
      ].join("\n")));
      if (m.imageUrl) {
        panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`🖼️ ${m.imageUrl}`));
      }
    }
  }
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(`${ids.autoAutoView}:${currentPage - 1}`, userId), "◀ Anterior", ButtonStyle.Secondary, "reload", currentPage <= 1),
    button(client, scoped(`${ids.autoAutoView}:page`, userId), `${currentPage}/${totalPages}`, ButtonStyle.Secondary, "visible", true),
    button(client, scoped(`${ids.autoAutoView}:${currentPage + 1}`, userId), "Próximo ▶", ButtonStyle.Secondary, "mais2", currentPage >= totalPages)
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(ids.autoAutoRoot, userId), "Voltar", ButtonStyle.Secondary, "reload")
  ));
  return panel;
}
function repostRootPanel(client, guildId, userId) {
  const config = getGuildConfig(guildId);
  const repost = config.automation.repost;
  const enabled = repost.enabled;
  const sys = repost.systems || {};
  const sysText = [
    `**▸ Vendas:** ${sys.sales ? "🟢 ativado" : "⚪ desativado"}`,
    `**▸ Tickets:** ${sys.tickets ? "🟢 ativado" : "⚪ desativado"}`
  ].join("\n");
  const panel = container(
    "Repostagem",
    "Repostagem periódica dos painéis públicos. O bot procura os painéis que já foram enviados e reposta cada um no seu próprio canal.",
    guildId,
    enabled ? "repost" : "muted"
  );
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `**▸ Sistema:** ${statusBadge(enabled)}`,
    `**▸ Horário:** ${repost.time || "—"}`,
    `**▸ Nuke:** ${repost.nuke ? "🟠 ativado" : "⚪ desativado"}`,
    "",
    sysText,
    "",
    "Não é preciso definir um canal: cada painel público já enviado é repostado no mesmo canal em que está. Quando **Nuke** estiver ativado, o bot apaga e recria esses canais antes de repostar os painéis."
  ].join("\n")));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent("**Ações**"));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(ids.autoRepostSchedule, userId), enabled ? "Desabilitar" : "Definir horário", enabled ? ButtonStyle.Danger : ButtonStyle.Primary, enabled ? "desligado" : "clock"),
    button(client, scoped(ids.autoRepostNuke, userId), repost.nuke ? "Desabilitar Nuke" : "Habilitar Nuke", ButtonStyle.Secondary, repost.nuke ? "desligado" : "wand")
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(ids.autoRepostNow, userId), "Repostar agora", ButtonStyle.Success, "reload"),
    button(client, scoped(ids.autoRepostOpts, userId), "Sistemas (Opcionais)", ButtonStyle.Secondary, "config2")
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped("panel:automation", userId), "Voltar", ButtonStyle.Secondary, "reload")
  ));
  return panel;
}
function repostOptionsPanel(client, guildId, userId) {
  const config = getGuildConfig(guildId);
  const sys = config.automation.repost.systems || {};
  const panel = container(
    "Sistemas Opcionais",
    "Padrão: somente o sistema de Vendas está ativo. Selecione abaixo para alternar.",
    guildId,
    "repost"
  );
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `**▸ Vendas:** ${sys.sales ? "🟢 ativado" : "⚪ desativado"}`,
    `**▸ Tickets:** ${sys.tickets ? "🟢 ativado" : "⚪ desativado"}`,
    "",
    "Ao ativar Tickets, os painéis públicos de ticket também são repostados nos canais onde já foram enviados."
  ].join("\n")));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(scoped(ids.autoRepostOptToggle, userId))
      .setPlaceholder("Selecione o sistema para alternar")
      .addOptions(
        withAppEmoji(client, { label: `Vendas: ${sys.sales ? "ativado" : "desativado"}`, value: "sales", description: "Repostagem dos produtos de vendas." }, "pedidoRealizado"),
        withAppEmoji(client, { label: `Tickets: ${sys.tickets ? "ativado" : "desativado"}`, value: "tickets", description: "Repostagem dos painéis públicos de tickets." }, "canal")
      )
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(ids.autoRepostRoot, userId), "Voltar", ButtonStyle.Secondary, "reload")
  ));
  return panel;
}
function repostScheduleModal(userId, currentTime) {
  return new ModalBuilder()
    .setCustomId(`${ids.modalAutoRepostSchedule}:${userId}`)
    .setTitle("Horário da repostagem")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("time")
          .setLabel("Horário no formato HH:MM (24h)")
          .setStyle(TextInputStyle.Short)
          .setValue(currentTime || "06:00")
          .setPlaceholder("06:00")
          .setMaxLength(5)
          .setRequired(true)
      )
    );
}
function reestockRootPanel(client, guildId, userId){
  const cfg = getGuildConfig(guildId);
  const channelId = cfg.reestock?.channelId || null;
  const mode = cfg.reestock?.mode === "image" ? "image" : "container";
  const panel = container("Reestoque", "Notifica automaticamente quando um campo receber estoque. 100% integrado à loja.", guildId, channelId ? "auto" : "muted");
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `**▸ Canal de aviso:** ${channelId ? `<#${channelId}> 🟢 configurado` : "`nenhum` 🔴 não configurado"}`,
    `**▸ Gatilho:** ao adicionar estoque em **qualquer campo** (manual, fantasma ou .txt)`,
    `**▸ Mensagem:** ${mode === "image" ? "canvas bonito com banner" : "container premium"} com **quantidade, campo, produto** + botão **Comprar Agora** (link para o painel)`,
    ``,
    channelId ? `✅ **Ativo** — toda reposição será anunciada em <#${channelId}>.` : `⚠️ **Selecione um canal** abaixo para ativar os avisos de reposição.`
  ].join("\n")));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `**Tipo do aviso**\n-# Como a reposição aparece no canal.`
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(scoped(ids.reestockMode, userId))
      .setPlaceholder(mode === "image" ? "Atual: Modo imagem" : "Atual: Modo container")
      .addOptions(
        {
          label: "Modo imagem",
          value: "image",
          description: mode === "image" ? "Atual • canvas com banner" : "Canvas bonito com banner do produto",
          emoji: componentEmoji(client, "preview")
        },
        {
          label: "Modo container",
          value: "container",
          description: mode === "container" ? "Atual • cartão em texto" : "Cartão em texto",
          emoji: componentEmoji(client, "caixa")
        }
      )
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(ids.reestockChannel, userId), channelId ? "Alterar Canal" : "Configurar Canal", channelId ? ButtonStyle.Secondary : ButtonStyle.Success, "canal")
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped("panel:automation", userId), "Voltar", ButtonStyle.Secondary, "reload")
  ));
  return panel;
}
function reestockChannelPicker(client, guildId, userId){
  const cfg = getGuildConfig(guildId);
  const current = cfg.reestock?.channelId || null;
  const panel = container("Reestoque — Escolher Canal", `Selecione o canal onde o aviso **bonito** de reposição será enviado.\n${current ? `Atual: <#${current}>` : `Nenhum canal configurado`}`, guildId, "auto");
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(scoped(ids.reestockChannelSelect, userId))
      .setPlaceholder("Selecione um canal de texto")
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(1).setMaxValues(1)
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(ids.reestockRoot, userId), "Voltar", ButtonStyle.Secondary, "reload")
  ));
  return panel;
}
const reestockDedupe = new Map(); 
async function sendReestockNotification(client, guildId, product, field, addedQuantity){
  try{
    const now = Date.now();
    const dkey = `${guildId}:${product?.id || product?.name}:${field?.id || field?.name}:${addedQuantity}`;
    const last = reestockDedupe.get(dkey);
    if (last && now - last < 90000) return;
    reestockDedupe.set(dkey, now);
    if (reestockDedupe.size > 200) {
      for (const [k, t] of reestockDedupe) {
        if (now - t > 90000) reestockDedupe.delete(k);
      }
    }
    const cfg = getGuildConfig(guildId);
    const channelId = cfg.reestock?.channelId;
    if(!channelId) return;
    const channel = await client.channels.fetch(channelId).catch(()=>null);
    if(!channel?.isTextBased()) return;
    const guild = client.guilds.cache.get(guildId);
    let buyUrl = null;
    let buyLabel = "Comprar Agora";
    if(product.publicPanels?.length){
      const p = product.publicPanels[0];
      buyUrl = `https://discord.com/channels/${guildId}/${p.channelId}/${p.messageId}`;
    } else {
      buyUrl = `https://discord.com/channels/${guildId}`;
    }
    const stockTotal = (()=>{ try{ const f = field; if(f.phantom) return f.phantom.quantity==="infinite"?"infinito":String(f.phantom.quantity); return String(f.stock?.length||0);}catch{ return "?"; }})();
    const qtyStr = (()=>{
      if(String(addedQuantity).toLowerCase()==="infinito" || String(addedQuantity)==="∞") return "∞";
      const n = Number(String(addedQuantity).replace(/\D/g,"")) || Number(addedQuantity) || 0;
      if(!n) return String(addedQuantity);
      return `${n}x`;
    })();
    const container = new ContainerBuilder();
    try{
      const sec = new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"caixa")} Reestoque — ${product.name}`),
          new TextDisplayBuilder().setContent(`${inlineEmoji(client,"sparkles")} O campo **${field.name}** recebeu **${qtyStr}** em estoque!`),
          new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client,"clock")} ${new Date().toLocaleString("pt-BR")} ${inlineEmoji(client,"db")} Estoque: **${stockTotal}**`)
        );
      const thumbUrl = product.banner || guild?.iconURL({extension:"png",size:128}) || client.user?.displayAvatarURL();
      if(thumbUrl) sec.setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbUrl).setDescription(product.name));
      container.addSectionComponents(sec);
    }catch{
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"caixa")} Reestoque — ${product.name}\n${inlineEmoji(client,"sparkles")} **${field.name}** • **${qtyStr}**`));
    }
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `${inlineEmoji(client,"caixa")} **Produto:** **${product.name}**\n`+
      `${inlineEmoji(client,"fields")} **Campo:** **${field.name}** ${field.description ? `• ${field.description.slice(0,70)}` : ""}\n`+
      `${inlineEmoji(client,"db")} **Adicionado:** **${qtyStr}** ${inlineEmoji(client,"pricep")} **Total:** **${stockTotal}**\n`+
      `${inlineEmoji(client,"carteira")} **Pronto para comprar** ${inlineEmoji(client,"positivo")} **Disponível agora**`
    ));
    if(product.banner){
      try{ container.addMediaGalleryComponents(new MediaGalleryBuilder({ items:[{ media:{url: product.banner}, description: product.name }] })); }catch{}
    }
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
    const row = new ActionRowBuilder();
    if(buyUrl){
      const linkBtn = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(buyLabel).setURL(buyUrl);
      const emoji = componentEmoji(client,"bag") || componentEmoji(client,"caixa") || componentEmoji(client,"cart");
      if(emoji) linkBtn.setEmoji(emoji);
      row.addComponents(linkBtn);
    }
    const mode = cfg.reestock?.mode === "image" ? "image" : "container";
    if (mode === "image") {
      try {
        const receipt = require("../sales/receipt");
        const fetchBuf = async (url) => {
          try {
            if (!url) return null;
            const r = await fetch(url);
            if (!r.ok) return null;
            return Buffer.from(await r.arrayBuffer());
          } catch { return null; }
        };
        const [guildIconBuffer, bannerBuffer] = await Promise.all([
          fetchBuf(guild?.iconURL({ extension: "png", size: 128 })),
          fetchBuf(product.banner)
        ]);
        const now = new Date();
        const p2 = (n) => String(n).padStart(2, "0");
        const buf = await receipt.generateRestockImage({
          productName: product.name,
          fieldName: field.name,
          addedText: qtyStr,
          totalText: stockTotal === "infinito" ? "∞" : String(stockTotal),
          dateText: `${p2(now.getDate())}/${p2(now.getMonth() + 1)} · ${p2(now.getHours())}:${p2(now.getMinutes())}`,
          guildName: guild?.name || "Loja",
          guildIconBuffer,
          bannerBuffer
        });
        if (buf) {
          const payload = { files: [{ attachment: buf, name: "reestock.png" }] };
          if (buyUrl) payload.components = [row];
          await channel.send(payload).catch(() => null);
          return;
        }
      } catch(e){ console.error("[Reestoque] imagem falhou, usando container:", e.message); }
    }
    container.addActionRowComponents(row);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client,"lightbulb")} Clique em **${buyLabel}** para ir direto ao painel de venda.`));
    await channel.send({ components:[container], flags: MessageFlags.IsComponentsV2 }).catch(()=>null);
  }catch(e){ console.error("[Reestoque] Falha ao enviar", e.message); }
}
function getAutoReactChannels(guildId) {
  const config = getGuildConfig(guildId);
  return config.automation.autoReact?.channels || {};
}
function autoReactRootPanel(client, guildId, userId) {
  const channels = Object.values(getAutoReactChannels(guildId));
  const description = channels.length
    ? truncate(`Auto reacts criados: ${channels.map((c) => `<#${c.channelId}>`).join(", ")}`, 300)
    : "Nenhum auto react criado ainda. O bot reage automaticamente às mensagens enviadas nos canais configurados.";
  const panel = container("Auto React", description, guildId, channels.length ? "auto" : "muted");
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `**▸ Canais configurados:** ${channels.length}`,
    ...channels.map((c) => `<#${c.channelId}>  —  ${c.emoji ? formatEmoji(c.emoji) : "_sem emoji configurado_"}`)
  ].join("\n")));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  if (channels.length) {
    panel.addActionRowComponents(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(scoped(ids.autoReactManageSelect, userId))
        .setPlaceholder("Selecione um canal configurado")
        .addOptions(channels.slice(0, 25).map((c) => {
          const ch = client.channels.cache.get(c.channelId);
          return {
            label: truncate(ch ? `#${ch.name}` : `Canal ${c.channelId.slice(-4)}`, 80),
            value: c.channelId,
            description: c.emoji ? `Emoji: ${c.emoji.name || "customizado"}` : "Sem emoji configurado"
          };
        }))
    ));
  }
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(ids.autoReactCreate, userId), "Criar", ButtonStyle.Success, "mais2"),
    button(client, scoped(ids.autoReactRemove, userId), "Remover", ButtonStyle.Danger, "apagar", !channels.length)
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped("panel:automation", userId), "Voltar", ButtonStyle.Secondary, "reload")
  ));
  return panel;
}
function autoReactCreatePanel(client, guildId, userId) {
  const panel = container(
    "Criar Auto React",
    "Selecione o canal de texto onde o bot deverá reagir automaticamente às mensagens.",
    guildId,
    "auto"
  );
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(scoped(ids.autoReactCreateSelect, userId))
      .setPlaceholder("Selecione um canal")
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(1)
      .setMaxValues(1)
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(ids.autoReactRoot, userId), "Voltar", ButtonStyle.Secondary, "reload")
  ));
  return panel;
}
function autoReactChannelPanel(client, guildId, userId, channelId) {
  const entry = getAutoReactChannels(guildId)[channelId];
  if (!entry) return autoReactRootPanel(client, guildId, userId);
  const panel = container(
    "Auto React — Canal configurado",
    "Informações do auto react configurado para este canal.",
    guildId,
    "auto"
  );
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `**▸ Canal:** <#${entry.channelId}>`,
    `**▸ Emoji:** ${entry.emoji ? formatEmoji(entry.emoji) : "_nenhum configurado_"}`,
    `**▸ Status:** ${entry.emoji ? "🟢 Reagindo automaticamente" : "🟡 Aguardando configuração do emoji"}`
  ].join("\n")));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(`${ids.autoReactEmoji}:${channelId}`, userId), "Configurar Emoji", ButtonStyle.Primary, "wand"),
    button(client, scoped(ids.autoReactRoot, userId), "Voltar", ButtonStyle.Secondary, "reload")
  ));
  return panel;
}
function autoReactEmojiPanel(client, guildId, userId, channelId) {
  const entry = getAutoReactChannels(guildId)[channelId];
  if (!entry) return autoReactRootPanel(client, guildId, userId);
  const guild = client.guilds.cache.get(guildId);
  const emojis = guild ? [...guild.emojis.cache.values()].slice(0, 24) : [];
  const panel = container(
    "Configurar emoji",
    "Selecione um emoji do servidor. Use **Adicionar por ID** se preferir colar um ID numérico.",
    guildId,
    "auto"
  );
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `**▸ Canal:** <#${entry.channelId}>`,
    `**▸ Emoji atual:** ${entry.emoji ? formatEmoji(entry.emoji) : "_nenhum_"}`
  ].join("\n")));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  if (emojis.length) {
    panel.addActionRowComponents(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(scoped(`${ids.autoReactEmojiSelect}:${channelId}`, userId))
        .setPlaceholder("Escolha um emoji do servidor")
        .addOptions(emojis.map((e) => ({
          label: truncate(e.name, 80),
          value: e.id,
          description: `ID: ${e.id}`,
          emoji: { id: e.id, name: e.name, animated: e.animated }
        })))
    ));
  } else {
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent("-# Nenhum emoji customizado encontrado neste servidor."));
  }
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(`${ids.autoReactEmojiAddId}:${channelId}`, userId), "Adicionar por ID", ButtonStyle.Primary, "wand")
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(`${ids.autoReactOpen}:${channelId}`, userId), "Voltar", ButtonStyle.Secondary, "reload")
  ));
  return panel;
}
function autoReactRemovePanel(client, guildId, userId) {
  const channels = Object.values(getAutoReactChannels(guildId));
  const panel = container(
    "Remover Auto React",
    "Selecione o canal que deve deixar de reagir automaticamente às mensagens.",
    guildId,
    "auto"
  );
  if (channels.length) {
    panel.addActionRowComponents(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(scoped(ids.autoReactRemoveSelect, userId))
        .setPlaceholder("Selecione o canal para remover")
        .addOptions(channels.slice(0, 25).map((c) => {
          const ch = client.channels.cache.get(c.channelId);
          return {
            label: truncate(ch ? `#${ch.name}` : `Canal ${c.channelId.slice(-4)}`, 80),
            value: c.channelId,
            description: c.emoji ? `Emoji: ${c.emoji.name || "customizado"}` : "Sem emoji configurado"
          };
        }))
    ));
  } else {
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent("-# Nenhum canal configurado."));
  }
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, scoped(ids.autoReactRoot, userId), "Voltar", ButtonStyle.Secondary, "reload")
  ));
  return panel;
}
function reactEmojiIdModal(userId, channelId) {
  return new ModalBuilder()
    .setCustomId(`${ids.modalAutoReactEmojiAddId}:${channelId}:${userId}`)
    .setTitle("Adicionar emoji por ID")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("emoji")
          .setLabel("ID numérico do emoji")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("123456789012345678")
      )
    );
}
async function handleAutoReactMessage(message) {
  if (!message.guild || message.author?.bot) return false;
  const config = getGuildConfig(message.guild.id);
  const entry = config.automation.autoReact?.channels?.[message.channel.id];
  if (!entry?.emoji) return false;
  try {
    const emoji = entry.emoji.id
      ? `${entry.emoji.name || "emoji"}:${entry.emoji.id}`
      : entry.emoji.name;
    await message.react(emoji);
    return true;
  } catch (error) {
    console.warn(`[Auto React] Falha ao reagir na guild ${message.guild.id}: ${error.message}`);
    return false;
  }
}
function formatEmoji(emoji) {
  if (!emoji) return "nenhum";
  if (typeof emoji === "string") return emoji;
  if (emoji.id) return `<${emoji.animated ? "a" : ""}:${emoji.name || "emoji"}:${emoji.id}>`;
  return emoji.name || "nenhum";
}
function parseEmojiInput(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const customMatch = trimmed.match(/^<?a?:?([a-zA-Z0-9_]+):(\d+)>?$/);
  if (customMatch) {
    return { id: customMatch[2], name: customMatch[1], animated: trimmed.startsWith("<a:") };
  }
  if (/^\d+$/.test(trimmed)) {
    return { id: trimmed, name: "emoji", animated: false };
  }
  return { name: trimmed };
}
function buildMessageComponents(message) {
  const buttons = (message.buttons || []).slice(0, MAX_BUTTONS);
  if (!buttons.length) return [];
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    const slice = buttons.slice(i, i + 5);
    rows.push(new ActionRowBuilder().addComponents(
      slice.map((b) => {
        const builder = new ButtonBuilder()
          .setURL(b.url || "https://discord.com")
          .setLabel(b.label || "Botão")
          .setStyle(ButtonStyle.Link);
        if (b.emoji) {
          if (typeof b.emoji === "string") builder.setEmoji(b.emoji);
          else if (b.emoji.id) builder.setEmoji({ id: b.emoji.id, name: b.emoji.name, animated: b.emoji.animated });
          else if (b.emoji.name) builder.setEmoji(b.emoji.name);
        }
        return builder;
      })
    ));
  }
  return rows;
}
async function sendAutoMessage(client, guildId, messageId, force = false) {
  const config = getGuildConfig(guildId);
  const message = config.automation.autoMessages.messages?.[messageId];
  if (!message) return { ok: false, error: "Mensagem não encontrada." };
  const channels = message.channels || [];
  if (!channels.length) return { ok: false, error: "Nenhum canal configurado." };
  const state = getGuildState(guildId);
  const last = state.lastSent?.[messageId] || 0;
  if (!force && last && Date.now() - last < message.intervalMin * 60_000) {
    return { ok: false, error: "Intervalo ainda não atingido." };
  }
  const previousSent = { ...(state.sentMessages?.[messageId] || {}) };
  for (const channelId of Object.keys(previousSent)) {
    try {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel?.isTextBased?.()) continue;
      const msg = await channel.messages.fetch(previousSent[channelId]).catch(() => null);
      if (msg) await msg.delete().catch(() => null);
    } catch {
    }
  }
  const embed = message.embed?.enabled
    ? new EmbedBuilder().setColor(message.embed.color || null).setDescription(message.content || null)
    : null;
  const components = buildMessageComponents(message);
  const results = [];
  const newSentMap = {};
  for (const channelId of channels) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased?.()) {
      results.push({ channelId, ok: false, error: "Canal inválido." });
      continue;
    }
    try {
      const sent = await channel.send({
        content: embed ? null : (message.content || null),
        embeds: embed ? [embed] : undefined,
        components: components.length ? components : undefined,
        files: message.imageUrl ? [message.imageUrl] : undefined
      });
      newSentMap[channelId] = sent.id;
      results.push({ channelId, ok: true });
    } catch (error) {
      results.push({ channelId, ok: false, error: error.message });
    }
  }
  if (results.some((r) => r.ok)) {
    setGuildState(guildId, (s) => {
      s.lastSent[messageId] = Date.now();
      s.sentMessages[messageId] = newSentMap;
      return s;
    });
  }
  return { ok: true, results };
}
async function sendSystemLog(guild, client, content) {
  const config = getGuildConfig(guild.id);
  const channelId = config.channels.systemLogs || config.channels.generalLogs;
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(FIXED_COLORS.warn)
        .setTitle("⚠️ Sistema de Automações")
        .setDescription(content)
        .setTimestamp(new Date())
    ]
  }).catch(() => null);
}
function selectedValue(interaction) {
  if (!interaction) return undefined;
  if (typeof interaction.values === "string") return interaction.values;
  if (Array.isArray(interaction.values) && interaction.values.length) return interaction.values[0];
  return undefined;
}
function selectedValues(interaction) {
  if (!interaction) return [];
  if (Array.isArray(interaction.values)) return interaction.values;
  if (typeof interaction.values === "string" && interaction.values) return [interaction.values];
  return [];
}
async function handleAutomationComponent(interaction, baseId) {
  const client = interaction.client;
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  try {
    const { hasBotPermission } = require("../perms");
    const { PermissionFlagsBits } = require("discord.js");
    const { getGuildConfig } = require("../../storage");
    const canUse = hasBotPermission(interaction) || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) || Boolean(getGuildConfig(guildId).roles.admin && interaction.member?.roles?.cache?.has(getGuildConfig(guildId).roles.admin));
    if (!canUse) {
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) await interaction.reply({ content: "Você não tem permissão para configurar automações.", flags: require("discord.js").MessageFlags.Ephemeral }).catch(()=>null);
      return true;
    }
  } catch {}
  if (baseId === ids.autoRootSelect) {
    const choice = selectedValue(interaction);
    if (choice === "auto") {
      await interaction.update(panelPayload(autoMessagesRootPanel(client, guildId, userId)));
    } else if (choice === "repost") {
      await interaction.update(panelPayload(repostRootPanel(client, guildId, userId)));
    } else if (choice === "reactauto") {
      await interaction.update(panelPayload(autoReactRootPanel(client, guildId, userId)));
    } else if (choice === "reestock") {
      await interaction.update(panelPayload(reestockRootPanel(client, guildId, userId)));
    } else if (choice === "ia") {
      await interaction.update(panelPayload(iaRootPanel(client, guildId, userId)));
    }
    return true;
  }
  if (baseId === ids.iaRoot) {
    await interaction.update(panelPayload(iaRootPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.iaConfig) {
    await interaction.update(panelPayload(iaConfigPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.iaApi) {
    await interaction.showModal(iaApiModal(userId));
    return true;
  }
  if (baseId === ids.iaPrompt) {
    const cfg=getIAConfig(guildId);
    await interaction.showModal(iaPromptModal(userId, cfg.prompt));
    return true;
  }
  if (baseId === ids.iaChannel) {
    await interaction.update(panelPayload(iaChannelPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.iaChannelSelect) {
    const cid=selectedValue(interaction);
    if(!cid || !/^\d{15,25}$/.test(cid)){ await interaction.reply({ content:"Canal inválido.", flags: MessageFlags.Ephemeral }).catch(()=>null); return true; }
    setIAConfig(guildId, c=>({ ...c, channelId: cid }));
    await interaction.update(panelPayload(iaChannelPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.iaChannelAddId) {
    await interaction.showModal(iaChannelIdModal(userId));
    return true;
  }
  if (baseId === ids.reestockRoot) {
    await interaction.update(panelPayload(reestockRootPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.reestockMode) {
    const value = interaction.values?.[0];
    if (value !== "container" && value !== "image") return true;
    setGuildConfig(guildId, c=>{ c.reestock = c.reestock || {}; c.reestock.mode = value; return c; });
    await interaction.update(reestockRootPanel(client, guildId, userId));
    return true;
  }
  if (baseId === ids.reestockChannel) {
    await interaction.update(panelPayload(reestockChannelPicker(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.reestockChannelSelect) {
    const cid = selectedValue(interaction);
    if(!cid || !/^\d{15,25}$/.test(cid)){
      await interaction.reply({ content:"Canal inválido. Selecione um canal de texto.", flags: MessageFlags.Ephemeral }).catch(()=>null);
      return true;
    }
    const ch = await client.channels.fetch(cid).catch(()=>null);
    if(!ch?.isTextBased()){
      await interaction.reply({ content:"Canal precisa ser de texto.", flags: MessageFlags.Ephemeral }).catch(()=>null);
      return true;
    }
    setGuildConfig(guildId, c=>{ c.reestock = c.reestock || {}; c.reestock.channelId = cid; return c; });
    await interaction.update(panelPayload(reestockRootPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.autoAutoRoot) {
    await interaction.update(panelPayload(autoMessagesRootPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.autoAutoToggle) {
    setGuildConfig(guildId, (config) => {
      config.automation.autoMessages.enabled = !config.automation.autoMessages.enabled;
      return config;
    });
    await interaction.update(panelPayload(autoMessagesRootPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.autoAutoNew) {
    await interaction.showModal(newMessageModal(userId));
    return true;
  }
  if (baseId === ids.autoAutoManage) {
    await interaction.update(panelPayload(manageMessagesPanel(client, guildId, userId)));
    return true;
  }
  if (baseId.startsWith(`${ids.autoAutoManage}:open:`)) {
    const messageId = baseId.replace(`${ids.autoAutoManage}:open:`, "");
    await interaction.update(panelPayload(manageOneMessagePanel(client, guildId, userId, messageId)));
    return true;
  }
  if (baseId === `${ids.autoAutoManage}:select`) {
    const messageId = selectedValue(interaction);
    if (!messageId) return true;
    await interaction.update(panelPayload(manageOneMessagePanel(client, guildId, userId, messageId)));
    return true;
  }
  if (baseId === ids.autoAutoView) {
    await interaction.update(panelPayload(viewAllPanel(client, guildId, userId, 1)));
    return true;
  }
  if (baseId.startsWith(`${ids.autoAutoView}:`)) {
    const pageStr = baseId.replace(`${ids.autoAutoView}:`, "");
    if (pageStr === "page") return true;
    const page = Number(pageStr);
    if (!Number.isFinite(page)) return true;
    await interaction.update(panelPayload(viewAllPanel(client, guildId, userId, page)));
    return true;
  }
  if (baseId.startsWith(`${ids.autoAutoEdit}:`)) {
    const messageId = baseId.replace(`${ids.autoAutoEdit}:`, "");
    const config = getGuildConfig(guildId);
    const message = config.automation.autoMessages.messages?.[messageId];
    if (!message) return true;
    await interaction.showModal(editMessageModal(userId, message));
    return true;
  }
  if (baseId.startsWith(`${ids.autoAutoInterval}:`)) {
    const messageId = baseId.replace(`${ids.autoAutoInterval}:`, "");
    const config = getGuildConfig(guildId);
    const message = config.automation.autoMessages.messages?.[messageId];
    if (!message) return true;
    await interaction.showModal(intervalModal(userId, message));
    return true;
  }
  if (baseId.startsWith(`${ids.autoAutoEmbedToggle}:`)) {
    const messageId = baseId.replace(`${ids.autoAutoEmbedToggle}:`, "");
    setGuildConfig(guildId, (config) => {
      const message = config.automation.autoMessages.messages?.[messageId];
      if (!message) return config;
      if (message.embed?.enabled) {
        message.embed.enabled = false;
      } else {
        message.embed = { enabled: true, color: message.embed?.color || (config.customColor || null) };
      }
      return config;
    });
    await interaction.update(panelPayload(manageOneMessagePanel(client, guildId, userId, messageId)));
    return true;
  }
  if (baseId.startsWith(`${ids.autoAutoEmbedColor}:`)) {
    const messageId = baseId.replace(`${ids.autoAutoEmbedColor}:`, "");
    const config = getGuildConfig(guildId);
    const message = config.automation.autoMessages.messages?.[messageId];
    if (!message) return true;
    await interaction.showModal(embedColorModal(userId, messageId, message.embed?.color));
    return true;
  }
  if (baseId.startsWith(`${ids.autoAutoButtons}:`)) {
    const messageId = baseId.replace(`${ids.autoAutoButtons}:`, "");
    await interaction.update(panelPayload(buttonsPanel(client, guildId, userId, messageId)));
    return true;
  }
  if (baseId.startsWith(`${ids.autoAutoForceSend}:`)) {
    const messageId = baseId.replace(`${ids.autoAutoForceSend}:`, "");
    const result = await sendAutoMessage(client, guildId, messageId, true);
    const summary = result.ok
      ? `Mensagem enviada em ${result.results.filter((r) => r.ok).length}/${result.results.length} canal(is).`
      : `Falha: ${result.error}`;
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: summary, flags: MessageFlags.Ephemeral }).catch(() => null);
    } else {
      await interaction.reply({ content: summary, flags: MessageFlags.Ephemeral });
    }
    return true;
  }
  if (baseId.startsWith(`${ids.autoAutoRemove}:`)) {
    const messageId = baseId.replace(`${ids.autoAutoRemove}:`, "");
    try {
      const state = getGuildState(guildId);
      const sent = state.sentMessages?.[messageId] || {};
      for (const channelId of Object.keys(sent)) {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel?.isTextBased?.()) continue;
        const msg = await channel.messages.fetch(sent[channelId]).catch(() => null);
        if (msg) await msg.delete().catch(() => null);
      }
    } catch {}
    setGuildConfig(guildId, (config) => {
      delete config.automation.autoMessages.messages?.[messageId];
      return config;
    });
    setGuildState(guildId, (s) => {
      delete s.lastSent?.[messageId];
      delete s.sentMessages?.[messageId];
      return s;
    });
    await interaction.update(panelPayload(manageMessagesPanel(client, guildId, userId)));
    return true;
  }
  if (baseId.startsWith(`${ids.autoAutoChannels}:`)) {
    const messageId = baseId.replace(`${ids.autoAutoChannels}:`, "");
    await interaction.update(panelPayload(channelsPanel(client, guildId, userId, messageId)));
    return true;
  }
  if (baseId.startsWith(`${ids.autoAutoChannelSelect}:`)) {
    const messageId = baseId.replace(`${ids.autoAutoChannelSelect}:`, "");
    const channelIds = selectedValues(interaction).slice(0, MAX_CHANNELS);
    setGuildConfig(guildId, (config) => {
      const message = config.automation.autoMessages.messages?.[messageId];
      if (!message) return config;
      const set = new Set([...(message.channels || []), ...channelIds]);
      message.channels = [...set].slice(0, MAX_CHANNELS);
      return config;
    });
    await interaction.update(panelPayload(channelsPanel(client, guildId, userId, messageId)));
    return true;
  }
  if (baseId.startsWith(`${ids.autoAutoChannelRemove}:`)) {
    const messageId = baseId.replace(`${ids.autoAutoChannelRemove}:`, "");
    const channelId = selectedValue(interaction);
    if (!channelId) return true;
    setGuildConfig(guildId, (config) => {
      const message = config.automation.autoMessages.messages?.[messageId];
      if (!message) return config;
      message.channels = (message.channels || []).filter((id) => id !== channelId);
      return config;
    });
    await interaction.update(panelPayload(channelsPanel(client, guildId, userId, messageId)));
    return true;
  }
  if (baseId.startsWith(`${ids.autoAutoChannelAddId}:`)) {
    const messageId = baseId.replace(`${ids.autoAutoChannelAddId}:`, "");
    await interaction.showModal(addIdModal(userId, messageId));
    return true;
  }
  if (baseId.startsWith(`${ids.autoBtnAdd}:`)) {
    const messageId = baseId.replace(`${ids.autoBtnAdd}:`, "");
    const config = getGuildConfig(guildId);
    const message = config.automation.autoMessages.messages?.[messageId];
    if (!message || (message.buttons || []).length >= MAX_BUTTONS) return true;
    await interaction.showModal(btnLabelOnlyModal(userId, messageId));
    return true;
  }
  if (baseId.startsWith(`${ids.autoBtnManage}:`) && !baseId.startsWith(`${ids.autoBtnManage}:pick:`)) {
    const rest = baseId.replace(`${ids.autoBtnManage}:`, "");
    const [messageId, buttonId] = rest.split(":");
    if (!messageId || !buttonId) return true;
    await interaction.update(panelPayload(buttonManagePanel(client, guildId, userId, messageId, buttonId)));
    return true;
  }
  if (baseId.startsWith(`${ids.autoBtnManage}:pick:`)) {
    const rest = baseId.replace(`${ids.autoBtnManage}:pick:`, "");
    const [messageId, buttonId] = rest.split(":");
    if (!messageId || !buttonId) return true;
    const emojiId = selectedValue(interaction);
    if (!emojiId) return true;
    const emojiEntry = client.appEmojis?.get(emojiId) || { id: emojiId };
    setGuildConfig(guildId, (config) => {
      const message = config.automation.autoMessages.messages?.[messageId];
      const btn = message?.buttons?.find((b) => b.id === buttonId);
      if (btn) btn.emoji = { id: emojiEntry.id, name: emojiEntry.name || "emoji", animated: !!emojiEntry.animated };
      return config;
    });
    await interaction.update(panelPayload(buttonManagePanel(client, guildId, userId, messageId, buttonId)));
    return true;
  }
  if (baseId.startsWith(`${ids.autoBtnEmojiSelect}:`)) {
    const rest = baseId.replace(`${ids.autoBtnEmojiSelect}:`, "");
    const [messageId, buttonId] = rest.split(":");
    if (!messageId || !buttonId) return true;
    const choice = selectedValue(interaction);
    if (!choice) return true;
    if (choice === "addid") {
      await interaction.showModal(btnEmojiIdModal(userId, messageId, buttonId));
      return true;
    }
    if (choice === "remove") {
      setGuildConfig(guildId, (config) => {
        const message = config.automation.autoMessages.messages?.[messageId];
        const btn = message?.buttons?.find((b) => b.id === buttonId);
        if (btn) delete btn.emoji;
        return config;
      });
      await interaction.update(panelPayload(buttonManagePanel(client, guildId, userId, messageId, buttonId)));
      return true;
    }
    if (choice === "list") {
      await interaction.update(panelPayload(emojiPickerPanel(client, guildId, userId, messageId, buttonId)));
      return true;
    }
    return true;
  }
  if (baseId.startsWith(`${ids.autoBtnEmojiAddId}:`)) {
    const rest = baseId.replace(`${ids.autoBtnEmojiAddId}:`, "");
    const [messageId, buttonId] = rest.split(":");
    if (!messageId || !buttonId) return true;
    await interaction.showModal(btnEmojiIdModal(userId, messageId, buttonId));
    return true;
  }
  if (baseId.startsWith(`${ids.autoBtnLabel}:`)) {
    const rest = baseId.replace(`${ids.autoBtnLabel}:`, "");
    const [messageId, buttonId] = rest.split(":");
    if (!messageId || !buttonId) return true;
    const config = getGuildConfig(guildId);
    const btn = config.automation.autoMessages.messages?.[messageId]?.buttons?.find((b) => b.id === buttonId);
    await interaction.showModal(btnLabelModal(userId, messageId, buttonId, btn?.label));
    return true;
  }
  if (baseId.startsWith(`${ids.autoBtnUrl}:`)) {
    const rest = baseId.replace(`${ids.autoBtnUrl}:`, "");
    const [messageId, buttonId] = rest.split(":");
    if (!messageId || !buttonId) return true;
    const config = getGuildConfig(guildId);
    const btn = config.automation.autoMessages.messages?.[messageId]?.buttons?.find((b) => b.id === buttonId);
    await interaction.showModal(btnUrlModal(userId, messageId, buttonId, btn?.url));
    return true;
  }
  if (baseId.startsWith(`${ids.autoBtnRemove}:`)) {
    const rest = baseId.replace(`${ids.autoBtnRemove}:`, "");
    const [messageId, buttonId] = rest.split(":");
    if (!messageId || !buttonId) return true;
    setGuildConfig(guildId, (config) => {
      const message = config.automation.autoMessages.messages?.[messageId];
      if (message) message.buttons = (message.buttons || []).filter((b) => b.id !== buttonId);
      return config;
    });
    await interaction.update(panelPayload(buttonsPanel(client, guildId, userId, messageId)));
    return true;
  }
  if (baseId === ids.autoRepostRoot) {
    await interaction.update(panelPayload(repostRootPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.autoRepostSchedule) {
    const config = getGuildConfig(guildId);
    if (config.automation.repost.enabled) {
      setGuildConfig(guildId, (c) => {
        c.automation.repost.enabled = false;
        return c;
      });
      await interaction.update(panelPayload(repostRootPanel(client, guildId, userId)));
    } else {
      await interaction.showModal(repostScheduleModal(userId, config.automation.repost.time));
    }
    return true;
  }
  if (baseId === ids.autoRepostNuke) {
    setGuildConfig(guildId, (c) => {
      c.automation.repost.nuke = !c.automation.repost.nuke;
      return c;
    });
    await interaction.update(panelPayload(repostRootPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.autoRepostNow) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await runRepost(client, guildId);
    await interaction.editReply({ content: result.summary });
    return true;
  }
  if (baseId === ids.autoRepostOpts) {
    await interaction.update(panelPayload(repostOptionsPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.autoRepostOptToggle) {
    const system = selectedValue(interaction);
    if (!system) return true;
    setGuildConfig(guildId, (c) => {
      c.automation.repost.systems[system] = !c.automation.repost.systems[system];
      return c;
    });
    await interaction.update(panelPayload(repostOptionsPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.autoReactRoot) {
    await interaction.update(panelPayload(autoReactRootPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.autoReactManageSelect) {
    const channelId = selectedValue(interaction);
    if (!channelId) return true;
    await interaction.update(panelPayload(autoReactChannelPanel(client, guildId, userId, channelId)));
    return true;
  }
  if (baseId === ids.autoReactCreate) {
    await interaction.update(panelPayload(autoReactCreatePanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.autoReactCreateSelect) {
    const channelId = selectedValue(interaction);
    if (!channelId) return true;
    setGuildConfig(guildId, (config) => {
      config.automation.autoReact.channels[channelId] ||= {
        channelId,
        emoji: null,
        createdAt: Date.now()
      };
      return config;
    });
    await interaction.update(panelPayload(autoReactChannelPanel(client, guildId, userId, channelId)));
    return true;
  }
  if (baseId.startsWith(`${ids.autoReactOpen}:`)) {
    const channelId = baseId.replace(`${ids.autoReactOpen}:`, "");
    await interaction.update(panelPayload(autoReactChannelPanel(client, guildId, userId, channelId)));
    return true;
  }
  if (baseId.startsWith(`${ids.autoReactEmoji}:`) && !baseId.startsWith(`${ids.autoReactEmojiSelect}:`) && !baseId.startsWith(`${ids.autoReactEmojiAddId}:`)) {
    const channelId = baseId.replace(`${ids.autoReactEmoji}:`, "");
    await interaction.update(panelPayload(autoReactEmojiPanel(client, guildId, userId, channelId)));
    return true;
  }
  if (baseId.startsWith(`${ids.autoReactEmojiSelect}:`)) {
    const channelId = baseId.replace(`${ids.autoReactEmojiSelect}:`, "");
    const emojiId = selectedValue(interaction);
    if (!emojiId) return true;
    const guild = client.guilds.cache.get(guildId);
    const emojiEntry = guild?.emojis.cache.get(emojiId) || { id: emojiId };
    setGuildConfig(guildId, (config) => {
      const entry = config.automation.autoReact.channels?.[channelId];
      if (entry) entry.emoji = { id: emojiEntry.id, name: emojiEntry.name || "emoji", animated: !!emojiEntry.animated };
      return config;
    });
    await interaction.update(panelPayload(autoReactChannelPanel(client, guildId, userId, channelId)));
    return true;
  }
  if (baseId.startsWith(`${ids.autoReactEmojiAddId}:`)) {
    const channelId = baseId.replace(`${ids.autoReactEmojiAddId}:`, "");
    await interaction.showModal(reactEmojiIdModal(userId, channelId));
    return true;
  }
  if (baseId === ids.autoReactRemove) {
    await interaction.update(panelPayload(autoReactRemovePanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.autoReactRemoveSelect) {
    const channelId = selectedValue(interaction);
    if (!channelId) return true;
    setGuildConfig(guildId, (config) => {
      delete config.automation.autoReact.channels?.[channelId];
      return config;
    });
    await interaction.update(panelPayload(autoReactRootPanel(client, guildId, userId)));
    return true;
  }
  return false;
}
async function handleAutomationModal(interaction, baseId) {
  const client = interaction.client;
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  if (baseId === ids.modalAutoNew) {
    const content = interaction.fields.getTextInputValue("content").trim();
    const interval = parseInt(interaction.fields.getTextInputValue("interval").trim(), 10);
    const imageUrl = interaction.fields.getTextInputValue("imageUrl").trim();
    if (!content || content.length > 2000) {
      await interaction.reply({ content: "Conteúdo inválido ou muito longo.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (!Number.isFinite(interval) || interval < 1 || interval > 10080) {
      await interaction.reply({ content: "Intervalo inválido. Use entre 1 e 10080 minutos.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
      await interaction.reply({ content: "URL de imagem/GIF inválida.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const id = newId();
    setGuildConfig(guildId, (config) => {
      config.automation.autoMessages.messages[id] = {
        id,
        content,
        intervalMin: interval,
        imageUrl: imageUrl || null,
        embed: { enabled: false, color: null },
        buttons: [],
        channels: []
      };
      return config;
    });
    await interaction.update(panelPayload(manageOneMessagePanel(client, guildId, userId, id)));
    return true;
  }
  if (baseId.startsWith(`${ids.modalAutoEdit}:`)) {
    const messageId = baseId.replace(`${ids.modalAutoEdit}:`, "");
    const content = interaction.fields.getTextInputValue("content").trim();
    const imageUrl = interaction.fields.getTextInputValue("imageUrl").trim();
    if (!content || content.length > 2000) {
      await interaction.reply({ content: "Conteúdo inválido.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
      await interaction.reply({ content: "URL de imagem/GIF inválida.", flags: MessageFlags.Ephemeral });
      return true;
    }
    setGuildConfig(guildId, (config) => {
      const message = config.automation.autoMessages.messages?.[messageId];
      if (message) {
        message.content = content;
        message.imageUrl = imageUrl || null;
      }
      return config;
    });
    await interaction.update(panelPayload(manageOneMessagePanel(client, guildId, userId, messageId)));
    return true;
  }
  if (baseId.startsWith(`${ids.modalAutoInterval}:`)) {
    const messageId = baseId.replace(`${ids.modalAutoInterval}:`, "");
    const interval = parseInt(interaction.fields.getTextInputValue("interval").trim(), 10);
    if (!Number.isFinite(interval) || interval < 1 || interval > 10080) {
      await interaction.reply({ content: "Intervalo inválido.", flags: MessageFlags.Ephemeral });
      return true;
    }
    setGuildConfig(guildId, (config) => {
      const message = config.automation.autoMessages.messages?.[messageId];
      if (message) message.intervalMin = interval;
      return config;
    });
    await interaction.update(panelPayload(manageOneMessagePanel(client, guildId, userId, messageId)));
    return true;
  }
  if (baseId.startsWith(`${ids.modalAutoEmbedColor}:`)) {
    const messageId = baseId.replace(`${ids.modalAutoEmbedColor}:`, "");
    const colorRaw = interaction.fields.getTextInputValue("color").trim().replace("#", "");
    if (!colorRaw) {
      setGuildConfig(guildId, (config) => {
        const message = config.automation.autoMessages.messages?.[messageId];
        if (!message) return config;
        if (message.embed?.enabled) {
          message.embed.enabled = false;
        } else {
          message.embed = { enabled: true, color: config.customColor || null };
        }
        return config;
      });
    } else {
      if (!/^[0-9a-fA-F]{6}$/.test(colorRaw)) {
        await interaction.reply({ content: "Cor inválida. Use 6 dígitos hex, exemplo FFFFFF.", flags: MessageFlags.Ephemeral });
        return true;
      }
      const colorInt = parseInt(colorRaw, 16);
      setGuildConfig(guildId, (config) => {
        const message = config.automation.autoMessages.messages?.[messageId];
        if (message) message.embed = { enabled: true, color: colorInt };
        return config;
      });
    }
    await interaction.update(panelPayload(manageOneMessagePanel(client, guildId, userId, messageId)));
    return true;
  }
  if (baseId.startsWith(`${ids.modalAutoBtnLabel}:create:`)) {
    const rest = baseId.replace(`${ids.modalAutoBtnLabel}:create:`, "");
    const [messageId] = rest.split(":");
    const label = interaction.fields.getTextInputValue("label").trim();
    if (!label) {
      await interaction.reply({ content: "Label obrigatório.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const id = newId();
    setGuildConfig(guildId, (config) => {
      const message = config.automation.autoMessages.messages?.[messageId];
      if (!message) return config;
      if ((message.buttons || []).length >= MAX_BUTTONS) return config;
      message.buttons = [...(message.buttons || []), { id, label, url: "", emoji: null }];
      return config;
    });
    await interaction.update(panelPayload(buttonManagePanel(client, guildId, userId, messageId, id)));
    return true;
  }
  if (baseId.startsWith(`${ids.modalAutoBtnLabel}:`)) {
    const rest = baseId.replace(`${ids.modalAutoBtnLabel}:`, "");
    const [messageId, buttonId] = rest.split(":");
    const label = interaction.fields.getTextInputValue("label").trim();
    if (!label) {
      await interaction.reply({ content: "Label inválido.", flags: MessageFlags.Ephemeral });
      return true;
    }
    setGuildConfig(guildId, (config) => {
      const message = config.automation.autoMessages.messages?.[messageId];
      const btn = message?.buttons?.find((b) => b.id === buttonId);
      if (btn) btn.label = label;
      return config;
    });
    await interaction.update(panelPayload(buttonManagePanel(client, guildId, userId, messageId, buttonId)));
    return true;
  }
  if (baseId.startsWith(`${ids.modalAutoBtnUrl}:`)) {
    const rest = baseId.replace(`${ids.modalAutoBtnUrl}:`, "");
    const [messageId, buttonId] = rest.split(":");
    const url = interaction.fields.getTextInputValue("url").trim();
    if (!/^https?:\/\//i.test(url)) {
      await interaction.reply({ content: "URL inválida.", flags: MessageFlags.Ephemeral });
      return true;
    }
    setGuildConfig(guildId, (config) => {
      const message = config.automation.autoMessages.messages?.[messageId];
      const btn = message?.buttons?.find((b) => b.id === buttonId);
      if (btn) btn.url = url;
      return config;
    });
    await interaction.update(panelPayload(buttonManagePanel(client, guildId, userId, messageId, buttonId)));
    return true;
  }
  if (baseId.startsWith(`${ids.modalAutoBtnEmojiAddId}:`)) {
    const rest = baseId.replace(`${ids.modalAutoBtnEmojiAddId}:`, "");
    const [messageId, buttonId] = rest.split(":");
    const raw = interaction.fields.getTextInputValue("emoji").trim();
    const emoji = parseEmojiInput(raw);
    if (!emoji?.id) {
      await interaction.reply({ content: "ID de emoji inválido.", flags: MessageFlags.Ephemeral });
      return true;
    }
    setGuildConfig(guildId, (config) => {
      const message = config.automation.autoMessages.messages?.[messageId];
      const btn = message?.buttons?.find((b) => b.id === buttonId);
      if (btn) btn.emoji = { id: emoji.id, name: emoji.name || "emoji", animated: !!emoji.animated };
      return config;
    });
    await interaction.update(panelPayload(buttonManagePanel(client, guildId, userId, messageId, buttonId)));
    return true;
  }
  if (baseId.startsWith(`${ids.modalAutoAddId}:`)) {
    const messageId = baseId.replace(`${ids.modalAutoAddId}:`, "");
    const channelId = interaction.fields.getTextInputValue("channelId").trim();
    const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased?.()) {
      await interaction.reply({ content: "Canal não encontrado ou não é de texto.", flags: MessageFlags.Ephemeral });
      return true;
    }
    setGuildConfig(guildId, (config) => {
      const message = config.automation.autoMessages.messages?.[messageId];
      if (!message) return config;
      const set = new Set([...(message.channels || []), channelId]);
      message.channels = [...set].slice(0, MAX_CHANNELS);
      return config;
    });
    await interaction.update(panelPayload(channelsPanel(client, guildId, userId, messageId)));
    return true;
  }
  if (baseId.startsWith(`${ids.modalAutoReactEmojiAddId}:`)) {
    const channelId = baseId.replace(`${ids.modalAutoReactEmojiAddId}:`, "");
    const raw = interaction.fields.getTextInputValue("emoji").trim();
    const emoji = parseEmojiInput(raw);
    if (!emoji?.id) {
      await interaction.reply({ content: "ID de emoji inválido.", flags: MessageFlags.Ephemeral });
      return true;
    }
    setGuildConfig(guildId, (config) => {
      const entry = config.automation.autoReact.channels?.[channelId];
      if (entry) entry.emoji = { id: emoji.id, name: emoji.name || "emoji", animated: !!emoji.animated };
      return config;
    });
    await interaction.update(panelPayload(autoReactChannelPanel(client, guildId, userId, channelId)));
    return true;
  }
  if (baseId === ids.iaApiModal) {
    const apiKey = interaction.fields.getTextInputValue("apiKey").trim();
    if (!apiKey.startsWith("gsk_") || apiKey.length < 20) {
      await interaction.reply({ content: "API Key inválida. Deve começar com `gsk_` (Groq).", flags: MessageFlags.Ephemeral });
      return true;
    }
    setIAConfig(guildId, c=>({ ...c, apiKey: apiKey.slice(0,200) }));
    await interaction.update(panelPayload(iaConfigPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.iaPromptModal) {
    const prompt = interaction.fields.getTextInputValue("prompt").trim();
    setIAConfig(guildId, c=>({ ...c, prompt: prompt ? prompt.slice(0,1000) : null }));
    await interaction.update(panelPayload(iaConfigPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.iaChannelIdModal) {
    const cid = interaction.fields.getTextInputValue("cid").trim();
    if (!/^\d{15,25}$/.test(cid)) {
      await interaction.reply({ content: "ID inválido.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const ch = await interaction.guild.channels.fetch(cid).catch(()=>null);
    if (!ch?.isTextBased()) {
      await interaction.reply({ content: "Canal não encontrado.", flags: MessageFlags.Ephemeral });
      return true;
    }
    setIAConfig(guildId, c=>({ ...c, channelId: cid }));
    await interaction.update(panelPayload(iaChannelPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.modalAutoRepostSchedule) {
    const time = interaction.fields.getTextInputValue("time").trim();
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(time)) {
      await interaction.reply({ content: "Horário inválido. Use HH:MM (24h).", flags: MessageFlags.Ephemeral });
      return true;
    }
    setGuildConfig(guildId, (c) => {
      c.automation.repost.time = time;
      c.automation.repost.enabled = true;
      return c;
    });
    await interaction.update(panelPayload(repostRootPanel(client, guildId, userId)));
    return true;
  }
  return false;
}
async function cloneChannel(guild, channel) {
  const overwrites = channel.permissionOverwrites.cache.map((o) => ({
    id: o.id,
    allow: o.allow,
    deny: o.deny,
    type: o.type
  }));
  const newChannel = await guild.channels.create({
    name: channel.name,
    type: channel.type,
    parent: channel.parentId,
    position: channel.position,
    topic: channel.topic,
    nsfw: channel.nsfw,
    rateLimitPerUser: channel.rateLimitPerUser,
    permissionOverwrites: overwrites
  });
  await channel.delete().catch(() => null);
  return newChannel;
}
function shouldRepostNow(time, lastRun) {
  const now = new Date();
  const [h, m] = time.split(":").map(Number);
  const todayRun = new Date(now);
  todayRun.setHours(h, m, 0, 0);
  const lastRunDate = lastRun ? new Date(lastRun) : new Date(0);
  if (now < todayRun) return false;
  if (lastRunDate >= todayRun) return false;
  return true;
}
function getPublicMiddlemanMessageIds(guildId) {
  try {
    const all = readGuildFile(guildId, "middleman-trades", () => ({}));
    return Object.values(all)
      .filter((t) => t.panelMessageId)
      .map((t) => ({ messageId: t.panelMessageId, channelId: t.panelChannelId }));
  } catch {
    return [];
  }
}
async function nukePanelChannels(client, guild, items, setter) {
  const channelIds = new Set();
  for (const item of items) {
    for (const panel of item.publicPanels || []) {
      if (panel.channelId) channelIds.add(panel.channelId);
    }
  }
  if (!channelIds.size) return;
  const remap = new Map();
  for (const channelId of channelIds) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased?.()) continue;
    try {
      const newChannel = await cloneChannel(guild, channel);
      remap.set(channelId, newChannel.id);
    } catch (error) {
      await sendSystemLog(guild, client, `Falha ao fazer nuke do canal <#${channelId}>: ${error.message}`);
    }
  }
  if (!remap.size) return;
  for (const item of items) {
    if (!item.publicPanels?.some((panel) => remap.has(panel.channelId))) continue;
    setter(guild.id, item.id, (current) => {
      current.publicPanels = (current.publicPanels || []).map((panel) => ({
        ...panel,
        channelId: remap.get(panel.channelId) || panel.channelId
      }));
      return current;
    });
  }
}
async function runRepost(client, guildId) {
  const config = getGuildConfig(guildId);
  const repost = config.automation.repost;
  const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
  if (!guild) return { summary: "Servidor não encontrado." };
  const systems = repost.systems || {};
  const summary = [];
  if (systems.sales) {
    const { productsList, setProduct, repostPublicProductPanels } = require("../sales");
    const products = productsList(guildId).filter((product) => product.publicPanels?.length);
    if (!products.length) {
      await sendSystemLog(guild, client, "Sistema de vendas não está postado em nenhum canal, ignorando repostagem.");
      summary.push("Vendas: sem painel público.");
    } else {
      if (repost.nuke) await nukePanelChannels(client, guild, products, setProduct);
      let reposted = 0;
      let failed = 0;
      for (const product of products) {
        const result = await repostPublicProductPanels(client, guildId, product.id);
        reposted += result.reposted;
        failed += result.failed;
      }
      summary.push(`Vendas: ${reposted} painel(is) repostado(s)${failed ? ` (${failed} não encontrado(s))` : ""}.`);
    }
  }
  if (systems.tickets) {
    const { panelsList, setPanel, repostPublicPanels } = require("../tickets");
    const panels = panelsList(guildId).filter((panel) => panel.publicPanels?.length);
    if (!panels.length) {
      await sendSystemLog(guild, client, "Sistema de tickets não está postado em nenhum canal, ignorando repostagem.");
      summary.push("Tickets: sem painel público.");
    } else {
      if (repost.nuke) await nukePanelChannels(client, guild, panels, setPanel);
      let reposted = 0;
      let failed = 0;
      for (const panelItem of panels) {
        const result = await repostPublicPanels(client, guildId, panelItem.id);
        reposted += result.reposted;
        failed += result.failed;
      }
      summary.push(`Tickets: ${reposted} painel(is) repostado(s)${failed ? ` (${failed} não encontrado(s))` : ""}.`);
    }
  }
  setGuildState(guildId, (s) => {
    s.lastRepost = Date.now();
    return s;
  });
  return { summary: summary.length ? summary.join("\n") : "Nenhum sistema configurado." };
}
async function runAutoMessages(client, guildId) {
  const config = getGuildConfig(guildId);
  if (!config.automation?.autoMessages?.enabled) return;
  const state = getGuildState(guildId);
  for (const message of Object.values(config.automation.autoMessages.messages || {})) {
    const last = state.lastSent?.[message.id] || 0;
    if (Date.now() - last < message.intervalMin * 60_000) continue;
    await sendAutoMessage(client, guildId, message.id, false);
  }
}
async function runScheduledTasks(client) {
  const guild = client.guilds.cache.first();
  const guildIds = guild ? [guild.id] : [];
  for (const guildId of guildIds) {
    let config;
    try {
      config = getGuildConfig(guildId);
    } catch {
      continue;
    }
    if (!config?.automation) continue;
    try {
      await runAutoMessages(client, guildId);
    } catch (error) {
      console.warn(`[Automações] guild ${guildId}: ${error.message}`);
    }
    try {
      const repost = config.automation.repost;
      if (repost?.enabled && repost?.time) {
        const state = getGuildState(guildId);
        if (shouldRepostNow(repost.time, state.lastRepost)) {
          await runRepost(client, guildId);
        }
      }
    } catch (error) {
      console.warn(`[Automações repost guild ${guildId}]: ${error.message}`);
    }
  }
}
const BLOCKED_WORDS = [
  "porra","caralho","puta","puto","cu","cuzinho","buceta","xereca","pau","pinto","foder","foda","gozar","punheta","viado","boquete","corno","arrombado","desgraça","desgracado","filho da puta","vsf","vtnc","krl","fdp","arrombada","piranha","vadia","safada","safado","tesao","tesuda","sexo","nudes","onlyfans","porn","xxx","hentai","rola","rolo","bund4","bunda","caral","caralho","bct","pqp","caraio","cuporn","xvideos","redtube","xereca","cuzao","cuzaum","siririca","tesao","punheteiro","babaca","otario","fuder","fodase","fodasse","gozando","gozada","penetrar","comer","transar","anal","oral","boquetera","corna","corno","chupar","chupa","mamada","mamando","broxa","viadinho","bicha","bixinha","sapatão","traveco"
];
const LINK_RE = /https?:\/\/|discord\.gg|discord\.com\/invite|discordapp\.com\/invite|dsc\.gg|t\.me|wa\.me|www\./i;
function normalizeForFilter(text){
  if(!text) return "";
  let s=text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  s=s.replace(/4/g,"a").replace(/3/g,"e").replace(/1/g,"i").replace(/0/g,"o").replace(/5/g,"s").replace(/7/g,"t").replace(/@/g,"a").replace(/\$/g,"s");
  s=s.replace(/(.)\1{2,}/g,"$1$1");
  s=s.replace(/[^a-z0-9 ]/g," ");
  s=s.replace(/\s+/g," ").trim();
  return s;
}
function isBlockedContent(text){
  if(!text) return { blocked:false };
  const raw=text.toLowerCase();
  if(LINK_RE.test(raw)) return { blocked:true, reason:"link" };
  const norm=normalizeForFilter(text);
  for(const w of BLOCKED_WORDS){
    const esc=w.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re=new RegExp(`\\b${esc}\\b`, "i");
    if(re.test(norm)) return { blocked:true, reason:w };
  }
  if(/\b(p[o0]rn|xnxx|xvideos|redtube)\b/i.test(norm)) return { blocked:true, reason:"porn" };
  return { blocked:false };
}
async function lockChannelForTokens(guild, channel){
  if(!guild || !channel?.isTextBased()) return;
  try{
    await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
    const until=Date.now()+24*60*60*1000;
    setIAConfig(guild.id, c=>({ ...c, lockedUntil: until }));
    const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, MessageFlags } = require("discord.js");
    const { inlineEmoji } = require("../panel");
    const cont=new ContainerBuilder().setAccentColor(0xe74c3c);
    cont.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(channel.client,"desligado")} Canal trancado — Tokens esgotados`));
    cont.addTextDisplayComponents(new TextDisplayBuilder().setContent(`A IA atingiu o limite diário. Voltará em **24 horas** (<t:${Math.floor(until/1000)}:R>).`));
    cont.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
    cont.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(channel.client,"clock")} Reabrimento automático em 24h`));
    await channel.send({ components:[cont], flags: MessageFlags.IsComponentsV2 }).catch(()=>null);
    setTimeout(async()=>{
      try{
        const ch=await guild.channels.fetch(channel.id).catch(()=>null);
        if(!ch?.isTextBased()) return;
        await ch.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null }).catch(()=>null);
        const { ContainerBuilder: CB2, TextDisplayBuilder: TD2, SeparatorBuilder: SB2, MessageFlags: MF2 } = require("discord.js");
        const { inlineEmoji: ie2 } = require("../panel");
        const c2=new CB2().setAccentColor(0x2ecc71);
        c2.addTextDisplayComponents(new TD2().setContent(`## ${ie2(channel.client,"ligado")} Canal reaberto — IA de volta!`));
        await ch.send({ components:[c2], flags: MF2.IsComponentsV2 }).catch(()=>null);
        setIAConfig(guild.id, c=>({ ...c, lockedUntil:null }));
      }catch{}
    }, 24*60*60*1000);
  }catch(e){ console.warn("[IA lock]", e.message); }
}
function buildIAPrompt(guildId, userPrompt){
  const cfg=getGuildConfig(guildId);
  let productsInfo="";
  try{
    const { productsList } = require("../sales");
    const prods=productsList(guildId).slice(0,5);
    if(prods.length){
      productsInfo = prods.map(p=> `${p.name}(${Object.keys(p.fields||{}).length} itens)`).join(", ");
    }
  }catch{}
  let channelsInfo="";
  try{
    const guild = { channels:{ cache:new Map() } };
    const chans = Object.values(cfg.channels||{}).filter(Boolean).slice(0,5).join(", ");
    if(chans) channelsInfo=chans;
  }catch{}
  const base = userPrompt && userPrompt.trim() ? userPrompt.trim().slice(0,500) : `Você é assistente da loja ${cfg.customColor?"":""} — responda curto (max 2 frases), útil, em PT-BR. Estude produtos: [${productsInfo||"nenhum"}] e canais para ser preciso.`;
  return base + (productsInfo ? ` Produtos: ${productsInfo}.` : "") + (channelsInfo ? ` Canais: ${channelsInfo}.` : "");
}
async function callGroq(apiKey, prompt, userMessage){
  const { request } = require("undici");
  const tryModels = ["openai/gpt-oss-20b", "openai/gpt-oss-120b", "qwen/qwen3-32b", "llama-3.1-8b-instant"];
  let lastErr=null;
  for(const model of tryModels){
    const body = JSON.stringify({
      model,
      messages: [
        { role:"system", content: prompt },
        { role:"user", content: userMessage.slice(0,500) }
      ],
      max_tokens: 256,
      temperature: 0.6,
      top_p: 0.9
    });
    try{
      const res = await request("https://api.groq.com/openai/v1/chat/completions", {
        method:"POST",
        headers:{ "Content-Type":"application/json", "Authorization":`Bearer ${apiKey}` },
        body
      });
      if(res.statusCode!==200){
        const txt=await res.body.text().catch(()=> "");
        if((res.statusCode===404 || res.statusCode===400) && (txt.includes("model") || txt.includes("decommissioned") || txt.includes("does not exist"))){ lastErr=new Error(`Groq ${res.statusCode}: ${txt.slice(0,200)}`); continue; }
        throw new Error(`Groq ${res.statusCode}: ${txt.slice(0,200)}`);
      }
      const data=await res.body.json();
      const content=data?.choices?.[0]?.message?.content?.trim();
      if(!content) throw new Error("Resposta vazia da IA");
      return content.slice(0,1000);
    }catch(e){
      lastErr=e;
      if(e.message.includes("model_not_found") || e.message.includes("does not exist") || e.message.includes("decommissioned")) continue;
      throw e;
    }
  }
  throw lastErr || new Error("Groq: todos os modelos falharam");
}
async function handleIAMessage(message){
  if(!message.guild || message.author.bot) return false;
  const cfg=getIAConfig(message.guild.id);
  if(!cfg.apiKey || !cfg.channelId) return false;
  if(message.channel.id!==cfg.channelId) return false;
  if(cfg.lockedUntil && Date.now() < cfg.lockedUntil){
    try{ await message.delete().catch(()=>null); }catch{}
    return true;
  } else if(cfg.lockedUntil && Date.now() >= cfg.lockedUntil){
    try{
      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null }).catch(()=>null);
      setIAConfig(message.guild.id, c=>({ ...c, lockedUntil:null }));
    }catch{}
  }
  if(!message.content || message.content.trim().length<2) return false;
  const blocked=isBlockedContent(message.content);
  if(blocked.blocked){
    try{ await message.delete().catch(()=>null); }catch{}
    try{
      const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, MessageFlags } = require("discord.js");
      const { inlineEmoji } = require("../panel");
      const c=new ContainerBuilder().setAccentColor(0xe74c3c);
      c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(message.client,"negativo")} Mensagem removida`));
      c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`Motivo: \`${blocked.reason}\` • Links, palavrões e conteúdo obsceno são bloqueados.`));
      const m=await message.channel.send({ components:[c], flags: MessageFlags.IsComponentsV2 }).catch(()=>null);
      if(m) setTimeout(()=> m.delete().catch(()=>null), 5000);
    }catch{}
    return true;
  }
  const key=`ia:${message.guild.id}:${message.author.id}`;
  if(handleIAMessage._cd?.has(key)) return true;
  handleIAMessage._cd ||= new Map();
  handleIAMessage._cd.set(key, Date.now());
  setTimeout(()=>handleIAMessage._cd.delete(key),5000);
  try{
    await message.channel.sendTyping().catch(()=>null);
    const prompt=buildIAPrompt(message.guild.id, cfg.prompt);
    let reply=await callGroq(cfg.apiKey, prompt, message.content);
    const outBlocked=isBlockedContent(reply);
    if(outBlocked.blocked){
      reply="Desculpe, não posso responder a esse tipo de conteúdo.";
    }
    reply=reply.replace(LINK_RE, "[link removido]");
    await message.reply({ content: reply.slice(0,1900), allowedMentions:{ repliedUser:false } }).catch(()=>null);
    return true;
  }catch(e){
    console.warn("[IA Groq]", e.message);
    const msg=(e.message||"").toLowerCase();
    const isTokens = msg.includes("429") || msg.includes("rate") || msg.includes("quota") || msg.includes("tokens") || msg.includes("exceeded") || msg.includes("billing") || msg.includes("limit");
    if(isTokens){
      await lockChannelForTokens(message.guild, message.channel);
    } else {
      try{ await message.react("⚠️").catch(()=>null); }catch{}
    }
    return true;
  }
}
module.exports = {
  handleAutomationComponent,
  handleAutomationModal,
  automationsRootPanel,
  autoMessagesRootPanel,
  repostRootPanel,
  autoReactRootPanel,
  reestockRootPanel,
  reestockChannelPicker,
  sendReestockNotification,
  handleAutoReactMessage,
  handleIAMessage,
  getIAConfig,
  setIAConfig,
  buildIAPrompt,
  isBlockedContent,
  runScheduledTasks,
  sendAutoMessage,
  runRepost,
  runAutoMessages,
  sendSystemLog
};
