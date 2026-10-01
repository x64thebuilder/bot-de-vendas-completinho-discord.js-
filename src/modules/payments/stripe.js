const API_BASE = "https://api.stripe.com";
function isStripeConfigured(stripe) {
  return Boolean(stripe?.enabled && stripe.secretKey && String(stripe.secretKey).startsWith("sk_"));
}
async function createPixCharge({ secretKey, amount, description, externalReference, currency = "brl" }) {
  assertConfigured(secretKey);
  const cur = String(currency || "brl").toLowerCase() === "usd" ? "usd" : "brl";
  if (cur === "usd") {
    const body = new URLSearchParams();
    body.append("mode", "payment");
    body.append("success_url", "https://discord.com");
    body.append("cancel_url", "https://discord.com");
    body.append("line_items[0][price_data][currency]", "usd");
    body.append("line_items[0][price_data][product_data][name]", String(description || "Order").slice(0, 200));
    body.append("line_items[0][price_data][unit_amount]", String(toCents(amount)));
    body.append("line_items[0][quantity]", "1");
    if (externalReference) body.append("metadata[order_id]", String(externalReference).slice(0, 100));
    const data = await stripeFetch("/v1/checkout/sessions", { method: "POST", secretKey, body });
    return normalizeCheckout(data);
  }
  const body = new URLSearchParams();
  body.append("amount", String(toCents(amount)));
  body.append("currency", "brl");
  body.append("payment_method_types[]", "pix");
  if (description) body.append("description", String(description).slice(0, 200));
  if (externalReference) {
    body.append("metadata[external_reference]", String(externalReference).slice(0, 100));
    body.append("metadata[order_id]", String(externalReference).slice(0, 100));
  }
  const data = await stripeFetch("/v1/payment_intents", { method: "POST", secretKey, body });
  return normalizeIntent(data);
}
async function getPixCharge({ secretKey, paymentIntentId }) {
  assertConfigured(secretKey);
  if (!paymentIntentId) throw new Error("paymentIntentId obrigatório");
  const isCheckout = String(paymentIntentId).startsWith("cs_");
  const endpoint = isCheckout ? `/v1/checkout/sessions/${encodeURIComponent(paymentIntentId)}` : `/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`;
  const data = await stripeFetch(endpoint, { method: "GET", secretKey });
  return isCheckout ? normalizeCheckout(data) : normalizeIntent(data);
}
async function createPixPayment(opts) { return createPixCharge(opts); }
async function getPayment(opts) { return getPixCharge({ secretKey: opts.secretKey, paymentIntentId: opts.paymentId || opts.paymentIntentId }); }
async function stripeFetch(endpoint, { method, secretKey, body } = {}) {
  const headers = {
    Authorization: `Bearer ${secretKey}`
  };
  if (body) {
    if (body instanceof URLSearchParams) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    } else {
      headers["Content-Type"] = "application/json";
    }
  }
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers,
    body: body ? (body instanceof URLSearchParams ? body.toString() : JSON.stringify(body)) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = data.error?.message || data.error?.code || data.message || `Stripe recusou (${response.status})`;
    throw new Error(msg);
  }
  return data;
}
function assertConfigured(secretKey) {
  if (!secretKey || !String(secretKey).startsWith("sk_")) {
    throw new Error("Stripe não está habilitada/configurada em Formas de Pagamento. Cole a Secret Key (sk_live_... ou sk_test_...).");
  }
}
function normalizeIntent(data) {
  const status = normalizeStatus(data.status);
  const pixData = data.next_action?.pix_display_qr_code || data.next_action?.display_qr_code || {};
  const qrCode = pixData.data || pixData.hosted_instructions_url || data.next_action?.pix_display_qr_code?.data || null;
  const qrImageUrl = pixData.image_url_png || pixData.image_url || null;
  return {
    id: data.id || null,
    status,
    rawStatus: data.status,
    amount: typeof data.amount === "number" ? data.amount / 100 : null,
    qrCode,
    qrCodeBase64: null,
    qrImageUrl,
    hostedUrl: pixData.hosted_instructions_url || data.url || null,
    clientSecret: data.client_secret || null,
    raw: data
  };
}
function normalizeCheckout(data) {
  const status = normalizeStatus(data.payment_status || data.status);
  return {
    id: data.id || null,
    status,
    rawStatus: data.payment_status || data.status,
    amount: typeof data.amount_total === "number" ? data.amount_total / 100 : (typeof data.amount === "number" ? data.amount / 100 : null),
    qrCode: data.url || null,
    qrCodeBase64: null,
    qrImageUrl: null,
    hostedUrl: data.url || null,
    clientSecret: null,
    raw: data
  };
}
function normalizeStatus(status) {
  const s = String(status || "").toLowerCase();
  if (["succeeded", "paid", "approved"].includes(s)) return "approved";
  if (["requires_action", "requires_capture", "processing", "pending", "requires_payment_method"].includes(s)) return "pending";
  if (["canceled", "cancelled", "failed"].includes(s)) return "cancelled";
  return s || "unknown";
}
function toCents(amount) {
  return Math.round(Number(amount || 0) * 100);
}
module.exports = {
  isStripeConfigured,
  createPixCharge,
  getPixCharge,
  createPixPayment,
  getPayment,
  createStripePixCharge: createPixCharge,
  getStripePixCharge: getPixCharge
};
