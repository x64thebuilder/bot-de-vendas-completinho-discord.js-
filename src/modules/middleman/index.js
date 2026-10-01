const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  MediaGalleryBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  UserSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");
const QRCode = require("qrcode");
const { getGuildConfig, setGuildConfig } = require("../../storage");
const { readGuildFile, writeGuildFile } = require("../../guildDb");
const { componentEmoji } = require("../panel");
const { createEfiPixCharge, getEfiPixCharge, sendEfiPix } = require("../../efibank");
const V2 = MessageFlags.IsComponentsV2;
const V2_EPHEMERAL = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
const TRADES_NAMESPACE = "middleman-trades";
function readTrades(guildId) {
  return readGuildFile(guildId, TRADES_NAMESPACE, () => ({}));
}
function writeTrades(guildId, data) {
  writeGuildFile(guildId, TRADES_NAMESPACE, data);
}
function getTrade(id) {
  return readTrades(null)[id];
}
function setTrade(id, updater) {
  const data = readTrades(null);
  const current = data[id];
  if (!current && typeof updater === "function") return undefined;
  data[id] = typeof updater === "function" ? updater(current) : updater;
  writeTrades(null, data);
  return data[id];
}
function getTradeByThreadId(guildId, threadId) {
  return Object.values(readTrades(guildId)).find((item) => item.threadId === threadId);
}
function createTrade(data) {
  const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const guildId = data.guildId;
  const all = readTrades(guildId);
  all[id] = {
    id,
    createdAt: Date.now(),
    status: "waiting_partner",
    participantIds: [data.creatorId],
    buyerId: null,
    sellerId: null,
    confirms: [],
    finalConfirms: [],
    mode: data.mode,
    guildId: data.guildId,
    threadId: data.threadId,
    creatorId: data.creatorId,
    assigneeId: null,
    amount: null,
    fee: null,
    total: null,
    item: null,
    sellerPix: null,
    sellerPixType: null,
    efiTxid: null,
    efiStatus: null,
    efiQrCode: null,
    efiQrCodeBase64: null,
    efiLocationId: null,
    efiPayoutId: null,
    efiPayoutStatus: null,
    efiPayoutE2eId: null,
    dispute: false,
    panelMessageId: null
  };
  writeTrades(guildId, all);
  return all[id];
}
function publicMiddlemanPanel(client, guildId) {
  const config = getGuildConfig(guildId);
  const mm = config.middleman;
  const efiOk = (() => { try { const e = config.payments.efi; return e.enabled && e.clientId && e.clientSecret && e.certificatePath; } catch { return false; } })();
  const modeBadge = mm.mode === "automatic"
    ? (efiOk ? `${componentEmoji(client, "ligado") ? `<:${componentEmoji(client, "ligado").name}:${componentEmoji(client, "ligado").id}> ` : ""}Automático • Efí OK` : `Automático • Efí pendente`)
    : `Manual • Humano assume`;
  const panel = new ContainerBuilder()
    .setAccentColor(mm.color)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## ${componentEmoji(client, "tradep") ? `<:${componentEmoji(client, "tradep").name}:${componentEmoji(client, "tradep").id}> ` : ""}Middleman Seguro`)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${mm.description}\n\n${componentEmoji(client, "ligado") ? `<:${componentEmoji(client, "ligado").name}:${componentEmoji(client, "ligado").id}> ` : ""}**Modo:** ${modeBadge}`)
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**${componentEmoji(client, "pricep") ? `<:${componentEmoji(client, "pricep").name}:${componentEmoji(client, "pricep").id}> ` : ""}Taxas atuais:**\n${feeText(mm)}\n-# ${mm.mode === "automatic" && !efiOk ? "Configure Efí Bank para liberar o automático." : "Taxa cai automaticamente no valor final."}`)
    );
  const mediaItems = [
    mm.banner ? { media: { url: mm.banner }, description: "Banner" } : null,
    mm.thumbnail ? { media: { url: mm.thumbnail }, description: "Thumbnail" } : null
  ].filter(Boolean);
  if (mediaItems.length) {
    panel.addMediaGalleryComponents(new MediaGalleryBuilder({ items: mediaItems }));
  }
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("mm:public:select")
        .setPlaceholder("Escolha o tipo de trade para começar")
        .addOptions(
          { label: "Trade PIX • Recomendado", value: "trade_pix", description: "Intermediação segura via PIX", emoji: componentEmoji(client, "pixp") },
          { label: "Cross-trade • Em breve", value: "cross_trade", description: "Indisponível no momento", emoji: componentEmoji(client, "tradep") }
        )
    )
  );
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${componentEmoji(client, "lightbulb") ? `<:${componentEmoji(client, "lightbulb").name}:${componentEmoji(client, "lightbulb").id}> ` : ""}Selecione **Trade PIX** para abrir seu ticket privado.
-# creator: x64thebuilder/.200021`));
  return panel;
}
function ticketIntroPanel(client, guildId, trade) {
  const config = getGuildConfig(guildId);
  const panel = new ContainerBuilder()
    .setAccentColor(config.middleman.color)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Middleman de PIX criado\nTicket **${config.middleman.mode === "automatic" ? "automatico" : "manual"}** iniciado com seguranca.\n\n**Como continua:**\n1. Adicione o outro participante.\n2. Cada pessoa escolhe seu papel.\n3. O comprador informa o valor e o vendedor descreve a entrega.\n4. Ambos revisam antes de qualquer pagamento.`
      )
    )
    .addSeparatorComponents(new SeparatorBuilder());
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(`mm:partner:select:${trade.id}`)
        .setPlaceholder("Selecione o outro usuario...")
        .setMinValues(1)
        .setMaxValues(1)
    )
  );
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      button(client, `mm:addid:${trade.id}`, "Adicionar por ID", ButtonStyle.Secondary, "mais2"),
      button(client, `mm:cancel:${trade.id}`, "Cancelar Ticket", ButtonStyle.Danger, "negativo"),
      button(client, `mm:terms:${trade.id}`, "Termos MM", ButtonStyle.Secondary, "recibo")
    )
  );
  return panel;
}
function roleChoicePanel(client, guildId, trade) {
  const config = getGuildConfig(guildId);
  return new ContainerBuilder()
    .setAccentColor(config.middleman.color)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Definir papeis\nCada participante deve escolher apenas o proprio papel.\n\nComprador: ${trade.buyerId ? `<@${trade.buyerId}>` : "**aguardando escolha**"}\nVendedor: ${trade.sellerId ? `<@${trade.sellerId}>` : "**aguardando escolha**"}`
      )
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        button(client, `mm:role:pay:${trade.id}`, "Vou pagar", ButtonStyle.Primary, "dollar"),
        button(client, `mm:role:sell:${trade.id}`, "Vou vender", ButtonStyle.Secondary, "caixa")
      )
    );
}
function confirmRolesPanel(client, guildId, trade) {
  const config = getGuildConfig(guildId);
  return new ContainerBuilder()
    .setAccentColor(config.middleman.color)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Confirmar papeis\nComprador: <@${trade.buyerId}>\nVendedor: <@${trade.sellerId}>\n\nOs dois usuarios precisam clicar em **Sim**.`
      )
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        button(client, `mm:confirmroles:${trade.id}`, "Sim", ButtonStyle.Success, "positivo"),
        button(client, `mm:resetroles:${trade.id}`, "Refazer", ButtonStyle.Secondary, "reload")
      )
    );
}
function finalConfirmPanel(client, guildId, trade) {
  const config = getGuildConfig(guildId);
  return new ContainerBuilder()
    .setAccentColor(config.middleman.color)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Conferencia final\nComprador: <@${trade.buyerId}>\nVendedor: <@${trade.sellerId}>\nValor da trade: **${formatBRL(trade.amount)}**\nTaxa: **${formatBRL(trade.fee)}**\nTotal para o comprador: **${formatBRL(trade.total)}**\nEntrega: **${trade.item}**\n\nOs dois precisam confirmar para continuar.`
      )
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        button(client, `mm:finalconfirm:${trade.id}`, "Confirmar", ButtonStyle.Success, "verifiedp"),
        button(client, `mm:dispute:buyer:${trade.id}`, "Disputa Comprador", ButtonStyle.Danger, "negativo"),
        button(client, `mm:dispute:seller:${trade.id}`, "Disputa Vendedor", ButtonStyle.Danger, "negativo")
      )
    );
}
function paymentPanel(client, guildId, trade) {
  const config = getGuildConfig(guildId);
  const pix = config.payments.pix;
  const manual = trade.mode === "manual";
  const pixKey = manual ? trade.manualPixKey : (trade.efiQrCode ? "Efí Bank gerado" : pix.key);
  const text = manual
    ? `## Pagamento manual\nComprador: <@${trade.buyerId}>\nValor total: **${formatBRL(trade.total)}**\nChave Pix: **${pixKey || "aguardando middleman"}**\n\nUse o QR Code ou copia-e-cola e depois avise o pagamento.`
    : `## Pagamento automatico Efí Bank\nComprador: <@${trade.buyerId}>\nValor total: **${formatBRL(trade.total)}**\nCobrança: **${trade.efiTxid || "nao gerada"}**\nStatus: **${trade.efiStatus || "aguardando pagamento"}**\n\nUse o QR Code ou copia-e-cola e depois verifique o pagamento.`;
  return new ContainerBuilder()
    .setAccentColor(config.middleman.color)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(text))
    .addSeparatorComponents(new SeparatorBuilder())
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        button(client, `mm:copy:${trade.id}`, "Copiar copia e cola", ButtonStyle.Secondary, "recibo"),
        button(client, `mm:qrcode:${trade.id}`, "Qr code", ButtonStyle.Secondary, "pix"),
        manual
          ? button(client, `mm:paidnotice:${trade.id}`, "Avisar pagamento", ButtonStyle.Primary, "positivo")
          : button(client, `mm:verifypayment:${trade.id}`, "Verificar pagamento", ButtonStyle.Primary, "reload")
      )
    );
}
function manualClaimPanel(client, guildId, trade) {
  const config = getGuildConfig(guildId);
  const roleMention = config.roles.middleman ? `<@&${config.roles.middleman}>` : "@Middleman";
  return {
    components: [
      new ContainerBuilder()
        .setAccentColor(config.middleman.color)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `## Atendimento manual\n${roleMention}, um middleman precisa assumir o ticket e configurar a chave Pix para recebimento.\n\nResponsavel: ${trade.assigneeId ? `<@${trade.assigneeId}>` : "**ninguem assumiu ainda**"}`
          )
        )
        .addActionRowComponents(
          new ActionRowBuilder().addComponents(
            button(client, `mm:claim:${trade.id}`, "Assumir Ticket", ButtonStyle.Success, "userp"),
            button(client, `mm:manualpix:${trade.id}`, "Configurar chave Pix", ButtonStyle.Primary, "pix")
          )
        )
    ],
    flags: V2
  };
}
function deliveryPanel(client, guildId, trade) {
  const config = getGuildConfig(guildId);
  return new ContainerBuilder()
    .setAccentColor(config.middleman.color)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Pagamento confirmado\nVendedor <@${trade.sellerId}>, envie o produto ou informacoes da conta no privado do comprador <@${trade.buyerId}>.\n\nQuando o comprador receber tudo corretamente, ele deve aprovar a entrega.`
      )
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        button(client, `mm:approve:${trade.id}`, "Aprovar entrega", ButtonStyle.Success, "verifiedp"),
        button(client, `mm:dispute:buyer:${trade.id}`, "Disputa Comprador", ButtonStyle.Danger, "negativo"),
        button(client, `mm:dispute:seller:${trade.id}`, "Disputa Vendedor", ButtonStyle.Danger, "negativo")
      )
    );
}
function sellerPayoutPanel(client, guildId, trade) {
  const config = getGuildConfig(guildId);
  const manual = trade.mode === "manual";
  const payerLine = manual
    ? `Middleman responsavel: ${trade.assigneeId ? `<@${trade.assigneeId}>` : "**nao definido**"}\n\n${trade.assigneeId ? `<@${trade.assigneeId}>` : "O middleman assumido"} deve pagar o vendedor e aguardar a aprovacao.`
    : `O pagamento do comprador foi confirmado pela Efí Bank. Assim que o vendedor configurar o Pix, o bot tentara enviar automaticamente **${formatBRL(trade.amount)}** pela conta Efí configurada.`;
  return new ContainerBuilder()
    .setAccentColor(config.middleman.color)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Pagamento ao vendedor\nValor a receber: **${formatBRL(trade.amount)}**\nChave: **${trade.sellerPix || "nao informada"}**\nTipo: **${trade.sellerPixType || "nao informado"}**\n\n${payerLine}`
      )
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        button(client, `mm:sellerpix:${trade.id}`, "Configurar Pix", ButtonStyle.Primary, "pix"),
        button(client, `mm:copy:${trade.id}`, "Copia e cola", ButtonStyle.Secondary, "recibo"),
        button(client, `mm:qrcode:${trade.id}`, "Qr code", ButtonStyle.Secondary, "pix"),
        manual
          ? button(client, `mm:sellerpaid:${trade.id}`, "Recebi pagamento", ButtonStyle.Success, "positivo")
          : button(client, `mm:payvendor:${trade.id}`, "Enviar repasse", ButtonStyle.Success, "positivo")
      )
    );
}
function donePanel(client, guildId, trade) {
  const config = getGuildConfig(guildId);
  return new ContainerBuilder()
    .setAccentColor(0x2ecc71)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Middleman concluido\nTrade finalizada com sucesso.\n\nComprador: <@${trade.buyerId}>\nVendedor: <@${trade.sellerId}>\nValor: **${formatBRL(trade.amount)}**\nTaxa: **${formatBRL(trade.fee)}**`
      )
    );
}
function button(client, id, label, style, emojiName) {
  const builder = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  const emoji = componentEmoji(client, emojiName);
  return emoji ? builder.setEmoji(emoji) : builder;
}
async function replaceTradePanel(channel, trade, payload) {
  if (trade.panelMessageId) {
    const previous = await channel.messages.fetch(trade.panelMessageId).catch(() => null);
    await previous?.delete().catch(() => null);
  }
  const message = await channel.send(payload);
  setTrade(trade.id, (current) => ({ ...current, panelMessageId: message.id }));
  return message;
}
function panelMessage(component) {
  return { components: [component], flags: V2 };
}
function getPaymentPixData(guildId, trade) {
  if (trade.status === "seller_payout") {
    return {
      key: trade.sellerPix,
      amount: trade.amount,
      label: "Pix do vendedor"
    };
  }
  const config = getGuildConfig(guildId);
  if (trade.efiQrCode && trade.status === "payment") {
    return {
      key: trade.efiQrCode,
      amount: trade.total,
      label: "Pix Efí Bank",
      isPayload: true,
      qrCodeBase64: trade.efiQrCodeBase64
    };
  }
  return {
    key: trade.mode === "manual" ? trade.manualPixKey : config.payments.pix.key,
    amount: trade.total,
    label: "Pagamento do middleman"
  };
}
async function buildQrAttachment(guildId, trade) {
  const pix = getPaymentPixData(guildId, trade);
  if (!pix.key) return null;
  const payload = pix.isPayload
    ? pix.key
    : buildPixPayload({
      key: pix.key,
      amount: pix.amount,
      name: "MIDDLEMAN",
      city: "BRASIL",
      txid: `MM${String(trade.id).slice(-20)}`
    });
  const png = pix.qrCodeBase64
    ? Buffer.from(pix.qrCodeBase64, "base64")
    : await QRCode.toBuffer(payload, {
      type: "png",
      width: 512,
      margin: 2,
      errorCorrectionLevel: "M"
    });
  return {
    content: `${pix.label}\nValor: **${formatBRL(pix.amount)}**\nCopia e cola:\n\`${payload}\``,
    files: [{ attachment: png, name: `pix-${trade.id}.png` }]
  };
}
async function createEfiForTrade(guildId, trade) {
  const config = getGuildConfig(guildId);
  const efi = config.payments.efi;
  if (!efi.enabled || !efi.clientId || !efi.clientSecret || !efi.certificatePath) {
    throw new Error("Efí Bank nao esta habilitada/configurada em Formas de Pagamento.");
  }
  const payment = await createEfiPixCharge({
    efi,
    amount: trade.total,
    description: `Middleman #${trade.id}`,
    tradeId: trade.id
  });
  if (payment.pixKey && !efi.pixKey) {
    setGuildConfig(guildId, (current) => {
      current.payments.efi.pixKey = payment.pixKey;
      return current;
    });
  }
  return setTrade(trade.id, (current) => ({
    ...current,
    status: "payment",
    efiTxid: payment.txid,
    efiStatus: payment.status,
    efiQrCode: payment.qrCode,
    efiQrCodeBase64: payment.qrCodeBase64,
    efiLocationId: payment.locationId
  }));
}
async function refreshEfiPayment(guildId, trade) {
  const config = getGuildConfig(guildId);
  const efi = config.payments.efi;
  if (!efi.enabled || !efi.clientId || !efi.clientSecret || !efi.certificatePath) {
    throw new Error("Efí Bank nao esta habilitada/configurada.");
  }
  if (!trade.efiTxid) {
    throw new Error("Este ticket ainda nao possui cobrança Efí.");
  }
  const payment = await getEfiPixCharge({
    efi,
    txid: trade.efiTxid,
    locationId: trade.efiLocationId
  });
  return setTrade(trade.id, (current) => ({
    ...current,
    efiStatus: payment.status,
    efiQrCode: payment.qrCode || current.efiQrCode,
    efiQrCodeBase64: payment.qrCodeBase64 || current.efiQrCodeBase64,
    efiLocationId: payment.locationId || current.efiLocationId
  }));
}
async function sendEfiPayoutForTrade(guildId, trade) {
  const config = getGuildConfig(guildId);
  const payout = await sendEfiPix({
    efi: config.payments.efi,
    amount: trade.amount,
    sellerPixKey: trade.sellerPix,
    description: `Repasse Middleman #${trade.id}`,
    tradeId: trade.id
  });
  if (payout.pixKey && !config.payments.efi.pixKey) {
    setGuildConfig(guildId, (current) => {
      current.payments.efi.pixKey = payout.pixKey;
      return current;
    });
  }
  return setTrade(trade.id, (current) => ({
    ...current,
    efiPayoutId: payout.idEnvio,
    efiPayoutStatus: payout.status,
    efiPayoutE2eId: payout.e2eId
  }));
}
function buildPixPayload({ key, amount, name, city, txid }) {
  const merchantAccount = emv("00", "br.gov.bcb.pix") + emv("01", key);
  const base = [
    emv("00", "01"),
    emv("26", merchantAccount),
    emv("52", "0000"),
    emv("53", "986"),
    amount ? emv("54", Number(amount).toFixed(2)) : "",
    emv("58", "BR"),
    emv("59", sanitizePixText(name, 25)),
    emv("60", sanitizePixText(city, 15)),
    emv("62", emv("05", sanitizePixText(txid, 25)))
  ].join("");
  const withoutCrc = `${base}6304`;
  return `${withoutCrc}${crc16(withoutCrc)}`;
}
function emv(id, value) {
  const stringValue = String(value);
  return `${id}${String(stringValue.length).padStart(2, "0")}${stringValue}`;
}
function sanitizePixText(value, max) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 ]/g, "")
    .toUpperCase()
    .slice(0, max) || "PIX";
}
function crc16(payload) {
  let crc = 0xffff;
  for (const char of payload) {
    crc ^= char.charCodeAt(0) << 8;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}
function feeText(middlemanConfig = {}) {
  if (middlemanConfig.fees === "none") return "Sem taxa configurada.";
  const rules = middlemanConfig.feeRules || [];
  const lines = rules
    .slice()
    .sort((a, b) => Number(a.above) - Number(b.above))
    .map((rule) => {
      const fee = rule.type === "percent" ? formatPercent(rule.value) : formatBRL(rule.value);
      return `${fee} acima de ${formatBRL(rule.above)}.`;
    });
  lines.push("");
  lines.push(`Em conta adicionamos ${formatBRL(middlemanConfig.accountExtraFee ?? 4)}.`);
  return lines.join("\n");
}
function calculateFee(amount, item, middlemanConfig) {
  if (middlemanConfig.fees === "none") return 0;
  let fee = 0;
  const rule = (middlemanConfig.feeRules || [])
    .filter((itemRule) => amount > Number(itemRule.above))
    .sort((a, b) => Number(a.above) - Number(b.above))
    .at(-1);
  if (rule) {
    fee = rule.type === "percent" ? amount * (Number(rule.value) / 100) : Number(rule.value);
  }
  if (/\bconta\b/i.test(item)) fee += Number(middlemanConfig.accountExtraFee ?? 4);
  return roundMoney(fee);
}
function parseBRL(text) {
  const normalized = text.replace(/[^\d,.]/g, "").replace(/\./g, "").replace(",", ".");
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? roundMoney(value) : null;
}
function roundMoney(value) {
  return Math.round(value * 100) / 100;
}
function formatBRL(value) {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function formatPercent(value) {
  return `${Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}
function mmModal(id, title, fields) {
  return new ModalBuilder()
    .setCustomId(id)
    .setTitle(title)
    .addComponents(
      ...fields.map((field) =>
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(field.id)
            .setLabel(field.label)
            .setStyle(field.style || TextInputStyle.Short)
            .setRequired(field.required ?? true)
            .setPlaceholder(field.placeholder || "")
            .setMaxLength(field.maxLength || 4000)
        )
      )
    );
}
async function handleMiddlemanInteraction(interaction) {
  const id = interaction.customId;
  if (interaction.isStringSelectMenu() && id === "mm:public:select") {
    await interaction.reply({ content: "🔒 O sistema de Middleman é um benefício **VIP** do bot.", flags: MessageFlags.Ephemeral });
    return true;
  }
  if (!id.startsWith("mm:")) return false;
  const parts = id.split(":");
  const action = parts[1];
  const sub = parts[2];
  const tradeId = parts.at(-1);
  const trade = getTrade(tradeId);
  if (!trade && action !== "public") {
    await interaction.reply({ content: "Este ticket nao foi encontrado.", flags: MessageFlags.Ephemeral });
    return true;
  }
  if (action === "partner" && sub === "select") {
    await addPartner(interaction, trade, interaction.values[0]);
    return true;
  }
  if (action === "addid") {
    await interaction.showModal(mmModal(`mmmodal:addid:${trade.id}`, "Adicionar por ID", [
      { id: "userId", label: "ID do usuario", placeholder: "123456789012345678" }
    ]));
    return true;
  }
  if (action === "terms") {
    await interaction.reply({ components: [termsPanel(interaction.client, interaction.guildId)], flags: V2_EPHEMERAL });
    return true;
  }
  if (action === "cancel") {
    await interaction.deferUpdate().catch(() => null);
    await interaction.message?.delete().catch(() => null);
    await interaction.channel.send({ content: "Ticket cancelado. Esta thread sera arquivada." });
    await interaction.channel.setArchived(true).catch(() => null);
    return true;
  }
  if (action === "role") {
    await chooseRole(interaction, trade, sub);
    return true;
  }
  if (action === "resetroles") {
    const next = setTrade(trade.id, (t) => ({ ...t, buyerId: null, sellerId: null, confirms: [], status: "choosing_roles" }));
    await interaction.update({ components: [roleChoicePanel(interaction.client, interaction.guildId, next)], flags: V2 });
    return true;
  }
  if (action === "confirmroles") {
    await confirmRoles(interaction, trade);
    return true;
  }
  if (action === "finalconfirm") {
    await finalConfirm(interaction, trade);
    return true;
  }
  if (action === "claim") {
    await claimTicket(interaction, trade);
    return true;
  }
  if (action === "manualpix") {
    if (!(await isAssignee(interaction, trade))) return true;
    await interaction.showModal(mmModal(`mmmodal:manualpix:${trade.id}`, "Chave Pix do Middleman", [
      { id: "key", label: "Chave Pix para receber", placeholder: "chave pix" }
    ]));
    return true;
  }
  if (action === "copy") {
    const pix = getPaymentPixData(interaction.guildId, trade);
    if (!pix.key) {
      await interaction.reply({ content: "Nenhuma chave Pix configurada ainda.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const copyPaste = pix.isPayload
      ? pix.key
      : buildPixPayload({
        key: pix.key,
        amount: pix.amount,
        name: "MIDDLEMAN",
        city: "BRASIL",
        txid: `MM${String(trade.id).slice(-20)}`
      });
    await interaction.reply({ content: `Copia e cola:\n\`${copyPaste}\``, flags: MessageFlags.Ephemeral });
    return true;
  }
  if (action === "qrcode") {
    const attachment = await buildQrAttachment(interaction.guildId, trade);
    if (!attachment) {
      await interaction.reply({ content: "Nenhuma chave Pix configurada para gerar o QR Code.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.reply({ ...attachment, flags: MessageFlags.Ephemeral });
    return true;
  }
  if (action === "paidnotice") {
    if (interaction.user.id !== trade.buyerId) {
      await interaction.reply({ content: "Somente o comprador pode avisar o pagamento.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.update(panelMessage(
      new ContainerBuilder()
        .setAccentColor(getGuildConfig(interaction.guildId).middleman.color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## Comprador avisou pagamento\n${trade.assigneeId ? `<@${trade.assigneeId}>` : "O middleman responsavel"} deve confirmar se o valor caiu.`))
        .addActionRowComponents(new ActionRowBuilder().addComponents(button(interaction.client, `mm:confirmpaid:${trade.id}`, "Confirmar pagamento", ButtonStyle.Success, "positivo")))
    ));
    return true;
  }
  if (action === "confirmpaid") {
    if (!(await isAssignee(interaction, trade))) return true;
    const next = setTrade(trade.id, (t) => ({ ...t, status: "delivery" }));
    await interaction.update(panelMessage(deliveryPanel(interaction.client, interaction.guildId, next)));
    return true;
  }
  if (action === "verifypayment") {
    try {
      const checked = await refreshEfiPayment(interaction.guildId, trade);
      if (checked.efiStatus === "approved") {
        const next = setTrade(trade.id, (t) => ({ ...t, status: "delivery" }));
        await interaction.update(panelMessage(deliveryPanel(interaction.client, interaction.guildId, next)));
        return true;
      }
      await interaction.reply({ content: `Pagamento ainda nao aprovado. Status atual: ${checked.efiStatus || "desconhecido"}.`, flags: MessageFlags.Ephemeral });
    } catch (error) {
      await interaction.reply({ content: `Nao consegui verificar na Efí Bank: ${error.message}`, flags: MessageFlags.Ephemeral });
    }
    return true;
  }
  if (action === "approve") {
    if (trade.status !== "delivery") {
      await interaction.reply({ content: "A entrega ainda nao esta na etapa de aprovacao.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (interaction.user.id !== trade.buyerId) {
      await interaction.reply({ content: "Somente o comprador pode aprovar a entrega.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const next = setTrade(trade.id, (t) => ({ ...t, status: "seller_payout" }));
    await interaction.update(panelMessage(sellerPayoutPanel(interaction.client, interaction.guildId, next)));
    return true;
  }
  if (action === "sellerpix") {
    if (trade.status !== "seller_payout") {
      await interaction.reply({ content: "Ainda nao chegou a etapa de pagamento ao vendedor.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (interaction.user.id !== trade.sellerId) {
      await interaction.reply({ content: "Somente o vendedor pode configurar o Pix de recebimento.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.showModal(mmModal(`mmmodal:sellerpix:${trade.id}`, "Pix do vendedor", [
      { id: "key", label: "Chave Pix", placeholder: "chave pix" },
      { id: "type", label: "Tipo da chave", placeholder: "Email, CPF, telefone, aleatoria..." }
    ]));
    return true;
  }
  if (action === "payvendor") {
    if (trade.status !== "seller_payout") {
      await interaction.reply({ content: "Ainda nao chegou a etapa de pagar o vendedor.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (!(await canOperatePayout(interaction))) return true;
    if (!trade.sellerPix) {
      await interaction.reply({ content: "O vendedor ainda precisa configurar a chave Pix.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const paid = await sendEfiPayoutForTrade(interaction.guildId, trade);
      await interaction.editReply(`Repasse enviado pela Efí. Status: ${paid.efiPayoutStatus || "enviado"}.`);
      await finishTradeFromBackground(interaction, paid);
    } catch (error) {
      await interaction.editReply(`Nao consegui enviar o repasse pela Efí: ${error.message}`);
    }
    return true;
  }
  if (action === "sellerpaid" || action === "finish") {
    if (trade.status !== "seller_payout") {
      await interaction.reply({ content: "Ainda nao chegou a etapa de finalizar pagamento.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (action === "sellerpaid" && interaction.user.id !== trade.sellerId) {
      await interaction.reply({ content: "Somente o vendedor pode aprovar o recebimento.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (action === "finish" && !(await canOperatePayout(interaction))) return true;
    await finishTrade(interaction, trade);
    return true;
  }
  if (action === "dispute") {
    await openDispute(interaction, trade, sub);
    return true;
  }
  return false;
}
async function handleMiddlemanModal(interaction) {
  if (!interaction.customId.startsWith("mmmodal:")) return false;
  const [, action, tradeId] = interaction.customId.split(":");
  const trade = getTrade(tradeId);
  if (!trade) {
    await interaction.reply({ content: "Ticket nao encontrado.", flags: MessageFlags.Ephemeral });
    return true;
  }
  if (action === "addid") {
    await addPartner(interaction, trade, interaction.fields.getTextInputValue("userId").trim());
    return true;
  }
  if (action === "manualpix") {
    if (!(await isAssignee(interaction, trade))) return true;
    const key = interaction.fields.getTextInputValue("key").trim();
    const next = setTrade(trade.id, (t) => ({ ...t, manualPixKey: key, status: "payment" }));
    await interaction.reply({ title: "Chave configurada", content: "Chave Pix configurada.", flags: MessageFlags.Ephemeral });
    await replaceTradePanel(interaction.channel, next, panelMessage(paymentPanel(interaction.client, interaction.guildId, next)));
    return true;
  }
  if (action === "sellerpix") {
    const key = interaction.fields.getTextInputValue("key").trim();
    const type = interaction.fields.getTextInputValue("type").trim();
    const next = setTrade(trade.id, (t) => ({ ...t, sellerPix: key, sellerPixType: type }));
    if (next.mode === "automatic") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const paid = await sendEfiPayoutForTrade(interaction.guildId, next);
        await interaction.editReply(`Pix do vendedor configurado e repasse enviado pela Efí. Status: ${paid.efiPayoutStatus || "enviado"}.`);
        await finishTradeFromBackground(interaction, paid);
      } catch (error) {
        await interaction.editReply(`Pix do vendedor configurado, mas a Efí nao enviou o repasse: ${error.message}`);
        await replaceTradePanel(interaction.channel, next, panelMessage(sellerPayoutPanel(interaction.client, interaction.guildId, next)));
      }
      return true;
    }
    await interaction.reply({ title: "Pix configurado", content: "Pix do vendedor configurado.", flags: MessageFlags.Ephemeral });
    await replaceTradePanel(interaction.channel, next, panelMessage(sellerPayoutPanel(interaction.client, interaction.guildId, next)));
    return true;
  }
  return false;
}
async function handleMiddlemanMessage(message) {
  if (!message.guild || message.author.bot || !message.channel.isThread()) return false;
  const trade = getTradeByThreadId(message.guild.id, message.channel.id);
  if (!trade) return false;
  if (trade.status === "awaiting_value" && message.author.id === trade.buyerId) {
    const amount = parseBRL(message.content);
    if (!amount) {
      await message.reply("Envie um valor valido, exemplo: `150,00`.");
      return true;
    }
    const next = setTrade(trade.id, (t) => ({ ...t, amount, status: "awaiting_item" }));
    await replaceTradePanel(message.channel, next, panelMessage(
      new ContainerBuilder()
        .setAccentColor(getGuildConfig(message.guild.id).middleman.color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## Valor registrado\nValor da trade: **${formatBRL(amount)}**\n\nVendedor <@${trade.sellerId}>, diga no chat o que sera entregue.`))
    ));
    return true;
  }
  if (trade.status === "awaiting_item" && message.author.id === trade.sellerId) {
    const config = getGuildConfig(message.guild.id);
    const fee = calculateFee(trade.amount, message.content, config.middleman);
    const next = setTrade(trade.id, (t) => ({
      ...t,
      item: message.content.slice(0, 500),
      fee,
      total: roundMoney(t.amount + fee),
      status: "final_confirm"
    }));
    await replaceTradePanel(message.channel, next, panelMessage(finalConfirmPanel(message.client, message.guild.id, next)));
    return true;
  }
  return false;
}
async function createTicket(interaction) {
  const config = getGuildConfig(interaction.guildId);
  if (!config.middleman.enabled) {
    await interaction.reply({ content: "O sistema de Middleman esta desabilitado.", flags: MessageFlags.Ephemeral });
    return;
  }
  const hasOpenMiddleman = Object.values(readTrades(interaction.guildId)).some(t => t.status !== "done" && (t.creatorId === interaction.user.id || t.buyerId === interaction.user.id || t.sellerId === interaction.user.id || (Array.isArray(t.participantIds) && t.participantIds.includes(interaction.user.id))));
  if (hasOpenMiddleman) {
    await interaction.reply({ content: "Você já tem um middleman aberto. Finalize ou cancele antes de abrir outro. (limite: 1 por pessoa)", flags: MessageFlags.Ephemeral });
    return;
  }
  const thread = await interaction.channel.threads.create({
    name: channelThreadName("Middleman", interaction.user),
    type: interaction.channel.type === ChannelType.GuildText ? ChannelType.PrivateThread : ChannelType.PublicThread,
    autoArchiveDuration: 10080,
    reason: "Ticket de Middleman"
  });
  await thread.members.add(interaction.user.id).catch(() => null);
  const trade = createTrade({
    guildId: interaction.guildId,
    threadId: thread.id,
    creatorId: interaction.user.id,
    mode: config.middleman.mode
  });
  await replaceTradePanel(thread, trade, panelMessage(ticketIntroPanel(interaction.client, interaction.guildId, trade)));
  await interaction.reply({ content: `Ticket criado: ${thread}`, flags: MessageFlags.Ephemeral });
}
async function addPartner(interaction, trade, userId) {
  if (interaction.user.id !== trade.creatorId && !trade.participantIds.includes(interaction.user.id)) {
    await interaction.reply({ content: "Somente participantes do ticket podem adicionar usuario.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (userId === trade.creatorId) {
    await interaction.reply({ content: "Escolha outro usuario alem de voce.", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.channel.members.add(userId).catch(() => null);
  const next = setTrade(trade.id, (t) => ({ ...t, participantIds: [...new Set([t.creatorId, userId])], status: "choosing_roles" }));
  if (!interaction.isModalSubmit()) await interaction.deferUpdate();
  await replaceTradePanel(interaction.channel, next, {
    components: [
      new ContainerBuilder()
        .setAccentColor(getGuildConfig(interaction.guildId).middleman.color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## Usuario adicionado\n<@${userId}> foi adicionado ao ticket.`)),
      roleChoicePanel(interaction.client, interaction.guildId, next)
    ],
    flags: V2
  });
  if (interaction.isModalSubmit()) await interaction.reply({ content: "Usuario adicionado.", flags: MessageFlags.Ephemeral });
}
async function chooseRole(interaction, trade, choice) {
  if (trade.status !== "choosing_roles") {
    await interaction.reply({ content: "A escolha de papeis nao esta mais aberta.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (!trade.participantIds.includes(interaction.user.id)) {
    await interaction.reply({ content: "Somente os participantes podem escolher papel.", flags: MessageFlags.Ephemeral });
    return;
  }
  const next = setTrade(trade.id, (t) => ({
    ...t,
    buyerId: choice === "pay" ? interaction.user.id : (t.buyerId === interaction.user.id ? null : t.buyerId),
    sellerId: choice === "sell" ? interaction.user.id : (t.sellerId === interaction.user.id ? null : t.sellerId),
    confirms: []
  }));
  const component = next.buyerId && next.sellerId && next.buyerId !== next.sellerId
    ? confirmRolesPanel(interaction.client, interaction.guildId, next)
    : roleChoicePanel(interaction.client, interaction.guildId, next);
  await interaction.update({ components: [component], flags: V2 });
}
async function confirmRoles(interaction, trade) {
  if (![trade.buyerId, trade.sellerId].includes(interaction.user.id)) {
    await interaction.reply({ content: "Somente comprador e vendedor podem confirmar.", flags: MessageFlags.Ephemeral });
    return;
  }
  const next = setTrade(trade.id, (t) => ({ ...t, confirms: [...new Set([...t.confirms, interaction.user.id])] }));
  if (next.confirms.length >= 2) {
    setTrade(trade.id, (t) => ({ ...t, status: "awaiting_value" }));
    await interaction.update({
      components: [
        new ContainerBuilder()
          .setAccentColor(getGuildConfig(interaction.guildId).middleman.color)
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## Valor da trade\n<@${next.buyerId}>, envie no chat o valor da trade.\n\nExemplo: \`150,00\``))
      ],
      flags: V2
    });
    return;
  }
  await interaction.reply({ content: "Confirmacao registrada. Aguardando o outro usuario.", flags: MessageFlags.Ephemeral });
}
async function finalConfirm(interaction, trade) {
  if (![trade.buyerId, trade.sellerId].includes(interaction.user.id)) {
    await interaction.reply({ content: "Somente comprador e vendedor podem confirmar.", flags: MessageFlags.Ephemeral });
    return;
  }
  const next = setTrade(trade.id, (t) => ({ ...t, finalConfirms: [...new Set([...t.finalConfirms, interaction.user.id])] }));
  if (next.finalConfirms.length < 2) {
    await interaction.reply({ content: "Confirmacao registrada. Aguardando o outro usuario.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (next.mode === "manual") {
    setTrade(next.id, (t) => ({ ...t, status: "manual_claim" }));
    await interaction.update(manualClaimPanel(interaction.client, interaction.guildId, next));
    return;
  }
  try {
    const paidTrade = await createEfiForTrade(interaction.guildId, next);
    await interaction.update(panelMessage(paymentPanel(interaction.client, interaction.guildId, paidTrade)));
  } catch (error) {
    await interaction.reply({ content: `Nao consegui criar o Pix Efí Bank: ${error.message}`, flags: MessageFlags.Ephemeral });
  }
}
async function claimTicket(interaction, trade) {
  const config = getGuildConfig(interaction.guildId);
  const isMm = config.roles.middleman && interaction.member.roles.cache.has(config.roles.middleman);
  if (!isMm && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: "Somente o cargo Middleman pode assumir.", flags: MessageFlags.Ephemeral });
    return;
  }
  const next = setTrade(trade.id, (t) => ({ ...t, assigneeId: interaction.user.id }));
  await interaction.update(manualClaimPanel(interaction.client, interaction.guildId, next));
}
async function isAssignee(interaction, trade) {
  if (trade.assigneeId === interaction.user.id || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  await interaction.reply({ content: "Somente o middleman que assumiu o ticket pode clicar aqui.", flags: MessageFlags.Ephemeral });
  return false;
}
async function canOperatePayout(interaction) {
  const config = getGuildConfig(interaction.guildId);
  const isMm = config.roles.middleman && interaction.member.roles.cache.has(config.roles.middleman);
  if (isMm || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  await interaction.reply({ content: "Somente administrador ou cargo Middleman pode confirmar o repasse.", flags: MessageFlags.Ephemeral });
  return false;
}
async function openDispute(interaction, trade, side) {
  const config = getGuildConfig(interaction.guildId);
  setTrade(trade.id, (t) => ({ ...t, dispute: true, status: "dispute" }));
  await interaction.channel.send(`${config.roles.middleman ? `<@&${config.roles.middleman}>` : "@Middleman"} disputa aberta pelo ${side === "buyer" ? "comprador" : "vendedor"}. Este ticket nao sera fechado automaticamente.`);
  await interaction.reply({ content: "Disputa aberta.", flags: MessageFlags.Ephemeral });
}
async function finishTrade(interaction, trade) {
  const next = setTrade(trade.id, (t) => ({ ...t, status: "done", finishedAt: Date.now() }));
  const guild = interaction.guild;
  const config = getGuildConfig(guild.id);
  const buyer = await guild.members.fetch(next.buyerId).catch(() => null);
  const seller = await guild.members.fetch(next.sellerId).catch(() => null);
  if (config.roles.trader) {
    await buyer?.roles.add(config.roles.trader).catch(() => null);
    await seller?.roles.add(config.roles.trader).catch(() => null);
  }
  await interaction.update({ components: [donePanel(interaction.client, guild.id, next)], flags: V2 });
  await sendVouch(interaction, next);
  await sendTranscript(interaction, next);
  setTimeout(() => interaction.channel.delete("Middleman concluido").catch(() => null), 5 * 60 * 1000);
}
async function finishTradeFromBackground(interaction, trade) {
  const next = setTrade(trade.id, (t) => ({ ...t, status: "done", finishedAt: Date.now() }));
  const guild = interaction.guild;
  const config = getGuildConfig(guild.id);
  const buyer = await guild.members.fetch(next.buyerId).catch(() => null);
  const seller = await guild.members.fetch(next.sellerId).catch(() => null);
  if (config.roles.trader) {
    await buyer?.roles.add(config.roles.trader).catch(() => null);
    await seller?.roles.add(config.roles.trader).catch(() => null);
  }
  await replaceTradePanel(interaction.channel, next, panelMessage(donePanel(interaction.client, guild.id, next)));
  await sendVouch(interaction, next);
  await sendTranscript(interaction, next);
  setTimeout(() => interaction.channel.delete("Middleman concluido").catch(() => null), 5 * 60 * 1000);
}
async function sendVouch(interaction, trade) {
  const config = getGuildConfig(interaction.guildId);
  const channelId = trade.amount > 500 ? (config.middleman.bigVouchChannel || config.middleman.vouchChannel) : config.middleman.vouchChannel;
  if (!channelId) return;
  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const modeLabel = trade.mode === "automatic" ? "Automatico" : "Manual";
  await channel.send({
    components: [
      new ContainerBuilder()
        .setAccentColor(config.middleman.color)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `## Troca de PIX completa. (${modeLabel})\nUma troca de pix ${modeLabel.toLowerCase()} aconteceu, informacoes abaixo:`
          )
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `- Valor: **${formatBRL(trade.amount)}**\n- Participantes: <@${trade.buyerId}> e <@${trade.sellerId}>\n- Horario: <t:${Math.floor((trade.finishedAt || Date.now()) / 1000)}:F>`
          )
        )
    ],
    flags: V2
  });
}
async function sendTranscript(interaction, trade) {
  const config = getGuildConfig(interaction.guildId);
  const channelId = config.channels.middlemanLogs;
  if (!channelId) return;
  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const messages = await interaction.channel.messages.fetch({ limit: 100 }).catch(() => null);
  const lines = messages
    ? [...messages.values()].reverse().map((msg) => `[${new Date(msg.createdTimestamp).toLocaleString("pt-BR")}] ${msg.author.tag}: ${msg.content || "[componentes/anexos]"}`)
    : [];
  await channel.send({
    content: `Transcript Middleman #${trade.id}`,
    files: [{ attachment: Buffer.from(lines.join("\n") || "Sem mensagens.", "utf8"), name: `middleman-${trade.id}.txt` }]
  });
}
function termsPanel(client, guildId) {
  const config = getGuildConfig(guildId);
  return new ContainerBuilder()
    .setAccentColor(config.middleman.color)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## Termos e Regras do MM\n**Seguranca em Primeiro Lugar**\nSiga rigorosamente as instrucoes do bot.\n\n**Vendedor:** grave todo o processo de entrega.\n\n**Comprador:** confirme tudo antes de aprovar a entrega.\n\n**Regras gerais:** nao tente burlar taxas, mantenha a negociacao no ticket e abra disputa em caso de problema."
      )
    );
}
function channelThreadName(prefix, user) {
  const username = String(user?.username || "usuario")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w-]/g, "")
    .slice(0, 28) || "usuario";
  return `${prefix}・${username}・${user.id}`.slice(0, 90);
}
module.exports = {
  publicMiddlemanPanel,
  handleMiddlemanInteraction,
  handleMiddlemanModal,
  handleMiddlemanMessage,
  feeText
};
