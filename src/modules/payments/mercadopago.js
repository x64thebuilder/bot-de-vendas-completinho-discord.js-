const crypto = require("node:crypto");
const API_BASE = "https://api.mercadopago.com";
async function createPixPayment({ accessToken, amount, description, payerEmail, externalReference }) {
  const response = await fetch(`${API_BASE}/v1/payments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": crypto.randomUUID()
    },
    body: JSON.stringify({
      transaction_amount: Number(amount),
      description,
      payment_method_id: "pix",
      payer: {
        email: payerEmail || "comprador@example.com"
      },
      external_reference: externalReference
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || "Mercado Pago recusou a criacao do pagamento.");
  }
  return normalizePayment(data);
}
async function getPayment({ accessToken, paymentId }) {
  const response = await fetch(`${API_BASE}/v1/payments/${paymentId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || "Nao foi possivel consultar o pagamento.");
  }
  return normalizePayment(data);
}
function normalizePayment(data) {
  const transactionData = data.point_of_interaction?.transaction_data || {};
  return {
    id: data.id,
    status: data.status,
    statusDetail: data.status_detail,
    amount: data.transaction_amount,
    qrCode: transactionData.qr_code || null,
    qrCodeBase64: transactionData.qr_code_base64 || null,
    ticketUrl: transactionData.ticket_url || null,
    raw: data
  };
}
module.exports = {
  createPixPayment,
  getPayment
};
