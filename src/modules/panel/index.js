const fs = require("node:fs");
const path = require("node:path");
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  EmbedBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  RoleSelectMenuBuilder,
  SectionBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder
} = require("discord.js");
const { ids, ASSETS_DIR, BOT_VERSION, SALES_LOG_KEYS } = require("../../config");
const { normalizeEmojiName } = require("../../emojis");
const { getGuildConfig } = require("../../storage");
const { getStrikeCount, getRestrictionLevel } = require("../../violations");
const { salesOrders, middlemanTrades, isPaidSale, formatBRL } = require("../stats");
const { isEfiConfigured } = require("../payments/efibank");
const { isStripeConfigured } = require("../payments/stripe");
const {
  automationsRootPanel,
  autoMessagesRootPanel,
  repostRootPanel
} = require("../automations");
const EPHEMERAL_V2 = MessageFlags.Ephemeral | MessageFlags.IsComponentsV2;
const UPDATE_V2 = MessageFlags.IsComponentsV2;
const BANNER_FILENAME = "painel-banner.png";
const BANNER_PATH = path.join(ASSETS_DIR, BANNER_FILENAME);
function scoped(id, userId) {
  return `${id}:${userId}`;
}
function parseCustomId(customId) {
  const parts = customId.split(":");
  const ownerId = parts.at(-1);
  return {
    baseId: parts.slice(0, -1).join(":"),
    ownerId
  };
}
function componentEmoji(client, name) {
  const normalized = normalizeEmojiName(name);
  const found = client.appEmojis?.get(normalized);
  if (!found) return undefined;
  return {
    id: found.id,
    name: found.name,
    animated: found.animated
  };
}
function withEmoji(builder, client, name) {
  const found = componentEmoji(client, name);
  return found ? builder.setEmoji(found) : builder;
}
function inlineEmoji(client, name) {
  const found = componentEmoji(client, name);
  if (!found) return "";
  return `<${found.animated ? "a" : ""}:${found.name}:${found.id}> `;
}
function greetingForNow() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "bom dia";
  if (hour >= 12 && hour < 18) return "boa tarde";
  return "boa noite";
}
function bannerAttachment() {
  return new AttachmentBuilder(BANNER_PATH, { name: BANNER_FILENAME });
}
function hasBanner() {
  try {
    return fs.existsSync(BANNER_PATH);
  } catch {
    return false;
  }
}
function container(title, description, accentColor = null, guildId = null) {
  const builder = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${title}\n${description}`)
  );
  const color = accentColor ?? (guildId ? getGuildConfig(guildId).customColor : null);
  if (color) {
    builder.setAccentColor(color);
  }
  return builder.addSeparatorComponents(new SeparatorBuilder());
}
function mainPanel(client, guildId, userId, user) {
  const customAccent = getGuildConfig(guildId).customColor;
  const storeClosed = Boolean(getGuildConfig(guildId).storeClosed);
  const panel = new ContainerBuilder();
  panel.setAccentColor(customAccent || 0x00C853);
  const guild = client.guilds.cache.get(guildId);
  const guildName = guild?.name || "teste";
  const botAvatar = client.user?.displayAvatarURL({ extension: "png", size: 128 }) || null;
  const mention = `<@${userId}>`;
  const greeting = greetingForNow();
  try {
    const header = new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## ${inlineEmoji(client, "casa")}Painel de Controle — ${guildName}`),
        new TextDisplayBuilder().setContent(`${inlineEmoji(client, "sparkles")} Olá, ${mention}! **${greeting}**.`)
      );
    if (botAvatar) header.setThumbnailAccessory(new ThumbnailBuilder().setURL(botAvatar).setDescription("Avatar"));
    panel.addSectionComponents(header);
  } catch {
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client, "casa")}Painel de Controle\n**${guildName}** — Olá, ${mention}!`));
  }
  if (hasBanner()) {
    try {
      panel.addMediaGalleryComponents(new MediaGalleryBuilder({ items: [{ media: { url: `attachment://${BANNER_FILENAME}` }, description: "Banner" }] }));
    } catch {}
  }
  const orders = salesOrders(guildId);
  const paidOrders = orders.filter(isPaidSale);
  const revenue = paidOrders.reduce((a,b)=>a+Number(b.total||0),0);
  const bootMs = Date.now() - (client.uptime || 0);
  const bootStamp = Math.floor(bootMs / 1000);
  const statusDot = storeClosed ? `${inlineEmoji(client, "ban")} Fechada` : `${inlineEmoji(client, "ligado")} Aberta`;
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${inlineEmoji(client, "sparkles")} Visão Rápida`));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${inlineEmoji(client, "clock")} Atualizado <t:${bootStamp}:R> ╺╸ ${inlineEmoji(client, "bag")} **${paidOrders.length}** vendas ╺╸ ${formatBRL(revenue)}\n` +
    `${inlineEmoji(client, "preview")} Loja: **${statusDot}** ╺╸ ${inlineEmoji(client, "users")} Membros: **${guild?.memberCount || "—"}**`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${inlineEmoji(client, "clipboard_list")} Central de Gerenciamento`));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`Escolha o que quer configurar agora. Cada área tem **guia passo a passo**.\n-# ${inlineEmoji(client, "lightbulb")} Dica: comece por **Configurações → Canais** se for a primeira vez.`));
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(scoped(ids.panelMainSelect, userId))
        .setPlaceholder("Selecione onde quer ir agora")
        .addOptions(
          {
            label: "Loja",
            value: "sales",
            description: "Crie produtos, estoque e envie o painel da loja.",
            emoji: componentEmoji(client, "bag")
          },
          {
            label: "Tickets",
            value: "tickets",
            description: "Monte paineis de suporte com motivos e horários.",
            emoji: componentEmoji(client, "canal")
          },
          {
            label: "Automações",
            value: "automation",
            description: "Mensagens periódicas e repost inteligente.",
            emoji: componentEmoji(client, "reload")
          },
          {
            label: "Configurações",
            value: "settings",
            description: "Canais, cargos e pagamentos.",
            emoji: componentEmoji(client, "config2")
          },
          {
            label: "Personalizar",
            value: "customize",
            description: "Troque a cor e deixe com sua identidade.",
            emoji: componentEmoji(client, "personalizarE")
          },
          {
            label: "Horário da Loja",
            value: "storehours",
            description: "Defina abertura/fechamento automático.",
            emoji: componentEmoji(client, "clock")
          },
          {
            label: "Sistemas",
            value: "systems",
            description: "Middleman e outros",
            emoji: componentEmoji(client, "wand")
          },
          {
            label: "SyncBuxx",
            value: "vorkbux",
            description: "Venda de Robux via Gamepass e Grupo.",
            emoji: componentEmoji(client, "robux")
          }
        )
    )
  );
  const closeLabel = storeClosed ? "Abrir Loja" : "Fechar Loja";
  const closeStyle = storeClosed ? ButtonStyle.Success : ButtonStyle.Danger;
  const closeEmoji = storeClosed ? "circle_check_big" : "ban";
  const closeDesc = storeClosed ? "Loja fechada — clientes não conseguem comprar" : "Loja aberta — clientes podem comprar";
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client, closeEmoji)} **${closeDesc}**`));
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      withEmoji(new ButtonBuilder()
        .setCustomId(scoped(ids.panelControlClose, userId))
        .setLabel(closeLabel)
        .setStyle(closeStyle), client, closeEmoji),
      new ButtonBuilder()
        .setCustomId(scoped(ids.panelControlNotifs, userId))
        .setLabel("Dashboard")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
        .setEmoji(componentEmoji(client, "preview") || undefined)
    )
  );
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client, "clock")} Bot online há <t:${bootStamp}:R> ╺╸ ${inlineEmoji(client, "casa")} ${guildName} ╺╸ Versão \`${BOT_VERSION}\` ╺╸ creator: x64thebuilder/.200021`));
  return panel;
}
function mainPanelPayload(client, guildId, userId, user, ephemeral) {
  const payload = {
    components: [mainPanel(client, guildId, userId, user)],
    flags: ephemeral ? EPHEMERAL_V2 : UPDATE_V2
  };
  if (hasBanner()) payload.files = [bannerAttachment()];
  return payload;
}
const AUTO_REFRESH_INTERVAL_MS = 30_000;
const AUTO_REFRESH_MAX_LIFETIME_MS = 14 * 60 * 1000; 
const activePanelRefreshers = new Map();
function stopPanelAutoRefresh(messageId) {
  const entry = activePanelRefreshers.get(messageId);
  if (!entry) return;
  clearInterval(entry.intervalId);
  clearTimeout(entry.lifetimeTimeoutId);
  activePanelRefreshers.delete(messageId);
}
const MAX_REFRESHERS = 20;
function startPanelAutoRefresh(interaction, client, guildId, userId, user) {
  interaction.fetchReply()
    .then((message) => {
      if (!message?.id) return;
      if (activePanelRefreshers.size >= MAX_REFRESHERS) {
        const oldest = activePanelRefreshers.keys().next().value;
        stopPanelAutoRefresh(oldest);
      }
      for (const [k, v] of activePanelRefreshers) {
        if (v.userId === userId && v.guildId === guildId) stopPanelAutoRefresh(k);
      }
      stopPanelAutoRefresh(message.id);
      let locked = false;
      const intervalId = setInterval(async () => {
        if (locked) return;
        locked = true;
        try {
          await interaction.editReply(mainPanelPayload(client, guildId, userId, user, true));
        } catch {
          stopPanelAutoRefresh(message.id);
        } finally {
          locked = false;
        }
      }, AUTO_REFRESH_INTERVAL_MS);
      const lifetimeTimeoutId = setTimeout(() => stopPanelAutoRefresh(message.id), AUTO_REFRESH_MAX_LIFETIME_MS);
      activePanelRefreshers.set(message.id, { intervalId, lifetimeTimeoutId, userId, guildId });
    })
    .catch(() => null);
}
function tutorialPanel(client, userId) {
  const panel = new ContainerBuilder();
  panel.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${inlineEmoji(client, "wand")}Bem-vindo(a) ao Painel!\nEssa e a primeira vez que voce abre o \`/panel\` neste servidor. Aqui vai um resumo rapido de como tudo funciona.`
    )
  );
  panel.addSeparatorComponents(new SeparatorBuilder());
  panel.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `${inlineEmoji(client, "bag")}**Gerenciar Loja** - crie produtos, campos, estoque e envie os paineis de venda.`,
        `${inlineEmoji(client, "personalizarE")}**Personalizar** - altere nome, avatar, banner, status e a cor dos paineis do bot.`,
        `${inlineEmoji(client, "canal")}**Gerenciar Ticket** - configure paineis de atendimento, horarios e motivos.`,
        `${inlineEmoji(client, "reload")}**Automacoes** - mensagens automaticas e reposts programados.`,
        `${inlineEmoji(client, "config2")}**Configuracoes** - canais de log, cargos e formas de pagamento.`,
        `${inlineEmoji(client, "wand")}**Outros Sistemas** - middleman e demais modulos extras do bot.`
      ].join("\n")
    )
  );
  panel.addSeparatorComponents(new SeparatorBuilder());
  panel.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `Dica: apenas quem abriu o painel pode interagir com ele. Use \`/panel\` a qualquer momento para voltar a este menu.`
    )
  );
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      withEmoji(new ButtonBuilder()
        .setCustomId(scoped(ids.panelTutorialContinue, userId))
        .setLabel("Entendi, abrir painel")
        .setStyle(ButtonStyle.Success), client, "online")
    )
  );
  return panel;
}
function tutorialPanelPayload(client, userId) {
  return {
    components: [tutorialPanel(client, userId)],
    flags: EPHEMERAL_V2
  };
}
function earningsPanel(client, guildId, userId) {
  const sales = salesOrders(guildId).filter(isPaidSale);
  const trades = middlemanTrades(guildId).filter((trade) => trade.status === "done");
  const totalSales = sales.reduce((total, order) => total + Number(order.total || 0), 0);
  const totalMiddleman = trades.reduce((total, trade) => total + Number(trade.total || trade.amount || 0), 0);
  const panel = container(
    "Rendimentos",
    `Resumo geral dos rendimentos registrados neste servidor.\n\n${inlineEmoji(client, "dollar")}Vendas (loja): **${sales.length}** pedidos - **${formatBRL(totalSales)}**\n${inlineEmoji(client, "tradep")}Middleman: **${trades.length}** trades concluidas - **${formatBRL(totalMiddleman)}**\n\nTotal geral: **${formatBRL(totalSales + totalMiddleman)}**`,
    null,
    guildId
  );
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, ids.panelBackMain, userId)));
  return panel;
}
function settingsPanel(client, guildId, userId) {
  const config = getGuildConfig(guildId);
  const strikes = getStrikeCount(guildId);
  const level = getRestrictionLevel(guildId);
  const moderation = config.moderation;
  const restorationRequested = moderation.restorationRequested;
  const restorationUsed = moderation.restorationUsed;
  const channelsDone = Object.values(config.channels).filter(Boolean).length + Object.values(config.sales.channels).filter(Boolean).length + (config.suggestions.channelId ? 1 : 0);
  const rolesDone = Object.values(config.roles).filter(Boolean).length + Object.values(config.sales.roles).filter(Boolean).length + Object.values(config.tickets.roles).filter(Boolean).length;
  const paymentsOk = config.payments.pix.key || config.payments.mercadoPago.accessToken || isEfiConfigured(config.payments.efi) ? `${inlineEmoji(client, "ligado")} configurado` : `${inlineEmoji(client, "desligado")} pendente`;
  const levelBadge = level === 2
    ? `\n\n${inlineEmoji(client, "ban")} **Atenção:** este servidor está com intervalo de **4s entre ações** por 2+ violações.`
    : level === 1
      ? `\n\n${inlineEmoji(client, "clock")} **Atenção:** intervalo de **2s entre ações** por 1 violação.`
      : "";
  const panel = new ContainerBuilder().setAccentColor(getGuildConfig(guildId).customColor || 0xffffff);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client, "config2")}Configurações`));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`Central de ajustes do bot. **Canais** definem onde os logs são enviados, **Cargos** quem tem acesso e **Pagamento** como você recebe. Tudo é salvo em tempo real.`));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${inlineEmoji(client, "canal")}Canais: **${channelsDone}** configurados  •  ${inlineEmoji(client, "cargo")}Cargos: **${rolesDone}** configurados  •  ${inlineEmoji(client, "pix")}Pagamento: ${paymentsOk}${levelBadge}`
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client, "lightbulb")} Dica: comece por **Canais** → defina \`#logs-gerais\` e \`#sistemas\`. Depois configure **Cargos** e **Formas de Pagamento**.`));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(scoped(ids.settingsSelect, userId))
        .setPlaceholder("Selecione o que deseja configurar")
        .addOptions(
          {
            label: "Canais de Logs",
            value: "channels",
            description: "Escolha onde cada log será enviado (15 tipos).",
            emoji: componentEmoji(client, "canal")
          },
          {
            label: "Cargos e Permissões",
            value: "roles",
            description: "Quem pode usar o bot e quem recebe cargos.",
            emoji: componentEmoji(client, "cargo")
          }
        )
    )
  );
  const bottomRow = new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder()
      .setCustomId(scoped(ids.paymentOpen, userId))
      .setLabel("Formas de Pagamento")
      .setStyle(ButtonStyle.Primary), client, "pix")
  );
  if (strikes > 0) {
    const label = restorationUsed
      ? (restorationRequested ? "Restauração já pedida" : "Restauração já usada")
      : "Pedir restauração";
    bottomRow.addComponents(
      withEmoji(new ButtonBuilder()
        .setCustomId(scoped(ids.moderationRestoreRequest, userId))
        .setLabel(label)
        .setStyle(restorationUsed ? ButtonStyle.Secondary : ButtonStyle.Danger)
        .setDisabled(restorationUsed), client, restorationUsed ? "desligado" : "ban")
    );
  }
  panel.addActionRowComponents(bottomRow);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client, "lightbulb")} Pagamentos ficam em menu separado — clique acima. Restauração só aparece se houver violação.`));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, ids.panelBackMain, userId)));
  return panel;
}
function channelsPanel(client, guildId, userId) {
  const cfg = getGuildConfig(guildId);
  const getVal = (k) => {
    if (k.startsWith("sales:")) return cfg.sales.channels[k.replace("sales:", "")];
    if (k.startsWith("tickets:")) return cfg.tickets.channels[k.replace("tickets:", "")];
    if (k === "vouchChannel" || k === "bigVouchChannel") return cfg.middleman[k];
    if (k === "suggestions") return cfg.suggestions.channelId;
    return cfg.channels[k];
  };
  const fmt = (k, desc) => {
    const v = getVal(k);
    const has = Boolean(v);
    const chan = has ? `<#${v}>` : "não configurado";
    const badge = has ? `${inlineEmoji(client, "ligado")} ${chan}` : `${inlineEmoji(client, "desligado")} ${chan}`;
    return `${desc} • ${badge}`;
  };
  const salesVals = SALES_LOG_KEYS.map((k) => cfg.sales.channels[k]);
  const salesUnified = salesVals.every((v) => v && v === salesVals[0]) ? salesVals[0] : null;
  const salesMixed = !salesUnified && salesVals.some(Boolean);
  const salesDesc = salesUnified
    ? `Todas as 9 logs • ${inlineEmoji(client, "ligado")} <#${salesUnified}>`
    : salesMixed
      ? `Todas as 9 logs • ${inlineEmoji(client, "ligado")} múltiplos canais`
      : `Todas as 9 logs • ${inlineEmoji(client, "desligado")} não configurado`;
  const panel = new ContainerBuilder().setAccentColor(getGuildConfig(guildId).customColor || 0xffffff);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client, "canal")}Canais de Logs`));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`Escolha **o tipo de log** e depois selecione o canal onde ele será enviado. Cada log pode ir para um canal diferente para organizar seu servidor.`));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${inlineEmoji(client, "lightbulb")} **Como usar:** 1. Selecione um tipo abaixo → 2. Escolha o canal na próxima tela → 3. Pronto! O bot já começa a registrar nesse canal.\n-# ${inlineEmoji(client, "preview")} Dica: crie canais separados como \`#logs-gerais\`, \`#logs-vendas\` e \`#logs-tickets\` para não misturar.`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(scoped(ids.channelsSelect, userId))
        .setPlaceholder("Selecione o tipo de log para configurar")
        .addOptions(
          {
            label: "Canal de sistemas",
            value: "systemLogs",
            description: fmt("systemLogs", "Reinicializações e atualizações"),
            emoji: componentEmoji(client, "reload")
          },
          {
            label: "Logs gerais",
            value: "generalLogs",
            description: fmt("generalLogs", "Entradas e saídas"),
            emoji: componentEmoji(client, "embed")
          },
          {
            label: "Logs moderação",
            value: "moderationLogs",
            description: fmt("moderationLogs", "Canais criados/apagados"),
            emoji: componentEmoji(client, "wand")
          },
          {
            label: "Logs mensagens",
            value: "messageLogs",
            description: fmt("messageLogs", "Mensagens apagadas/editadas"),
            emoji: componentEmoji(client, "recibo")
          },
          {
            label: "Logs Middleman",
            value: "middlemanLogs",
            description: fmt("middlemanLogs", "Transcripts de middleman"),
            emoji: componentEmoji(client, "tradep")
          },
          {
            label: "Logs invites",
            value: "inviteLogs",
            description: fmt("inviteLogs", "Convites e contas"),
            emoji: componentEmoji(client, "users")
          },
          {
            label: "Canal de vouchs",
            value: "vouchChannel",
            description: fmt("vouchChannel", "Vouchs públicos"),
            emoji: componentEmoji(client, "verifiedp")
          },
          {
            label: "Big vouch (+R$500)",
            value: "bigVouchChannel",
            description: fmt("bigVouchChannel", "Trades grandes"),
            emoji: componentEmoji(client, "rendimentos")
          },
          {
            label: "Sales • todas as logs",
            value: "sales:all",
            description: salesDesc.slice(0, 100),
            emoji: componentEmoji(client, "bag")
          },
          {
            label: "Sales • categoria carrinhos",
            value: "sales:cartsCategory",
            description: fmt("sales:cartsCategory", "Categoria dos carrinhos"),
            emoji: componentEmoji(client, "diretorio")
          },
          {
            label: "Sales • feedbacks",
            value: "sales:feedbackChannel",
            description: fmt("sales:feedbackChannel", "Avaliações do comprador"),
            emoji: componentEmoji(client, "setass")
          },
          {
            label: "Tickets • logs",
            value: "tickets:logs",
            description: fmt("tickets:logs", "Tickets abertos/fechados"),
            emoji: componentEmoji(client, "recibo")
          },
          {
            label: "Sugestões",
            value: "suggestions",
            description: fmt("suggestions", "Canal de votação de ideias"),
            emoji: componentEmoji(client, "wand")
          },
          {
            label: "Solicitar Produtos • logs",
            value: "productRequestLogs",
            description: fmt("productRequestLogs", "Pedidos de novos produtos"),
            emoji: componentEmoji(client, "bag")
          },
          {
            label: "Verificação • logs",
            value: "verificationLogs",
            description: fmt("verificationLogs", "Membros verificados no auth"),
            emoji: componentEmoji(client, "w_shield")
          }
        )
    )
  );
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client, "lightbulb")} Cada opção mostra o status atual. Se aparecer \`não configurado\`, selecione e escolha o canal na próxima tela.`));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder()
      .setCustomId(scoped(ids.channelsCreateLogs, userId))
      .setLabel("Criar canais de logs")
      .setStyle(ButtonStyle.Success), client, "mais2")
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, ids.panelBackSettings, userId)));
  return panel;
}
function channelPickerPanel(client, guildId, userId, target) {
  const names = {
    systemLogs: "canal de sistemas",
    generalLogs: "logs gerais",
    moderationLogs: "logs de moderacao",
    messageLogs: "logs de mensagens",
    middlemanLogs: "logs de middleman",
    inviteLogs: "logs publicos de invites",
    vouchChannel: "vouchs publicos",
    bigVouchChannel: "big vouchs",
    "sales:all": "todas as logs de vendas",
    "sales:privateLogs": "logs privados de vendas",
    "sales:publicLogs": "logs publicos de vendas",
    "sales:orderLogs": "pedidos de vendas",
    "sales:paymentLogs": "pagamentos de vendas",
    "sales:confirmedLogs": "pagamentos confirmados",
    "sales:approvedLogs": "vendas aprovadas",
    "sales:deliveredLogs": "entregas de vendas",
    "sales:cancelledLogs": "vendas canceladas",
    "sales:errorLogs": "erros de vendas",
    "sales:cartsCategory": "categoria dos carrinhos",
    "sales:feedbackChannel": "feedbacks de vendas",
    "tickets:logs": "logs de tickets",
    suggestions: "canal de sugestões",
    productRequestLogs: "logs de solicitações de produto",
    verificationLogs: "logs de verificação"
  };
  const isCategory = target === "sales:cartsCategory";
  const cfg = getGuildConfig(guildId);
  const cur = (() => {
    if (target === "sales:all") {
      const vals = SALES_LOG_KEYS.map((k) => cfg.sales.channels[k]);
      return vals.every((v) => v && v === vals[0]) ? vals[0] : null;
    }
    if (target.startsWith("sales:")) return cfg.sales.channels[target.replace("sales:", "")];
    if (target.startsWith("tickets:")) return cfg.tickets.channels[target.replace("tickets:", "")];
    if (target === "vouchChannel" || target === "bigVouchChannel") return cfg.middleman[target];
    if (target === "suggestions") return cfg.suggestions.channelId;
    return cfg.channels[target];
  })();
  const panel = new ContainerBuilder().setAccentColor(getGuildConfig(guildId).customColor || 0xffffff);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client, "canal")}Selecionar ${isCategory ? "Categoria" : "Canal"}`));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `Você vai configurar **${names[target]}**.\n${cur ? `${inlineEmoji(client, "ligado")} Atual: <#${cur}>` : `${inlineEmoji(client, "desligado")} Ainda não configurado`}\n-# Escolha ${isCategory ? "a categoria onde os carrinhos serão criados (recomendado: \`Carrinhos\` no topo)" : "um canal de texto onde o bot tem permissão para enviar mensagens"}.`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${inlineEmoji(client, "lightbulb")} **Dica:** crie o canal antes e garanta que o bot tem \`Ver canal\` + \`Enviar mensagens\` + \`Incorporar links\`.`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(scoped(`panel:channelpicker:${target}`, userId))
        .setPlaceholder(isCategory ? "Selecione uma categoria" : "Selecione um canal de texto")
        .setChannelTypes(isCategory ? ChannelType.GuildCategory : ChannelType.GuildText, ...(isCategory ? [] : [ChannelType.GuildAnnouncement]))
        .setMinValues(1)
        .setMaxValues(1)
    )
  );
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client, "preview")} Selecione acima e confirme — a alteração é instantânea.`));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, ids.panelBackSettings, userId)));
  return panel;
}
function rolesPanel(client, guildId, userId) {
  const cfg = getGuildConfig(guildId);
  const getVal = (k) => {
    if (k.startsWith("sales:")) return cfg.sales.roles[k.replace("sales:", "")];
    if (k.startsWith("tickets:")) return cfg.tickets.roles[k.replace("tickets:", "")];
    return cfg.roles[k];
  };
  const fmt = (k, desc) => {
    const v = getVal(k);
    const has = Boolean(v);
    return `${desc} • ${has ? `${inlineEmoji(client, "ligado")} <@&${v}>` : `${inlineEmoji(client, "desligado")} não configurado`}`;
  };
  const panel = new ContainerBuilder().setAccentColor(getGuildConfig(guildId).customColor || 0xffffff);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client, "cargo")}Cargos e Permissões`));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`Defina quem tem poderes no bot e quem recebe cargos automaticamente. Cada cargo pode ter uma função diferente.`));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${inlineEmoji(client, "lightbulb")} **Guia rápido:**\n${inlineEmoji(client, "cargo")} **Administrador** = acesso total ao \`/panel\`\n${inlineEmoji(client, "user")} **Auto Role** = entregue ao entrar\n${inlineEmoji(client, "verifiedp")} **Trader/Vendas/Suporte** = recompensas e equipes`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(scoped(ids.rolesSelect, userId))
        .setPlaceholder("Selecione o cargo para configurar")
        .addOptions(
          {
            label: "Cargo administrador",
            value: "admin",
            description: fmt("admin", "Acesso total ao painel"),
            emoji: componentEmoji(client, "dev")
          },
          {
            label: "Cargo auto role",
            value: "autoRole",
            description: fmt("autoRole", "Entregue ao entrar"),
            emoji: componentEmoji(client, "user")
          },
          {
            label: "Cargo middleman",
            value: "middleman",
            description: fmt("middleman", "Marcado em tickets middleman"),
            emoji: componentEmoji(client, "userp")
          },
          {
            label: "Cargo trader",
            value: "trader",
            description: fmt("trader", "Após trade concluída"),
            emoji: componentEmoji(client, "verifiedp")
          },
          {
            label: "Sales • staff",
            value: "sales:staff",
            description: fmt("sales:staff", "Equipe de vendas"),
            emoji: componentEmoji(client, "users")
          },
          {
            label: "Sales • cliente",
            value: "sales:customer",
            description: fmt("sales:customer", "Após compra aprovada"),
            emoji: componentEmoji(client, "userp")
          },
          {
            label: "Tickets • suporte",
            value: "tickets:support",
            description: fmt("tickets:support", "Acesso ao painel de tickets"),
            emoji: componentEmoji(client, "users")
          }
        )
    )
  );
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client, "lightbulb")} Cada opção mostra o cargo atual. Se estiver \`não configurado\`, selecione e escolha o cargo na próxima tela.`));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder()
      .setCustomId(scoped(ids.rolesCreate, userId))
      .setLabel("Criar cargos")
      .setStyle(ButtonStyle.Success), client, "mais2")
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, ids.panelBackSettings, userId)));
  return panel;
}
function rolePickerPanel(client, guildId, userId, target) {
  const names = {
    admin: "administrador do bot",
    autoRole: "auto role (entregue ao entrar)",
    middleman: "middleman (assume tickets)",
    trader: "trader (após trade concluída)",
    "sales:staff": "staff de vendas (equipe)",
    "sales:customer": "cliente de vendas (após compra)",
    "tickets:support": "suporte de tickets (atende tickets)"
  };
  const cfg = getGuildConfig(guildId);
  const cur = (() => {
    if (target.startsWith("sales:")) return cfg.sales.roles[target.replace("sales:", "")];
    if (target.startsWith("tickets:")) return cfg.tickets.roles[target.replace("tickets:", "")];
    return cfg.roles[target];
  })();
  const panel = new ContainerBuilder().setAccentColor(getGuildConfig(guildId).customColor || 0xffffff);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client, "cargo")}Selecionar Cargo`));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `Você vai configurar **${names[target]}**.\n${cur ? `${inlineEmoji(client, "ligado")} Atual: <@&${cur}>` : `${inlineEmoji(client, "desligado")} Ainda não configurado`}\n-# Escolha um cargo existente no servidor. Crie antes em **Configurações → Cargos** se precisar.`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${inlineEmoji(client, "lightbulb")} **Exemplo:** \`@Administrador\` para total, \`@Atendente\` para suporte, \`@Cliente\` para quem comprou.`));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(scoped(`panel:rolepicker:${target}`, userId))
        .setPlaceholder("Selecione um cargo")
        .setMinValues(1)
        .setMaxValues(1)
    )
  );
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, ids.panelBackSettings, userId)));
  return panel;
}
function systemsPanel(client, guildId, userId) {
  const cfg = getGuildConfig(guildId);
  const mm = cfg.middleman;
  const status = mm.enabled ? `${inlineEmoji(client, "ligado")} Ativado • Modo ${mm.mode === "automatic" ? "automático (Efí)" : "manual"}` : `${inlineEmoji(client, "desligado")} Desativado`;
  const panel = new ContainerBuilder().setAccentColor(getGuildConfig(guildId).customColor || 0xffffff);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client, "wand")}Sistemas Avançados`));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`Módulos extras que expandem seu servidor. **Middleman** para trades, **Parcerias** para divulgação automática e **OAuth2** para verificação de membros.`));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  const partCfg = (()=>{ try{ return require("../partnerships/store").getConfig(); }catch{ return {enabled:false}; }})();
  const partStatus = partCfg.enabled ? `${inlineEmoji(client, "ligado")} Ativo` : `${inlineEmoji(client, "desligado")} Inativo`;
  const oauthCfg = (()=>{ try{
    const store = require("../oauth2/store");
    return { configured: store.isBotConfigured(), total: store.getVerifiedList().length, name: store.getStore().bot?.botName || null };
  }catch{ return {configured:false, total:0, name:null}; }})();
  const oauthStatus = oauthCfg.configured ? `${inlineEmoji(client, "ligado")} ${oauthCfg.name || "Configurado"} • ${oauthCfg.total} verificado(s)` : `${inlineEmoji(client, "desligado")} Inativo`;
  const giveCfg = (()=>{ try{
    const store = require("../giveaways/store");
    return { active: store.listActive().length };
  }catch{ return {active:0}; }})();
  const giveStatus = giveCfg.active ? `${inlineEmoji(client, "ligado")} ${giveCfg.active} ativo(s)` : `${inlineEmoji(client, "desligado")} Nenhum ativo`;
  const affCfg = (()=>{ try{
    const store = require("../affiliates/store");
    const cfg = store.getConfig();
    return { enabled: cfg.enabled, amount: Number(cfg.amountPerInvite || 0).toFixed(2).replace(".", ",") };
  }catch{ return {enabled:false, amount:"0,00"}; }})();
  const affStatus = affCfg.enabled ? `${inlineEmoji(client, "ligado")} Ativo • R$ ${affCfg.amount}/convite` : `${inlineEmoji(client, "desligado")} Inativo`;
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${inlineEmoji(client, "tradep")} **Middleman:** ${status}\n`+
    `${inlineEmoji(client, "users")} **Parcerias:** ${partStatus} — Contagem automática de links \`discord.gg\`\n`+
    `${inlineEmoji(client, "w_shield")} **OAuth2:** ${oauthStatus} — Verificação via conta Discord\n`+
    `${inlineEmoji(client, "w_party")} **Sorteios:** ${giveStatus} — Prêmios com timer e ganhadores automáticos\n`+
    `${inlineEmoji(client, "w_users")} **Afiliados:** ${affStatus} — Comissão por convite que ficar 24h\n`+
    `-# Middleman: intermedia trades PIX • Parcerias: ranking + pontos diário/semanal • OAuth2: exige verificação no carrinho/ticket`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(scoped(ids.systemsSelect, userId))
        .setPlaceholder("Selecione um sistema para configurar")
        .addOptions(
          {
            label: "Middleman",
            value: "middleman",
            description: mm.enabled ? `Ativado • Toque para gerenciar` : "Desativado • Toque para ativar",
            emoji: componentEmoji(client, "pixp")
          },
          {
            label: "Parcerias",
            value: "partnership",
            description: partCfg.enabled ? `Ativo • Canal ${partCfg.channelId ? "configurado" : "pendente"}` : "Desativado • Toque para ativar",
            emoji: componentEmoji(client, "users")
          },
          {
            label: "OAuth2",
            value: "oauth2",
            description: oauthCfg.configured ? `${oauthCfg.name || "Bot auth"} • ${oauthCfg.total} verificado(s)` : "Desativado • Toque para configurar",
            emoji: componentEmoji(client, "w_shield")
          },
          {
            label: "Sorteios",
            value: "giveaway",
            description: giveCfg.active ? `${giveCfg.active} ativo(s) • Toque para gerenciar` : "Nenhum ativo • Toque para criar",
            emoji: componentEmoji(client, "w_party")
          },
          {
            label: "Afiliados",
            value: "affiliates",
            description: affCfg.enabled ? `Ativo • R$ ${affCfg.amount} por convite` : "Desativado • Toque para configurar",
            emoji: componentEmoji(client, "w_users")
          }
        )
    )
  );
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client, "lightbulb")} **Iniciante?** Ative o Middleman em 2 cliques: selecione acima → **Habilitar** → escolha o modo.`));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, ids.panelBackMain, userId)));
  return panel;
}
function middlemanAdminPanel(client, guildId, userId) {
  const config = getGuildConfig(guildId);
  const mm = config.middleman;
  const efiOk = isEfiConfigured(config.payments.efi);
  const statusBadge = mm.enabled ? `${inlineEmoji(client, "ligado")} Habilitado` : `${inlineEmoji(client, "desligado")} Desativado`;
  const modeBadge = mm.mode === "automatic" ? `${inlineEmoji(client, "reload")} Automático (Efí)` : `${inlineEmoji(client, "userp")} Manual (humano)`;
  const efiBadge = efiOk ? `${inlineEmoji(client, "ligado")} Efí OK` : `${inlineEmoji(client, "desligado")} Efí pendente`;
  const needEfiWarn = mm.enabled && mm.mode === "automatic" && !efiOk ? `\n${inlineEmoji(client, "ban")} **Atenção:** modo automático exige Efí configurado em **Configurações → Formas de Pagamento**!` : "";
  const panel = new ContainerBuilder().setAccentColor(mm.color || getGuildConfig(guildId).customColor || 0xffffff);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client, "tradep")} Middleman`));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `Sistema de intermediação PIX seguro. Bot cria threads privadas, calcula taxas e registra logs.\n` +
    `${statusBadge} ╺╸ ${modeBadge} ╺╸ ${efiBadge}${needEfiWarn}\n` +
    `${inlineEmoji(client, "wand")} Cor: **#${mm.color.toString(16).padStart(6, "0").toUpperCase()}**`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${inlineEmoji(client, "lightbulb")} **Como usar:** 1. **Habilitar** → 2. Escolha **Manual** (cargo) ou **Automático** (precisa Efí) → 3. **Enviar Painel** no canal de vendas.`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      withEmoji(new ButtonBuilder()
        .setCustomId(scoped(ids.mmToggle, userId))
        .setLabel(mm.enabled ? "Desabilitar" : "Habilitar Middleman")
        .setStyle(mm.enabled ? ButtonStyle.Danger : ButtonStyle.Success), client, mm.enabled ? "desligado" : "ligado"),
      withEmoji(new ButtonBuilder()
        .setCustomId(scoped(ids.mmAppearance, userId))
        .setLabel("Aparência")
        .setStyle(ButtonStyle.Secondary), client, "preview"),
      withEmoji(new ButtonBuilder()
        .setCustomId(scoped(ids.mmManage, userId))
        .setLabel("Taxas e Modo")
        .setStyle(ButtonStyle.Secondary), client, "config2")
    )
  );
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      withEmoji(new ButtonBuilder()
        .setCustomId(scoped(ids.mmPreview, userId))
        .setLabel("Prévia")
        .setStyle(ButtonStyle.Secondary), client, "visible"),
      withEmoji(new ButtonBuilder()
        .setCustomId(scoped(ids.mmSendPanel, userId))
        .setLabel("Enviar Painel")
        .setStyle(ButtonStyle.Primary), client, "canal"),
      backButton(client, ids.panelSystems, userId)
    )
  );
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client, "preview")} Use **Prévia** para ver como o cliente vê, antes de enviar.`));
  return panel;
}
function middlemanAppearancePanel(client, guildId, userId) {
  const mm = getGuildConfig(guildId).middleman;
  const panel = new ContainerBuilder().setAccentColor(mm.color || getGuildConfig(guildId).customColor || 0xffffff);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client, "preview")} Aparência do Middleman`));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `Personalize o painel público que seus clientes veem.\n` +
    `${inlineEmoji(client, "fields")} **Descrição:** ${mm.description.slice(0,60)}...\n` +
    `${inlineEmoji(client, "preview")} **Banner:** ${mm.banner ? "configurado" : "vazio"} ╺╸ ${inlineEmoji(client, "visible")} **Thumbnail:** ${mm.thumbnail ? "configurado" : "vazio"} ╺╸ ${inlineEmoji(client, "wand")} **Cor:** #${mm.color.toString(16).padStart(6,"0").toUpperCase()}`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client, "lightbulb")} **Dica:** descrição curta e clara aumenta confiança. Banner 1920x600, thumbnail 512x512.`));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(scoped(ids.mmAppearanceSelect, userId))
        .setPlaceholder("Escolha o que personalizar")
        .addOptions(
          { label: "Descrição", value: "description", description: "Texto principal do painel público", emoji: componentEmoji(client, "fields") },
          { label: "Banner • imagem topo", value: "banner", description: "URL https:// (1920x600)", emoji: componentEmoji(client, "preview") },
          { label: "Thumbnail • ícone", value: "thumbnail", description: "URL https:// (512x512)", emoji: componentEmoji(client, "visible") },
          { label: "Cor da barra lateral", value: "color", description: "Ex: #FFFFFF branco", emoji: componentEmoji(client, "wand") }
        )
    )
  );
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, "panel:mm:back", userId)));
  return panel;
}
function middlemanManagePanel(client, guildId, userId) {
  const mm = getGuildConfig(guildId).middleman;
  const efiOk = isEfiConfigured(getGuildConfig(guildId).payments.efi);
  const panel = new ContainerBuilder().setAccentColor(mm.color || getGuildConfig(guildId).customColor || 0xffffff);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client, "config2")} Gerenciar Middleman`));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `Ajuste fino do sistema.\n` +
    `${inlineEmoji(client, "pricep")} **Taxas:** ${mm.fees === "none" ? "desativadas" : `${mm.feeRules.length} regras`} ╺╸ ${inlineEmoji(client, "tradep")} **Modo:** ${mm.mode === "automatic" ? "automático" : "manual"} ${mm.mode === "automatic" && !efiOk ? `${inlineEmoji(client, "ban")} Efí pendente!` : ""}`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client, "lightbulb")} **Taxas** = quanto o bot cobra por trade. **Modo** = manual (humano assume) ou automático (Efí).`));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      withEmoji(new ButtonBuilder().setCustomId(scoped(ids.mmManageFees, userId)).setLabel(`Taxas • ${mm.fees === "none" ? "Off" : "On"}`).setStyle(mm.fees === "none" ? ButtonStyle.Secondary : ButtonStyle.Primary), client, "pricep"),
      withEmoji(new ButtonBuilder().setCustomId(scoped(ids.mmManageMode, userId)).setLabel(`Modo: ${mm.mode === "automatic" ? "Auto" : "Manual"}`).setStyle(ButtonStyle.Secondary), client, "tradep"),
      backButton(client, "panel:mm:back", userId)
    )
  );
  return panel;
}
function middlemanFeesPanel(client, guildId, userId) {
  const config = getGuildConfig(guildId);
  const rules = config.middleman.feeRules || [];
  const panel = new ContainerBuilder().setAccentColor(config.middleman.color || getGuildConfig(guildId).customColor || 0xffffff);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client, "pricep")} Taxas do Middleman`));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `Defina quanto cobrar por valor da trade. O bot escolhe a maior regra que o valor **ultrapassa**.\n` +
    `${inlineEmoji(client, "ligado")} **Status:** ${config.middleman.fees === "none" ? "Taxas desativadas — grátis" : `Ativas • ${rules.length} regras`}\n` +
    `-# Ex: trade R$250 com regra "R$2,15 acima de R$200" → taxa R$2,15. Se descrição contiver "conta" + R$${config.middleman.accountExtraFee}.`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(scoped(ids.mmFeesSelect, userId))
        .setPlaceholder("Selecione a taxa para editar ou ativar/desativar")
        .addOptions(
          ...rules.map((rule, index) => ({
            label: `Regra ${index + 1} • R$${rule.above} → ${rule.type === "percent" ? `${rule.value}%` : `R$${rule.value}`}`,
            value: `rule:${index}`,
            description: `${rule.type === "percent" ? `Porcentagem` : `Fixo`} acima de R$${String(rule.above).replace(".", ",")}`,
            emoji: componentEmoji(client, "pricep")
          })),
          {
            label: "Taxa extra • conta",
            value: "account",
            description: `+R$${String(config.middleman.accountExtraFee ?? 4).replace(".", ",")} se texto tiver "conta"`,
            emoji: componentEmoji(client, "bank")
          },
          {
            label: config.middleman.fees === "none" ? "Ativar todas as taxas" : "Desativar todas as taxas",
            value: "toggle",
            description: config.middleman.fees === "none" ? "Liga cobrança" : "Deixa trades grátis",
            emoji: componentEmoji(client, config.middleman.fees === "none" ? "ligado" : "desligado")
          }
        )
    )
  );
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client, "lightbulb")} Dica: deixe 5 regras crescentes (2.5, 100, 200, 400, 700) para cobrir todos os valores.`));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, ids.mmManage, userId)));
  return panel;
}
function middlemanModePanel(client, guildId, userId) {
  const cfg = getGuildConfig(guildId);
  const efiOk = isEfiConfigured(cfg.payments.efi);
  const current = cfg.middleman.mode === "automatic" ? "Automático" : "Manual";
  const panel = new ContainerBuilder().setAccentColor(cfg.middleman.color || getGuildConfig(guildId).customColor || 0xffffff);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client, "tradep")} Modo do Middleman`));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `Escolha como o bot vai operar:\n` +
    `${inlineEmoji(client, "reload")} **Automático:** bot gera Pix, verifica e repassa sozinho **${efiOk ? inlineEmoji(client, "ligado") + " Efí OK" : inlineEmoji(client, "ban") + " PRECISA Efí" }**\n` +
    `${inlineEmoji(client, "userp")} **Manual:** marca <@&${cfg.roles.middleman || "cargo"}> para humano assumir, conferir comprovante e liberar.\n` +
    `${inlineEmoji(client, "lightbulb")} **Atual:** **${current}** ${!efiOk ? "— automático bloqueado até configurar **Efí Bank** em **Configurações → Formas de Pagamento**" : ""}`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(scoped(ids.mmModeSelect, userId))
        .setPlaceholder(efiOk ? "Selecione o modo" : "Automático bloqueado — configure Efí")
        .addOptions(
          { label: "Automático — Efí Bank", value: "automatic", description: efiOk ? "Bot faz tudo sozinho" : "Bloqueado: Efí não configurado", emoji: componentEmoji(client, "reload") },
          { label: "Manual — Humano assume", value: "manual", description: "Cargo Middleman assume cada ticket", emoji: componentEmoji(client, "userp") }
        )
    )
  );
  if (!efiOk) {
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client, "ban")} **Para usar automático:** vá em \`/panel\` → Configurações → Formas de Pagamento → Efí Bank → preencha ID/Secret/Certificado e habilite.`));
  }
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, ids.mmManage, userId)));
  return panel;
}
function middlemanSendChannelPanel(client, guildId, userId) {
  const mm = getGuildConfig(guildId).middleman;
  const panel = new ContainerBuilder().setAccentColor(mm.color || getGuildConfig(guildId).customColor || 0xffffff);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client, "canal")} Enviar Painel Público`));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `Escolha onde o painel que os clientes usam para **abrir middleman** será enviado.\n` +
    `${mm.enabled ? `${inlineEmoji(client, "ligado")} Middleman habilitado` : `${inlineEmoji(client, "desligado")} Habilite primeiro em **Middleman → Habilitar**`}\n` +
    `-# O painel público tem botão **Trade PIX** e mostra taxas atuais. Envie em \`#middleman\` ou \`#trades\`.`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(scoped(ids.mmSendChannel, userId))
        .setPlaceholder("Selecione o canal de vendas para enviar")
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(1)
        .setMaxValues(1)
    )
  );
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client, "lightbulb")} Dica: use **Prévia** antes para ver como fica.`));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, "panel:mm:back", userId)));
  return panel;
}
function providerListField(client, name, enabled, configured, configuredLabel = "credenciais completas", missingLabel = "credenciais pendentes") {
  const state = !enabled
    ? `${inlineEmoji(client, "desligado")}Desativado`
    : configured
      ? `${inlineEmoji(client, "ligado")}Ativo — ${configuredLabel}`
      : `${inlineEmoji(client, "wand")}Ativo — ${missingLabel}`;
  return { name, value: state, inline: true };
}
function panelAuthor(client) {
  return {
    name: client.user?.username || "Bot",
    iconURL: client.user?.displayAvatarURL?.() || undefined
  };
}
function panelFooter(client, guildId) {
  const guild = client.guilds.cache.get(guildId);
  return {
    text: guild ? `Painel • ${guild.name}` : "Painel de pagamentos",
    iconURL: guild?.iconURL?.() || client.user?.displayAvatarURL?.() || undefined
  };
}
function panelAccentColor(guildId, fallback = 0x2b2d31) {
  return getGuildConfig(guildId).customColor || fallback;
}
function paymentProviderPanel(client, guildId, userId) {
  const config = getGuildConfig(guildId);
  const pix = config.payments.pix;
  const mp = config.payments.mercadoPago;
  const efi = config.payments.efi;
  const efiOk = isEfiConfigured(efi);
  const mpOk = Boolean(mp.enabled && mp.accessToken);
  const pixOk = Boolean(pix.key);
  const stripe = config.payments.stripe;
  const stripeOk = isStripeConfigured(stripe);
  const panel = new ContainerBuilder().setAccentColor(panelAccentColor(guildId, 0x2ecc71));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client, "carteira")}Formas de Pagamento`));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`Escolha como seus clientes vão pagar. **Pix manual**, **Mercado Pago**, **Efí Bank** e **Stripe** — cada um pode ser ligado separado.`));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    [
      `${efi.enabled ? inlineEmoji(client, "ligado") : inlineEmoji(client, "desligado")} **Efí Bank:** ${efi.enabled ? (efiOk ? "Ativo — pronto" : "Ativo — falta certificado/ID") : "Desativado"} ${efiOk ? inlineEmoji(client, "ligado") : ""}`,
      `${mp.enabled ? inlineEmoji(client, "ligado") : inlineEmoji(client, "desligado")} **Mercado Pago:** ${mp.enabled ? (mpOk ? "Ativo — token OK" : "Ativo — falta token") : "Desativado"}`,
      `${stripe.enabled ? inlineEmoji(client, "ligado") : inlineEmoji(client, "desligado")} **Stripe:** ${stripe.enabled ? (stripeOk ? "Ativo — Pix global pronto" : "Ativo — falta Secret Key") : "Desativado"} ${stripeOk ? inlineEmoji(client, "ligado") : ""}`,
      `${pix.enabled ? inlineEmoji(client, "ligado") : inlineEmoji(client, "desligado")} **Pix manual:** ${pix.enabled ? (pixOk ? `Ativo — \`${pix.key}\`` : "Ativo — sem chave") : "Desativado"}`
    ].join("\n")
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client, "lightbulb")} **Iniciante:** use **Pix manual** primeiro. Para aprovação automática, configure **Stripe** (global) ou **Efí/Mercado Pago** (Brasil).`));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(scoped(ids.paymentProviderSelect, userId))
      .setPlaceholder("Selecione a forma para configurar")
      .addOptions(
        {
          label: "Pix manual",
          value: "pix",
          description: pixOk ? `Chave: ${pix.key.slice(0,20)}...` : "Toque para cadastrar chave",
          emoji: componentEmoji(client, "pix")
        },
        {
          label: "Stripe • Pix Global",
          value: "stripe",
          description: stripeOk ? "Pix via Stripe — pronto" : "Precisa Secret Key sk_...",
          emoji: componentEmoji(client, "stripe")
        },
        {
          label: "Mercado Pago",
          value: "mercado_pago",
          description: mpOk ? "Token OK — pronto" : "Precisa configurar token",
          emoji: componentEmoji(client, "mercadopagoE")
        },
        {
          label: "Efí Bank",
          value: "efi",
          description: efiOk ? "Certificado OK — pronto" : "Precisa de ID/Secret/Certificado",
          emoji: componentEmoji(client, "efibankE")
        }
      )
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(closeButton(client, ids.paymentClose, userId), backButton(client, ids.panelBackSettings, userId)));
  return { components: [panel], flags: UPDATE_V2 };
}
function efiBankPanel(client, guildId, userId) {
  const config = getGuildConfig(guildId);
  const efi = config.payments.efi;
  const ok = isEfiConfigured(efi);
  const panel = new ContainerBuilder().setAccentColor(efi.enabled ? (ok ? 0x2ecc71 : 0xf1c40f) : 0x4f545c);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client, "efibankE")}Efí Bank ${efi.enabled ? inlineEmoji(client, "ligado") : inlineEmoji(client, "desligado")}`));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`Pix automático que **gera cobrança, verifica pagamento e repassa ao vendedor** sem você precisar conferir manualmente.`));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${efi.enabled ? `${inlineEmoji(client, "ligado")} **Situação:** Ativo` : `${inlineEmoji(client, "desligado")} **Situação:** Desativado`} ${ok ? "— pronto" : "— falta configuração"}\n` +
    `${efi.certificatePath ? `${inlineEmoji(client, "attach")} **Certificado:** enviado` : `${inlineEmoji(client, "desligado")} **Certificado:** nenhum enviado — envie o .p12/.pem`}\n` +
    `${inlineEmoji(client, "hash")} **Client ID:** \`${efi.clientId ? "definido" : "vazio"}\`  •  **Secret:** \`${efi.clientSecret ? "definido" : "vazio"}\`\n` +
    `${inlineEmoji(client, "pix")} **Chave Pix:** ${efi.pixKey ? `\`${efi.pixKey}\`` : "`gerada na 1ª venda`"}`
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client, "lightbulb")} **Passo a passo:** 1. Clique **Configurar** (ID/Secret) → 2. **Enviar certificado** (.p12) → 3. **Habilitar**. Teste com uma compra de R$1.`));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  const buttonRow = new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder()
      .setCustomId(scoped(ids.efiToggle, userId))
      .setLabel(efi.enabled ? "Desabilitar" : "Habilitar Efí")
      .setStyle(efi.enabled ? ButtonStyle.Danger : ButtonStyle.Success), client, efi.enabled ? "desligado" : "ligado"),
    withEmoji(new ButtonBuilder()
      .setCustomId(scoped(ids.efiConfigure, userId))
      .setLabel("Configurar ID/Secret")
      .setStyle(ButtonStyle.Primary), client, "editar"),
    withEmoji(new ButtonBuilder()
      .setCustomId(scoped(ids.efiCertificateUpload, userId))
      .setLabel("Enviar certificado")
      .setStyle(ButtonStyle.Secondary), client, "attach")
  );
  panel.addActionRowComponents(buttonRow);
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, ids.paymentOpen, userId), closeButton(client, ids.paymentClose, userId)));
  return { components: [panel], flags: UPDATE_V2 };
}
function mercadoPagoPanel(client, guildId, userId) {
  const config = getGuildConfig(guildId);
  const mp = config.payments.mercadoPago;
  const ok = Boolean(mp.accessToken);
  const panel = new ContainerBuilder().setAccentColor(mp.enabled ? (ok ? 0x2ecc71 : 0xf1c40f) : 0x4f545c);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client, "mercadopagoE")}Mercado Pago ${mp.enabled ? inlineEmoji(client, "ligado") : inlineEmoji(client, "desligado")}`));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`Pix automático: **gera e confere pagamento sozinho** e aprova o carrinho sem você.`));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${mp.enabled ? `${inlineEmoji(client, "ligado")} **Situação:** Ativo` : `${inlineEmoji(client, "desligado")} **Situação:** Desativado`} ${ok ? "— token OK" : "— falta access token"}\n` +
    `${inlineEmoji(client, "hash")} **Access token:** \`${mp.accessToken ? "definido" : "vazio"}\`\n` +
    `${inlineEmoji(client, "recibo")} **Email pagador:** \`${mp.payerEmail || "comprador@example.com"}\` -# usado só para gerar cobrança`
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client, "lightbulb")} **Como usar:** 1. Ative → 2. **Configurar** e cole o \`APP_USR-...\` do painel do Mercado Pago → 3. Deixe **Ativo**.`));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  const buttonRow = new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder()
      .setCustomId(scoped(ids.mercadoPagoToggle, userId))
      .setLabel(mp.enabled ? "Desabilitar" : "Habilitar Mercado Pago")
      .setStyle(mp.enabled ? ButtonStyle.Danger : ButtonStyle.Success), client, mp.enabled ? "desligado" : "ligado"),
    withEmoji(new ButtonBuilder()
      .setCustomId(scoped(ids.mercadoPagoConfigure, userId))
      .setLabel("Configurar token")
      .setStyle(ButtonStyle.Primary), client, "editar")
  );
  panel.addActionRowComponents(buttonRow);
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, ids.paymentOpen, userId), closeButton(client, ids.paymentClose, userId)));
  return { components: [panel], flags: UPDATE_V2 };
}
function stripePanel(client, guildId, userId) {
  const config = getGuildConfig(guildId);
  const stripe = config.payments.stripe;
  const ok = isStripeConfigured(stripe);
  const panel = new ContainerBuilder().setAccentColor(stripe.enabled ? (ok ? 0x635bff : 0xf1c40f) : 0x4f545c);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client, "stripe")}Stripe ${stripe.enabled ? inlineEmoji(client, "ligado") : inlineEmoji(client, "desligado")}`));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`Pix global via Stripe: **internacional, Cartão + Pix**, aprovação automática. Ideal para vender fora do Brasil.`));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${stripe.enabled ? `${inlineEmoji(client, "ligado")} **Situação:** Ativo` : `${inlineEmoji(client, "desligado")} **Situação:** Desativado`} ${ok ? "— Secret Key OK" : "— falta Secret Key"}\n` +
    `${inlineEmoji(client, "hash")} **Secret Key:** \`${stripe.secretKey ? stripe.secretKey.slice(0, 12) + "..." : "vazia"}\` ${ok ? "(sk_live_ ou sk_test_)" : ""}\n` +
    `${inlineEmoji(client, "cartao")} **Moeda:** \`${(stripe.currency || "brl").toUpperCase()}\` ${stripe.currency === "usd" ? "— Cartão internacional + carrinho em inglês" : "— Pix Brasil"}\n` +
    `${inlineEmoji(client, "pix")} **PIX:** via PaymentIntent ${stripe.currency === "usd" ? "Card (USD)" : "Pix (BRL)"} — Stripe gera QR Code e copia e cola`
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client, "lightbulb")} **Como usar:** 1. Pegue a **Secret Key** em dashboard.stripe.com → Developers → API keys → 2. **Configurar** e cole \`sk_live_...\` → 3. Escolha a **moeda** abaixo → 4. **Habilitar**.`));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client, "preview")} **Teste:** \`sk_test_...\` + ${stripe.currency === "usd" ? "Cartão teste 4242 4242 4242 4242" : "Pix teste Stripe"}. Produção: \`sk_live_...\`.`));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(scoped(ids.stripeCurrencySelect, userId))
      .setPlaceholder(`Moeda atual: ${(stripe.currency || "brl").toUpperCase()}`)
      .addOptions(
        { label: "BRL — Real (Pix)", value: "brl", description: "Pix Brasil, carrinho em português", emoji: componentEmoji(client, "pix"), default: stripe.currency === "brl" },
        { label: "USD — Dólar (Cartão)", value: "usd", description: "Card internacional, carrinho em inglês", emoji: componentEmoji(client, "cartao") }
      )
  ));
  const buttonRow = new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder()
      .setCustomId(scoped(ids.stripeToggle, userId))
      .setLabel(stripe.enabled ? "Desabilitar Stripe" : "Habilitar Stripe")
      .setStyle(stripe.enabled ? ButtonStyle.Danger : ButtonStyle.Success), client, stripe.enabled ? "desligado" : "ligado"),
    withEmoji(new ButtonBuilder()
      .setCustomId(scoped(ids.stripeConfigure, userId))
      .setLabel(stripe.secretKey ? "Alterar Secret Key" : "Configurar Secret Key")
      .setStyle(ButtonStyle.Primary), client, "editar")
  );
  panel.addActionRowComponents(buttonRow);
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, ids.paymentOpen, userId), closeButton(client, ids.paymentClose, userId)));
  return { components: [panel], flags: UPDATE_V2 };
}
function pixPanel(client, guildId, userId) {
  const config = getGuildConfig(guildId);
  const enabled = config.payments.pix.enabled;
  const typeLabel = pixTypeLabel(config.payments.pix.type);
  const hasKey = Boolean(config.payments.pix.key);
  const panel = new ContainerBuilder().setAccentColor(enabled ? (hasKey ? 0x2ecc71 : 0xf1c40f) : 0x4f545c);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client, "pix")}Pix Manual ${enabled ? inlineEmoji(client, "ligado") : inlineEmoji(client, "desligado")}`));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`Pix estático: você confirma o pagamento manualmente. Ideal para começar rápido sem burocracia.`));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${enabled ? `${inlineEmoji(client, "ligado")} **Situação:** Ativo` : `${inlineEmoji(client, "desligado")} **Situação:** Desativado`} ${hasKey ? "— chave OK" : "— falta chave"}\n` +
    `${inlineEmoji(client, "hash")} **Tipo da chave:** \`${typeLabel}\`\n` +
    `${inlineEmoji(client, "pix")} **Chave Pix:** ${hasKey ? `\`${config.payments.pix.key}\`` : "`não configurada`"}`
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client, "lightbulb")} **Como usar:** 1. Escolha o **tipo** abaixo (CPF, Email, etc) → 2. Clique **Configurar** e cole a chave → 3. **Habilitar**.`));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(scoped(ids.pixTypeSelect, userId))
      .setPlaceholder("Tipo da chave Pix (onde o cliente paga)")
      .addOptions(
        { label: "Email", value: "email", description: "ex: loja@email.com", emoji: componentEmoji(client, "recibo") },
        { label: "Chave aleatória", value: "random", description: "ex: a1b2c3d4-e5f6...", emoji: componentEmoji(client, "wand") },
        { label: "CPF", value: "cpf", description: "ex: 123.456.789-00", emoji: componentEmoji(client, "user") },
        { label: "Número de telefone", value: "phone", description: "ex: +55 11 99999-9999", emoji: componentEmoji(client, "clock") },
        { label: "CNPJ", value: "cnpj", description: "ex: 12.345.678/0001-99", emoji: componentEmoji(client, "bank") }
      )
  );
  panel.addActionRowComponents(selectRow);
  const buttonRow = new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder()
      .setCustomId(scoped(ids.paymentToggle, userId))
      .setLabel(enabled ? "Desabilitar Pix" : "Habilitar Pix")
      .setStyle(enabled ? ButtonStyle.Danger : ButtonStyle.Success), client, enabled ? "desligado" : "ligado"),
    withEmoji(new ButtonBuilder()
      .setCustomId(scoped(ids.paymentConfigure, userId))
      .setLabel(hasKey ? "Alterar chave" : "Configurar chave")
      .setStyle(ButtonStyle.Primary), client, "editar"),
    backButton(client, ids.paymentOpen, userId)
  );
  panel.addActionRowComponents(buttonRow);
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(closeButton(client, ids.paymentClose, userId)));
  return { components: [panel], flags: UPDATE_V2 };
}
function customizePanel(client, guildId, userId) {
  const config = getGuildConfig(guildId);
  const colorLabel = config.customColor ? intToHex(config.customColor) : "padrão (sem cor)";
  const hasColor = Boolean(config.customColor);
  const panel = new ContainerBuilder().setAccentColor(config.customColor || 0xffffff);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client, "wand")}Personalizar Aparência`));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `Deixe o bot com a cara do seu servidor. A **cor** aparece na barra lateral de todos os painéis do \`/panel\`, tickets e vendas, e o **perfil** muda avatar/banner do bot.`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${hasColor ? `${inlineEmoji(client, "ligado")} Cor atual: **${colorLabel}**` : `${inlineEmoji(client, "desligado")} Cor atual: **${colorLabel}**`}\n-# Exemplo: \`#FFFFFF\` branco, \`#2ecc71\` verde, \`#3498db\` azul. Deixe vazio para remover.`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      withEmoji(new ButtonBuilder()
        .setCustomId(scoped(ids.customizeColor, userId))
        .setLabel(hasColor ? "Alterar Cor" : "Definir Cor")
        .setStyle(hasColor ? ButtonStyle.Primary : ButtonStyle.Success), client, "wand"),
      withEmoji(new ButtonBuilder()
        .setCustomId(scoped(ids.customizeProfile, userId))
        .setLabel("Perfil")
        .setStyle(ButtonStyle.Secondary), client, "user"),
      withEmoji(new ButtonBuilder()
        .setCustomId(scoped(ids.salesReceipt, userId))
        .setLabel("Sales")
        .setStyle(ButtonStyle.Secondary), client, "carrinhoCancelado"),
      backButton(client, ids.panelBackMain, userId)
    )
  );
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client, "lightbulb")} **Dica:** use a cor do seu logo. A mudança é instantânea. Use **Perfil** para avatar/banner.`));
  return panel;
}
function customizeProfileModal(userId){
  const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder: M } = require("discord.js");
  return new ModalBuilder()
    .setCustomId(`${require("../../config").ids.customizeProfileModal}:${userId}`)
    .setTitle("Perfil do Bot — Avatar & Banner")
    .addComponents(
      new M().addComponents(new TextInputBuilder().setCustomId("avatar").setLabel("URL do Avatar (opcional)").setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder("https://exemplo.com/avatar.png").setMaxLength(500)),
      new M().addComponents(new TextInputBuilder().setCustomId("banner").setLabel("URL do Banner (opcional)").setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder("https://exemplo.com/banner.png ou gif").setMaxLength(500))
    );
}
function storeHoursPanel(client, guildId, userId) {
  const cfg = getGuildConfig(guildId);
  const h = cfg.storeHours;
  const daysMap = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const daysStr = h.days.length === 7 ? "Todos os dias" : h.days.map(d => daysMap[d]).join(", ");
  const panel = new ContainerBuilder().setAccentColor(getGuildConfig(guildId).customColor || 0x00C853);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client, "clock")} Horário da Loja`));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `Defina quando a loja fica **aberta automaticamente**. Fora do horário, o botão de compra mostra \`Loja fechada\` e não abre carrinho.\n` +
    `${h.enabled ? `${inlineEmoji(client, "ligado")} **Ativo:** \`${h.open} – ${h.close}\` • ${daysStr}` : `${inlineEmoji(client, "desligado")} **Desativado:** loja sempre aberta (só fechamento manual)`}\n` +
    `-# Fuso: \`${h.timezone}\` (America/Sao_Paulo). Ex: 09:00–18:00 de Seg a Sex.`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder().setCustomId(scoped(ids.panelStoreHoursToggle, userId)).setLabel(h.enabled ? "Desativar Horário" : "Ativar Horário").setStyle(h.enabled ? ButtonStyle.Danger : ButtonStyle.Success), client, h.enabled ? "desligado" : "ligado"),
    withEmoji(new ButtonBuilder().setCustomId(scoped(ids.panelStoreHoursConfig, userId)).setLabel("Configurar Horário").setStyle(ButtonStyle.Primary), client, "editar"),
    backButton(client, ids.panelBackMain, userId)
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client, "lightbulb")} Use **Configurar Horário** para definir abertura/fechamento e dias. Suporta virada (22:00–02:00).`));
  return panel;
}
function storeHoursModal(userId, cfg) {
  const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder: MAction } = require("discord.js");
  return new ModalBuilder()
    .setCustomId(`${ids.panelStoreHoursModal}:${userId}`)
    .setTitle("Configurar Horário da Loja")
    .addComponents(
      new MAction().addComponents(new TextInputBuilder().setCustomId("open").setLabel("Abertura (HH:MM)").setStyle(TextInputStyle.Short).setValue(cfg.open || "09:00").setRequired(true).setMaxLength(5).setPlaceholder("09:00")),
      new MAction().addComponents(new TextInputBuilder().setCustomId("close").setLabel("Fechamento (HH:MM)").setStyle(TextInputStyle.Short).setValue(cfg.close || "18:00").setRequired(true).setMaxLength(5).setPlaceholder("18:00")),
      new MAction().addComponents(new TextInputBuilder().setCustomId("days").setLabel("Dias (0=Dom,1=Seg...6=Sáb, ex: 1,2,3,4,5)").setStyle(TextInputStyle.Short).setValue((cfg.days || [1,2,3,4,5]).join(",")).setRequired(true).setMaxLength(13).setPlaceholder("1,2,3,4,5"))
    );
}
function backButton(client, targetId, userId) {
  return withEmoji(new ButtonBuilder()
    .setCustomId(scoped(targetId, userId))
    .setLabel("Voltar")
    .setStyle(ButtonStyle.Secondary), client, "reload");
}
function closeButton(client, targetId, userId) {
  return withEmoji(new ButtonBuilder()
    .setCustomId(scoped(targetId, userId))
    .setLabel("Fechar")
    .setStyle(ButtonStyle.Secondary), client, "apagar");
}
function intToHex(value) {
  return `#${Number(value || 0).toString(16).padStart(6, "0").slice(-6).toUpperCase()}`;
}
function pixTypeLabel(value) {
  const labels = {
    email: "Email",
    random: "Chave aleatoria",
    cpf: "CPF",
    phone: "Numero de telefone",
    cnpj: "CNPJ"
  };
  return labels[value] || "Email";
}
function panelPayload(component) {
  return {
    components: [component],
    flags: UPDATE_V2
  };
}
function replyPanelPayload(component) {
  return {
    components: [component],
    flags: EPHEMERAL_V2
  };
}
function noticePayload(client, { title = null, desc = "", color = 0xffffff, ephemeral = true } = {}) {
  const builder = new ContainerBuilder().setAccentColor(color);
  const head = title
    ? `## ${inlineEmoji(client, "w_bulb")} ${title}\n${desc}`
    : `${inlineEmoji(client, "w_bulb")} ${desc}`;
  builder.addTextDisplayComponents(new TextDisplayBuilder().setContent(head));
  return { components: [builder], flags: ephemeral ? EPHEMERAL_V2 : UPDATE_V2 };
}
function prettyPayload(client, payload, { title = null, color = 0xffffff, ephemeralDefault = true } = {}) {
  if (typeof payload === "string") {
    if (!payload) return payload;
    return noticePayload(client, { title, desc: payload, color, ephemeral: false });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  if (!payload.content || payload.components || payload.embeds || payload.files) return payload;
  const { content, title: hint, ...rest } = payload;
  const built = noticePayload(client, { title: hint || title, desc: String(content), color });
  let flags;
  if (typeof rest.flags === "number") flags = rest.flags | MessageFlags.IsComponentsV2;
  else flags = ephemeralDefault ? EPHEMERAL_V2 : UPDATE_V2;
  return { ...rest, ...built, flags };
}
module.exports = {
  EPHEMERAL_V2,
  UPDATE_V2,
  scoped,
  parseCustomId,
  panelPayload,
  replyPanelPayload,
  noticePayload,
  prettyPayload,
  mainPanel,
  mainPanelPayload,
  startPanelAutoRefresh,
  stopPanelAutoRefresh,
  tutorialPanel,
  tutorialPanelPayload,
  container,
  inlineEmoji,
  earningsPanel,
  automationsRootPanel,
  autoMessagesRootPanel,
  repostRootPanel,
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
  systemsPanel,
  middlemanAdminPanel,
  middlemanAppearancePanel,
  middlemanManagePanel,
  middlemanFeesPanel,
  middlemanModePanel,
  middlemanSendChannelPanel,
  customizePanel,
  customizeProfileModal,
  storeHoursPanel,
  storeHoursModal,
  pixTypeLabel,
  intToHex,
  componentEmoji,
  bannerAttachment,
  hasBanner,
  BANNER_PATH,
  BANNER_FILENAME
};
