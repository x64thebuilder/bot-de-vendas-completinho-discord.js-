const fs = require("node:fs");
const path = require("node:path");
let sharp;
try {
  sharp = require("sharp");
} catch {
  console.error("\n[Lucide] Faltando dependencia. Rode primeiro:\n  npm install lucide-static sharp --no-save\n");
  process.exit(1);
}
let lucideDir;
try {
  lucideDir = path.dirname(require.resolve("lucide-static/package.json"));
} catch {
  console.error("\n[Lucide] Faltando dependencia. Rode primeiro:\n  npm install lucide-static sharp --no-save\n");
  process.exit(1);
}
const ICONS_SRC_DIR = path.join(lucideDir, "icons");
const OUTPUT_DIR = path.join(__dirname, "..", "Emojis");
const SIZE = 128;
const ICON_MAP = {
  cargo: "shield",
  canal: "hash",
  wand: "wand-2",
  bag: "shopping-bag",
  reload: "refresh-cw",
  embed: "frame",
  recibo: "receipt",
  tradep: "repeat",
  users: "users",
  verifiedp: "badge-check",
  rendimentos: "trending-up",
  visible: "eye",
  pedidoSolicitado: "clipboard-list",
  pix: "qr-code",
  pedidoRealizado: "clipboard-check",
  pedidoEntregue: "package-check",
  carrinhoCancelado: "circle-x",
  negativo: "circle-x",
  diretorio: "folder",
  setass: "list-checks",
  dev: "code",
  user: "user",
  userp: "user-check",
  pixp: "zap",
  fields: "list",
  dollar: "dollar-sign",
  apagar: "trash-2",
  attach: "paperclip",
  bank: "landmark",
  caixa: "package",
  carteira: "wallet",
  clock: "clock",
  cloud: "cloud",
  config2: "settings-2",
  cupom: "ticket",
  datep: "calendar",
  db: "database",
  desligado: "power-off",
  editar: "pencil",
  efibankE: "landmark",
  ligado: "power",
  mais2: "plus",
  mercadopagoE: "credit-card",
  online: "wifi",
  personalizarE: "sliders-horizontal",
  positivo: "circle-check",
  preview: "eye",
  pricep: "tag",
  produtoEntregue: "package-check",
  streaming: "radio",
  user1p: "user-round",
  cartao: "credit-card",
  bitcoin: "bitcoin"
};
const STROKE_COLOR = "#FFFFFF";
async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const entries = Object.entries(ICON_MAP);
  let ok = 0;
  let fail = 0;
  for (const [emojiName, iconName] of entries) {
    const svgPath = path.join(ICONS_SRC_DIR, `${iconName}.svg`);
    if (!fs.existsSync(svgPath)) {
      console.warn(`[Lucide] Icone "${iconName}" nao encontrado (emoji "${emojiName}"). Pulei.`);
      fail += 1;
      continue;
    }
    const svg = fs.readFileSync(svgPath, "utf8").replace(/currentColor/g, STROKE_COLOR);
    const outputPath = path.join(OUTPUT_DIR, `${emojiName}.png`);
    try {
      await sharp(Buffer.from(svg), { density: 384 })
        .resize(SIZE, SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toFile(outputPath);
      console.log(`[Lucide] OK  ${emojiName}.png  (icone: ${iconName})`);
      ok += 1;
    } catch (error) {
      console.error(`[Lucide] Falha ao gerar ${emojiName}.png:`, error.message);
      fail += 1;
    }
  }
  console.log(`\n[Lucide] Concluido: ${ok} gerados, ${fail} com falha.`);
  console.log(`[Lucide] Arquivos salvos em: ${OUTPUT_DIR}`);
  console.log("[Lucide] Basta iniciar o bot normalmente — a sincronizacao de emojis (src/emojis.js) sobe tudo pro Discord sozinha.");
}
main();
