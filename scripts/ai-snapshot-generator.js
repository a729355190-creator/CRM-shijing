/**
 * AI 数据快照生成器
 * ------------------------------------------------------------
 * 为 AI Q&A 功能生成系统数据快照（JSON 格式）
 * 
 * 快照包含：
 *   - 广告投放：总消耗、加粉、高潜成交、高潜成本、定转率、城市维度拆分
 *   - 客服：定金数、定金金额、定转率、团队维度拆分
 *   - 门店：营业额、新客到店、客单价、城市维度拆分
 *   - 异常预警：偏离近7日均值 ≥10% 的指标
 * 
 * 输出路径：/opt/shijing-v6/cache/ai-snapshot-{date}.json
 * 默认生成昨天快照（与 AI 日报同步）
 * ------------------------------------------------------------
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// 配置路径
const DB_PATH = '/opt/shijing-v6/db/shijing.db';
const CACHE_DIR = '/opt/shijing-v6/cache';
const CONFIG_PATH = '/opt/shijing-v6/config.json';

// 工具函数
const round = (n, p = 2) => { const m = Math.pow(10, p); return Math.round((n || 0) * m) / m; };
const safeDiv = (a, b) => (!b ? 0 : a / b);
const pct = n => round(n, 1) + '%';
const money = n => '¥' + round(n, 2).toLocaleString('zh-CN');

// 本地时区日期格式化（禁止 toISOString）
function fmtLocalDate(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// 读配置
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('[snapshot] load config failed:', e.message);
  }
  return { teams: {}, aiReport: {} };
}

// 读数据库
function loadColl(db, c) {
  const rows = db.prepare(`SELECT data FROM shijing_${c} WHERE deleted = 0`).all();
  return rows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
}

// 近 N 天日期数组（不含目标日）
function prevDates(date, n) {
  const out = [];
  const base = new Date(date + 'T00:00:00');
  for (let i = 1; i <= n; i++) {
    const d = new Date(base.getTime() - i * 86400000);
    out.push(fmtLocalDate(d));
  }
  return out;
}

// 异常判定（沿用 AI 日报逻辑）
function judge(label, today, baseArr, opt, th) {
  opt = opt || {};
  const valid = baseArr.filter(v => typeof v === 'number' && !isNaN(v));
  if (valid.length < th.minDays) return null;
  const base = valid.reduce((s, v) => s + v, 0) / valid.length;
  if (base === 0 && today === 0) return null;
  if (base === 0) return null;
  const deltaPct = (today - base) / base;
  const abs = Math.abs(deltaPct);
  if (abs < th.deviate) return null;

  const lowerBetter = !!opt.lowerBetter;
  let kind;
  if (deltaPct > 0) kind = lowerBetter ? 'bad' : 'good';
  else kind = lowerBetter ? 'good' : 'bad';

  const level = abs >= th.deviate * 3 ? 'high' : (abs >= th.deviate * 1.5 ? 'mid' : 'low');
  const fmt = opt.fmt || (v => round(v, 2));
  return {
    label, kind, level,
    today: fmt(today), base: fmt(round(base, 2)),
    deltaPct: (deltaPct > 0 ? '+' : '') + pct(deltaPct * 100),
  };
}

// 生成快照
function generateSnapshot(date, thOverride) {
  const db = new Database(DB_PATH);
  const cfg = loadConfig();
  const teams = cfg.teams || {};
  
  // 阈值（默认值，可覆盖）
  const th = thOverride || {
    deviate: 0.10,
    window: 7,
    minDays: 3,
  };

  const win = prevDates(date, th.window);
  const teamName = id => (teams[id] && teams[id].name) || id;

  // 加载三表数据
  const adAll = loadColl(db, 'ad');
  const csAll = loadColl(db, 'cs');
  const storeAll = loadColl(db, 'store');

  const snapshot = {
    date,
    generatedAt: Date.now(),
    threshold: th,
    ad: { total: {}, byCity: [] },
    cs: { total: {}, byTeam: [] },
    store: { total: {}, byCity: [] },
    anomalies: { store: [], cs: [], city: [] },
  };

  // ============================================================
  // 1. 广告投放聚合
  // ============================================================
  // ad 表有两类记录：天维度(cityName=null) + 城市维度(cityName!=null)
  // 必须过滤 !cityName 才能算总量（避免重复计算）
  const adDayRows = adAll.filter(x => x.date === date && !x.cityName);
  const adCityRows = adAll.filter(x => x.date === date && x.cityName);

  // 天维度总量
  let totalCost = 0, totalFans = 0, totalDeep = 0;
  for (const r of adDayRows) {
    totalCost += (+r.cost || 0);
    totalFans += (+r.addFans || 0);
    totalDeep += (+r.deepConvert || 0);
  }
  snapshot.ad.total = {
    cost: round(totalCost, 2),
    addFans: round(totalFans, 0),
    deepConvert: round(totalDeep, 0),
    deepCost: totalDeep > 0 ? round(totalCost / totalDeep, 2) : null,
    convRate: pct(safeDiv(totalDeep, totalFans) * 100),
  };

  // 城市维度拆分
  const MIN_CITY_COST = 100;
  const cities = [...new Set(adCityRows.map(x => x.cityName).filter(Boolean))];
  for (const city of cities) {
    if (city === '其他') continue;
    const rows = adCityRows.filter(x => x.cityName === city);
    const cost = rows.reduce((s, x) => s + (+x.cost || 0), 0);
    if (cost < MIN_CITY_COST) continue;
    const fans = rows.reduce((s, x) => s + (+x.addFans || 0), 0);
    const deep = rows.reduce((s, x) => s + (+x.deepConvert || 0), 0);
    snapshot.ad.byCity.push({
      city,
      cost: round(cost, 2),
      addFans: round(fans, 0),
      deepConvert: round(deep, 0),
      deepCost: deep > 0 ? round(cost / deep, 2) : null,
      convRate: pct(safeDiv(deep, fans) * 100),
    });

    // 历史基准（用于异常判定）
    const deepCostHist = [], convHist = [];
    for (const d of win) {
      const histRows = adAll.filter(x => x.cityName === city && x.date === d);
      if (!histRows.length) continue;
      const hCost = histRows.reduce((s, x) => s + (+x.cost || 0), 0);
      if (hCost < MIN_CITY_COST) continue;
      const hFans = histRows.reduce((s, x) => s + (+x.addFans || 0), 0);
      const hDeep = histRows.reduce((s, x) => s + (+x.deepConvert || 0), 0);
      if (hDeep > 0) deepCostHist.push(hCost / hDeep);
      convHist.push(safeDiv(hDeep, hFans) * 100);
    }

    const items = [];
    let r;
    if (deep === 0 && cost >= MIN_CITY_COST) {
      items.push({ label: '高潜成交', kind: 'bad', level: 'high',
        today: '0个', base: '—', deltaPct: '消耗' + money(cost) + '但0高潜' });
    } else if (deep > 0) {
      r = judge('高潜成本', cost / deep, deepCostHist, { lowerBetter: true, fmt: money }, th);
      if (r) items.push(r);
    }
    r = judge('深转率', safeDiv(deep, fans) * 100, convHist, { fmt: v => round(v, 1) + '%' }, th);
    if (r) items.push(r);
    if (items.length) snapshot.anomalies.city.push({ id: city, name: city, items });
  }

  // ============================================================
  // 2. 客服聚合
  // ============================================================
  const csIds = [...new Set(csAll.map(x => x.teamId).filter(Boolean))];
  let totalDeposit = 0, totalDepAmt = 0, totalCsFans = 0;
  
  for (const cid of csIds) {
    if (teams[cid] && teams[cid].role !== 'cs') continue;
    const dayRows = csAll.filter(x => x.teamId === cid && x.date === date);
    if (!dayRows.length) continue;

    const deposit = dayRows.reduce((s, x) => s + (+x.depositCount || 0), 0);
    const depAmt = dayRows.reduce((s, x) => s + (+x.depositAmount || 0), 0);
    const fans = dayRows.reduce((s, x) => s + (+x.addFans || 0), 0);

    totalDeposit += deposit;
    totalDepAmt += depAmt;
    totalCsFans += fans;

    snapshot.cs.byTeam.push({
      teamId: cid,
      teamName: teamName(cid),
      depositCount: round(deposit, 0),
      depositAmount: round(depAmt, 2),
      addFans: round(fans, 0),
      convRate: pct(safeDiv(deposit, fans) * 100),
    });

    // 历史基准
    const depHist = [], amtHist = [], convHist = [];
    for (const d of win) {
      const rows = csAll.filter(x => x.teamId === cid && x.date === d);
      if (!rows.length) continue;
      const hDep = rows.reduce((s, x) => s + (+x.depositCount || 0), 0);
      const hAmt = rows.reduce((s, x) => s + (+x.depositAmount || 0), 0);
      const hFans = rows.reduce((s, x) => s + (+x.addFans || 0), 0);
      depHist.push(hDep);
      amtHist.push(hAmt);
      convHist.push(safeDiv(hDep, hFans) * 100);
    }

    const items = [];
    let r;
    r = judge('定金数', deposit, depHist, { fmt: v => round(v, 0) + '单' }, th);
    if (r) items.push(r);
    r = judge('定金金额', depAmt, amtHist, { fmt: money }, th);
    if (r) items.push(r);
    r = judge('定转率', safeDiv(deposit, fans) * 100, convHist, { fmt: v => round(v, 1) + '%' }, th);
    if (r) items.push(r);
    if (items.length) snapshot.anomalies.cs.push({ id: cid, name: teamName(cid), items });
  }

  snapshot.cs.total = {
    depositCount: round(totalDeposit, 0),
    depositAmount: round(totalDepAmt, 2),
    addFans: round(totalCsFans, 0),
    convRate: pct(safeDiv(totalDeposit, totalCsFans) * 100),
  };

  // ============================================================
  // 3. 门店聚合（按城市维度，门店按 teams[id].city 分组）
  // ============================================================
  const storeIds = [...new Set(storeAll.map(x => x.teamId).filter(Boolean))];
  const cityStoreMap = {}; // city → [teamIds]

  for (const sid of storeIds) {
    if (teams[sid] && teams[sid].role !== 'store') continue;
    const city = (teams[sid] && teams[sid].city) || '未知';
    if (!cityStoreMap[city]) cityStoreMap[city] = [];
    cityStoreMap[city].push(sid);
  }

  let totalRev = 0, totalArrive = 0;
  
  for (const city of Object.keys(cityStoreMap)) {
    const teamIds = cityStoreMap[city];
    const dayRows = storeAll.filter(x => teamIds.includes(x.teamId) && x.date === date);
    if (!dayRows.length) continue;

    const arrive = dayRows.filter(x => x.customerType === '新客').length;
    const rev = dayRows.reduce((s, x) => s + (+x.opAmount || 0) + (+x.closedAmount || 0), 0);
    const avgPrice = arrive > 0 ? rev / arrive : null;

    totalRev += rev;
    totalArrive += arrive;

    snapshot.store.byCity.push({
      city,
      revenue: round(rev, 2),
      newGuestArrive: round(arrive, 0),
      avgPrice: avgPrice ? round(avgPrice, 2) : null,
    });

    // 历史基准（按城市聚合）
    const arriveHist = [], revHist = [];
    for (const d of win) {
      const rows = storeAll.filter(x => teamIds.includes(x.teamId) && x.date === d);
      if (!rows.length) continue;
      arriveHist.push(rows.filter(x => x.customerType === '新客').length);
      revHist.push(rows.reduce((s, x) => s + (+x.opAmount || 0) + (+x.closedAmount || 0), 0));
    }

    const items = [];
    let r;
    r = judge('新客到店', arrive, arriveHist, { fmt: v => round(v, 0) + '人' }, th);
    if (r) items.push(r);
    r = judge('营业额', rev, revHist, { fmt: money }, th);
    if (r) items.push(r);
    if (items.length) snapshot.anomalies.store.push({ id: city, name: city, items });
  }

  snapshot.store.total = {
    revenue: round(totalRev, 2),
    newGuestArrive: round(totalArrive, 0),
    avgPrice: totalArrive > 0 ? round(totalRev / totalArrive, 2) : null,
  };

  db.close();
  return snapshot;
}

// 主函数
function main(dateOverride) {
  const date = dateOverride || fmtLocalDate(new Date(Date.now() - 86400000)); // 默认昨天
  
  // 确保缓存目录存在
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }

  console.log('[snapshot] generating for', date);
  const snapshot = generateSnapshot(date);
  
  const outFile = path.join(CACHE_DIR, `ai-snapshot-${date}.json`);
  fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 2), 'utf8');
  console.log('[snapshot] saved to', outFile);
  
  // 同时生成一份"最新快照"（不带日期后缀，方便 API 直接读）
  const latestFile = path.join(CACHE_DIR, 'ai-snapshot-latest.json');
  fs.writeFileSync(latestFile, JSON.stringify(snapshot, null, 2), 'utf8');
  console.log('[snapshot] also saved as latest');

  return snapshot;
}

// 命令行调用：node ai-snapshot-generator.js [YYYY-MM-DD]
if (require.main === module) {
  const argDate = process.argv[2];
  main(argDate);
}

module.exports = { generateSnapshot, main };