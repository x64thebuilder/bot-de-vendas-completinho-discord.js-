const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, EmbedBuilder, MessageFlags, ModalBuilder, PermissionFlagsBits, SeparatorBuilder, StringSelectMenuBuilder, TextDisplayBuilder, TextInputBuilder, TextInputStyle, ChannelType, ChannelSelectMenuBuilder, ThumbnailBuilder, SectionBuilder, MediaGalleryBuilder
} = require("discord.js");
const QRCode = require("qrcode");
const { ids } = require("../../config");
const { getGuildConfig, setGuildConfig } = require("../../storage");
const vorkbuxStore = require("./store");
const { vorkbuxMainPanel, vorkbuxProductsPanel, vorkbuxGroupPanel, vorkbuxEditProductListPanel, vorkbuxProductDetailPanel, vorkbuxFieldDetailPanel, vorkbuxPurchasePanel, vorkbuxPurchaseChannelPicker, buildPublicPanel, getVorkbuxFlag, setVorkbuxFlag } = require("./panel");
const { componentEmoji, scoped, inlineEmoji } = require("../panel");
const { lookupRobloxUser } = require("../roblox/robloxApi");
const { getGuildFile, readGuildFile, writeGuildFile } = require("../../guildDb");
const { isEfiConfigured, createEfiPixCharge, getEfiPixCharge } = require("../payments/efibank");
const { createPixPayment: createMpPixPayment, getPayment: getMpPayment } = require("../payments/mercadopago");
const { isStripeConfigured, createPixCharge: createStripePixCharge, getPixCharge: getStripePixCharge } = require("../payments/stripe");
const V2 = MessageFlags.IsComponentsV2;
const V2_EPH = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
function payload(c){ return { components:[c], flags:V2 } }
function ephemeral(c){ return { components:[c], flags:V2_EPH } }
function withEmoji(b, client, name){ const e=client.appEmojis?.get(require("../../emojis").normalizeEmojiName(name)); return e? b.setEmoji({id:e.id,name:e.name,animated:e.animated}):b; }
function parseBRL(v){ const n = String(v||"").replace(/[^\d,.-]/g,"").replace(/\./g,"").replace(",","."); return Math.round((Number(n)||0)*100)/100; }
function code(v){ return `\`${v}\``; }
const vorkbuxCooldown = new Map();
async function alertLowStock(client, guildId){
  const cfg=getGuildConfig(guildId);
  const stock=cfg.vorkbux.group.stock;
  if(stock!=null && stock<1000){
    const ownerId=cfg.botOwnerId;
    if(ownerId){
      client.users.fetch(ownerId).then(u=> u.send(`⚠️ **SyncBuxx estoque baixo:** ${stock} Robux restantes em **${client.guilds.cache.get(guildId)?.name||guildId}**. Reponha urgente!`).catch(()=>null)).catch(()=>null);
    }
    sendVorkbuxLog(client, guildId, "errorLogs", "Estoque Baixo — SyncBuxx", `Estoque grupo: **${stock} Robux** — reponha em Produtos → Configurar grupo`, 0xe74c3c);
  }
}
async function createVorkbuxPayment(guildId, order){
  const cfg=getGuildConfig(guildId);
  const amount=Number(order.total);
  const desc=`SyncBuxx ${order.quantity} Robux • ${order.robloxUsername||order.userId} • #${order.id.slice(-6)}`;
  const ref=`vorkbux-${order.id}`;
  if(cfg.payments.stripe?.enabled && isStripeConfigured(cfg.payments.stripe)){
    try{
      const res=await createStripePixCharge({ secretKey: cfg.payments.stripe.secretKey, amount, description: desc, externalReference: ref, currency: cfg.payments.stripe.currency||"brl" });
      const payload = res?.qrCode || res?.qrCodeBase64 || res?.hostedUrl || null;
      if(payload) return { provider:"stripe", copyPaste: payload, qr: res?.qrCodeBase64 || res?.qrImageUrl || payload, id: res?.id||ref };
    } catch(e){ console.warn("[SyncBuxx Stripe] "+e.message); }
  }
  if(cfg.payments.efi?.enabled && isEfiConfigured(cfg.payments.efi)){
    try{
      const res=await createEfiPixCharge({ efi: cfg.payments.efi, amount, description: desc, tradeId: ref });
      const payload = res?.qrCode || res?.qrCodeBase64 || null;
      if(payload) return { provider:"efi", copyPaste: payload, qr: res?.qrCodeBase64 || res?.qrCode || null, id: res?.txid||ref };
    } catch(e){ console.warn("[SyncBuxx EFI] "+e.message); }
  }
  if(cfg.payments.mercadoPago?.enabled && cfg.payments.mercadoPago.accessToken){
    try{
      const res=await createMpPixPayment({ accessToken: cfg.payments.mercadoPago.accessToken, amount, description: desc, payerEmail: cfg.payments.mercadoPago.payerEmail||"comprador@example.com", externalReference: ref });
      const payload = res?.qrCode || res?.qrCodeBase64 || res?.ticketUrl || null;
      if(payload) return { provider:"mercadopago", copyPaste: payload, qr: res?.qrCodeBase64 || null, id: res?.id||ref };
    } catch(e){ console.warn("[SyncBuxx MP] "+e.message); }
  }
  const pixKey=cfg.payments.pix.key||"pix@exemplo.com";
  const fallbackCode=buildManualPixPayload({ key: pixKey, amount, txid: `VB${String(ref).slice(-20)}` });
  return { provider:"manual", copyPaste: fallbackCode, qr: null, id: ref };
}
function buildManualPixPayload({ key, amount, txid }){
  const merchantAccount = emvPix("00", "br.gov.bcb.pix") + emvPix("01", key);
  const base = [emvPix("00","01"), emvPix("26",merchantAccount), emvPix("52","0000"), emvPix("53","986"), amount ? emvPix("54", Number(amount).toFixed(2)) : "", emvPix("58","BR"), emvPix("59","SYNCBUXX"), emvPix("60","BRASIL"), emvPix("62", emvPix("05", String(txid||"SYNCBUXX").slice(0,25)))].join("");
  const withoutCrc = `${base}6304`;
  return `${withoutCrc}${crc16Pix(withoutCrc)}`;
}
function emvPix(id, value){ const v=String(value); return `${id}${String(v.length).padStart(2,"0")}${v}`; }
function crc16Pix(payload){ let crc=0xffff; for(const ch of payload){ crc ^= ch.charCodeAt(0) << 8; for(let i=0;i<8;i++) crc = crc & 0x8000 ? (crc<<1)^0x1021 : crc<<1, crc&=0xffff; } return crc.toString(16).toUpperCase().padStart(4,"0"); }
async function verifyVorkbuxPayment(guildId, order){
  const cfg=getGuildConfig(guildId);
  const prov=order.paymentProvider;
  try{
    if(prov==="stripe") {
      const charge=await getStripePixCharge({ secretKey: cfg.payments.stripe.secretKey, paymentIntentId: order.paymentId });
      return charge?.status==="approved";
    }
    if(prov==="efi") {
      const charge=await getEfiPixCharge({ efi: cfg.payments.efi, txid: order.paymentId });
      return charge?.status==="approved";
    }
    if(prov==="mercadopago") {
      const payment=await getMpPayment({ accessToken: cfg.payments.mercadoPago.accessToken, paymentId: order.paymentId });
      return payment?.status==="approved";
    }
  } catch(e){ console.warn("[SyncBuxx verify] "+e.message); }
  return false;
}
async function handleVorkbuxPanelComponent(interaction, baseId){
  const client = interaction.client;
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  if(baseId===ids.vorkbuxEntry){
    await interaction.update(payload(vorkbuxMainPanel(client, guildId, userId)));
    return true;
  }
  if(baseId===ids.vorkbuxModeSelect){
    const val = interaction.values?.[0];
    if(val==="toggle_robux"){ setVorkbuxFlag(guildId,"robux", !getVorkbuxFlag(guildId,"robux")); }
    if(val==="toggle_gamepass"){ setVorkbuxFlag(guildId,"gamepass", !getVorkbuxFlag(guildId,"gamepass")); }
    await interaction.update(payload(vorkbuxMainPanel(client, guildId, userId)));
    return true;
  }
  if(baseId===ids.vorkbuxProducts){
    await interaction.update(payload(vorkbuxProductsPanel(client, guildId, userId)));
    return true;
  }
  if(baseId===ids.vorkbuxProductsSelect){
    const v = interaction.values[0];
    if(v==="price"){
      await interaction.showModal(new ModalBuilder()
        .setCustomId(`${ids.vorkbuxPriceModal}:${userId}`)
        .setTitle("Valor de 1000 Robux")
        .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("price").setLabel("Valor em R$ (ex: 30,00)").setStyle(TextInputStyle.Short).setRequired(true).setValue(String(getGuildConfig(guildId).vorkbux.pricePer1000||"").replace(".",",")))))
      return true;
    }
    if(v==="limits"){
      await interaction.showModal(new ModalBuilder()
        .setCustomId(`${ids.vorkbuxMinModal}:${userId}`)
        .setTitle("Mínimo de Robux")
        .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("min").setLabel("Mínimo de Robux").setStyle(TextInputStyle.Short).setRequired(true).setValue(String(getGuildConfig(guildId).vorkbux.minRobux)))))
      return true;
    }
    if(v==="group"){
      await interaction.update(payload(vorkbuxGroupPanel(client, guildId, userId)));
      return true;
    }
  }
  if(baseId.startsWith(ids.vorkbuxGroupPanel)){
    const action = baseId.split(":").pop();
    if(action==="config"){
      await interaction.showModal(new ModalBuilder()
        .setCustomId(`${ids.vorkbuxGroupModal}:url:${userId}`)
        .setTitle("Grupo Roblox - URL")
        .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("url").setLabel("URL do grupo Roblox").setStyle(TextInputStyle.Short).setRequired(true).setValue(getGuildConfig(guildId).vorkbux.group.url||"").setPlaceholder("https://www.roblox.com/groups/..."))))
      return true;
    }
    if(action==="stock"){
      await interaction.showModal(new ModalBuilder()
        .setCustomId(`${ids.vorkbuxStockModal}:${userId}`)
        .setTitle("Estoque do Grupo")
        .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("stock").setLabel("Estoque atual em Robux").setStyle(TextInputStyle.Short).setRequired(true).setValue(String(getGuildConfig(guildId).vorkbux.group.stock||0)))))
      return true;
    }
  }
  if(baseId===ids.vorkbuxCreateProduct){
    await interaction.showModal(new ModalBuilder()
      .setCustomId(`${ids.vorkbuxCreateProductModal}:step1:${userId}`)
      .setTitle("Criar Produto — Nome")
      .addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("name").setLabel("Nome do jogo (ex: Blox Fruits)").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("Blox Fruits").setMaxLength(80))
      ))
    return true;
  }
  if(baseId===ids.vorkbuxEditProduct){
    await interaction.update(payload(vorkbuxEditProductListPanel(client, guildId, userId)));
    return true;
  }
  if(baseId===ids.vorkbuxEditSelect){
    const pid = interaction.values[0];
    await interaction.update(payload(vorkbuxProductDetailPanel(client, guildId, userId, pid)));
    return true;
  }
  if(baseId.startsWith(ids.vorkbuxFieldCreate)){
    const pid = baseId.split(":").pop();
    await interaction.showModal(new ModalBuilder()
      .setCustomId(`${ids.vorkbuxFieldModal}:step1:${pid}:${userId}`)
      .setTitle("Adicionar Item — Nome")
      .addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("name").setLabel("Nome do item (ex: Fruta Mítica)").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("Fruta Mítica").setMaxLength(80))
      ))
    return true;
  }
  if(baseId.startsWith(ids.vorkbuxFieldSelect)){
    const pid = baseId.split(":").pop();
    const fid = interaction.values[0];
    await interaction.update(payload(vorkbuxFieldDetailPanel(client, guildId, userId, pid, fid)));
    return true;
  }
  if(baseId.startsWith(ids.vorkbuxFieldAction)){
    const parts = baseId.split(":");
    const action = parts[3]; 
    const pid = parts[4]; const fid = parts[5];
    if(action==="name"){
      const f=vorkbuxStore.getField(pid,fid);
      await interaction.showModal(new ModalBuilder().setCustomId(`${ids.vorkbuxFieldNameModal}:${pid}:${fid}:${userId}`).setTitle("Mudar nome").addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("name").setLabel("Novo nome").setStyle(TextInputStyle.Short).setRequired(true).setValue(f?.name||""))));
    } else if(action==="price"){
      const f=vorkbuxStore.getField(pid,fid);
      await interaction.showModal(new ModalBuilder().setCustomId(`${ids.vorkbuxFieldPriceModal}:${pid}:${fid}:${userId}`).setTitle("Mudar preço").addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("price").setLabel("Novo preço em R$").setStyle(TextInputStyle.Short).setRequired(true).setValue(String(f?.price||0).replace(".",",")))));
    }
    return true;
  }
  if(baseId.startsWith(ids.vorkbuxFieldStockToggle)){
    const pid = baseId.split(":")[3]; const fid = baseId.split(":")[4];
    const f=vorkbuxStore.getField(pid,fid);
    vorkbuxStore.setField(pid,fid, cur=>({ ...cur, infinite: !cur.infinite }));
    await interaction.update(payload(vorkbuxFieldDetailPanel(client, guildId, userId, pid, fid)));
    return true;
  }
  if(baseId.startsWith(ids.vorkbuxFieldQuantity)){
    const pid = baseId.split(":")[3]; const fid = baseId.split(":")[4];
    const f=vorkbuxStore.getField(pid,fid);
    if(f?.infinite){ await interaction.reply({ content:"Desative o estoque infinito primeiro.", flags: MessageFlags.Ephemeral }); return true; }
    await interaction.showModal(new ModalBuilder().setCustomId(`${ids.vorkbuxFieldStockModal}:${pid}:${fid}:${userId}`).setTitle("Mudar quantidade").addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("stock").setLabel("Quantidade (número)").setStyle(TextInputStyle.Short).setRequired(true).setValue(String(f?.stock||0)))));
    return true;
  }
  if(baseId.startsWith(ids.vorkbuxFieldDelete)){
    const pid = baseId.split(":")[3]; const fid = baseId.split(":")[4];
    vorkbuxStore.deleteField(pid,fid);
    await interaction.update(payload(vorkbuxProductDetailPanel(client, guildId, userId, pid)));
    return true;
  }
  if(baseId.startsWith(ids.vorkbuxDeleteProduct)){
    const pid = baseId.split(":").pop();
    const panel = new ContainerBuilder().setAccentColor(0xe74c3c);
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"ban")} Deletar produto\nTem certeza que deseja apagar **${vorkbuxStore.getProduct(pid)?.name||"este produto"}**?`));
    panel.addSeparatorComponents(new SeparatorBuilder());
    panel.addActionRowComponents(new ActionRowBuilder().addComponents(
      withEmoji(new ButtonBuilder().setCustomId(scoped(`${ids.vorkbuxDeleteConfirm}:yes:${pid}`,userId)).setLabel("Sim, deletar").setStyle(ButtonStyle.Danger), client, "apagar"),
      withEmoji(new ButtonBuilder().setCustomId(scoped(`${ids.vorkbuxDeleteConfirm}:no:${pid}`,userId)).setLabel("Cancelar").setStyle(ButtonStyle.Secondary), client, "negativo")
    ));
    await interaction.update(payload(panel));
    return true;
  }
  if(baseId.startsWith(ids.vorkbuxDeleteConfirm)){
    const parts = baseId.split(":");
    const ans = parts[3]; const pid = parts[4];
    if(ans==="yes"){ vorkbuxStore.deleteProduct(pid); }
    await interaction.update(payload(vorkbuxEditProductListPanel(client, guildId, userId)));
    return true;
  }
  if(baseId.startsWith(`${ids.vorkbuxEditSelect}:back`)){
    const pid = baseId.split(":").pop();
    await interaction.update(payload(vorkbuxProductDetailPanel(client, guildId, userId, pid)));
    return true;
  }
  if(baseId===ids.vorkbuxPurchase){
    await interaction.update(payload(vorkbuxPurchasePanel(client, guildId, userId)));
    return true;
  }
  if(baseId===ids.vorkbuxPurchaseModeSelect){
    const mode = interaction.values[0];
    setGuildConfig(guildId, c=>{ c.vorkbux.purchase.mode = mode; return c; });
    await interaction.update(payload(vorkbuxPurchasePanel(client, guildId, userId)));
    return true;
  }
  if(baseId==="vorkbux:purchase:edittext"){
    const cfg=getGuildConfig(guildId).vorkbux.purchase;
    await interaction.showModal(new ModalBuilder().setCustomId(`${ids.vorkbuxPurchaseTextModal}:${userId}`).setTitle("Editar Texto").addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("title").setLabel("Título").setStyle(TextInputStyle.Short).setRequired(false).setValue(cfg.title||"").setMaxLength(120)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("desc").setLabel("Descrição").setStyle(TextInputStyle.Paragraph).setRequired(false).setValue(cfg.description||"").setMaxLength(1500))
    ));
    return true;
  }
  if(baseId==="vorkbux:purchase:visual"){
    const cfg=getGuildConfig(guildId).vorkbux.purchase;
    await interaction.showModal(new ModalBuilder().setCustomId(`${ids.vorkbuxPurchaseVisualModal}:${userId}`).setTitle("Personalizar Visual").addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("color").setLabel("Cor hexadecimal").setStyle(TextInputStyle.Short).setRequired(false).setValue(cfg.color? `#${cfg.color.toString(16).padStart(6,"0").toUpperCase()}`:"").setPlaceholder("#ffffff")),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("banner").setLabel("Banner (URL)").setStyle(TextInputStyle.Short).setRequired(false).setValue(cfg.banner||"")),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("thumb").setLabel("Thumbnail (URL)").setStyle(TextInputStyle.Short).setRequired(false).setValue(cfg.thumbnail||""))
    ));
    return true;
  }
  if(baseId==="vorkbux:purchase:channel"){
    await interaction.update(payload(vorkbuxPurchaseChannelPicker(client, userId)));
    return true;
  }
  if(baseId===ids.vorkbuxPurchaseChannelSelect){
    try{
      const channelId = interaction.values?.[0] || interaction.channels?.first()?.id;
      if(!channelId || !/^\d{15,25}$/.test(String(channelId))){
        await interaction.reply({ content:"Selecione um canal válido.", flags: MessageFlags.Ephemeral }); return true;
      }
      const ch = await client.channels.fetch(channelId).catch(()=>null);
      if(!ch?.isTextBased()){
        await interaction.reply({ content:"Canal inválido. Escolha um canal de texto.", flags: MessageFlags.Ephemeral }); return true;
      }
      setGuildConfig(guildId, c=>{ c.vorkbux.purchase.channelId = channelId; return c; });
      sendVorkbuxLog(client, guildId, "privateLogs", "Canal SyncBuxx Definido", `Canal de compra definido para <#${channelId}> por <@${userId}>`, 0x3498db);
      await interaction.update(payload(vorkbuxPurchasePanel(client, guildId, userId)));
    } catch(e){
      console.error("[SyncBuxx channel select]", e);
      if(!interaction.replied && !interaction.deferred) await interaction.reply({ content:`Erro ao definir canal: ${e.message}`, flags: MessageFlags.Ephemeral }).catch(()=>null);
      else await interaction.followUp({ content:`Erro: ${e.message}`, flags: MessageFlags.Ephemeral }).catch(()=>null);
    }
    return true;
  }
  if(baseId==="vorkbux:purchase:addid"){
    await interaction.showModal(new ModalBuilder().setCustomId(`${ids.vorkbuxPurchaseChannelIdModal}:${userId}`).setTitle("ID do Canal").addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("cid").setLabel("ID do canal").setStyle(TextInputStyle.Short).setRequired(true))));
    return true;
  }
  if(baseId===ids.vorkbuxPurchasePreview){
    const pub = buildPublicPanel(client, guildId);
    await interaction.reply({ ...pub, flags: MessageFlags.Ephemeral | (pub.flags||0) });
    return true;
  }
  if(baseId===ids.vorkbuxPurchaseSend){
    const cfg=getGuildConfig(guildId).vorkbux.purchase;
    if(!cfg.title){ await interaction.reply({ content:"Configure pelo menos o **título** em Mensagem de Compra antes de enviar.", flags: MessageFlags.Ephemeral }); return true; }
    if(!getVorkbuxFlag(guildId,"robux") && !getVorkbuxFlag(guildId,"gamepass")){ await interaction.reply({ content:"Ative **Robux** ou **Gamepass** em SyncBuxx antes de enviar.", flags: MessageFlags.Ephemeral }); return true; }
    if(!cfg.channelId){ await interaction.reply({ content:"Defina o **canal** em Mensagem de Compra.", flags: MessageFlags.Ephemeral }); return true; }
    const channel = await client.channels.fetch(cfg.channelId).catch(()=>null);
    if(!channel?.isTextBased()){ await interaction.reply({ content:"Canal inválido.", flags: MessageFlags.Ephemeral }); return true; }
    const pub = buildPublicPanel(client, guildId);
    await channel.send(pub);
    sendVorkbuxLog(client, guildId, "privateLogs", "Painel SyncBuxx Enviado", `Painel público enviado em <#${cfg.channelId}> por <@${userId}>\nModo ${code(cfg.mode)} • Título ${code(cfg.title?.slice(0,30)||"-")}`, 0x2ecc71, { thumbnail: client.user.displayAvatarURL() });
    await interaction.reply({ content:`Painel enviado em <#${cfg.channelId}>`, flags: MessageFlags.Ephemeral });
    return true;
  }
  if(baseId==="vorkbux:stats"){
    const { vorkbuxStatsPanel } = require("./panel");
    await interaction.update(payload(vorkbuxStatsPanel(client, guildId, userId)));
    return true;
  }
  if(baseId==="vorkbux:orders"){
    const { vorkbuxOrdersPanel } = require("./panel");
    await interaction.update(payload(vorkbuxOrdersPanel(client, guildId, userId)));
    return true;
  }
  return false;
}
async function handleVorkbuxModal(interaction){
  const id = interaction.customId;
  const userId = interaction.user.id;
  const guildId = interaction.guildId;
  if(id.startsWith(ids.vorkbuxPriceModal)){
    const price = parseBRL(interaction.fields.getTextInputValue("price"));
    setGuildConfig(guildId, c=>{ c.vorkbux.pricePer1000 = price; return c; });
    sendVorkbuxLog(interaction.client, guildId, "privateLogs", "Preço SyncBuxx Atualizado", `Novo valor **${vorkbuxStore.formatBRL(price)}** / 1000 Robux por <@${userId}>`, 0x3498db);
    await interaction.update(payload(vorkbuxProductsPanel(interaction.client, guildId, userId)));
    return true;
  }
  if(id.startsWith(ids.vorkbuxMinModal)){
    const min = parseInt(interaction.fields.getTextInputValue("min"),10);
    if(!Number.isFinite(min) || min<1){ await interaction.reply({ content:"Valor mínimo inválido.", flags: MessageFlags.Ephemeral }); return true; }
    setGuildConfig(guildId, c=>{ c.vorkbux.minRobux = min; return c; });
    await interaction.reply({ content:`Mínimo definido para **${min}** Robux. Agora configure o máximo.`, flags: MessageFlags.Ephemeral });
    await interaction.followUp({ content:"Configure o máximo:", components:[new ActionRowBuilder().addComponents(withEmoji(new ButtonBuilder().setCustomId(scoped("vorkbux:open:max",userId)).setLabel("Configurar Máximo").setStyle(ButtonStyle.Primary), interaction.client,"editar"))], flags: MessageFlags.Ephemeral }).catch(()=>null);
    return true;
  }
  if(id.startsWith(ids.vorkbuxMaxModal)){
    const max = parseInt(interaction.fields.getTextInputValue("max"),10);
    if(!Number.isFinite(max) || max<1){ await interaction.reply({ content:"Valor máximo inválido.", flags: MessageFlags.Ephemeral }); return true; }
    setGuildConfig(guildId, c=>{ c.vorkbux.maxRobux = max; return c; });
    await interaction.update(payload(vorkbuxProductsPanel(interaction.client, guildId, userId)));
    return true;
  }
  if(id.startsWith(ids.vorkbuxGroupModal)){
    const url = interaction.fields.getTextInputValue("url").trim();
    if(!/^https?:\/\/.+/i.test(url)){ await interaction.reply({ content:"URL inválida.", flags: MessageFlags.Ephemeral }); return true; }
    setGuildConfig(guildId, c=>{ c.vorkbux.group.url = url; return c; });
    await interaction.showModal(new ModalBuilder().setCustomId(`${ids.vorkbuxGroupModal}:price:${userId}`).setTitle("Preço via Grupo").addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("price").setLabel("Preço por 1000 Robux via grupo R$").setStyle(TextInputStyle.Short).setRequired(true).setValue(String(getGuildConfig(guildId).vorkbux.group.pricePer1000||"").replace(".",",")))));
    return true;
  }
  if(id.startsWith(`${ids.vorkbuxGroupModal}:price`)){
    const price = parseBRL(interaction.fields.getTextInputValue("price"));
    setGuildConfig(guildId, c=>{ c.vorkbux.group.pricePer1000 = price; return c; });
    await interaction.update(payload(vorkbuxGroupPanel(interaction.client, guildId, userId)));
    return true;
  }
  if(id.startsWith(ids.vorkbuxStockModal) && !id.includes(":field")){
    const stock = parseInt(interaction.fields.getTextInputValue("stock"),10);
    if(!Number.isFinite(stock) || stock<0){ await interaction.reply({ content:"Estoque inválido.", flags: MessageFlags.Ephemeral }); return true; }
    setGuildConfig(guildId, c=>{ c.vorkbux.group.stock = stock; return c; });
    sendVorkbuxLog(interaction.client, guildId, "privateLogs", "Estoque Grupo Atualizado", `Novo estoque **${stock} Robux** definido por <@${userId}>`, 0x3498db);
    await interaction.update(payload(vorkbuxGroupPanel(interaction.client, guildId, userId)));
    alertLowStock(interaction.client, guildId).catch(()=>null);
    return true;
  }
  if(id.startsWith(ids.vorkbuxCreateProductModal)){
    if(id.includes(":step1:")){
      const name = interaction.fields.getTextInputValue("name").trim();
      if(!name){ await interaction.reply({ content:"Nome obrigatório.", flags: MessageFlags.Ephemeral }); return true; }
      vorkbuxStore.setDraft(userId, { type:"createProduct", name });
      await interaction.showModal(new ModalBuilder()
        .setCustomId(`${ids.vorkbuxCreateProductModal}:step2:${userId}`)
        .setTitle("Criar Produto — Emoji")
        .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("emoji").setLabel("Emoji (opcional)").setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder("Cole emoji padrão 😀 ou :robux: ou deixe vazio").setMaxLength(30)))
      );
      return true;
    }
    if(id.includes(":step2:")){
      const draft = vorkbuxStore.getDraft(userId);
      const emoji = interaction.fields.getTextInputValue("emoji").trim();
      const name = draft?.name || "Produto";
      vorkbuxStore.clearDraft(userId);
      const p=vorkbuxStore.createProduct({ name, emoji: emoji||null });
      sendVorkbuxLog(interaction.client, guildId, "privateLogs", "Produto SyncBuxx Criado", `Jogo **${p.name}** ${p.emoji||""} criado por <@${userId}>\nID \`${p.id}\``, 0x00ff88, { fields:[{name:"📦 Produto", value:p.name, inline:true}] });
      await interaction.update(payload(vorkbuxProductDetailPanel(interaction.client, guildId, userId, p.id)));
      return true;
    }
  }
  if(id.startsWith(ids.vorkbuxFieldModal)){
    if(id.includes(":step1:")){
      const pid = id.split(":")[3];
      const name = interaction.fields.getTextInputValue("name").trim();
      if(!name){ await interaction.reply({ content:"Nome obrigatório.", flags: MessageFlags.Ephemeral }); return true; }
      vorkbuxStore.setDraft(userId, { type:"createField", pid, name });
      await interaction.showModal(new ModalBuilder()
        .setCustomId(`${ids.vorkbuxFieldModal}:step2:${pid}:${userId}`)
        .setTitle("Preço do Item")
        .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("price").setLabel("Preço em reais (ex: 49,90)").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("49,90")))
      );
      return true;
    }
    if(id.includes(":step2:")){
      const pid = id.split(":")[3];
      const draft = vorkbuxStore.getDraft(userId);
      const price = parseBRL(interaction.fields.getTextInputValue("price"));
      if(price<=0){ await interaction.reply({ content:"Preço deve ser maior que 0.", flags: MessageFlags.Ephemeral }); return true; }
      const name = draft?.name || "Item";
      vorkbuxStore.clearDraft(userId);
      const f=vorkbuxStore.createField(pid, { name, price });
      sendVorkbuxLog(interaction.client, guildId, "privateLogs", "Campo SyncBuxx Criado", `Item **${f.name}** — ${vorkbuxStore.formatBRL(f.price)} em **${vorkbuxStore.getProduct(pid)?.name}** por <@${userId}>`, 0x00ff88);
      await interaction.update(payload(vorkbuxFieldDetailPanel(interaction.client, guildId, userId, pid, f.id)));
      return true;
    }
  }
  if(id.startsWith(ids.vorkbuxFieldNameModal)){
    const parts=id.split(":"); const pid=parts[3]; const fid=parts[4];
    const name=interaction.fields.getTextInputValue("name").trim();
    vorkbuxStore.setField(pid,fid, c=>({ ...c, name }));
    await interaction.update(payload(vorkbuxFieldDetailPanel(interaction.client, guildId, userId, pid, fid)));
    return true;
  }
  if(id.startsWith(ids.vorkbuxFieldPriceModal)){
    const parts=id.split(":"); const pid=parts[3]; const fid=parts[4];
    const price=parseBRL(interaction.fields.getTextInputValue("price"));
    vorkbuxStore.setField(pid,fid, c=>({ ...c, price }));
    await interaction.update(payload(vorkbuxFieldDetailPanel(interaction.client, guildId, userId, pid, fid)));
    return true;
  }
  if(id.startsWith(ids.vorkbuxFieldStockModal)){
    const parts=id.split(":"); const pid=parts[3]; const fid=parts[4];
    const stock=parseInt(interaction.fields.getTextInputValue("stock"),10);
    if(!Number.isFinite(stock) || stock<0){ await interaction.reply({ content:"Quantidade inválida (número obrigatório).", flags: MessageFlags.Ephemeral }); return true; }
    vorkbuxStore.setField(pid,fid, c=>({ ...c, stock }));
    await interaction.update(payload(vorkbuxFieldDetailPanel(interaction.client, guildId, userId, pid, fid)));
    return true;
  }
  if(id.startsWith(ids.vorkbuxPurchaseTextModal)){
    const title=interaction.fields.getTextInputValue("title").trim();
    const desc=interaction.fields.getTextInputValue("desc").trim();
    setGuildConfig(guildId, c=>{ c.vorkbux.purchase.title = title||null; c.vorkbux.purchase.description = desc||null; return c; });
    await interaction.update(payload(vorkbuxPurchasePanel(interaction.client, guildId, userId)));
    return true;
  }
  if(id.startsWith(ids.vorkbuxPurchaseVisualModal)){
    const colorRaw=interaction.fields.getTextInputValue("color").trim();
    const banner=interaction.fields.getTextInputValue("banner").trim();
    const thumb=interaction.fields.getTextInputValue("thumb").trim();
    let color = getGuildConfig(guildId).vorkbux.purchase.color;
    if(colorRaw){
      const hex=colorRaw.replace("#","").trim();
      if(!/^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(hex)){ await interaction.reply({ content:"Cor inválida. Use #ffffff", flags: MessageFlags.Ephemeral }); return true; }
      let h=hex; if(h.length===3) h=h.split("").map(c=>c+c).join("");
      color=parseInt(h,16);
    } else { color=0xffffff; }
    if(banner && !/^https?:\/\/.+/i.test(banner)){ await interaction.reply({ content:"Banner URL inválida.", flags: MessageFlags.Ephemeral }); return true; }
    if(thumb && !/^https?:\/\/.+/i.test(thumb)){ await interaction.reply({ content:"Thumbnail URL inválida.", flags: MessageFlags.Ephemeral }); return true; }
    setGuildConfig(guildId, c=>{ c.vorkbux.purchase.color=color; c.vorkbux.purchase.banner=banner||null; c.vorkbux.purchase.thumbnail=thumb||null; return c; });
    await interaction.update(payload(vorkbuxPurchasePanel(interaction.client, guildId, userId)));
    return true;
  }
  if(id.startsWith(ids.vorkbuxPurchaseChannelIdModal)){
    const cid=interaction.fields.getTextInputValue("cid").trim();
    if(!/^\d{15,25}$/.test(cid)){ await interaction.reply({ content:"ID inválido.", flags: MessageFlags.Ephemeral }); return true; }
    setGuildConfig(guildId, c=>{ c.vorkbux.purchase.channelId=cid; return c; });
    await interaction.update(payload(vorkbuxPurchasePanel(interaction.client, guildId, userId)));
    return true;
  }
  if(id.startsWith(ids.vorkbuxQuantityModal)){
    const orderId=id.split(":").pop(); 
    return false;
  }
  if(id.startsWith(ids.vorkbuxUsernameModal)){
    const parts=id.split(":"); const orderId=parts[3];
    const username=interaction.fields.getTextInputValue("username").trim();
    if(!username){ await interaction.reply({ content:"Usuário obrigatório.", flags: MessageFlags.Ephemeral }); return true; }
    const profile = await lookupRobloxUser(username).catch(()=>null);
    if(!profile){ await interaction.reply({ content:"Não encontrei esse usuário no Roblox.", flags: MessageFlags.Ephemeral }); return true; }
    const order=vorkbuxStore.getOrder(orderId);
    if(!order){ await interaction.reply({ content:"Pedido não encontrado.", flags: MessageFlags.Ephemeral }); return true; }
    vorkbuxStore.setOrder(orderId, c=>({ ...c, robloxUsername: profile.username, robloxDisplayName: profile.displayName, robloxAvatar: profile.avatarUrl, robloxUserId: profile.id }));
    const embed = new EmbedBuilder().setColor(0x00C853).setTitle("Confirme sua identidade").setDescription(`**Usuário:** ${profile.username}\n**Display:** ${profile.displayName}${profile.hasVerifiedBadge ? "\n✅ Conta verificada" : ""}`).setThumbnail(profile.avatarUrl);
    const panel = new ContainerBuilder().setAccentColor(0x00C853);
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(interaction.client,"verifiedp")} Confirme sua identidade`));
    panel.addSectionComponents(new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Usuário:** ${profile.username}\n**Display:** ${profile.displayName}`)).setThumbnailAccessory(new ThumbnailBuilder().setURL(profile.avatarUrl||"https://images.rbxcdn.com/")));
    panel.addSeparatorComponents(new SeparatorBuilder());
    panel.addActionRowComponents(new ActionRowBuilder().addComponents(
      withEmoji(new ButtonBuilder().setCustomId(`vorkbux:confirmuser:${orderId}`).setLabel("Confirmar").setStyle(ButtonStyle.Success), interaction.client,"verifiedp"),
      withEmoji(new ButtonBuilder().setCustomId(`vorkbux:alteruser:${orderId}`).setLabel("Alterar usuário").setStyle(ButtonStyle.Secondary), interaction.client,"editar"),
      withEmoji(new ButtonBuilder().setCustomId(`vorkbux:cancel:${orderId}`).setLabel("Cancelar").setStyle(ButtonStyle.Danger), interaction.client,"negativo")
    ));
    await interaction.update({ components:[panel], flags:V2 });
    return true;
  }
  if(id.startsWith(ids.vorkbuxGamepassLinkModal)){
    const parts=id.split(":"); const orderId=parts[3];
    const link=interaction.fields.getTextInputValue("link").trim();
    if(!/^https?:\/\/.+/i.test(link)){ await interaction.reply({ content:"Link inválido. Use https://...", flags: MessageFlags.Ephemeral }); return true; }
    const existing=vorkbuxStore.getOrder(orderId);
    if(!existing){ await interaction.reply({ content:"Pedido não encontrado.", flags: MessageFlags.Ephemeral }); return true; }
    vorkbuxStore.setOrder(orderId, c=>({ ...c, gamepassLink: link, status:"await_delivery" }));
    const order=vorkbuxStore.getOrder(orderId);
    const panel = new ContainerBuilder().setAccentColor(0xffffff);
    try{
      const ch=interaction.channel;
      if(ch?.isThread()){
        const msgs=await ch.messages.fetch({ limit:20 }).catch(()=>null);
        if(msgs){
          for(const m of msgs.values()){
            if(m.author.id===interaction.client.user.id && m.id!==interaction.message?.id && (m.content?.includes("Pagamento —") || m.embeds?.length || m.components?.length)){
              if(m.components?.[0]?.components?.some?.(c=> c.content?.includes("Pagamento —"))){
                await m.delete().catch(()=>null);
              }
            }
          }
        }
      }
    }catch{}
    if(order.robloxAvatar){
      panel.addSectionComponents(new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`## ${inlineEmoji(interaction.client,"robux")} Gamepass configurada!`),
          new TextDisplayBuilder().setContent(`**Usuário:** **${order.robloxUsername}** (${order.robloxDisplayName||"-"})${order.robloxUserId? ` • ID ${code(order.robloxUserId)}`:""}\n**Quantidade:** **${order.quantity} Robux** → Gamepass **${order.gamepassAmount} Robux** ${order.coverFee? code("com taxa") : code("sem taxa")}\n**Total pago:** **${vorkbuxStore.formatBRL(order.total)}**${order.couponCode? ` • Cupom ${code(order.couponCode)} -${order.couponPercent}%`:""} • **Método:** ${code(order.method)}`)
        ).setThumbnailAccessory(new ThumbnailBuilder().setURL(order.robloxAvatar).setDescription("Avatar Roblox"))
      );
    } else {
      panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(interaction.client,"robux")} Gamepass configurada!\n**Usuário:** ${order.robloxUsername||"-"} • **${order.quantity} Robux** → **${order.gamepassAmount}** Gamepass`));
    }
    panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(interaction.client,"lightbulb")} **Próximo:** aguarde a equipe verificar e entregar. Clique abaixo para ver o link (só admins).`));
    panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
    panel.addActionRowComponents(new ActionRowBuilder().addComponents(
      withEmoji(new ButtonBuilder().setCustomId(`vorkbux:viewgamepass:${orderId}`).setLabel("Ver Gamepass").setStyle(ButtonStyle.Primary), interaction.client,"preview"),
      withEmoji(new ButtonBuilder().setCustomId(`vorkbux:cancelorder:${orderId}`).setLabel("Cancelar pedido").setStyle(ButtonStyle.Danger), interaction.client,"negativo")
    ));
    panel.addActionRowComponents(new ActionRowBuilder().addComponents(
      withEmoji(new ButtonBuilder().setCustomId(`vorkbux:altergamepass:${orderId}`).setLabel("Alterar link").setStyle(ButtonStyle.Secondary), interaction.client,"editar")
    ));
    await interaction.update(payload(panel));
    sendVorkbuxLog(interaction.client, order.guildId, "privateLogs", "Gamepass Configurada", `Pedido \`${orderId}\` — <@${order.userId}> configurou gamepass ${link}\nUsuário **${order.robloxUsername}** • ${order.quantity} → ${order.gamepassAmount}`, 0xffffff, { thumbnail: order.robloxAvatar||null });
    return true;
  }
  if(id.startsWith(ids.vorkbuxCouponModal)){
    const parts2=id.split(":"); const orderId=parts2[3];
    const code=interaction.fields.getTextInputValue("code").trim().toUpperCase();
    const sales = require("../sales");
    const coupon = sales.findCouponByCode ? sales.findCouponByCode(guildId, code) : null;
    const order=vorkbuxStore.getOrder(orderId);
    if(!coupon){ await interaction.reply({ content:"Cupom não encontrado.", flags: MessageFlags.Ephemeral }); return true; }
    if(sales.isCouponExpired && sales.isCouponExpired(coupon)){ await interaction.reply({ content:"Cupom expirado.", flags: MessageFlags.Ephemeral }); return true; }
    const discount = coupon.percent || 0;
    const newTotal = Math.round(order.total * (1 - discount/100) *100)/100;
    vorkbuxStore.setOrder(orderId, c=>({ ...c, couponCode: code, couponPercent: discount, total: newTotal }));
    await interaction.reply({ content:`Cupom **${code}** aplicado! Desconto **${discount}%**. Novo total: **${vorkbuxStore.formatBRL(newTotal)}**`, flags: MessageFlags.Ephemeral });
    const ch = interaction.channel;
    if(ch?.isThread()){
      await sendPaymentPanel(interaction.client, ch, vorkbuxStore.getOrder(orderId));
    }
    return true;
  }
  return false;
}
async function handleVorkbuxPublic(interaction){
  const id = interaction.customId;
  const client = interaction.client;
  if(id.startsWith("vorkbux:buy:")){
    if (await require("../oauth2").requireVerified(interaction, "cart")) return true;
    if(vorkbuxCooldown.has(interaction.user.id) && Date.now() - vorkbuxCooldown.get(interaction.user.id) < 8000){
      const wait=Math.ceil((8000 - (Date.now()-vorkbuxCooldown.get(interaction.user.id)))/1000);
      await interaction.reply({ content:`Calma! Aguarde ${wait}s para abrir outro carrinho.`, flags: MessageFlags.Ephemeral }); return true;
    }
    vorkbuxCooldown.set(interaction.user.id, Date.now());
    setTimeout(()=>{ if(vorkbuxCooldown.get(interaction.user.id) === Date.now()) vorkbuxCooldown.delete(interaction.user.id); },8000);
    const guildId = interaction.guildId;
    const vb = getGuildConfig(guildId).vorkbux;
    const purchaseCfg = vb.purchase;
    const channel = interaction.channel;
    if(!channel?.isTextBased()){ await interaction.reply({ content:"Canal inválido.", flags: MessageFlags.Ephemeral }); return true; }
    let thread;
    try{
      const name = `🛒・vorkbux-${interaction.user.username}`.slice(0,100);
      const { ChannelType } = require("discord.js");
      thread = await channel.threads.create({ name, autoArchiveDuration:60, reason:"SyncBuxx compra", type: ChannelType.PrivateThread, invitable:false }).catch(async()=> await channel.threads.create({ name, autoArchiveDuration:60, reason:"SyncBuxx compra" }));
    } catch(e){
      await interaction.reply({ content:`Não consegui criar thread. Verifique permissões (Criar Threads Privadas). ${e.message}`, flags: MessageFlags.Ephemeral });
      return true;
    }
    try{
      await thread.members.add(interaction.user.id).catch(()=>null);
      const guild = interaction.guild;
      const admins = guild.members.cache.filter(m=> m.permissions.has(PermissionFlagsBits.Administrator) || require("../../perms").hasBotPermission({ guild, user:m.user, member:m }) ).first(5);
      for(const m of admins.values()){ await thread.members.add(m.id).catch(()=>null); }
    } catch{}
    await interaction.reply({ content:`Carrinho criado: ${thread}`, flags: MessageFlags.Ephemeral });
    const orderId = `${Date.now()}${Math.floor(Math.random()*1000)}`;
    vorkbuxStore.createOrder({ id: orderId, guildId, userId: interaction.user.id, channelId: thread.id, status:"quantity", quantity:null, method:null, coverFee:null, robuxAmount:null, gamepassAmount:null, total:null, couponCode:null, couponPercent:0, robloxUsername:null });
    sendVorkbuxLog(client, guildId, "orderLogs", "Carrinho SyncBuxx Aberto", `Comprador <@${interaction.user.id}> abriu carrinho em ${thread}\nPedido \`${orderId}\``, 0x3498db, { fields:[{name:"📦 Canal", value:`${thread}`, inline:true},{name:"👤 Usuário", value:`<@${interaction.user.id}>`, inline:true}], thumbnail: interaction.user.displayAvatarURL() });
    const welcome = new ContainerBuilder().setAccentColor(0x00ff88);
    try{
      welcome.addSectionComponents(new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`## ${inlineEmoji(interaction.client,"robux")} Bem-vindo ao seu Carrinho, ${interaction.user}`),
          new TextDisplayBuilder().setContent(`Compra **segura e rápida** de Robux via **Gamepass** ou **Grupo**.\n-# Escolha a quantidade abaixo. Apenas você e a administração veem este carrinho.`)
        ).setThumbnailAccessory(new ThumbnailBuilder().setURL(interaction.user.displayAvatarURL({extension:"png", size:128})).setDescription("Avatar"))
      );
    } catch{
      welcome.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(interaction.client,"robux")} Bem-vindo, ${interaction.user}\nCompra segura de Robux.`));
    }
    welcome.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
    welcome.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `${inlineEmoji(interaction.client,"pricep")} **Preço:** ${vorkbuxStore.formatBRL(vb.pricePer1000||0)}/1000 • ${inlineEmoji(interaction.client,"clock")} **Limites:** ${vb.minRobux}–${vb.maxRobux} Robux\n`+
      `${inlineEmoji(interaction.client,"users")} **Grupo:** ${vb.group.stock} Robux em estoque • ${inlineEmoji(interaction.client,"ligado")} **Pix** instantâneo`
    ));
    welcome.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
    welcome.addActionRowComponents(new ActionRowBuilder().addComponents(
      withEmoji(new ButtonBuilder().setCustomId(`vorkbux:qty:${orderId}`).setLabel("Selecionar quantidade").setStyle(ButtonStyle.Success), interaction.client,"hash"),
      withEmoji(new ButtonBuilder().setCustomId(`vorkbux:cancel:${orderId}`).setLabel("Cancelar").setStyle(ButtonStyle.Danger), interaction.client,"negativo")
    ));
    welcome.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(interaction.client,"lightbulb")} **Dica:** digite a quantidade exata (ex: 500, 1000, 2500). Taxa Gamepass 30% opcional.
-# creator: x64thebuilder/.200021`));
    await thread.send({ components:[welcome], flags:V2 });
    return true;
  }
  if(id.startsWith("vorkbux:qty:")){
    const orderId=id.split(":")[2];
    await interaction.showModal(new ModalBuilder().setCustomId(`modal:vorkbux:qtyinput:${orderId}:${interaction.user.id}`).setTitle("Quantidade de Robux").addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("qty").setLabel("Quantidade de Robux").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("Ex: 1000"))));
    return true;
  }
  if(id.startsWith("vorkbux:cancel:")){
    const orderId=id.split(":")[2];
    const container = new ContainerBuilder().setAccentColor(0xe74c3c);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(interaction.client,"negativo")} Carrinho cancelado\nFechando em **15 segundos**...`));
    await interaction.reply({ components:[container], flags:V2_EPH });
    sendVorkbuxLog(interaction.client, guildId || interaction.guildId, "cancelledLogs", "Carrinho Cancelado", `Comprador <@${interaction.user.id}> cancelou pedido \`${orderId}\``, 0xe74c3c, { thumbnail: interaction.user.displayAvatarURL() });
    setTimeout(async()=>{
      const order=vorkbuxStore.getOrder(orderId);
      const ch = interaction.channel;
      if(ch?.isThread()){ await ch.delete().catch(()=>null); }
      vorkbuxStore.setOrder(orderId, c=>c?{...c,status:"cancelled"}:c);
    },15000);
    return true;
  }
  if(id.startsWith("vorkbux:method:")){
    return false;
  }
  if(id.startsWith("vorkbux:tax:")){
    return false;
  }
  return false;
}
async function handleVorkbuxSelect(interaction){
  const id = interaction.customId;
  if(id.startsWith("vorkbux:method:")){
    const orderId=id.split(":")[2];
    const method = interaction.values[0];
    const order=vorkbuxStore.getOrder(orderId);
    const cfg=getGuildConfig(order.guildId).vorkbux;
    if(method==="gamepass" && !getVorkbuxFlag(order.guildId,"gamepass")){ await interaction.reply({ content:"Gamepass desativado.", flags: MessageFlags.Ephemeral }); return true; }
    if(method==="group" && !getVorkbuxFlag(order.guildId,"robux")){ await interaction.reply({ content:"Grupo (Robux) desativado.", flags: MessageFlags.Ephemeral }); return true; }
    if(method==="group" && cfg.group.stock < order.quantity){ await interaction.reply({ content:`Estoque insuficiente. Temos **${cfg.group.stock}** Robux disponíveis.`, flags: MessageFlags.Ephemeral }); return true; }
    if(method==="group"){
      vorkbuxStore.setOrder(orderId, c=>({ ...c, method, coverFee:false, gamepassAmount: order.quantity, total: vorkbuxStore.calcPrice(order.quantity, cfg.group.pricePer1000||cfg.pricePer1000) }));
      await askRobloxUser(interaction, orderId);
      return true;
    }
    vorkbuxStore.setOrder(orderId, c=>({ ...c, method }));
    const panel = new ContainerBuilder().setAccentColor(0xffffff);
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(interaction.client,"robux")} Taxa da Roblox — 30%`));
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`Sem cobrir: você recebe **70%** (ex: 1000 → 700) e paga menos. Com taxa: você recebe **100%** (1000 → 1000) mas o preço é cheio.`));
    panel.addSeparatorComponents(new SeparatorBuilder());
    panel.addActionRowComponents(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`vorkbux:tax:${orderId}`).setPlaceholder("Escolha a taxa").addOptions(
        { label:`Sem cobrir taxa — ${vorkbuxStore.formatBRL(vorkbuxStore.calcPrice(order.quantity, cfg.pricePer1000)*0.7)}`, value:"no", description:"700 Robux por 1000", emoji: componentEmoji(interaction.client,"negativo") },
        { label:`Cobrir taxa — ${vorkbuxStore.formatBRL(vorkbuxStore.calcPrice(order.quantity, cfg.pricePer1000))}`, value:"yes", description:"1000 Robux por 1000 (1429 gamepass)", emoji: componentEmoji(interaction.client,"positivo") }
      )
    ));
    panel.addActionRowComponents(new ActionRowBuilder().addComponents(
      withEmoji(new ButtonBuilder().setCustomId(`vorkbux:cancel:${orderId}`).setLabel("Cancelar pedido").setStyle(ButtonStyle.Danger), interaction.client,"negativo")
    ));
    await interaction.update({ components:[panel], flags:V2 });
    return true;
  }
  if(id.startsWith("vorkbux:tax:")){
    const orderId=id.split(":")[2];
    const choice = interaction.values[0];
    const order=vorkbuxStore.getOrder(orderId);
    const cfg=getGuildConfig(order.guildId).vorkbux;
    const coverFee = choice==="yes";
    const basePrice = vorkbuxStore.calcPrice(order.quantity, cfg.pricePer1000);
    const total = coverFee ? basePrice : Math.round(basePrice*0.7*100)/100;
    const gamepassAmount = vorkbuxStore.calcGamepassAmount(order.quantity, coverFee);
    vorkbuxStore.setOrder(orderId, c=>({ ...c, coverFee, total, gamepassAmount, robuxAmount: order.quantity }));
    await askRobloxUser(interaction, orderId);
    return true;
  }
  if(id.startsWith("vorkbux:feedback:")){
    const orderId=id.split(":")[2];
    const rating=interaction.values[0];
    const order=vorkbuxStore.getOrder(orderId);
    if(!order || order.userId!==interaction.user.id){ await interaction.reply({ content:"Só o comprador pode avaliar.", flags: MessageFlags.Ephemeral }); return true; }
    vorkbuxStore.setOrder(orderId, c=>({ ...c, rating: Number(rating), ratedAt: Date.now() }));
    const stars="⭐".repeat(Number(rating));
    await interaction.update({ components:[new ContainerBuilder().setAccentColor(0xffd700).addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${stars} Obrigado pela avaliação!\nSua nota **${rating}/5** foi registrada.`))], flags:V2 });
    const fbId=getGuildConfig(order.guildId).sales.channels.feedbackChannel;
    if(fbId){
      const ch=await interaction.client.channels.fetch(fbId).catch(()=>null);
      if(ch?.isTextBased()){
        const embed=new EmbedBuilder().setColor(0xffd700).setTitle(`⭐ Feedback SyncBuxx — ${rating}/5`).setThumbnail(order.robloxAvatar||null).setDescription(`Comprador <@${order.userId}> avaliou **${stars}**\nRobux **${order.quantity}** • Valor **${vorkbuxStore.formatBRL(order.total)}**\nRoblox **${order.robloxUsername||"-"}**`).setTimestamp();
        ch.send({ embeds:[embed] }).catch(()=>null);
      }
    }
    sendVorkbuxLog(interaction.client, order.guildId, "privateLogs", "Feedback SyncBuxx", `Comprador <@${order.userId}> deu ${rating}/5 para pedido \`${orderId}\` — ${stars}`, 0xffd700, { thumbnail: order.robloxAvatar||null });
    return true;
  }
  return false;
}
async function askRobloxUser(interaction, orderId){
  const panel = new ContainerBuilder().setAccentColor(0xffffff);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(interaction.client,"userp")} Informe seu usuário Roblox`));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`Precisamos do seu **nome de usuário principal** (não apelido) para gerar a Gamepass e entregar.`));
  panel.addSeparatorComponents(new SeparatorBuilder());
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder().setCustomId(`vorkbux:userbtn:${orderId}`).setLabel("Configurar usuário").setStyle(ButtonStyle.Primary), interaction.client,"userp"),
    withEmoji(new ButtonBuilder().setCustomId(`vorkbux:cancel:${orderId}`).setLabel("Cancelar").setStyle(ButtonStyle.Danger), interaction.client,"negativo")
  ));
  await interaction.update({ components:[panel], flags:V2 });
}
async function handleVorkbuxButton(interaction){
  const id = interaction.customId;
  if(id.startsWith("vorkbux:userbtn:")){
    const orderId=id.split(":")[2];
    await interaction.showModal(new ModalBuilder().setCustomId(`${ids.vorkbuxUsernameModal}:${orderId}:${interaction.user.id}`).setTitle("Usuário Roblox").addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("username").setLabel("Nome de usuário").setStyle(TextInputStyle.Short).setRequired(true))));
    return true;
  }
  if(id.startsWith("vorkbux:confirmuser:")){
    const orderId=id.split(":")[2];
    const order=vorkbuxStore.getOrder(orderId);
    if(!order || order.userId!==interaction.user.id){ await interaction.reply({ content:"Não autorizado.", flags: MessageFlags.Ephemeral }); return true; }
    const panel = new ContainerBuilder().setAccentColor(0x2ecc71);
    const instruction = order.method==="group"
      ? `Seu pedido será enviado via **Grupo** (${order.quantity} Robux). Nossa equipe vai adicionar em até 5 dias úteis (grupo). Valor: **${vorkbuxStore.formatBRL(order.total)}**`
      : `Crie uma **Gamepass** no valor de **${order.gamepassAmount} Robux** (você ${order.coverFee ? "cobriu a taxa, receberá "+order.robuxAmount+" Robux" : "não cobriu, receberá "+Math.floor(order.robuxAmount*0.7)+" Robux"}).`;
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(interaction.client,"robux")} Crie sua Gamepass\n${instruction}\n\n**Passos:** 1. Crie em https://create.roblox.com/dashboard/creations?activeTab=Pass`));
    panel.addSeparatorComponents(new SeparatorBuilder());
    panel.addActionRowComponents(new ActionRowBuilder().addComponents(
      withEmoji(new ButtonBuilder().setCustomId(`vorkbux:proceed:${orderId}`).setLabel("Prosseguir com a compra").setStyle(ButtonStyle.Success), interaction.client,"positivo"),
      withEmoji(new ButtonBuilder().setCustomId(`vorkbux:coupon:${orderId}`).setLabel("Aplicar cupom").setStyle(ButtonStyle.Secondary), interaction.client,"cupom"),
      withEmoji(new ButtonBuilder().setCustomId(`vorkbux:cancel:${orderId}`).setLabel("Cancelar pedido").setStyle(ButtonStyle.Danger), interaction.client,"negativo")
    ));
    await interaction.update({ components:[panel], flags:V2 });
    return true;
  }
  if(id.startsWith("vorkbux:alteruser:")){
    const orderId=id.split(":")[2];
    await interaction.showModal(new ModalBuilder().setCustomId(`${ids.vorkbuxUsernameModal}:${orderId}:${interaction.user.id}`).setTitle("Alterar usuário").addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("username").setLabel("Novo usuário").setStyle(TextInputStyle.Short).setRequired(true))));
    return true;
  }
  if(id.startsWith("vorkbux:proceed:")){
    const orderId=id.split(":")[2];
    const order=vorkbuxStore.getOrder(orderId);
    await sendPaymentPanel(interaction.client, interaction.channel, order);
    await interaction.deferUpdate().catch(()=>null);
    return true;
  }
  if(id.startsWith("vorkbux:coupon:")){
    const orderId=id.split(":")[2];
    await interaction.showModal(new ModalBuilder().setCustomId(`${ids.vorkbuxCouponModal}:${orderId}:${interaction.user.id}`).setTitle("Cupom").addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("code").setLabel("Código do cupom").setStyle(TextInputStyle.Short).setRequired(true))));
    return true;
  }
  if(id.startsWith("vorkbux:confirmpay:")){
    const orderId=id.split(":")[2];
    const order=vorkbuxStore.getOrder(orderId);
    const cfg=getGuildConfig(order.guildId);
    const isManual = !(cfg.payments.mercadoPago.enabled || cfg.payments.efi.enabled || cfg.payments.stripe.enabled);
    sendVorkbuxLog(interaction.client, order.guildId, "paymentLogs", "Pagamento Solicitado — SyncBuxx", `Comprador <@${order.userId}>\nRobux **${order.quantity}** via **${order.method}**\nTotal **${vorkbuxStore.formatBRL(order.total)}**\nRoblox **${order.robloxUsername||"-"}**`, 0x3498db, { thumbnail: order.robloxAvatar||interaction.user.displayAvatarURL(), fields:[{name:"💳 Método", value: order.method, inline:true},{name:"💰 Total", value: vorkbuxStore.formatBRL(order.total), inline:true}] });
    if(isManual){
      vorkbuxStore.setOrder(orderId, c=>({ ...c, status:"await_approval" }));
      const panel = new ContainerBuilder().setAccentColor(0xf1c40f);
      panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(interaction.client,"clock")} Aguardando aprovação\nPagamento em verificação manual. Um administrador vai aprovar em breve.`));
      panel.addSeparatorComponents(new SeparatorBuilder());
      panel.addActionRowComponents(new ActionRowBuilder().addComponents(
        withEmoji(new ButtonBuilder().setCustomId(`vorkbux:approve:${orderId}`).setLabel("Aprovar pagamento (Owner)").setStyle(ButtonStyle.Success), interaction.client,"positivo"),
        withEmoji(new ButtonBuilder().setCustomId(`vorkbux:cancelorder:${orderId}`).setLabel("Cancelar pedido").setStyle(ButtonStyle.Danger), interaction.client,"negativo")
      ));
      await interaction.update({ components:[panel], flags:V2 });
    } else {
      await interaction.reply({ content:"Verificando pagamento...", flags: MessageFlags.Ephemeral });
      setTimeout(async()=>{
        vorkbuxStore.setOrder(orderId, c=>({ ...c, status:"paid" }));
        sendVorkbuxLog(interaction.client, order.guildId, "approvedLogs", "Pagamento Aprovado — SyncBuxx", `Comprador <@${order.userId}>\nValor **${vorkbuxStore.formatBRL(order.total)}**\nRobux **${order.quantity}**`, 0x2ecc71, { thumbnail: order.robloxAvatar||null, fields:[{name:"✅ Status", value:"Pagamento confirmado automaticamente", inline:true}] });
        const panel = new ContainerBuilder().setAccentColor(0x2ecc71);
        panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(interaction.client,"positivo")} Pagamento aprovado!`));
        panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`Agora configure a Gamepass para entrega.`));
        panel.addSeparatorComponents(new SeparatorBuilder());
        panel.addActionRowComponents(new ActionRowBuilder().addComponents(
          withEmoji(new ButtonBuilder().setCustomId(`vorkbux:setgamepass:${orderId}`).setLabel("Configurar Gamepass").setStyle(ButtonStyle.Primary), interaction.client,"link"),
          withEmoji(new ButtonBuilder().setCustomId(`vorkbux:cancel:${orderId}`).setLabel("Cancelar pedido").setStyle(ButtonStyle.Danger), interaction.client,"negativo")
        ));
        await interaction.channel.send({ components:[panel], flags:V2 }).catch(()=>null);
      },2000);
    }
    return true;
  }
  if(id.startsWith("vorkbux:cancelorder:")){
    const orderId=id.split(":")[2];
    vorkbuxStore.setOrder(orderId, c=>c?{...c,status:"cancelled"}:c);
    await interaction.reply({ components:[new ContainerBuilder().setAccentColor(0xe74c3c).addTextDisplayComponents(new TextDisplayBuilder().setContent(`## Cancelado`))], flags:V2_EPH });
    setTimeout(async()=>{ try{ await interaction.channel.delete().catch(()=>null);}catch{} },5000);
    return true;
  }
  if(id.startsWith("vorkbux:approve:")){
    const orderId=id.split(":")[2];
    const order=vorkbuxStore.getOrder(orderId);
    const { hasBotPermission } = require("../../perms");
    if(!hasBotPermission(interaction) && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)){
      await interaction.reply({ content:"Apenas owner/admin.", flags: MessageFlags.Ephemeral }); return true;
    }
    vorkbuxStore.setOrder(orderId, c=>({ ...c, status:"paid" }));
    sendVorkbuxLog(interaction.client, order.guildId, "approvedLogs", "Pagamento Aprovado Manual — SyncBuxx", `Aprovado por <@${interaction.user.id}>\nComprador <@${order.userId}>\nValor **${vorkbuxStore.formatBRL(order.total)}**`, 0x2ecc71, { thumbnail: order.robloxAvatar||null });
    const panel = new ContainerBuilder().setAccentColor(0x2ecc71);
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(interaction.client,"positivo")} Pagamento aprovado pelo owner`));
    panel.addSeparatorComponents(new SeparatorBuilder());
    panel.addActionRowComponents(new ActionRowBuilder().addComponents(
      withEmoji(new ButtonBuilder().setCustomId(`vorkbux:setgamepass:${orderId}`).setLabel("Configurar Gamepass").setStyle(ButtonStyle.Primary), interaction.client,"link"),
      withEmoji(new ButtonBuilder().setCustomId(`vorkbux:cancel:${orderId}`).setLabel("Cancelar pedido").setStyle(ButtonStyle.Danger), interaction.client,"negativo")
    ));
    await interaction.update({ components:[panel], flags:V2 });
    return true;
  }
  if(id.startsWith("vorkbux:altergamepass:")){
    const orderId=id.split(":")[2];
    await interaction.showModal(new ModalBuilder().setCustomId(`${ids.vorkbuxGamepassLinkModal}:${orderId}:${interaction.user.id}`).setTitle("Alterar Gamepass").addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("link").setLabel("Novo link da Gamepass").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("https://www.roblox.com/game-pass/..."))));
    return true;
  }
  if(id.startsWith("vorkbux:setgamepass:")){
    const orderId=id.split(":")[2];
    await interaction.showModal(new ModalBuilder().setCustomId(`${ids.vorkbuxGamepassLinkModal}:${orderId}:${interaction.user.id}`).setTitle("Link da Gamepass").addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("link").setLabel("Link da Gamepass").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("https://www.roblox.com/game-pass/..."))));
    return true;
  }
  if(id.startsWith("vorkbux:viewgamepass:")){
    const orderId=id.split(":")[2];
    const order=vorkbuxStore.getOrder(orderId);
    const { hasBotPermission } = require("../../perms");
    if(!hasBotPermission(interaction) && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)){
      await interaction.reply({ content:"Apenas owner/admin pode ver.", flags: MessageFlags.Ephemeral }); return true;
    }
    await interaction.reply({ content:`Gamepass: ${order.gamepassLink}`, flags: MessageFlags.Ephemeral });
    return true;
  }
  if(id.startsWith("vorkbux:copypix:")){
    const orderId=id.split(":")[2];
    const order=vorkbuxStore.getOrder(orderId);
    await interaction.reply({ content:`\`\`\`${order.pixCopyPaste||"pix-copia-e-cola"}\`\`\``, flags: MessageFlags.Ephemeral });
    return true;
  }
  return false;
}
async function handleVorkbuxModalQty(interaction){
  if(!interaction.customId.startsWith("modal:vorkbux:qtyinput:")) return false;
  const parts=interaction.customId.split(":");
  const orderId=parts[3];
  const qty=parseInt(interaction.fields.getTextInputValue("qty"),10);
  const order=vorkbuxStore.getOrder(orderId);
  if(!order){ await interaction.reply({ content:"Pedido não encontrado.", flags: MessageFlags.Ephemeral }); return true; }
  const cfg=getGuildConfig(order.guildId).vorkbux;
  if(!Number.isFinite(qty) || qty<cfg.minRobux || qty>cfg.maxRobux){ await interaction.reply({ content:`Quantidade inválida. Min **${cfg.minRobux}** max **${cfg.maxRobux}**.`, flags: MessageFlags.Ephemeral }); return true; }
  if(cfg.group.stock !== undefined && getVorkbuxFlag(order.guildId,"robux") && !getVorkbuxFlag(order.guildId,"gamepass")){
  }
  const priceGamepass = vorkbuxStore.calcPrice(qty, cfg.pricePer1000);
  const priceGroup = vorkbuxStore.calcPrice(qty, cfg.group.pricePer1000||cfg.pricePer1000);
  vorkbuxStore.setOrder(orderId, c=>({ ...c, quantity: qty, robuxAmount: qty, total: priceGamepass })); 
  const panel = new ContainerBuilder().setAccentColor(0xffffff);
  try{
    panel.addSectionComponents(new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## ${inlineEmoji(interaction.client,"robux")} Você quer comprar **${qty} Robux**`),
        new TextDisplayBuilder().setContent(`Total estimado: **${vorkbuxStore.formatBRL(priceGamepass)}** (Gamepass) • **${vorkbuxStore.formatBRL(priceGroup)}** (Grupo)\n-# Escolha **Gamepass** (instantâneo) ou **Grupo** (14 dias) abaixo.`)
      ).setThumbnailAccessory(new ThumbnailBuilder().setURL(interaction.user.displayAvatarURL({size:128})).setDescription("Usuário"))
    );
  } catch{
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(interaction.client,"robux")} Você quer comprar **${qty} Robux**\nTotal: ${vorkbuxStore.formatBRL(priceGamepass)} / ${vorkbuxStore.formatBRL(priceGroup)}`));
  }
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${inlineEmoji(interaction.client,"lightbulb")} **Gamepass:** taxa 30% opcional • **Grupo:** usa estoque (${cfg.group.stock} Robux)\n`+
    `-# ${getVorkbuxFlag(order.guildId,"gamepass")? "✅ Gamepass liberado" : "⚠️ Gamepass desativado"} • ${getVorkbuxFlag(order.guildId,"robux")? "✅ Grupo liberado" : "⚠️ Grupo desativado"}`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(`vorkbux:method:${orderId}`).setPlaceholder("Escolha Gamepass ou Grupo").addOptions(
      { label:`Gamepass — ${vorkbuxStore.formatBRL(priceGamepass)}`, value:"gamepass", description: getVorkbuxFlag(order.guildId,"gamepass")? "Entrega via Gamepass (até 7 dias)" : "Desativado — ative no painel", emoji: componentEmoji(interaction.client,"robux") },
      { label:`Grupo — ${vorkbuxStore.formatBRL(priceGroup)}`, value:"group", description: getVorkbuxFlag(order.guildId,"robux")? `Estoque ${cfg.group.stock} • 14 dias` : "Desativado — ative Robux", emoji: componentEmoji(interaction.client,"users") }
    )
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder().setCustomId(`vorkbux:cancel:${orderId}`).setLabel("Cancelar pedido").setStyle(ButtonStyle.Danger), interaction.client,"negativo")
  ));
  await interaction.update({ components:[panel], flags:V2 });
  return true;
}
async function sendPaymentPanel(client, channel, order){
  if(!channel?.isThread() && !channel?.isTextBased()) return;
  const totalStr = vorkbuxStore.formatBRL(order.total);
  const payment = await createVorkbuxPayment(order.guildId, order).catch(()=>null);
  const pixCode = payment?.copyPaste || `00020126360014BR.GOV.BCB.PIX0114pix@exemplo.com520400005303986540${String(order.total.toFixed(2)).replace(".","")}5802BR5913SyncBuxx6009SaoPaulo62070503***6304`;
  vorkbuxStore.setOrder(order.id, c=>c?{...c, pixCopyPaste: pixCode, pixKey: getGuildConfig(order.guildId).payments.pix.key, paymentProvider: payment?.provider||"manual", paymentId: payment?.id||order.id, paymentQr: payment?.qr }:c);
  order = vorkbuxStore.getOrder(order.id);
  const qrSource = payment?.qr ? (payment.qr.startsWith("data:")? payment.qr : await QRCode.toDataURL(payment.qr).catch(()=>null)) : await QRCode.toDataURL(pixCode).catch(()=>null);
  const qrDataUrl = qrSource;
  const panel = new ContainerBuilder().setAccentColor(0x2ecc71);
  try{
    panel.addSectionComponents(new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"pix")} Pagamento — **${totalStr}**`),
        new TextDisplayBuilder().setContent(`**Robux:** ${order.quantity} • **Usuário:** ${order.robloxUsername||"-"}\n**Método:** ${order.method==="group"?"Grupo": order.coverFee?"Gamepass (com taxa)":"Gamepass (sem taxa)"} • **Gamepass:** **${order.gamepassAmount} Robux**\n-# Escaneie o QR ou copie o código abaixo. Expira em **30 min**.`)
      ).setThumbnailAccessory(new ThumbnailBuilder().setURL(order.robloxAvatar||client.user.displayAvatarURL()).setDescription("Avatar"))
    );
  } catch{
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"pix")} Pagamento — ${totalStr}\n**Robux:** ${order.quantity} • **Usuário:** ${order.robloxUsername||"-"}`));
  }
  if(qrDataUrl){
    try{
      const base64=qrDataUrl.split(",")[1];
      const buf=Buffer.from(base64,"base64");
      const { AttachmentBuilder } = require("discord.js");
      const att=new AttachmentBuilder(buf, { name:"qrcode.png" });
      panel.addMediaGalleryComponents(new MediaGalleryBuilder({ items:[{ media:{ url:"attachment://qrcode.png" } }] }));
      await channel.send({ components:[panel], flags:V2, files:[att] }).catch(()=>null);
      await sendPaymentButtons(client, channel, order);
      return;
    }catch{}
  }
  await channel.send({ components:[panel], flags:V2 }).catch(()=>null);
  await sendPaymentButtons(client, channel, order);
}
async function sendPaymentButtons(client, channel, order){
  const row = new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder().setCustomId(`vorkbux:copypix:${order.id}`).setLabel("Código copia e cola").setStyle(ButtonStyle.Secondary), client,"pix"),
    withEmoji(new ButtonBuilder().setCustomId(`vorkbux:confirmpay:${order.id}`).setLabel("Confirmar pagamento").setStyle(ButtonStyle.Success), client,"positivo"),
    withEmoji(new ButtonBuilder().setCustomId(`vorkbux:cancelorder:${order.id}`).setLabel("Cancelar pedido").setStyle(ButtonStyle.Danger), client,"negativo")
  );
  const cont = new ContainerBuilder().setAccentColor(0x3498db);
  cont.addTextDisplayComponents(new TextDisplayBuilder().setContent(`Ações do pagamento:`));
  cont.addActionRowComponents(row);
  await channel.send({ components:[cont], flags:V2 }).catch(()=>null);
}
function sendVorkbuxLog(client, guildId, channelKey, title, desc, color, opts={}){
  const cfg=getGuildConfig(guildId);
  const primary = cfg.sales.channels[channelKey] || cfg.channels[channelKey];
  const fallback = cfg.sales.channels.privateLogs || cfg.channels.generalLogs;
  const targetId = primary || fallback;
  if(!targetId) return;
  const guild = client.guilds.cache.get(guildId);
  const ts = Math.floor(Date.now()/1000);
  const iconMap = { orderLogs:"pedidoSolicitado", paymentLogs:"pix", approvedLogs:"pedidoRealizado", deliveredLogs:"pedidoEntregue", cancelledLogs:"carrinhoCancelado", errorLogs:"negativo", privateLogs:"visible", publicLogs:"robux", feedback:"star" };
  const icon = iconMap[channelKey] || "robux";
  const buildContainer = (isDuplicate=false) => {
    const c = new ContainerBuilder().setAccentColor(color);
    try{
      const hdr = new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`## ${inlineEmoji(client, icon)} ${title}${isDuplicate?" • Privado":""}`),
          new TextDisplayBuilder().setContent(desc)
        );
      const thumb = opts.thumbnail || client.user.displayAvatarURL({ extension:"png", size:128 });
      if(thumb) hdr.setThumbnailAccessory(new ThumbnailBuilder().setURL(thumb).setDescription(title));
      c.addSectionComponents(hdr);
    } catch{
      c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client, icon)} ${title}\n${desc}`));
    }
    if(opts.fields?.length){
      c.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
      const lines = opts.fields.map(f=> `**${f.name}:** ${f.value}`).join("\n");
      c.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));
    }
    if(opts.image){
      try{ c.addMediaGalleryComponents(new MediaGalleryBuilder({ items:[{ media:{url:opts.image}, description:title }]})); }catch{}
    }
    c.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client,"casa")} ${guild?.name||"Servidor"} • <t:${ts}:F> • <t:${ts}:R> ${isDuplicate? "• Log duplicado privado — destacada":""}`));
    return c;
  };
  client.channels.fetch(targetId).then(ch=>{
    if(!ch?.isTextBased()) return;
    ch.send({ components:[buildContainer(false)], flags: MessageFlags.IsComponentsV2 }).catch(()=>null);
  }).catch(()=>null);
  if(primary && fallback && primary!==fallback && channelKey!=="privateLogs"){
    client.channels.fetch(fallback).then(ch=>{
      if(!ch?.isTextBased()) return;
      ch.send({ components:[buildContainer(true)], flags: MessageFlags.IsComponentsV2 }).catch(()=>null);
    }).catch(()=>null);
  }
}
function sendVorkbuxPublicLog(client, guildId, order){
  const cfg=getGuildConfig(guildId);
  const publicId = cfg.sales.channels.publicLogs || cfg.sales.channels.approvedLogs || cfg.vorkbux.purchase.channelId;
  if(!publicId) return;
  const guild = client.guilds.cache.get(guildId);
  const ts = Math.floor(Date.now()/1000);
  client.channels.fetch(publicId).then(ch=>{
    if(!ch?.isTextBased()) return;
    const container = new ContainerBuilder().setAccentColor(0xFFD700);
    try{
      container.addSectionComponents(new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"robux")} 💎 Compra SyncBuxx Entregue!`),
          new TextDisplayBuilder().setContent(`**${order.robloxUsername||"Usuário"}** acabou de receber **${order.quantity} Robux** via **${order.method==="group"?"Grupo":"Gamepass"}**!\n-# Entrega verificada e garantida pelo sistema SyncBuxx.`)
        ).setThumbnailAccessory(new ThumbnailBuilder().setURL(order.robloxAvatar||client.user.displayAvatarURL()).setDescription("Avatar Roblox"))
      );
    } catch{
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 💎 Compra SyncBuxx Entregue!\n**${order.robloxUsername||"Usuário"}** — ${order.quantity} Robux`));
    }
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `${inlineEmoji(client,"userp")} **Roblox:** **${order.robloxUsername||"-"}** (${order.robloxDisplayName||"-"}) • ID \`${order.robloxUserId||"-"}\`\n`+
      `${inlineEmoji(client,"pricep")} **Valor Pago:** **${vorkbuxStore.formatBRL(order.total)}**${order.couponCode?` • Cupom \`${order.couponCode}\` -${order.couponPercent}%`:""}\n`+
      `${inlineEmoji(client,"caixa")} **Quantidade:** **${order.quantity} Robux** • **Método:** ${order.method==="group"?"Grupo (14 dias)":"Gamepass"+(order.coverFee?" (com taxa)":" (sem taxa)")} • Gamepass **${order.gamepassAmount} Robux**\n`+
      `${inlineEmoji(client,"user")} **Comprador:** <@${order.userId}> • Pedido \`${order.id.slice(-6)}\` • <t:${ts}:F>\n`+
      `${inlineEmoji(client,"link")} **Gamepass:** ${order.gamepassLink?`[Clique para ver](${order.gamepassLink})`:"\`"+order.gamepassAmount+" Robux\`"}`
    ));
    if(order.robloxAvatar){
      try{ container.addMediaGalleryComponents(new MediaGalleryBuilder({ items:[{ media:{url:order.robloxAvatar}, description:`Avatar ${order.robloxUsername}`}]})); }catch{}
    }
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client,"ligado")} **Entrega garantida** • ${guild?.name||"Servidor"} • SyncBuxx Premium • <t:${ts}:R>`));
    if(guild?.iconURL()) container.addMediaGalleryComponents(new MediaGalleryBuilder({ items:[{ media:{url:guild.iconURL({extension:"png",size:128})}, description:guild.name }]}));
    ch.send({ components:[container], flags: MessageFlags.IsComponentsV2 }).catch(()=>null);
  }).catch(()=>null);
}
async function handleEntregue(interaction){
  if(!interaction.isChatInputCommand() || interaction.commandName!=="entregue") return false;
  const channel=interaction.channel;
  if(!channel?.isThread()){
    await interaction.reply({ content:"Use dentro do carrinho (thread).", flags: MessageFlags.Ephemeral }); return true;
  }
  const storeData = vorkbuxStore.readStore();
  const order = Object.values(storeData.orders).find(o=>o.channelId===channel.id);
  if(!order){ await interaction.reply({ content:"Pedido não encontrado.", flags: MessageFlags.Ephemeral }); return true; }
  const hasPerm = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) || require("../../perms").hasBotPermission(interaction);
  if(!hasPerm){ await interaction.reply({ content:"Apenas owner/admin.", flags: MessageFlags.Ephemeral }); return true; }
  vorkbuxStore.setOrder(order.id, c=>({ ...c, status:"delivered" }));
  const panel = new ContainerBuilder().setAccentColor(0x2ecc71);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(interaction.client,"positivo")} Robux entregues!\nVerifique em https://www.roblox.com/transactions`));
  if(order.robloxAvatar) panel.addSectionComponents(new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`Entrega concluída com sucesso.`)).setThumbnailAccessory(new ThumbnailBuilder().setURL(order.robloxAvatar)));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Thread fechará em 5 minutos.`));
  await interaction.reply({ components:[panel], flags:V2 });
  await channel.send({ components:[panel], flags:V2 }).catch(()=>null);
  sendVorkbuxPublicLog(interaction.client, order.guildId, order);
  sendVorkbuxLog(interaction.client, order.guildId, "deliveredLogs", "Entrega SyncBuxx Concluída", `Cliente <@${order.userId}> recebeu **${order.quantity} Robux**\nRoblox **${order.robloxUsername||"-"}**\nValor **${vorkbuxStore.formatBRL(order.total)}**`, 0x2ecc71, { thumbnail: order.robloxAvatar||null, fields:[{name:"📦 Gamepass", value: order.gamepassLink? order.gamepassLink : `${order.gamepassAmount} Robux`, inline:true},{name:"👤 Comprador", value:`<@${order.userId}>`, inline:true}] });
  if(order.method==="group"){
    setGuildConfig(order.guildId, c=>{ c.vorkbux.group.stock = Math.max(0, (c.vorkbux.group.stock||0) - order.quantity); return c; });
  }
  const cfgAfter = getGuildConfig(order.guildId).vorkbux;
  if(cfgAfter.group.stock===0){
    sendVorkbuxLog(interaction.client, order.guildId, "errorLogs", "Estoque Grupo Zerado ⚠️", `O estoque de Robux via grupo acabou após entrega do pedido \`${order.id}\`. Reponha urgente!`, 0xe74c3c);
  }
  alertLowStock(interaction.client, order.guildId).catch(()=>null);
  const feedbackChannelId = getGuildConfig(order.guildId).sales.channels.feedbackChannel;
  const feedbackChannel = feedbackChannelId ? await interaction.client.channels.fetch(feedbackChannelId).catch(()=>null) : null;
  if(feedbackChannel?.isTextBased()){
    const fbEmbed = new EmbedBuilder().setColor(0xffd700).setTitle(`⭐ Avalie sua compra SyncBuxx`).setThumbnail(order.robloxAvatar||null).setDescription(`<@${order.userId}> comprou **${order.quantity} Robux** por **${vorkbuxStore.formatBRL(order.total)}**\nDeixe sua avaliação!`).setTimestamp();
    feedbackChannel.send({ content:`<@${order.userId}>`, embeds:[fbEmbed], components:[new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`vorkbux:feedback:${order.id}`).setPlaceholder("Avalie de 1 a 5 estrelas").addOptions(
      { label:"⭐⭐⭐⭐⭐ Excelente", value:"5", emoji:"⭐" }, { label:"⭐⭐⭐⭐ Ótimo", value:"4" }, { label:"⭐⭐⭐ Bom", value:"3" }, { label:"⭐⭐ Ruim", value:"2" }, { label:"⭐ Péssimo", value:"1" }
    ))] }).catch(()=>null);
  }
  const ratePanel = new ContainerBuilder().setAccentColor(0xffd700);
  ratePanel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(interaction.client,"star")} Avalie sua experiência\nSua opinião ajuda muito! Selecione 1-5 estrelas abaixo.`));
  ratePanel.addActionRowComponents(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`vorkbux:feedback:${order.id}`).setPlaceholder("⭐ Avaliar agora").addOptions(
    { label:"⭐⭐⭐⭐⭐ Excelente", value:"5" }, { label:"⭐⭐⭐⭐ Ótimo", value:"4" }, { label:"⭐⭐⭐ Bom", value:"3" }, { label:"⭐⭐ Ruim", value:"2" }, { label:"⭐ Péssimo", value:"1" }
  )));
  channel.send({ components:[ratePanel], flags:V2 }).catch(()=>null);
  setTimeout(async()=>{ try{ await channel.delete().catch(()=>null);}catch{} }, 5*60*1000);
  return true;
}
module.exports = {
  handleVorkbuxPanelComponent, handleVorkbuxModal, handleVorkbuxPublic, handleVorkbuxSelect, handleVorkbuxButton, handleVorkbuxModalQty, handleEntregue, setVorkbuxFlag, getVorkbuxFlag
};
