const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  EmbedBuilder,
  Events,
  FileUploadBuilder,
  MediaGalleryBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  SectionBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  ThumbnailBuilder
} = require("discord.js");
const { ids } = require("../../config");
const { getGuildConfig, setGuildConfig } = require("../../storage");
const { readGuildFile, writeGuildFile } = require("../../guildDb");
const { componentEmoji, scoped, prettyPayload } = require("../panel");
const { createPixPayment: createMpPixPayment, getPayment: getMpPayment } = require("../payments/mercadopago");
const { isEfiConfigured, createEfiPixCharge, getEfiPixCharge } = require("../payments/efibank");
const { isStripeConfigured, createPixCharge: createStripePixCharge, getPixCharge: getStripePixCharge } = require("../payments/stripe");
const roblox = require("../roblox");
const { checkProhibitedContent, prohibitedContentMessage } = require("../../contentFilter");
const { botOwnerIds } = require("../../botOwners");
const { reportViolation } = require("../../violations");
const saldoStore = require("../saldo/store");
const V2 = MessageFlags.IsComponentsV2;
const V2_EPHEMERAL = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
const SALES_COLOR = 0xffffff;
const OK_COLOR = 0x2ecc71;
const WARN_COLOR = 0xf1c40f;
const DANGER_COLOR = 0xe74c3c;
const AI_PRODUCT_ENABLED = false; 
async function safeUpdate(interaction, payload){
  try{
    if(!interaction.isRepliable()) return null;
    payload = prettyPayload(interaction.client, payload);
    if(interaction.replied || interaction.deferred){
      return await interaction.editReply(payload).catch(()=> interaction.followUp({ ...payload, flags: (payload.flags||0)|MessageFlags.Ephemeral }).catch(()=>null));
    }
    return await interaction.update(payload).catch(async (e)=>{
      if(e?.code===10062 || String(e.message).includes("Unknown interaction")){
        try{ if(!interaction.replied && !interaction.deferred) await interaction.deferUpdate().catch(()=>null); return await interaction.editReply(payload).catch(()=>null); }catch{ return null; }
      }
      throw e;
    });
  }catch{ return null; }
}
async function safeReply(interaction, payload){
  try{
    if(!interaction.isRepliable()) return null;
    payload = prettyPayload(interaction.client, payload);
    const flags = payload.flags ?? MessageFlags.Ephemeral;
    if(interaction.replied || interaction.deferred) return await interaction.followUp({ ...payload, flags }).catch(()=>null);
    return await interaction.reply({ ...payload, flags }).catch(()=> interaction.followUp({ ...payload, flags }).catch(()=>null));
  }catch{ return null; }
}
async function safeShowModal(interaction, modal){
  try{
    if(interaction.replied || interaction.deferred) return null;
    return await interaction.showModal(modal).catch(()=>null);
  }catch{ return null; }
}
const SALES_NAMESPACE = "sales";
const ORDERS_NAMESPACE = "orders";
function defaultSalesStore() {
  return { products: {}, pendingStockUploads: {}, aiProductDrafts: {}, aiUsage: {}, orders: {} };
}
function readSales(guildId) {
  return readGuildFile(guildId, SALES_NAMESPACE, defaultSalesStore);
}
function writeSales(guildId, data) {
  writeGuildFile(guildId, SALES_NAMESPACE, data);
}
function guildStore(data) {
  data.products ||= {};
  data.pendingStockUploads ||= {};
  data.aiProductDrafts ||= {};
  data.aiUsage ||= {};
  data.orders ||= {};
  data.coupons ||= {};
  data.pendingCoupons ||= {};
  return data;
}
function getProduct(guildId, productId) {
  return guildStore(readSales(guildId)).products[productId] || null;
}
function setProduct(guildId, productId, updater) {
  const data = readSales(guildId);
  const store = guildStore(data);
  const current = store.products[productId];
  store.products[productId] = typeof updater === "function" ? updater(current) : updater;
  writeSales(guildId, data);
  return store.products[productId];
}
function createProduct(guildId, input) {
  const data = readSales(guildId);
  const store = guildStore(data);
  const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  store.products[id] = {
    id,
    guildId,
    name: input.name,
    description: input.description || "Produto disponivel para compra.",
    banner: input.banner || null,
    delivery: input.delivery === "manual" ? "manual" : "automatic",
    saleColor: input.saleColor || null,
    buyButtonStyle: input.buyButtonStyle || "secondary",
    panelMode: normalizePanelMode(input.panelMode),
    fields: {},
    publicPanels: [],
    createdAt: Date.now()
  };
  writeSales(guildId, data);
  return store.products[id];
}
function deleteProduct(guildId, productId) {
  const data = readSales(guildId);
  delete guildStore(data).products[productId];
  writeSales(guildId, data);
}
function createField(guildId, productId, input) {
  return setProduct(guildId, productId, (product) => {
    const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    product.fields[id] = {
      id,
      name: input.name,
      description: input.description || "Campo disponivel.",
      price: Number(input.price || 0),
      stock: [],
      phantom: null,
      createdAt: Date.now()
    };
    product.lastFieldId = id;
    return product;
  });
}
function productsList(guildId) {
  return Object.values(guildStore(readSales(guildId)).products);
}
function fieldsList(product) {
  return Object.values(product?.fields || {});
}
function couponsList(guildId) {
  return Object.values(guildStore(readSales(guildId)).coupons);
}
function getCoupon(guildId, couponId) {
  return guildStore(readSales(guildId)).coupons[couponId] || null;
}
function setCoupon(guildId, couponId, updater) {
  const data = readSales(guildId);
  const store = guildStore(data);
  if (!store.coupons[couponId]) return null;
  store.coupons[couponId] = typeof updater === "function" ? updater(store.coupons[couponId]) : updater;
  writeSales(guildId, data);
  return store.coupons[couponId];
}
function createCoupon(guildId, { code, percent }) {
  const data = readSales(guildId);
  const store = guildStore(data);
  const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  store.coupons[id] = {
    id,
    code: String(code || "").trim().toUpperCase().slice(0, 32),
    percent: Math.max(0, Math.min(100, Number(percent) || 0)),
    scope: "all",
    productId: null,
    fieldId: null,
    maxUses: null,
    usedCount: 0,
    usedBy: [],
    expiresAt: null,
    createdAt: Date.now()
  };
  writeSales(guildId, data);
  return store.coupons[id];
}
function deleteCoupon(guildId, couponId) {
  const data = readSales(guildId);
  delete guildStore(data).coupons[couponId];
  writeSales(guildId, data);
}
function findCouponByCode(guildId, code) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) return null;
  return couponsList(guildId).find((coupon) => coupon.code === normalized) || null;
}
function isCouponExpired(coupon) {
  if (!coupon) return true;
  if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) return true;
  if (coupon.expiresAt && Date.now() > coupon.expiresAt) return true;
  return false;
}
function couponStatusLabel(coupon) {
  return isCouponExpired(coupon) ? "Expirado" : "Ativo";
}
function couponScopeLabel(guildId, coupon) {
  if (coupon.scope === "product") {
    const product = getProduct(guildId, coupon.productId);
    return `Produto: **${product?.name || "produto removido"}**`;
  }
  if (coupon.scope === "field") {
    const product = getProduct(guildId, coupon.productId);
    const field = product?.fields?.[coupon.fieldId];
    return `Campo: **${field?.name || "campo removido"}** (${product?.name || "produto removido"})`;
  }
  return "Todos os produtos";
}
function couponUsesLabel(coupon) {
  return coupon.maxUses ? `${coupon.usedCount}/${coupon.maxUses}` : `${coupon.usedCount} (ilimitado)`;
}
function couponValidityLabel(coupon) {
  if (!coupon.expiresAt) return "Sem validade definida";
  return `<t:${Math.floor(coupon.expiresAt / 1000)}:f>`;
}
function couponAppliesToOrder(coupon, order) {
  if (coupon.scope === "product") return coupon.productId === order.productId;
  if (coupon.scope === "field") return coupon.productId === order.productId && coupon.fieldId === order.fieldId;
  return true;
}
function validateCouponForOrder(guildId, code, order) {
  const coupon = findCouponByCode(guildId, code);
  if (!coupon) return { ok: false, reason: "Cupom nao encontrado." };
  if (isCouponExpired(coupon)) return { ok: false, reason: "Este cupom esta expirado." };
  if (!couponAppliesToOrder(coupon, order)) return { ok: false, reason: "Este cupom nao e valido para este produto." };
  if ((coupon.usedBy || []).includes(order.userId)) return { ok: false, reason: "Voce ja utilizou este cupom antes." };
  return { ok: true, coupon };
}
function applyCouponUsage(guildId, couponId, userId) {
  return setCoupon(guildId, couponId, (coupon) => ({
    ...coupon,
    usedCount: (coupon.usedCount || 0) + 1,
    usedBy: [...(coupon.usedBy || []), userId]
  }));
}
function revertCouponUsage(guildId, couponId, userId) {
  const coupon = getCoupon(guildId, couponId);
  if (!coupon) return null;
  return setCoupon(guildId, couponId, (c) => ({
    ...c,
    usedCount: Math.max(0, (c.usedCount || 1) - 1),
    usedBy: (c.usedBy || []).filter((id) => id !== userId)
  }));
}
function setPendingCoupon(guildId, userId, value) {
  const data = readSales(guildId);
  const store = guildStore(data);
  store.pendingCoupons[userId] = value;
  writeSales(guildId, data);
}
function getPendingCoupon(guildId, userId) {
  return guildStore(readSales(guildId)).pendingCoupons[userId] || null;
}
function clearPendingCoupon(guildId, userId) {
  const data = readSales(guildId);
  delete guildStore(data).pendingCoupons[userId];
  writeSales(guildId, data);
}
function container(title, description, accentColor = SALES_COLOR) {
  return new ContainerBuilder()
    .setAccentColor(accentColor)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}\n${description}`))
    .addSeparatorComponents(new SeparatorBuilder());
}
function button(client, id, label, style, emojiName) {
  const builder = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  const emoji = componentEmoji(client, emojiName);
  return emoji ? builder.setEmoji(emoji) : builder;
}
function linkButton(client, url, label, emojiName) {
  const builder = new ButtonBuilder().setURL(url).setLabel(label).setStyle(ButtonStyle.Link);
  const emoji = componentEmoji(client, emojiName);
  return emoji ? builder.setEmoji(emoji) : builder;
}
function backButton(client, targetId, userId) {
  return button(client, scoped(targetId, userId), "Voltar", ButtonStyle.Secondary, "reload");
}
function panelPayload(component) {
  return { components: [component], flags: V2 };
}
function ephemeralPanel(component) {
  return { components: [component], flags: V2_EPHEMERAL };
}
function salesRootPanel(client, userId) {
  const panel = new ContainerBuilder().setAccentColor(SALES_COLOR);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${emojiText(client, "bag")} Sales — Central de Vendas`));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `Gerencie **produtos, estoque, cupons e pedidos** em um só lugar.\n` +
    `-# ${emojiText(client, "lightbulb")} **Iniciante?** Vá em **Gerenciar Vendas → Criar Produto** para começar.`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(scoped(ids.salesRootSelect, userId))
        .setPlaceholder("Selecione onde quer ir")
        .addOptions(
          {
            label: "Gerenciar Vendas",
            value: "manage",
            description: "Produtos, campos, estoque e paineis de venda",
            emoji: componentEmoji(client, "bag")
          },
          {
            label: "Sistema de Cupons",
            value: "coupons",
            description: "Crie cupons de desconto para seus clientes",
            emoji: componentEmoji(client, "cupom")
          },
          {
            label: "Sistema de Saldo",
            value: "saldo",
            description: "Carteira, bônus e saldo como pagamento",
            emoji: componentEmoji(client, "carteira")
          }
        )
    )
  );
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${emojiText(client, "preview")} Escolha acima para continuar.\n-# creator: x64thebuilder/.200021`));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, ids.panelBackMain, userId)));
  return panel;
}
function salesConfigPanel(client, guildId, userId) {
  const config = getGuildConfig(guildId).sales;
  const { SALES_LOG_KEYS } = require("../../config");
  const salesVals = SALES_LOG_KEYS.map((k) => config.channels[k]);
  const salesUnified = salesVals.every((v) => v && v === salesVals[0]) ? salesVals[0] : null;
  const salesMixed = !salesUnified && salesVals.some(Boolean);
  const channelLines = [
    ["Todas as logs", salesUnified ? `<#${salesUnified}>` : salesMixed ? "`múltiplos canais`" : null],
    ["Categoria carrinhos", config.channels.cartsCategory]
  ].map(([label, id]) => `${emojiText(client, "canal")} **${label}:** ${id ? (id.startsWith("<#") ? id : `<#${id}>`) : "`nao definido`"}`).join("\n");
  const roleLines = [
    ["Staff", config.roles.staff],
    ["Cliente", config.roles.customer]
  ].map(([label, id]) => `${emojiText(client, "cargo")} **${label}:** ${id ? `<@&${id}>` : "`nao definido`"}`).join("\n");
  const panel = container(
    "Logs e Cargos de Vendas",
    `${emojiText(client, "pedidoRealizado")} Configure somente o sistema de vendas.\n\n**Canais**\n${channelLines}\n\n**Cargos**\n${roleLines}\n\n${emojiText(client, config.cartLogsEnabled ? "ligado" : "desligado")} Logs de carrinho: **${config.cartLogsEnabled ? "ligado" : "desligado"}**`,
    SALES_COLOR
  );
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(scoped(ids.salesConfigSelect, userId))
        .setPlaceholder("O que deseja configurar?")
        .addOptions(
          { label: "Todas as logs", value: "all", description: "As 9 logs de vendas no mesmo canal.", emoji: componentEmoji(client, "bag") },
          { label: "Categoria carrinhos", value: "cartsCategory", description: "Categoria reservada para carrinhos por canal.", emoji: componentEmoji(client, "diretorio") },
          { label: "Cargo staff", value: "role:staff", description: "Cargo marcado nos pedidos/carrinhos.", emoji: componentEmoji(client, "users") },
          { label: "Cargo cliente", value: "role:customer", description: "Cargo entregue apos compra aprovada.", emoji: componentEmoji(client, "userp") }
        )
    )
  );
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      button(client, scoped(ids.salesCartLogsToggle, userId), config.cartLogsEnabled ? "Desligar logs carrinho" : "Ligar logs carrinho", config.cartLogsEnabled ? ButtonStyle.Danger : ButtonStyle.Success, config.cartLogsEnabled ? "desligado" : "ligado"),
      backButton(client, ids.panelSales, userId)
    )
  );
  return panel;
}
function salesChannelPickerPanel(client, userId, target) {
  const label = salesChannelLabel(target);
  const isCategory = target === "cartsCategory";
  const panel = container(
    label,
    `${emojiText(client, isCategory ? "diretorio" : "canal")} Selecione ${isCategory ? "a categoria" : "o canal"} para **${label.toLowerCase()}**.`,
    OK_COLOR
  );
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(scoped(`${ids.salesChannelSelect}:${target}`, userId))
        .setPlaceholder(isCategory ? "Selecione uma categoria" : "Selecione um canal")
        .setChannelTypes(isCategory ? ChannelType.GuildCategory : ChannelType.GuildText, ...(isCategory ? [] : [ChannelType.GuildAnnouncement]))
        .setMinValues(1)
        .setMaxValues(1)
    )
  );
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, ids.salesConfig, userId)));
  return panel;
}
function salesRolePickerPanel(client, userId, target) {
  const label = target === "staff" ? "Cargo staff" : "Cargo cliente";
  const panel = container(label, `${emojiText(client, "cargo")} Selecione o cargo de vendas para **${label.toLowerCase()}**.`, OK_COLOR);
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(scoped(`${ids.salesRoleSelect}:${target}`, userId))
        .setPlaceholder("Selecione um cargo")
        .setMinValues(1)
        .setMaxValues(1)
    )
  );
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, ids.salesConfig, userId)));
  return panel;
}
function salesManagePanel(client, guildId, userId) {
  const products = productsList(guildId);
  const totals = products.reduce((acc, p) => {
    const s = productStats(guildId, p.id);
    acc.revenue += s.revenue;
    acc.units += s.units;
    return acc;
  }, { revenue: 0, units: 0 });
  const activeCoupons = couponsList(guildId).filter((c) => !isCouponExpired(c)).length;
  const panel = container(
    "Gerenciar Vendas",
    `${emojiText(client, "caixa")} Produtos: **${products.length}**\n` +
    `${emojiText(client, "rendimentos")} Receita total: **${formatBRL(totals.revenue)}** • **${totals.units}** un. • ${emojiText(client, "cupom")} Cupons ativos: **${activeCoupons}**\n` +
    `${emojiText(client, "db")} Use o menu para abrir um produto ou crie um novo painel de venda.`,
    SALES_COLOR
  );
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(scoped(ids.salesProductSelect, userId))
        .setPlaceholder(products.length ? "Selecione um produto" : "Nenhum produto criado")
        .setDisabled(!products.length)
        .addOptions((products.length ? products : [{ id: "none", name: "Nenhum produto", description: "Crie um produto primeiro." }]).slice(0, 25).map((product) => ({
          label: product.name.slice(0, 100),
          value: product.id,
          description: (product.description || "Produto").slice(0, 100),
          emoji: componentEmoji(client, "produtoEntregue")
        })))
    )
  );
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      button(client, scoped(ids.salesCreateProduct, userId), "Criar", ButtonStyle.Success, "mais2"),
      button(client, scoped(ids.salesDeleteProduct, userId), "Apagar", ButtonStyle.Danger, "apagar"),
      backButton(client, ids.panelSales, userId)
    )
  );
  return panel;
}
function couponsRootPanel(client, guildId, userId) {
  const coupons = couponsList(guildId).sort((a, b) => b.createdAt - a.createdAt);
  const active = coupons.filter((coupon) => !isCouponExpired(coupon));
  const lines = coupons.length
    ? coupons.slice(0, 10).map((coupon) => `${emojiText(client, "cupom")} **${coupon.code}** — ${coupon.percent}% off • ${couponUsesLabel(coupon)} usos • ${isCouponExpired(coupon) ? "🔴 Expirado" : "🟢 Ativo"}`).join("\n")
    : "Nenhum cupom criado ainda.";
  const panel = container(
    "Sistema de Cupons",
    `${emojiText(client, "cupom")} Gerencie os cupons de desconto da sua loja.\n\n**Cupons ativos:** ${active.length} de ${coupons.length}\n\n${lines}\n\n-# Dica: cupons com validade curta convertem mais.`,
    SALES_COLOR
  );
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(scoped(ids.couponSelect, userId))
        .setPlaceholder(coupons.length ? "Selecione um cupom para editar" : "Nenhum cupom criado")
        .setDisabled(!coupons.length)
        .addOptions((coupons.length ? coupons : [{ id: "none", code: "Nenhum cupom", percent: 0 }]).slice(0, 25).map((coupon) => ({
          label: coupon.code.slice(0, 100),
          value: coupon.id,
          description: `${coupon.percent}% - ${couponStatusLabel(coupon)}`.slice(0, 100),
          emoji: componentEmoji(client, "cupom")
        })))
    )
  );
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      button(client, scoped(ids.couponCreate, userId), "Criar", ButtonStyle.Success, "mais2"),
      button(client, scoped(ids.couponRemove, userId), "Remover", ButtonStyle.Danger, "apagar").setDisabled(!coupons.length),
      backButton(client, ids.panelSales, userId)
    )
  );
  return panel;
}
function couponRemovePanel(client, guildId, userId) {
  const coupons = couponsList(guildId);
  const panel = container("Remover Cupom", "Selecione o cupom que deseja remover.", DANGER_COLOR);
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(scoped(ids.couponRemoveSelect, userId))
        .setPlaceholder(coupons.length ? "Selecione o cupom" : "Nenhum cupom criado")
        .setDisabled(!coupons.length)
        .addOptions((coupons.length ? coupons : [{ id: "none", code: "Nenhum cupom", percent: 0 }]).slice(0, 25).map((coupon) => ({
          label: coupon.code.slice(0, 100),
          value: coupon.id,
          description: `${coupon.percent}% off`.slice(0, 100),
          emoji: componentEmoji(client, "apagar")
        })))
    )
  );
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, ids.couponsRoot, userId)));
  return panel;
}
function couponConfirmRemovePanel(client, guildId, userId, couponId) {
  const coupon = getCoupon(guildId, couponId);
  const panel = container("Confirmar remocao", `Tem certeza que deseja remover o cupom **${coupon?.code || "?"}**?`, DANGER_COLOR);
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      button(client, scoped(`${ids.couponConfirmRemove}:yes:${couponId}`, userId), "Sim, remover", ButtonStyle.Danger, "apagar"),
      button(client, scoped(`${ids.couponConfirmRemove}:no:${couponId}`, userId), "Cancelar", ButtonStyle.Secondary, "negativo")
    )
  );
  return panel;
}
function couponEditPanel(client, guildId, userId, couponId) {
  const coupon = getCoupon(guildId, couponId);
  if (!coupon) return couponsRootPanel(client, guildId, userId);
  const panel = container(
    coupon.code,
    [
      `${emojiText(client, "cupom")} Desconto: **${coupon.percent}%**`,
      `${emojiText(client, "fields")} Escopo: ${couponScopeLabel(guildId, coupon)}`,
      `${emojiText(client, "db")} Usos: **${couponUsesLabel(coupon)}**`,
      `${emojiText(client, "recibo")} Validade: ${couponValidityLabel(coupon)}`,
      `Status: **${couponStatusLabel(coupon)}**`
    ].join("\n"),
    SALES_COLOR
  );
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(scoped(`${ids.couponEditSelect}:${couponId}`, userId))
        .setPlaceholder("O que deseja fazer?")
        .addOptions(
          { label: "Editar Cupom", value: "edit", description: "Alterar nome e porcentagem.", emoji: componentEmoji(client, "editar") },
          { label: "Definir usos", value: "uses", description: "Limite de usos e restricao de produto.", emoji: componentEmoji(client, "db") },
          { label: "Validade", value: "validity", description: "Data e hora de expiracao.", emoji: componentEmoji(client, "recibo") }
        )
    )
  );
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, ids.couponsRoot, userId)));
  return panel;
}
function couponUsesPanel(client, guildId, userId, couponId) {
  const coupon = getCoupon(guildId, couponId);
  if (!coupon) return couponsRootPanel(client, guildId, userId);
  const panel = container(
    "Definir Usos",
    `${emojiText(client, "db")} Cupom: **${coupon.code}**\nUsos: **${couponUsesLabel(coupon)}**\nEscopo: ${couponScopeLabel(guildId, coupon)}\n\nObs: independente do limite de usos, cada usuario so pode usar este cupom 1 vez.`,
    SALES_COLOR
  );
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(scoped(`${ids.couponUsesSelect}:${couponId}`, userId))
        .setPlaceholder("Selecione uma opcao")
        .addOptions(
          { label: "Quantidade de usos", value: "quantity", description: "Defina quantas vezes o cupom pode ser usado.", emoji: componentEmoji(client, "db") },
          { label: "Definir Produto", value: "scope", description: "Restrinja o cupom a um produto ou campo.", emoji: componentEmoji(client, "fields") }
        )
    )
  );
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      ...(coupon.scope !== "all" ? [button(client, scoped(`${ids.couponUsesClear}:${couponId}`, userId), "Remover restricao", ButtonStyle.Secondary, "negativo")] : []),
      backButton(client, `${ids.couponEditSelect}:back:${couponId}`, userId)
    )
  );
  return panel;
}
function couponUsesScopePanel(client, guildId, userId, couponId) {
  const panel = container("Definir Produto", "Escolha se o cupom vale para um produto inteiro ou para um campo especifico.", SALES_COLOR);
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(scoped(`${ids.couponUsesScopeSelect}:${couponId}`, userId))
        .setPlaceholder("Selecione uma opcao")
        .addOptions(
          { label: "Produto", value: "product", description: "Todos os campos do produto poderao usar o cupom.", emoji: componentEmoji(client, "caixa") },
          { label: "Campo", value: "field", description: "Apenas o campo selecionado podera usar o cupom.", emoji: componentEmoji(client, "pricep") }
        )
    )
  );
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, `${ids.couponUsesSelect}:back:${couponId}`, userId)));
  return panel;
}
function couponUsesProductPanel(client, guildId, userId, couponId) {
  const products = productsList(guildId);
  const panel = container("Selecionar Produto", "Selecione o produto que podera usar o cupom.", SALES_COLOR);
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(scoped(`${ids.couponUsesProductSelect}:${couponId}`, userId))
        .setPlaceholder(products.length ? "Selecione um produto" : "Nenhum produto criado")
        .setDisabled(!products.length)
        .addOptions((products.length ? products : [{ id: "none", name: "Nenhum produto" }]).slice(0, 25).map((product) => ({
          label: product.name.slice(0, 100),
          value: product.id,
          emoji: componentEmoji(client, "produtoEntregue")
        })))
    )
  );
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, `${ids.couponUsesScopeSelect}:back:${couponId}`, userId)));
  return panel;
}
function couponUsesFieldProductPanel(client, guildId, userId, couponId) {
  const products = productsList(guildId).filter((product) => fieldsList(product).length > 1);
  const panel = container("Selecionar Produto", "Selecione o produto (apenas produtos com mais de um campo aparecem aqui).", SALES_COLOR);
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(scoped(`${ids.couponUsesFieldProductSelect}:${couponId}`, userId))
        .setPlaceholder(products.length ? "Selecione um produto" : "Nenhum produto elegivel")
        .setDisabled(!products.length)
        .addOptions((products.length ? products : [{ id: "none", name: "Nenhum produto elegivel" }]).slice(0, 25).map((product) => ({
          label: product.name.slice(0, 100),
          value: product.id,
          emoji: componentEmoji(client, "produtoEntregue")
        })))
    )
  );
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, `${ids.couponUsesScopeSelect}:back:${couponId}`, userId)));
  return panel;
}
function couponUsesFieldPanel(client, guildId, userId, couponId, productId) {
  const product = getProduct(guildId, productId);
  const fields = fieldsList(product);
  const panel = container("Selecionar Campo", `Produto: **${product?.name || "?"}**\nSelecione o campo que podera usar o cupom.`, SALES_COLOR);
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(scoped(`${ids.couponUsesFieldSelect}:${couponId}:${productId}`, userId))
        .setPlaceholder(fields.length ? "Selecione um campo" : "Nenhum campo")
        .setDisabled(!fields.length)
        .addOptions((fields.length ? fields : [{ id: "none", name: "Nenhum campo" }]).slice(0, 25).map((field) => ({
          label: field.name.slice(0, 100),
          value: field.id,
          emoji: componentEmoji(client, "pricep")
        })))
    )
  );
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, `${ids.couponUsesFieldProductSelect}:back:${couponId}`, userId)));
  return panel;
}
function couponModal(userId, mode, couponId, currentName, currentPercent) {
  return new ModalBuilder()
    .setCustomId(`${ids.couponModal}:${mode}:${couponId}:${userId}`)
    .setTitle(mode === "edit" ? "Editar Cupom" : "Criar Cupom")
    .addComponents(
      inputRow("name", "Nome do cupom (ex: PROMO)", TextInputStyle.Short, true, currentName, 32),
      inputRow("percent", "Porcentagem de desconto (0 a 100)", TextInputStyle.Short, true, currentPercent ? String(currentPercent) : "", 3)
    );
}
function couponUsesModal(userId, couponId, currentMax) {
  const input = new TextInputBuilder()
    .setCustomId("quantity")
    .setLabel("Quantidade de usos (vazio = ilimitado)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder("Ex: 100");
  if (currentMax) input.setValue(String(currentMax));
  return new ModalBuilder()
    .setCustomId(`${ids.couponUsesModal}:${couponId}:${userId}`)
    .setTitle("Quantidade de Usos")
    .addComponents(new ActionRowBuilder().addComponents(input));
}
function couponValidityModal(userId, couponId, currentExpiresAt) {
  let dateValue = "";
  let timeValue = "12:00";
  if (currentExpiresAt) {
    const date = new Date(currentExpiresAt);
    dateValue = `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
    timeValue = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  return new ModalBuilder()
    .setCustomId(`${ids.couponValidityModal}:${couponId}:${userId}`)
    .setTitle("Validade do Cupom")
    .addComponents(
      inputRow("date", "Data (dd/mm/aaaa) - vazio remove validade", TextInputStyle.Short, false, dateValue, 10),
      inputRow("time", "Horario (hh:mm)", TextInputStyle.Short, false, timeValue, 5)
    );
}
function couponApplyModal(orderId, userId) {
  return new ModalBuilder()
    .setCustomId(`${ids.couponApplyModal}:${orderId}:${userId}`)
    .setTitle("Usar Cupom")
    .addComponents(inputRow("code", "Codigo do cupom", TextInputStyle.Short, true, "", 32));
}
function createProductChoicePanel(client, userId, guildId) {
  if(!AI_PRODUCT_ENABLED){
    const panel = container(
      "Criar Produto",
      `${emojiText(client, "caixa")} Crie um produto manualmente. **Produto com IA desativado** (deprecated) — utilize o fluxo normal com flags.`,
      SALES_COLOR
    );
    panel.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(scoped(ids.salesCreateProductSelect, userId))
          .setPlaceholder("Selecione o tipo de criação")
          .addOptions(
            {
              label: "Criar Produto",
              value: "normal",
              description: "Cria um produto preenchendo nome, descricao e banner.",
              emoji: componentEmoji(client, "mais2")
            },
            {
              label: "Produto com IA (desativado)",
              value: "ai",
              description: "Desativado — utilize flags (deprecated)",
              emoji: componentEmoji(client, "desligado")
            }
          )
      )
    );
    panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, "panel:sales:manage", userId)));
    return panel;
  }
  let hasIA=false;
  try{ const { getIAConfig } = require("../automations"); hasIA=!!getIAConfig(guildId)?.apiKey; }catch{}
  const panel = container(
    "Criar Produto",
    `${emojiText(client, "caixa")} Escolha se deseja criar manualmente ou gerar uma sugestao com IA.\n`+
    `${hasIA ? `${emojiText(client,"wand")} IA Groq pronta` : `${emojiText(client,"negativo")} IA bloqueada — configure em Automações → Sistema de IA → Editar API`}`,
    SALES_COLOR
  );
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(scoped(ids.salesCreateProductSelect, userId))
        .setPlaceholder(hasIA ? "Selecione o tipo de criacao" : "IA bloqueada — configure API primeiro")
        .addOptions(
          {
            label: "Criar Produto",
            value: "normal",
            description: "Cria um produto preenchendo nome, descricao e banner.",
            emoji: componentEmoji(client, "mais2")
          },
          {
            label: hasIA ? "Produto com IA" : "Produto com IA (bloqueado)",
            value: "ai",
            description: hasIA ? "Descreva sua ideia e a IA monta o produto." : "Sem API Groq — vá em Automações → IA",
            emoji: componentEmoji(client, hasIA ? "wand" : "desligado")
          }
        )
    )
  );
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, "panel:sales:manage", userId)));
  return panel;
}
function aiProductModal(userId) {
  return new ModalBuilder()
    .setCustomId(`${ids.salesAiProductModal}:${userId}`)
    .setTitle("Produto com IA")
    .addComponents(inputRow(
      "prompt",
      "Descreva o produto que deseja criar",
      TextInputStyle.Paragraph,
      true,
      null,
      1200
    ));
}
function aiProductPreviewPanel(client, userId, draft) {
  const panel = container(
    "Produto gerado com IA",
    [
      `${emojiText(client, "wand")} Confira como o produto sera criado.`,
      "",
      `**Nome:** ${draft.name}`,
      `**Descricao:** ${draft.description}`,
      `**Entrega:** ${draft.delivery === "manual" ? "manual" : "automatica"}`,
      `**Cor:** ${intToHex(draft.saleColor || SALES_COLOR)}`,
      `**Botao:** ${buttonStyleLabel(draft.buyButtonStyle)}`,
      draft.researchNotes ? `\n**Pesquisa usada:** ${draft.researchNotes}` : ""
    ].join("\n"),
    draft.saleColor || SALES_COLOR
  );
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      button(client, scoped(ids.salesAiProductCreate, userId), "Criar", ButtonStyle.Success, "positivo"),
      button(client, scoped(ids.salesAiProductRetry, userId), "Tentar novamente", ButtonStyle.Secondary, "reload"),
      backButton(client, "panel:sales:manage", userId)
    )
  );
  return panel;
}
function panelModeLabel(mode) {
  if (mode === "embed") return "embed";
  if (mode === "message") return "mensagem";
  return "container";
}
function normalizePanelMode(value) {
  if (value === "embed") return "embed";
  if (value === "message") return "message";
  return "container";
}
function productPanel(client, guildId, userId, productId) {
  const product = getProduct(guildId, productId);
  if (!product) return salesManagePanel(client, guildId, userId);
  const fields = fieldsList(product);
  const totalStock = sumStock(fields);
  const roExtras = roblox.productPanelExtras(guildId, productId);
  const stats = productStats(guildId, productId);
  const prices = fields.map((f) => Number(f.price || 0)).filter((n) => n > 0);
  const priceRange = prices.length
    ? (Math.min(...prices) === Math.max(...prices) ? formatBRL(prices[0]) : `${formatBRL(Math.min(...prices))} – ${formatBRL(Math.max(...prices))}`)
    : "—";
  const publicPanel0 = product.publicPanels?.[0];
  const publicLine = publicPanel0
    ? `[Abrir painel](https://discord.com/channels/${guildId}/${publicPanel0.channelId}/${publicPanel0.messageId})`
    : "`não enviado`";
  const created = product.createdAt ? `<t:${Math.floor(product.createdAt / 1000)}:D>` : "—";
  const panel = container(
    product.name,
    `${emojiText(client, "embed")} ${product.description || "Sem descricao."}\n\n` +
    `${emojiText(client, "caixa")} **Campos:** ${fields.length} • **Estoque total:** ${totalStock}\n` +
    `${emojiText(client, "pricep")} **Preços:** ${priceRange} • **Entrega:** **${product.delivery === "manual" ? "manual" : "automatica"}**\n` +
    `${emojiText(client, "rendimentos")} **Receita:** ${formatBRL(stats.revenue)} • **Unidades:** ${stats.units}\n` +
    `${emojiText(client, "canal")} **Painel público:** ${publicLine}\n` +
    `${emojiText(client, "preview")} **Modo:** **${panelModeLabel(product.panelMode)}** • **Criado:** ${created}${roExtras.line ? `\n${emojiText(client, "caixa")} ${roExtras.line}` : ""}`,
    SALES_COLOR
  );
  if (product.banner) panel.addMediaGalleryComponents(new MediaGalleryBuilder({ items: [{ media: { url: product.banner }, description: product.name }] }));
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      button(client, scoped(`${ids.salesEditProduct}:${productId}`, userId), "Editar Produto", ButtonStyle.Primary, "editar"),
      button(client, scoped(`${ids.salesFields}:${productId}`, userId), "Gerenciar Campos", ButtonStyle.Secondary, "fields").setDisabled(roExtras.active),
      button(client, scoped(`${ids.salesSendProduct}:${productId}`, userId), "Colocar a Venda", ButtonStyle.Success, "carrinhoCancelado")
    )
  );
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      button(client, scoped(`${ids.salesDeliverySelect}:open:${productId}`, userId), "Tipo de entrega", ButtonStyle.Secondary, "produtoEntregue").setDisabled(roExtras.active),
      button(client, scoped(`${ids.salesSyncProduct}:${productId}`, userId), "Sincronizar produto", ButtonStyle.Primary, "reload"),
      button(client, scoped(`${ids.salesConfirmDeleteProduct}:${productId}`, userId), "Excluir produto", ButtonStyle.Danger, "apagar"),
      backButton(client, "panel:sales:manage", userId)
    )
  );
  return panel;
}
function editProductChoicePanel(client, guildId, userId, productId) {
  const product = getProduct(guildId, productId);
  const panel = container(
    "Editar Produto",
    `${emojiText(client, "editar")} Produto: **${product?.name || "Produto"}**\nEscolha o que deseja editar.`,
    SALES_COLOR
  );
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(scoped(`${ids.salesEditProductSelect}:${productId}`, userId))
        .setPlaceholder("Selecione uma opcao")
        .addOptions(
          {
            label: "Editar aparencia",
            value: "appearance",
            description: "Nome, descricao e banner do produto.",
            emoji: componentEmoji(client, "editar")
          },
          {
            label: "Modo de painel",
            value: "panelMode",
            description: "Escolhe se o painel enviado sera container ou embed.",
            emoji: componentEmoji(client, "preview")
          }
        )
    )
  );
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, `${ids.salesProductSelect}:back:${productId}`, userId)));
  return panel;
}
function panelModePanel(client, guildId, userId, productId) {
  const product = getProduct(guildId, productId);
  const panel = container(
    "Modo de Painel",
    `${emojiText(client, "preview")} Produto: **${product?.name || "Produto"}**\nModo atual: **${panelModeLabel(product?.panelMode)}**`,
    SALES_COLOR
  );
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(scoped(`${ids.salesPanelModeSelect}:${productId}`, userId))
        .setPlaceholder("Selecione o modo do painel")
        .addOptions(
          {
            label: "Mensagem",
            value: "message",
            description: "Texto simples com o botao de compra.",
            emoji: componentEmoji(client, "recibo")
          },
          {
            label: "Container",
            value: "container",
            description: "Painel em Components V2.",
            emoji: componentEmoji(client, "caixa")
          },
          {
            label: "Embed",
            value: "embed",
            description: "Painel enviado como embed normal.",
            emoji: componentEmoji(client, "embed")
          }
        )
    )
  );
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, `${ids.salesEditProduct}:${productId}`, userId)));
  return panel;
}
function deliveryChoicePanel(client, guildId, userId, productId) {
  const product = getProduct(guildId, productId);
  const panel = container(
    "Tipo de Entrega",
    `${emojiText(client, "produtoEntregue")} Produto: **${product?.name || "Produto"}**\nEscolha como a entrega deste produto sera feita.`,
    SALES_COLOR
  );
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(scoped(`${ids.salesDeliverySelect}:${productId}`, userId))
        .setPlaceholder("Selecione o tipo de entrega")
        .addOptions(
          {
            label: "Entrega automatica",
            value: "automatic",
            description: "Entrega estoque automaticamente apos aprovacao.",
            emoji: componentEmoji(client, "produtoEntregue")
          },
          {
            label: "Entrega manual",
            value: "manual",
            description: "Owner aprova e a equipe entrega depois.",
            emoji: componentEmoji(client, "userp")
          }
        )
    )
  );
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, `${ids.salesProductSelect}:back:${productId}`, userId)));
  return panel;
}
function deleteProductPanel(client, guildId, userId) {
  const products = productsList(guildId);
  const panel = container("Apagar Produto", "Selecione o produto que deseja apagar.", DANGER_COLOR);
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(scoped(ids.salesDeleteSelect, userId))
        .setPlaceholder(products.length ? "Selecione o produto" : "Nenhum produto criado")
        .setDisabled(!products.length)
        .addOptions((products.length ? products : [{ id: "none", name: "Nenhum produto", description: "Crie um produto primeiro." }]).slice(0, 25).map((product) => ({
          label: product.name.slice(0, 100),
          value: product.id,
          description: (product.description || "Produto").slice(0, 100),
          emoji: componentEmoji(client, "apagar")
        })))
    )
  );
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, "panel:sales:manage", userId)));
  return panel;
}
function confirmDeleteProductPanel(client, guildId, userId, productId) {
  const product = getProduct(guildId, productId);
  const panel = container("Confirmar exclusao", `Tem certeza que deseja apagar **${product?.name || "este produto"}**? Esta acao remove campos e estoque.`, DANGER_COLOR);
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      button(client, scoped(`${ids.salesConfirmDeleteProduct}:yes:${productId}`, userId), "Sim, apagar", ButtonStyle.Danger, "apagar"),
      button(client, scoped(`${ids.salesConfirmDeleteProduct}:no:${productId}`, userId), "Cancelar", ButtonStyle.Secondary, "negativo")
    )
  );
  return panel;
}
function fieldsPanel(client, guildId, userId, productId) {
  const product = getProduct(guildId, productId);
  if (!product) return salesManagePanel(client, guildId, userId);
  const fields = fieldsList(product);
  const pStats = productStats(guildId, productId);
  const panel = container("Gerenciar Campos", `${emojiText(client, "fields")} Produto: **${product.name}**\nSelecione um campo para configurar estoque e valor.`, SALES_COLOR);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${emojiText(client, "db")} Estoque total: **${sumStock(fields)}** • ${emojiText(client, "rendimentos")} Receita: **${formatBRL(pStats.revenue)}** (${pStats.units} un.)`
  ));
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(scoped(`${ids.salesFieldSelect}:${productId}`, userId))
        .setPlaceholder(fields.length ? "Selecione um campo" : "Nenhum campo criado")
        .setDisabled(!fields.length)
        .addOptions((fields.length ? fields : [{ id: "none", name: "Nenhum campo", description: "Crie um campo primeiro.", price: 0 }]).slice(0, 25).map((field) => ({
          label: field.name.slice(0, 100),
          value: field.id,
          description: `${formatBRL(field.price)} - estoque ${stockCount(field)}`.slice(0, 100),
          emoji: componentEmoji(client, "pricep")
        })))
    )
  );
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      button(client, scoped(`${ids.salesCreateField}:${productId}`, userId), "Criar Campo", ButtonStyle.Success, "mais2"),
      button(client, scoped(`${ids.salesDeleteField}:${productId}`, userId), "Excluir Campo", ButtonStyle.Danger, "apagar"),
      backButton(client, `${ids.salesProductSelect}:back:${productId}`, userId)
    )
  );
  return panel;
}
function fieldPanel(client, guildId, userId, productId, fieldId) {
  const product = getProduct(guildId, productId);
  const field = product?.fields[fieldId];
  if (!field) return fieldsPanel(client, guildId, userId, productId);
  const stats = fieldStats(guildId, productId, fieldId);
  const panel = container(
    field.name,
    `${emojiText(client, "embed")} **${product.name}**\n${field.description || "Sem descricao."}\n\n` +
    `${emojiText(client, "pricep")} **Valor:** ${formatBRL(field.price)} • **Estoque:** **${stockCount(field)}**${field.phantom ? " (fantasma)" : ""}\n` +
    `${emojiText(client, "rendimentos")} **Receita:** ${formatBRL(stats.revenue)} • **Unidades:** ${stats.units}\n` +
    `${emojiText(client, "clock")} **Última venda:** ${stats.lastAt ? `<t:${Math.floor(stats.lastAt / 1000)}:R>` : "—"}`,
    SALES_COLOR
  );
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      button(client, scoped(`${ids.salesEditField}:${productId}:${fieldId}`, userId), "Editar Campo", ButtonStyle.Primary, "editar"),
      button(client, scoped(`${ids.salesStock}:${productId}:${fieldId}`, userId), "Gerenciar Estoque", ButtonStyle.Secondary, "db"),
      button(client, scoped(`${ids.salesDeleteField}:${productId}:${fieldId}`, userId), "Excluir campo", ButtonStyle.Danger, "apagar")
    )
  );
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, `${ids.salesFields}:${productId}`, userId)));
  return panel;
}
function stockPanel(client, guildId, userId, productId, fieldId) {
  const product = getProduct(guildId, productId);
  const field = product?.fields[fieldId];
  if (!field) return fieldsPanel(client, guildId, userId, productId);
  const panel = container("Gerenciar Estoque", `${emojiText(client, "db")} Campo: **${field.name}**\nEstoque atual: **${stockCount(field)}**`, OK_COLOR);
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      button(client, scoped(`${ids.salesStockAdd}:${productId}:${fieldId}`, userId), "Adicionar", ButtonStyle.Success, "mais2"),
      button(client, scoped(`${ids.salesStockPhantom}:${productId}:${fieldId}`, userId), "Estoque Fantasma", ButtonStyle.Secondary, "fantasma"),
      button(client, scoped(`${ids.salesStockUpload}:${productId}:${fieldId}`, userId), "Enviar arquivo", ButtonStyle.Primary, "attach"),
      button(client, scoped(`${ids.salesStockView}:${productId}:${fieldId}`, userId), "Ver estoque", ButtonStyle.Secondary, "preview")
    )
  );
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, `${ids.salesFieldSelect}:back:${productId}:${fieldId}`, userId)));
  return panel;
}
function sendTypeSelectPanel(client, userId, productId) {
  const panel = container("Colocar a Venda", `${emojiText(client, "preview")} Escolha como o painel de compra sera enviado.`, OK_COLOR);
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(scoped(`${ids.salesSendTypeSelect}:${productId}`, userId))
        .setPlaceholder("Selecione o tipo do painel")
        .addOptions(
          {
            label: "Mensagem",
            value: "message",
            description: "Texto simples com o botao de compra.",
            emoji: componentEmoji(client, "recibo")
          },
          {
            label: "Container",
            value: "container",
            description: "Components V2.",
            emoji: componentEmoji(client, "caixa")
          },
          {
            label: "Embed",
            value: "embed",
            description: "Embed tradicional.",
            emoji: componentEmoji(client, "embed")
          }
        )
    )
  );
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, `${ids.salesProductSelect}:back:${productId}`, userId)));
  return panel;
}
function sendProductChannelPanel(client, userId, productId) {
  const panel = container("Colocar a Venda", `${emojiText(client, "canal")} Selecione o canal onde o painel de compra sera enviado.`, OK_COLOR);
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(scoped(`${ids.salesSendChannel}:${productId}`, userId))
        .setPlaceholder("Selecione o canal")
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(1)
        .setMaxValues(1)
    )
  );
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, `${ids.salesProductSelect}:back:${productId}`, userId)));
  return panel;
}
function sendAppearanceModal(userId, productId, mode, product = {}) {
  const modal = new ModalBuilder()
    .setCustomId(`${ids.salesSendAppearanceModal}:${mode}:${productId}:${userId}`)
    .setTitle("Aparencia do painel");
  if (mode !== "message") {
    const colorInput = new TextInputBuilder()
      .setCustomId("color")
      .setLabel(`Cor do ${mode === "embed" ? "embed" : "container"} em HEX (opcional)`)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("Ex: #6C5CE7 - deixe vazio para nao usar cor")
      .setRequired(false)
      .setMaxLength(7);
    if (product.saleColor) colorInput.setValue(intToHex(product.saleColor));
    modal.addComponents(new ActionRowBuilder().addComponents(colorInput));
  }
  const buttonInput = new TextInputBuilder()
    .setCustomId("buttonStyle")
    .setLabel("Cor do botao: verde, azul, cinza ou vermelho")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Deixe vazio para usar cinza (padrao)")
    .setRequired(false)
    .setMaxLength(10);
  if (product.buyButtonStyle) buttonInput.setValue(buttonStyleLabel(product.buyButtonStyle));
  modal.addComponents(new ActionRowBuilder().addComponents(buttonInput));
  return modal;
}
function productButtonLabel(fields) {
  return fields.length >= 2 ? "Ver Opcoes" : "Comprar";
}
function productButtonEmoji(fields) {
  return "bag";
}
function productDescriptionLines(client, product, fields) {
  const lines = [product.description || "Produto disponivel para compra."];
  if (fields.length < 2) {
    lines.push("", `${emojiText(client, product.delivery === "manual" ? "userp" : "produtoEntregue")} **Entrega:** ${product.delivery === "manual" ? "manual" : "automatica"}`);
  }
  return lines.join("\n");
}
function publicProductPanel(client, product) {
  const fields = fieldsList(product);
  const soldOut = productSoldOut(product, fields);
  const panel = container(
    `${emojiText(client, "cart")} ${product.name}`,
    productDescriptionLines(client, product, fields),
    product.saleColor || SALES_COLOR
  );
  if (product.banner) panel.addMediaGalleryComponents(new MediaGalleryBuilder({ items: [{ media: { url: product.banner }, description: product.name }] }));
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      button(client, `sales:buy:${product.guildId}:${product.id}`, soldOut ? "Esgotado" : productButtonLabel(fields), buttonStyleFromValue(product.buyButtonStyle), productButtonEmoji(fields))
        .setDisabled(soldOut)
    )
  );
  return panel;
}
function publicProductEmbedPayload(client, product) {
  const fields = fieldsList(product);
  const soldOut = productSoldOut(product, fields);
  const embed = new EmbedBuilder()
    .setColor(product.saleColor || SALES_COLOR)
    .setTitle(`${emojiText(client, "cart")} ${product.name}`)
    .setDescription(product.description || "Produto disponivel para compra.");
  if (fields.length < 2) {
    embed.addFields(
      { name: `${emojiText(client, product.delivery === "manual" ? "userp" : "produtoEntregue")} Entrega`, value: product.delivery === "manual" ? "**manual**" : "**automatica**", inline: true }
    );
  }
  embed.setFooter({ text: soldOut ? "Produto esgotado" : "Clique no botao abaixo para comprar" }).setTimestamp();
  if (product.banner) embed.setImage(product.banner);
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        button(client, `sales:buy:${product.guildId}:${product.id}`, soldOut ? "Esgotado" : productButtonLabel(fields), buttonStyleFromValue(product.buyButtonStyle), productButtonEmoji(fields))
          .setDisabled(soldOut)
      )
    ]
  };
}
function publicProductMessagePayload(client, product) {
  const fields = fieldsList(product);
  const soldOut = productSoldOut(product, fields);
  const lines = [`${emojiText(client, "cart")} **${product.name}**`, "", productDescriptionLines(client, product, fields)];
  return {
    content: lines.join("\n"),
    embeds: [],
    components: [
      new ActionRowBuilder().addComponents(
        button(client, `sales:buy:${product.guildId}:${product.id}`, soldOut ? "Esgotado" : productButtonLabel(fields), buttonStyleFromValue(product.buyButtonStyle), productButtonEmoji(fields))
          .setDisabled(soldOut)
      )
    ]
  };
}
function publicProductPayload(client, product) {
  if (product.panelMode === "embed") return publicProductEmbedPayload(client, product);
  if (product.panelMode === "message") return publicProductMessagePayload(client, product);
  return {
    embeds: [],
    components: [publicProductPanel(client, product)],
    flags: V2
  };
}
function fieldChoicePanel(client, product) {
  const isEn = isEnglishCart(product.guildId);
  const fields = fieldsList(product);
  const panel = container(`${emojiText(client, "cupom")} ${product.name}`, isEn ? "Select the option you want to buy." : "Selecione a opcao que deseja comprar.", product.saleColor || SALES_COLOR);
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`sales:choosefield:${product.guildId}:${product.id}`)
        .setPlaceholder(isEn ? "Select an option" : "Selecione uma opcao")
        .addOptions(fields.slice(0, 25).map((field) => ({
          label: field.name.slice(0, 100),
          value: field.id,
          description: `${fmtMoney(product.guildId, field.price)} - ${isEn ? "stock" : "estoque"} ${stockCount(field)}`.slice(0, 100),
          emoji: componentEmoji(client, "cupom")
        })))
    )
  );
  return panel;
}
function stepDots(client, active) {
  const e = (name, fallback) => {
    const found = componentEmoji(client, name);
    return found ? `<:${found.name}:${found.id}>` : fallback;
  };
  const labels = ["Carrinho", "Pagamento", "Entrega"];
  return labels.map((label, i) => `${e(i + 1 === active ? "w_on" : "w_off", i + 1 === active ? "●" : "○")} ${label}`).join("   ");
}
function cartPanel(client, order) {
  const isEn = isEnglishCart(order.guildId);
  const salesConfig = getGuildConfig(order.guildId).sales;
  const unit = fmtMoney(order.guildId, order.unitPrice);
  const subtotal = fmtMoney(order.guildId, order.originalTotal || order.total);
  const panel = new ContainerBuilder().setAccentColor(order.saleColor || 0xffffff);
  if (order.banner) {
    try {
      panel.addMediaGalleryComponents(new MediaGalleryBuilder({ items: [{ media: { url: order.banner }, description: order.productName }] }));
    } catch {}
  }
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(stepDots(client, 1)));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${order.productName}\n${isEn ? "Check your products before continuing." : "Confira seus produtos antes de continuar."}`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `**${isEn ? "Your products" : "Seus produtos"}**\n` +
    `**${order.quantity}x ${order.fieldName}**\n` +
    `-# ${isEn ? "Unit" : "Unitário"}: ${unit} · Subtotal: ${subtotal}` +
    (order.couponCode ? `\n-# ${emojiText(client, "cupom")} \`${order.couponCode}\`` : "")
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${order.quantity} ${order.quantity === 1 ? "item" : "itens"} • **Subtotal:** ${subtotal}`
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${isEn ? "Total" : "Total"}: ${orderValueSummary(order)}`
  ));
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      button(client, `sales:pay:${order.id}`, isEn ? "Go to Payment" : "Ir para o Pagamento", ButtonStyle.Success, "positivo"),
      button(client, `sales:qty:${order.id}`, isEn ? "Quantity" : "Quantidade", ButtonStyle.Primary, "editar")
    )
  );
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      button(client, `sales:coupon:${order.id}`, order.couponCode ? (isEn ? "Change Coupon" : "Trocar Cupom") : (isEn ? "Coupon" : "Cupom"), ButtonStyle.Secondary, "cupom"),
      button(client, `sales:cancel:${order.id}`, isEn ? "Cancel" : "Cancelar", ButtonStyle.Danger, "apagar")
    )
  );
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `-# \`#${order.id}\`` +
    (salesConfig.roles.staff ? ` • ${emojiText(client, "users")} <@&${salesConfig.roles.staff}>` : "")
  ));
  return { components: [panel], flags: V2 };
}
function cartClosedMessage(client, title, description, color = SALES_COLOR) {
  const panel = new ContainerBuilder().setAccentColor(color);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}\n${description}`));
  return { components: [panel], flags: V2 };
}
function paymentIntroMessage(client, order) {
  const panel = new ContainerBuilder().setAccentColor(OK_COLOR);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${emojiText(client, "pix")}PIX gerado\n### ${orderValueSummary(order)}\n-# \`#${order.id}\``
  ));
  return { components: [panel], flags: V2 };
}
function paymentMethodMessage(client, order) {
  const pixIcon = emojiText(client, "pix");
  const cardIcon = emojiText(client, "cartao");
  const btcIcon = emojiText(client, "bitcoin");
  const walletIcon = emojiText(client, "carteira", "💰");
  const saldoEnabled = (()=>{ try{ return saldoStore.isEnabled(); }catch{ return false; }})();
  const saldoBalance = saldoEnabled ? saldoStore.getBalance(order.userId) : 0;
  const canPay = saldoBalance >= Number(order.total||0);
  const panel = new ContainerBuilder().setAccentColor(order.saleColor || 0xffffff);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(stepDots(client, 2)));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${order.productName}\nEscolha como deseja pagar.`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `**Produtos no Carrinho:**\n` +
    `**${order.quantity}x ${order.fieldName}** à ${orderValueSummary(order)}`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `**Valor Total:** ${orderValueSummary(order)}\n` +
    `**Entrega:** ${order.delivery === "manual" ? "Manual (pela equipe)" : "Automática (na hora)"}`
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `**Opções disponíveis**\n` +
    `${pixIcon} **Pix** — aprovação na hora\n` +
    `${cardIcon} **Cartão** — em breve\n` +
    `${btcIcon} **Bitcoin** — em breve` +
    (saldoEnabled ? `\n${walletIcon} **Saldo** — \`${saldoStore.formatBRL(saldoBalance)}\`` : "") +
    `\nSelecione abaixo como deseja pagar:`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, `sales:paymethod:pix:${order.id}`, "Pix", ButtonStyle.Primary, "pix"),
    button(client, `sales:paymethod:card:${order.id}`, "Cartão", ButtonStyle.Secondary, "cartao").setDisabled(true),
    button(client, `sales:paymethod:btc:${order.id}`, "Bitcoin", ButtonStyle.Secondary, "bitcoin").setDisabled(true)
  ));
  if (saldoEnabled) {
    panel.addActionRowComponents(new ActionRowBuilder().addComponents(
      button(client, `sales:paymethod:saldo:${order.id}`, "Saldo", canPay ? ButtonStyle.Success : ButtonStyle.Secondary, "carteira").setDisabled(!canPay)
    ));
  }
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, `sales:cancel:${order.id}`, "Cancelar", ButtonStyle.Secondary, "apagar")
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# \`#${order.id}\``));
  return { components: [panel], flags: V2 };
}
async function handleSalesInteraction(interaction) {
  if (interaction.isButton() || interaction.isAnySelectMenu()) {
    if (interaction.customId.startsWith("sales:")) return handlePublicSalesInteraction(interaction);
  }
  return false;
}
async function handleSalesPanelComponent(interaction, baseId) {
  const client = interaction.client;
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  try{
    const saldo = require("../saldo");
    if(await saldo.handleSaldoPanelComponent(interaction, baseId)) return true;
  }catch{}
  try{
    const receipt = require("./receipt");
    if(await receipt.handleReceiptPanelComponent(interaction, baseId)) return true;
  }catch{}
  if (await roblox.handleRobloxPanelComponent(interaction, baseId)) return true;
  if (baseId === ids.panelSales) {
    await safeUpdate(interaction, panelPayload(salesRootPanel(client, userId)));
    return true;
  }
  if (baseId === ids.salesRootSelect) {
    if (interaction.values[0] === "coupons") {
      await safeUpdate(interaction, panelPayload(couponsRootPanel(client, guildId, userId)));
      return true;
    }
    if (interaction.values[0] === "saldo") {
      const saldo = require("../saldo");
      await safeUpdate(interaction, panelPayload(saldo.saldoConfigPanel(client, guildId, userId)));
      return true;
    }
    await safeUpdate(interaction, panelPayload(salesManagePanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.salesConfig) {
    await safeUpdate(interaction, panelPayload(salesConfigPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.salesConfigSelect) {
    const selected = interaction.values[0];
    if (selected.startsWith("role:")) {
      await safeUpdate(interaction, panelPayload(salesRolePickerPanel(client, userId, selected.replace("role:", ""))));
      return true;
    }
    await safeUpdate(interaction, panelPayload(salesChannelPickerPanel(client, userId, selected)));
    return true;
  }
  if (baseId.startsWith(ids.salesChannelSelect)) {
    const target = baseId.split(":").at(-1);
    const channelId = interaction.values[0];
    const { SALES_LOG_KEYS } = require("../../config");
    setGuildSalesConfig(guildId, (sales) => {
      if (target === "all") {
        for (const key of SALES_LOG_KEYS) sales.channels[key] = channelId;
      } else {
        sales.channels[target] = channelId;
      }
      return sales;
    });
    await safeUpdate(interaction, panelPayload(salesConfigPanel(client, guildId, userId)));
    return true;
  }
  if (baseId.startsWith(ids.salesRoleSelect)) {
    const target = baseId.split(":").at(-1);
    const roleId = interaction.values[0];
    setGuildSalesConfig(guildId, (sales) => {
      sales.roles[target] = roleId;
      return sales;
    });
    await safeUpdate(interaction, panelPayload(salesConfigPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.salesCartLogsToggle) {
    setGuildSalesConfig(guildId, (sales) => {
      sales.cartLogsEnabled = !sales.cartLogsEnabled;
      return sales;
    });
    await safeUpdate(interaction, panelPayload(salesConfigPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === "panel:sales:manage") {
    await safeUpdate(interaction, panelPayload(salesManagePanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.salesCreateProduct) {
    await safeUpdate(interaction, panelPayload(createProductChoicePanel(client, userId, guildId)));
    return true;
  }
  if (baseId === ids.salesCreateProductSelect) {
    if (interaction.values[0] === "normal") {
      await safeShowModal(interaction, productModal(userId, "create"));
      return true;
    }
    if(!AI_PRODUCT_ENABLED){
      await safeReply(interaction, { content:"⚠️ Produto com IA desativado (deprecated). Utilize **Criar Produto** normal com flags.", flags: MessageFlags.Ephemeral });
      return true;
    }
    try{ const { getIAConfig } = require("../automations"); if(!getIAConfig(guildId)?.apiKey){ await safeReply(interaction, { content:"⚠️ IA bloqueada — configure API Groq em Automações → Sistema de IA → Configurar IA → Editar API.", flags: MessageFlags.Ephemeral }); return true; } }catch{}
    await safeShowModal(interaction, aiProductModal(userId));
    return true;
  }
  if (baseId === ids.salesAiProductRetry) {
    if(!AI_PRODUCT_ENABLED){
      await safeReply(interaction, { content:"⚠️ Produto com IA desativado (deprecated).", flags: MessageFlags.Ephemeral });
      return true;
    }
    await safeShowModal(interaction, aiProductModal(userId));
    return true;
  }
  if (baseId === ids.salesAiProductCreate) {
    if(!AI_PRODUCT_ENABLED){
      await safeReply(interaction, { content:"⚠️ Produto com IA desativado.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const draft = getAiProductDraft(guildId, userId);
    if (!draft) {
      await safeReply(interaction, { content: "A previa da IA expirou. Tente gerar novamente.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const check = checkProhibitedContent(draft.name, draft.description);
    if (check.blocked) {
      clearAiProductDraft(guildId, userId);
      await reportViolation(client, guildId, {
        rule: "Produto de IA com conteudo proibido",
        description: `A IA gerou e tentaram aplicar o produto "${draft.name}" (categoria: ${check.label}).`,
        reportedBy: userId,
        severity: check.severity
      });
      await interaction.reply({ content: prohibitedContentMessage(check), flags: MessageFlags.Ephemeral });
      return true;
    }
    const product = createProduct(guildId, draft);
    clearAiProductDraft(guildId, userId);
    await safeUpdate(interaction, panelPayload(deliveryChoicePanel(client, guildId, userId, product.id)));
    return true;
  }
  if (baseId === ids.salesDeleteProduct) {
    await safeUpdate(interaction, panelPayload(deleteProductPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.salesProductSelect) {
    await safeUpdate(interaction, panelPayload(productPanel(client, guildId, userId, interaction.values[0])));
    return true;
  }
  if (baseId.startsWith(`${ids.salesProductSelect}:back:`)) {
    await safeUpdate(interaction, panelPayload(productPanel(client, guildId, userId, baseId.split(":").at(-1))));
    return true;
  }
  if (baseId === ids.salesDeleteSelect) {
    await safeUpdate(interaction, panelPayload(confirmDeleteProductPanel(client, guildId, userId, interaction.values[0])));
    return true;
  }
  if (baseId.startsWith(ids.salesConfirmDeleteProduct)) {
    const parts = baseId.split(":");
    if (parts.at(-2) === "yes") {
      deleteProduct(guildId, parts.at(-1));
      await safeUpdate(interaction, panelPayload(salesManagePanel(client, guildId, userId)));
      return true;
    }
    if (parts.at(-2) === "no") {
      await safeUpdate(interaction, panelPayload(salesManagePanel(client, guildId, userId)));
      return true;
    }
    await safeUpdate(interaction, panelPayload(confirmDeleteProductPanel(client, guildId, userId, parts.at(-1))));
    return true;
  }
  if (baseId.startsWith(ids.salesEditProductSelect)) {
    const productId = baseId.split(":").at(-1);
    if (interaction.values[0] === "appearance") {
      await interaction.showModal(productModal(userId, "edit", productId, getProduct(guildId, productId)));
      return true;
    }
    await safeUpdate(interaction, panelPayload(panelModePanel(client, guildId, userId, productId)));
    return true;
  }
  if (baseId.startsWith(ids.salesPanelModeSelect)) {
    const productId = baseId.split(":").at(-1);
    setProduct(guildId, productId, (product) => {
      product.panelMode = normalizePanelMode(interaction.values[0]);
      return product;
    });
    await refreshPublicProductPanels(client, guildId, productId);
    await safeUpdate(interaction, panelPayload(productPanel(client, guildId, userId, productId)));
    return true;
  }
  if (baseId.startsWith(ids.salesEditProduct)) {
    await safeUpdate(interaction, panelPayload(editProductChoicePanel(client, guildId, userId, baseId.split(":").at(-1))));
    return true;
  }
  if (baseId.startsWith(ids.salesDeliverySelect)) {
    const parts = baseId.split(":");
    const productId = parts.at(-1);
    if (parts.includes("open")) {
      await safeUpdate(interaction, panelPayload(deliveryChoicePanel(client, guildId, userId, productId)));
      return true;
    }
    setProduct(guildId, productId, (product) => {
      product.delivery = interaction.values[0] === "manual" ? "manual" : "automatic";
      return product;
    });
    await refreshPublicProductPanels(client, guildId, productId);
    await safeUpdate(interaction, panelPayload(productPanel(client, guildId, userId, productId)));
    return true;
  }
  if (baseId.startsWith(ids.salesFields)) {
    await safeUpdate(interaction, panelPayload(fieldsPanel(client, guildId, userId, baseId.split(":").at(-1))));
    return true;
  }
  if (baseId.startsWith(ids.salesSendChannel)) {
    const productId = baseId.split(":").at(-1);
    const product = getProduct(guildId, productId);
    const channel = await interaction.guild.channels.fetch(interaction.values[0]).catch(() => null);
    if (!product || !channel?.isTextBased()) {
      await interaction.reply({ content: "Produto ou canal invalido.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (!fieldsList(product).length && !roblox.isActive(guildId, productId)) {
      await interaction.reply({ content: "Crie pelo menos um campo antes de colocar o produto a venda.", flags: MessageFlags.Ephemeral });
      return true;
    }
    try {
      const message = await channel.send(publicProductPayload(client, product));
      registerProductPanel(guildId, productId, channel.id, message.id);
      await safeUpdate(interaction, panelPayload(productPanel(client, guildId, userId, productId)));
      await interaction.followUp({ content: `Painel de venda enviado em ${channel}.`, flags: MessageFlags.Ephemeral });
    } catch (error) {
      await interaction.reply({ content: `Nao consegui enviar o painel nesse canal: ${error.message}`, flags: MessageFlags.Ephemeral });
    }
    return true;
  }
  if (baseId.startsWith(ids.salesSendTypeSelect)) {
    const productId = baseId.split(":").at(-1);
    const mode = normalizePanelMode(interaction.values[0]);
    await interaction.showModal(sendAppearanceModal(userId, productId, mode, getProduct(guildId, productId)));
    return true;
  }
  if (baseId.startsWith(ids.salesSendProduct)) {
    const productId = baseId.split(":").at(-1);
    await safeUpdate(interaction, panelPayload(sendTypeSelectPanel(client, userId, productId)));
    return true;
  }
  if (baseId.startsWith(ids.salesSyncProduct)) {
    const productId = baseId.split(":").at(-1);
    await refreshPublicProductPanels(client, guildId, productId);
    await interaction.reply({ content: "Produto sincronizado nos paineis enviados.", flags: MessageFlags.Ephemeral });
    return true;
  }
  if (baseId.startsWith(ids.salesCreateField)) {
    await interaction.showModal(fieldModal(userId, "create", baseId.split(":").at(-1)));
    return true;
  }
  if (baseId === ids.salesDeleteFieldSelect) {
    if (!interaction.values?.[0]) {
      await interaction.reply({ content: "Selecione um campo para excluir.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const [productId, fieldId] = interaction.values[0].split("|");
    setProduct(guildId, productId, (product) => {
      delete product.fields[fieldId];
      return product;
    });
    await safeUpdate(interaction, panelPayload(fieldsPanel(client, guildId, userId, productId)));
    return true;
  }
  if (baseId.startsWith(ids.salesDeleteField)) {
    const parts = baseId.split(":");
    if (parts.length >= 6) {
      const productId = parts.at(-2);
      const fieldId = parts.at(-1);
      setProduct(guildId, productId, (product) => {
        delete product.fields[fieldId];
        return product;
      });
      await refreshPublicProductPanels(client, guildId, productId);
      await safeUpdate(interaction, panelPayload(fieldsPanel(client, guildId, userId, productId)));
      return true;
    }
    await safeUpdate(interaction, panelPayload(deleteFieldPanel(client, guildId, userId, parts.at(-1))));
    return true;
  }
  if (baseId.startsWith(ids.salesEditField)) {
    const parts = baseId.split(":");
    const productId = parts.at(-2);
    const fieldId = parts.at(-1);
    const product = getProduct(guildId, productId);
    await interaction.showModal(fieldModal(userId, "edit", productId, fieldId, product?.fields[fieldId]));
    return true;
  }
  if (baseId.startsWith(ids.salesFieldSelect)) {
    const parts = baseId.split(":");
    if (parts.includes("back")) {
      await safeUpdate(interaction, panelPayload(fieldPanel(client, guildId, userId, parts.at(-2), parts.at(-1))));
      return true;
    }
    if (!interaction.values?.[0]) {
      await interaction.reply({ content: "Selecione um campo valido.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await safeUpdate(interaction, panelPayload(fieldPanel(client, guildId, userId, parts.at(-1), interaction.values[0])));
    return true;
  }
  if (baseId.startsWith(ids.salesStockAdd)) {
    const parts = baseId.split(":");
    await interaction.showModal(stockAddModal(userId, parts.at(-2), parts.at(-1)));
    return true;
  }
  if (baseId.startsWith(ids.salesStockPhantom)) {
    const parts = baseId.split(":");
    await interaction.showModal(stockPhantomModal(userId, parts.at(-2), parts.at(-1)));
    return true;
  }
  if (baseId.startsWith(ids.salesStockUpload)) {
    const parts = baseId.split(":");
    await interaction.showModal(stockUploadModal(userId, parts.at(-2), parts.at(-1)));
    return true;
  }
  if (baseId.startsWith(ids.salesStockView)) {
    const parts = baseId.split(":");
    const product = getProduct(guildId, parts.at(-2));
    const field = product?.fields[parts.at(-1)];
    const items = field?.stock?.slice(0, 20) || [];
    await interaction.reply({ content: items.length ? `Primeiros estoques:\n\`\`\`\n${items.join("\n")}\n\`\`\`` : "Este campo nao tem estoque real salvo.", flags: MessageFlags.Ephemeral });
    return true;
  }
  if (baseId.startsWith(ids.salesStock)) {
    const parts = baseId.split(":");
    await safeUpdate(interaction, panelPayload(stockPanel(client, guildId, userId, parts.at(-2), parts.at(-1))));
    return true;
  }
  if (baseId === ids.couponsRoot) {
    await safeUpdate(interaction, panelPayload(couponsRootPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.couponSelect) {
    if (!interaction.values?.[0] || interaction.values[0] === "none") {
      await interaction.reply({ content: "Nenhum cupom disponivel.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await safeUpdate(interaction, panelPayload(couponEditPanel(client, guildId, userId, interaction.values[0])));
    return true;
  }
  if (baseId === ids.couponCreate) {
    await interaction.showModal(couponModal(userId, "create", "new", "", ""));
    return true;
  }
  if (baseId === ids.couponRemove) {
    await safeUpdate(interaction, panelPayload(couponRemovePanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.couponRemoveSelect) {
    if (!interaction.values?.[0] || interaction.values[0] === "none") {
      await interaction.reply({ content: "Selecione um cupom valido.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await safeUpdate(interaction, panelPayload(couponConfirmRemovePanel(client, guildId, userId, interaction.values[0])));
    return true;
  }
  if (baseId.startsWith(ids.couponConfirmRemove)) {
    const parts = baseId.split(":");
    const decision = parts.at(-2);
    const couponId = parts.at(-1);
    if (decision === "yes") {
      deleteCoupon(guildId, couponId);
    }
    await safeUpdate(interaction, panelPayload(couponsRootPanel(client, guildId, userId)));
    return true;
  }
  if (baseId.startsWith(`${ids.couponEditSelect}:back:`)) {
    const couponId = baseId.split(":").at(-1);
    await safeUpdate(interaction, panelPayload(couponEditPanel(client, guildId, userId, couponId)));
    return true;
  }
  if (baseId.startsWith(ids.couponEditSelect)) {
    const couponId = baseId.split(":").at(-1);
    const coupon = getCoupon(guildId, couponId);
    if (!coupon) {
      await safeUpdate(interaction, panelPayload(couponsRootPanel(client, guildId, userId)));
      return true;
    }
    const value = interaction.values[0];
    if (value === "edit") {
      await interaction.showModal(couponModal(userId, "edit", couponId, coupon.code, coupon.percent));
      return true;
    }
    if (value === "uses") {
      await safeUpdate(interaction, panelPayload(couponUsesPanel(client, guildId, userId, couponId)));
      return true;
    }
    if (value === "validity") {
      await interaction.showModal(couponValidityModal(userId, couponId, coupon.expiresAt));
      return true;
    }
    return true;
  }
  if (baseId.startsWith(`${ids.couponUsesSelect}:back:`)) {
    const couponId = baseId.split(":").at(-1);
    await safeUpdate(interaction, panelPayload(couponUsesPanel(client, guildId, userId, couponId)));
    return true;
  }
  if (baseId.startsWith(ids.couponUsesSelect)) {
    const couponId = baseId.split(":").at(-1);
    const value = interaction.values[0];
    if (value === "quantity") {
      const coupon = getCoupon(guildId, couponId);
      await interaction.showModal(couponUsesModal(userId, couponId, coupon?.maxUses ?? ""));
      return true;
    }
    if (value === "scope") {
      await safeUpdate(interaction, panelPayload(couponUsesScopePanel(client, guildId, userId, couponId)));
      return true;
    }
    return true;
  }
  if (baseId.startsWith(ids.couponUsesClear)) {
    const couponId = baseId.split(":").at(-1);
    setCoupon(guildId, couponId, (coupon) => ({ ...coupon, scope: "all", productId: null, fieldId: null }));
    await safeUpdate(interaction, panelPayload(couponUsesPanel(client, guildId, userId, couponId)));
    return true;
  }
  if (baseId.startsWith(`${ids.couponUsesScopeSelect}:back:`)) {
    const couponId = baseId.split(":").at(-1);
    await safeUpdate(interaction, panelPayload(couponUsesScopePanel(client, guildId, userId, couponId)));
    return true;
  }
  if (baseId.startsWith(ids.couponUsesScopeSelect)) {
    const couponId = baseId.split(":").at(-1);
    const value = interaction.values[0];
    if (value === "product") {
      await safeUpdate(interaction, panelPayload(couponUsesProductPanel(client, guildId, userId, couponId)));
      return true;
    }
    await safeUpdate(interaction, panelPayload(couponUsesFieldProductPanel(client, guildId, userId, couponId)));
    return true;
  }
  if (baseId.startsWith(`${ids.couponUsesProductSelect}`)) {
    const couponId = baseId.split(":").at(-1);
    const productId = interaction.values[0];
    if (!productId || productId === "none") {
      await interaction.reply({ content: "Selecione um produto valido.", flags: MessageFlags.Ephemeral });
      return true;
    }
    setCoupon(guildId, couponId, (coupon) => ({ ...coupon, scope: "product", productId, fieldId: null }));
    await safeUpdate(interaction, panelPayload(couponUsesPanel(client, guildId, userId, couponId)));
    return true;
  }
  if (baseId.startsWith(`${ids.couponUsesFieldProductSelect}:back:`)) {
    const couponId = baseId.split(":").at(-1);
    await safeUpdate(interaction, panelPayload(couponUsesFieldProductPanel(client, guildId, userId, couponId)));
    return true;
  }
  if (baseId.startsWith(ids.couponUsesFieldProductSelect)) {
    const couponId = baseId.split(":").at(-1);
    const productId = interaction.values[0];
    if (!productId || productId === "none") {
      await interaction.reply({ content: "Selecione um produto valido.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await safeUpdate(interaction, panelPayload(couponUsesFieldPanel(client, guildId, userId, couponId, productId)));
    return true;
  }
  if (baseId.startsWith(ids.couponUsesFieldSelect)) {
    const parts = baseId.split(":");
    const couponId = parts.at(-2);
    const productId = parts.at(-1);
    const fieldId = interaction.values[0];
    if (!fieldId || fieldId === "none") {
      await interaction.reply({ content: "Selecione um campo valido.", flags: MessageFlags.Ephemeral });
      return true;
    }
    setCoupon(guildId, couponId, (coupon) => ({ ...coupon, scope: "field", productId, fieldId }));
    await safeUpdate(interaction, panelPayload(couponUsesPanel(client, guildId, userId, couponId)));
    return true;
  }
  return false;
}
function deleteFieldPanel(client, guildId, userId, productId) {
  const product = getProduct(guildId, productId);
  const fields = fieldsList(product);
  const panel = container("Excluir Campo", `Produto: **${product?.name || "Produto"}**`, 0xe74c3c);
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(scoped(ids.salesDeleteFieldSelect, userId))
        .setPlaceholder(fields.length ? "Selecione o campo" : "Nenhum campo criado")
        .setDisabled(!fields.length)
        .addOptions((fields.length ? fields : [{ id: "none", name: "Nenhum campo", price: 0 }]).map((field) => ({
          label: field.name.slice(0, 100),
          value: `${productId}|${field.id}`,
          description: formatBRL(field.price),
          emoji: componentEmoji(client, "apagar")
        })))
    )
  );
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(backButton(client, `${ids.salesFields}:${productId}`, userId)));
  return panel;
}
async function handleSalesModal(interaction) {
  if (!interaction.customId.startsWith("modal:sales:")) return false;
  const parts = interaction.customId.split(":");
  const ownerId = parts.at(-1);
  if (ownerId !== interaction.user.id) {
    await interaction.reply({ content: "Este modal pertence a outra pessoa.", flags: MessageFlags.Ephemeral });
    return true;
  }
  const guildId = interaction.guildId;
  const client = interaction.client;
  if (parts[2] === "product") {
    const mode = parts[3];
    const productId = parts[4];
    const input = productInput(interaction);
    const check = checkProhibitedContent(input.name, input.description);
    if (check.blocked) {
      await reportViolation(client, guildId, {
        rule: "Produto com conteudo proibido",
        description: `Tentou cadastrar produto "${input.name}" (categoria: ${check.label}).`,
        reportedBy: interaction.user.id,
        severity: check.severity
      });
      await interaction.reply({ content: prohibitedContentMessage(check), flags: MessageFlags.Ephemeral });
      return true;
    }
    const product = mode === "edit"
      ? setProduct(guildId, productId, (current) => ({ ...current, ...input }))
      : createProduct(guildId, input);
    if (mode === "edit") await refreshPublicProductPanels(client, guildId, product.id);
    await safeUpdate(interaction, panelPayload(mode === "edit"
      ? productPanel(client, guildId, ownerId, product.id)
      : deliveryChoicePanel(client, guildId, ownerId, product.id)));
    return true;
  }
  if (parts[2] === "ai" && parts[3] === "describe") {
    if(!AI_PRODUCT_ENABLED){
      await safeReply(interaction, { content:"⚠️ Produto com IA desativado (deprecated). Utilize flags.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const prompt = interaction.fields.getTextInputValue("prompt").trim();
    if (!canUseAiProductToday(guildId, ownerId)) {
      await safeReply(interaction, { content: "Voce ja usou as 5 criacoes com IA de hoje. Tente novamente amanha.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const promptCheck = checkProhibitedContent(prompt);
    if (promptCheck.blocked) {
      await reportViolation(client, guildId, {
        rule: "Prompt de IA com conteudo proibido",
        description: `Pediu para a IA gerar um produto com prompt relacionado a: ${promptCheck.label}.`,
        reportedBy: interaction.user.id,
        severity: promptCheck.severity
      });
      await interaction.reply({ content: prohibitedContentMessage(promptCheck), flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.deferUpdate();
    try {
      const draft = await generateAiProduct(prompt);
      incrementAiProductUsage(guildId, ownerId);
      setAiProductDraft(guildId, ownerId, draft);
      await interaction.editReply(panelPayload(aiProductPreviewPanel(client, ownerId, draft)));
    } catch (error) {
      await interaction.editReply(panelPayload(aiErrorPanel(client, ownerId, error.message)));
    }
    return true;
  }
  if (parts[2] === "send" && parts[3] === "appearance") {
    const mode = normalizePanelMode(parts[4]);
    const productId = parts[5];
    const colorInput = mode !== "message" ? interaction.fields.getTextInputValue("color").trim() : "";
    const buttonInput = interaction.fields.getTextInputValue("buttonStyle").trim();
    const color = colorInput ? parseHexColor(colorInput, null) : null;
    if (colorInput && color === null) {
      await interaction.reply({ content: "Cor do container/embed invalida. Use um HEX valido, exemplo #6C5CE7, ou deixe vazio.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const buyButtonStyle = normalizeButtonStyle(buttonInput);
    setProduct(guildId, productId, (product) => {
      product.panelMode = mode;
      product.saleColor = color;
      product.buyButtonStyle = buyButtonStyle;
      return product;
    });
    await refreshPublicProductPanels(client, guildId, productId);
    await safeUpdate(interaction, panelPayload(sendProductChannelPanel(client, ownerId, productId)));
    return true;
  }
  if (parts[2] === "field") {
    const mode = parts[3];
    const productId = parts[4];
    const fieldId = parts[5];
    const input = fieldInput(interaction);
    const check = checkProhibitedContent(input.name, input.description);
    if (check.blocked) {
      await reportViolation(client, guildId, {
        rule: "Campo de produto com conteudo proibido",
        description: `Tentou cadastrar o campo "${input.name}" (categoria: ${check.label}).`,
        reportedBy: interaction.user.id,
        severity: check.severity
      });
      await interaction.reply({ content: prohibitedContentMessage(check), flags: MessageFlags.Ephemeral });
      return true;
    }
    const product = mode === "edit"
      ? setProduct(guildId, productId, (current) => {
        current.fields[fieldId] = { ...current.fields[fieldId], ...input };
        return current;
      })
      : createField(guildId, productId, input);
    await refreshPublicProductPanels(client, guildId, productId);
    const nextFieldId = mode === "edit" ? fieldId : product.lastFieldId;
    await safeUpdate(interaction, panelPayload(fieldPanel(client, guildId, ownerId, productId, nextFieldId)));
    return true;
  }
  if (parts[2] === "stock" && parts[3] === "add") {
    const productId = parts[4];
    const fieldId = parts[5];
    const items = parseStockLines(interaction.fields.getTextInputValue("items")).slice(0, 1000);
    setProduct(guildId, productId, (product) => {
      product.fields[fieldId].stock = [...(product.fields[fieldId].stock || []), ...items];
      product.fields[fieldId].phantom = null;
      return product;
    });
    await refreshPublicProductPanels(client, guildId, productId);
    try{
      const { sendReestockNotification } = require("../automations");
      const freshProduct = getProduct(guildId, productId);
      const freshField = freshProduct?.fields[fieldId];
      if(freshProduct && freshField) await sendReestockNotification(client, guildId, freshProduct, freshField, items.length).catch(()=>null);
    }catch{}
    await safeUpdate(interaction, panelPayload(stockPanel(client, guildId, ownerId, productId, fieldId)));
    return true;
  }
  if (parts[2] === "stock" && parts[3] === "phantom") {
    const productId = parts[4];
    const fieldId = parts[5];
    const item = interaction.fields.getTextInputValue("item").trim();
    const qtyText = interaction.fields.getTextInputValue("quantity").trim().toLowerCase();
    const infinite = qtyText === "infinito";
    const quantity = infinite ? "infinite" : Math.min(Math.max(Number(qtyText) || 1, 1), 9999);
    setProduct(guildId, productId, (product) => {
      product.fields[fieldId].stock = [];
      product.fields[fieldId].phantom = { item, quantity };
      return product;
    });
    await refreshPublicProductPanels(client, guildId, productId);
    try{
      const { sendReestockNotification } = require("../automations");
      const freshProduct = getProduct(guildId, productId);
      const freshField = freshProduct?.fields[fieldId];
      if(freshProduct && freshField) await sendReestockNotification(client, guildId, freshProduct, freshField, quantity==="infinite"?"infinito":quantity).catch(()=>null);
    }catch{}
    await safeUpdate(interaction, panelPayload(stockPanel(client, guildId, ownerId, productId, fieldId)));
    return true;
  }
  if (parts[2] === "stock" && parts[3] === "upload") {
    const productId = parts[4];
    const fieldId = parts[5];
    const attachment = interaction.fields.getUploadedFiles("file")?.first?.();
    if (!attachment) {
      await interaction.reply({ content: "Nenhum arquivo recebido. Tente novamente.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (!/\.txt$/i.test(attachment.name || "")) {
      await interaction.reply({ content: "Envie um arquivo `.txt` com um estoque por linha.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const response = await fetch(attachment.url).catch(() => null);
    if (!response?.ok) {
      await interaction.reply({ content: "Nao consegui baixar o arquivo enviado. Tente novamente.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const text = await response.text();
    const items = parseStockLines(text).slice(0, 5000);
    setProduct(guildId, productId, (product) => {
      if (!product.fields[fieldId]) return product;
      product.fields[fieldId].stock = [...(product.fields[fieldId].stock || []), ...items];
      product.fields[fieldId].phantom = null;
      return product;
    });
    await refreshPublicProductPanels(client, guildId, productId);
    try{
      const { sendReestockNotification } = require("../automations");
      const freshProduct = getProduct(guildId, productId);
      const freshField = freshProduct?.fields[fieldId];
      if(freshProduct && freshField) await sendReestockNotification(client, guildId, freshProduct, freshField, items.length).catch(()=>null);
    }catch{}
    await safeUpdate(interaction, panelPayload(stockPanel(client, guildId, ownerId, productId, fieldId)));
    return true;
  }
  if (parts[2] === "qty") {
    const orderId = parts[3];
    const current = getOrder(orderId);
    if (!current || current.status !== "cart") {
      await interaction.reply({ content: "Este carrinho não está mais aberto para alterar quantidade (já pago/cancelado).", flags: MessageFlags.Ephemeral });
      return true;
    }
    const st = require("../../storage").isStoreOpen(current.guildId);
    if (!st.open) {
      await interaction.reply({ content: `Loja fechada: ${st.reason}.`, flags: MessageFlags.Ephemeral });
      return true;
    }
    const available = availableStockQuantity(current?.guildId, current?.productId, current?.fieldId);
    const maxQuantity = available === Infinity ? 99 : Math.max(1, Math.min(Number(available || 1), 99));
    const quantity = Math.max(1, Math.min(Number(interaction.fields.getTextInputValue("quantity")) || 1, maxQuantity));
    const order = setOrder(orderId, (current) => {
      const baseTotal = roundMoney(current.unitPrice * quantity);
      const hasCoupon = current.couponPercent != null;
      return {
        ...current,
        quantity,
        originalTotal: hasCoupon ? baseTotal : undefined,
        total: hasCoupon ? roundMoney(baseTotal * (1 - current.couponPercent / 100)) : baseTotal,
        stockLabel: stockLabelForOrder(current.guildId, current.productId, current.fieldId)
      };
    });
    await interaction.update(cartPanel(client, order));
    return true;
  }
  if (parts[2] === "coupon") {
    const sub = parts[3];
    if (sub === "save") {
      const mode = parts[4];
      const couponId = parts[5];
      const name = interaction.fields.getTextInputValue("name").trim().toUpperCase();
      if (!name) {
        await interaction.reply({ content: "Informe um nome valido para o cupom.", flags: MessageFlags.Ephemeral });
        return true;
      }
      const duplicate = findCouponByCode(guildId, name);
      if (duplicate && duplicate.id !== couponId) {
        await interaction.reply({ content: "Ja existe um cupom com esse nome.", flags: MessageFlags.Ephemeral });
        return true;
      }
      const raw = interaction.fields.getTextInputValue("percent").trim().replace(",", ".").replace("%", "");
      const percent = Math.max(0, Math.min(90, Number(raw)));
      if (!Number.isFinite(percent) || raw === "") {
        await interaction.reply({ content: "Porcentagem invalida. Use um numero de 0 a 90 (100% bloqueado para evitar pedido grátis sem pagamento).", flags: MessageFlags.Ephemeral });
        return true;
      }
      if (percent === 0) {
        await interaction.reply({ content: "Use valor entre 1 e 90%.", flags: MessageFlags.Ephemeral });
        return true;
      }
      const coupon = mode === "edit"
        ? setCoupon(guildId, couponId, (current) => ({ ...current, code: name, percent }))
        : createCoupon(guildId, { code: name, percent });
      await interaction.reply(ephemeralPanel(couponEditPanel(client, guildId, ownerId, coupon.id)));
      return true;
    }
    if (sub === "uses") {
      const couponId = parts[4];
      const raw = interaction.fields.getTextInputValue("quantity").trim();
      const maxUses = raw ? Math.max(1, Math.min(1000000, Math.floor(Number(raw)) || 1)) : null;
      setCoupon(guildId, couponId, (current) => ({ ...current, maxUses }));
      await safeUpdate(interaction, panelPayload(couponUsesPanel(client, guildId, ownerId, couponId)));
      return true;
    }
    if (sub === "validity") {
      const couponId = parts[4];
      const dateRaw = interaction.fields.getTextInputValue("date").trim();
      const timeRaw = interaction.fields.getTextInputValue("time").trim() || "00:00";
      if (!dateRaw) {
        setCoupon(guildId, couponId, (current) => ({ ...current, expiresAt: null }));
        await safeUpdate(interaction, panelPayload(couponEditPanel(client, guildId, ownerId, couponId)));
        return true;
      }
      const dateMatch = dateRaw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      const timeMatch = timeRaw.match(/^(\d{2}):(\d{2})$/);
      if (!dateMatch || !timeMatch) {
        await interaction.reply({ content: "Formato invalido. Use a data como 17/08/2026 e o horario como 12:00.", flags: MessageFlags.Ephemeral });
        return true;
      }
      const [, dd, mm, yyyy] = dateMatch;
      const [, hh, min] = timeMatch;
      if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31 || Number(hh) > 23 || Number(min) > 59) {
        await interaction.reply({ content: "Data ou horario invalido. Use a data como 17/08/2026 e o horario como 12:00.", flags: MessageFlags.Ephemeral });
        return true;
      }
      const expiresAt = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min)).getTime();
      if (!Number.isFinite(expiresAt)) {
        await interaction.reply({ content: "Data ou horario invalido. Use a data como 17/08/2026 e o horario como 12:00.", flags: MessageFlags.Ephemeral });
        return true;
      }
      setCoupon(guildId, couponId, (current) => ({ ...current, expiresAt }));
      await safeUpdate(interaction, panelPayload(couponEditPanel(client, guildId, ownerId, couponId)));
      return true;
    }
    if (sub === "apply") {
      const orderId = parts[4];
      const order = getOrder(orderId);
      if (!order || order.userId !== interaction.user.id) {
        await interaction.reply({ content: "Este carrinho nao pertence a voce.", flags: MessageFlags.Ephemeral });
        return true;
      }
      if (order.status !== "cart") {
        await interaction.reply({ content: "Este carrinho ja nao esta mais aberto para alteracoes.", flags: MessageFlags.Ephemeral });
        return true;
      }
      const code = interaction.fields.getTextInputValue("code").trim();
      const validation = validateCouponForOrder(order.guildId, code, order);
      if (!validation.ok) {
        await interaction.reply({ content: validation.reason, flags: MessageFlags.Ephemeral });
        return true;
      }
      applyCouponUsage(order.guildId, validation.coupon.id, order.userId);
      const baseTotal = roundMoney(order.unitPrice * order.quantity);
      const nextOrder = setOrder(orderId, (current) => ({
        ...current,
        couponId: validation.coupon.id,
        couponCode: validation.coupon.code,
        couponPercent: validation.coupon.percent,
        originalTotal: baseTotal,
        total: roundMoney(baseTotal * (1 - validation.coupon.percent / 100))
      }));
      await interaction.update(cartPanel(client, nextOrder));
      return true;
    }
    return false;
  }
  return false;
}
async function handlePublicSalesInteraction(interaction) {
  const [prefix, action, ...parts] = interaction.customId.split(":");
  if (prefix !== "sales") return false;
  if (await roblox.handleRobloxPublicAction(interaction, action, parts)) return true;
  if (action === "buy") {
    const [guildId, productId] = parts;
    const st = require("../../storage").isStoreOpen(guildId);
    if (!st.open) {
      await interaction.reply({ content: `${componentEmoji(interaction.client, "ban") ? `<:ban:${componentEmoji(interaction.client, "ban").id}> ` : ""}Loja fechada: ${st.reason}.`, flags: MessageFlags.Ephemeral });
      return true;
    }
    if (await require("../oauth2").requireVerified(interaction, "cart")) return true;
    const product = getProduct(guildId, productId);
    if (!product) {
      await interaction.reply({ content: "Produto nao encontrado.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (roblox.isActive(guildId, productId)) {
      return roblox.handleBuyClick(interaction, product, roblox.getProductRoblox(guildId, productId));
    }
    const fields = fieldsList(product);
    if (!fields.length) {
      await interaction.reply({ content: "Este produto ainda nao possui campos.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (fields.length === 1) {
      if (!isFieldAvailable(fields[0])) {
        await interaction.reply({ content: t(guildId, "Este produto esta sem estoque no momento.", "This product is out of stock."), flags: MessageFlags.Ephemeral });
        return true;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try{
        const { thread } = await createCartThread(interaction, product, fields[0]);
        await interaction.editReply({ title: t(guildId, "Carrinho criado", "Cart created"), content: `${thread}` });
      }catch(e){
        await interaction.editReply({ content: e.message }).catch(()=>null);
      }
      return true;
    }
    await interaction.reply(ephemeralPanel(fieldChoicePanel(interaction.client, product)));
    return true;
  }
  if (action === "choosefield") {
    const [guildId, productId] = parts;
    const st2 = require("../../storage").isStoreOpen(guildId);
    if (!st2.open) {
      await interaction.reply({ content: t(guildId, `Loja fechada: ${st2.reason}.`, `Store closed: ${st2.reason}.`), flags: MessageFlags.Ephemeral });
      return true;
    }
    const product = getProduct(guildId, productId);
    const field = product?.fields[interaction.values[0]];
    if (!field) {
      await interaction.reply({ content: t(guildId, "Campo nao encontrado.", "Field not found."), flags: MessageFlags.Ephemeral });
      return true;
    }
    if (!isFieldAvailable(field)) {
      await interaction.reply({ content: t(guildId, "Este campo esta sem estoque no momento.", "This field is out of stock."), flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.deferUpdate();
    try{
      const { thread } = await createCartThread(interaction, product, field);
      await interaction.editReply({
        components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(t(guildId, `Carrinho criado: ${thread}`, `Cart created: ${thread}`)))],
        flags: V2_EPHEMERAL
      });
    }catch(e){
      await interaction.editReply({ content: e.message, flags: V2_EPHEMERAL }).catch(()=>null);
    }
    return true;
  }
  if (action === "qty") {
    await interaction.showModal(quantityModal(parts[0], interaction.user.id));
    return true;
  }
  if (action === "coupon") {
    const order = getOrder(parts[0]);
    if (!order || order.userId !== interaction.user.id) {
      await interaction.reply({ content: "Este carrinho nao pertence a voce.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (order.status !== "cart") {
      await interaction.reply({ content: "Este carrinho ja nao esta mais aberto para alteracoes.", flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.showModal(couponApplyModal(order.id, interaction.user.id));
    return true;
  }
  if (action === "cancel") {
    const order = getOrder(parts[0]);
    if (!order || (order.userId !== interaction.user.id && !hasFullBotAccess(interaction, order.guildId))) {
      await interaction.reply({ content: "Somente o comprador ou owner pode cancelar este pedido.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (order.status === "delivered" || order.status === "manual_delivery") {
      await interaction.reply({ content: "Pedido já entregue não pode ser cancelado.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (order.couponId) {
      try { revertCouponUsage(order.guildId, order.couponId, order.userId); } catch {}
    }
    setOrder(parts[0], (current) => ({ ...current, status: "cancelled" }));
    const cancelCountdown = 15;
    const buildCancelEmbed = (remaining) => cartClosedMessage(
      interaction.client,
      "Pedido cancelado",
      `Pedido **#${parts[0]}** cancelado.\n\nEste carrinho sera fechado automaticamente em **${remaining}s**.`,
      DANGER_COLOR
    );
    await interaction.update(buildCancelEmbed(cancelCountdown));
    if (order.qrMessageId) {
      await interaction.channel?.messages.delete(order.qrMessageId).catch(() => null);
    }
    await sendSalesLog(interaction.client, order.guildId, "cancelledLogs", "Pedido cancelado", `Pedido: \`${order.id}\`\nComprador: <@${order.userId}>\nCancelado por: ${interaction.user}`, DANGER_COLOR);
    scheduleThreadCloseCountdown(interaction, cancelCountdown, buildCancelEmbed, "Pedido cancelado");
    return true;
  }
  if (action === "pay") {
    await sendPaymentMethodPanel(interaction, parts[0]);
    return true;
  }
  if (action === "paymethod") {
    const [method, orderId] = parts;
    if (method === "pix") {
      await sendPaymentPanel(interaction, orderId);
      return true;
    }
    if (method === "saldo") {
      await payWithSaldo(interaction, orderId);
      return true;
    }
    await interaction.reply({ content: "Esta forma de pagamento ainda nao esta disponivel.", flags: MessageFlags.Ephemeral });
    return true;
  }
  if (action === "copypix") {
    const order = getOrder(parts[0]);
    await interaction.reply({ content: `Codigo copia e cola:\n\`${order?.pixPayload || "indisponivel"}\``, flags: MessageFlags.Ephemeral });
    return true;
  }
  if (action === "copydelivered") {
    const order = getOrder(parts[0]);
    if (!order || order.userId !== interaction.user.id) {
      await interaction.reply({ content: "Essa entrega nao pertence a voce.", flags: MessageFlags.Ephemeral }).catch(() => null);
      return true;
    }
    if (order.delivery === "manual" || !order.deliveredItems?.length) {
      await interaction.reply({ content: "A entrega deste pedido e manual. Aguarde o suporte finalizar no carrinho.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const text = order.deliveredItems.join("\n");
    if (text.length > 1800) {
      await interaction.reply({
        files: [{ attachment: Buffer.from(text, "utf8"), name: `produto-${order.id}.txt` }],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }
    await interaction.reply({ content: text, flags: MessageFlags.Ephemeral });
    return true;
  }
  if (action === "confirm") {
    await approveOrder(interaction, parts[0]);
    return true;
  }
  if (action === "verify") {
    await verifyAutomaticPayment(interaction, parts[0]);
    return true;
  }
  if (action === "manualdone") {
    await completeManualOrder(interaction, parts[0]);
    return true;
  }
  if (action === "manualticket") {
    await sendManualOrderToTicket(interaction, parts[0]);
    return true;
  }
  return true;
}
function productModal(userId, mode, productId = "new", product = {}) {
  return new ModalBuilder()
    .setCustomId(`${ids.salesProductModal}:${mode}:${productId}:${userId}`)
    .setTitle(mode === "edit" ? "Editar Produto" : "Criar Produto")
    .addComponents(
      inputRow("name", "Nome do produto", TextInputStyle.Short, true, product.name),
      inputRow("description", "Descricao", TextInputStyle.Paragraph, false, product.description),
      inputRow("banner", "Banner URL", TextInputStyle.Short, false, product.banner)
    );
}
function fieldModal(userId, mode, productId, fieldId = "new", field = {}) {
  return new ModalBuilder()
    .setCustomId(`${ids.salesFieldModal}:${mode}:${productId}:${fieldId}:${userId}`)
    .setTitle(mode === "edit" ? "Editar Campo" : "Criar Campo")
    .addComponents(
      inputRow("name", "Nome do campo", TextInputStyle.Short, true, field.name),
      inputRow("description", "Descricao", TextInputStyle.Paragraph, false, field.description),
      inputRow("price", "Valor", TextInputStyle.Short, true, field.price ? String(field.price).replace(".", ",") : "0,00")
    );
}
function stockAddModal(userId, productId, fieldId) {
  return new ModalBuilder()
    .setCustomId(`${ids.salesStockAddModal}:${productId}:${fieldId}:${userId}`)
    .setTitle("Adicionar Estoque")
    .addComponents(inputRow("items", "Estoque - uma linha por item", TextInputStyle.Paragraph, true, null, 4000));
}
function stockUploadModal(userId, productId, fieldId) {
  const upload = new FileUploadBuilder().setCustomId("file").setRequired(true).setMinValues(1).setMaxValues(1);
  const label = new LabelBuilder()
    .setLabel("Arquivo de estoque")
    .setDescription("Envie um .txt com um estoque por linha.")
    .setFileUploadComponent(upload);
  return new ModalBuilder()
    .setCustomId(`${ids.salesStockUploadModal}:${productId}:${fieldId}:${userId}`)
    .setTitle("Enviar Estoque")
    .addLabelComponents(label);
}
function stockPhantomModal(userId, productId, fieldId) {
  return new ModalBuilder()
    .setCustomId(`${ids.salesStockPhantomModal}:${productId}:${fieldId}:${userId}`)
    .setTitle("Estoque Fantasma")
    .addComponents(
      inputRow("item", "Estoque", TextInputStyle.Paragraph, true),
      inputRow("quantity", "Quantidade ou infinito", TextInputStyle.Short, true, "9999")
    );
}
function quantityModal(orderId, userId) {
  return new ModalBuilder()
    .setCustomId(`modal:sales:qty:${orderId}:${userId}`)
    .setTitle("Editar Quantidade")
    .addComponents(inputRow("quantity", "Quantidade", TextInputStyle.Short, true, "1"));
}
function inputRow(id, label, style, required, value, maxLength) {
  const input = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required);
  if (value) input.setValue(String(value).slice(0, maxLength || 4000));
  if (maxLength) input.setMaxLength(maxLength);
  return new ActionRowBuilder().addComponents(input);
}
function productInput(interaction) {
  return {
    name: interaction.fields.getTextInputValue("name").trim(),
    description: interaction.fields.getTextInputValue("description").trim() || null,
    banner: interaction.fields.getTextInputValue("banner").trim() || null
  };
}
function fieldInput(interaction) {
  return {
    name: interaction.fields.getTextInputValue("name").trim(),
    description: interaction.fields.getTextInputValue("description").trim() || null,
    price: parseBRL(interaction.fields.getTextInputValue("price"))
  };
}
function createOrderFromField(userId, product, field) {
  const guildId = product.guildId;
  const data = guildStore(readSales(guildId));
  const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  data.orders[id] = {
    id,
    guildId: product.guildId,
    userId,
    productId: product.id,
    productName: product.name,
    productDescription: product.description,
    banner: product.banner,
    saleColor: product.saleColor || SALES_COLOR,
    delivery: product.delivery,
    fieldId: field.id,
    fieldName: field.name,
    fieldDescription: field.description,
    unitPrice: Number(field.price || 0),
    quantity: 1,
    total: Number(field.price || 0),
    stockLabel: stockLabel(field),
    status: "cart",
    createdAt: Date.now()
  };
  writeSales(guildId, data);
  return data.orders[id];
}
function listOrders(_guildId) {
  return Object.values(guildStore(readSales(null)).orders);
}
async function createCartThread(interaction, product, field) {
  const activeCarts = listOrders().filter(o=> o.userId===interaction.user.id && ["cart","payment"].includes(o.status)).length;
  if(activeCarts >= 1){
    throw new Error("Você já tem um carrinho aberto. Finalize ou cancele antes de abrir outro. (limite: 1 por pessoa)");
  }
  const order = createOrderFromField(interaction.user.id, product, field);
  const salesConfig = getGuildConfig(product.guildId).sales;
  const thread = await interaction.channel.threads.create({
    name: channelThreadName("Carrinho", interaction.user),
    type: interaction.channel.type === ChannelType.GuildText ? ChannelType.PrivateThread : ChannelType.PublicThread,
    autoArchiveDuration: 60,
    reason: "Carrinho de venda"
  });
  await thread.members.add(interaction.user.id).catch(() => null);
  for (const ownerId of botOwnerIds(interaction.guild)) {
    await thread.members.add(ownerId).catch(() => null);
  }
  setOrder(order.id, (current) => ({ ...current, threadId: thread.id, channelId: interaction.channel.id }));
  await thread.send({
    ...cartPanel(interaction.client, getOrder(order.id)),
    allowedMentions: salesConfig.roles.staff ? { roles: [salesConfig.roles.staff], users: [interaction.user.id] } : undefined
  });
  await sendSalesLog(interaction.client, product.guildId, "privateLogs", "Carrinho criado", `<@${interaction.user.id}> abriu carrinho para **${product.name}**.\nCampo: **${field.name}**\nPedido: \`${order.id}\``, WARN_COLOR);
  return { thread, order: getOrder(order.id) };
}
function getOrder(orderId) {
  const data = guildStore(readSales(null));
  return data.orders[orderId] || null;
}
function setOrder(orderId, updater) {
  const data = guildStore(readSales(null));
  if (!data.orders[orderId]) return null;
  data.orders[orderId] = typeof updater === "function" ? updater(data.orders[orderId]) : updater;
  writeSales(null, data);
  return data.orders[orderId];
}
function getActiveAutoProvider(config) {
  const mp = config.payments.mercadoPago;
  const efi = config.payments.efi;
  const stripe = config.payments.stripe;
  if (isStripeConfigured(stripe)) return "stripe";
  if (mp?.enabled && mp.accessToken) return "mercadopago";
  if (isEfiConfigured(efi)) return "efibank";
  return null;
}
function isEnglishCart(guildId) {
  try {
    const cfg = getGuildConfig(guildId);
    return cfg.payments.stripe.currency === "usd" && isStripeConfigured(cfg.payments.stripe);
  } catch { return false; }
}
function t(guildId, pt, en) { return isEnglishCart(guildId) ? en : pt; }
function fmtMoney(guildId, amount) {
  const isEn = isEnglishCart(guildId);
  const n = Number(amount || 0);
  return isEn ? `$${n.toFixed(2)} USD` : formatBRL(n);
}
async function sendPaymentMethodPanel(interaction, orderId) {
  const order = getOrder(orderId);
  if (!order || order.userId !== interaction.user.id) {
    await interaction.reply({ content: "Pedido nao encontrado.", flags: MessageFlags.Ephemeral });
    return;
  }
  const st = require("../../storage").isStoreOpen(order.guildId);
  if (!st.open) {
    await interaction.reply({ content: `${emojiText(interaction.client, "negativo")} Loja fechada: ${st.reason}.`, flags: MessageFlags.Ephemeral });
    return;
  }
  const config = getGuildConfig(order.guildId);
  const autoProvider = getActiveAutoProvider(config);
  if (!autoProvider && (!config.payments.pix.enabled || !config.payments.pix.key)) {
    await interaction.reply({ content: "Nenhuma forma de pagamento esta configurada em Formas de Pagamento.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (!canFulfillOrder(order)) {
    await interaction.reply({ content: "O estoque desse produto acabou ou nao tem quantidade suficiente. Atualize a quantidade ou escolha outro campo.", flags: MessageFlags.Ephemeral });
    await refreshPublicProductPanels(interaction.client, order.guildId, order.productId);
    return;
  }
  if (Number(order.total||0) < 0.50) {
    await interaction.reply({ content: "Valor mínimo para pagamento é R$ 0,50. Ajuste quantidade/cupom.", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.update(paymentMethodMessage(interaction.client, order));
}
async function sendPaymentPanel(interaction, orderId) {
  const order = getOrder(orderId);
  if (!order || order.userId !== interaction.user.id) {
    await interaction.reply({ content: "Pedido nao encontrado.", flags: MessageFlags.Ephemeral });
    return;
  }
  try {
    if (!interaction.replied && !interaction.deferred) await interaction.deferUpdate();
  } catch {}
  const st2 = require("../../storage").isStoreOpen(order.guildId);
  if (!st2.open) {
    await safeReply(interaction, { content: `${emojiText(interaction.client, "negativo")} Loja fechada: ${st2.reason}.`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (Number(order.total||0) < 0.50) {
    await safeReply(interaction, { content: "Valor mínimo é R$ 0,50.", flags: MessageFlags.Ephemeral });
    return;
  }
  const config = getGuildConfig(order.guildId);
  const autoProvider = getActiveAutoProvider(config);
  if (!autoProvider && (!config.payments.pix.enabled || !config.payments.pix.key)) {
    await safeReply(interaction, { content: "Nenhuma forma de pagamento esta configurada em Formas de Pagamento.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (!canFulfillOrder(order)) {
    await safeReply(interaction, { content: "O estoque desse produto acabou ou nao tem quantidade suficiente. Atualize a quantidade ou escolha outro campo.", flags: MessageFlags.Ephemeral });
    await refreshPublicProductPanels(interaction.client, order.guildId, order.productId);
    return;
  }
  let payload;
  let providerFields = {};
  if (autoProvider === "mercadopago") {
    let payment;
    try {
      payment = await createMpPixPayment({
        accessToken: config.payments.mercadoPago.accessToken,
        amount: order.total,
        description: order.productName,
        payerEmail: config.payments.mercadoPago.payerEmail,
        externalReference: String(order.id)
      });
    } catch (error) {
      await interaction.followUp({ content: `Nao consegui gerar o pagamento no Mercado Pago: ${error.message}`, flags: MessageFlags.Ephemeral });
      return;
    }
    payload = payment.qrCode;
    providerFields = { paymentProvider: "mercadopago", mpPaymentId: payment.id };
  } else if (autoProvider === "efibank") {
    let charge;
    try {
      charge = await createEfiPixCharge({
        efi: config.payments.efi,
        amount: order.total,
        description: order.productName,
        tradeId: order.id
      });
    } catch (error) {
      await interaction.followUp({ content: `Nao consegui gerar o pagamento na Efí Bank: ${error.message}`, flags: MessageFlags.Ephemeral });
      return;
    }
    payload = charge.qrCode;
    providerFields = { paymentProvider: "efibank", efiTxid: charge.txid, efiLocationId: charge.locationId };
  } else if (autoProvider === "stripe") {
    let charge;
    try {
      charge = await createStripePixCharge({
        secretKey: config.payments.stripe.secretKey,
        amount: order.total,
        description: order.productName,
        externalReference: String(order.id),
        currency: config.payments.stripe.currency || "brl"
      });
    } catch (error) {
      await interaction.followUp({ content: t(order.guildId, `Nao consegui gerar o pagamento na Stripe: ${error.message}`, `Failed to create Stripe payment: ${error.message}`), flags: MessageFlags.Ephemeral });
      return;
    }
    payload = charge.qrCode || charge.qrImageUrl || charge.hostedUrl;
    providerFields = { paymentProvider: "stripe", stripePaymentIntentId: charge.id, stripeCurrency: config.payments.stripe.currency || "brl" };
  } else {
    payload = buildPixPayload({
      key: config.payments.pix.key,
      amount: order.total,
      name: "SALES",
      city: "BRASIL",
      txid: `S${String(order.id).slice(-20)}`
    });
    providerFields = { paymentProvider: "pix" };
  }
  if (!payload) {
    await interaction.followUp({ content: "A forma de pagamento nao retornou um codigo Pix valido. Tente novamente ou avise a equipe.", flags: MessageFlags.Ephemeral });
    return;
  }
  setOrder(orderId, (current) => ({ ...current, status: "payment", pixPayload: payload, ...providerFields }));
  await sendSalesLog(interaction.client, order.guildId, "paymentLogs", "Pagamento Pix criado", `Comprador: <@${order.userId}>\nPedido: \`${order.id}\`\nProduto: **${order.productName}**\nValor: ${orderValueSummary(order)}\nForma de pagamento: **${providerLabel(autoProvider)}**`, SALES_COLOR);
  await interaction.editReply(paymentIntroMessage(interaction.client, order));
  const { buildPaymentQr } = require("./qrcode");
  const qrBuffer = await buildPaymentQr(payload, order.guildId);
  const paymentButtons = autoProvider
    ? [
        button(interaction.client, `sales:copypix:${order.id}`, "Codigo copia e cola", ButtonStyle.Secondary, "recibo"),
        button(interaction.client, `sales:verify:${order.id}`, "Verificar pagamento", ButtonStyle.Success, "positivo"),
        button(interaction.client, `sales:cancel:${order.id}`, "Cancelar", ButtonStyle.Danger, "apagar")
      ]
    : [
        button(interaction.client, `sales:copypix:${order.id}`, "Codigo copia e cola", ButtonStyle.Secondary, "recibo"),
        button(interaction.client, `sales:confirm:${order.id}`, "Aprovar pedido", ButtonStyle.Success, "positivo"),
        button(interaction.client, `sales:cancel:${order.id}`, "Cancelar", ButtonStyle.Danger, "apagar")
      ];
  const qrPanel = new ContainerBuilder().setAccentColor(OK_COLOR);
  qrPanel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${emojiText(interaction.client, "pix")}Escaneie para pagar\n### ${orderValueSummary(order)}`
  ));
  try {
    qrPanel.addMediaGalleryComponents(new MediaGalleryBuilder({ items: [{ media: { url: `attachment://pix-${order.id}.png` } }] }));
  } catch {}
  qrPanel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# \`#${order.id}\` • Ou use o código copia e cola abaixo.`));
  const qrMessage = await interaction.followUp({
    components: [qrPanel, new ActionRowBuilder().addComponents(...paymentButtons)],
    flags: V2,
    files: [{ attachment: qrBuffer, name: `pix-${order.id}.png` }],
  });
  setOrder(orderId, (current) => ({ ...current, qrMessageId: qrMessage?.id || null }));
  await sendBuyerDm(interaction.client, order.userId, orderRequestedDm(interaction.client, getOrder(orderId)));
  await sendSalesLog(interaction.client, order.guildId, "orderLogs", "Pedido solicitado", `Comprador: <@${order.userId}>\nPedido: \`${order.id}\`\nProduto: **${order.productName}**\nTotal: ${orderValueSummary(order)}`, WARN_COLOR);
}
async function payWithSaldo(interaction, orderId){
  const order=getOrder(orderId);
  if(!order || order.userId!==interaction.user.id){
    await interaction.reply({ content:"Pedido não encontrado.", flags:MessageFlags.Ephemeral });
    return;
  }
  if(order.status !== "cart"){
    await interaction.reply({ content:"Este carrinho não está mais aberto para pagamento (já pago/cancelado).", flags:MessageFlags.Ephemeral });
    return;
  }
  const st = require("../../storage").isStoreOpen(order.guildId);
  if(!st.open){
    await interaction.reply({ content:`${emojiText(interaction.client,"negativo")} Loja fechada: ${st.reason}.`, flags:MessageFlags.Ephemeral });
    return;
  }
  if(Number(order.total||0) < 0.50){
    await interaction.reply({ content:"Valor mínimo R$0,50.", flags:MessageFlags.Ephemeral });
    return;
  }
  if(!saldoStore.isEnabled()){
    await interaction.reply({ content:"Saldo desativado no momento.", flags:MessageFlags.Ephemeral });
    return;
  }
  if(!canFulfillOrder(order)){
    await interaction.reply({ content:"Estoque insuficiente.", flags:MessageFlags.Ephemeral });
    await refreshPublicProductPanels(interaction.client, order.guildId, order.productId);
    return;
  }
  const lockKey = `saldoPay:${orderId}`;
  if(global._saldoPayLock?.has(lockKey)){
    await interaction.reply({ content:"Pagamento já em processamento, aguarde.", flags:MessageFlags.Ephemeral });
    return;
  }
  global._saldoPayLock ||= new Set();
  global._saldoPayLock.add(lockKey);
  const bal=saldoStore.getBalance(order.userId);
  if(bal < Number(order.total||0)){
    global._saldoPayLock.delete(lockKey);
    await interaction.reply({ content:`Saldo insuficiente. Você tem ${saldoStore.formatBRL(bal)} e precisa de ${saldoStore.formatBRL(order.total)}.`, flags:MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferUpdate();
  let res;
  try{
    res = await saldoStore.deductBalanceAtomic(order.userId, order.total, `Compra ${order.productName} #${orderId.slice(-6)}`, { orderId });
  }catch(e){
    global._saldoPayLock.delete(lockKey);
    await interaction.followUp({ content:`Erro saldo: ${e.message}`, flags:MessageFlags.Ephemeral }).catch(()=>null);
    return;
  }
  if(!res?.ok){
    global._saldoPayLock.delete(lockKey);
    await interaction.followUp({ content: res?.reason || "Falha ao descontar saldo.", flags:MessageFlags.Ephemeral });
    return;
  }
  setOrder(orderId, cur=>({ ...cur, status:"payment", paymentProvider:"saldo", pixPayload: `SALDO:${orderId}`, paidAt: Date.now() }));
  const saldoOkPanel = new ContainerBuilder().setAccentColor(OK_COLOR);
  saldoOkPanel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${emojiText(interaction.client,"carteira")}Pagamento com Saldo`
  ));
  saldoOkPanel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${saldoStore.formatBRL(order.total)} descontado. Novo saldo: \`${saldoStore.formatBRL(res.after)}\`\n-# Liberando seu pedido...`
  ));
  await interaction.editReply({ components: [saldoOkPanel], flags: V2 }).catch(()=>null);
  await sendSalesLog(interaction.client, order.guildId, "paymentLogs", "Pagamento via Saldo", `Comprador: <@${order.userId}>\nPedido: \`${order.id}\`\nValor: ${orderValueSummary(order)}\nSaldo após: ${saldoStore.formatBRL(res.after)}`, SALES_COLOR);
  const fresh=getOrder(orderId);
  const preStatus = fresh?.status;
  await finalizeApproval(interaction, fresh, { approvedLabel:"Saldo", automatic:true });
  const after = getOrder(orderId);
  if(after && after.status==="payment" && preStatus==="payment"){
    try{ await saldoStore.addBalanceAtomic(order.userId, Number(order.total), `Estorno ${order.productName} #${orderId.slice(-6)} (estoque)`, { orderId, refund:true }); await interaction.followUp({ content:`Estoque insuficiente após pagamento. Seu saldo foi estornado: ${saldoStore.formatBRL(order.total)}.`, flags:MessageFlags.Ephemeral }).catch(()=>null); }catch{}
    setOrder(orderId, cur=>({ ...cur, status:"cart" }));
  }
  global._saldoPayLock.delete(lockKey);
}
function providerLabel(autoProvider) {
  if (autoProvider === "mercadopago") return "Mercado Pago (automatico)";
  if (autoProvider === "efibank") return "Efí Bank (automatico)";
  if (autoProvider === "stripe") return "Stripe (automatico)";
  if (autoProvider === "saldo") return "Saldo";
  return "Pix manual";
}
async function approveOrder(interaction, orderId) {
  if (!hasFullBotAccess(interaction, interaction.guildId)) {
    await interaction.reply({ content: "Somente o owner configurado pode aprovar pedidos.", flags: MessageFlags.Ephemeral });
    return;
  }
  const order = getOrder(orderId);
  if (!order || order.status === "delivered") {
    await interaction.reply({ content: "Pedido invalido ou ja entregue.", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferUpdate();
  await finalizeApproval(interaction, order, { approvedLabel: `${interaction.user}` });
}
async function verifyAutomaticPayment(interaction, orderId) {
  const order = getOrder(orderId);
  if (!order || order.status === "delivered") {
    await interaction.reply({ content: "Pedido invalido ou ja entregue.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (order.userId !== interaction.user.id && !hasFullBotAccess(interaction, order.guildId)) {
    await interaction.reply({ content: "Somente o comprador ou owner pode verificar este pedido.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (!order.paymentProvider || order.paymentProvider === "pix") {
    await interaction.reply({ content: "Este pedido usa Pix manual. Aguarde a equipe aprovar o pagamento.", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const config = getGuildConfig(order.guildId);
  let status = "pending";
  try {
    if (order.paymentProvider === "mercadopago") {
      const payment = await getMpPayment({ accessToken: config.payments.mercadoPago.accessToken, paymentId: order.mpPaymentId });
      status = payment.status;
    } else if (order.paymentProvider === "efibank") {
      const charge = await getEfiPixCharge({ efi: config.payments.efi, txid: order.efiTxid, locationId: order.efiLocationId });
      status = charge.status;
    } else if (order.paymentProvider === "stripe") {
      const charge = await getStripePixCharge({ secretKey: config.payments.stripe.secretKey, paymentIntentId: order.stripePaymentIntentId });
      status = charge.status;
    }
  } catch (error) {
    await interaction.editReply({ content: `Nao consegui verificar o pagamento: ${error.message}` });
    return;
  }
  if (status !== "approved") {
    await interaction.editReply({ content: "Pagamento ainda nao identificado. Assim que a cobranca for paga, o pedido e liberado automaticamente." });
    return;
  }
  if (getOrder(orderId)?.status === "delivered") {
    await interaction.editReply({ content: "Pagamento ja confirmado, o pedido foi liberado." });
    return;
  }
  await interaction.editReply({ title: "Pagamento confirmado", content: "Liberando o pedido..." });
  await finalizeApproval(interaction, order, { approvedLabel: "Aprovacao automatica", automatic: true });
}
async function sendPaymentConfirmedLog(client, order, { automatic, approvedLabel }) {
  await sendSalesLog(client, order.guildId, "confirmedLogs",
    automatic ? "Pagamento confirmado automaticamente" : "Pagamento confirmado",
    `${approvedLabel ? `Aprovado por: ${approvedLabel}\n` : ""}Comprador: <@${order.userId}>\n` +
    (order.robloxUsername ? `Usuario Roblox: **${order.robloxUsername}**\n` : "") +
    `Produto: **${order.productName}**\nCarrinho: \`${order.quantity}x ${order.fieldName}\`\n` +
    `Valor: ${orderValueSummary(order)}\nPagamento: **${providerLabel(order.paymentProvider)}**\nPedido: \`${order.id}\``,
    OK_COLOR);
}
async function finalizeApproval(interaction, order, { approvedLabel, automatic = false } = {}) {
  const fresh = getOrder(order.id);
  if (!fresh || ["delivered", "manual_delivery"].includes(fresh.status)) return;
  order = fresh;
  const config = getGuildConfig(order.guildId);
  const salesConfig = config.sales;
  const adminTarget = adminNotifyTarget(config, interaction.guild);
  const buyer = await interaction.client.users.fetch(order.userId).catch(() => null);
  const member = await interaction.guild.members.fetch(order.userId).catch(() => null);
  if (order.delivery === "manual") {
    const delivery = order.isRoblox
      ? roblox.consumeItemsStock(order.guildId, order.productId, (order.robloxItems || []).map((item) => item.key))
      : takeStock(order.guildId, order.productId, order.fieldId, order.quantity);
    if (!delivery.ok) {
      await interaction.followUp({ content: "Estoque insuficiente para aprovar este pedido.", flags: MessageFlags.Ephemeral });
      await refreshPublicProductPanels(interaction.client, order.guildId, order.productId);
      await sendSalesLog(interaction.client, order.guildId, "errorLogs", "Estoque insuficiente", `Pedido: \`${order.id}\`\nProduto: **${order.productName}**\nQuantidade: **${order.quantity}**`, DANGER_COLOR);
      return;
    }
    if (!order.isRoblox) await refreshPublicProductPanels(interaction.client, order.guildId, order.productId);
    const next = setOrder(order.id, (current) => ({ ...current, status: "manual_delivery", approvedAt: Date.now(), approvedBy: automatic ? null : interaction.user.id, consumedItems: delivery.items }));
    if (salesConfig.roles.customer) {
      await member?.roles.add(salesConfig.roles.customer).catch(() => null);
    }
    if (order.isRoblox) {
      if (buyer) {
        await buyer.send(paymentConfirmedDm(interaction.client, next, buyer)).catch(() => null);
      }
      const owners = botOwnerIds(interaction.guild);
      const mention = owners.length ? owners.map((id) => `<@${id}>`).join(" ") : adminTarget.mentions;
      await interaction.message.edit(roblox.buildDeliveryStaffMessage(interaction.client, next, mention, owners.length ? { users: owners } : adminTarget.allowedMentions)).catch(() => null);
      await sendSalesLog(interaction.client, order.guildId, "approvedLogs", automatic ? "Pedido Roblox aprovado automaticamente" : "Pedido Roblox aprovado", `${approvedLabel ? `Aprovado por: ${approvedLabel}\n` : ""}Comprador: <@${order.userId}>\nUsuario Roblox: **${order.robloxUsername || "-"}**\nPedido: \`${order.id}\`\nValor: ${orderValueSummary(order)}\nStatus: aguardando entrega manual dos itens Roblox.`, OK_COLOR);
      await sendPaymentConfirmedLog(interaction.client, next, { automatic, approvedLabel });
      return;
    }
    if (buyer) {
      await buyer.send(paymentConfirmedDm(interaction.client, next, buyer)).catch(() => null);
      await buyer.send(manualDeliveryDm(interaction.client, next, buyer)).catch(() => null);
    }
    await interaction.message.edit(manualDeliveryStaffPanel(interaction.client, next, adminTarget.mentions, adminTarget.allowedMentions)).catch(() => null);
    await interaction.channel?.send({ content: `${adminTarget.mentions} Pedido ${automatic ? "pago e aprovado automaticamente" : "manual aprovado"}. Finalize a entrega pelo painel acima.`, allowedMentions: adminTarget.allowedMentions }).catch(() => null);
    await sendSalesLog(interaction.client, order.guildId, "approvedLogs", automatic ? "Pedido aprovado automaticamente" : "Pedido manual aprovado", `${approvedLabel ? `Aprovado por: ${approvedLabel}\n` : ""}Comprador: <@${order.userId}>\nPedido: \`${order.id}\`\nValor: ${orderValueSummary(order)}\nStatus: aguardando entrega manual.`, OK_COLOR);
    await sendPaymentConfirmedLog(interaction.client, next, { automatic, approvedLabel });
    return;
  }
  const delivery = order.delivery === "automatic"
    ? takeStock(order.guildId, order.productId, order.fieldId, order.quantity)
    : { ok: true, items: [] };
  if (!delivery.ok && order.delivery === "automatic") {
    await interaction.followUp({ content: "Estoque insuficiente para entregar automaticamente.", flags: MessageFlags.Ephemeral });
    await sendSalesLog(interaction.client, order.guildId, "errorLogs", "Estoque insuficiente", `Pedido: \`${order.id}\`\nProduto: **${order.productName}**\nQuantidade: **${order.quantity}**`, DANGER_COLOR);
    return;
  }
  await refreshPublicProductPanels(interaction.client, order.guildId, order.productId);
  const next = setOrder(order.id, (current) => ({ ...current, status: "delivered", deliveredAt: Date.now(), deliveredItems: delivery.items }));
  if (salesConfig.roles.customer) {
    await member?.roles.add(salesConfig.roles.customer).catch(() => null);
  }
  if (buyer) {
    await buyer.send(paymentConfirmedDm(interaction.client, next, buyer)).catch(() => null);
    await buyer.send(await deliveryMessage(interaction.client, next, delivery.items)).catch(() => null);
  }
  await interaction.message.edit(paymentConfirmedStaffMessage(interaction.client, next)).catch(() => null);
  await sendSalesLog(interaction.client, order.guildId, "approvedLogs", automatic ? "Pedido aprovado automaticamente" : "Pedido aprovado", `${approvedLabel ? `Aprovado por: ${approvedLabel}\n` : ""}Comprador: <@${order.userId}>\nPedido: \`${order.id}\`\nValor: ${orderValueSummary(order)}`, OK_COLOR);
  await sendPaymentConfirmedLog(interaction.client, next, { automatic, approvedLabel });
  await sendSalesLog(interaction.client, order.guildId, "deliveredLogs", "Entrega realizada", `Comprador: <@${order.userId}>\nPedido: \`${order.id}\`\nItens: **${order.quantity}**`, OK_COLOR);
  try{ await require("./receipt").sendPurchaseLog(interaction.client, next, purchaseLogButtons(interaction.client, order.guildId, next)); }catch{}
  try{
    const saldo = require("../saldo/store");
    const cb = Number(saldo.getConfig().cashbackPercent||0);
    if(cb>0 && Number(order.total||0)>0){
      const cash = Math.round(Number(order.total)*(cb/100)*100)/100;
      if(cash>0){
        await saldo.addCashbackAtomic(order.userId, cash, `Cashback ${cb}% #${order.id.slice(-6)}`);
        await buyer?.send({ embeds:[new EmbedBuilder().setColor(0x00ff88).setTitle("💸 Cashback creditado!").setDescription(`${saldo.formatBRL(cash)} voltaram para seu saldo (${cb}%). Use com \`/saldo\``).setTimestamp()] }).catch(()=>null);
      }
    }
  }catch{}
  scheduleThreadDelete(interaction.channel, 60_000);
}
function orderRequestedDm(client, order) {
  const panel = new ContainerBuilder().setAccentColor(WARN_COLOR);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${emojiText(client, "pedidoSolicitado")}Pedido solicitado`
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `Seu pedido foi criado e está aguardando a confirmação do pagamento.`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `**Produto:** ${order.productName}\n` +
    `**Carrinho:** \`${order.quantity}x ${order.fieldName}\`\n` +
    `**Valor:** ${orderValueSummary(order)}\n` +
    `**Pedido:** \`#${order.id}\`\n` +
    `**Pagamento:** Pix\n` +
    `**Entrega:** ${order.delivery === "manual" ? "Manual" : "Automática"}`
  ));
  return { components: [panel], flags: V2 };
}
function dmAvatar(buyer) {
  try {
    return buyer?.displayAvatarURL ? buyer.displayAvatarURL({ extension: "png", size: 128 }) : null;
  } catch {
    return null;
  }
}
function dmHeader(panel, client, title, subtitle, buyer) {
  const avatar = dmAvatar(buyer);
  try {
    const section = new SectionBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(title),
      new TextDisplayBuilder().setContent(subtitle)
    );
    if (avatar) section.setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar).setDescription("Avatar"));
    panel.addSectionComponents(section);
  } catch {
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${title}\n${subtitle}`));
  }
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
}
function paymentConfirmedDm(client, order, buyer = null) {
  const panel = new ContainerBuilder().setAccentColor(OK_COLOR);
  dmHeader(
    panel,
    client,
    `## ${emojiText(client, "pedidoRealizado")}Pagamento confirmado`,
    `Seu pagamento de ${orderValueSummary(order)} foi confirmado.`,
    buyer
  );
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `**Produto:** ${order.productName}\n` +
    `**Carrinho:** \`${order.quantity}x ${order.fieldName}\`\n` +
    `**Pagamento:** Pix\n` +
    `**Pedido:** \`#${order.id}\`\n` +
    `**Entrega:** ${order.delivery === "manual" ? "Manual (aguarde o suporte)" : "Automática"}`
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `-# Obrigado pela compra!`
  ));
  return { components: [panel], flags: V2 };
}
function paymentConfirmedStaffMessage(client, order) {
  const panel = new ContainerBuilder().setAccentColor(OK_COLOR);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${emojiText(client, "pedidoRealizado")}Pedido aprovado`
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `<@${order.userId}> • **${order.productName}** • ${orderValueSummary(order)}\n` +
    `-# Entregue no privado do comprador. Fecha em até **1 minuto**.`
  ));
  return { content: null, components: [panel], flags: V2, attachments: [] };
}
function manualDeliveryDm(client, order, buyer = null) {
  const panel = new ContainerBuilder().setAccentColor(WARN_COLOR);
  dmHeader(
    panel,
    client,
    `## ${emojiText(client, "userp")}Entrega manual`,
    `Este produto possui entrega manual. A equipe já foi avisada no carrinho.`,
    buyer
  );
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `**Produto:** ${order.productName}\n` +
    `**Carrinho:** \`${order.quantity}x ${order.fieldName}\`\n` +
    `**Valor pago:** ${orderValueSummary(order)}\n` +
    `**Pedido:** \`#${order.id}\``
  ));
  return { components: [panel], flags: V2 };
}
function feedbackText(order) {
  const feedbackChannel = getGuildConfig(order.guildId).sales.channels.feedbackChannel;
  if (!feedbackChannel) return "Canal de feedbacks ainda nao configurado.";
  return `Avalie sua compra em <#${feedbackChannel}>. Seu feedback ajuda a loja a ficar mais confiavel.`;
}
function manualDeliveryStaffPanel(client, order, adminMention, allowedMentions) {
  const panel = new ContainerBuilder().setAccentColor(WARN_COLOR);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${emojiText(client, "pedidoRealizado")}Entrega manual pendente`
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `Pedido **#${order.id}** aprovado.\n<@${order.userId}> • **${order.productName}** • \`${order.quantity}x ${order.fieldName}\` • ${orderValueSummary(order)}`
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `-# Entregue o produto e clique em **Entrega Concluída**.`
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, `sales:manualdone:${order.id}`, "Entrega Concluida", ButtonStyle.Success, "positivo"),
    button(client, `sales:manualticket:${order.id}`, "Enviar para ticket", ButtonStyle.Secondary, "canal")
  ));
  return {
    content: `${adminMention}`,
    allowedMentions,
    components: [panel],
    flags: V2,
    attachments: []
  };
}
async function deliveryMessage(client, order, items) {
  const productText = items.join("\n");
  const tooLarge = productText.length > 1500 || items.length > 5;
  const panel = new ContainerBuilder().setAccentColor(order.saleColor || SALES_COLOR);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${emojiText(client, "pedidoEntregue")}Entrega Realizada`
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `**Carrinho:** \`${order.quantity}x ${order.fieldName}\`\n` +
    `**Valor pago:** ${orderValueSummary(order)}` +
    (tooLarge
      ? `\n-# Seu produto foi enviado em arquivo para ficar organizado.`
      : `\n**Seu produto:**\n\`\`\`\n${productText}\n\`\`\``)
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Avalie sua compra**\n-# ${feedbackText(order)}`));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    button(client, `sales:copydelivered:${order.id}`, "Copiar produto entregue", ButtonStyle.Primary, "recibo")
  ));
  const payload = { components: [panel], flags: V2 };
  if (tooLarge) {
    payload.files = [{ attachment: Buffer.from(productText, "utf8"), name: `entrega-${order.id}.txt` }];
  }
  return payload;
}
async function completeManualOrder(interaction, orderId) {
  const order = getOrder(orderId);
  if (!order || order.delivery !== "manual") {
    await interaction.reply({ content: "Pedido manual nao encontrado.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (!canUseSalesAdmin(interaction, order.guildId)) {
    await interaction.reply({ content: "Somente o cargo administrador pode concluir esta entrega.", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferUpdate();
  const next = setOrder(order.id, (current) => ({ ...current, status: "delivered", deliveredAt: Date.now(), deliveredBy: interaction.user.id }));
  const buyer = await interaction.client.users.fetch(order.userId).catch(() => null);
  if (buyer) {
    const donePanel = new ContainerBuilder().setAccentColor(OK_COLOR);
    dmHeader(
      donePanel,
      interaction.client,
      `## ${emojiText(interaction.client, "pedidoEntregue")}Pedido concluído`,
      `A equipe marcou sua entrega como concluída.`,
      buyer
    );
    donePanel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `A equipe marcou sua entrega como concluída.`
    ));
    donePanel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
    donePanel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `**Produto:** ${order.productName}\n` +
      `**Valor pago:** ${orderValueSummary(order)}\n` +
      `**Pedido:** \`#${order.id}\``
    ));
    donePanel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `**Avalie sua compra**\n-# ${feedbackText(order)}`
    ));
    await buyer.send({ components: [donePanel], flags: V2 }).catch(() => null);
  }
  const threadDone = new ContainerBuilder().setAccentColor(OK_COLOR);
  threadDone.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${emojiText(interaction.client, "positivo")}Pedido concluído`
  ));
  threadDone.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `Pedido **#${order.id}** concluído pela equipe.\n<@${order.userId}> • ${orderValueSummary(order)}\n-# Este carrinho fecha em até **1 minuto**.`
  ));
  await interaction.message.edit({
    components: [threadDone],
    flags: V2,
    content: null,
    attachments: []
  }).catch(() => null);
  await sendSalesLog(interaction.client, order.guildId, "deliveredLogs", "Entrega manual concluida", `Equipe: ${interaction.user}\nComprador: <@${order.userId}>\nPedido: \`${order.id}\``, OK_COLOR);
  try{ await require("./receipt").sendPurchaseLog(interaction.client, next, purchaseLogButtons(interaction.client, order.guildId, next)); }catch{}
  scheduleThreadDelete(interaction.channel, 60_000);
}
async function sendManualOrderToTicket(interaction, orderId) {
  const order = getOrder(orderId);
  if (!order || order.delivery !== "manual") {
    await interaction.reply({ content: "Pedido manual nao encontrado.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (!canUseSalesAdmin(interaction, order.guildId)) {
    await interaction.reply({ content: "Somente o cargo administrador pode enviar este pedido para ticket.", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.reply({ content: "O sistema de ticket ainda nao esta configurado. O pedido continua neste carrinho.", flags: MessageFlags.Ephemeral });
}
function canUseSalesAdmin(interaction, guildId) {
  if (hasFullBotAccess(interaction, guildId)) return true;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  const adminRole = getGuildConfig(guildId).roles.admin;
  return Boolean(adminRole && interaction.member?.roles?.cache?.has(adminRole));
}
function hasFullBotAccess(interaction, guildId = interaction.guildId) {
  if (botOwnerIds(interaction.guild).includes(interaction.user.id)) return true;
  const permissions = getGuildConfig(guildId).permissions.users || [];
  return permissions.includes(interaction.user.id);
}
function channelThreadName(prefix, user) {
  const username = String(user?.username || "usuario")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w-]/g, "")
    .slice(0, 28) || "usuario";
  return `${prefix}・${username}・${user.id}`.slice(0, 90);
}
function adminNotifyTarget(config, guild) {
  if (config.roles.admin) {
    return {
      mentions: `<@&${config.roles.admin}>`,
      allowedMentions: { roles: [config.roles.admin] }
    };
  }
  const users = botOwnerIds(guild);
  return {
    mentions: users.length ? users.map((id) => `<@${id}>`).join(" ") : "equipe",
    allowedMentions: users.length ? { users } : undefined
  };
}
function scheduleThreadDelete(channel, delayMs) {
  if (!channel?.isThread?.()) return;
  setTimeout(() => {
    channel.delete("Pedido de venda concluido").catch(() => null);
  }, delayMs);
}
function setupCartCleanup(client) {
  const onDelete = async (channel) => {
    try {
      const id = channel?.id;
      if (!id) return;
      const order = listOrders().find((o) => o.threadId === id && ["cart", "payment"].includes(o.status));
      if (!order) return;
      if (order.status === "payment" && order.paymentProvider === "saldo" && Number(order.total) > 0) {
        try {
          await saldoStore.addBalanceAtomic(order.userId, Number(order.total), `Estorno ${order.productName} (carrinho apagado)`, { orderId: order.id, refund: true });
        } catch {}
      }
      setOrder(order.id, (current) => ({ ...current, status: "cancelled", cancelledAt: Date.now(), cancelReason: "canal apagado" }));
      await sendSalesLog(client, order.guildId, "cancelledLogs", "Carrinho apagado", `Pedido: \`${order.id}\`\nComprador: <@${order.userId}>\nO canal foi apagado — pedido cancelado sozinho.`, DANGER_COLOR).catch(() => null);
      try {
        const buyer = await client.users.fetch(order.userId).catch(() => null);
        if (buyer) {
          const panel = container(`Carrinho cancelado`, `Seu carrinho **${order.productName}** foi apagado e o pedido \`#${order.id}\` foi cancelado sozinho.`, DANGER_COLOR);
          await buyer.send({ components: [panel], flags: V2 }).catch(() => null);
        }
      } catch {}
    } catch (e) {
      console.error("[Sales] cleanup carrinho:", e.message);
    }
  };
  client.on(Events.ThreadDelete, onDelete);
  client.on(Events.ChannelDelete, onDelete);
}
function scheduleThreadCloseCountdown(interaction, totalSeconds, buildEmbed, reason = "Pedido cancelado") {
  const channel = interaction.channel;
  if (!channel?.isThread?.()) return;
  let remaining = totalSeconds;
  const interval = setInterval(async () => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(interval);
      await channel.delete(reason).catch(() => null);
      return;
    }
    await interaction.message.edit(buildEmbed(remaining)).catch(() => null);
  }, 1000);
}
function takeStock(guildId, productId, fieldId, quantity) {
  const data = readSales(guildId);
  const field = guildStore(data).products[productId]?.fields[fieldId];
  if (!field) return { ok: false, items: [] };
  if (field.phantom) {
    if (field.phantom.quantity !== "infinite") {
      if (field.phantom.quantity < quantity) return { ok: false, items: [] };
      field.phantom.quantity -= quantity;
    }
    writeSales(guildId, data);
    return { ok: true, items: Array(quantity).fill(field.phantom.item) };
  }
  if ((field.stock || []).length < quantity) return { ok: false, items: [] };
  const items = field.stock.splice(0, quantity);
  writeSales(guildId, data);
  return { ok: true, items };
}
function registerProductPanel(guildId, productId, channelId, messageId) {
  setProduct(guildId, productId, (product) => {
    product.publicPanels ||= [];
    product.publicPanels = product.publicPanels.filter((panel) => panel.messageId !== messageId);
    product.publicPanels.push({ channelId, messageId });
    return product;
  });
}
async function refreshPublicProductPanels(client, guildId, productId) {
  const product = getProduct(guildId, productId);
  if (!product?.publicPanels?.length) return;
  const alivePanels = [];
  for (const panel of product.publicPanels) {
    const channel = await client.channels.fetch(panel.channelId).catch(() => null);
    const message = channel?.isTextBased()
      ? await channel.messages.fetch(panel.messageId).catch(() => null)
      : null;
    if (!message) continue;
    const nextProduct = getProduct(guildId, productId);
    const payload = publicProductPayload(client, nextProduct);
    const edited = await message.edit(payload).then(() => true).catch(() => false);
    if (edited) {
      alivePanels.push(panel);
      continue;
    }
    const newMessage = await channel.send(payload).catch(() => null);
    if (newMessage) {
      await message.delete().catch(() => null);
      alivePanels.push({ channelId: panel.channelId, messageId: newMessage.id });
    }
  }
  setProduct(guildId, productId, (current) => {
    current.publicPanels = alivePanels;
    return current;
  });
}
async function repostPublicProductPanels(client, guildId, productId) {
  const product = getProduct(guildId, productId);
  if (!product?.publicPanels?.length) return { reposted: 0, failed: 0 };
  const alivePanels = [];
  let failed = 0;
  for (const panel of product.publicPanels) {
    const channel = await client.channels.fetch(panel.channelId).catch(() => null);
    if (!channel?.isTextBased?.()) {
      failed += 1;
      continue;
    }
    const oldMessage = await channel.messages.fetch(panel.messageId).catch(() => null);
    if (oldMessage) await oldMessage.delete().catch(() => null);
    const nextProduct = getProduct(guildId, productId);
    const payload = publicProductPayload(client, nextProduct);
    const sent = await channel.send(payload).catch(() => null);
    if (sent) alivePanels.push({ channelId: channel.id, messageId: sent.id });
    else failed += 1;
  }
  setProduct(guildId, productId, (current) => {
    current.publicPanels = alivePanels;
    return current;
  });
  return { reposted: alivePanels.length, failed };
}
function parseStockLines(text) {
  return String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}
function stockCount(field) {
  if (!field) return 0;
  if (field.phantom?.quantity === "infinite") return "infinito";
  if (field.phantom) return field.phantom.quantity;
  return field.stock?.length || 0;
}
function sumStock(fields) {
  if (fields.some((field) => stockCount(field) === "infinito")) return "infinito";
  return fields.reduce((sum, field) => sum + Number(stockCount(field) || 0), 0);
}
function isPaidOrder(order) {
  return ["delivered", "manual_delivery"].includes(order.status) || Boolean(order.deliveredAt || order.approvedAt);
}
function productStats(guildId, productId) {
  const orders = listOrders(guildId).filter((o) => o.productId === productId && isPaidOrder(o));
  return {
    count: orders.length,
    units: orders.reduce((a, o) => a + Number(o.quantity || 0), 0),
    revenue: orders.reduce((a, o) => a + Number(o.total || 0), 0)
  };
}
function fieldStats(guildId, productId, fieldId) {
  const orders = listOrders(guildId).filter((o) => o.productId === productId && o.fieldId === fieldId && isPaidOrder(o));
  const lastAt = orders.reduce((max, o) => Math.max(max, Number(o.deliveredAt || o.approvedAt || o.createdAt || 0)), 0);
  return {
    count: orders.length,
    units: orders.reduce((a, o) => a + Number(o.quantity || 0), 0),
    revenue: orders.reduce((a, o) => a + Number(o.total || 0), 0),
    lastAt: lastAt || null
  };
}
function productSoldOut(product, fields) {
  if (roblox.isActive(product.guildId, product.id)) {
    return !roblox.hasAnyStock(product.guildId, product.id);
  }
  const stock = sumStock(fields);
  return stock !== "infinito" && Number(stock || 0) <= 0;
}
function emojiText(client, name, fallback = "") {
  const found = componentEmoji(client, name);
  if (!found) return fallback;
  return `<${found.animated ? "a" : ""}:${found.name}:${found.id}>`;
}
function stockLabel(field) {
  const count = stockCount(field);
  return count === "infinito" ? "infinito" : String(count);
}
function stockLabelForOrder(guildId, productId, fieldId) {
  const product = getProduct(guildId, productId);
  return stockLabel(product?.fields[fieldId]);
}
function availableStockQuantity(guildId, productId, fieldId) {
  const product = getProduct(guildId, productId);
  const field = product?.fields?.[fieldId];
  if (!field) return 0;
  const count = stockCount(field);
  return count === "infinito" ? Infinity : Number(count || 0);
}
function canFulfillOrder(order) {
  if (!order) return false;
  const available = availableStockQuantity(order.guildId, order.productId, order.fieldId);
  return available === Infinity || Number(available || 0) >= Number(order.quantity || 1);
}
function isFieldAvailable(field) {
  const count = stockCount(field);
  return count === "infinito" || Number(count || 0) > 0;
}
function parseHexColor(value, fallback) {
  const clean = String(value || "").trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return fallback;
  return Number.parseInt(clean, 16);
}
function clampText(value, max, fallback) {
  const text = String(value || "").trim();
  return (text || fallback).slice(0, max);
}
function intToHex(value) {
  return `#${Number(value || SALES_COLOR).toString(16).padStart(6, "0").slice(-6).toUpperCase()}`;
}
function normalizeButtonStyle(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "secondary";
  if (["azul", "blue", "primary"].includes(text)) return "primary";
  if (["cinza", "gray", "grey", "secondary"].includes(text)) return "secondary";
  if (["vermelho", "red", "danger"].includes(text)) return "danger";
  if (["verde", "green", "success"].includes(text)) return "success";
  return "secondary";
}
function buttonStyleFromValue(value) {
  const styles = {
    primary: ButtonStyle.Primary,
    secondary: ButtonStyle.Secondary,
    danger: ButtonStyle.Danger,
    success: ButtonStyle.Success
  };
  return styles[value] || ButtonStyle.Success;
}
function buttonStyleLabel(value) {
  const labels = {
    primary: "azul",
    secondary: "cinza",
    danger: "vermelho",
    success: "verde"
  };
  return labels[value] || "cinza";
}
function todayKey() {
  return new Date().toISOString().slice(0, 10);
}
function canUseAiProductToday(guildId, userId) {
  const store = guildStore(readSales(guildId));
  const usage = store.aiUsage[userId];
  return !usage || usage.date !== todayKey() || Number(usage.count || 0) < 5;
}
function incrementAiProductUsage(guildId, userId) {
  const data = readSales(guildId);
  const store = guildStore(data);
  const date = todayKey();
  const current = store.aiUsage[userId];
  store.aiUsage[userId] = {
    date,
    count: current?.date === date ? Number(current.count || 0) + 1 : 1
  };
  writeSales(guildId, data);
}
function setAiProductDraft(guildId, userId, draft) {
  const data = readSales(guildId);
  guildStore(data).aiProductDrafts[userId] = { ...draft, createdAt: Date.now() };
  writeSales(guildId, data);
}
function getAiProductDraft(guildId, userId) {
  return guildStore(readSales(guildId)).aiProductDrafts[userId] || null;
}
function clearAiProductDraft(guildId, userId) {
  const data = readSales(guildId);
  delete guildStore(data).aiProductDrafts[userId];
  writeSales(guildId, data);
}
function aiErrorPanel(client, userId, message) {
  const panel = container(
    "IA indisponivel",
    `${emojiText(client, "negativo")} Nao consegui gerar o produto agora.\n\n\`${message || "Erro desconhecido"}\``,
    DANGER_COLOR
  );
  panel.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      button(client, scoped(ids.salesAiProductRetry, userId), "Tentar novamente", ButtonStyle.Secondary, "reload"),
      backButton(client, "panel:sales:manage", userId)
    )
  );
  return panel;
}
async function generateAiProduct(userPrompt) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("Configure GROQ_API_KEY no arquivo .env.");
  }
  const compactPrompt = String(userPrompt || "").replace(/\s+/g, " ").trim().slice(0, 240);
  const payload = {
    model: process.env.GROQ_RESEARCH_MODEL || process.env.GROQ_MODEL || "llama-3.1-8b-instant",
    temperature: 0.7,
    max_tokens: 450,
    messages: [
      {
        role: "system",
        content: "PT-BR. Gere produto Discord. JSON puro: name,description,delivery,saleColor,buyButtonStyle,researchNotes. Use markdown, bullets e poucos emojis. delivery automatic/manual. color #RRGGBB. button success/primary/secondary/danger. Nao use banner."
      },
      {
        role: "user",
        content: compactPrompt
      }
    ],
    response_format: { type: "json_object" }
  };
  let data;
  try {
    data = await groqChatCompletion(apiKey, payload);
  } catch (error) {
    const message = String(error.message || "");
    if (!message.includes("response_format") && !message.includes("compound") && !message.includes("413")) {
      throw error;
    }
    data = await groqChatCompletion(apiKey, {
      ...payload,
      model: process.env.GROQ_MODEL || "llama-3.1-8b-instant",
      max_tokens: 300,
      messages: [
        { role: "system", content: "Responda so JSON com name,description,delivery,saleColor,buyButtonStyle,researchNotes. Sem banner." },
        { role: "user", content: compactPrompt.slice(0, 120) }
      ],
      response_format: undefined
    });
  }
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("A IA nao retornou conteudo.");
  let parsed;
  try {
    parsed = JSON.parse(extractJson(content));
  } catch {
    throw new Error("A IA retornou um formato invalido.");
  }
  return normalizeAiProductDraft(parsed);
}
async function groqChatCompletion(apiKey, payload) {
  const body = { ...payload };
  if (!body.response_format) delete body.response_format;
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Groq respondeu ${response.status}: ${text.slice(0, 120)}`);
  }
  return response.json();
}
function extractJson(content) {
  const text = String(content || "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) return text.slice(start, end + 1);
  return text;
}
function normalizeAiProductDraft(input) {
  return {
    name: clampText(input.name, 80, "Produto Gerado"),
    description: clampText(input.description, 1600, "Produto criado automaticamente com IA."),
    banner: null,
    delivery: input.delivery === "manual" ? "manual" : "automatic",
    saleColor: parseHexColor(input.saleColor, SALES_COLOR),
    buyButtonStyle: normalizeButtonStyle(input.buyButtonStyle),
    researchNotes: clampText(input.researchNotes, 180, "")
  };
}
function setGuildSalesConfig(guildId, updater) {
  setGuildConfig(guildId, (config) => {
    config.sales = updater(config.sales);
    return config;
  });
}
function salesChannelLabel(target) {
  const labels = {
    all: "Todas as logs",
    privateLogs: "Logs privados",
    publicLogs: "Logs publicos",
    orderLogs: "Pedidos solicitados",
    paymentLogs: "Pagamentos",
    confirmedLogs: "Pagamentos confirmados",
    approvedLogs: "Compras aprovadas",
    deliveredLogs: "Entregas realizadas",
    cancelledLogs: "Canceladas",
    errorLogs: "Erros",
    cartsCategory: "Categoria carrinhos",
    feedbackChannel: "Feedbacks"
  };
  return labels[target] || "Canal de vendas";
}
async function sendSalesLog(client, guildId, target, title, description, color = SALES_COLOR, meta = {}) {
  const config = getGuildConfig(guildId).sales;
  if (target === "privateLogs" && !config.cartLogsEnabled) return;
  const channelId = config.channels[target] || (target !== "publicLogs" ? config.channels.privateLogs : null);
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const ts = Math.floor(Date.now() / 1000);
  const panel = new ContainerBuilder().setAccentColor(color);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${wIcon(client, "w_cart")}${title}\n${description}`
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `**Sales** · \`${salesChannelLabel(target)}\` · <t:${ts}:F>`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# <t:${ts}:R>`));
  await channel.send({ components: [panel], flags: V2 }).catch(() => null);
}
function wIcon(client, name) {
  try {
    const found = client.appEmojis?.get(name);
    return found ? `<:${found.name}:${found.id}> ` : "";
  } catch {
    return "";
  }
}
function purchaseLogButtons(client, guildId, order) {
  const config = getGuildConfig(guildId).sales;
  const product = getProduct(guildId, order.productId);
  const panel = product?.publicPanels?.[0];
  const buyUrl = panel
    ? `https://discord.com/channels/${guildId}/${panel.channelId}/${panel.messageId}`
    : `https://discord.com/channels/${guildId}`;
  const feedbackUrl = `https://discord.com/channels/${guildId}/${config.channels.feedbackChannel}`;
  return [
    new ActionRowBuilder().addComponents(
      linkButton(client, buyUrl, "Comprar", "carrinhoCancelado"),
      linkButton(client, feedbackUrl, "Feedbacks", "rendimentos")
    )
  ];
}
function logEmojiForTarget(client, target) {
  const names = {
    privateLogs: "visible",
    orderLogs: "pedidoSolicitado",
    paymentLogs: "pix",
    confirmedLogs: "positivo",
    approvedLogs: "pedidoRealizado",
    deliveredLogs: "pedidoEntregue",
    cancelledLogs: "carrinhoCancelado",
    errorLogs: "negativo"
  };
  return emojiText(client, names[target] || "embed");
}
async function sendBuyerDm(client, userId, payload) {
  const user = await client.users.fetch(userId).catch(() => null);
  if (!user) return false;
  return user.send(payload).then(() => true).catch(() => false);
}
function parseBRL(value) {
  const normalized = String(value || "0").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  return roundMoney(Number(normalized) || 0);
}
function formatBRL(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));
}
function orderValueSummary(order) {
  const fmt = (v) => fmtMoney(order?.guildId, v);
  if (order?.couponCode && order.originalTotal && order.originalTotal !== order.total) {
    return `**${fmt(order.total)}** ~~${fmt(order.originalTotal)}~~ (cupom \`${order.couponCode}\` -${order.couponPercent}%)`;
  }
  return `**${fmt(order?.total)}**`;
}
function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
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
    .slice(0, max)
    .trim() || "PIX";
}
function crc16(payload) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j += 1) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}
module.exports = {
  salesRootPanel,
  salesManagePanel,
  handleSalesInteraction,
  handleSalesPanelComponent,
  handleSalesModal,
  getProduct,
  setProduct,
  productsList,
  fieldsList,
  takeStock,
  getOrder,
  setOrder,
  listOrders,
  createCartThread,
  refreshPublicProductPanels,
  repostPublicProductPanels,
  sendSalesLog,
  canUseSalesAdmin,
  botOwnerIds,
  scheduleThreadDelete,
  setupCartCleanup,
  OK_COLOR,
  WARN_COLOR,
  DANGER_COLOR,
  SALES_COLOR
};
