const path = require("node:path");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder
} = require("discord.js");
const { ids } = require("../../config");
const { getGuildConfig, setGuildConfig } = require("../../storage");
const { componentEmoji, inlineEmoji, scoped } = require("../panel");
const V2 = MessageFlags.IsComponentsV2;
const GREEN = "#10b981";
const BRIGHT = "#34d399";
const WHITE = "#ffffff";
const FONTS_DIR = path.join(__dirname, "..", "..", "assets", "fonts");
let fontsRegistered = false;
function registerFonts() {
  if (fontsRegistered) return;
  fontsRegistered = true;
  try {
    const { GlobalFonts } = require("@napi-rs/canvas");
    for (const file of ["Inter-Regular.otf", "Inter-SemiBold.otf", "Inter-Bold.otf", "Inter-ExtraBold.otf"]) {
      try {
        GlobalFonts.registerFromPath(path.join(FONTS_DIR, file), "Inter");
      } catch {   }
    }
  } catch {   }
}
function getReceiptSettings(guildId) {
  const sales = getGuildConfig(guildId).sales || {};
  return {
    channelId: sales.channels?.publicLogs || null,
    mode: sales.receiptMode === "image" ? "image" : "container"
  };
}
function accent(guildId) {
  try {
    return getGuildConfig(guildId).customColor || 0xffffff;
  } catch {
    return 0xffffff;
  }
}
async function safeUpdate(interaction, payload) {
  try {
    if (!interaction.isRepliable()) return null;
    if (interaction.replied || interaction.deferred) {
      return await interaction.editReply(payload).catch(() => null);
    }
    return await interaction.update(payload).catch(() => null);
  } catch { return null; }
}
async function safeReply(interaction, payload) {
  try {
    if (!interaction.isRepliable()) return null;
    if (interaction.replied || interaction.deferred) {
      return await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => null);
    }
    return await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => null);
  } catch { return null; }
}
function panelPayload(component) {
  return { components: [component], flags: V2 };
}
function receiptPanel(client, guildId, userId) {
  const { channelId, mode } = getReceiptSettings(guildId);
  const panel = new ContainerBuilder().setAccentColor(accent(guildId));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${inlineEmoji(client, "carrinhoCancelado")}Log de Compra`
  ));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `Escolha **como** o recibo de cada venda entregue aparece.\n` +
    `${inlineEmoji(client, "canal")} **Canal:** ${channelId ? `<#${channelId}>` : "não configurado"} (Sales • logs públicos — configura em **Configurações → Canais**)\n` +
    `${inlineEmoji(client, "preview")} **Tipo:** ${mode === "image" ? "**Log imagem** (recibo PNG verde)" : "**Log container** (cartão em texto)"}`
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(scoped(ids.salesReceiptMode, userId))
      .setPlaceholder("Tipo do log: container ou imagem")
      .addOptions(
        {
          label: "Log container",
          value: "container",
          description: mode === "container" ? "Atual • cartão em texto" : "Cartão em texto (sempre funciona)",
          emoji: componentEmoji(client, "embed")
        },
        {
          label: "Log imagem",
          value: "image",
          description: mode === "image" ? "Atual • recibo PNG verde" : "Recibo PNG verde e branco",
          emoji: componentEmoji(client, "preview")
        }
      )
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(scoped("panel:customize", userId))
      .setLabel("Voltar")
      .setStyle(ButtonStyle.Secondary)
  ));
  return panel;
}
async function handleReceiptPanelComponent(interaction, baseId) {
  const client = interaction.client;
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  if (baseId === ids.salesReceipt) {
    await safeUpdate(interaction, panelPayload(receiptPanel(client, guildId, userId)));
    return true;
  }
  if (baseId === ids.salesReceiptMode) {
    const value = interaction.values?.[0];
    if (value !== "container" && value !== "image") return true;
    setGuildConfig(guildId, (cfg) => {
      cfg.sales.receiptMode = value;
      return cfg;
    });
    await safeUpdate(interaction, panelPayload(receiptPanel(client, guildId, userId)));
    if (value === "image" && !canvasAvailable()) {
      await safeReply(interaction, {
        content: "Modo imagem salvo, mas o gerador ainda não está instalado — rode `npm install` (baixa @napi-rs/canvas sozinho) ou o bot usa o container até lá."
      });
    }
    return true;
  }
  return false;
}
function canvasAvailable() {
  try {
    require("@napi-rs/canvas");
    return true;
  } catch {
    return false;
  }
}
function fmtBRL(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));
}
function receiptContainer(client, order, buyer, guild, extraComponents = []) {
  const name = buyer?.displayName || buyer?.username || "Cliente";
  const handle = buyer?.username ? ` (@${buyer.username})` : "";
  const lines = receiptLines(order);
  const total = fmtBRL(order.total);
  const avatarUrl = buyer?.displayAvatarURL ? buyer.displayAvatarURL({ extension: "png", size: 128 }) : null;
  const panel = new ContainerBuilder().setAccentColor(0x10b981);
  try {
    const section = new SectionBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## ${inlineEmoji(client, "pedidoEntregue")}Compra Realizada`),
      new TextDisplayBuilder().setContent(`**${name}**${handle} • Pedido \`#${String(order.id).slice(-6)}\``)
    );
    if (avatarUrl) section.setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarUrl).setDescription(name));
    panel.addSectionComponents(section);
  } catch {
    panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## ${inlineEmoji(client, "pedidoEntregue")}Compra Realizada\n**${name}**${handle} • Pedido \`#${String(order.id).slice(-6)}\``
    ));
  }
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `${inlineEmoji(client, "carrinhoCancelado")} **Carrinho**\n` +
    lines.map((l) => `**${l.qty}x** ${l.name} — ${l.value}`).join("\n") +
    (order.couponCode ? `\n${inlineEmoji(client, "cupom")} Cupom \`${order.couponCode}\` (−${order.couponPercent || 0}%)` : "")
  ));
  panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
  panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${inlineEmoji(client, "pix")}${total}\n-# Valor pago • ${guild?.name || "Loja"}`
  ));
  return { components: [panel, ...extraComponents], flags: V2 };
}
function receiptLines(order) {
  return [{ qty: order.quantity || 1, name: order.fieldName || order.productName || "Produto", value: fmtBRL(order.total) }];
}
function rr(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}
function fitText(ctx, text, maxWidth) {
  let out = String(text || "");
  if (ctx.measureText(out).width <= maxWidth) return out;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}
