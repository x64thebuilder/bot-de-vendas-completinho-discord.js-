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
  RoleSelectMenuBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");
const { ids } = require("../../config");
const { getGuildConfig } = require("../../storage");
const { scoped, componentEmoji, inlineEmoji } = require("../panel");
const V2 = MessageFlags.IsComponentsV2;
const V2_EPHEMERAL = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
const COLOR = 0xffffff;
const OK_COLOR = 0x2ecc71;
const DANGER_COLOR = 0xe74c3c;
const HISTORY_PER_PAGE = 8;
const MIN_DURATION_MS = 60 * 1000;
const MAX_DURATION_MS = 30 * 24 * 3600 * 1000;
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
function withEmoji(client, builder, name) {
  const found = componentEmoji(client, name);
  return found ? builder.setEmoji(found) : builder;
}
function parseDuration(raw) {
  const text = String(raw || "").trim().toLowerCase().replace(/,/g, ".");
  if (!text) return null;
  if (/^\d+(\.\d+)?$/.test(text)) {
    return Math.round(Number(text) * 60 * 1000) || null;
  }
  const tokenRe = /(\d+(?:\.\d+)?)\s*([dhms])/g;
  let total = 0;
  let count = 0;
  let lastIndex = 0;
  let m;
  tokenRe.lastIndex = 0;
  while ((m = tokenRe.exec(text)) !== null) {
    if (text.slice(lastIndex, m.index).trim() !== "") return null; 
    lastIndex = m.index + m[0].length;
    const value = Number(m[1]);
    if (m[2] === "d") total += value * 86400;
    else if (m[2] === "h") total += value * 3600;
    else if (m[2] === "m") total += value * 60;
    else total += value;
    count++;
    if (count > 8) return null;
  }
  if (!count) return null;
  const rest = text.slice(lastIndex).trim();
  if (rest) {
    if (!/^\d+(\.\d+)?$/.test(rest)) return null;
    total += Number(rest) * 60;
  }
  return Math.round(total * 1000) || null;
}
function formatDuration(ms) {
  const totalMin = Math.max(1, Math.round(ms / 60000));
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (mins || !parts.length) parts.push(`${mins}m`);
  return parts.join(" ");
}
function requirementsLine(g) {
  const req = g.requirements || {};
  const parts = [];
  if (req.roleId) parts.push(`cargo <@&${req.roleId}>`);
  if (Number(req.minAccountDays) > 0) parts.push(`conta com ${req.minAccountDays}+ dias`);
  if (req.verifiedOnly) parts.push("conta verificada");
  return parts.length ? parts.join(" • ") : "nenhum (aberto para todos)";
}
function prizeTypeLine(o = {}) {
  let cfg = { type: "campo", amount: 0, stock: null };
  try {
    cfg = require("./store").getPrizeConfig(o);
  } catch {   }
  if (cfg.type === "saldo") {
    return `Saldo: R$ ${Number(cfg.amount).toFixed(2).replace(".", ",")}`;
  }
  if (cfg.type === "estoque" && cfg.stock) {
    try {
      const sales = require("../sales");
      const product = sales.getProduct(null, cfg.stock.productId);
      const field = product?.fields?.[cfg.stock.fieldId];
      return `Estoque: ${cfg.stock.qty}x ${field?.name || "?"} (${product?.name || "?"})`;
    } catch {
      return `Estoque: ${cfg.stock.qty}x`;
    }
  }
  return "Manual (equipe entrega)";
}
function appearanceLine(g) {
  const ap = g.appearance || {};
  const parts = [];
  if (ap.color != null) parts.push(`cor #${Number(ap.color).toString(16).padStart(6, "0").toUpperCase()}`);
  if (ap.banner) parts.push("banner");
  if (ap.thumbnail) parts.push("thumbnail");
  if (ap.buttonLabel && ap.buttonLabel !== "Participar") parts.push(`botão "${ap.buttonLabel}"`);
  if (ap.description) parts.push("descrição extra");
  return parts.length ? parts.join(" • ") : "padrão";
}
function rootPanel(client, guildId, userId) {
  const active = require("./store").listActive();
  const panel = new ContainerBuilder().setAccentColor(accent(guildId));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${inlineEmoji(client, "w_party")}Sorteios`
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `Crie sorteios com timer, ganhadores automáticos e requisitos.\n` +
    `${inlineEmoji(client, "w_party")} **Ativos agora:** ${active.length}`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  if (active.length) {
    const options = active.slice(0, 25).map((g) => ({
      label: String(g.prize || "Sorteio").slice(0, 100),
      value: g.id,
      description: `Termina <t:${Math.floor((g.endsAt || Date.now()) / 1000)}:R> • ${g.participants.length} participante(s)`.slice(0, 100),
      emoji: componentEmoji(client, "w_party")
    }));
    panel.addActionRowComponents(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(scoped(ids.giveawayManage, userId))
        .setPlaceholder("Gerenciar um sorteio ativo")
        .addOptions(options)
    ));
  }
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withEmoji(client, new ButtonBuilder().setCustomId(scoped(ids.giveawayCreate, userId)).setLabel("Criar Sorteio").setStyle(ButtonStyle.Success), "positivo"),
    withEmoji(client, new ButtonBuilder().setCustomId(scoped(ids.giveawayHistory, userId)).setLabel("Histórico").setStyle(ButtonStyle.Secondary), "w_clock")
  ));
  return panel;
}
function createModal(userId) {
  const modal = new ModalBuilder()
    .setCustomId(scoped(ids.giveawayCreateModal, userId))
    .setTitle("Criar Sorteio");
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("prize").setLabel("Prêmio").setStyle(TextInputStyle.Short)
        .setRequired(true).setMaxLength(200).setPlaceholder("Ex: Nitro Basic mensal")
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("winners").setLabel("Nº de ganhadores").setStyle(TextInputStyle.Short)
        .setRequired(true).setMaxLength(3).setPlaceholder("1").setValue("1")
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("duration").setLabel("Duração (min, 1h30, 2d...)").setStyle(TextInputStyle.Short)
        .setRequired(true).setMaxLength(20).setPlaceholder("Ex: 1d ou 2h30m")
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("minAge").setLabel("Idade mín. da conta (dias, 0 = sem)").setStyle(TextInputStyle.Short)
        .setRequired(false).setMaxLength(5).setPlaceholder("0").setValue("0")
    )
  );
  return modal;
}
function draftRequirementsLine(d) {
  const parts = [];
  if (d.roleId) parts.push(`cargo <@&${d.roleId}>`);
  if (Number(d.minAccountDays) > 0) parts.push(`conta com ${d.minAccountDays}+ dias`);
  if (d.verifiedOnly) parts.push("conta verificada");
  return parts.length ? parts.join(" • ") : "nenhum";
}
function draftBonusLine(d) {
  return prizeTypeLine(d);
}
function editPanel(client, guildId, userId, d) {
  const panel = new ContainerBuilder().setAccentColor(accent(guildId));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${inlineEmoji(client, "w_party")}Editar Sorteio`
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `-# \`RASCUNHO\` — revise tudo antes de enviar. Depois de enviado não dá mais para editar.`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `**Prêmio:** ${d.prize || "—"}\n` +
    `**Tipo:** ${prizeTypeLine(d)}\n` +
    `**Ganhadores:** ${d.winnersCount} • **Duração:** ${formatDuration(d.durationMs)}\n` +
    `**Requisitos:** ${draftRequirementsLine(d)}\n` +
    `**Aparência:** ${appearanceLine({ appearance: d.appearance })}\n` +
    `**Mensagem PV:** ${d.dmMessage ? `\`${String(d.dmMessage).slice(0, 60)}${d.dmMessage.length > 60 ? "…" : ""}\`` : "padrão"}`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(scoped(ids.giveawayEditSelect, userId))
      .setPlaceholder("O que editar?")
      .addOptions(
        { label: "Configurar Prêmio", value: "prizeconfig", description: "Nome + tipo: saldo, estoque ou manual", emoji: componentEmoji(client, "w_party") },
        { label: "Duração", value: "duration", description: "Tempo até o sorteio", emoji: componentEmoji(client, "w_clock") },
        { label: "Ganhadores", value: "winners", description: "Quantos ganham", emoji: componentEmoji(client, "w_users") },
        { label: "Requisitos", value: "requirements", description: "Cargo, idade e verificação", emoji: componentEmoji(client, "w_shield") },
        { label: "Aparência", value: "appearance", description: "Cor, banner, botão", emoji: componentEmoji(client, "w_eye") },
        { label: "Mensagem PV", value: "dm", description: "DM do ganhador", emoji: componentEmoji(client, "w_send") }
      )
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withEmoji(client, new ButtonBuilder().setCustomId(scoped(ids.giveawaySend, userId)).setLabel("Enviar Sorteio").setStyle(ButtonStyle.Success), "w_check"),
    withEmoji(client, new ButtonBuilder().setCustomId(scoped(ids.giveawayDraftDelete, userId)).setLabel("Excluir").setStyle(ButtonStyle.Danger), "w_x")
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, ids.giveawayBack, userId)));
  return panel;
}
function reqPanel(client, guildId, userId, d) {
  const panel = new ContainerBuilder().setAccentColor(accent(guildId));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${inlineEmoji(client, "w_shield")}Requisitos`
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `Quem pode participar do sorteio:\n` +
    `**Cargo:** ${d.roleId ? `<@&${d.roleId}>` : "nenhum"}\n` +
    `**Idade mínima:** ${Number(d.minAccountDays) > 0 ? `${d.minAccountDays} dias` : "sem mínimo"}\n` +
    `**Verificação:** ${d.verifiedOnly ? "exigida" : "não exigida"}`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId(scoped(ids.giveawayEditRoleSelect, userId))
      .setPlaceholder(d.roleId ? "Trocar cargo (0 = remover)" : "Exigir um cargo (opcional)")
      .setMinValues(0)
      .setMaxValues(1)
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withEmoji(client, new ButtonBuilder().setCustomId(scoped(ids.giveawayEditVerified, userId)).setLabel(d.verifiedOnly ? "Verificação: ON" : "Verificação: OFF").setStyle(d.verifiedOnly ? ButtonStyle.Success : ButtonStyle.Secondary), "w_shield"),
    withEmoji(client, new ButtonBuilder().setCustomId(scoped(ids.giveawayEditAge, userId)).setLabel("Idade mínima").setStyle(ButtonStyle.Secondary), "w_clock"),
    backButton(client, ids.giveawayEdit, userId)
  ));
  return panel;
}
function stockProductPanel(client, guildId, userId, products) {
  const panel = new ContainerBuilder().setAccentColor(accent(guildId));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${inlineEmoji(client, "w_cart")}Bônus em Estoque`
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `Cada ganhador recebe o item automaticamente na DM. Escolha o produto:`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  const options = products.slice(0, 24).map((p) => ({
    label: String(p.name || "Produto").slice(0, 100),
    value: String(p.id).slice(0, 100),
    description: `${Object.keys(p.fields || {}).length} campo(s)`.slice(0, 100),
    emoji: componentEmoji(client, "w_cart")
  }));
  options.push({ label: "Remover bônus", value: "__none", description: "Sem item de estoque", emoji: componentEmoji(client, "w_x") });
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(scoped(ids.giveawayEditProduct, userId))
      .setPlaceholder("Escolha o produto")
      .addOptions(options)
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, ids.giveawayEdit, userId)));
  return panel;
}
function stockFieldPanel(client, guildId, userId, product, fields) {
  const panel = new ContainerBuilder().setAccentColor(accent(guildId));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${inlineEmoji(client, "w_cart")}Campo de **${product.name}**`
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`Escolha qual campo sai do estoque:`));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(scoped(`${ids.giveawayEditField}:${product.id}`, userId))
      .setPlaceholder("Escolha o campo")
      .addOptions(fields.slice(0, 25).map((f) => {
        const stock = f.phantom ? (f.phantom.quantity === "infinite" ? "∞" : String(f.phantom.quantity)) : String((f.stock || []).length);
        return {
          label: String(f.name || "Campo").slice(0, 100),
          value: String(f.id).slice(0, 100),
          description: `Estoque: ${stock}`.slice(0, 100),
          emoji: componentEmoji(client, "w_cart")
        };
      }))
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, ids.giveawayEdit, userId)));
  return panel;
}
function simpleModal(userId, customId, title, fieldId, label, style, value, placeholder, maxLength, required = true) {
  const modal = new ModalBuilder().setCustomId(scoped(customId, userId)).setTitle(title);
  const input = new TextInputBuilder().setCustomId(fieldId).setLabel(label).setStyle(style).setRequired(required).setMaxLength(maxLength);
  if (value) input.setValue(String(value).slice(0, Math.min(4000, maxLength)));
  if (placeholder) input.setPlaceholder(placeholder);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}
