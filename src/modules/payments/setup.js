const fs = require("node:fs");
const path = require("node:path");
const { getGuildConfig, setGuildConfig } = require("../../storage");
const { guildDir } = require("../../guildDb");
const ALLOWED_CERT_EXTENSIONS = new Set([".p12", ".pem", ".crt", ".cer"]);
const PENDING_TIMEOUT_MS = 5 * 60 * 1000;
async function handlePaymentSetupMessage(message) {
  if (!message.guild || message.author.bot) return false;
  const config = getGuildConfig(message.guild.id);
  const efi = config.payments.efi;
  if (
    efi.pendingCertificateUserId !== message.author.id ||
    efi.pendingCertificateChannelId !== message.channel.id
  ) {
    return false;
  }
  if (efi.pendingCertificateAt && Date.now() - Number(efi.pendingCertificateAt) > PENDING_TIMEOUT_MS) {
    setGuildConfig(message.guild.id, (next) => {
      next.payments.efi.pendingCertificateUserId = null;
      next.payments.efi.pendingCertificateChannelId = null;
      next.payments.efi.pendingCertificateAt = null;
      return next;
    });
    return false;
  }
  const attachment = message.attachments.first();
  if (!attachment) {
    await message.reply("Envie o certificado como anexo.");
    return true;
  }
  const extension = path.extname(attachment.name || "").toLowerCase();
  if (!ALLOWED_CERT_EXTENSIONS.has(extension)) {
    await message.reply("Esse arquivo nao parece um certificado valido. Envie `.p12`, `.pem`, `.crt` ou `.cer`.");
    return true;
  }
  const certificatesDir = path.join(guildDir(message.guild.id), "certificates");
  if (!fs.existsSync(certificatesDir)) {
    fs.mkdirSync(certificatesDir, { recursive: true });
  }
  const response = await fetch(attachment.url);
  if (!response.ok) {
    await message.reply("Nao consegui baixar o certificado anexado. Tente enviar novamente.");
    return true;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const fileName = `${message.author.id}${extension}`;
  const certificatePath = path.join(certificatesDir, fileName);
  fs.writeFileSync(certificatePath, buffer);
  setGuildConfig(message.guild.id, (next) => {
    next.payments.efi.certificatePath = certificatePath;
    next.payments.efi.pendingCertificateUserId = null;
    next.payments.efi.pendingCertificateChannelId = null;
    next.payments.efi.pendingCertificateAt = null;
    return next;
  });
  await message.reply("Certificado da Efí salvo com sucesso. Agora voce pode habilitar a Efí Bank no painel.");
  return true;
}
module.exports = {
  handlePaymentSetupMessage
};