function spaced(ctx, text, x, y, tracking) {
  let cx = x;
  for (const ch of String(text)) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + tracking;
  }
  return cx - x - tracking;
}
function spacedCentered(ctx, text, centerX, y, tracking) {
  const chars = String(text).split("");
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + tracking * Math.max(0, chars.length - 1);
  let cx = centerX - total / 2;
  const prevAlign = ctx.textAlign;
  ctx.textAlign = "left";
  for (let i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i], cx, y);
    cx += widths[i] + tracking;
  }
  ctx.textAlign = prevAlign;
  return total;
}
async function fetchBuffer(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}
function formatDate(ts) {
  const d = new Date(Number(ts) || Date.now());
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} · ${p(d.getHours())}:${p(d.getMinutes())}`;
}
async function generateReceiptImage(data) {
  let canvasLib;
  try {
    canvasLib = require("@napi-rs/canvas");
  } catch {
    return null;
  }
  try {
    registerFonts();
    const { createCanvas, loadImage } = canvasLib;
    const W = 1280;
    const PAD = 88;
    const CW = W - PAD * 2;
    const FONT = `"Inter", "Segoe UI", "DejaVu Sans", Verdana, sans-serif`;
    const BG0 = "#0c100e";
    const BG1 = "#08080a";
    const INK = "#ffffff";
    const MUT = "#9aa5a0";
    const DIM = "#5d665f";
    const CARD0 = "#161b19";
    const CARD1 = "#111415";
    const EDGE = "#242c28";
    const lines = (data.lines || []).slice(0, 6);
    const extra = (data.lines || []).length - lines.length;
    const hasCoupon = Boolean(data.coupon);
    const canvas = createCanvas(W, 2600);
    const ctx = canvas.getContext("2d");
    const bg = ctx.createLinearGradient(0, 0, 0, 2600);
    bg.addColorStop(0, BG0);
    bg.addColorStop(1, BG1);
    ctx.fillStyle = bg;
    rr(ctx, 0, 0, W, 2600, 48);
    ctx.fill();
    let     orb = ctx.createRadialGradient(W - 120, 40, 40, W - 120, 40, 500);
    orb.addColorStop(0, "rgba(16,185,129,0.17)");
    orb.addColorStop(1, "rgba(16,185,129,0)");
    ctx.fillStyle = orb;
    ctx.fillRect(0, 0, W, 660);
    orb = ctx.createRadialGradient(60, 800, 40, 60, 800, 440);
    orb.addColorStop(0, "rgba(16,185,129,0.09)");
    orb.addColorStop(1, "rgba(16,185,129,0)");
    ctx.fillStyle = orb;
    ctx.fillRect(0, 420, 700, 480);
    ctx.save();
    rr(ctx, 0, 0, W, H, 48);
    ctx.clip();
    ctx.strokeStyle = "rgba(255,255,255,0.035)";
    ctx.lineWidth = 2;
    for (let d = -H; d < W + H; d += 30) {
      ctx.beginPath();
      ctx.moveTo(d, 0);
      ctx.lineTo(d + H, H);
      ctx.stroke();
    }
    ctx.restore();
    const BANNER_H = 720;
    if (data.bannerBuffer) {
      try {
        const banner = await loadImage(data.bannerBuffer);
        ctx.save();
        rr(ctx, 0, 0, W, 2600, 48);
        ctx.clip();
        const s = Math.max(W / banner.width, BANNER_H / banner.height);
        const dw = banner.width * s;
        const dh = banner.height * s;
        ctx.drawImage(banner, (W - dw) / 2, (BANNER_H - dh) / 2, dw, dh);
        ctx.fillStyle = "rgba(6,6,8,0.74)";
        ctx.fillRect(0, 0, W, BANNER_H);
        const fade = ctx.createLinearGradient(0, BANNER_H - 340, 0, BANNER_H);
        fade.addColorStop(0, "rgba(12,16,14,0)");
        fade.addColorStop(1, "rgba(12,16,14,1)");
        ctx.fillStyle = fade;
        ctx.fillRect(0, BANNER_H - 300, W, 300);
        ctx.restore();
      } catch {}
    }
    ctx.save();
    ctx.shadowColor = "rgba(16,185,129,0.8)";
    ctx.shadowBlur = 26;
    const bar = ctx.createLinearGradient(0, 48, 0, 2552);
    bar.addColorStop(0, BRIGHT);
    bar.addColorStop(1, GREEN);
    ctx.fillStyle = bar;
    ctx.fillRect(0, 48, 14, 2504);
    ctx.restore();
    let y = 76;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const markS = 58;
    const markG = ctx.createLinearGradient(PAD, y, PAD + markS, y + markS);
    markG.addColorStop(0, BRIGHT);
    markG.addColorStop(1, GREEN);
    ctx.fillStyle = markG;
    rr(ctx, PAD, y, markS, markS, 18);
    ctx.fill();
    ctx.strokeStyle = "#052e22";
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(PAD + 17, y + 30);
    ctx.lineTo(PAD + 26, y + 39);
    ctx.lineTo(PAD + 42, y + 20);
    ctx.stroke();
    ctx.fillStyle = MUT;
    ctx.font = `600 32px ${FONT}`;
    spaced(ctx, "RECIBO", PAD + markS + 26, y + markS / 2, 9);
    ctx.font = `700 30px ${FONT}`;
    const pillTW = ctx.measureText("PAGO").width;
    const pillW = pillTW + 96;
    const pillH = 62;
    const pillX = W - PAD - pillW;
    const pillY = y - 1;
    ctx.save();
    ctx.shadowColor = "rgba(16,185,129,0.45)";
    ctx.shadowBlur = 20;
    ctx.fillStyle = "rgba(16,185,129,0.12)";
    rr(ctx, pillX, pillY, pillW, pillH, 31);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 3;
    rr(ctx, pillX, pillY, pillW, pillH, 31);
    ctx.stroke();
    ctx.save();
    ctx.shadowColor = BRIGHT;
    ctx.shadowBlur = 12;
    ctx.fillStyle = BRIGHT;
    ctx.beginPath();
    ctx.arc(pillX + 42, pillY + pillH / 2, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = GREEN;
    ctx.fillText("PAGO", pillX + 62, pillY + pillH / 2 + 1);
    y += markS + 46;
    const avR = 68;
    const avCX = PAD + avR;
    const avCY = y + avR;
    if (data.avatarBuffer) {
      try {
        const avatar = await loadImage(data.avatarBuffer);
        ctx.save();
        ctx.beginPath();
        ctx.arc(avCX, avCY, avR, 0, Math.PI * 2);
        ctx.clip();
        const s = Math.max((avR * 2) / avatar.width, (avR * 2) / avatar.height);
        const dw = avatar.width * s;
        const dh = avatar.height * s;
        ctx.drawImage(avatar, avCX - dw / 2, avCY - dh / 2, dw, dh);
        ctx.restore();
      } catch {}
    }
    ctx.strokeStyle = "rgba(16,185,129,0.55)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(avCX, avCY, avR + 11, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "#2a322e";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(avCX, avCY, avR, 0, Math.PI * 2);
    ctx.stroke();
    const tx = PAD + avR * 2 + 40;
    ctx.fillStyle = INK;
    ctx.font = `700 60px ${FONT}`;
    ctx.fillText(fitText(ctx, data.buyerName || "Cliente", W - tx - PAD - 340), tx, avCY - 32);
    ctx.fillStyle = MUT;
    ctx.font = `400 34px ${FONT}`;
    ctx.fillText(fitText(ctx, data.buyerHandle || "", W - tx - PAD - 340), tx, avCY + 36);
    ctx.textAlign = "right";
    ctx.fillStyle = MUT;
    ctx.font = `400 34px ${FONT}`;
    ctx.fillText(data.dateText || "", W - PAD, avCY - 32);
    ctx.fillStyle = DIM;
    ctx.font = `400 30px ${FONT}`;
    ctx.fillText(data.orderTag || "", W - PAD, avCY + 36);
    ctx.textAlign = "left";
    y += avR * 2 + 34;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = INK;
    ctx.font = `800 96px ${FONT}`;
    ctx.fillText("Compra Realizada", PAD, y + 48);
    ctx.restore();
    y += 128;
    ctx.fillStyle = GREEN;
    ctx.beginPath();
    ctx.arc(PAD + 10, y + 16, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#7dd8ae";
    ctx.font = `600 32px ${FONT}`;
    ctx.fillText("Pagamento confirmado", PAD + 34, y + 16);
    y += 62;
    ctx.strokeStyle = "#262d29";
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 12]);
    ctx.beginPath();
    ctx.moveTo(PAD, y);
    ctx.lineTo(W - PAD, y);
    ctx.stroke();
    ctx.setLineDash([]);
    y += 54;
    ctx.fillStyle = MUT;
    ctx.font = `600 30px ${FONT}`;
    const cartW = spaced(ctx, "CARRINHO", PAD, y + 15, 7);
    ctx.fillStyle = DIM;
    ctx.font = `400 30px ${FONT}`;
    ctx.fillText(`(${(data.lines || []).length} ${((data.lines || []).length === 1 ? "item" : "itens")})`, PAD + cartW + 18, y + 15);
    y += 54;
    for (const line of lines) {
      const cardH = 112;
      const cardG = ctx.createLinearGradient(0, y, 0, y + cardH);
      cardG.addColorStop(0, CARD0);
      cardG.addColorStop(1, CARD1);
      ctx.fillStyle = cardG;
      rr(ctx, PAD, y, CW, cardH, 28);
      ctx.fill();
      ctx.strokeStyle = EDGE;
      ctx.lineWidth = 2.5;
      rr(ctx, PAD, y, CW, cardH, 28);
      ctx.stroke();
      const cy = y + cardH / 2;
      ctx.font = `800 34px ${FONT}`;
      const qtyText = `${line.qty || 1}x`;
      const qtyW = ctx.measureText(qtyText).width + 48;
      const pillX = PAD + 28;
      const pillG = ctx.createLinearGradient(0, cy - 31, 0, cy + 31);
      pillG.addColorStop(0, BRIGHT);
      pillG.addColorStop(1, GREEN);
      ctx.fillStyle = pillG;
      rr(ctx, pillX, cy - 31, qtyW, 62, 31);
      ctx.fill();
      ctx.fillStyle = "#052e22";
      ctx.fillText(qtyText, pillX + 24, cy + 1);
      ctx.font = `800 46px ${FONT}`;
      const valueW = ctx.measureText(line.value).width;
      const valueX = W - PAD - 34 - valueW;
      const nameX = pillX + qtyW + 28;
      ctx.fillStyle = INK;
      ctx.font = `600 42px ${FONT}`;
      ctx.fillText(fitText(ctx, line.name, Math.max(80, valueX - 24 - nameX)), nameX, cy + 1);
      ctx.fillStyle = INK;
      ctx.font = `800 46px ${FONT}`;
      ctx.fillText(line.value, valueX, cy + 1);
      y += cardH + 18;
    }
    if (extra > 0) {
      ctx.fillStyle = DIM;
      ctx.font = `400 32px ${FONT}`;
      ctx.fillText(`+${extra} item(ns)`, PAD, y + 14);
      y += 62;
    }
    ctx.strokeStyle = "#202623";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(PAD, y);
    ctx.lineTo(W - PAD, y);
    ctx.stroke();
    y += 50;
    ctx.fillStyle = MUT;
    ctx.font = `600 30px ${FONT}`;
    spaced(ctx, "SUBTOTAL", PAD, y + 15, 7);
    ctx.fillStyle = "#d6dbd8";
    ctx.font = `600 44px ${FONT}`;
    const subW = ctx.measureText(data.subtotalText).width;
    ctx.fillText(data.subtotalText, W - PAD - subW, y + 15);
    y += 68;
    if (hasCoupon) {
      ctx.fillStyle = GREEN;
      ctx.font = `600 32px ${FONT}`;
      const cup = fitText(ctx, data.coupon, CW);
      const cupW = ctx.measureText(cup).width;
      ctx.fillText(cup, W - PAD - cupW, y + 10);
      y += 56;
    }
    const boxH = 220;
    const boxY = y + 22;
    ctx.fillStyle = "rgba(16,185,129,0.07)";
    rr(ctx, PAD, boxY, CW, boxH, 38);
    ctx.fill();
    ctx.save();
    ctx.shadowColor = "rgba(16,185,129,0.5)";
    ctx.shadowBlur = 26;
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 2.5;
    rr(ctx, PAD, boxY, CW, boxH, 38);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = MUT;
    ctx.font = `600 32px ${FONT}`;
    spaced(ctx, "VALOR PAGO", PAD + 56, boxY + boxH / 2, 7);
    const totalG = ctx.createLinearGradient(W - PAD - 560, 0, W - PAD - 56, 0);
    totalG.addColorStop(0, BRIGHT);
    totalG.addColorStop(1, GREEN);
    ctx.save();
    ctx.shadowColor = "rgba(52,211,153,0.4)";
    ctx.shadowBlur = 18;
    ctx.fillStyle = totalG;
    ctx.font = `800 110px ${FONT}`;
    const totalText = fitText(ctx, data.totalText, CW * 0.62);
    const totalW = ctx.measureText(totalText).width;
    ctx.fillText(totalText, W - PAD - 56 - totalW, boxY + boxH / 2 + 2);
    ctx.restore();
    y = boxY + boxH + 46;
    ctx.strokeStyle = "#1f2522";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(PAD, y);
    ctx.lineTo(W - PAD, y);
    ctx.stroke();
    y += 58;
    let footX = PAD;
    if (data.guildIconBuffer) {
      try {
        const icon = await loadImage(data.guildIconBuffer);
        const ir = 30;
        const icx = PAD + ir;
        const icy = y + 6;
        ctx.save();
        ctx.beginPath();
        ctx.arc(icx, icy, ir, 0, Math.PI * 2);
        ctx.clip();
        const s = Math.max((ir * 2) / icon.width, (ir * 2) / icon.height);
        ctx.drawImage(icon, icx - (icon.width * s) / 2, icy - (icon.height * s) / 2, icon.width * s, icon.height * s);
        ctx.restore();
        footX = PAD + 84;
      } catch {}
    }
    ctx.fillStyle = MUT;
    ctx.font = `400 32px ${FONT}`;
    ctx.fillText(fitText(ctx, data.guildName || "Loja", CW - footX - 320), footX, y + 6);
    ctx.textAlign = "right";
    ctx.fillStyle = DIM;
    ctx.font = `400 28px ${FONT}`;
    ctx.fillText("Recibo automático", W - PAD, y + 6);
    ctx.textAlign = "left";
    y += 40;
    const out = createCanvas(W, Math.ceil(y + 84));
    out.getContext("2d").drawImage(canvas, 0, 0);
    return Buffer.from(await out.encode("png"));
  } catch (e) {
    console.error("[Sales] Falha ao gerar recibo:", e.message);
    return null;
  }
}
async function sendPurchaseLog(client, order, extraComponents = []) {
  try {
    const guildId = order.guildId;
    const { channelId, mode } = getReceiptSettings(guildId);
    if (!channelId) return;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    const buyer = await client.users.fetch(order.userId).catch(() => null);
    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
    if (mode === "image") {
      const [avatarBuffer, guildIconBuffer, bannerBuffer] = await Promise.all([
        fetchBuffer(buyer?.displayAvatarURL({ extension: "png", size: 256 })),
        fetchBuffer(guild?.iconURL({ extension: "png", size: 128 })),
        fetchBuffer(order.banner || null)
      ]);
      const subtotal = order.originalTotal && order.couponCode ? fmtBRL(order.originalTotal) : fmtBRL(order.total);
      const buf = await generateReceiptImage({
        buyerName: buyer?.displayName || buyer?.username || "Cliente",
        buyerHandle: buyer?.username ? `@${buyer.username}` : "",
        avatarBuffer,
        guildName: guild?.name || "Loja",
        guildIconBuffer,
        bannerBuffer,
        dateText: formatDate(order.deliveredAt || Date.now()),
        orderTag: `#${String(order.id).slice(-6)}`,
        lines: receiptLines(order),
        subtotalText: subtotal,
        totalText: fmtBRL(order.total),
        coupon: order.couponCode ? `Cupom ${order.couponCode} (−${order.couponPercent || 0}%)` : null
      });
      if (buf) {
        await channel.send({ files: [{ attachment: buf, name: `recibo-${order.id}.png` }], components: extraComponents }).catch(() => null);
        return;
      }
    }
    await channel.send(receiptContainer(client, order, buyer, guild, extraComponents)).catch(() => null);
  } catch {}
}
function wrapTitle(ctx, text, maxWidth) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let i = 0;
  while (i < words.length && lines.length < 2) {
    let cur = words[i];
    while (i + 1 < words.length && ctx.measureText(`${cur} ${words[i + 1]}`).width <= maxWidth) {
      cur += ` ${words[++i]}`;
    }
    if (!ctx.measureText(cur).width || ctx.measureText(cur).width > maxWidth) cur = fitText(ctx, cur, maxWidth);
    lines.push(cur);
    i++;
  }
  if (i < words.length && lines.length === 2) {
    lines[1] = fitText(ctx, `${lines[1]}…`, maxWidth);
  }
  return lines.length ? lines : [""];
}
function drawBolt(ctx, x, y, s, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + 0.58 * s, y);
  ctx.lineTo(x + 0.18 * s, y + 0.56 * s);
  ctx.lineTo(x + 0.46 * s, y + 0.56 * s);
  ctx.lineTo(x + 0.36 * s, y + s);
  ctx.lineTo(x + 0.82 * s, y + 0.42 * s);
  ctx.lineTo(x + 0.52 * s, y + 0.42 * s);
  ctx.closePath();
  ctx.fill();
}
function drawCubeGlyph(ctx, cx, cy, s, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  const hw = s / 2;
  const qh = s / 4;
  ctx.beginPath();
  ctx.moveTo(cx, cy - qh * 2);
  ctx.lineTo(cx + hw, cy - qh);
  ctx.lineTo(cx + hw, cy + qh);
  ctx.lineTo(cx, cy + qh * 2);
  ctx.lineTo(cx - hw, cy + qh);
  ctx.lineTo(cx - hw, cy - qh);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - hw, cy - qh);
  ctx.lineTo(cx, cy);
  ctx.lineTo(cx + hw, cy - qh);
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx, cy + qh * 2);
  ctx.stroke();
}
function drawClockGlyph(ctx, cx, cy, r, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx, cy - r * 0.55);
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + r * 0.45, cy + r * 0.2);
  ctx.stroke();
}
async function generateRestockImage(data) {
  let canvasLib;
  try {
    canvasLib = require("@napi-rs/canvas");
  } catch {
    return null;
  }
  try {
    registerFonts();
    const { createCanvas, loadImage } = canvasLib;
    const W = 1600;
    const H = 900;
    const PAD = 96;
    const FONT = `"Inter", "Segoe UI", "DejaVu Sans", Verdana, sans-serif`;
    const INK = "#ffffff";
    const MUT = "#a8a8a8";
    const DIM = "#6b6b6b";
    const canvas = createCanvas(W, 900);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#0a0a0c";
    rr(ctx, 0, 0, W, H, 40);
    ctx.fill();
    if (data.bannerBuffer) {
      try {
        const banner = await loadImage(data.bannerBuffer);
        ctx.save();
        rr(ctx, 0, 0, W, H, 40);
        ctx.clip();
        const s = Math.max(W / banner.width, H / banner.height);
        const dw = banner.width * s;
        const dh = banner.height * s;
        ctx.drawImage(banner, (W - dw) / 2, (H - dh) / 2, dw, dh);
        ctx.fillStyle = "rgba(5,5,7,0.60)";
        ctx.fillRect(0, 0, W, H);
        const top = ctx.createLinearGradient(0, 0, 0, 420);
        top.addColorStop(0, "rgba(5,5,7,0.55)");
        top.addColorStop(1, "rgba(5,5,7,0)");
        ctx.fillStyle = top;
        ctx.fillRect(0, 0, W, 420);
        const bottom = ctx.createLinearGradient(0, H - 320, 0, H);
        bottom.addColorStop(0, "rgba(8,8,10,0)");
        bottom.addColorStop(1, "rgba(8,8,10,1)");
        ctx.fillStyle = bottom;
        ctx.fillRect(0, H - 320, W, 320);
        ctx.restore();
      } catch {}
    }
    let rorb = ctx.createRadialGradient(W - 140, 60, 40, W - 140, 60, 520);
    rorb.addColorStop(0, "rgba(16,185,129,0.16)");
    rorb.addColorStop(1, "rgba(16,185,129,0)");
    ctx.fillStyle = rorb;
    ctx.fillRect(0, 0, W, 640);
    rorb = ctx.createRadialGradient(140, 760, 40, 140, 760, 440);
    rorb.addColorStop(0, "rgba(16,185,129,0.10)");
    rorb.addColorStop(1, "rgba(16,185,129,0)");
    ctx.fillStyle = rorb;
    ctx.fillRect(0, 400, 700, 500);
    const vig = ctx.createRadialGradient(W / 2, 750, 320, W / 2, 750, 1150);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(0,0,0,0.5)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.globalAlpha = 0.05;
    drawBolt(ctx, 120, 420, 430, "#ffffff");
    ctx.restore();
    ctx.fillStyle = "#f2f2f2";
    ctx.fillRect(0, 40, 10, H - 80);
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const pillH = 84;
    const pillY = 84;
    ctx.font = `800 40px ${FONT}`;
    const restockW = ctx.measureText("RESTOCK").width + 150;
    ctx.save();
    ctx.shadowColor = "rgba(255,255,255,0.35)";
    ctx.shadowBlur = 24;
    ctx.fillStyle = "#f5f5f5";
    rr(ctx, PAD, pillY, restockW, pillH, 42);
    ctx.fill();
    ctx.restore();
    drawBolt(ctx, PAD + 34, pillY + 18, 48, "#0a0a0c");
    ctx.fillStyle = "#0a0a0c";
    ctx.fillText("RESTOCK", PAD + 100, pillY + pillH / 2 + 1);
    ctx.fillStyle = MUT;
    ctx.font = `400 38px ${FONT}`;
    ctx.fillText("novos itens acabaram de chegar", PAD + restockW + 28, pillY + pillH / 2 + 1);
    ctx.fillStyle = INK;
    ctx.font = `800 108px ${FONT}`;
    const titleLines = wrapTitle(ctx, data.productName || "Reposição", W - PAD * 2 - 558);
    const titleY0 = titleLines.length === 1 ? 391 : 330;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 5;
    titleLines.forEach((line, i) => {
      ctx.fillText(line, PAD, titleY0 + i * 122);
    });
    ctx.restore();
    if (data.fieldName && data.fieldName !== data.productName) {
      ctx.fillStyle = MUT;
      ctx.font = `400 36px ${FONT}`;
      ctx.fillText(fitText(ctx, data.fieldName, 700), PAD, titleY0 + titleLines.length * 122 - 20);
    }
    let ry = titleY0 + titleLines.length * 122 + 24;
    ctx.fillStyle = "#e8e8e8";
    ctx.fillRect(PAD, ry, 130, 6);
    ry += 48;
    ctx.fillStyle = "rgba(255,255,255,0.045)";
    rr(ctx, 1030, 12, 530, 876, 40);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.09)";
    ctx.lineWidth = 2;
    rr(ctx, 1030, 12, 530, 876, 40);
    ctx.stroke();
    const ccx = 1295;
    const ccy = 460;
    const crad = 148;
    ctx.save();
    ctx.lineWidth = 2;
    for (const [r, a] of [[232, 0.05], [318, 0.035], [404, 0.025]]) {
      ctx.strokeStyle = `rgba(255,255,255,${a})`;
      ctx.beginPath();
      ctx.arc(ccx, ccy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    ctx.save();
    ctx.shadowColor = "rgba(255,255,255,0.4)";
    ctx.shadowBlur = 34;
    ctx.strokeStyle = "#f2f2f2";
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.arc(ccx, ccy, crad, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = "rgba(16,185,129,0.35)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(ccx, ccy, crad + 22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.textAlign = "center";
    ctx.font = `800 150px ${FONT}`;
    ctx.fillText(fitText(ctx, data.totalText || "?", crad * 2 - 60), ccx, ccy + 4);
    ctx.fillStyle = MUT;
    ctx.font = `400 40px ${FONT}`;
    ctx.fillText("em estoque", ccx, ccy + crad + 52);
    const pillLabel = `+${String(data.addedText || "").replace(/x$/i, "") || "?"} agora`;
    ctx.font = `700 38px ${FONT}`;
    const pill2W = ctx.measureText(pillLabel).width + 150;
    const pill2X = ccx - pill2W / 2;
    const pill2Y = ccy + crad + 96;
    ctx.strokeStyle = "#d8d8d8";
    ctx.lineWidth = 3;
    rr(ctx, pill2X, pill2Y, pill2W, 74, 37);
    ctx.stroke();
    drawBolt(ctx, pill2X + 30, pill2Y + 17, 40, "#f2f2f2");
    ctx.fillStyle = "#f2f2f2";
    ctx.textAlign = "left";
    ctx.fillText(pillLabel, pill2X + 82, pill2Y + 38);
    ctx.textAlign = "left";
    const pillBottom = pill2Y + 74;
    const boxH = 150;
    const box1W = 380;
    const statBox = (x, w, label, value, glyph) => {
      ctx.fillStyle = "rgba(20,20,23,0.72)";
      rr(ctx, x, ry, w, boxH, 28);
      ctx.fill();
      ctx.strokeStyle = "#333338";
      ctx.lineWidth = 2.5;
      rr(ctx, x, ry, w, boxH, 28);
      ctx.stroke();
      const ix = x + 44;
      const iy = ry + boxH / 2;
      ctx.fillStyle = "rgba(16,185,129,0.14)";
      rr(ctx, ix - 38, iy - 38, 76, 76, 20);
      ctx.fill();
      if (glyph === "cube") drawCubeGlyph(ctx, ix, iy, 46, BRIGHT, 5);
      else drawClockGlyph(ctx, ix, iy, 23, BRIGHT, 5);
      ctx.fillStyle = MUT;
      ctx.font = `400 30px ${FONT}`;
      ctx.fillText(label, ix + 52, iy - 26);
      ctx.fillStyle = INK;
      ctx.font = `700 52px ${FONT}`;
      ctx.fillText(fitText(ctx, value, w - 140), ix + 52, iy + 30);
    };
    statBox(PAD, box1W, "Adicionados", data.addedText || "—", "cube");
    statBox(PAD + box1W + 28, 460, "Data", data.dateText || "", "clock");
    ry += boxH + 56;
    const footY = pillBottom + 60;
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(PAD, footY - 56);
    ctx.lineTo(W - PAD, footY - 56);
    ctx.stroke();
    let footX = PAD;
    if (data.guildIconBuffer) {
      try {
        const icon = await loadImage(data.guildIconBuffer);
        const ir = 34;
        ctx.save();
        ctx.beginPath();
        ctx.arc(PAD + ir, footY, ir, 0, Math.PI * 2);
        ctx.clip();
        const s = Math.max((ir * 2) / icon.width, (ir * 2) / icon.height);
        ctx.drawImage(icon, PAD + ir - (icon.width * s) / 2, footY - (icon.height * s) / 2, icon.width * s, icon.height * s);
        ctx.restore();
        ctx.strokeStyle = "rgba(52,211,153,0.6)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(PAD + ir, footY, ir + 6, 0, Math.PI * 2);
        ctx.stroke();
        footX = PAD + 92;
      } catch {}
    }
    if (!data.guildIconBuffer) {
      ctx.fillStyle = GREEN;
      rr(ctx, PAD, footY - 11, 22, 22, 6);
      ctx.fill();
      footX = PAD + 40;
    }
    ctx.fillStyle = INK;
    ctx.font = `600 40px ${FONT}`;
    ctx.fillText(fitText(ctx, data.guildName || "Loja", ccx - 283 - footX), footX, footY);
    return Buffer.from(await canvas.encode("png"));
  } catch (e) {
    console.error("[Sales] Falha ao gerar restock:", e.message);
    return null;
  }
}
module.exports = {
  getReceiptSettings,
  receiptPanel,
  handleReceiptPanelComponent,
  generateReceiptImage,
  generateRestockImage,
  receiptContainer,
  sendPurchaseLog
};
