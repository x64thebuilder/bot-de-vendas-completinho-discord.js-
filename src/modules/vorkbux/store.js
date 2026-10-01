const { readGuildFile, writeGuildFile } = require("../../guildDb");
const NAMESPACE = "vorkbux";
function defaultStore() {
  return {
    products: {},
    orders: {},
    carts: {},
    pendingCoupons: {},
    drafts: {}
  };
}
function readStore() {
  const data = readGuildFile(null, NAMESPACE, defaultStore);
  data.products ||= {};
  data.orders ||= {};
  data.carts ||= {};
  data.pendingCoupons ||= {};
  data.drafts ||= {};
  return data;
}
function writeStore(data) { writeGuildFile(null, NAMESPACE, data); }
function setDraft(userId, draft){ const d=readStore(); d.drafts[userId]=draft; writeStore(d); }
function getDraft(userId){ return readStore().drafts[userId]||null; }
function clearDraft(userId){ const d=readStore(); delete d.drafts[userId]; writeStore(d); }
function getProducts() { return Object.values(readStore().products); }
function getProduct(id) { return readStore().products[id] || null; }
function setProduct(id, updater) {
  const data = readStore();
  const cur = data.products[id];
  data.products[id] = typeof updater === "function" ? updater(cur) : updater;
  writeStore(data);
  return data.products[id];
}
function createProduct({ name, emoji }) {
  const data = readStore();
  const id = `${Date.now()}${Math.floor(Math.random()*1000)}`;
  data.products[id] = { id, name: name.slice(0,80), emoji: emoji || null, fields: {}, createdAt: Date.now() };
  writeStore(data);
  return data.products[id];
}
function deleteProduct(id) {
  const data = readStore();
  delete data.products[id];
  writeStore(data);
}
function createField(productId, { name, price }) {
  const data = readStore();
  const p = data.products[productId];
  if (!p) return null;
  const fid = `${Date.now()}${Math.floor(Math.random()*1000)}`;
  p.fields[fid] = { id: fid, name: name.slice(0,80), price: Number(price)||0, stock: 0, infinite: false };
  writeStore(data);
  return p.fields[fid];
}
function getField(productId, fieldId) {
  const p = readStore().products[productId];
  return p?.fields[fieldId] || null;
}
function setField(productId, fieldId, updater) {
  const data = readStore();
  const p = data.products[productId];
  if (!p || !p.fields[fieldId]) return null;
  p.fields[fieldId] = typeof updater === "function" ? updater(p.fields[fieldId]) : updater;
  writeStore(data);
  return p.fields[fieldId];
}
function deleteField(productId, fieldId) {
  const data = readStore();
  const p = data.products[productId];
  if (p) delete p.fields[fieldId];
  writeStore(data);
}
function getOrder(orderId) { return readStore().orders[orderId] || null; }
function setOrder(orderId, updater) {
  const data = readStore();
  const cur = data.orders[orderId];
  data.orders[orderId] = typeof updater === "function" ? updater(cur) : updater;
  writeStore(data);
  return data.orders[orderId];
}
function createOrder(order) {
  const data = readStore();
  data.orders[order.id] = order;
  writeStore(data);
  return order;
}
function listOrders(){ return Object.values(readStore().orders).sort((a,b)=> (b.createdAt||0)-(a.createdAt||0)); }
function getStats(){
  const orders=listOrders();
  const paid=orders.filter(o=>["paid","await_delivery","delivered"].includes(o.status));
  const pending=orders.filter(o=>["quantity","await_approval","await_payment"].includes(o.status));
  const revenue=paid.reduce((a,o)=>a+Number(o.total||0),0);
  const robuxTotal=paid.reduce((a,o)=>a+Number(o.quantity||0),0);
  return { total:orders.length, paid:paid.length, pending:pending.length, revenue, robuxTotal };
}
function getCart(userId) { return readStore().carts[userId] || null; }
function setCart(userId, cart) {
  const data = readStore();
  data.carts[userId] = cart;
  writeStore(data);
}
function clearCart(userId) {
  const data = readStore();
  delete data.carts[userId];
  writeStore(data);
}
function formatBRL(v) {
  return `R$ ${Number(v).toFixed(2).replace(".",",")}`;
}
function calcPrice(quantity, pricePer1000) {
  return Math.round((quantity/1000)*pricePer1000*100)/100;
}
function calcGamepassAmount(quantity, coverFee) {
  if (!coverFee) return quantity;
  return Math.ceil(quantity / 0.7);
}
module.exports = {
  getProducts, getProduct, setProduct, createProduct, deleteProduct,
  createField, getField, setField, deleteField,
  getOrder, setOrder, createOrder, listOrders, getStats,
  getCart, setCart, clearCart,
  setDraft, getDraft, clearDraft,
  formatBRL, calcPrice, calcGamepassAmount,
  readStore, writeStore
};
