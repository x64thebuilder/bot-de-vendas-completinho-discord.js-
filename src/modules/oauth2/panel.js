const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  MediaGalleryBuilder,
  MessageFlags,
  ModalBuilder,
  SectionBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  ThumbnailBuilder
} = require("discord.js");
const { ids } = require("../../config");
const { getGuildConfig } = require("../../storage");
const { scoped, componentEmoji, inlineEmoji } = require("../panel");
const { getStore, getVerifiedList, maskToken } = require("./store");
const { getVerifyCallbackUrl, buildAuthorizeUrl } = require("./oauth");
const V2 = MessageFlags.IsComponentsV2;
const V2_EPHEMERAL = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
const COLOR = 0xffffff;
const OK_COLOR = 0x2ecc71;
const DANGER_COLOR = 0xe74c3c;
const MEMBERS_PER_PAGE = 10;
function accent(guildId) {
  try {
    return getGuildConfig(guildId).customColor || COLOR;
  } catch {
    return COLOR;
  }
}
function backButton(client, targetBaseId, userId) {
  const builder = new ButtonBuilder()
    .setCustomId(scoped(targetBaseId, userId))
    .setLabel("Voltar")
    .setStyle(ButtonStyle.Secondary);
  const found = componentEmoji(client, "w_back");
  return found ? builder.setEmoji(found) : builder;
}
function withW(client, builder, name) {
  const found = componentEmoji(client, name);
  return found ? builder.setEmoji(found) : builder;
}
function applyButtonEmoji(builder, raw) {
  const text = String(raw || "").trim();
  if (!text) return builder;
  try {
    const custom = text.match(/^<(?<animated>a)?:(?<name>\w+):(?<id>\d+)>$/);
    if (custom?.groups) {
      return builder.setEmoji({ name: custom.groups.name, id: custom.groups.id, animated: Boolean(custom.groups.animated) });
    }
    return builder.setEmoji(text);
  } catch {
    return builder;
  }
}
function buttonStyleFromName(name) {
  const n = String(name || "cinza").trim().toLowerCase();
  if (n === "verde") return ButtonStyle.Success;
  if (n === "azul") return ButtonStyle.Primary;
  if (n === "vermelho") return ButtonStyle.Danger;
  return ButtonStyle.Secondary;
}
function buttonStyleName(style) {
  if (style === ButtonStyle.Success) return "verde";
  if (style === ButtonStyle.Primary) return "azul";
  if (style === ButtonStyle.Danger) return "vermelho";
  return "cinza";
}
function setupPanel(client, guildId, userId) {
  const callbackUrl = getVerifyCallbackUrl();
  const panel = new ContainerBuilder().setAccentColor(accent(guildId));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${inlineEmoji(client, "w_user")}Verificação OAuth2\nConfigure um bot para autenticar os membros do servidor via conta Discord.`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${inlineEmoji(client, "w_bulb")} **Como funciona:**\n` +
    `1. Crie uma aplicação em https://discord.com/developers/applications\n` +
    `2. Copie o **Token** (aba Bot), o **Client ID** e o **Client Secret** (aba OAuth2)\n` +
    `3. Na aba OAuth2, adicione esta URL de redirect:\n\`${callbackUrl || "Configure OAUTH2_SITE_URL no .env primeiro"}\`\n` +
    `-# Ao confirmar, o bot é registrado automaticamente na API de auth do site.`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    (() => {
      const b = new ButtonBuilder()
        .setCustomId(scoped(ids.oauth2Setup, userId))
        .setLabel("Configurar Bot")
        .setStyle(ButtonStyle.Primary);
      const found = componentEmoji(client, "w_style");
      return found ? b.setEmoji(found) : b;
    })()
  ));
  return panel;
}
function setupModal(userId, current = {}) {
  const modal = new ModalBuilder()
    .setCustomId(scoped(ids.oauth2SetupModal, userId))
    .setTitle("Configurar Bot OAuth2");
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("token")
        .setLabel("Token do bot")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Cole o token do bot auth")
        .setRequired(true)
        .setValue(String(current.token || "").slice(0, 4000))
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("clientId")
        .setLabel("Client ID do bot")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Ex: 123456789012345678")
        .setRequired(true)
        .setValue(String(current.clientId || "").slice(0, 4000))
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("clientSecret")
        .setLabel("Client Secret do bot")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Cole o client secret (aba OAuth2)")
        .setRequired(true)
        .setValue(String(current.clientSecret || "").slice(0, 4000))
    )
  );
  return modal;
}
function confirmPanel(client, guildId, userId) {
  const { bot } = getStore();
  const panel = new ContainerBuilder().setAccentColor(accent(guildId));
  try {
    const section = new SectionBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## ${inlineEmoji(client, "w_user")}Confirmar Bot Auth`),
      new TextDisplayBuilder().setContent(
        `Você configurou o bot **${bot.botName || "desconhecido"}**${bot.botId ? ` (\`${bot.botId}\`)` : ""} corretamente?`
      )
    );
    if (bot.botAvatar) section.setThumbnailAccessory(new ThumbnailBuilder().setURL(bot.botAvatar).setDescription(bot.botName || "Bot"));
    panel.addSectionComponents(section);
  } catch {
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## ${inlineEmoji(client, "w_user")}Confirmar Bot Auth\nVocê configurou o bot **${bot.botName || "desconhecido"}** corretamente?`
    ));
  }
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withW(client, new ButtonBuilder().setCustomId(scoped(ids.oauth2ConfirmYes, userId)).setLabel("Sim").setStyle(ButtonStyle.Success), "w_check"),
    withW(client, new ButtonBuilder().setCustomId(scoped(ids.oauth2ConfirmNo, userId)).setLabel("Não").setStyle(ButtonStyle.Danger), "w_x")
  ));
  return panel;
}
function mainPanel(client, guildId, userId) {
  const { bot } = getStore();
  const total = getVerifiedList().length;
  const panel = new ContainerBuilder().setAccentColor(accent(guildId));
  try {
    const section = new SectionBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## ${inlineEmoji(client, "w_shield")}OAuth2 • ${bot.botName || "Bot Auth"}`),
      new TextDisplayBuilder().setContent(
        `${inlineEmoji(client, "w_users")} **Membros verificados:** ${total}\n` +
        `${inlineEmoji(client, "w_user")} **Bot auth:** ${bot.botName || "—"}`
      )
    );
    if (bot.botAvatar) section.setThumbnailAccessory(new ThumbnailBuilder().setURL(bot.botAvatar).setDescription(bot.botName || "Bot"));
    panel.addSectionComponents(section);
  } catch {
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## ${inlineEmoji(client, "w_shield")}OAuth2 • ${bot.botName || "Bot Auth"}\n` +
      `${inlineEmoji(client, "w_users")} **Membros verificados:** ${total}\n` +
      `${inlineEmoji(client, "w_user")} **Bot auth:** ${bot.botName || "—"}`
    ));
  }
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(scoped(ids.oauth2MainSelect, userId))
      .setPlaceholder("Escolha uma ação")
      .addOptions(
        {
          label: "Enviar Mensagem",
          value: "send",
          description: "Aparência, botão e envio do painel de verificação",
          emoji: componentEmoji(client, "w_hash")
        },
        {
          label: "Exigir auth",
          value: "require",
          description: "Exigir verificação no carrinho e no ticket",
          emoji: componentEmoji(client, "w_lock")
        },
        {
          label: "Recuperar membros",
          value: "recover",
          description: "Readicionar verificados de volta ao servidor",
          emoji: componentEmoji(client, "w_users")
        },
        {
          label: "Reconfigurar",
          value: "reconfig",
          description: "Trocar o bot auth (token, client id, secret)",
          emoji: componentEmoji(client, "w_refresh")
        }
      )
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withW(client, new ButtonBuilder().setCustomId(scoped(ids.oauth2Stats, userId)).setLabel("Estatísticas").setStyle(ButtonStyle.Secondary), "w_chart"),
    withW(client, new ButtonBuilder().setCustomId(scoped(ids.oauth2Members, userId)).setLabel("Ver membros").setStyle(ButtonStyle.Secondary), "w_users")
  ));
  return panel;
}
function actionSelectRow(client, userId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(scoped(ids.oauth2MainSelect, userId))
      .setPlaceholder("Escolha uma ação")
      .addOptions(
        {
          label: "Enviar Mensagem",
          value: "send",
          description: "Aparência, botão e envio do painel de verificação",
          emoji: componentEmoji(client, "w_hash")
        },
        {
          label: "Exigir auth",
          value: "require",
          description: "Exigir verificação no carrinho e no ticket",
          emoji: componentEmoji(client, "w_lock")
        },
        {
          label: "Recuperar membros",
          value: "recover",
          description: "Readicionar verificados de volta ao servidor",
          emoji: componentEmoji(client, "w_users")
        },
        {
          label: "Reconfigurar",
          value: "reconfig",
          description: "Trocar o bot auth (token, client id, secret)",
          emoji: componentEmoji(client, "w_refresh")
        }
      )
  );
}
function statsPanel(client, guildId, userId) {
  const list = getVerifiedList();
  const now = Date.now();
  const day = list.filter((m) => now - (m.verifiedAt || 0) < 24 * 3600 * 1000).length;
  const week = list.filter((m) => now - (m.verifiedAt || 0) < 7 * 24 * 3600 * 1000).length;
  const newest = list[0];
  const panel = new ContainerBuilder().setAccentColor(accent(guildId));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${inlineEmoji(client, "w_chart")}Estatísticas de Verificação`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${inlineEmoji(client, "w_users")} **Total verificados:** ${list.length}\n` +
    `${inlineEmoji(client, "w_clock")} **Últimas 24h:** ${day} ╺╸ **Últimos 7 dias:** ${week}\n` +
    `${inlineEmoji(client, "w_user")} **Último verificado:** ${newest ? `<@${newest.id}> • <t:${Math.floor((newest.verifiedAt || now) / 1000)}:R>` : "—"}`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, ids.oauth2Back, userId)));
  return panel;
}
function membersPanel(client, guildId, userId, page = 0) {
  const list = getVerifiedList();
  const totalPages = Math.max(1, Math.ceil(list.length / MEMBERS_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const slice = list.slice(safePage * MEMBERS_PER_PAGE, safePage * MEMBERS_PER_PAGE + MEMBERS_PER_PAGE);
  const lines = slice.length
    ? slice.map((m) => `<@${m.id}> • <t:${Math.floor((m.verifiedAt || Date.now()) / 1000)}:R>`).join("\n")
    : "Nenhum membro verificado ainda.";
  const panel = new ContainerBuilder().setAccentColor(accent(guildId));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${inlineEmoji(client, "w_users")}Membros Verificados (${list.length})`
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Página ${safePage + 1} de ${totalPages}`));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(actionSelectRow(client, userId));
  const prev = new ButtonBuilder()
    .setCustomId(scoped(`${ids.oauth2MembersPage}:${safePage - 1}`, userId))
    .setLabel("◀")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(safePage <= 0);
  const next = new ButtonBuilder()
    .setCustomId(scoped(`${ids.oauth2MembersPage}:${safePage + 1}`, userId))
    .setLabel("▶")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(safePage >= totalPages - 1);
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    prev, next, backButton(client, ids.oauth2Back, userId)
  ));
  return panel;
}
function requirePanel(client, guildId, userId) {
  const { require: req } = getStore();
  const on = `${inlineEmoji(client, "w_on")} Ativado`;
  const off = `${inlineEmoji(client, "w_off")} Desativado`;
  const panel = new ContainerBuilder().setAccentColor(accent(guildId));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${inlineEmoji(client, "w_shield")}Exigir Verificação`
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `Escolha onde o bot vai exigir que o usuário esteja verificado:\n` +
    `${inlineEmoji(client, "w_cart")} **Auth no carrinho:** ${req.cart ? on : off}\n` +
    `${inlineEmoji(client, "w_ticket")} **Auth no ticket:** ${req.ticket ? on : off}`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(scoped(ids.oauth2RequireSelect, userId))
      .setPlaceholder("Ativar/desativar exigência")
      .addOptions(
        {
          label: req.cart ? "Desativar auth carrinho" : "Ativar auth carrinho",
          value: "cart",
          description: req.cart ? "Parar de exigir verificação nas compras" : "Exigir verificação para abrir carrinho",
          emoji: componentEmoji(client, "w_cart")
        },
        {
          label: req.ticket ? "Desativar auth ticket" : "Ativar auth ticket",
          value: "ticket",
          description: req.ticket ? "Parar de exigir verificação nos tickets" : "Exigir verificação para abrir ticket",
          emoji: componentEmoji(client, "w_ticket")
        }
      )
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, ids.oauth2Back, userId)));
  return panel;
}
function sendPanel(client, guildId, userId) {
  const { panel: cfg } = getStore();
  const panel = new ContainerBuilder().setAccentColor(accent(guildId));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${inlineEmoji(client, "w_hash")}Painel de Verificação`
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `Personalize a aparência e o botão, depois envie o painel no canal.\n` +
    `${inlineEmoji(client, "w_eye")} **Título:** ${cfg.title}\n` +
    `${inlineEmoji(client, "w_user")} **Botão:** ${cfg.buttonLabel} (${buttonStyleName(cfg.buttonStyle)})${cfg.buttonEmoji ? ` ${cfg.buttonEmoji}` : ""}\n` +
    `${inlineEmoji(client, "w_hash")} **Último envio:** ${cfg.channelId ? `<#${cfg.channelId}>` : "ainda não enviado"}`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withW(client, new ButtonBuilder().setCustomId(scoped(ids.oauth2Appearance, userId)).setLabel("Aparência").setStyle(ButtonStyle.Secondary), "w_style"),
    withW(client, new ButtonBuilder().setCustomId(scoped(ids.oauth2Button, userId)).setLabel("Botão").setStyle(ButtonStyle.Secondary), "w_button"),
    withW(client, new ButtonBuilder().setCustomId(scoped(ids.oauth2SendPanel, userId)).setLabel("Enviar Painel").setStyle(ButtonStyle.Primary), "w_send")
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, ids.oauth2Back, userId)));
  return panel;
}
function appearanceModal(userId, cfg) {
  const modal = new ModalBuilder()
    .setCustomId(scoped(ids.oauth2AppearanceModal, userId))
    .setTitle("Aparência da Verificação");
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("title").setLabel("Título").setStyle(TextInputStyle.Short)
        .setRequired(true).setValue(String(cfg.title || "Verificação de Membro").slice(0, 200))
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("description").setLabel("Descrição").setStyle(TextInputStyle.Paragraph)
        .setRequired(true).setValue(String(cfg.description || "").slice(0, 3000))
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("color").setLabel("Cor (ex: #5865F2)").setStyle(TextInputStyle.Short)
        .setRequired(false).setValue(cfg.color != null ? `#${Number(cfg.color).toString(16).padStart(6, "0").toUpperCase()}` : "")
        .setPlaceholder("#FFFFFF")
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("banner").setLabel("Banner (URL, opcional)").setStyle(TextInputStyle.Short)
        .setRequired(false).setValue(String(cfg.banner || "").slice(0, 500)).setPlaceholder("https://...")
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("thumbnail").setLabel("Thumbnail (URL, opcional)").setStyle(TextInputStyle.Short)
        .setRequired(false).setValue(String(cfg.thumbnail || "").slice(0, 500)).setPlaceholder("https://...")
    )
  );
  return modal;
}
function buttonModal(userId, cfg) {
  const modal = new ModalBuilder()
    .setCustomId(scoped(ids.oauth2ButtonModal, userId))
    .setTitle("Botão de Verificar");
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("label").setLabel("Título do botão").setStyle(TextInputStyle.Short)
        .setRequired(true).setValue(String(cfg.buttonLabel || "Verificar").slice(0, 80))
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("color").setLabel("Cor: cinza, verde, azul, vermelho").setStyle(TextInputStyle.Short)
        .setRequired(true).setValue(buttonStyleName(cfg.buttonStyle)).setPlaceholder("cinza")
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("emoji").setLabel("Emoji (opcional)").setStyle(TextInputStyle.Short)
        .setRequired(false).setValue(String(cfg.buttonEmoji || "").slice(0, 100)).setPlaceholder("Deixe vazio para nenhum")
    )
  );
  return modal;
}
function sendChannelPanel(client, guildId, userId) {
  const panel = new ContainerBuilder().setAccentColor(accent(guildId));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${inlineEmoji(client, "w_hash")}Enviar Painel de Verificação`
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `Selecione o canal abaixo **ou** use o botão para enviar neste canal atual.`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(scoped(ids.oauth2SendChannel, userId))
      .setPlaceholder("Selecione o canal do painel")
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(1)
      .setMaxValues(1)
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withW(client, new ButtonBuilder().setCustomId(scoped(ids.oauth2SendHere, userId)).setLabel("Enviar neste canal").setStyle(ButtonStyle.Success), "w_send"),
    backButton(client, ids.oauth2Send, userId)
  ));
  return panel;
}
function publicVerifyPanel(client, guildId) {
  const { panel: cfg } = getStore();
  const color = typeof cfg.color === "number" ? cfg.color : accent(guildId);
  const panel = new ContainerBuilder().setAccentColor(color);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${cfg.title || "Verificação de Membro"}\n${cfg.description || ""}`
  ));
  if (cfg.thumbnail) {
    try {
      panel.addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client, "w_shield")} Verificação via conta Discord`))
          .setThumbnailAccessory(new ThumbnailBuilder().setURL(cfg.thumbnail).setDescription("Verificação"))
      );
    } catch {}
  }
  if (cfg.banner) {
    try {
      panel.addMediaGalleryComponents(new MediaGalleryBuilder({ items: [{ media: { url: cfg.banner }, description: cfg.title }] }));
    } catch {}
  }
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  const btn = new ButtonBuilder()
    .setCustomId(ids.oauth2Verify)
    .setLabel(cfg.buttonLabel || "Verificar")
    .setStyle(cfg.buttonStyle ?? ButtonStyle.Secondary);
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(applyButtonEmoji(btn, cfg.buttonEmoji)));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# creator: x64thebuilder/.200021`));
  return panel;
}
function verifyPromptPayload(client, guildId) {
  const url = buildAuthorizeUrl(guildId, "0");
  const components = [
    new ContainerBuilder().setAccentColor(accent(guildId)).addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## ${inlineEmoji(client, "w_shield")}Verificação necessária\n` +
        (url
          ? `Clique no botão abaixo e autorize com sua conta Discord para continuar.`
          : `O sistema de verificação ainda não foi configurado pelo dono do servidor.`)
      )
    )
  ];
  if (url) {
    components[0].addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(ids.oauth2Verify).setLabel("Verificar").setStyle(ButtonStyle.Primary)
    ));
  }
  return { components, flags: V2_EPHEMERAL };
}
function verifyLinkPayload(client, guildId, userId) {
  const url = buildAuthorizeUrl(guildId, userId);
  if (!url) {
    return {
      content: "O sistema de verificação ainda não foi configurado.",
      flags: MessageFlags.Ephemeral
    };
  }
  return {
    components: [
      new ContainerBuilder().setAccentColor(accent(guildId))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `## ${inlineEmoji(client, "w_shield")}Verifique sua conta\nClique abaixo, autorize e volte aqui. O link expira em 10 minutos.`
        ))
        .addActionRowComponents(new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel("Autorizar com o Discord").setStyle(ButtonStyle.Link).setURL(url)
        ))
    ],
    flags: V2_EPHEMERAL
  };
}
function recoverPanel(client, guildId, userId, status) {
  const { total, ready, noToken, inGuild, inviteUrl } = status;
  const panel = new ContainerBuilder().setAccentColor(accent(guildId));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${inlineEmoji(client, "w_users")}Recuperar Membros`
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `Traga os membros verificados de volta ao servidor.\n` +
    `${inlineEmoji(client, "w_users")} **Verificados:** ${total} ╺╸ ${inlineEmoji(client, "w_check")} **Prontos:** ${ready} ╺╸ ${inlineEmoji(client, "w_clock")} **Sem token:** ${noToken}\n` +
    `${inGuild ? `${inlineEmoji(client, "w_on")} **Bot auth no servidor**` : `${inlineEmoji(client, "w_off")} **Bot auth FORA do servidor**`}` +
    (noToken ? `\n-# Sem token = verificou antes desta atualização. Peça para se verificar de novo.` : "")
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  const row = new ActionRowBuilder().addComponents(
    withW(client, new ButtonBuilder().setCustomId(scoped(ids.oauth2RecoverAsk, userId)).setLabel("Recuperar Membros").setStyle(ButtonStyle.Primary), "w_users")
      .setDisabled(!inGuild || !ready),
    withW(client, new ButtonBuilder().setCustomId(scoped(ids.oauth2RecoverHistory, userId)).setLabel("Histórico").setStyle(ButtonStyle.Secondary), "w_clock")
  );
  panel.addActionRowComponents(row);
  if (!inGuild && inviteUrl) {
    panel.addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("Colocar bot no servidor").setStyle(ButtonStyle.Link).setURL(inviteUrl)
    ));
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `-# ${inlineEmoji(client, "w_bulb")} Adicione o bot auth ao servidor e volte aqui para recuperar.`
    ));
  }
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, ids.oauth2Back, userId)));
  return panel;
}
function recoverConfirmPanel(client, guildId, userId, ready) {
  const panel = new ContainerBuilder().setAccentColor(accent(guildId));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${inlineEmoji(client, "w_users")}Tem certeza?`
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `Vou tentar adicionar **${ready}** membro(s) verificado(s) de volta ao servidor.\n` +
    `Quem já está aqui será ignorado. Pode levar alguns minutos — não feche este painel.`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withW(client, new ButtonBuilder().setCustomId(scoped(ids.oauth2RecoverRun, userId)).setLabel("Confirmar").setStyle(ButtonStyle.Success), "w_check"),
    withW(client, new ButtonBuilder().setCustomId(scoped(ids.oauth2Recover, userId)).setLabel("Cancelar").setStyle(ButtonStyle.Danger), "w_x")
  ));
  return panel;
}
function historyPanel(client, guildId, userId) {
  const { recovery } = getStore();
  const runs = (recovery.history || []).slice(-8).reverse();
  const panel = new ContainerBuilder().setAccentColor(accent(guildId));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${inlineEmoji(client, "w_clock")}Histórico de Recuperação`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  if (!runs.length) {
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`Nenhuma recuperação feita ainda.`));
  } else {
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      runs.map((r) =>
        `${inlineEmoji(client, "w_users")} <t:${Math.floor((r.at || Date.now()) / 1000)}:F> — **${r.added || 0}** adicionados, **${r.already || 0}** já estavam, **${r.failed || 0}** falharam${r.noToken ? `, **${r.noToken}** sem token` : ""} (de **${r.total || 0}**)`
      ).join("\n")
    ));
  }
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, ids.oauth2Recover, userId)));
  return panel;
}
module.exports = {
  MEMBERS_PER_PAGE,
  buttonStyleFromName,
  buttonStyleName,
  applyButtonEmoji,
  setupPanel,
  setupModal,
  confirmPanel,
  mainPanel,
  statsPanel,
  membersPanel,
  requirePanel,
  sendPanel,
  appearanceModal,
  buttonModal,
  sendChannelPanel,
  publicVerifyPanel,
  verifyPromptPayload,
  verifyLinkPayload,
  recoverPanel,
  recoverConfirmPanel,
  historyPanel
};
