const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Agent } = require("undici");
const PROD_BASE = "https://pix.api.efipay.com.br";
const tokenCache = new Map();
function isEfiConfigured(efi) {
  return Boolean(
    efi?.enabled &&
    efi.clientId &&
    efi.clientSecret &&
    efi.certificatePath
  );
}
async function createEfiPixCharge({ efi, amount, description, tradeId }) {
  assertConfigured(efi);
  const txid = makeTxid(tradeId);
  const token = await getAccessToken(efi);
  const pixKey = efi.pixKey || await createEfiRandomPixKey(efi);
  const response = await efiFetch(efi, `/v2/cob/${txid}`, {
    method: "PUT",
    token,
    body: {
      calendario: { expiracao: 3600 },
      valor: { original: formatAmount(amount) },
      chave: pixKey,
      solicitacaoPagador: String(description || "Middleman").slice(0, 140)
    }
  });
  const locationId = response.loc?.id || response.location?.id || null;
  const qr = locationId ? await createEfiQrCode({ efi, locationId }) : {};
  return {
    txid,
    locationId,
    status: normalizeCobStatus(response.status),
    pixKey,
    qrCode: qr.qrCode || response.pixCopiaECola || null,
    qrCodeBase64: qr.qrCodeBase64 || null,
    raw: response
  };
}
async function getEfiPixCharge({ efi, txid, locationId }) {
  assertConfigured(efi);
  const token = await getAccessToken(efi);
  const response = await efiFetch(efi, `/v2/cob/${encodeURIComponent(txid)}`, {
    method: "GET",
    token
  });
  let qr = {};
  const nextLocationId = locationId || response.loc?.id || response.location?.id || null;
  if (nextLocationId) {
    qr = await createEfiQrCode({ efi, locationId: nextLocationId }).catch(() => ({}));
  }
  return {
    txid,
    locationId: nextLocationId,
    status: normalizeCobStatus(response.status),
    qrCode: qr.qrCode || response.pixCopiaECola || null,
    qrCodeBase64: qr.qrCodeBase64 || null,
    raw: response
  };
}
async function sendEfiPix({ efi, amount, sellerPixKey, description, tradeId }) {
  assertConfigured(efi);
  if (!sellerPixKey) throw new Error("Chave Pix do vendedor nao foi informada.");
  const token = await getAccessToken(efi);
  const pixKey = efi.pixKey || await createEfiRandomPixKey(efi);
  const idEnvio = makeSendId(tradeId);
  const response = await efiFetch(efi, `/v2/gn/pix/${idEnvio}`, {
    method: "PUT",
    token,
    body: {
      valor: formatAmount(amount),
      pagador: { chave: pixKey },
      favorecido: { chave: sellerPixKey },
      infoPagador: String(description || `Repasse Middleman ${tradeId}`).slice(0, 140)
    }
  });
  return {
    idEnvio,
    e2eId: response.e2eId || response.endToEndId || null,
    pixKey,
    status: response.status || "ENVIADO",
    raw: response
  };
}
async function createEfiQrCode({ efi, locationId }) {
  const token = await getAccessToken(efi);
  const response = await efiFetch(efi, `/v2/loc/${encodeURIComponent(locationId)}/qrcode`, {
    method: "GET",
    token
  });
  return {
    qrCode: response.qrcode || response.pixCopiaECola || null,
    qrCodeBase64: stripDataUrl(response.imagemQrcode || response.imagemQRCode)
  };
}
async function createEfiRandomPixKey(efi) {
  const token = await getAccessToken(efi);
  const response = await efiFetch(efi, "/v2/gn/evp", {
    method: "POST",
    token
  });
  const key = response.chave || response.key || response.evp || response;
  if (typeof key !== "string" || !key.trim()) {
    throw new Error("A Efí nao retornou uma chave Pix automatica.");
  }
  return key.trim();
}
async function getAccessToken(efi) {
  const key = `prod:${efi.clientId}:${efi.certificatePath}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 30000) return cached.token;
  const auth = Buffer.from(`${efi.clientId}:${efi.clientSecret}`).toString("base64");
  const body = new URLSearchParams({ grant_type: "client_credentials" }).toString();
  const response = await efiFetch(efi, "/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
  if (!response.access_token) throw new Error("A Efí nao retornou access_token.");
  tokenCache.set(key, {
    token: response.access_token,
    expiresAt: Date.now() + Number(response.expires_in || 300) * 1000
  });
  return response.access_token;
}
async function efiFetch(efi, endpoint, { method, token, headers = {}, body } = {}) {
  const isFormEncoded = headers["Content-Type"] === "application/x-www-form-urlencoded";
  const isRawString = typeof body === "string";
  const bodyPayload = body == null ? undefined : (isRawString || isFormEncoded ? body : JSON.stringify(body));
  const response = await fetch(`${PROD_BASE}${endpoint}`, {
    method,
    dispatcher: createDispatcher(efi),
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body: bodyPayload
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.nome || data.message || data.erro || data.error_description || data.error || response.statusText;
    throw new Error(`Efí recusou a requisicao: ${detail}`);
  }
  return data;
}
function createDispatcher(efi) {
  const absolutePath = path.resolve(efi.certificatePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Certificado da Efí nao encontrado: ${absolutePath}`);
  }
  return new Agent({
    connect: {
      pfx: fs.readFileSync(absolutePath),
      passphrase: efi.certificatePassphrase || undefined
    }
  });
}
function assertConfigured(efi) {
  if (!isEfiConfigured(efi)) {
    throw new Error("Efí Bank nao esta habilitada/configurada em Formas de Pagamento.");
  }
}
function makeTxid(tradeId) {
  const base = `MM${String(tradeId).replace(/\D/g, "")}${crypto.randomBytes(3).toString("hex")}`;
  return base.slice(0, 35);
}
function makeSendId(tradeId) {
  const base = `MMOUT${String(tradeId).replace(/\D/g, "")}${crypto.randomBytes(4).toString("hex")}`;
  return base.slice(0, 35);
}
function formatAmount(amount) {
  return Number(amount || 0).toFixed(2);
}
function normalizeCobStatus(status) {
  if (status === "CONCLUIDA") return "approved";
  if (status === "ATIVA") return "pending";
  return status || "unknown";
}
function stripDataUrl(value) {
  if (!value) return null;
  return String(value).replace(/^data:image\/\w+;base64,/, "");
}
module.exports = {
  isEfiConfigured,
  createEfiPixCharge,
  getEfiPixCharge,
  createEfiRandomPixKey,
  sendEfiPix
};
