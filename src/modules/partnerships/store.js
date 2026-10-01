const { readGuildFile, writeGuildFile } = require("../../guildDb");
const NAMESPACE = "partnerships";
function defaultStore() {
  return {
    config: { enabled: false, channelId: null },
    users: {},
    total: 0,
    daily: { date: null, count: 0 },
    weekly: { week: null, count: 0 },
    links: {}
  };
}
function readStore() {
  const d = readGuildFile(null, NAMESPACE, defaultStore);
  d.config ||= { enabled: false, channelId: null };
  d.users ||= {};
  d.total ??= 0;
  d.daily ||= { date: null, count: 0 };
  d.weekly ||= { week: null, count: 0 };
  d.links ||= {};
  return d;
}
function writeStore(d){ writeGuildFile(null, NAMESPACE, d); }
function getConfig(){ return readStore().config; }
function setConfig(updater){
  const d=readStore();
  const cur=d.config;
  d.config = typeof updater==='function' ? updater(cur) : updater;
  writeStore(d);
  return d.config;
}
function getTodayKey(){
  const now=new Date();
  return now.toISOString().slice(0,10); 
}
function getWeekKey(){
  const now=new Date();
  const jan1=new Date(now.getFullYear(),0,1);
  const days=Math.floor((now - jan1)/86400000);
  const week=Math.ceil((days + jan1.getDay()+1)/7);
  return `${now.getFullYear()}-W${week}`;
}
function ensureDayWeekly(d){
  const today=getTodayKey();
  const week=getWeekKey();
  if(d.daily.date!==today){ d.daily={ date: today, count: 0 }; }
  if(d.weekly.week!==week){ d.weekly={ week, count: 0 }; }
  for(const uid of Object.keys(d.users)){
    const u=d.users[uid];
    if(u.dailyDate!==today){ u.dailyCount=0; u.dailyDate=today; }
    if(u.weeklyWeek!==week){ u.weeklyCount=0; u.weeklyWeek=week; }
  }
  const now=Date.now();
  for(const code of Object.keys(d.links||{})){
    if(now - d.links[code] > 24*60*60*1000) delete d.links[code];
  }
}
function extractInviteCodes(content){
  if(!content) return [];
  const re = /(?:discord\.gg\/|discord\.com\/invite\/|discordapp\.com\/invite\/|dsc\.gg\/)([a-zA-Z0-9\-]+)/gi;
  const codes=[];
  let m;
  while((m=re.exec(content))!==null){
    const code=m[1].toLowerCase();
    if(code && !codes.includes(code)) codes.push(code);
  }
  return codes;
}
function isLinkBlocked(codes){
  if(!codes?.length) return { blocked:false };
  const d=readStore();
  const now=Date.now();
  for(const code of codes){
    const last=d.links?.[code];
    if(last && (now - last) < 24*60*60*1000){
      const remainMs = 24*60*60*1000 - (now - last);
      const remainH = Math.ceil(remainMs/3600000);
      return { blocked:true, code, remainingMs: remainMs, remainingHours: remainH, last };
    }
  }
  return { blocked:false };
}
function recordLinks(codes){
  if(!codes?.length) return;
  const d=readStore();
  const now=Date.now();
  d.links ||= {};
  for(const code of codes) d.links[code]=now;
  writeStore(d);
}
function addPartnership(userId){
  const d=readStore();
  ensureDayWeekly(d);
  const today=getTodayKey();
  const week=getWeekKey();
  d.total=(d.total||0)+1;
  d.daily.count=(d.daily.count||0)+1;
  d.weekly.count=(d.weekly.count||0)+1;
  d.users[userId] ||= { total:0, dailyCount:0, dailyDate:today, weeklyCount:0, weeklyWeek:week };
  const u=d.users[userId];
  if(u.dailyDate!==today){ u.dailyCount=0; u.dailyDate=today; }
  if(u.weeklyWeek!==week){ u.weeklyCount=0; u.weeklyWeek=week; }
  u.total=(u.total||0)+1;
  u.dailyCount=(u.dailyCount||0)+1;
  u.weeklyCount=(u.weeklyCount||0)+1;
  u.lastAt=Date.now();
  writeStore(d);
  return { total:d.total, daily:d.daily.count, weekly:d.weekly.count, userTotal:u.total, userDaily:u.dailyCount, userWeekly:u.weeklyCount };
}
function getUserStats(userId){
  const d=readStore();
  ensureDayWeekly(d);
  const u=d.users[userId] || { total:0, dailyCount:0, weeklyCount:0 };
  const sorted=Object.entries(d.users).sort((a,b)=> (b[1].total||0)-(a[1].total||0));
  let rank=0;
  for(let i=0;i<sorted.length;i++){ if(sorted[i][0]===userId){ rank=i+1; break; } }
  if(!rank && d.users[userId]) rank=sorted.length;
  if(!rank) rank=0;
  return {
    total: u.total||0,
    daily: u.dailyCount||0,
    weekly: u.weeklyCount||0,
    rank,
    globalTotal: d.total||0,
    globalDaily: d.daily.count||0,
    globalWeekly: d.weekly.count||0,
    totalUsers: Object.keys(d.users).length
  };
}
function getRank(limit=10){
  const d=readStore();
  const sorted=Object.entries(d.users).map(([uid, st])=>({ userId:uid, total:st.total||0, daily:st.dailyCount||0, weekly:st.weeklyCount||0 })).sort((a,b)=> b.total-a.total).slice(0,limit);
  return sorted;
}
module.exports={ getConfig, setConfig, addPartnership, getUserStats, getRank, readStore, extractInviteCodes, isLinkBlocked, recordLinks };
