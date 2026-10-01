const fs = require("node:fs");
const path = require("node:path");
const QRCode = require("qrcode");
const { MessageFlags, PermissionFlagsBits } = require("discord.js");
const { DATA_DIR } = require("../../config");
const { getGuildConfig, setGuildConfig } = require("../../storage");
const LOGO_PATH = path.join(DATA_DIR, "qr-logo.png");
const DEFAULT_COLOR = "#10b981";
const MAX_LOGO_BYTES = 3 * 1024 * 1024;
function canvasLib() {
  try {
    return require("@napi-rs/canvas");
  } catch {
    return null;
  }
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
function parseColor(raw, fallback = DEFAULT_COLOR) {
  if (raw == null || String(raw).trim() === "") return fallback;
  const text = String(raw).trim();
  let m = text.match(/^#?([0-9a-fA-F]{6})$/);
  if (m) return `#${m[1].toLowerCase()}`;
  m = text.match(/^#?([0-9a-fA-F]{3})$/);
  if (m) return `#${m[1].split("").map((c) => c + c).join("").toLowerCase()}`;
  m = text.match(/^(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})$/);
  if (m) {
    const rgb = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (rgb.every((n) => n >= 0 && n <= 255)) {
      return `#${rgb.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
    }
  }
  return null;
}
async function downloadBuffer(url, maxBytes = MAX_LOGO_BYTES) {
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download falhou (HTTP ${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error("Arquivo grande demais (máx 3MB).");
  return buf;
}
function getShopColor(guildId) {
  try {
    const saved = getGuildConfig(guildId).sales?.qrStyle?.color;
    return typeof saved === "string" && /^#[0-9a-f]{6}$/.test(saved) ? saved : DEFAULT_COLOR;
  } catch {
    return DEFAULT_COLOR;
  }
}
function getShopLogo() {
  try {
    if (fs.existsSync(LOGO_PATH)) return fs.readFileSync(LOGO_PATH);
  } catch {   }
  return null;
}
async function generatePrettyQR(text, { color = DEFAULT_COLOR, logoBuffer = null } = {}) {
  const lib = canvasLib();
  if (!lib) return null;
  try {
    const { createCanvas, loadImage } = lib;
    const qr = QRCode.create(String(text || ""), { errorCorrectionLevel: "H" });
    const mod = qr.modules;
    const n = mod.size;
    const get = (r, c) => (typeof mod.get === "function" ? mod.get(r, c) : mod.data[r * n + c]);
    const cell = 12;
    const quiet = 4;
    const S = (n + quiet * 2) * cell;
    const canvas = createCanvas(S, S);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    rr(ctx, 0, 0, S, S, 40);
    ctx.fill();
    const X = (c) => (c + quiet) * cell;
    const Y = (r) => (r + quiet) * cell;
    const inFinder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
    ctx.fillStyle = color;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!get(r, c)) continue;
        if (inFinder(r, c)) {
          ctx.fillRect(X(c), Y(r), cell, cell);
        } else {
          rr(ctx, X(c) + 1, Y(r) + 1, cell - 2, cell - 2, (cell - 2) * 0.35);
          ctx.fill();
        }
      }
    }
    const finder = (fr, fc) => {
      ctx.fillStyle = color;
      ctx.fillRect(X(fc), Y(fr), cell * 7, cell * 7);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(X(fc) + cell, Y(fr) + cell, cell * 5, cell * 5);
      ctx.fillStyle = color;
      rr(ctx, X(fc) + cell * 2, Y(fr) + cell * 2, cell * 3, cell * 3, cell * 0.7);
      ctx.fill();
    };
    finder(0, 0);
    finder(0, n - 7);
    finder(n - 7, 0);
    if (logoBuffer) {
      try {
        const logo = await loadImage(logoBuffer);
        const cx = S / 2;
        const cy = S / 2;
        const rLogo = S * 0.115;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(cx, cy, rLogo + cell * 1.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, rLogo, 0, Math.PI * 2);
        ctx.clip();
        const s = Math.max((rLogo * 2) / logo.width, (rLogo * 2) / logo.height);
        const dw = logo.width * s;
        const dh = logo.height * s;
        ctx.drawImage(logo, cx - dw / 2, cy - dh / 2, dw, dh);
        ctx.restore();
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(4, cell * 0.7);
        ctx.beginPath();
        ctx.arc(cx, cy, rLogo + cell * 0.55, 0, Math.PI * 2);
        ctx.stroke();
      } catch {   }
    }
    return Buffer.from(await canvas.encode("png"));
  } catch (e) {
    console.error("[QR] Falha ao gerar:", e.message);
    return null;
  }
}
async function buildPaymentQr(payload, guildId) {
  try {
    const pretty = await generatePrettyQR(payload, { color: getShopColor(guildId), logoBuffer: getShopLogo() });
    if (pretty) return pretty;
  } catch {   }
  return QRCode.toBuffer(payload, {
    type: "png",
    width: 520,
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#000000", light: "#ffffff" }
  });
}
async function handleQrcodeCommand(interaction) {
  if (!interaction.isChatInputCommand || !interaction.isChatInputCommand()) return false;
  if (interaction.commandName !== "qrcode-personalizar") return false;
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: "Use dentro de um servidor.", flags: MessageFlags.Ephemeral }).catch(() => null);
    return true;
  }
  const member = interaction.member;
  const isAdmin = member?.permissions?.has(PermissionFlagsBits.Administrator);
  if (!isAdmin) {
    await interaction.reply({ content: "Somente administradores.", flags: MessageFlags.Ephemeral }).catch(() => null);
    return true;
  }
  const texto = (interaction.options.getString("texto", true) || "").trim();
  const imagem = interaction.options.getAttachment("imagem");
  const corRaw = interaction.options.getString("cor");
  if (!texto) {
    await interaction.reply({ content: "Informe o texto do QR.", flags: MessageFlags.Ephemeral }).catch(() => null);
    return true;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
  let color = getShopColor(guildId);
  let logoBuffer = getShopLogo();
  const saved = [];
  if (corRaw) {
    const parsed = parseColor(corRaw, null);
    if (!parsed) {
      await interaction.editReply({ content: "Cor inválida. Use RGB como `255,0,0` ou hex `#00ff00`." }).catch(() => null);
      return true;
    }
    color = parsed;
    setGuildConfig(guildId, (cfg) => {
      cfg.sales.qrStyle = { color: parsed };
      return cfg;
    });
    saved.push(`cor ${parsed}`);
  }
  if (imagem) {
    const ct = String(imagem.contentType || "");
    if (!ct.startsWith("image/")) {
      await interaction.editReply({ content: "A imagem precisa ser PNG ou JPG." }).catch(() => null);
      return true;
    }
    try {
      logoBuffer = await downloadBuffer(imagem.url);
      fs.writeFileSync(LOGO_PATH, logoBuffer);
      saved.push("logo");
    } catch (e) {
      await interaction.editReply({ content: `Não consegui baixar a imagem: ${e.message}` }).catch(() => null);
      return true;
    }
  }
  const buf = await generatePrettyQR(texto, { color, logoBuffer });
  if (!buf) {
    await interaction.editReply({ content: "Gerador avançado indisponível aqui (rode `npm install`). Nada foi salvo." }).catch(() => null);
    return true;
  }
  await interaction.editReply({
    content: `QR pronto!${saved.length ? `\n-# Estilo salvo para os QRs de pagamento: ${saved.join(" + ")}.` : `\n-# Estilo atual da loja (envie imagem/cor para trocar).`}`,
    files: [{ attachment: buf, name: "qrcode.png" }]
  }).catch(() => null);
  return true;
}
module.exports = {
  DEFAULT_COLOR,
  parseColor,
  generatePrettyQR,
  buildPaymentQr,
  handleQrcodeCommand
};
