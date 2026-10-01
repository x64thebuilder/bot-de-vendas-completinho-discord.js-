const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType,
  ContainerBuilder, EmbedBuilder, MessageFlags, ModalBuilder, SeparatorBuilder,
  StringSelectMenuBuilder, TextDisplayBuilder, TextInputBuilder, TextInputStyle, MediaGalleryBuilder, ThumbnailBuilder, SectionBuilder
} = require("discord.js");
const { ids } = require("../../config");
const { getGuildConfig } = require("../../storage");
const vorkbuxStore = require("./store");
const { componentEmoji, scoped, inlineEmoji } = require("../panel");
const V2 = MessageFlags.IsComponentsV2;
const V2_EPH = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
const VORK_COLOR = 0x0a0e14;
const VORK_ACCENT = 0x00ff88;
const VORK_GOLD = 0xffd700;
function payload(c) { return { components:[c], flags:V2 } }
function ephemeral(c) { return { components:[c], flags:V2_EPH } }
function back(client, id, userId) { return withEmoji(new ButtonBuilder().setCustomId(scoped(id,userId)).setLabel("Voltar").setStyle(ButtonStyle.Secondary), client, "reload"); }
function withEmoji(b, client, name) { const e=client.appEmojis?.get(require("../../emojis").normalizeEmojiName(name)); return e? b.setEmoji({id:e.id,name:e.name,animated:e.animated}):b; }
function emojiText(client, name){ return inlineEmoji(client,name); }
function code(v){ return `\`${v}\``; }
function badge(active, client){ return active ? `${emojiText(client,"ligado")} ${code("Ativo")}` : `${emojiText(client,"desligado")} ${code("Inativo")}`; }
function vorkbuxMainPanel(client, guildId, userId){
  const cfg = getGuildConfig(guildId);
  const vb = cfg.vorkbux;
  const products = vorkbuxStore.getProducts();
  const guild = client.guilds.cache.get(guildId);
  const robuxOn = getVorkbuxFlag(guildId,"robux");
  const gameOn = getVorkbuxFlag(guildId,"gamepass");
  const botAvatar = client.user?.displayAvatarURL({ extension:"png", size:128 }) || null;
  const panel = new ContainerBuilder().setAccentColor(robuxOn||gameOn ? VORK_ACCENT : 0x2b2d31);
  try{
    const header = new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## ${emojiText(client,"robux")} SyncBuxx — Painel de Controle`),
        new TextDisplayBuilder().setContent(`-# Gerencie vendas de **Robux via Gamepass & Grupo** com entrega automática e logs premium.`)
      );
    if(botAvatar) header.setThumbnailAccessory(new ThumbnailBuilder().setURL(botAvatar).setDescription("SyncBuxx"));
    panel.addSectionComponents(header);
  } catch{
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${emojiText(client,"robux")} SyncBuxx — Painel de Controle`));
  }
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  const statusLine = `${emojiText(client,"robux")} Robux — ${badge(robuxOn,client)}   ${emojiText(client,"caixa")} Gamepass — ${badge(gameOn,client)}`;
  const catalogLine = `${emojiText(client,"caixa")} Catálogo Gamepass — ${code(products.length+" jogo(s)")}   ${emojiText(client,"ligado")} Carteira Integrada — ${code("Ativa")}`;
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(statusLine));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(catalogLine));
  if(vb.pricePer1000) panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${emojiText(client,"pricep")} Preço: **${vorkbuxStore.formatBRL(vb.pricePer1000)}/1000** • Limites: ${code(vb.minRobux+"–"+vb.maxRobux+" Robux")} • Estoque Grupo: ${code(vb.group.stock+" Robux")}`));
  else panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${emojiText(client,"clock")} Configure preço e limites em **Produtos** para liberar vendas.`));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(scoped(ids.vorkbuxModeSelect,userId))
      .setPlaceholder("Alternar modalidade de venda...")
      .addOptions(
        { label: robuxOn ? "Desativar Robux" : "Ativar Robux", value:"toggle_robux", description: robuxOn ? "Pausar vendas via Grupo" : "Liberar vendas de Robux via Grupo", emoji: componentEmoji(client,"robux")||undefined },
        { label: gameOn ? "Desativar Gamepass" : "Ativar Gamepass", value:"toggle_gamepass", description: gameOn ? "Pausar vendas via Gamepass" : "Liberar vendas via Gamepass 30% Roblox", emoji: componentEmoji(client,"caixa")||undefined }
      )
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder().setCustomId(scoped(ids.vorkbuxProducts,userId)).setLabel("Produtos").setStyle(ButtonStyle.Primary), client, "caixa"),
    withEmoji(new ButtonBuilder().setCustomId(scoped(ids.vorkbuxPurchase,userId)).setLabel("Mensagem de Compra").setStyle(ButtonStyle.Secondary), client, "recibo"),
    withEmoji(new ButtonBuilder().setCustomId(scoped("vorkbux:stats",userId)).setLabel("Estatísticas").setStyle(ButtonStyle.Secondary), client, "rendimentos"),
    back(client, "panel:back:main", userId)
  ));
  const stats=vorkbuxStore.getStats();
  if(stats.total>0) panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${emojiText(client,"pricep")} **${stats.paid}** vendas • **${vorkbuxStore.formatBRL(stats.revenue)}** faturado • **${stats.robuxTotal}** Robux entregues`));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${emojiText(client,"lightbulb")} **Dica:** Ative uma modalidade → Configure **Produtos** → Depois **Mensagem de Compra** e envie no canal.`));
  if(guild) panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${emojiText(client,"casa")} ${guild.name} • ${guild.memberCount||"—"} membros`));
  return panel;
}
function getVorkbuxFlag(guildId, key){
  const store = require("../../guildDb").readGuildFile(null,"vorkbux_flags",()=>({ robux:false, gamepass:false }));
  if(key==="robux") return Boolean(store.robux);
  return Boolean(store.gamepass);
}
function setVorkbuxFlag(guildId, key, val){
  const { readGuildFile, writeGuildFile } = require("../../guildDb");
  const store = readGuildFile(null,"vorkbux_flags",()=>({ robux:false, gamepass:false }));
  if(key==="robux") store.robux = Boolean(val);
  if(key==="gamepass") store.gamepass = Boolean(val);
  writeGuildFile(null,"vorkbux_flags", store);
}
function vorkbuxProductsPanel(client, guildId, userId){
  const cfg = getGuildConfig(guildId);
  const vb = cfg.vorkbux;
  const products = vorkbuxStore.getProducts();
  const totalFields = products.reduce((a,p)=>a+Object.keys(p.fields||{}).length,0);
  const fieldStockTotal = products.reduce((a,p)=>a+Object.values(p.fields||{}).reduce((s,f)=>s+(f.infinite?9999:f.stock||0),0),0);
  const panel = new ContainerBuilder().setAccentColor(VORK_ACCENT);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${emojiText(client,"caixa")} Produtos — SyncBuxx`));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`Configure **preço, limites, grupo e catálogo** de jogos. Tudo fica salvo instantaneamente.`));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${emojiText(client,"pricep")} **Preço:** ${vb.pricePer1000 ? `**${vorkbuxStore.formatBRL(vb.pricePer1000)}** ${code("/ 1000 Robux")}` : code("não definido — clique em Configurar preço")}\n`+
    `${emojiText(client,"clock")} **Limites:** min ${code(vb.minRobux)} — max ${code(vb.maxRobux)} Robux\n`+
    `${emojiText(client,"users")} **Grupo:** ${vb.group.url ? `${code("configurado")} • ${vorkbuxStore.formatBRL(vb.group.pricePer1000)}/1000 • estoque **${vb.group.stock}**` : code("não configurado")}\n`+
    `${emojiText(client,"caixa")} **Jogos:** ${code(products.length+" criado(s)")} • **Itens:** ${code(totalFields+" campo(s)")} • **Unidades:** ${code(fieldStockTotal)}`
  ));
  if(vb.group.url) panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# 🔗 ${vb.group.url.slice(0,80)}...`));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(scoped(ids.vorkbuxProductsSelect,userId))
      .setPlaceholder("Selecione o que configurar")
      .addOptions(
        { label:"Configurar preço", value:"price", description:`Valor de 1000 Robux em R$ (atual ${vb.pricePer1000||0})`, emoji: componentEmoji(client,"pricep") },
        { label:"Configurar limites", value:"limits", description:`Mín ${vb.minRobux} • Máx ${vb.maxRobux}`, emoji: componentEmoji(client,"clock") },
        { label:"Configurar grupo", value:"group", description: vb.group.url ? "URL + preço + estoque" : "Definir grupo Roblox", emoji: componentEmoji(client,"users") }
      )
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder().setCustomId(scoped(ids.vorkbuxCreateProduct,userId)).setLabel("Criar produto").setStyle(ButtonStyle.Success), client, "mais2"),
    withEmoji(new ButtonBuilder().setCustomId(scoped(ids.vorkbuxEditProduct,userId)).setLabel("Editar produto").setStyle(ButtonStyle.Secondary), client, "editar"),
    back(client, ids.vorkbuxEntry, userId)
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${emojiText(client,"lightbulb")} **Fluxo:** 1. Defina preço/limites 2. Configure grupo 3. Crie jogos e itens.`));
  return panel;
}
function vorkbuxGroupPanel(client, guildId, userId){
  const cfg = getGuildConfig(guildId).vorkbux;
  const hasGroup = Boolean(cfg.group.url);
  const panel = new ContainerBuilder().setAccentColor(hasGroup ? VORK_ACCENT : 0x2b2d31);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${emojiText(client,"users")} Configurar Grupo`));
  panel.addSeparatorComponents(new SeparatorBuilder());
  if(hasGroup){
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `${emojiText(client,"ligado")} **Status:** ${code("Configurado")}\n`+
      `**URL:** ${cfg.group.url}\n`+
      `**Preço/1000 via grupo:** **${vorkbuxStore.formatBRL(cfg.group.pricePer1000)}**\n`+
      `**Estoque atual:** **${cfg.group.stock} Robux** ${cfg.group.stock<500 ? `⚠️ ${code("baixo")}` : `✅ ${code("ok")}`}`
    ));
    const pct = Math.min(100, Math.round(cfg.group.stock/10000*100));
    const bar = "█".repeat(Math.round(pct/10)) + "░".repeat(10-Math.round(pct/10));
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Estoque: [${bar}] ${pct}%`));
  } else {
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `${emojiText(client,"desligado")} **Nenhum grupo configurado.**\n`+
      `Clique em **Configurar Grupo** para definir URL e preço por 1000 via grupo.\n`+
      `-# Ex: \`https://www.roblox.com/groups/0000000/seu-grupo\``
    ));
  }
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder().setCustomId(scoped(ids.vorkbuxGroupPanel+":config",userId)).setLabel(hasGroup?"Reconfigurar Grupo":"Configurar Grupo").setStyle(ButtonStyle.Primary), client, "editar"),
    withEmoji(new ButtonBuilder().setCustomId(scoped(ids.vorkbuxGroupPanel+":stock",userId)).setLabel("Definir estoque").setStyle(hasGroup?ButtonStyle.Success:ButtonStyle.Secondary), client, "db"),
    back(client, ids.vorkbuxProducts, userId)
  ));
  if(hasGroup) panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${emojiText(client,"lightbulb")} Grupo entrega em até **14 dias** (taxa interna Roblox). Mantenha estoque sempre > 2000.`));
  return panel;
}
function vorkbuxEditProductListPanel(client, guildId, userId){
  const products = vorkbuxStore.getProducts();
  const panel = new ContainerBuilder().setAccentColor(VORK_COLOR);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${emojiText(client,"editar")} Editar Produto`));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`Selecione um jogo para gerenciar **itens, preços e estoque**.`));
  panel.addSeparatorComponents(new SeparatorBuilder());
  if(!products.length){
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `${emojiText(client,"negativo")} **Nenhum produto criado ainda.**\n`+
      `-# Clique em **Voltar** → **Criar produto** para adicionar seu primeiro jogo (ex: Blox Fruits).`
    ));
    panel.addActionRowComponents(new ActionRowBuilder().addComponents(back(client, ids.vorkbuxProducts, userId)));
    return panel;
  }
  const sorted = [...products].sort((a,b)=>b.createdAt-a.createdAt);
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(scoped(ids.vorkbuxEditSelect,userId))
      .setPlaceholder(`Selecione um produto (${products.length} disponível)`)
      .addOptions(sorted.slice(0,25).map(p=>{
        const count = Object.keys(p.fields||{}).length;
        const emoji = p.emoji ? undefined : componentEmoji(client,"caixa");
        return {
          label: p.name.slice(0,80), value:p.id, description:`${count} item(s) • ${p.emoji||"sem emoji"}`, emoji
        };
      }))
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(back(client, ids.vorkbuxProducts, userId)));
  return panel;
}
function vorkbuxProductDetailPanel(client, guildId, userId, productId){
  const p = vorkbuxStore.getProduct(productId);
  if(!p) return vorkbuxEditProductListPanel(client,guildId,userId);
  const fields = Object.values(p.fields||{});
  const totalValue = fields.reduce((a,f)=>a+f.price,0);
  const panel = new ContainerBuilder().setAccentColor(VORK_ACCENT);
  const emojiStr = p.emoji ? `${p.emoji} ` : `${emojiText(client,"caixa")}`;
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${emojiStr}${p.name}`));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${emojiText(client,"fields")} **${fields.length}** campo(s) • **Total:** ${vorkbuxStore.formatBRL(totalValue)} • Criado <t:${Math.floor(p.createdAt/1000)}:R>`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Gerencie itens vendáveis dentro deste jogo. Cada campo é um produto (ex: Fruta Mítica) com preço e estoque próprio.`));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder().setCustomId(scoped(`${ids.vorkbuxFieldCreate}:${productId}`,userId)).setLabel("Adicionar Campo").setStyle(ButtonStyle.Success), client, "mais2"),
    withEmoji(new ButtonBuilder().setCustomId(scoped(`${ids.vorkbuxDeleteProduct}:${productId}`,userId)).setLabel("Deletar produto").setStyle(ButtonStyle.Danger), client, "apagar"),
    back(client, ids.vorkbuxEditProduct, userId)
  ));
  if(fields.length){
    const list = fields.slice(0,5).map(f=> `• **${f.name}** — ${vorkbuxStore.formatBRL(f.price)} • ${f.infinite? "`∞ infinito`": code(f.stock+" un")}`).join("\n");
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(list + (fields.length>5? `\n-# +${fields.length-5} mais...`:``)));
    panel.addActionRowComponents(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(scoped(`${ids.vorkbuxFieldSelect}:${productId}`,userId))
        .setPlaceholder("Selecione um campo para editar")
        .addOptions(fields.slice(0,25).map(f=>({
          label: f.name.slice(0,80), value:f.id, description:`${vorkbuxStore.formatBRL(f.price)} • ${f.infinite ? "∞ infinito" : f.stock+" un"}`, emoji: componentEmoji(client,"pricep")
        })))
    ));
  } else {
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `${emojiText(client,"desligado")} **Nenhum campo criado.**\n`+
      `-# Clique em **Adicionar Campo** para criar o primeiro item (ex: Fruta Mítica — R$ 49,90).`
    ));
  }
  return panel;
}
function vorkbuxFieldDetailPanel(client, guildId, userId, productId, fieldId){
  const f = vorkbuxStore.getField(productId, fieldId);
  if(!f) return vorkbuxProductDetailPanel(client,guildId,userId,productId);
  const panel = new ContainerBuilder().setAccentColor(f.infinite ? VORK_GOLD : VORK_ACCENT);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${emojiText(client,"pricep")} ${f.name}`));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  const stockText = f.infinite ? `**Infinito** ${code("♾️")} • ${code("sempre disponível")}` : `**${f.stock} unidades** ${f.stock===0? "⚠️ "+code("esgotado") : f.stock<5? "⚠️ "+code("baixo") : "✅ "+code("ok")}`;
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${emojiText(client,"dollar")} **Preço:** **${vorkbuxStore.formatBRL(f.price)}**\n`+
    `${emojiText(client,"db")} **Estoque:** ${stockText}`
  ));
  if(!f.infinite){
    const barLen = Math.min(10, Math.max(0, Math.round(f.stock/20)));
    const bar = "█".repeat(barLen) + "░".repeat(10-barLen);
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Estoque: [${bar}] ${f.stock} un`));
  }
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder().setCustomId(scoped(`${ids.vorkbuxFieldAction}:name:${productId}:${fieldId}`,userId)).setLabel("Mudar nome").setStyle(ButtonStyle.Secondary), client, "editar"),
    withEmoji(new ButtonBuilder().setCustomId(scoped(`${ids.vorkbuxFieldAction}:price:${productId}:${fieldId}`,userId)).setLabel("Mudar preço").setStyle(ButtonStyle.Secondary), client, "pricep"),
    withEmoji(new ButtonBuilder().setCustomId(scoped(`${ids.vorkbuxFieldStockToggle}:${productId}:${fieldId}`,userId)).setLabel(f.infinite ? "Mudar para unidades" : "Alterar → Infinito").setStyle(f.infinite ? ButtonStyle.Danger : ButtonStyle.Primary), client, f.infinite? "desligado":"ligado")
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder().setCustomId(scoped(`${ids.vorkbuxFieldQuantity}:${productId}:${fieldId}`,userId)).setLabel("Mudar quantidade").setStyle(ButtonStyle.Secondary), client, "hash").setDisabled(f.infinite),
    withEmoji(new ButtonBuilder().setCustomId(scoped(`${ids.vorkbuxFieldDelete}:${productId}:${fieldId}`,userId)).setLabel("Excluir campo").setStyle(ButtonStyle.Danger), client, "apagar"),
    back(client, `${ids.vorkbuxEditSelect}:back:${productId}`, userId)
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${emojiText(client,"lightbulb")} **Infinito:** vende sempre • **Unidades:** desconta 1 por venda.`));
  return panel;
}
function vorkbuxPurchasePanel(client, guildId, userId){
  const cfg = getGuildConfig(guildId).vorkbux.purchase;
  const isReady = Boolean(cfg.title);
  const systemOn = getVorkbuxFlag(guildId,"robux")||getVorkbuxFlag(guildId,"gamepass");
  const panel = new ContainerBuilder().setAccentColor(isReady && systemOn ? VORK_ACCENT : 0x2b2d31);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${emojiText(client,"recibo")} Mensagem de Compra — SyncBuxx`));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `Defina **como** o painel público aparece. Suporta **3 modos** e variáveis dinâmicas.\n`+
    `-# Variáveis: ${code("{usuario}")} ${code("{robux}")} ${code("{total}")} ${code("{data}")} ${code("{itens}")} • Ex: "Olá {usuario}, {robux} Robux por {total}"`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  const titleBadge = cfg.title ? `**${cfg.title.slice(0,50)}**` : code("Não definido ⚠️");
  const descBadge = cfg.description ? code(cfg.description.slice(0,40)+"...") : code("Não definida");
  const colorBadge = cfg.color ? code(`#${cfg.color.toString(16).padStart(6,"0").toUpperCase()}`) : code("Padrão #FFFFFF");
  const bannerBadge = cfg.banner ? code("configurado ✅") : code("Nenhum");
  const thumbBadge = cfg.thumbnail ? code("configurado ✅") : code("—");
  const channelBadge = cfg.channelId ? `<#${cfg.channelId}> ✅` : code("não configurado — clique em Definir Canal ⚠️");
  const modeBadge = cfg.mode ? code(cfg.mode) : code("container");
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${emojiText(client,"embed")} **Título:** ${titleBadge}\n`+
    `${emojiText(client,"fields")} **Descrição:** ${descBadge}\n`+
    `${emojiText(client,"wand")} **Cor:** ${colorBadge} • **Modo:** ${modeBadge}\n`+
    `${emojiText(client,"preview")} **Banner:** ${bannerBadge} • **Thumbnail:** ${thumbBadge}\n`+
    `${emojiText(client,"canal")} **Canal:** ${channelBadge}`
  ));
  if(!isReady) panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${emojiText(client,"ban")} **Obrigatório:** defina pelo menos o **título**.`));
  if(!systemOn) panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${emojiText(client,"ban")} **Ative Robux ou Gamepass** no painel principal para liberar vendas.`));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(scoped(ids.vorkbuxPurchaseModeSelect,userId))
      .setPlaceholder(cfg.mode ? `Modo atual: ${cfg.mode} — clique para mudar` : "Selecione o modo do painel")
      .addOptions(
        { label:"Container", value:"container", description:"Components V2 — premium (recomendado)", emoji: componentEmoji(client,"caixa"), default: cfg.mode==="container" },
        { label:"Embed", value:"embed", description:"Embed clássico com cor e imagem", emoji: componentEmoji(client,"embed"), default: cfg.mode==="embed" },
        { label:"Mensagem de texto", value:"message", description:"Texto simples + botão", emoji: componentEmoji(client,"recibo"), default: cfg.mode==="message" }
      )
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder().setCustomId(scoped("vorkbux:purchase:edittext",userId)).setLabel("Editar Texto").setStyle(isReady?ButtonStyle.Secondary:ButtonStyle.Primary), client, "editar"),
    withEmoji(new ButtonBuilder().setCustomId(scoped("vorkbux:purchase:visual",userId)).setLabel("Personalizar Visual").setStyle(ButtonStyle.Secondary), client, "wand"),
    withEmoji(new ButtonBuilder().setCustomId(scoped("vorkbux:purchase:channel",userId)).setLabel("Definir Canal").setStyle(cfg.channelId?ButtonStyle.Secondary:ButtonStyle.Danger), client, "canal")
  ));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder().setCustomId(scoped(ids.vorkbuxPurchasePreview,userId)).setLabel("Visualizar").setStyle(ButtonStyle.Secondary), client, "preview"),
    withEmoji(new ButtonBuilder().setCustomId(scoped(ids.vorkbuxPurchaseSend,userId)).setLabel("Enviar no Canal").setStyle(isReady&&systemOn&&cfg.channelId?ButtonStyle.Success:ButtonStyle.Secondary), client, "canal").setDisabled(!(isReady&&systemOn&&cfg.channelId)),
    back(client, ids.vorkbuxEntry, userId)
  ));
  if(cfg.banner) panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Banner preview: ${cfg.banner.slice(0,60)}...`));
  return panel;
}
function vorkbuxPurchaseChannelPicker(client, userId){
  const panel = new ContainerBuilder().setAccentColor(VORK_ACCENT);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${emojiText(client,"canal")} Definir Canal — SyncBuxx`));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `Escolha o **canal de texto** onde o painel público com botão **Adquirir Agora** será enviado.\n`+
    `-# Dica: use um canal dedicado como ${code("#vorkbux")} ou ${code("#compre-robux")}. O bot precisa de **Ver canal + Enviar mensagens**.`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder().setCustomId(scoped(ids.vorkbuxPurchaseChannelSelect,userId)).setPlaceholder("Selecione um canal de texto").setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(1).setMaxValues(1)
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Ou clique abaixo para colar o ID manualmente (ativar modo dev → Copiar ID).`));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder().setCustomId(scoped("vorkbux:purchase:addid",userId)).setLabel("Adicionar ID").setStyle(ButtonStyle.Secondary), client, "hash"),
    back(client, ids.vorkbuxPurchase, userId)
  ));
  return panel;
}
function buildPublicPanel(client, guildId){
  const cfg = getGuildConfig(guildId).vorkbux.purchase;
  const guild = client.guilds.cache.get(guildId);
  const now = new Date().toLocaleDateString("pt-BR");
  const title = (cfg.title || "SyncBuxx — Robux Instantâneo").replace("{usuario}", "Você").replace("{robux}", "1000").replace("{total}", vorkbuxStore.formatBRL(getGuildConfig(guildId).vorkbux.pricePer1000||30)).replace("{data}", now).replace("{itens}", "Robux");
  const descRaw = cfg.description || "Compre **Robux** com segurança via **Gamepass** ou **Grupo**. Entrega rápida, suporte 24h e pagamento **Pix** instantâneo. Clique abaixo e garanta já!";
  const desc = descRaw.replace("{usuario}", "Você").replace("{robux}", "1000").replace("{total}", vorkbuxStore.formatBRL(getGuildConfig(guildId).vorkbux.pricePer1000||30)).replace("{data}", now).replace("{itens}", "Robux");
  const color = cfg.color || VORK_ACCENT;
  const price = getGuildConfig(guildId).vorkbux.pricePer1000 || 0;
  const footerText = `SyncBuxx • ${guild?.name||"Servidor"} • ${price? vorkbuxStore.formatBRL(price)+"/1000":"Preço sob consulta"}`;
  if(cfg.mode==="embed"){
    const embed = new EmbedBuilder().setColor(color).setTitle(`💎 ${title}`).setDescription(`${desc}\n\n**Escolha Gamepass ou Grupo no carrinho.**`);
    if(cfg.banner) embed.setImage(cfg.banner);
    if(cfg.thumbnail) embed.setThumbnail(cfg.thumbnail);
    embed.addFields(
      { name:"💰 Preço", value: price? `**${vorkbuxStore.formatBRL(price)}/1000**` : code("Consulte"), inline:true },
      { name:"⚡ Entrega", value: code("Até 5 dias"), inline:true },
      { name:"🔒 Seguro", value: code("Garantido"), inline:true }
    );
    embed.setFooter({ text: footerText, iconURL: client.user?.displayAvatarURL()||undefined }).setTimestamp();
    return { embeds:[embed], components:[new ActionRowBuilder().addComponents(withEmoji(new ButtonBuilder().setCustomId(`vorkbux:buy:${guildId}`).setLabel("Adquirir Agora — Comprar Robux").setStyle(ButtonStyle.Success), client, "robux"))] };
  }
  if(cfg.mode==="message"){
    const content = `**💎 ${title}**\n${desc}\n\n${inlineEmoji(client,"pix")} **Pix** • ${inlineEmoji(client,"robux")} **Robux** • ${inlineEmoji(client,"clock")} Entrega rápida\n-# ${footerText}`;
    return { content, components:[new ActionRowBuilder().addComponents(withEmoji(new ButtonBuilder().setCustomId(`vorkbux:buy:${guildId}`).setLabel("Adquirir Agora").setStyle(ButtonStyle.Success), client, "robux"))] };
  }
  const container = new ContainerBuilder().setAccentColor(color);
  if(cfg.thumbnail){
    try{
      container.addSectionComponents(new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"robux")} ${title}`),
          new TextDisplayBuilder().setContent(desc)
        ).setThumbnailAccessory(new ThumbnailBuilder().setURL(cfg.thumbnail).setDescription("SyncBuxx"))
      );
    } catch{
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"robux")} ${title}\n${desc}`));
    }
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${inlineEmoji(client,"robux")} ${title}\n${desc}`));
  }
  if(cfg.banner){
    try{ container.addMediaGalleryComponents(new MediaGalleryBuilder({ items:[{ media:{url:cfg.banner}, description:title }] })); } catch{}
  }
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${inlineEmoji(client,"pricep")} **Preço:** ${price? `**${vorkbuxStore.formatBRL(price)}/1000**` : code("Consulte no carrinho")}  •  ${inlineEmoji(client,"clock")} **Entrega:** ${code("Até 5 dias")}  •  ${inlineEmoji(client,"ligado")} **Seguro:** ${code("Garantido")}`
  ));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(withEmoji(new ButtonBuilder().setCustomId(`vorkbux:buy:${guildId}`).setLabel("Adquirir Agora").setStyle(ButtonStyle.Success), client, "robux")));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${inlineEmoji(client,"pix")} **Pix instantâneo** • ${inlineEmoji(client,"users")} **Grupo** ou ${inlineEmoji(client,"robux")} **Gamepass** • ${inlineEmoji(client,"lightbulb")} Suporte 24h • ${footerText}`));
  return { components:[container], flags:V2 };
}
function vorkbuxStatsPanel(client, guildId, userId){
  const stats=vorkbuxStore.getStats();
  const vb=getGuildConfig(guildId).vorkbux;
  const panel=new ContainerBuilder().setAccentColor(VORK_ACCENT);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${emojiText(client,"rendimentos")} Estatísticas SyncBuxx`));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`Visão premium do faturamento e desempenho.`));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${emojiText(client,"bag")} **Pedidos:** ${code(stats.total+" total")} • ${code(stats.paid+" pagos")} • ${code(stats.pending+" pendentes")}\n`+
    `${emojiText(client,"pricep")} **Receita:** **${vorkbuxStore.formatBRL(stats.revenue)}** • **Robux:** **${stats.robuxTotal}**\n`+
    `${emojiText(client,"users")} **Grupo estoque:** ${code(vb.group.stock+" Robux")} ${vb.group.stock<1000?"⚠️"+code("baixo"):"✅"}\n`+
    `${emojiText(client,"clock")} **Preço:** ${vorkbuxStore.formatBRL(vb.pricePer1000||0)}/1000 • **Limites:** ${vb.minRobux}–${vb.maxRobux}`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    withEmoji(new ButtonBuilder().setCustomId(scoped("vorkbux:orders",userId)).setLabel("Ver Pedidos").setStyle(ButtonStyle.Primary), client, "recibo"),
    back(client, ids.vorkbuxEntry, userId)
  ));
  return panel;
}
function vorkbuxOrdersPanel(client, guildId, userId){
  const orders=vorkbuxStore.listOrders().slice(0,10);
  const panel=new ContainerBuilder().setAccentColor(VORK_ACCENT);
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${emojiText(client,"recibo")} Pedidos Recentes — SyncBuxx`));
  if(!orders.length){
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${emojiText(client,"desligado")} Nenhum pedido ainda.`));
  } else {
    const lines=orders.map(o=>{
      const st={ quantity:"🟡 Quantidade", await_approval:"🟠 Aguardando aprovação", paid:"🟢 Pago", await_delivery:"🔵 Aguardando Gamepass", delivered:"✅ Entregue", cancelled:"🔴 Cancelado"}[o.status]||o.status;
      return `• ${code("#"+o.id.slice(-6))} <@${o.userId}> — **${o.quantity||"?"} Robux** • ${vorkbuxStore.formatBRL(o.total||0)} • ${st} • <t:${Math.floor((o.createdAt||Date.now())/1000)}:R>`;
    }).join("\n");
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));
  }
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(back(client, ids.vorkbuxEntry, userId)));
  return panel;
}
module.exports = {
  vorkbuxMainPanel, vorkbuxProductsPanel, vorkbuxGroupPanel, vorkbuxEditProductListPanel, vorkbuxProductDetailPanel, vorkbuxFieldDetailPanel, vorkbuxPurchasePanel, vorkbuxPurchaseChannelPicker, buildPublicPanel, vorkbuxStatsPanel, vorkbuxOrdersPanel,
  getVorkbuxFlag, setVorkbuxFlag, payload, ephemeral
};