function prizeModal(userId, d) {
  return simpleModal(userId, ids.giveawayPrizeModal, "Prêmio", "prize", "Prêmio do sorteio", TextInputStyle.Short, d.prize, "Ex: Nitro Basic mensal", 200);
}
function durationModal(userId, d) {
  return simpleModal(userId, ids.giveawayDurationModal, "Duração", "duration", "Duração (min, 1h30, 2d...)", TextInputStyle.Short, formatDuration(d.durationMs), "Ex: 1d ou 2h30m", 20);
}
function winnersModal(userId, d) {
  return simpleModal(userId, ids.giveawayWinnersModal, "Ganhadores", "winners", "Nº de ganhadores (1-25)", TextInputStyle.Short, String(d.winnersCount), "1", 3);
}
function ageModal(userId, d) {
  return simpleModal(userId, ids.giveawayAgeModal, "Idade Mínima", "minAge", "Dias (0 = sem mínimo)", TextInputStyle.Short, String(d.minAccountDays || 0), "0", 5, false);
}
function appearanceModal(userId, d) {
  const ap = d.appearance || {};
  const modal = new ModalBuilder().setCustomId(scoped(ids.giveawayAppearanceModal, userId)).setTitle("Aparência do Sorteio");
  const row = (id, label, style, value, placeholder, required = false, max = 500) => {
    const input = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(max);
    if (value) input.setValue(String(value).slice(0, Math.min(4000, max)));
    if (placeholder) input.setPlaceholder(placeholder);
    return new ActionRowBuilder().addComponents(input);
  };
  modal.addComponents(
    row("color", "Cor (ex: #FFFFFF, vazio = padrão)", TextInputStyle.Short, ap.color != null ? `#${Number(ap.color).toString(16).padStart(6, "0").toUpperCase()}` : "", "#FFFFFF", false, 7),
    row("banner", "Banner (URL, opcional)", TextInputStyle.Short, ap.banner || "", "https://...", false),
    row("thumbnail", "Thumbnail (URL, opcional)", TextInputStyle.Short, ap.thumbnail || "", "https://...", false),
    row("button", "Botão (padrão: Participar)", TextInputStyle.Short, ap.buttonLabel === "Participar" ? "" : (ap.buttonLabel || ""), "Participar", false, 80),
    row("description", "Descrição extra (opcional)", TextInputStyle.Paragraph, ap.description || "", "Texto abaixo dos requisitos", false, 1000)
  );
  return modal;
}
function dmModal(userId, d) {
  return simpleModal(userId, ids.giveawayDmModal, "Mensagem do Ganhador", "message", "Mensagem da DM (vazio = padrão)", TextInputStyle.Paragraph, d.dmMessage || "", "Use {ganhador} e {premio}", 2000, false);
}
function saldoModal(userId, d) {
  let amount = 0;
  try {
    amount = Number(require("./store").getPrizeConfig(d).amount) || 0;
  } catch { amount = 0; }
  const current = amount > 0 ? amount.toFixed(2).replace(".", ",") : "";
  return simpleModal(userId, ids.giveawaySaldoModal, "Bônus em Saldo", "amount", "R$ por ganhador (0 = sem bônus)", TextInputStyle.Short, current, "Ex: 25,00", 20);
}
function stockQtyModal(userId, currentQty) {
  return simpleModal(userId, ids.giveawayStockQtyModal, "Quantidade", "qty", "Qtd por ganhador", TextInputStyle.Short, String(currentQty || 1), "1", 4);
}
function detailPanel(client, guildId, userId, g) {
  const panel = new ContainerBuilder().setAccentColor(accent(guildId));
  const req = g.requirements || {};
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${inlineEmoji(client, "w_party")}${g.status === "active" ? "Sorteio ativo" : "Sorteio encerrado"}`
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `**Prêmio:** ${g.prize}\n` +
    `**Ganhadores:** ${g.winnersCount} • **Participantes:** ${g.participants.length}\n` +
    (g.status === "active"
      ? `**Termina:** <t:${Math.floor(g.endsAt / 1000)}:F> (<t:${Math.floor(g.endsAt / 1000)}:R>)\n`
      : `**Encerrou:** <t:${Math.floor((g.endedAt || Date.now()) / 1000)}:F>\n`) +
    `**Requisitos:** ${requirementsLine(g)}\n` +
    `**Aparência:** ${appearanceLine(g)}\n` +
    `**Prêmio:** ${prizeTypeLine(g)}\n` +
    `**Mensagem PV:** ${g.dmMessage ? "personalizada" : "padrão"}` +
    (g.status !== "active" && g.winners?.length ? `\n**Últimos ganhadores:** ${g.winners.map((id) => `<@${id}>`).join(" ")}` : "")
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `-# Enviado: não dá mais para editar. Gerencie abaixo.`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  const row = new ActionRowBuilder();
  if (g.status === "active") {
    row.addComponents(
      withEmoji(client, new ButtonBuilder().setCustomId(scoped(`${ids.giveawayEnd}:${g.id}`, userId)).setLabel("Encerrar agora").setStyle(ButtonStyle.Primary), "w_check"),
      withEmoji(client, new ButtonBuilder().setCustomId(scoped(`${ids.giveawayCancel}:${g.id}`, userId)).setLabel("Cancelar").setStyle(ButtonStyle.Danger), "w_x")
    );
  } else {
    row.addComponents(
      withEmoji(client, new ButtonBuilder().setCustomId(scoped(`${ids.giveawayReroll}:${g.id}`, userId)).setLabel("Sortear de novo").setStyle(ButtonStyle.Primary), "w_refresh")
    );
  }
  panel.addActionRowComponents(row);
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, ids.giveawayBack, userId)));
  return panel;
}
function historyPanel(client, guildId, userId, page = 0) {
  const history = require("./store").getHistory();
  const totalPages = Math.max(1, Math.ceil(history.length / HISTORY_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const slice = history.slice(safePage * HISTORY_PER_PAGE, safePage * HISTORY_PER_PAGE + HISTORY_PER_PAGE);
  const panel = new ContainerBuilder().setAccentColor(accent(guildId));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${inlineEmoji(client, "w_clock")}Histórico de Sorteios (${history.length})`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  if (!slice.length) {
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`Nenhum sorteio encerrado ainda.`));
  } else {
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      slice.map((h) =>
        `${h.cancelled ? "❌" : "🎉"} **${h.prize}** — <t:${Math.floor((h.endedAt || Date.now()) / 1000)}:D>\n` +
        `-# ${h.cancelled ? "cancelado" : `${(h.winners || []).length} ganhador(es)`} • ${h.participantsCount || 0} participante(s)` +
        (!h.cancelled && h.winners?.length ? ` • ${h.winners.slice(0, 3).map((id) => `<@${id}>`).join(" ")}` : "")
      ).join("\n")
    ));
  }
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Página ${safePage + 1} de ${totalPages}`));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  const prev = new ButtonBuilder()
    .setCustomId(scoped(`${ids.giveawayHistoryPage}:${safePage - 1}`, userId))
    .setLabel("◀").setStyle(ButtonStyle.Secondary).setDisabled(safePage <= 0);
  const next = new ButtonBuilder()
    .setCustomId(scoped(`${ids.giveawayHistoryPage}:${safePage + 1}`, userId))
    .setLabel("▶").setStyle(ButtonStyle.Secondary).setDisabled(safePage >= totalPages - 1);
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    prev, next, backButton(client, ids.giveawayBack, userId)
  ));
  return panel;
}
function prizeBonusPublic(g) {
  let cfg = { type: "campo", amount: 0, stock: null };
  try {
    cfg = require("./store").getPrizeConfig(g);
  } catch {}
  if (cfg.type === "saldo" && cfg.amount > 0) {
    return `\n**Bônus:** R$ ${Number(cfg.amount).toFixed(2).replace(".", ",")} em saldo para cada ganhador`;
  }
  if (cfg.type === "estoque" && cfg.stock) {
    return `\n**Bônus:** item do estoque para cada ganhador`;
  }
  return "";
}
function publicPanel(client, guildId, g) {
  const endsUnix = Math.floor(g.endsAt / 1000);
  const ap = g.appearance || {};
  const color = typeof ap.color === "number" ? ap.color : OK_COLOR;
  const panel = new ContainerBuilder().setAccentColor(color);
  if (ap.banner) {
    try {
      panel.addMediaGalleryComponents(new MediaGalleryBuilder({ items: [{ media: { url: ap.banner }, description: g.prize }] }));
    } catch {}
  }
  const headerTitle = `## ${inlineEmoji(client, "w_party")}SORTEIO: ${g.prize}`;
  const headerBody =
    `Termina <t:${endsUnix}:R> (<t:${endsUnix}:F>)\n` +
    `**Ganhadores:** ${g.winnersCount} • **Participantes:** ${g.participants.length}\n` +
    `**Requisitos:** ${requirementsLine(g)}` +
    prizeBonusPublic(g) +
    (ap.description ? `\n${ap.description}` : "");
  if (ap.thumbnail) {
    try {
      const { SectionBuilder, ThumbnailBuilder } = require("discord.js");
      panel.addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(headerTitle),
            new TextDisplayBuilder().setContent(headerBody)
          )
          .setThumbnailAccessory(new ThumbnailBuilder().setURL(ap.thumbnail).setDescription("Sorteio"))
      );
    } catch {
      panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${headerTitle}\n${headerBody}`));
    }
  } else {
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${headerTitle}\n${headerBody}`));
  }
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  const btn = new ButtonBuilder()
    .setCustomId(`${ids.giveawayJoin}:${g.id}`)
    .setLabel((ap.buttonLabel || "Participar").slice(0, 80) || "Participar")
    .setStyle(ButtonStyle.Success);
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withEmoji(client, btn, "w_party")
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Boa sorte! Sorteio automático.`));
  return panel;
}
function publicEndedPanel(client, guildId, g) {
  const panel = new ContainerBuilder().setAccentColor(accent(guildId));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${inlineEmoji(client, "w_party")}SORTEIO ENCERRADO: ${g.prize}`
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    g.winners?.length
      ? `**Ganhadores:** ${g.winners.map((id) => `<@${id}>`).join(" ")}\n-# ${g.participants.length} participante(s) • Encerrado <t:${Math.floor((g.endedAt || Date.now()) / 1000)}:R>${g.rerolls ? ` • ${g.rerolls} re-sorteio(s)` : ""}`
      : `Ninguém participou desta vez.\n-# Encerrado <t:${Math.floor((g.endedAt || Date.now()) / 1000)}:R>`
  ));
  return panel;
}
function prizePanel(client, guildId, userId, d) {
  const cfg = require("./store").getPrizeConfig(d);
  const panel = new ContainerBuilder().setAccentColor(accent(guildId));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${inlineEmoji(client, "w_party")}Configurar Prêmio`
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `Só vale **um tipo** por sorteio — trocar limpa o anterior.\n` +
    `**Nome:** ${d.prize || "—"}\n` +
    `**Tipo atual:** **${cfg.type === "saldo" ? "Saldo" : cfg.type === "estoque" ? "Estoque" : "Manual"}**` +
    (cfg.type === "saldo" ? ` (${prizeTypeLine(d)})` : cfg.type === "estoque" ? ` (${prizeTypeLine(d)})` : " (equipe entrega)") + `\n` +
    `-# Saldo = crédito automático • Estoque = item automático na DM • Manual = anúncio + DM, entrega pela equipe`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(scoped(ids.giveawayPrizeType, userId))
      .setPlaceholder("Escolha o tipo (só um)")
      .addOptions(
        { label: "Saldo", value: "saldo", description: cfg.type === "saldo" ? `Atual • ${prizeTypeLine(d)}`.slice(0, 100) : "Creditar R$ no ganhador", emoji: componentEmoji(client, "w_chart") },
        { label: "Estoque", value: "estoque", description: cfg.type === "estoque" ? `Atual • ${prizeTypeLine(d)}`.slice(0, 100) : "Item da loja automático", emoji: componentEmoji(client, "w_cart") },
        { label: "Manual", value: "campo", description: cfg.type === "campo" ? "Atual • equipe entrega" : "Só anúncio + DM", emoji: componentEmoji(client, "w_user") }
      )
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withEmoji(client, new ButtonBuilder().setCustomId(scoped(ids.giveawayPrizeName, userId)).setLabel("Nome do prêmio").setStyle(ButtonStyle.Secondary), "w_eye"),
    backButton(client, ids.giveawayEdit, userId)
  ));
  return panel;
}
function sendPanel(client, guildId, userId) {
  const panel = new ContainerBuilder().setAccentColor(accent(guildId));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${inlineEmoji(client, "w_send")}Enviar Sorteio`
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `Escolha o canal abaixo **ou** envie neste canal atual. Depois de enviado não dá mais para editar.`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(scoped(ids.giveawaySendChannel, userId))
      .setPlaceholder("Selecione o canal do sorteio")
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(1)
      .setMaxValues(1)
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withEmoji(client, new ButtonBuilder().setCustomId(scoped(ids.giveawaySendHere, userId)).setLabel("Enviar neste canal").setStyle(ButtonStyle.Success), "w_send"),
    backButton(client, ids.giveawayEdit, userId)
  ));
  return panel;
}
module.exports = {
  HISTORY_PER_PAGE,
  MIN_DURATION_MS,
  MAX_DURATION_MS,
  parseDuration,
  formatDuration,
  requirementsLine,
  prizeTypeLine,
  appearanceLine,
  rootPanel,
  createModal,
  detailPanel,
  historyPanel,
  publicPanel,
  publicEndedPanel,
  editPanel,
  reqPanel,
  stockProductPanel,
  stockFieldPanel,
  prizePanel,
  sendPanel,
  prizeModal,
  durationModal,
  winnersModal,
  ageModal,
  appearanceModal,
  dmModal,
  saldoModal,
  stockQtyModal
};
