const crypto = require("node:crypto");
const { readGuildFile, writeGuildFile, updateGuildFile } = require("../../guildDb");
const NAMESPACE = "saldo";
function defaultStore() {
  return {
    config: { enabled: false, bonusPercent: 0, bonusTiers: [], cashbackPercent: 0, referralBonus: 0 },
    balances: {},
    transactions: {},
    topups: {}
  };
}
function readStore() {
  const data = readGuildFile(null, NAMESPACE, defaultStore);
  data.config ||= { enabled: false, bonusPercent: 0, bonusTiers: [], cashbackPercent: 0, referralBonus: 0 };
  data.balances ||= {};
  data.transactions ||= {};
  data.topups ||= {};
  if (typeof data.config.bonusPercent !== "number") data.config.bonusPercent = Number(data.config.bonusPercent) || 0;
  data.config.bonusPercent = Math.max(0, Math.min(100, Math.round(Number(data.config.bonusPercent)||0)));
  if (!Array.isArray(data.config.bonusTiers)) data.config.bonusTiers = [];
  data.config.bonusTiers = data.config.bonusTiers.filter(t=> Number.isFinite(Number(t.amount)) && Number.isFinite(Number(t.percent))).map(t=>({ amount: Math.round(Number(t.amount)*100)/100, percent: Math.max(0,Math.min(100,Math.round(Number(t.percent)))) })).sort((a,b)=>a.amount-b.amount).slice(0,10);
  data.config.cashbackPercent = Math.max(0, Math.min(30, Math.round(Number(data.config.cashbackPercent)||0)));
  data.config.referralBonus = Math.max(0, Math.min(100, Math.round(Number(data.config.referralBonus)||0)));
  if (typeof data.config.enabled !== "boolean") data.config.enabled = Boolean(data.config.enabled);
  const now = Date.now();
  let changed = false;
  for (const [k,v] of Object.entries(data.topups)) {
    if (v && v.status==="approved" && v.approvedAt && now - v.approvedAt > 7*24*60*60*1000) { delete data.topups[k]; changed=true; }
    if (v && v.createdAt && now - v.createdAt > 7*24*60*60*1000 && v.status!=="approved") { delete data.topups[k]; changed=true; }
  }
  if (changed) writeGuildFile(null, NAMESPACE, data);
  return data;
}
function writeStore(data) { writeGuildFile(null, NAMESPACE, data); }
function getConfig() { return readStore().config; }
function setConfig(updater) {
  const data = readStore();
  const cur = data.config;
  const next = typeof updater === "function" ? updater({ ...cur }) : { ...cur, ...updater };
  next.bonusPercent = Math.max(0, Math.min(100, Math.round(Number(next.bonusPercent) || 0)));
  if (next.bonusTiers && !Array.isArray(next.bonusTiers)) next.bonusTiers = [];
  if (Array.isArray(next.bonusTiers)) {
    next.bonusTiers = next.bonusTiers.filter(t=> Number.isFinite(Number(t.amount)) && Number.isFinite(Number(t.percent))).map(t=>({ amount: Math.round(Number(t.amount)*100)/100, percent: Math.max(0,Math.min(100,Math.round(Number(t.percent)))) })).sort((a,b)=>a.amount-b.amount).slice(0,10);
  }
  next.cashbackPercent = Math.max(0, Math.min(30, Math.round(Number(next.cashbackPercent) || 0)));
  next.referralBonus = Math.max(0, Math.min(100, Math.round(Number(next.referralBonus) || 0)));
  next.enabled = Boolean(next.enabled);
  data.config = next;
  writeStore(data);
  return next;
}
function isEnabled() { return Boolean(getConfig().enabled); }
function getBonusPercent() { return Number(getConfig().bonusPercent) || 0; }
function getBonusTiers(){ return getConfig().bonusTiers || []; }
function getBonusForAmount(amount){
  const tiers = getBonusTiers();
  const amt = Number(amount)||0;
  if(tiers.length){
    let best = 0;
    for(const t of tiers){ if(amt >= t.amount) best = t.percent; }
    return best; 
  }
  return getBonusPercent(); 
}
function addBonusTier(amount, percent){
  const data = readStore();
  data.config.bonusTiers ||= [];
  data.config.bonusTiers.push({ amount: Math.round(Number(amount)*100)/100, percent: Math.max(0,Math.min(100,Math.round(Number(percent)))) });
  data.config.bonusTiers.sort((a,b)=>a.amount-b.amount);
  if(data.config.bonusTiers.length>10) data.config.bonusTiers = data.config.bonusTiers.slice(0,10);
  writeStore(data);
  return data.config.bonusTiers;
}
function removeBonusTier(index){
  const data = readStore();
  if(Array.isArray(data.config.bonusTiers)) data.config.bonusTiers.splice(index,1);
  writeStore(data);
  return data.config.bonusTiers;
}
function getRanking(limit=10){
  const data = readStore();
  const entries = Object.entries(data.balances||{}).map(([userId, bal])=>({ userId, balance: Number(bal||0) })).filter(e=>e.balance>0).sort((a,b)=>b.balance-a.balance).slice(0, limit);
  return entries;
}
async function addCashbackAtomic(userId, amount, reason="Cashback"){
  const amt=Math.round(Number(amount)*100)/100;
  if(!Number.isFinite(amt) || amt<=0) return null;
  let result=null;
  await updateGuildFile(null, NAMESPACE, (data)=>{
    data.balances ||= {};
    data.transactions ||= {};
    const key=String(userId);
    const before=Number(data.balances[key]||0);
    const after=Math.round((before+amt)*100)/100;
    data.balances[key]=after;
    const tx={ id: genId(), type:"credit", amount:amt, bonus:0, total:amt, balanceAfter:after, reason:String(reason).slice(0,120), at:Date.now(), cashback:true };
    data.transactions[key] ||= [];
    data.transactions[key].unshift(tx);
    if(data.transactions[key].length>100) data.transactions[key]=data.transactions[key].slice(0,100);
    result={ok:true, before, after, tx};
    return data;
  }, defaultStore);
  return result;
}
async function transferAtomic(fromId, toId, amount, reasonFrom="Transferência enviada", reasonTo="Transferência recebida"){
  const amt = Math.round(Number(amount)*100)/100;
  if(!Number.isFinite(amt) || amt<=0) throw new Error("Valor inválido");
  if(String(fromId)===String(toId)) throw new Error("Não pode transferir para si mesmo");
  let result=null;
  await updateGuildFile(null, NAMESPACE, (data)=>{
    data.balances ||= {};
    data.transactions ||= {};
    const fromBal = Number(data.balances[String(fromId)]||0);
    if(fromBal < amt - 1e-9){ result={ok:false, reason:"Saldo insuficiente"}; return data; }
    const toBal = Number(data.balances[String(toId)]||0);
    const fromAfter = Math.round((fromBal - amt)*100)/100;
    const toAfter = Math.round((toBal + amt)*100)/100;
    data.balances[String(fromId)] = fromAfter;
    data.balances[String(toId)] = toAfter;
    const txFrom={ id: genId(), type:"debit", amount:amt, balanceAfter:fromAfter, reason:String(reasonFrom).slice(0,120), at:Date.now(), to: String(toId) };
    const txTo={ id: genId(), type:"credit", amount:amt, bonus:0, total:amt, balanceAfter:toAfter, reason:String(reasonTo).slice(0,120), at:Date.now(), from: String(fromId) };
    data.transactions[String(fromId)] ||= [];
    data.transactions[String(toId)] ||= [];
    data.transactions[String(fromId)].unshift(txFrom);
    data.transactions[String(toId)].unshift(txTo);
    if(data.transactions[String(fromId)].length>100) data.transactions[String(fromId)]=data.transactions[String(fromId)].slice(0,100);
    if(data.transactions[String(toId)].length>100) data.transactions[String(toId)]=data.transactions[String(toId)].slice(0,100);
    result={ok:true, fromAfter, toAfter, txFrom, txTo};
    return data;
  }, defaultStore);
  return result;
}
function getBalance(userId) { return Number(readStore().balances[String(userId)] || 0); }
function setBalance(userId, value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0 || num > 1e9) throw new Error("Valor de saldo inválido");
  const rounded = Math.round(num*100)/100;
  const data = readStore();
  data.balances[String(userId)] = rounded;
  writeStore(data);
  return rounded;
}
function getTransactions(userId) {
  const list = readStore().transactions[String(userId)] || [];
  return Array.isArray(list) ? list : [];
}
function pushTransaction(userId, entry) {
  const data = readStore();
  const key = String(userId);
  data.transactions[key] ||= [];
  data.transactions[key].unshift(entry);
  if (data.transactions[key].length > 100) data.transactions[key] = data.transactions[key].slice(0, 100);
  writeStore(data);
  return entry;
}
function genId(){ try{ return crypto.randomUUID().replace(/-/g,"").slice(0,16); }catch{ return `${Date.now()}${crypto.randomInt(0,1000)}`; } }
function addBalance(userId, amount, reason, meta = {}) {
  const bonusPercent = getBonusPercent();
  const amt = Math.round(Number(amount)*100)/100;
  if (!Number.isFinite(amt) || amt <=0 || amt>5000) throw new Error("Valor inválido");
  const bonus = Math.round(amt * (bonusPercent / 100) * 100) / 100;
  const totalAdd = Math.round((amt + bonus) * 100) / 100;
  const before = getBalance(userId);
  const after = Math.round((before + totalAdd) * 100) / 100;
  const data = readStore();
  data.balances[String(userId)] = after;
  const tx = {
    id: genId(),
    type: "credit",
    amount: amt,
    bonus,
    total: totalAdd,
    balanceAfter: after,
    reason: String(reason || "Adição de saldo").slice(0,120),
    at: Date.now(),
    ...meta
  };
  delete tx.at; tx.at = Date.now();
  data.transactions[String(userId)] ||= [];
  data.transactions[String(userId)].unshift(tx);
  if (data.transactions[String(userId)].length > 100) data.transactions[String(userId)] = data.transactions[String(userId)].slice(0, 100);
  writeStore(data);
  return { before, after, bonus, totalAdd, tx };
}
function creditTopup(userId, amount, bonus, total, reason, meta={}){
  if(bonus==null || total==null){
    const b = getBonusForAmount(amount);
    const amt2 = Math.round(Number(amount)*100)/100;
    const bon2 = Math.round(amt2 * (b/100)*100)/100;
    bonus = bon2; total = Math.round((amt2+bon2)*100)/100;
  }
  const amt = Math.round(Number(amount)*100)/100;
  const bon = Math.round(Number(bonus)*100)/100;
  const tot = Math.round(Number(total)*100)/100;
  if (!Number.isFinite(amt) || amt<=0) throw new Error("Valor inválido");
  const before = getBalance(userId);
  const after = Math.round((before + tot)*100)/100;
  const data = readStore();
  data.balances[String(userId)] = after;
  const tx = {
    id: genId(),
    type: "credit",
    amount: amt,
    bonus: bon,
    total: tot,
    balanceAfter: after,
    reason: String(reason||"Recarga").slice(0,120),
    at: Date.now(),
  };
  for(const [k,v] of Object.entries(meta||{})){
    if(!["id","type","amount","bonus","total","balanceAfter","reason","at"].includes(k)) tx[k]=v;
  }
  data.transactions[String(userId)] ||= [];
  data.transactions[String(userId)].unshift(tx);
  if (data.transactions[String(userId)].length > 100) data.transactions[String(userId)] = data.transactions[String(userId)].slice(0, 100);
  writeStore(data);
  return { before, after, bonus: bon, totalAdd: tot, tx };
}
function deductBalance(userId, amount, reason, meta = {}) {
  const before = getBalance(userId);
  const num = Math.round(Number(amount)*100)/100;
  if (!Number.isFinite(num) || num<=0) return { ok: false, reason: "Valor inválido" };
  if (before < num - 1e-9) return { ok: false, reason: "Saldo insuficiente" };
  const after = Math.round((before - num)*100)/100;
  const data = readStore();
  data.balances[String(userId)] = after;
  const tx = {
    id: genId(),
    type: "debit",
    amount: num,
    balanceAfter: after,
    reason: String(reason || "Compra").slice(0,120),
    at: Date.now(),
  };
  for(const [k,v] of Object.entries(meta||{})){
    if(!["id","type","amount","balanceAfter","reason","at"].includes(k)) tx[k]=v;
  }
  data.transactions[String(userId)] ||= [];
  data.transactions[String(userId)].unshift(tx);
  if (data.transactions[String(userId)].length > 100) data.transactions[String(userId)] = data.transactions[String(userId)].slice(0, 100);
  writeStore(data);
  return { ok: true, before, after, tx };
}
async function addBalanceAtomic(userId, amount, reason, meta={}){
  const amt = Math.round(Number(amount)*100)/100;
  if (!Number.isFinite(amt) || amt<=0) throw new Error("Valor inválido");
  return updateGuildFile(null, NAMESPACE, (data)=>{
    data.config ||= { enabled:false, bonusPercent:0 };
    data.balances ||= {};
    data.transactions ||= {};
    const bonusPercent = Math.max(0, Math.min(100, Math.round(Number(data.config.bonusPercent)||0)));
    const bonus = Math.round(amt * (bonusPercent/100)*100)/100;
    const totalAdd = Math.round((amt+bonus)*100)/100;
    const key=String(userId);
    const before = Number(data.balances[key]||0);
    const after = Math.round((before+totalAdd)*100)/100;
    data.balances[key]=after;
    const tx={ id: genId(), type:"credit", amount:amt, bonus, total:totalAdd, balanceAfter:after, reason:String(reason||"Recarga").slice(0,120), at:Date.now() };
    for(const [k,v] of Object.entries(meta||{})){ if(!["id","type","amount","bonus","total","balanceAfter","reason","at"].includes(k)) tx[k]=v; }
    data.transactions[key] ||= [];
    data.transactions[key].unshift(tx);
    if(data.transactions[key].length>100) data.transactions[key]=data.transactions[key].slice(0,100);
    return data;
  }, defaultStore).then(updated=>{
    const tx = updated.transactions[String(userId)][0];
    const after = updated.balances[String(userId)];
    const before = Math.round((after - tx.total)*100)/100;
    return { before, after, bonus: tx.bonus, totalAdd: tx.total, tx };
  });
}
async function deductBalanceAtomic(userId, amount, reason, meta={}){
  const num = Math.round(Number(amount)*100)/100;
  if (!Number.isFinite(num) || num<=0) return { ok:false, reason:"Valor inválido" };
  let result = null;
  await updateGuildFile(null, NAMESPACE, (data)=>{
    data.balances ||= {};
    data.transactions ||= {};
    const key=String(userId);
    const before = Number(data.balances[key]||0);
    if (before < num - 1e-9){ result={ok:false, reason:"Saldo insuficiente"}; return data; }
    const after = Math.round((before-num)*100)/100;
    data.balances[key]=after;
    const tx={ id: genId(), type:"debit", amount:num, balanceAfter:after, reason:String(reason||"Compra").slice(0,120), at:Date.now() };
    for(const [k,v] of Object.entries(meta||{})){ if(!["id","type","amount","balanceAfter","reason","at"].includes(k)) tx[k]=v; }
    data.transactions[key] ||= [];
    data.transactions[key].unshift(tx);
    if(data.transactions[key].length>100) data.transactions[key]=data.transactions[key].slice(0,100);
    result={ok:true, before, after, tx};
    return data;
  }, defaultStore);
  return result || { ok:false, reason:"Erro" };
}
async function creditTopupAtomic(userId, amount, bonus, total, reason, meta={}){
  const amt=Math.round(Number(amount)*100)/100;
  const bon=Math.round(Number(bonus)*100)/100;
  const tot=Math.round(Number(total)*100)/100;
  return updateGuildFile(null, NAMESPACE, (data)=>{
    data.balances ||= {};
    data.transactions ||= {};
    const key=String(userId);
    const before=Number(data.balances[key]||0);
    const after=Math.round((before+tot)*100)/100;
    data.balances[key]=after;
    const tx={ id: genId(), type:"credit", amount:amt, bonus:bon, total:tot, balanceAfter:after, reason:String(reason||"Recarga").slice(0,120), at:Date.now() };
    for(const [k,v] of Object.entries(meta||{})){ if(!["id","type","amount","bonus","total","balanceAfter","reason","at"].includes(k)) tx[k]=v; }
    data.transactions[key] ||= [];
    data.transactions[key].unshift(tx);
    if(data.transactions[key].length>100) data.transactions[key]=data.transactions[key].slice(0,100);
    return data;
  }, defaultStore).then(updated=>{
    const tx=updated.transactions[String(userId)][0];
    const after=updated.balances[String(userId)];
    const before=Math.round((after - tx.total)*100)/100;
    return { before, after, bonus:bon, totalAdd:tot, tx };
  });
}
function formatBRL(v){ return `R$ ${Number(v||0).toFixed(2).replace(".",",")}`; }
function getTopup(id){ return readStore().topups[String(id)] || null; }
function setTopup(id, updater){
  const data = readStore();
  const cur = data.topups[String(id)];
  if (!cur && typeof updater === "function") return null;
  const next = typeof updater === "function" ? updater({ ...cur }) : updater;
  if(next && next.status && !["await_amount","await_confirmation","await_approval","approved"].includes(next.status)) next.status="await_amount";
  data.topups[String(id)] = next;
  writeStore(data);
  return data.topups[String(id)];
}
function createTopup({ userId, guildId, channelId, threadId }) {
  const data = readStore();
  const id = genId();
  data.topups[id] = { id, userId: String(userId), guildId, channelId, threadId, amount: null, bonus: null, total: null, pixPayload: null, status: "await_amount", createdAt: Date.now() };
  writeStore(data);
  return data.topups[id];
}
function deleteTopup(id){
  const data = readStore();
  delete data.topups[String(id)];
  writeStore(data);
}
async function approveTopupAtomic(topupId, approverId){
  let result=null;
  await updateGuildFile(null, NAMESPACE, (data)=>{
    data.balances ||= {};
    data.transactions ||= {};
    data.topups ||= {};
    const topup = data.topups[String(topupId)];
    if(!topup) { result={ok:false, reason:"Recarga não encontrada"}; return data; }
    if(topup.status==="approved"){ result={ok:false, reason:"Já aprovado"}; return data; }
    if(!topup.amount || !topup.total){ result={ok:false, reason:"Valor não definido"}; return data; }
    const amt = Math.round(Number(topup.amount)*100)/100;
    const bon = Math.round(Number(topup.bonus||0)*100)/100;
    const tot = Math.round(Number(topup.total|| (amt+bon))*100)/100;
    const key = String(topup.userId);
    const before = Number(data.balances[key]||0);
    const after = Math.round((before+tot)*100)/100;
    data.balances[key]=after;
    const tx={ id: genId(), type:"credit", amount:amt, bonus:bon, total:tot, balanceAfter:after, reason:`Recarga #${String(topupId).slice(-6)}`, at:Date.now(), orderId: String(topupId) };
    data.transactions[key] ||= [];
    data.transactions[key].unshift(tx);
    if(data.transactions[key].length>100) data.transactions[key]=data.transactions[key].slice(0,100);
    topup.status="approved";
    topup.approvedBy = approverId;
    topup.approvedAt = Date.now();
    result={ok:true, before, after, bonus:bon, totalAdd:tot, tx, topup: {...topup}};
    return data;
  }, defaultStore);
  return result;
}
module.exports = {
  getConfig, setConfig, isEnabled, getBonusPercent, getBonusTiers, getBonusForAmount, addBonusTier, removeBonusTier, getRanking, transferAtomic, addCashbackAtomic,
  getBalance, setBalance, addBalance, deductBalance, creditTopup, addBalanceAtomic, deductBalanceAtomic, creditTopupAtomic, approveTopupAtomic, getTransactions, pushTransaction, formatBRL,
  getTopup, setTopup, createTopup, deleteTopup,
  readStore, writeStore
};
