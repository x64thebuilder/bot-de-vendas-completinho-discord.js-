const API_BASE = "https://api.promisse.com.br";
function isPromissePayConfigured(promissePay) {
  return Boolean(promissePay?.enabled && promissePay.apiKey);
}
async function createPixCharge({ apiKey, amount, description, externalReference }) {
  assertConfigured(apiKey);
  const data = await promisseFetch("/transactions", {
    method: "POST",
    apiKey,
    body: {
      amount: toCents(amount),
      description: description ? String(description).slice(0, 140) : undefined,
      external_reference: externalReference
    }
  });
  return normalizeTransaction(data);
}
async function getPixCharge({ apiKey, transactionId }) {
  assertConfigured(apiKey);
  const data = await promisseFetch(`/transactions/${encodeURIComponent(transactionId)}`, {
    method: "GET",
    apiKey
  });
  return normalizeTransaction(data);
}
async function promisseFetch(endpoint, { method, apiKey, body } = {}) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || "PromissePay recusou a requisicao.");
  }
  return data;
}
function assertConfigured(apiKey) {
  if (!apiKey) {
    throw new Error("PromissePay nao esta habilitada/configurada em Formas de Pagamento.");
  }
}
function normalizeTransaction(data) {
  const status = data.status || data.transaction_status || data.situacao || null;
  return {
    id: data.id || data.transaction_id || null,
    status: normalizeStatus(status),
    rawStatus: status,
    amount: typeof data.amount === "number" ? data.amount / 100 : data.amount,
    qrCode: data.qr_code || data.pix_copia_cola || data.pixCopiaECola || data.copy_paste || null,
    qrCodeBase64: data.qr_code_base64 || data.qrcode_base64 || null,
    raw: data
  };
}
function normalizeStatus(status) {
  const normalized = String(status || "").toLowerCase();
  if (["paid", "approved", "completed", "concluded", "concluida", "pago"].includes(normalized)) return "approved";
  if (["pending", "waiting", "pendente", "aguardando"].includes(normalized)) return "pending";
  if (["expired", "cancelled", "canceled", "cancelada", "expirada"].includes(normalized)) return "cancelled";
  return normalized || "unknown";
}
function toCents(amount) {
  return Math.round(Number(amount || 0) * 100);
}
module.exports = {
  isPromissePayConfigured,
  createPixCharge,
  getPixCharge
};
