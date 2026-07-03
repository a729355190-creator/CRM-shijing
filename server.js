// 仕净管理系统 - 轻量服务器版（Express + SQLite）
// 启动：node server.js  或  pm2 start server.js --name shijing
require('dotenv').config(); // 加载 .env (DEEPSEEK_API_KEY, JWT_SECRET 等)
const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const url = require('url');
const Database = require('better-sqlite3');
const cron = require('node-cron');
const compression = require('compression');  // ← 性能优化：gzip 压缩
const helmet = require('helmet');

const PORT = process.env.PORT || 8788;

// ===== 预约容量校验辅助函数 =====
function parseTimeToMinutes(isoTime) {
  const hour = parseInt(String(isoTime || "").slice(11, 13));
  const min = parseInt(String(isoTime || "").slice(14, 16));
  return hour * 60 + min;
}
// 推送总开关：true=跳过所有企微推送(门店/客服/总部群+AI日报)。上线推送当天改 .env 的 V6_DEV_MODE=false 再 pm2 restart 即可，无需改代码。
const V6_DEV_MODE = String(process.env.V6_DEV_MODE).toLowerCase() !== 'false'; // 默认 true(不推)，仅显式设为 false 才真推
const v6UserSystem = require("./v6-user-system");
const v6AppRoutes = require("./v6-app-routes");
const v6Creatives = require("./v6-creatives");
const v6Scripts = require("./v6-scripts");
const ROOT = __dirname;
const DB_FILE = path.join(ROOT, 'db', 'shijing.db');

// ========== 数据库初始化 ==========
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');

// 业务表（统一 schema：每条记录一行 id + JSON data + deleted 标记）
const COLLECTIONS = ['ad', 'cs', 'store', 'invite'];
for (const c of COLLECTIONS) {
  db.exec(`CREATE TABLE IF NOT EXISTS shijing_${c} (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    deleted INTEGER DEFAULT 0,
    deletedAt INTEGER,
    createdAt INTEGER DEFAULT (strftime('%s','now')*1000)
  )`);
}
db.exec(`CREATE TABLE IF NOT EXISTS shijing_config (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updatedAt INTEGER DEFAULT (strftime('%s','now')*1000)
)`);

// ========== 工具函数 ==========
function pushWecom(webhook, content) {
  if (V6_DEV_MODE) { console.log("[v6-dev] pushWecom skipped"); return Promise.resolve({errcode:0,dev_skipped:true}); }
  return new Promise(resolve => {
    if (!webhook) return resolve({ errcode: -1, errmsg: 'no webhook' });
    const data = JSON.stringify({ msgtype: 'markdown', markdown: { content } });
    const u = url.parse(webhook);
    const req = https.request({
      hostname: u.hostname, path: u.path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, res => {
      let body = ''; res.on('data', c => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({ errcode: -2, errmsg: body }); } });
    });
    req.on('error', e => resolve({ errcode: -3, errmsg: e.message }));
    req.write(data); req.end();
  });
}

// AI 日报专用推送函数：不受 V6_DEV_MODE 控制，配了 webhook 就一定发
function pushWecomAI(webhook, content) {
  return new Promise(resolve => {
    if (!webhook) return resolve({ errcode: -1, errmsg: 'no webhook' });
    const data = JSON.stringify({ msgtype: 'markdown', markdown: { content } });
    const u = require('url').parse(webhook);
    const req = require('https').request({
      hostname: u.hostname, path: u.path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, res => {
      let body = ''; res.on('data', c => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({errcode:-2,errmsg:body}); } });
    });
    req.on('error', e => resolve({ errcode: -3, errmsg: e.message }));
    req.write(data); req.end();
  });
}


function getConfig() {
  const row = db.prepare("SELECT data FROM shijing_config WHERE id='main'").get();
  return row ? JSON.parse(row.data) : null;
}

function setConfig(cfg) {
  const j = JSON.stringify(cfg);
  db.prepare(`INSERT INTO shijing_config(id, data, updatedAt) VALUES('main', ?, ?)
    ON CONFLICT(id) DO UPDATE SET data=excluded.data, updatedAt=excluded.updatedAt`)
    .run(j, Date.now());
}

// 默认配置（首次启动初始化）
const DEFAULT_CONFIG = {
  teams: {
    ad_1: { name: '营销线1部', role: 'ad', password: 'TF001' },
    ad_2: { name: '营销线2部', role: 'ad', password: 'TF66' },
    ad_3: { name: '营销线3部', role: 'ad', password: 'TF88' },
    cs_1: { name: '客服销售线1部', role: 'cs', password: 'KF001' },
    cs_2: { name: '客服销售线2部', role: 'cs', password: 'KF66' },
    cs_3: { name: '客服销售线3部', role: 'cs', password: 'KF88' },
    store_1: { name: '长沙万达店', role: 'store', password: 'CS001' },
    store_2: { name: '上海静安店', role: 'store', password: 'MD001' },
    store_3: { name: '上海闵行店', role: 'store', password: 'MD002' },
    store_4: { name: '上海浦东店', role: 'store', password: 'MD003' },
    store_5: { name: '佛山南海店', role: 'store', password: 'MD004' },
    hq: { name: '总部服务线', role: 'hq', password: 'SJ88' },
  },
  wecomConfig: {
    storeWebhooks: {
      store_1: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=907e5fad-a397-451c-9702-06b9b52f34fd',
      store_2: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=907e5fad-a397-451c-9702-06b9b52f34fd',
      store_3: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=907e5fad-a397-451c-9702-06b9b52f34fd',
      store_4: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=907e5fad-a397-451c-9702-06b9b52f34fd',
      store_5: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=907e5fad-a397-451c-9702-06b9b52f34fd',
    },
    hqWebhook: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=d10d0c20-0c7b-46f3-ab10-ae501ccb1f91',
    docArchiveUrl: '',
    reminderHour: 19,
  },
  _schema: 'v5_vps',
};
if (!getConfig()) setConfig(DEFAULT_CONFIG);

// ========== Express 应用 ==========
const app = express();
app.set('trust proxy', 1);
// 性能优化：gzip 压缩所有响应（HTML/JSON/CSS/JS），首屏体积 -70%
app.use(compression({ level: 6, threshold: 1024 }));
// V6_HELMET_PATCH_2026_06_08：保守 helmet 配置（禁用 CSP 避免破坏内联 JS）
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
}));
app.use(express.json({ limit: '5mb' }));

// 静态文件（前端）
// 给 index.html 强制不缓存（避免用户浏览器持有过期前端逻辑）
app.use((req, res, next) => {
  if (req.path === '/' || req.path === '/index.html') {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});
// v6 路由必须在 express.static 之前（让 / 重定向到 /workspace 生效）
v6UserSystem(app, db);
v6AppRoutes(app, db);
v6Creatives(app, db, { ocGetValidToken, getConfig });
require("./v6-uploads")(app, db);
v6Scripts(app, db);
app.use(express.static(path.join(ROOT, 'public')));


// === V6_SECURITY_PATCH_2026_06_08 ===
// 必须 v6 用户已登录（cookie 里有 sj_v6_token）
function v6Required(req, res, next) {
  if (!req.v6User) return res.status(401).json({ ok: false, error: 'unauthorized' });
  next();
}
function v6HQRequired(req, res, next) {
  if (!req.v6User) return res.status(401).json({ ok: false, error: 'unauthorized' });
  if (req.v6User.role !== 'hq') return res.status(403).json({ ok: false, error: 'hq only' });
  next();
}
// === END V6_SECURITY_PATCH ===


// ===== API：业务数据 CRUD =====
app.post('/api/list', v6Required, (req, res) => {
  const out = {};
  const user = req.v6User;
  for (const c of COLLECTIONS) {
    let rows;
    // 数据隔离规则：
    // - HQ 看全部
    // - 投放用户：只能看投放数据，按 teamId 过滤
    // - 客服用户：只能看客服数据，按 teamId 过滤
    // - 门店用户：只能看门店数据，按 teamId 过滤
    if (user.role !== 'hq' && user.teamId) {
      if (user.role === 'ad' && c === 'ad') {
        // 投放用户：只能看投放数据
        rows = db.prepare(`SELECT data FROM shijing_ad WHERE deleted = 0 AND JSON_EXTRACT(data, '$.teamId') = ?`).all(user.teamId);
      } else if (user.role === 'cs' && (c === 'cs' || c === 'invite')) {
        // 客服用户：能看客服数据 + 排客数据（按 csTeamId 过滤）
        if (c === 'cs') {
          rows = db.prepare(`SELECT data FROM shijing_cs WHERE deleted = 0 AND JSON_EXTRACT(data, '$.teamId') = ?`).all(user.teamId);
        } else if (c === 'invite') {
          rows = db.prepare(`SELECT data FROM shijing_invite WHERE deleted = 0 AND JSON_EXTRACT(data, '$.csTeamId') = ?`).all(user.teamId);
        }
      } else if (user.role === 'store' && (c === 'store' || c === 'invite')) {
        // 门店用户：能看门店数据 + 排客数据（按 storeTeamId 过滤）
        if (c === 'store') {
          rows = db.prepare(`SELECT data FROM shijing_store WHERE deleted = 0 AND JSON_EXTRACT(data, '$.teamId') = ?`).all(user.teamId);
        } else if (c === 'invite') {
          rows = db.prepare(`SELECT data FROM shijing_invite WHERE deleted = 0 AND JSON_EXTRACT(data, '$.storeTeamId') = ?`).all(user.teamId);
        }
      } else {
        rows = [];
      }
    } else {
      rows = db.prepare(`SELECT data FROM shijing_${c} WHERE deleted = 0`).all();
    }
    out[c] = rows.map(r => JSON.parse(r.data));
  }
  res.json({ ok: true, data: out });
});

app.post('/api/add', v6Required, (req, res) => {
  const { collection: col, record } = req.body || {};
  if (!COLLECTIONS.includes(col) || !record || !record.id) return res.json({ ok: false, error: 'bad params' });
  try {
    // 门店服务登记自动合并占位：同店+同天+同人(手机号优先/姓名兜底)若已有 autoCreated 占位记录，
    // 则把本次登记内容回填覆盖到占位那条（保留占位 id），不再新建，避免客户中心一人两条。
    if (col === 'store' && record.autoCreated !== true) {
      const pk = p => String(p == null ? '' : p).trim().replace(/\s|-/g, '');
      const nn = x => String(x == null ? '' : x).trim();
      const newPhone = pk(record.phone || record.customerPhone);
      const newName = nn(record.customerName);
      const newDate = nn(record.date) || nn(record.arriveTime).slice(0, 10);
      const newTeam = nn(record.teamId);
      if ((newPhone || newName) && newDate) {
        const rows = db.prepare('SELECT id, data FROM shijing_store WHERE deleted=0').all()
          .map(r => ({ id: r.id, d: JSON.parse(r.data) }));
        const hit = rows.find(r => {
          const x = r.d;
          if (!x.autoCreated) return false;
          if (nn(x.teamId) !== newTeam) return false;
          const xDate = nn(x.date) || nn(x.arriveTime).slice(0, 10);
          if (xDate !== newDate) return false;
          const xPhone = pk(x.phone || x.customerPhone);
          if (newPhone && xPhone) return xPhone === newPhone;
          return nn(x.customerName) === newName;
        });
        if (hit) {
          const merged = { ...hit.d, ...record, id: hit.id, autoCreated: false, mergedFromPlaceholder: true, mergedAt: Date.now() };
          db.prepare('UPDATE shijing_store SET data=? WHERE id=?').run(JSON.stringify(merged), hit.id);
          return res.json({ ok: true, merged: true, intoId: hit.id });
        }
      }
    }

    // ===== 客服排客容量校验（invite + pending + storeTeamId + arriveTime）=====
    if (col === "invite" && record.status === "pending" && record.storeTeamId && record.arriveTime) {
      try {
        const cfg = getConfig() || {};
        const teams = cfg.teams || {};
        const team = teams[record.storeTeamId];
        if (!team) {
          return res.json({ ok: false, error: "门店不存在" });
        }

        const maxPerSlot = team.maxPerSlot || 1;
        const slotConfig = team.slotConfig || { newCustomerMinutes: 60, oldCustomerMinutes: 30 };
        const customerType = record.customerType || "new";
        const newDuration = customerType === "new" ? slotConfig.newCustomerMinutes : slotConfig.oldCustomerMinutes;

        // 计算新预约的时间区间
        const dateStr = String(record.arriveTime).slice(0, 10);
        const newStart = parseTimeToMinutes(record.arriveTime);
        const newEnd = newStart + newDuration;

        // 获取同一天的已有pending记录
        const rows = db.prepare("SELECT id, data FROM shijing_invite WHERE deleted=0 AND id != ?").all(record.id);
        const intervals = [];
        for (const r of rows) {
          const inv = JSON.parse(r.data);
          if (inv.status === "pending" && inv.storeTeamId === record.storeTeamId && String(inv.arriveTime).slice(0, 10) === dateStr) {
            const invType = inv.customerType || "new";
            const invDuration = invType === "new" ? slotConfig.newCustomerMinutes : slotConfig.oldCustomerMinutes;
            const invStart = parseTimeToMinutes(inv.arriveTime);
            const invEnd = invStart + invDuration;
            intervals.push([invStart, invEnd]);
          }
        }

        // 区间重叠峰值计算
        intervals.push([newStart, newEnd]);
        const points = [];
        for (const [s, e] of intervals) {
          points.push({ time: s, type: "start" });
          points.push({ time: e, type: "end" });
        }
        points.sort((a, b) => a.time - b.time || (a.type === "end" ? -1 : 1));
        let current = 0, peak = 0;
        for (const p of points) {
          if (p.type === "start") current++;
          else current--;
          peak = Math.max(peak, current);
        }

        // 满员校验
        if (peak > maxPerSlot) {
          // 推荐下一个可用时段
          let suggestTime = null;
          const searchEnd = 20 * 60; // 最晚20:00
          for (let t = newEnd; t <= searchEnd; t += 15) {
            const testIntervals = intervals.slice(0, -1); // 移除当前预约
            testIntervals.push([t, t + newDuration]);
            const testPoints = [];
            for (const [s, e] of testIntervals) {
              testPoints.push({ time: s, type: "start" });
              testPoints.push({ time: e, type: "end" });
            }
            testPoints.sort((a, b) => a.time - b.time || (a.type === "start" ? -1 : 1));
            let tc = 0, tp = 0;
            for (const p of testPoints) {
              if (p.type === "start") tc++;
              else tc--;
              tp = Math.max(tp, tc);
            }
            if (tp <= maxPerSlot) {
              suggestTime = dateStr + "T" + String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0");
              break;
            }
          }

          return res.json({
            ok: false,
            error: "时段已满，当前峰值" + peak + "人，超过容量" + maxPerSlot,
            peakOccupancy: peak,
            maxPerSlot,
            suggestTime,
          });
        }
      } catch (e) {
        console.error("[slot-check] error:", e);
        // 校验失败时继续执行（降级策略）
      }
    }

    db.prepare(`INSERT INTO shijing_${col}(id, data) VALUES(?, ?)`).run(record.id, JSON.stringify(record));
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.post('/api/update', v6Required, (req, res) => {
  const { collection: col, id, data } = req.body || {};
  if (!COLLECTIONS.includes(col) || !id || !data) return res.json({ ok: false, error: 'bad params' });
  try {
    const row = db.prepare(`SELECT data FROM shijing_${col} WHERE id=?`).get(id);
    if (!row) return res.json({ ok: false, error: 'not found' });
    const before = JSON.parse(row.data);
    const merged = Object.assign({}, before, data);
    db.prepare(`UPDATE shijing_${col} SET data=? WHERE id=?`).run(JSON.stringify(merged), id);
    res.json({ ok: true });

    // === Hook: 邀约状态从 pending → arrived 时自动推送客服群 ===
    if (col === 'invite' && before.status !== 'arrived' && merged.status === 'arrived' && merged.csTeamId) {
      try {
        const cfgX = getConfig() || {};
        const teamsX = (cfgX.teams) || {};
        const csWebhooks = (cfgX.wecomConfig && cfgX.wecomConfig.csWebhooks) || {};
        const url = csWebhooks[merged.csTeamId];
        if (url) {
          const storeName = (teamsX[merged.storeTeamId] && teamsX[merged.storeTeamId].name) || merged.storeTeamId || '门店';
          const content = `## ✅ 客户已到店\n` +
            `> 顾客：<font color="info">**${merged.customerName}**</font> · ${maskPhone(merged.phone || '')}\n` +
            `> 到店时间：**${(merged.arriveTime || '').replace('T', ' ')}** · ${storeName}\n` +
            `\n**门店已确认顾客到店 ✓**\n` +
            `\n*门店反馈：${storeName} · 反馈时间：${new Date().toLocaleString('zh-CN')}*`;
          pushWecom(url, content).catch(e => console.warn('[update-arrived-notify]', e.message));
          console.log('[update-arrived-notify]', merged.customerName, '→', merged.csTeamId);
        }
      } catch (e) { console.warn('[update-arrived-hook]', e.message); }
    }

    // === Hook: 邀约状态从 pending → no_show 时自动推送客服群 ===
    if (col === 'invite' && before.status !== 'no_show' && merged.status === 'no_show' && merged.csTeamId) {
      try {
        const cfgX = getConfig() || {};
        const teamsX = (cfgX.teams) || {};
        const csWebhooks = (cfgX.wecomConfig && cfgX.wecomConfig.csWebhooks) || {};
        const url = csWebhooks[merged.csTeamId];
        if (url) {
          const storeName = (teamsX[merged.storeTeamId] && teamsX[merged.storeTeamId].name) || merged.storeTeamId || '门店';
          const reason = merged.noShowReason || '（未填写原因）';
          const content = `## ⚠️ 客户未到店\n` +
            `> 顾客：<font color="warning">**${merged.customerName}**</font> · ${maskPhone(merged.phone || '')}\n` +
            `> 预约：**${(merged.arriveTime || '').replace('T', ' ')}** · ${storeName}\n` +
            `\n**未到店原因：${reason}**\n` +
            `\n*门店反馈：${storeName} · 反馈时间：${new Date().toLocaleString('zh-CN')}*`;
          pushWecom(url, content).catch(e => console.warn('[update-noshow-notify]', e.message));
          console.log('[update-noshow-notify]', merged.customerName, '→', merged.csTeamId, '|', reason);
        }
      } catch (e) { console.warn('[update-noshow-hook]', e.message); }
    }

    // === Hook: 客服取消排客（pending → cancelled）→ 通知门店群撤销接待 ===
    if (col === 'invite' && before.status !== 'cancelled' && merged.status === 'cancelled' && merged.storeTeamId) {
      try {
        const cfgX = getConfig() || {};
        const teamsX = (cfgX.teams) || {};
        const storeWebhooksX = (cfgX.wecomConfig && cfgX.wecomConfig.storeWebhooks) || {};
        const url = storeWebhooksX[merged.storeTeamId];
        if (url) {
          const storeName = (teamsX[merged.storeTeamId] && teamsX[merged.storeTeamId].name) || merged.storeTeamId || '门店';
          const csName = (teamsX[merged.csTeamId] && teamsX[merged.csTeamId].name) || merged.csTeamName || merged.csTeamId || '客服';
          const content = `## 🚫 排客已取消\n` +
            `> 顾客：<font color=\"warning\">**${merged.customerName}**</font> · ${maskPhone(merged.phone || '')}\n` +
            `> 原约到店：**${(merged.arriveTime || '').replace('T', ' ')}** · ${storeName}\n` +
            `> 取消原因：${merged.cancelReason || '（未填写）'}\n` +
            `\n**该顾客今日无需接待，请勿再等待。**\n` +
            `\n*由 ${csName} 取消 · ${new Date().toLocaleString('zh-CN')}*`;
          pushWecom(url, content).catch(e => console.warn('[update-cancel-notify]', e.message));
          console.log('[update-cancel-notify]', merged.customerName, '→', merged.storeTeamId);
        }
      } catch (e) { console.warn('[update-cancel-hook]', e.message); }
    }

    // === Hook: 客服修改排客（reNotify 且仍 pending）→ 通知门店群更新接待信息 ===
    if (col === 'invite' && data && data.reNotify === true && merged.status === 'pending' && merged.storeTeamId) {
      try {
        const cfgX = getConfig() || {};
        const teamsX = (cfgX.teams) || {};
        const storeWebhooksX = (cfgX.wecomConfig && cfgX.wecomConfig.storeWebhooks) || {};
        const url = storeWebhooksX[merged.storeTeamId];
        if (url) {
          if (!merged.confirmTokens) { merged.confirmTokens = { arrived: genToken(), noshow: genToken() }; }
          // 改约后重置 notified，写回 confirmTokens
          merged.notified = true; merged.notifiedAt = Date.now();
          db.prepare(`UPDATE shijing_invite SET data=? WHERE id=?`).run(JSON.stringify(merged), id);
          const storeName = (teamsX[merged.storeTeamId] && teamsX[merged.storeTeamId].name) || merged.storeTeamId || '门店';
          const csName = (teamsX[merged.csTeamId] && teamsX[merged.csTeamId].name) || merged.csTeamName || merged.csTeamId || '客服';
          const oldStoreName = (teamsX[before.storeTeamId] && teamsX[before.storeTeamId].name) || before.storeTeamId || '';
          const changedStore = before.storeTeamId !== merged.storeTeamId;
          const baseUrl = 'https://crmai.quesiai.com';
          const content = `## 🔄 排客信息已更新\n` +
            `> 顾客：<font color=\"info\">**${merged.customerName}**</font> · ${maskPhone(merged.phone || '')}\n` +
            `> 最新到店：**${(merged.arriveTime || '').replace('T', ' ')}** · ${storeName}\n` +
            (changedStore ? `> （门店已由「${oldStoreName}」改为「${storeName}」）\n` : '') +
            `> 备注：${merged.remark || '-'}\n` +
            `\n请按最新信息做好接待，并在客户到店后及时反馈：\n\n` +
            `[ ✓  确认已到店 ](${baseUrl}/c/${merged.confirmTokens.arrived})\n\n　\n\n　\n\n` +
            `[ ✗  未到店反馈 ](${baseUrl}/c/${merged.confirmTokens.noshow})\n\n` +
            `——\n*由 ${csName} 修改 · ${new Date().toLocaleString('zh-CN')}*`;
          pushWecom(url, content).catch(e => console.warn('[update-rebook-notify]', e.message));
          console.log('[update-rebook-notify]', merged.customerName, '→', merged.storeTeamId, changedStore ? '(店变更)' : '');
        }
      } catch (e) { console.warn('[update-rebook-hook]', e.message); }
    }
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.post('/api/delete', v6Required, (req, res) => {
  const { collection: col, id } = req.body || {};
  if (!COLLECTIONS.includes(col) || !id) return res.json({ ok: false, error: 'bad params' });
  try {
    db.prepare(`UPDATE shijing_${col} SET deleted=1, deletedAt=? WHERE id=?`).run(Date.now(), id);
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// ===== API：配置 =====
app.get('/api/config', (req, res) => {
  // V6 安全：未登录用户只看 teams 的 name/role（注册下拉用），不泄露团队密码；敏感字段（webhook/oceanengine）需登录
  const cfg = getConfig() || {};
  if (!req.v6User) {
    const safeTeams = {};
    for (const [tid, t] of Object.entries(cfg.teams || {})) {
      safeTeams[tid] = { name: (t && t.name) || tid, role: (t && t.role) || '' };
      // 容量配置字段也返回（不敏感）
      if (t && t.maxPerSlot) safeTeams[tid].maxPerSlot = t.maxPerSlot;
      if (t && t.slotConfig) safeTeams[tid].slotConfig = t.slotConfig;
      if (t && t.deleted) safeTeams[tid].deleted = true;
    }
    return res.json({ ok: true, config: { teams: safeTeams } });
  }
  res.json({ ok: true, config: cfg });
});

app.post('/api/config', v6HQRequired, (req, res) => {
  const { teams, wecomConfig } = req.body || {};
  const cfg = getConfig() || DEFAULT_CONFIG;
  if (teams) cfg.teams = teams;
  if (wecomConfig) cfg.wecomConfig = wecomConfig;
  cfg._schema = 'v5_vps';
  setConfig(cfg);
  res.json({ ok: true });
});

// ===== API：企微推送 =====
app.post('/api/wecom-push', v6Required, async (req, res) => {
  const { webhook, content } = req.body || {};
  if (!webhook || !content) return res.json({ errcode: -1, errmsg: 'missing params' });
  const r = await pushWecom(webhook, content);
  res.json(r);
});

app.post('/api/wecom-push-hq', v6Required, async (req, res) => {
  const { content } = req.body || {};
  if (!content) return res.json({ ok: false, error: 'no content' });
  const cfg = getConfig();
  const hq = cfg && cfg.wecomConfig && cfg.wecomConfig.hqWebhook;
  if (!hq) return res.json({ ok: false, error: 'no hq webhook' });
  const r = await pushWecom(hq, content);
  res.json({ ok: r.errcode === 0, result: r });
});

// 即时到店推送（带一键反馈蓝链）
app.post('/api/wecom-push-arrival', async (req, res) => {
  const { inviteId } = req.body || {};
  if (!inviteId) return res.json({ ok: false, error: 'no inviteId' });
  const row = db.prepare(`SELECT data FROM shijing_invite WHERE id=? AND deleted=0`).get(inviteId);
  if (!row) return res.json({ ok: false, error: 'invite not found' });
  const inv = JSON.parse(row.data);

  // 生成或复用 confirmTokens
  if (!inv.confirmTokens) {
    inv.confirmTokens = { arrived: genToken(), noshow: genToken() };
  }
  inv.notified = true;
  inv.notifiedAt = Date.now();
  db.prepare(`UPDATE shijing_invite SET data=? WHERE id=?`).run(JSON.stringify(inv), inv.id);

  const cfg = getConfig();
  const teams = (cfg && cfg.teams) || {};
  const storeWebhooks = (cfg && cfg.wecomConfig && cfg.wecomConfig.storeWebhooks) || {};
  const url = storeWebhooks[inv.storeTeamId];
  if (!url) return res.json({ ok: false, error: 'no store webhook' });

  const csName = (teams[inv.csTeamId] && teams[inv.csTeamId].name) || inv.csTeamName || inv.csTeamId;
  const storeName = (teams[inv.storeTeamId] && teams[inv.storeTeamId].name) || inv.storeTeamId;
  const baseUrl = 'https://crmai.quesiai.com';
  const content = `## 📍 顾客即将到店通知\n` +
    `> 客户姓名：<font color="info">**${inv.customerName}**</font>\n` +
    `> 客户电话：${inv.phone}\n` +
    `> 预计到店：**${(inv.arriveTime || '').replace('T', ' ')}**\n` +
    `> 到店门店：**${storeName}**\n` +
    `> 客服团队：${csName}\n` +
    `> 客户备注：${inv.remark || '-'}\n\n` +
    `请市场线老师做好接待准备，并在客户到店后**及时反馈**：\n\n` +
    `[ ✓  确认已到店 ](${baseUrl}/c/${inv.confirmTokens.arrived})\n\n　\n\n　\n\n` +
    `[ ✗  未到店反馈 ](${baseUrl}/c/${inv.confirmTokens.noshow})\n\n` +
    `——\n*点击链接即可一键反馈，无需登录系统。客户具体（操作金额/成交金额）请进系统继续填写。*`;

  const pr = await pushWecom(url, content);
  res.json({ ok: pr.errcode === 0, result: pr, tokens: inv.confirmTokens });
});

// ===== API：审计 / 数据迁移 =====
app.post('/api/list-deleted', v6HQRequired, (req, res) => {
  const out = {};
  for (const c of COLLECTIONS) {
    const rows = db.prepare(`SELECT data, deletedAt FROM shijing_${c} WHERE deleted = 1`).all();
    out[c] = rows.map(r => Object.assign(JSON.parse(r.data), { _deletedAt: r.deletedAt }));
  }
  res.json({ ok: true, deleted: out });
});

app.post('/api/restore', v6HQRequired, (req, res) => {
  const { collection: col, id } = req.body || {};
  if (!COLLECTIONS.includes(col) || !id) return res.json({ ok: false, error: 'bad params' });
  db.prepare(`UPDATE shijing_${col} SET deleted=0, deletedAt=NULL WHERE id=?`).run(id);
  res.json({ ok: true });
});

app.post('/api/import', v6HQRequired, (req, res) => {
  // 一键导入：用于把原浏览器 LocalStorage 数据迁过来
  const data = req.body || {};
  let total = 0, success = 0, skipped = 0;
  for (const c of COLLECTIONS) {
    if (!Array.isArray(data[c])) continue;
    for (const rec of data[c]) {
      total++;
      if (!rec || !rec.id) continue;
      try {
        const exists = db.prepare(`SELECT 1 FROM shijing_${c} WHERE id=?`).get(rec.id);
        if (exists) { skipped++; continue; }
        db.prepare(`INSERT INTO shijing_${c}(id, data) VALUES(?, ?)`).run(rec.id, JSON.stringify(rec));
        success++;
      } catch (e) { /* skip */ }
    }
  }
  res.json({ ok: true, total, success, skipped });
});

app.post('/api/diagnose', (req, res) => {
  const counts = {};
  for (const c of COLLECTIONS) {
    counts[c] = db.prepare(`SELECT COUNT(*) AS n FROM shijing_${c} WHERE deleted=0`).get().n;
  }
  counts.config = db.prepare("SELECT COUNT(*) AS n FROM shijing_config").get().n;
  res.json({ ok: true, counts, config: getConfig() });
});

// ========== 每日 9:00 数据简报（cron）==========
function calcDailyReport(date) {
  const data = {};
  for (const c of COLLECTIONS) {
    const rows = db.prepare(`SELECT data FROM shijing_${c} WHERE deleted=0`).all();
    data[c] = rows.map(r => JSON.parse(r.data));
  }
  // ★ 关键：ad 表里同一笔消耗有"天维度"+"城市维度"两份，只能取天维度（!cityName），否则消耗翻倍
  const ad = data.ad.filter(x => x.date === date && !x.cityName);
  const cs = data.cs.filter(x => x.date === date);
  const store = data.store.filter(x => x.date === date);
  const invite = data.invite.filter(x => (x.arriveTime || '').slice(0, 10) === date);

  const safeDiv = (a, b) => (!b ? 0 : a / b);
  const fmt = n => '¥' + (Math.round((n || 0) * 100) / 100).toLocaleString('zh-CN');
  const pct = n => (n || 0).toFixed(1) + '%';

  const adCost = ad.reduce((s, x) => s + (x.cost || 0), 0);
  const addFans = ad.reduce((s, x) => s + (x.addFans || 0), 0);
  const deepConvert = ad.reduce((s, x) => s + (x.deepConvert || 0), 0);
  const deepRate = safeDiv(deepConvert, addFans) * 100;
  const deepCost = safeDiv(adCost, deepConvert);
  const depositCount = cs.reduce((s, x) => s + (x.depositCount || 0), 0);
  const newC = store.filter(x => x.customerType === '新客');
  const oldC = store.filter(x => x.customerType === '老客');
  const newArrive = newC.length, oldArrive = oldC.length;
  const arriveCost = safeDiv(adCost, newArrive);
  const opCount = newC.filter(x => x.isOperated === '是').length;
  const closeCount = newC.filter(x => x.isClosed === '是').length;
  const newRev = newC.reduce((s, x) => s + (x.opAmount||0) + (x.closedAmount||0), 0);
  const oldRev = oldC.reduce((s, x) => s + (x.opAmount||0) + (x.closedAmount||0), 0);
  const revenue = newRev + oldRev;
  const roi = safeDiv(revenue, adCost);
  const arrived = invite.filter(x => x.status === 'arrived').length;
  const noShow = invite.filter(x => x.status === 'no_show').length;
  const pending = invite.filter(x => x.status === 'pending').length;

  return [adCost, addFans, deepConvert, deepRate, deepCost, depositCount, newC, oldC, newArrive, oldArrive, arriveCost, opCount, closeCount, newRev, oldRev, revenue, roi, arrived, noShow, pending, invite.length];
}

async function runDailyReport(date) {
  const [adCost, addFans, deepConvert, deepRate, deepCost, depositCount, newC, oldC, newArrive, oldArrive, arriveCost, opCount, closeCount, newRev, oldRev, revenue, roi, arrived, noShow, pending, totalInvite] = calcDailyReport(date);
  const cfg = getConfig();
  const hq = cfg && cfg.wecomConfig && cfg.wecomConfig.hqWebhook;
  if (!hq) { console.log('[daily-report] no hq webhook'); return; }
  const fmt = n => '¥' + (Math.round((n || 0) * 100) / 100).toLocaleString('zh-CN');
  const pct = n => (n || 0).toFixed(1) + '%';
  const safeDiv = (a, b) => (!b ? 0 : a / b);

  let content;
  if (adCost === 0 && depositCount === 0 && newArrive + oldArrive === 0 && totalInvite === 0) {
    content = '## 📊 仕净系统每日数据简报\n' +
      '> 数据日期：**' + date + '**\n' +
      '> <font color="warning">该日暂无业务数据录入</font>\n\n' +
      '请各团队负责人确认是否有数据漏录。';
  } else {
    content = '## 📊 仕净系统每日数据简报\n' +
      '> 数据日期：**' + date + '**\n' +
      '> 推送时间：' + new Date().toLocaleString('zh-CN') + '\n\n' +
      '### 💰 营销线\n' +
      '> 广告消耗：**' + fmt(adCost) + '** | 加粉：**' + addFans + '** 人 | 加粉成本：' + fmt(safeDiv(adCost, addFans)) + '\n' +
      '> 深转成交：**' + deepConvert + '** 人 | 深转率：**' + pct(deepRate) + '** | 深转成本：' + (deepConvert ? fmt(deepCost) : '-') + '\n\n' +
      '### 📞 客服销售线\n' +
      '> 定金数：**' + depositCount + '** 单 | 定金成本：' + fmt(safeDiv(adCost, depositCount)) + '\n\n' +
      '### 🏪 市场线\n' +
      '> 新客到店：**' + newArrive + '** 人 | 到店成本：' + fmt(arriveCost) + '\n' +
      '> 老客到店：**' + oldArrive + '** 人（不计入到店成本）\n' +
      '> 操作：' + opCount + ' (' + pct(safeDiv(opCount, newArrive)*100) + ') | 成单：' + closeCount + ' (' + pct(safeDiv(closeCount, newArrive)*100) + ')\n\n' +
      '### 📋 客户邀约\n' +
      '> 总邀约：' + totalInvite + ' | 已到店：<font color="info">' + arrived + '</font> | 未到店：<font color="warning">' + noShow + '</font> | 待确认：' + pending + '\n\n' +
      '### 🎯 营业额\n' +
      '> 新客营业额：**' + fmt(newRev) + '**\n' +
      '> 老客营业额：**' + fmt(oldRev) + '**\n' +
      '> 总营业额：<font color="info">**' + fmt(revenue) + '**</font>\n' +
      '> ROI：**' + roi.toFixed(2) + '**';
  }
  const r = await pushWecom(hq, content);
  console.log('[daily-report]', date, 'pushed:', JSON.stringify(r));
}

// ========== 自愈式简报推送（v2）==========
// 核心：先确保数据齐全（带补拉），再推送；推送失败自动重试
// 推送状态持久化到 config.dailyReportLog，避免重复推送或漏推
function fmtLocalDate(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// 检查指定日期 ad 表是否"数据齐全"：天维度 ≥ 1 条 即认为最低门槛
// （城市维度有时确实是 0，比如该天没投广告，所以不强制）
function isAdDataReady(date) {
  const rows = db.prepare("SELECT data FROM shijing_ad WHERE deleted=0").all().map(r => JSON.parse(r.data));
  const dayLevel = rows.filter(r => r.date === date && !r.cityName);
  // 至少 1 条天维度记录 + 至少有 1 条非零消耗
  const hasData = dayLevel.length >= 1 && dayLevel.some(r => (+r.cost || 0) > 0);
  return { ok: hasData, dayCount: dayLevel.length, totalCost: dayLevel.reduce((s, r) => s + (+r.cost || 0), 0) };
}

// 已推送状态记录（持久化到 config.dailyReportLog）
function getReportLog() {
  const cfg = getConfig() || {};
  return cfg.dailyReportLog || {};
}
function setReportLogged(date, info) {
  const cfg = getConfig() || {};
  cfg.dailyReportLog = cfg.dailyReportLog || {};
  cfg.dailyReportLog[date] = Object.assign({ pushedAt: Date.now() }, info || {});
  // 只保留最近 30 天
  const keys = Object.keys(cfg.dailyReportLog).sort();
  if (keys.length > 30) {
    keys.slice(0, keys.length - 30).forEach(k => delete cfg.dailyReportLog[k]);
  }
  setConfig(cfg);
}

// 自愈式简报推送：先确保数据齐全，再推；最多尝试 N 次
async function selfHealingDailyReport(date, attempt) {
  attempt = attempt || 1;
  const MAX_ATTEMPTS = 6;  // 最多尝试 6 次，间隔 10 分钟，覆盖 1 小时
  const log = getReportLog();
  if (log[date] && log[date].pushedAt) {
    console.log('[self-heal-report]', date, 'already pushed at', new Date(log[date].pushedAt).toISOString());
    return { ok: true, skipped: true };
  }
  console.log(`[self-heal-report] ${date} attempt ${attempt}/${MAX_ATTEMPTS}`);
  // 1) 确认数据齐全；不齐则触发同步
  let ready = isAdDataReady(date);
  if (!ready.ok) {
    console.log(`[self-heal-report] ${date} data not ready (day=${ready.dayCount}, cost=${ready.totalCost.toFixed(2)}), triggering sync...`);
    try {
      const r = await ocSync(date, date);
      console.log(`[self-heal-report] sync result:`, JSON.stringify(r).slice(0, 200));
    } catch (e) {
      console.warn(`[self-heal-report] sync failed:`, e.message);
    }
    ready = isAdDataReady(date);
  }
  // 2) 还是不齐？延迟重试
  if (!ready.ok) {
    if (attempt < MAX_ATTEMPTS) {
      console.log(`[self-heal-report] ${date} still not ready, will retry in 10min`);
      setTimeout(() => selfHealingDailyReport(date, attempt + 1), 10 * 60 * 1000);
      return { ok: false, willRetry: true, attempt };
    } else {
      // 最终降级：发"数据缺失警告"到总部群，让人工介入
      const cfg = getConfig() || {};
      const hq = (cfg.wecomConfig && cfg.wecomConfig.hqWebhook) || '';
      if (hq) {
        const warning = `## ⚠️ 数据简报推送失败\n\n日期：**${date}**\n原因：尝试 ${MAX_ATTEMPTS} 次（约 1 小时）后，巨量广告数据仍未拉取到。\n\n请手动登录系统查看：[crmai.quesiai.com](https://crmai.quesiai.com/login-v6)\n\n或联系技术排查 ocSync 状态。`;
        await pushWecom(hq, warning);
      }
      setReportLogged(date, { failed: true, reason: 'data_not_ready' });
      return { ok: false, failed: true };
    }
  }
  // 3) 数据齐全，正常推送
  try {
    await runDailyReport(date);
    setReportLogged(date, { dayCount: ready.dayCount, totalCost: ready.totalCost });
    console.log(`[self-heal-report] ${date} pushed OK`);
    return { ok: true, attempt };
  } catch (e) {
    console.warn(`[self-heal-report] push error:`, e.message);
    if (attempt < MAX_ATTEMPTS) {
      setTimeout(() => selfHealingDailyReport(date, attempt + 1), 10 * 60 * 1000);
    }
    return { ok: false, error: e.message };
  }
}

// 9:00 触发自愈推送（替代原直推）
cron.schedule('0 9 * * *', () => {
  const dateStr = fmtLocalDate(new Date(Date.now() - 86400000));
  console.log('[cron] self-healing daily-report for', dateStr);
  selfHealingDailyReport(dateStr, 1);
}, { timezone: 'Asia/Shanghai' });

// 启动自检：服务启动 30 秒后，检查昨日是否已推过；没推则尝试自愈推送
// 兜底应对"服务器在 9:00 前后重启 / 部署导致漏推"
setTimeout(() => {
  const yesterday = fmtLocalDate(new Date(Date.now() - 86400000));
  const log = getReportLog();
  const now = new Date();
  const hour = now.getHours();
  // 只在 9:00 ~ 23:59 之间触发自检（凌晨别打扰）
  if (hour >= 9 && hour <= 23) {
    if (!log[yesterday] || !log[yesterday].pushedAt) {
      console.log(`[startup-check] yesterday ${yesterday} report not pushed yet, triggering self-heal`);
      selfHealingDailyReport(yesterday, 1);
    } else {
      console.log(`[startup-check] yesterday ${yesterday} already pushed, skip`);
    }
  } else {
    console.log(`[startup-check] hour=${hour} not in window (9-23), skip`);
  }
}, 30 * 1000);

// 手动触发接口（运维补救用）
app.post('/api/daily-report-self-heal', async (req, res) => {
  const date = req.body && req.body.date ? req.body.date : fmtLocalDate(new Date(Date.now() - 86400000));
  const force = req.body && req.body.force;
  if (force) {
    const cfg = getConfig() || {};
    if (cfg.dailyReportLog && cfg.dailyReportLog[date]) {
      delete cfg.dailyReportLog[date];
      setConfig(cfg);
    }
  }
  const r = await selfHealingDailyReport(date, 1);
  res.json(r);
});

// ========== 每日 9:00 处理预约推送 ==========
// 客服提前录入的邀约（到店日期是今天，但创建于今天之前）→ 推送门店群
async function runScheduledArrivalPush() {
  const today = (() => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  })();
  const cfg = getConfig();
  const storeWebhooks = (cfg && cfg.wecomConfig && cfg.wecomConfig.storeWebhooks) || {};
  const teams = (cfg && cfg.teams) || {};

  // 找今天到店、状态 pending、未推送的邀约
  const rows = db.prepare(`SELECT id, data FROM shijing_invite WHERE deleted=0`).all();
  let pushed = 0;
  for (const r of rows) {
    const inv = JSON.parse(r.data);
    const arriveDate = (inv.arriveTime || '').slice(0, 10);
    if (arriveDate !== today) continue;
    if (inv.status !== 'pending') continue;
    // 判重（解耦 notified）：
    //  a) 本日已由 9点批量推过 → scheduledPushedDate === today
    //  b) 本日已由即时/改约推送推过 → notifiedAt 落在今天
    // 两者任一成立则跳过，既防止漏推也防止同日重复推。
    const _notifiedToday = inv.notifiedAt && (new Date(inv.notifiedAt).getFullYear() + '-' + String(new Date(inv.notifiedAt).getMonth()+1).padStart(2,'0') + '-' + String(new Date(inv.notifiedAt).getDate()).padStart(2,'0')) === today;
    if (inv.scheduledPushedDate === today || _notifiedToday) continue;

    const url = storeWebhooks[inv.storeTeamId];
    if (!url) { console.log('[scheduled-push] no webhook for', inv.storeTeamId); continue; }

    // 生成或复用 confirmTokens（一键反馈蓝链）
    if (!inv.confirmTokens) {
      inv.confirmTokens = { arrived: genToken(), noshow: genToken() };
    }

    const csName = (teams[inv.csTeamId] && teams[inv.csTeamId].name) || inv.csTeamName || inv.csTeamId;
    const storeName = (teams[inv.storeTeamId] && teams[inv.storeTeamId].name) || inv.storeTeamId;
    const baseUrl = 'https://crmai.quesiai.com';
    const days = Math.max(1, Math.round((Date.now() - inv.createdAt) / 86400000));
    const content = `## 📍 顾客即将到店通知\n` +
      `> 客户姓名：<font color="info">**${inv.customerName}**</font>\n` +
      `> 客户电话：${inv.phone}\n` +
      `> 预计到店：**${(inv.arriveTime || '').replace('T', ' ')}**\n` +
      `> 到店门店：**${storeName}**\n` +
      `> 客服团队：${csName}\n` +
      `> 客户备注：${inv.remark || '-'}\n\n` +
      `（此邀约由客服提前 ${days} 天前录入，今日 09:00 自动推送）\n\n` +
      `请市场线老师做好接待准备，并在客户到店后**及时反馈**：\n\n` +
      `[ ✓  确认已到店 ](${baseUrl}/c/${inv.confirmTokens.arrived})\n\n　\n\n　\n\n` +
      `[ ✗  未到店反馈 ](${baseUrl}/c/${inv.confirmTokens.noshow})\n\n` +
      `——\n*点击链接即可一键反馈，无需登录系统。*`;

    const pr = await pushWecom(url, content);
    const ok = pr.errcode === 0;
    // 独立标志：仅推送成功才记录当日已推；失败则不打标，下次 cron/自愈可重试。
    if (ok) { inv.scheduledPushedDate = today; inv.notified = true; }
    inv.scheduledPush = false;
    inv.scheduledPushedAt = Date.now();
    db.prepare(`UPDATE shijing_invite SET data=? WHERE id=?`).run(JSON.stringify(inv), inv.id);
    if (ok) pushed++;
    console.log('[scheduled-push]', inv.customerName, '→', inv.storeTeamId, ok ? 'OK' : 'FAIL');
  }
  console.log('[scheduled-push] done, pushed:', pushed);
  return pushed;
}

cron.schedule('0 9 * * *', () => {
  console.log('[cron] scheduled arrival push');
  runScheduledArrivalPush();
}, { timezone: 'Asia/Shanghai' });

// 手动触发接口（备用）
app.get('/api/v6/env', (req, res) => {
  res.json({ ok: true, pushEnabled: !V6_DEV_MODE, devMode: V6_DEV_MODE, db: DB_FILE, host: req.headers.host || '' });
});
app.post('/api/scheduled-push', async (req, res) => {
  const n = await runScheduledArrivalPush();
  res.json({ ok: true, pushed: n });
});

// ========== 门店反馈催促（2小时未反馈→推送对应门店群） ==========
// 触发条件：inv.status === 'pending' && 现在 - arriveTime > 2 小时 && !urgedAt
// 只发到对应 storeTeamId 的门店群（不打扰其他门店）
async function runStoreFeedbackUrge() {
  const cfg = getConfig();
  const storeWebhooks = (cfg && cfg.wecomConfig && cfg.wecomConfig.storeWebhooks) || {};
  const teams = (cfg && cfg.teams) || {};
  const URGE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 小时
  const now = Date.now();

  const rows = db.prepare(`SELECT id, data FROM shijing_invite WHERE deleted=0`).all();
  let urged = 0;
  for (const r of rows) {
    const inv = JSON.parse(r.data);
    if (inv.status !== 'pending') continue;          // 只催未反馈的
    if (inv.urgedAt) continue;                        // 已催促过，不重复打扰
    if (!inv.arriveTime) continue;
    // 解析到店时间（格式 'YYYY-MM-DDTHH:MM' 本地时间）
    const arriveMs = new Date(inv.arriveTime).getTime();
    if (isNaN(arriveMs)) continue;
    if (now - arriveMs < URGE_THRESHOLD_MS) continue; // 未到 2 小时不催

    // 必须已被通知过门店（否则门店都不知道有这个客户，催促无意义）
    if (inv.notified !== true) continue;

    const url = storeWebhooks[inv.storeTeamId];
    if (!url) {
      console.log('[urge] no webhook for', inv.storeTeamId);
      continue;
    }

    const csName = (teams[inv.csTeamId] && teams[inv.csTeamId].name) || inv.csTeamName || inv.csTeamId;
    const storeName = (teams[inv.storeTeamId] && teams[inv.storeTeamId].name) || inv.storeTeamId;
    const arriveTimeStr = (inv.arriveTime || '').replace('T', ' ');
    const overdueHrs = ((now - arriveMs) / 3600000).toFixed(1);

    const content = `## ⏰ 顾客反馈催促\n` +
      `> <font color="warning">距客户预计到店时间已超过 ${overdueHrs} 小时，仍未收到反馈</font>\n` +
      `> 请 **${storeName}** 老师尽快确认客户是否到店。\n\n` +
      `> 客户姓名：**${inv.customerName}**\n` +
      `> 客户电话：${inv.phone}\n` +
      `> 预计到店：${arriveTimeStr}\n` +
      `> 客服团队：${csName}\n` +
      `> 备注：${inv.remark || '-'}\n\n` +
      `请在系统的「门店反馈」页面填写：到店 / 未到店。\n` +
      `（此为自动催促，单次提醒；填写后不再打扰）`;

    const pr = await pushWecom(url, content);
    const ok = pr.errcode === 0;
    inv.urgedAt = now;
    inv.urgedOk = ok;
    db.prepare(`UPDATE shijing_invite SET data=? WHERE id=?`).run(JSON.stringify(inv), inv.id);
    if (ok) urged++;
    console.log('[urge]', inv.customerName, '→', inv.storeTeamId, ok ? 'OK' : 'FAIL');
  }
  console.log('[urge] done, urged:', urged);
  return urged;
}

// 每 15 分钟扫描一次（确保 2h 阈值内能及时催促）
cron.schedule('*/15 * * * *', () => {
  runStoreFeedbackUrge();
}, { timezone: 'Asia/Shanghai' });

// 手动触发接口（测试/补救用）
app.post('/api/urge-store', async (req, res) => {
  const n = await runStoreFeedbackUrge();
  res.json({ ok: true, urged: n });
});

// 手动触发接口（备用）
app.post('/api/daily-report', async (req, res) => {
  const { date } = req.body || {};
  const d = date || (() => {
    const x = new Date(Date.now() - 86400000);
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  })();
  await runDailyReport(d);
  res.json({ ok: true, date: d });
});

// =========================================================================
// 一键到店反馈（蓝链方案）
// =========================================================================

// 工具：脱敏手机号（138****8000）
function maskPhone(p) {
  if (!p || p.length < 7) return p || '';
  return p.slice(0, 3) + '****' + p.slice(-4);
}
// 工具：生成 8 位 token
function genToken() {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

// 通用：渲染极简反馈页（成功/表单/错误统一用这个壳）
function renderFeedbackPage({ title, body, color }) {
  const klein = '#002FA7', kleinBright = '#1f4cd9', kleinSoft = '#e8eef9';
  const ink = '#0a1628', mute = '#7a869f', line = '#e2e8f0';
  return `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>${title} · 仕净</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:"PingFang SC","Inter",-apple-system,sans-serif;background:#f8fafd;color:${ink};
    -webkit-font-smoothing:antialiased;line-height:1.6;letter-spacing:.01em;
    background-image:radial-gradient(ellipse 700px 500px at 30% 20%,rgba(0,47,167,.06) 0%,transparent 60%);
    min-height:100vh;padding:32px 16px}
  .shell{max-width:480px;margin:0 auto;background:#fff;border:1px solid ${line};border-radius:4px;padding:40px 28px;
    box-shadow:0 16px 48px -24px rgba(0,47,167,.15);position:relative;overflow:hidden}
  .shell::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;
    background:linear-gradient(90deg,${klein},${kleinBright})}
  .top-logo{width:48px;height:48px;border-radius:50%;padding:3px;
    background:linear-gradient(135deg,${klein},${kleinBright});box-shadow:0 0 16px rgba(0,47,167,.2);
    margin:0 auto 8px;display:block}
  .brand{font-size:11px;letter-spacing:.4em;color:${ink};font-weight:700;margin-bottom:32px;text-align:center}
  .icon-circle{width:72px;height:72px;border-radius:50%;display:flex;align-items:center;justify-content:center;
    margin:0 auto 16px;font-family:"Space Grotesk",sans-serif;font-weight:700;font-size:36px;
    background:${color === 'success' ? '#e7f7ee' : color === 'warn' ? '#fff7e6' : color === 'klein' ? kleinSoft : '#fff1f0'};
    color:${color === 'success' ? '#0a7a5c' : color === 'warn' ? '#b8651b' : color === 'klein' ? klein : '#a8221c'};
    box-shadow:0 0 32px ${color === 'success' ? 'rgba(10,122,92,.18)' : color === 'warn' ? 'rgba(184,101,27,.18)' : color === 'klein' ? 'rgba(0,47,167,.15)' : 'rgba(168,34,28,.18)'}}
  h2{font-size:22px;font-weight:600;text-align:center;margin-bottom:8px;letter-spacing:.04em}
  .deck{color:${mute};font-size:14px;text-align:center;margin-bottom:20px}
  .info{background:#f8fafd;border:1px solid ${line};border-radius:4px;padding:14px 16px;margin-bottom:20px}
  .info .row{display:flex;justify-content:space-between;padding:5px 0;font-size:13px;color:#3d4a5f;border-bottom:1px dotted #eef2f8}
  .info .row:last-child{border-bottom:none}
  .info .row .k{color:${mute};letter-spacing:.05em}
  .info .row .v{color:${ink};font-weight:500}
  .tip{background:${kleinSoft};border-left:3px solid ${klein};padding:12px 14px;border-radius:2px;font-size:13px;color:#3d4a5f;line-height:1.7}
  .tip b{color:${klein}}
  .label{font-size:12px;color:${mute};margin-bottom:10px;letter-spacing:.1em;font-weight:500;display:block}
  .label .req{color:#a8221c;margin-left:4px}
  .field{margin-bottom:18px}
  .pill-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .pill-grid.col4{grid-template-columns:1fr 1fr}
  .pill{padding:12px;border:1px solid ${line};border-radius:4px;text-align:center;cursor:pointer;
    transition:all .22s;font-size:13px;color:${mute};background:#fff;user-select:none}
  .pill.active{border-color:${klein};background:${kleinSoft};color:${klein};font-weight:600}
  input[type=text],textarea,select{width:100%;padding:12px 14px;border:1px solid ${line};border-radius:4px;
    font-size:14px;outline:none;background:#f8fafd;color:${ink};font-family:inherit;transition:all .22s}
  input:focus,textarea:focus{border-color:${klein};box-shadow:0 0 0 3px rgba(0,47,167,.1);background:#fff}
  textarea{resize:vertical;min-height:80px}
  .btn{width:100%;padding:16px;border:1px solid ${kleinBright};border-radius:4px;
    background:linear-gradient(135deg,${klein},${kleinBright});color:#fff;font-size:14px;font-weight:600;
    letter-spacing:.2em;box-shadow:0 6px 16px rgba(0,47,167,.18);cursor:pointer;font-family:inherit;transition:all .22s}
  .btn:hover{transform:translateY(-1px);box-shadow:0 10px 24px rgba(0,47,167,.22)}
  .btn:disabled{opacity:.6;cursor:not-allowed}
  .btn-secondary{width:100%;padding:12px;border:1px solid ${line};border-radius:4px;background:#fff;
    color:${mute};font-size:13px;cursor:pointer;margin-top:10px;font-family:inherit;text-align:center;text-decoration:none;display:block}
</style></head><body>
<div class="shell">
  <img src="/logo.jpg" alt="" class="top-logo"/>
  <div class="brand">仕 净 · S H I J I N G</div>
  ${body}
</div>
</body></html>`;
}

// === GET /c/:token === 一键反馈短链
app.get('/c/:token', (req, res) => {
  const token = String(req.params.token || '');
  if (!token || token.length < 4) {
    return res.status(404).send(renderFeedbackPage({
      title: '链接无效', color: 'warn',
      body: `<div class="icon-circle" style="background:#fff1f0;color:#a8221c">!</div>
        <h2>链接无效或已过期</h2>
        <div class="deck">请进入仕净系统进行反馈</div>`
    }));
  }
  // 查找 token 对应的 invite 记录
  const rows = db.prepare(`SELECT id, data FROM shijing_invite WHERE deleted=0`).all();
  let target = null, action = null;
  for (const r of rows) {
    const inv = JSON.parse(r.data);
    if (!inv.confirmTokens) continue;
    if (inv.confirmTokens.arrived === token) { target = inv; action = 'arrived'; break; }
    if (inv.confirmTokens.noshow === token) { target = inv; action = 'noshow'; break; }
  }
  if (!target) {
    return res.status(404).send(renderFeedbackPage({
      title: '链接无效', color: 'warn',
      body: `<div class="icon-circle" style="background:#fff1f0;color:#a8221c">!</div>
        <h2>链接无效</h2>
        <div class="deck">该链接不存在或已过期，请进系统反馈</div>`
    }));
  }

  const cfg = getConfig();
  const teams = (cfg && cfg.teams) || {};
  const storeName = (teams[target.storeTeamId] && teams[target.storeTeamId].name) || target.storeTeamId;
  const csName = (teams[target.csTeamId] && teams[target.csTeamId].name) || target.csTeamName || '客服';

  // 已反馈过的状态：直接显示当前状态
  if (target.status !== 'pending') {
    const statusLabel = target.status === 'arrived' ? '已到店 ✓' :
                        target.status === 'no_show' ? '未到店' :
                        target.status === 'cancelled' ? '已取消' : target.status;
    const time = target.feedbackAt ? new Date(target.feedbackAt).toLocaleString('zh-CN') : '';
    return res.send(renderFeedbackPage({
      title: '已反馈过', color: 'klein',
      body: `<div class="icon-circle" style="background:#e8eef9;color:#002FA7">✓</div>
        <h2>该客户已反馈</h2>
        <div class="deck">无需重复操作</div>
        <div class="info">
          <div class="row"><span class="k">客户</span><span class="v">${target.customerName}</span></div>
          <div class="row"><span class="k">门店</span><span class="v">${storeName}</span></div>
          <div class="row"><span class="k">当前状态</span><span class="v">${statusLabel}</span></div>
          ${time ? `<div class="row"><span class="k">反馈时间</span><span class="v">${time}</span></div>` : ''}
        </div>
        <div class="tip">如需修改请进入仕净系统操作</div>`
    }));
  }

  // === 到店：直接确认 + 显示成功页 ===
  if (action === 'arrived') {
    target.status = 'arrived';
    target.feedbackAt = Date.now();
    target.feedbackSource = 'magic-link';
    db.prepare(`UPDATE shijing_invite SET data=? WHERE id=?`).run(JSON.stringify(target), target.id);

    // ★ 自动在 store 表创建占位服务记录，让门店能在系统里看到、补金额
    try {
      const today = new Date();
      const fmtD = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');
      const storeId = 'magic_' + target.id;
      const existed = db.prepare('SELECT 1 FROM shijing_store WHERE id=?').get(storeId);
      if (!existed) {
        const storeRec = {
          id: storeId,
          teamId: target.storeTeamId,
          date: fmtD,
          customerName: target.customerName,
          customerPhone: target.phone,
          customerType: '新客',
          source: '客服邀约',
          walkIn: false,
          inviteId: target.id,
          csTeamId: target.csTeamId || '',
          isOperated: '',
          opAmount: 0,
          isClosed: '',
          closedAmount: 0,
          performer: '',
          remark: '【系统自动创建占位记录】客户已通过企微链接确认到店，待门店补充客户类型/操作/成交金额',
          arrivedAt: target.feedbackAt,
          createdAt: Date.now(),
          autoCreated: true,
          pendingDetail: true,
        };
        db.prepare('INSERT INTO shijing_store(id, data, deleted) VALUES(?, ?, 0)').run(storeId, JSON.stringify(storeRec));
        console.log('[magic-link] auto-created store record for', target.customerName, '@', target.storeTeamId);
      }
    } catch (e) { console.warn('[magic-link auto-store-record]', e.message); }

    // 推送客服群通知（只反馈到店事实，不带任何金额信息）
    // 规则：必须是客服邀约（有 csTeamId 且对应的 csWebhook 已配置）才推送；
    //      非客服邀约（如门店登记的散客 walkIn / 总部 hq_history 历史）一律不推送客服群
    const csWebhooksA = (cfg && cfg.wecomConfig && cfg.wecomConfig.csWebhooks) || {};
    const webhookA = target.csTeamId && csWebhooksA[target.csTeamId];
    if (webhookA) {
      const contentA = `## ✅ 顾客到店反馈\n` +
        `> 客户：<font color="info">**${target.customerName}**</font> · ${maskPhone(target.phone)}\n` +
        `> 原约时间：**${(target.arriveTime || '').replace('T', ' ')}** · ${storeName}\n` +
        `\n**门店反馈：客户已到店 ✓**\n` +
        `\n*反馈门店：${storeName} · 反馈时间：${new Date().toLocaleString('zh-CN')}*`;
      pushWecom(webhookA, contentA).catch(e => console.warn('[arrived-notify]', e));
    }

    return res.send(renderFeedbackPage({
      title: '已确认到店', color: 'success',
      body: `<div class="icon-circle success">✓</div>
        <h2>已确认到店</h2>
        <div class="deck">客服与系统已同步</div>
        <div class="info">
          <div class="row"><span class="k">客户</span><span class="v">${target.customerName}</span></div>
          <div class="row"><span class="k">手机</span><span class="v">${maskPhone(target.phone)}</span></div>
          <div class="row"><span class="k">到店时间</span><span class="v">${(target.arriveTime || '').replace('T', ' ')}</span></div>
          <div class="row"><span class="k">门店</span><span class="v">${storeName}</span></div>
          <div class="row"><span class="k">反馈时间</span><span class="v">${new Date().toLocaleString('zh-CN')}</span></div>
        </div>
        <div class="tip"><b>下一步</b>：请在仕净系统补充客户类型、操作金额、成交金额。<br/>系统会在 24 小时后提醒未补全的客户。</div>`
    }));
  }

  // === 未到店：渲染表单 ===
  if (action === 'noshow') {
    const html = `<div class="icon-circle" style="background:#fff7e6;color:#b8651b">!</div>
      <h2>未到店反馈</h2>
      <div class="deck">填写后客服会自动收到通知</div>
      <div class="info">
        <div class="row"><span class="k">客户</span><span class="v">${target.customerName} · ${maskPhone(target.phone)}</span></div>
        <div class="row"><span class="k">原约时间</span><span class="v">${(target.arriveTime || '').replace('T', ' ')}</span></div>
        <div class="row"><span class="k">门店</span><span class="v">${storeName}</span></div>
      </div>
      <form id="f" onsubmit="return submitForm(event)">
        <div class="field">
          <label class="label">是否已联系客户<span class="req">*</span></label>
          <div class="pill-grid">
            <div class="pill" data-name="contacted" data-val="yes">📞 已联系</div>
            <div class="pill" data-name="contacted" data-val="no">⌛ 未联系</div>
          </div>
        </div>
        <div class="field">
          <label class="label">联系结果<span class="req">*</span></label>
          <div class="pill-grid col4">
            <div class="pill" data-name="result" data-val="answered">已接通</div>
            <div class="pill" data-name="result" data-val="unanswered">未接通</div>
            <div class="pill" data-name="result" data-val="rescheduled">已改约</div>
            <div class="pill" data-name="result" data-val="declined">明确不来</div>
          </div>
        </div>
        <div class="field">
          <label class="label">改约时间（如已改约）</label>
          <input type="text" id="reschedule" placeholder="如：明天下午 3:00"/>
        </div>
        <div class="field">
          <label class="label">补充说明</label>
          <textarea id="note" placeholder="客户原因、备注等"></textarea>
        </div>
        <button class="btn" type="submit">提 交 反 馈</button>
        <a href="/c/${target.confirmTokens.arrived}" class="btn-secondary">客户实际到店了？切换为「确认到店」</a>
      </form>
      <script>
        var st = { contacted:'', result:'' };
        document.querySelectorAll('.pill').forEach(function(p){
          p.onclick = function(){
            var name = p.dataset.name;
            document.querySelectorAll('[data-name="'+name+'"]').forEach(function(x){ x.classList.remove('active') });
            p.classList.add('active');
            st[name] = p.dataset.val;
          };
        });
        function submitForm(e){
          e.preventDefault();
          if(!st.contacted){ alert('请选择是否联系客户'); return false; }
          if(!st.result){ alert('请选择联系结果'); return false; }
          var btn = document.querySelector('.btn');
          btn.disabled = true; btn.textContent = '提交中...';
          fetch('/api/no-show-feedback', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({
              token: ${JSON.stringify(token)},
              contacted: st.contacted,
              result: st.result,
              rescheduleTime: document.getElementById('reschedule').value.trim(),
              note: document.getElementById('note').value.trim()
            })
          }).then(function(r){ return r.json() }).then(function(j){
            if(j.ok){ window.location.reload(); }
            else { alert('提交失败：' + (j.error || '请重试')); btn.disabled = false; btn.textContent = '提 交 反 馈'; }
          }).catch(function(err){ alert('网络错误'); btn.disabled = false; btn.textContent = '提 交 反 馈'; });
          return false;
        }
      <\/script>`;
    return res.send(renderFeedbackPage({ title: '未到店反馈', color: 'warn', body: html }));
  }
});

// === POST /api/no-show-feedback === 提交未到店反馈
app.post('/api/no-show-feedback', async (req, res) => {
  const { token, contacted, result, rescheduleTime, note } = req.body || {};
  if (!token || !contacted || !result) return res.json({ ok: false, error: '参数不完整' });

  const rows = db.prepare(`SELECT id, data FROM shijing_invite WHERE deleted=0`).all();
  let target = null;
  for (const r of rows) {
    const inv = JSON.parse(r.data);
    if (inv.confirmTokens && inv.confirmTokens.noshow === token) { target = inv; break; }
  }
  if (!target) return res.json({ ok: false, error: '链接无效' });
  if (target.status !== 'pending') return res.json({ ok: false, error: '已反馈过，无需重复' });

  // 更新状态 + 详情
  target.status = 'no_show';
  target.feedbackAt = Date.now();
  target.feedbackSource = 'magic-link';
  target.noShowFeedback = {
    contacted, result, rescheduleTime: rescheduleTime || '', note: note || '',
    submittedAt: Date.now()
  };
  db.prepare(`UPDATE shijing_invite SET data=? WHERE id=?`).run(JSON.stringify(target), target.id);

  // 推送客服群
  // 规则：必须是客服邀约（有 csTeamId 且对应 csWebhook 已配置）才推送；非客服邀约不推
  const cfg = getConfig();
  const teams = (cfg && cfg.teams) || {};
  const csName = (teams[target.csTeamId] && teams[target.csTeamId].name) || target.csTeamName || '客服线';
  const storeName = (teams[target.storeTeamId] && teams[target.storeTeamId].name) || target.storeTeamId;
  const csWebhooks = (cfg && cfg.wecomConfig && cfg.wecomConfig.csWebhooks) || {};
  const webhook = target.csTeamId && csWebhooks[target.csTeamId];

  const contactedLabel = contacted === 'yes' ? '已联系' : '未联系';
  const resultLabel = ({ answered: '已接通', unanswered: '未接通', rescheduled: '已改约', declined: '明确不来' })[result] || result;
  const content = `## ⏰ 顾客未到店反馈\n` +
    `> 客户：<font color="warning">**${target.customerName}**</font> · ${maskPhone(target.phone)}\n` +
    `> 原约：**${(target.arriveTime || '').replace('T', ' ')}** · ${storeName}\n` +
    `> 客服团队：${csName}\n` +
    `\n**门店反馈：${contactedLabel} / ${resultLabel}**\n` +
    (rescheduleTime ? `> 改约时间：<font color="info">**${rescheduleTime}**</font>\n` : '') +
    (note ? `> 补充：${note}\n` : '') +
    `\n*反馈门店：${storeName} · 反馈时间：${new Date().toLocaleString('zh-CN')}*`;

  if (webhook) {
    const pr = await pushWecom(webhook, content);
    target.noShowFeedback.notifyOk = pr.errcode === 0;
    db.prepare(`UPDATE shijing_invite SET data=? WHERE id=?`).run(JSON.stringify(target), target.id);
  }

  res.json({ ok: true });
});

// =========================================================================
// 巨量引擎 OAuth 回调
// 流程：用户在巨量同意授权 → 巨量重定向带 auth_code 到此 → 我们用 auth_code + app_secret
//      调巨量 token 接口换 access_token → 存入数据库（prod + dev 同时写，授权一次两边都能用）
// =========================================================================
function ocengineGetAccessToken(authCode) {
  return new Promise((resolve) => {
    const cfg = getConfig();
    const oc = (cfg && cfg.oceanengine) || {};
    if (!oc.appId || !oc.appSecret) return resolve({ ok: false, error: 'app_id / app_secret not configured in db' });
    const body = JSON.stringify({ app_id: Number(oc.appId), secret: oc.appSecret, grant_type: 'auth_code', auth_code: authCode });
    const req = https.request({
      hostname: 'ad.oceanengine.com', path: '/open_api/oauth2/access_token/', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res2 => {
      let buf = ''; res2.on('data', c => buf += c);
      res2.on('end', () => { try { resolve({ ok: true, raw: JSON.parse(buf) }); } catch (e) { resolve({ ok: false, error: 'parse failed', raw: buf }); } });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.write(body); req.end();
  });
}

// 把授权结果写入 prod 数据库 + dev 数据库（如果 dev 数据库存在）
function ocengineSaveAuth(authData) {
  // authData = { access_token, refresh_token, expires_in, advertiser_ids: [...], ... }
  const updateOne = (dbInstance) => {
    const row = dbInstance.prepare("SELECT data FROM shijing_config WHERE id='main'").get();
    if (!row) return false;
    const cfg = JSON.parse(row.data);
    cfg.oceanengine = cfg.oceanengine || {};
    cfg.oceanengine.advertisers = cfg.oceanengine.advertisers || [];
    const nowMs = Date.now();
    const expireAt = nowMs + (Number(authData.expires_in) || 86400) * 1000;
    const refreshExpireAt = nowMs + (Number(authData.refresh_token_expires_in) || 30 * 86400) * 1000;
    const advIds = authData.advertiser_ids || authData.advertiser_id || [];
    const ids = Array.isArray(advIds) ? advIds : [advIds];
    for (const advId of ids) {
      const idx = cfg.oceanengine.advertisers.findIndex(a => String(a.advertiserId) === String(advId));
      const rec = {
        advertiserId: String(advId),
        accessToken: authData.access_token,
        refreshToken: authData.refresh_token,
        expireAt, refreshExpireAt,
        authorizedAt: nowMs,
      };
      if (idx >= 0) cfg.oceanengine.advertisers[idx] = { ...cfg.oceanengine.advertisers[idx], ...rec };
      else cfg.oceanengine.advertisers.push(rec);
    }
    dbInstance.prepare("INSERT INTO shijing_config(id,data,updatedAt) VALUES('main',?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, updatedAt=excluded.updatedAt")
      .run(JSON.stringify(cfg), Date.now());
    return ids.length;
  };
  // prod (本进程当前的 db)
  let prodCount = 0; try { prodCount = updateOne(db); } catch (e) { console.warn('[oc-save] prod', e.message); }
  // dev (尝试打开 /opt/shijing-dev/db/shijing.db)
  let devCount = 0;
  try {
    const Database = require('better-sqlite3');
    const devPath = '/opt/shijing-dev/db/shijing.db';
    const fs2 = require('fs');
    if (fs2.existsSync(devPath)) {
      const devDb = new Database(devPath);
      devCount = updateOne(devDb);
      devDb.close();
    }
  } catch (e) { console.warn('[oc-save] dev', e.message); }
  return { prodCount, devCount };
}

app.get('/api/oceanengine/auth-callback', async (req, res) => {
  const { auth_code, state } = req.query || {};
  console.log('[oceanengine-callback] received', { auth_code, state, time: new Date().toISOString() });

  try {
    const fs = require('fs');
    const logPath = path.join(ROOT, 'oceanengine-callback.log');
    fs.appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), auth_code: auth_code || null, state: state || null }) + '\n');
  } catch (e) { console.warn('[oc-cb] log error', e.message); }

  res.set('Content-Type', 'text/html; charset=utf-8');

  // 没 auth_code → 提示
  if (!auth_code) {
    return res.send(ocengineRenderPage('warn', '未收到授权码', '请从巨量授权页正常跳转过来。如已点击"同意授权"但仍看到此页，请联系管理员检查应用配置。'));
  }

  // 换 token
  const tk = await ocengineGetAccessToken(auth_code);
  if (!tk.ok || !tk.raw || tk.raw.code !== 0 || !tk.raw.data || !tk.raw.data.access_token) {
    const errMsg = (tk.raw && tk.raw.message) || tk.error || '未知错误';
    console.warn('[oc-cb] exchange failed', tk);
    return res.send(ocengineRenderPage('error', '授权失败', `从巨量交换 access_token 失败：${errMsg}<br><br>请把这个错误截图发给管理员。<div class="code">${JSON.stringify(tk.raw||tk).replace(/[<>]/g,'')}</div>`));
  }

  const data = tk.raw.data;
  const saved = ocengineSaveAuth(data);
  console.log('[oc-cb] auth saved', { advertisers: data.advertiser_ids || data.advertiser_id, prodCount: saved.prodCount, devCount: saved.devCount });

  const advIds = data.advertiser_ids || data.advertiser_id || [];
  const advList = (Array.isArray(advIds) ? advIds : [advIds]).map(x => `<div class="code">advertiser_id: ${x}</div>`).join('');

  res.send(ocengineRenderPage('success', '授权成功',
    `已成功授权 ${saved.prodCount} 个广告主账号到生产环境${saved.devCount ? `、${saved.devCount} 个到开发环境` : ''}。<br><br>${advList}<br>access_token 有效期 24h，系统将自动用 refresh_token 续期。`
  ));
});

// 同一路径的 POST（少数情况巨量会用 POST）
app.post('/api/oceanengine/auth-callback', (req, res) => {
  console.log('[oc-cb POST]', req.body, req.query);
  res.json({ ok: true, msg: 'received' });
});

// 渲染统一的回调结果页
function ocengineRenderPage(level, title, body) {
  const klein = '#002FA7', kleinBright = '#1f4cd9';
  const colors = {
    success: { bg: '#e7f7ee', fg: '#0a7a5c', icon: '✓' },
    warn: { bg: '#fff7e6', fg: '#b8651b', icon: '!' },
    error: { bg: '#fff1f0', fg: '#a8221c', icon: '✕' },
  }[level] || { bg: '#e8eef9', fg: klein, icon: 'i' };
  return `<!DOCTYPE html><html lang="zh-CN"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · 仕净</title>
<style>
  body{font-family:"PingFang SC",-apple-system,sans-serif;background:#f8fafd;color:#0a1628;
    min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
  .box{background:#fff;border:1px solid #e2e8f0;border-radius:4px;padding:40px 28px;max-width:480px;text-align:center;
    box-shadow:0 16px 48px -24px rgba(0,47,167,.15);position:relative;overflow:hidden}
  .box::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,${klein},${kleinBright})}
  .icon{width:64px;height:64px;border-radius:50%;background:${colors.bg};color:${colors.fg};
    display:flex;align-items:center;justify-content:center;font-size:32px;margin:0 auto 16px;font-weight:700}
  h2{font-size:18px;letter-spacing:.05em;margin-bottom:8px;color:#0a1628}
  .deck{color:#3d4a5f;font-size:13px;line-height:1.7;margin-bottom:18px;text-align:left}
  .code{background:#f4f6fb;padding:8px 12px;border-radius:2px;font-family:JetBrains Mono,monospace;
    font-size:11px;color:#3d4a5f;word-break:break-all;margin-bottom:8px;text-align:left}
  .ver{color:${klein};font-size:11px;letter-spacing:.2em;font-family:JetBrains Mono,monospace;margin-top:20px}
</style></head><body>
<div class="box">
  <div class="icon">${colors.icon}</div>
  <h2>${title}</h2>
  <div class="deck">${body}</div>
  <div class="ver">仕 净 · S H I J I N G</div>
</div></body></html>`;
}

// =========================================================================
// 巨量授权链接生成 + 状态查询（供前端配置页用）
// =========================================================================
app.get('/api/oceanengine/status', (req, res) => {
  const cfg = getConfig();
  const oc = (cfg && cfg.oceanengine) || {};
  const advs = (oc.advertisers || []).map(a => ({
    advertiserId: a.advertiserId,
    authorizedAt: a.authorizedAt,
    expireAt: a.expireAt,
    expired: a.expireAt && Date.now() > a.expireAt,
  }));
  res.json({
    ok: true,
    configured: !!(oc.appId && oc.appSecret),
    appId: oc.appId || '',
    callbackUrl: oc.callbackUrl || '',
    advertiserCount: advs.length,
    advertisers: advs,
  });
});

app.get('/api/oceanengine/auth-url', (req, res) => {
  const cfg = getConfig();
  const oc = (cfg && cfg.oceanengine) || {};
  if (!oc.appId) return res.json({ ok: false, error: 'app_id not configured' });
  const cbUrl = oc.callbackUrl || 'http://ai.msfmeirong.cn/api/oceanengine/auth-callback';
  const state = req.query.state || ('s' + Date.now());
  // 正确域名是 ad.oceanengine.com/openapi/audit/oauth.html
  const url = `https://ad.oceanengine.com/openapi/audit/oauth.html?app_id=${oc.appId}&state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(cbUrl)}`;
  res.json({ ok: true, url, state });
});

// =========================================================================
// 巨量引擎数据同步模块（dev 环境）
// 字段映射（业务口径已对齐）：
//   stat_cost                                = 消耗
//   show_cnt                                 = 曝光
//   click_cnt                                = 点击
//   cpc_platform                             = 点击均价
//   ctr                                      = 点击率
//   convert_cnt                              = 转化数（巨量自定义事件，含表单/落地页等，不是加粉）
//   deep_convert_cnt                         = 深度转化数（巨量自定义，不是高潜）
//   ★ attribution_work_wechat_added_count    = 企业微信添加好友数 = 业务口径"加粉数"
//   ★ attribution_clue_high_intention        = 线索-回访高潜成交  = 业务口径"高潜成交数"
//   attribution_clue_high_intention_cost     = 高潜成交成本
//   attribution_work_wechat_unfriend_count   = 企业微信取消好友数
//   维度: stat_time_day / city_name
// =========================================================================

const OC_API_HOST = 'api.oceanengine.com';
const OC_AUTH_HOST = 'ad.oceanengine.com';
// 拉取的指标。把 attribution 系列加进去。
// 注意：这些 attribution_xxx 字段属于"归因数据"，需要广告主配置了对应的转化事件才会有数据。
const OC_METRICS = [
  'stat_cost', 'show_cnt', 'click_cnt', 'cpc_platform', 'ctr',
  'convert_cnt', 'conversion_cost', 'conversion_rate',
  'deep_convert_cnt', 'deep_convert_cost',
  'attribution_work_wechat_added_count',     // 企业微信加好友 = 真加粉
  'attribution_clue_high_intention',         // 回访高潜成交 = 真高潜
  'attribution_clue_high_intention_cost',    // 高潜成本
  'attribution_work_wechat_unfriend_count',  // 加好友取消（备用）
];

function ocHttpsRequest(opts, body) {
  return new Promise(resolve => {
    const req = https.request(opts, res2 => {
      let buf = ''; res2.on('data', c => buf += c);
      res2.on('end', () => { try { resolve(JSON.parse(buf)); } catch(e) { resolve({ ok: false, raw: buf }); } });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    if (body) req.write(body);
    req.end();
  });
}

// 刷新 access_token（24h 过期前调用）—— 带 per-advertiser 并发锁，防止 refresh_token 被并发销毁
const _ocRefreshLocks = new Map();
async function ocRefreshToken(advertiser) {
  const advId = String(advertiser.advertiserId);
  if (_ocRefreshLocks.has(advId)) return _ocRefreshLocks.get(advId);
  const p = (async () => {
  const cfg = getConfig();
  const oc = (cfg && cfg.oceanengine) || {};
  // refresh 前重读 DB 拿最新 refreshToken（避免用到内存里的旧值）
  try {
    const freshRow = db.prepare("SELECT data FROM shijing_config WHERE id='main'").get();
    if (freshRow) {
      const fc = JSON.parse(freshRow.data);
      const fa = ((fc.oceanengine || {}).advertisers || []).find(a => String(a.advertiserId) === advId);
      if (fa && fa.refreshToken) advertiser.refreshToken = fa.refreshToken;
    }
  } catch (e) {}
  if (!advertiser.refreshToken) return { ok: false, error: 'no refresh_token' };
  const body = JSON.stringify({
    app_id: Number(oc.appId),
    secret: oc.appSecret,
    grant_type: 'refresh_token',
    refresh_token: advertiser.refreshToken
  });
  const r = await ocHttpsRequest({
    hostname: OC_AUTH_HOST, path: '/open_api/oauth2/refresh_token/', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  if (!r || r.code !== 0 || !r.data) return { ok: false, error: (r && r.message) || 'refresh failed' };
  advertiser.accessToken = r.data.access_token;
  advertiser.refreshToken = r.data.refresh_token || advertiser.refreshToken;
  advertiser.expireAt = Date.now() + (Number(r.data.expires_in) || 86400) * 1000;
  advertiser.refreshExpireAt = Date.now() + (Number(r.data.refresh_token_expires_in) || 30 * 86400) * 1000;
  // 写回 config
  const row = db.prepare("SELECT data FROM shijing_config WHERE id='main'").get();
  const c = JSON.parse(row.data);
  c.oceanengine.advertisers = c.oceanengine.advertisers.map(a => String(a.advertiserId) === String(advertiser.advertiserId) ? advertiser : a);
  db.prepare("INSERT INTO shijing_config(id,data,updatedAt) VALUES('main',?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, updatedAt=excluded.updatedAt").run(JSON.stringify(c), Date.now());
  return { ok: true };
  })();
  _ocRefreshLocks.set(advId, p);
  try { return await p; } finally { _ocRefreshLocks.delete(advId); }
}

// 获取有效 access_token（提前 1h 自动 refresh）
async function ocGetValidToken() {
  const cfg = getConfig();
  const oc = (cfg && cfg.oceanengine) || {};
  const ebp = (oc.advertisers || [])[0];
  if (!ebp) return null;
  if (ebp.expireAt && Date.now() > ebp.expireAt - 3600000) {
    console.log('[oc] token 即将过期，自动 refresh');
    const r = await ocRefreshToken(ebp);
    if (!r.ok) { console.warn('[oc] refresh failed', r.error); return null; }
  }
  return ebp.accessToken;
}

// 拉一份报表（按账户 + 维度）
// 注意：attribution 系列指标不允许跟 city_name 维度联用（巨量限制），城市维度走简化 metrics
const OC_METRICS_BASE = ['stat_cost','show_cnt','click_cnt','cpc_platform','ctr','convert_cnt','conversion_cost','conversion_rate','deep_convert_cnt','deep_convert_cost'];
async function ocFetchReport(accessToken, advertiserId, startDate, endDate, dimensions) {
  const useCity = (dimensions || []).includes('city_name');
  const body = {
    advertiser_id: Number(advertiserId),
    dimensions, metrics: useCity ? OC_METRICS_BASE : OC_METRICS, filters: [],
    start_time: startDate + ' 00:00:00',
    end_time: endDate + ' 23:59:59',
    order_by: [{ field: 'stat_cost', type: 'DESC' }],
    page: 1, page_size: 100
  };
  const params = Object.entries(body).map(([k,v]) => k + '=' + encodeURIComponent(typeof v === 'object' ? JSON.stringify(v) : v)).join('&');
  return await ocHttpsRequest({
    hostname: OC_API_HOST, path: '/open_api/v3.0/report/custom/get/?' + params, method: 'GET',
    headers: { 'Access-Token': accessToken }
  });
}

// 写入 shijing_ad（去重，id=oc_${accId}_${date}[_${city}]）
function ocWriteAdRecords(accId, accName, rows, dim) {
  // dim = 'day' | 'city'
  let written = 0, updated = 0;
  const now = Date.now();
  const upsert = db.prepare(`INSERT INTO shijing_ad(id, data, deleted) VALUES(?, ?, 0)
                              ON CONFLICT(id) DO UPDATE SET data=excluded.data`);
  for (const row of rows) {
    const m = row.metrics || {};
    const d = row.dimensions || {};
    const date = d.stat_time_day || (new Date().toISOString().slice(0,10));
    const city = d.city_name || '';
    const idKey = dim === 'city'
      ? `oc_${accId}_${date}_city_${encodeURIComponent(city)}`
      : `oc_${accId}_${date}`;
    // 业务口径：加粉=企微加好友，高潜=回访高潜成交
    const cost = +m.stat_cost || 0;
    const addFans = +m.attribution_work_wechat_added_count || 0;
    const deepConvert = +m.attribution_clue_high_intention || 0;
    const rec = {
      id: idKey,
      teamId: 'oceanengine_' + accId,
      ocAccountId: String(accId),
      ocAccountName: accName,
      date,
      sourceType: 'oceanengine',
      mediaChannel: 'oceanengine',
      cityName: city || null,
      cost,
      addFans,           // = 企业微信添加好友数
      deepConvert,       // = 回访高潜成交数
      impressions: +m.show_cnt || 0,
      clicks: +m.click_cnt || 0,
      cpc: +m.cpc_platform || 0,
      ctr: +m.ctr || 0,
      // 巨量自带的字段也保留，以备核对
      ocConvertCnt: +m.convert_cnt || 0,
      ocDeepConvertCnt: +m.deep_convert_cnt || 0,
      ocUnfriendCnt: +m.attribution_work_wechat_unfriend_count || 0,
      // 成本指标
      conversionCost: +m.conversion_cost || 0,
      conversionRate: +m.conversion_rate || 0,
      deepConvertCost: deepConvert > 0 ? +(cost / deepConvert).toFixed(2) : (+m.attribution_clue_high_intention_cost || 0),
      costPerFan: addFans > 0 ? +(cost / addFans).toFixed(2) : 0,
      deepRate: addFans > 0 ? +(deepConvert / addFans * 100).toFixed(2) : 0,
      syncedAt: now,
    };
    const existing = db.prepare('SELECT 1 FROM shijing_ad WHERE id=?').get(idKey);
    upsert.run(idKey, JSON.stringify(rec));
    if (existing) updated++; else written++;
  }
  return { written, updated };
}

// 主同步函数：拉所有 subAccounts × (按天 + 按"日×城市") 写入
// 城市维度的真加粉/真高潜 = 当日真加粉 × (该城市当日消耗 / 该日总消耗)
async function ocSync(startDate, endDate, opts) {
  opts = opts || {};
  const tok = await ocGetValidToken();
  if (!tok) return { ok: false, error: 'no valid access_token' };
  const cfg = getConfig();
  const oc = (cfg && cfg.oceanengine) || {};
  const subs = oc.subAccounts || [];
  if (!subs.length) return { ok: false, error: 'no subAccounts' };

  const summary = { startDate, endDate, accounts: subs.length, dayWritten: 0, dayUpdated: 0, cityWritten: 0, cityUpdated: 0, accountsWithData: 0, errors: [] };
  for (const acc of subs) {
    try {
      // 1) 拉天维度（含 attribution，得到真加粉/真高潜）
      const r1 = await ocFetchReport(tok, acc.accountId, startDate, endDate, ['stat_time_day']);
      if (r1 && r1.code === 0 && r1.data && r1.data.rows && r1.data.rows.length) {
        const dayRows = r1.data.rows;
        const w = ocWriteAdRecords(acc.accountId, acc.accountName, dayRows, 'day');
        summary.dayWritten += w.written; summary.dayUpdated += w.updated;
        summary.accountsWithData++;

        // 2) 拉双维度 [day, city]（无 attribution，得到城市每日基础数据）
        const r2 = await ocFetchReport(tok, acc.accountId, startDate, endDate, ['stat_time_day','city_name']);
        if (r2 && r2.code === 0 && r2.data && r2.data.rows && r2.data.rows.length) {
          // 构建 dayMap：date -> { cost, addFans, deepConvert }（真整数）
          const dayMap = {};
          for (const dr of dayRows) {
            const dm = dr.metrics || {};
            const dd = (dr.dimensions || {}).stat_time_day;
            if (!dd) continue;
            dayMap[dd] = {
              cost: +dm.stat_cost || 0,
              addFans: Math.round(+dm.attribution_work_wechat_added_count || 0),
              deepConvert: Math.round(+dm.attribution_clue_high_intention || 0),
            };
          }
          // 按日分组所有城市
          const byDay = {};
          for (const row of r2.data.rows) {
            const d = row.dimensions || {};
            const date = d.stat_time_day;
            if (!byDay[date]) byDay[date] = [];
            byDay[date].push(row);
          }
          // ★ 整数分摊算法（最大余数法 / Largest Remainder Method）：
          //   保证每个城市拿到整数，且日内合计 = 真实日值
          function distributeInt(total, weights) {
            // weights: [w1, w2, ...] 各城市消耗
            const sumW = weights.reduce((a,b) => a+b, 0);
            if (sumW <= 0 || total <= 0) return weights.map(() => 0);
            const exact = weights.map(w => total * w / sumW);
            const floors = exact.map(x => Math.floor(x));
            const remainder = total - floors.reduce((a,b) => a+b, 0);
            // 余数按小数部分大小分给前 N 个
            const fracs = exact.map((x, i) => ({ i, frac: x - Math.floor(x) }));
            fracs.sort((a, b) => b.frac - a.frac);
            for (let k = 0; k < remainder; k++) floors[fracs[k % fracs.length].i]++;
            return floors;
          }

          const cityDayRows = [];
          for (const date of Object.keys(byDay)) {
            const cityRows = byDay[date];
            const day = dayMap[date] || { cost: 0, addFans: 0, deepConvert: 0 };
            const weights = cityRows.map(r => +r.metrics.stat_cost || 0);
            const fansAlloc = distributeInt(day.addFans, weights);
            const deepAlloc = distributeInt(day.deepConvert, weights);
            cityRows.forEach((row, i) => {
              const m = { ...(row.metrics || {}) };
              m.attribution_work_wechat_added_count = fansAlloc[i];
              m.attribution_clue_high_intention = deepAlloc[i];
              cityDayRows.push({ metrics: m, dimensions: row.dimensions });
            });
          }
          const w2 = ocWriteAdRecords(acc.accountId, acc.accountName, cityDayRows, 'city');
          summary.cityWritten += w2.written; summary.cityUpdated += w2.updated;
        }
      } else if (r1 && r1.code !== 0) {
        summary.errors.push({ acc: acc.accountId, err: r1.message });
      }
      await new Promise(r => setTimeout(r, 100)); // 限流
    } catch (e) {
      summary.errors.push({ acc: acc.accountId, err: e.message });
    }
  }
  summary.ok = true;
  summary.finishedAt = Date.now();
  // 把上次同步时间存到 config
  const row = db.prepare("SELECT data FROM shijing_config WHERE id='main'").get();
  const c = JSON.parse(row.data);
  c.oceanengine = c.oceanengine || {};
  c.oceanengine.lastSync = summary;
  db.prepare("INSERT INTO shijing_config(id,data,updatedAt) VALUES('main',?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, updatedAt=excluded.updatedAt").run(JSON.stringify(c), Date.now());
  return summary;
}

// API：手动触发同步昨日数据
app.post('/api/oceanengine/sync', v6Required, async (req, res) => {
  const { startDate, endDate } = req.body || {};
  const y = new Date(Date.now() - 86400000);
  const yesterday = y.toISOString().slice(0,10);
  const s = startDate || yesterday;
  const e = endDate || yesterday;
  console.log('[oc] manual sync', s, '~', e);
  const r = await ocSync(s, e);
  res.json(r);
});

// API：30 天回填
app.post('/api/oceanengine/backfill', v6Required, async (req, res) => {
  const today = new Date();
  const end = new Date(today - 86400000).toISOString().slice(0,10);
  const start = new Date(today - 30*86400000).toISOString().slice(0,10);
  console.log('[oc] backfill', start, '~', end);
  const r = await ocSync(start, end);
  res.json(r);
});

// API：同步状态查询（前端看板用）
app.get('/api/oceanengine/sync-status', v6Required, (req, res) => {
  const cfg = getConfig();
  const oc = (cfg && cfg.oceanengine) || {};
  const subs = oc.subAccounts || [];
  // 从 ad 表统计每个账户已同步的天数 + 总消耗 + 最新日期
  const ocRecords = all.filter(x => x.sourceType === 'oceanengine');
  const byAccount = {};
  for (const r of ocRecords) {
    const k = r.ocAccountId;
    if (!byAccount[k]) byAccount[k] = { accountId: k, accountName: r.ocAccountName, dayCount: 0, cityCount: 0, totalCost: 0, latestDate: '' };
    if (r.cityName) byAccount[k].cityCount++;
    else {
      byAccount[k].dayCount++;
      byAccount[k].totalCost += (+r.cost || 0);  // ★ 仅累加天维度，避免与城市维度重复
    }
    if (r.date > byAccount[k].latestDate) byAccount[k].latestDate = r.date;
  }
  const accountStats = subs.map(s => byAccount[s.accountId] || { accountId: s.accountId, accountName: s.accountName, dayCount: 0, cityCount: 0, totalCost: 0, latestDate: '' });
  res.json({
    ok: true,
    lastSync: oc.lastSync || null,
    totalAccounts: subs.length,
    totalRecords: ocRecords.length,
    totalCost: ocRecords.filter(x => !x.cityName).reduce((s,x) => s + (+x.cost||0), 0),  // ★ 仅天维度
    accountStats,
  });
});

// API：按城市投产看板数据
app.get('/api/oceanengine/by-city', v6Required, (req, res) => {
  const { start, end } = req.query || {};
  const user = req.v6User;
  // 投放数据：只有 HQ 和投放用户能看
  if (user.role !== 'hq' && user.role !== 'ad') {
    return res.json({ ok: true, data: [] });
  }
  const adAll = db.prepare('SELECT data FROM shijing_ad WHERE deleted=0').all().map(r => JSON.parse(r.data));
  const all = (user.role === 'hq') ? adAll : adAll.filter(r => r.teamId === user.teamId);
  const cfgMain = db.prepare("SELECT data FROM shijing_config WHERE id=?").get("main");
  const teamConfig = cfgMain ? (JSON.parse(cfgMain.data).teams || {}) : {};
  const cityRows = all.filter(x => {
    if (x.sourceType !== 'oceanengine') return false;
    
    // ★ 修复：如果 cityName 为空，尝试从 teamId 映射到城市
    if (!x.cityName && x.teamId) {
      const team = teamConfig[x.teamId];
      if (team && team.city) {
        x.cityName = team.city;
      }
    }
    // 如果仍然没有城市名称，跳过该记录
    if (!x.cityName) return false;
    if (start && x.date < start) return false;
    if (end && x.date > end) return false;
    return true;
  });
  // 按城市聚合（跨账户、跨日期）
  const byCity = {};
  for (const r of cityRows) {
    const city = r.cityName;
    if (!byCity[city]) byCity[city] = { city, cost: 0, addFans: 0, deepConvert: 0, clicks: 0, impressions: 0 };
    byCity[city].cost += +r.cost || 0;
    byCity[city].addFans += +r.addFans || 0;
    byCity[city].deepConvert += +r.deepConvert || 0;
    byCity[city].clicks += +r.clicks || 0;
    byCity[city].impressions += +r.impressions || 0;
  }

  // ★ 新增：统计 store 表的新客到店数（按城市聚合）
  const storeData = db.prepare("SELECT data FROM shijing_store WHERE deleted=0").all().map(r => JSON.parse(r.data));
  
  // 过滤：customerType="新客" 且在日期范围内
  const newCustomers = storeData.filter(s => {
    if (s.customerType !== "新客") return false;
    if (start && s.date < start) return false;
    if (end && s.date > end) return false;
    return true;
  });
  
  // 按 teamId -> teamConfig[id].city -> 城市维度聚合
  newCustomers.forEach(s => {
    const storeTeam = teamConfig[s.teamId];
    if (!storeTeam || !storeTeam.city) return;
    const city = storeTeam.city;
    if (!byCity[city]) byCity[city] = { city, cost: 0, addFans: 0, deepConvert: 0, clicks: 0, impressions: 0, arrivedCount: 0 };
    byCity[city].arrivedCount++;
  });

  const cities = Object.values(byCity).map(c => ({
    ...c,
    cpc: c.clicks > 0 ? +(c.cost / c.clicks).toFixed(2) : 0,
    costPerFan: c.addFans > 0 ? +(c.cost / c.addFans).toFixed(2) : 0,
    conversionRate: c.clicks > 0 ? +(c.addFans / c.clicks * 100).toFixed(2) : 0,
    costPerArrived: c.arrivedCount > 0 ? +(c.cost / c.arrivedCount).toFixed(2) : 0,
  })).sort((a, b) => b.cost - a.cost);
  res.json({ ok: true, cities, totalCities: cities.length });
});

// ========== 巨量数据同步 cron（双时点策略）==========
// 8:00 第一次拉：抢早，至少把天维度数据拉到，让看板能看
// 8:30 第二次拉：巨量"昨日城市维度"通常在 8:25 左右才完整，这时候补拉城市维度
// 9:00 自愈简报会自己再拉一次（如果数据仍不全），三道保险
async function ocDailySync(label) {
  const yDate = new Date(Date.now() - 86400000);
  const y = yDate.getFullYear() + '-' + String(yDate.getMonth()+1).padStart(2,'0') + '-' + String(yDate.getDate()).padStart(2,'0');
  console.log(`[oc cron ${label}] daily sync for ${y}`);
  // 重试 3 次
  let r = null;
  for (let i = 1; i <= 3; i++) {
    r = await ocSync(y, y);
    if (r && r.ok && (r.dayWritten + r.dayUpdated) > 0) {
      console.log(`[oc cron ${label}] success on attempt ${i}: day=${r.dayWritten + r.dayUpdated} city=${r.cityWritten + r.cityUpdated}`);
      break;
    }
    console.warn(`[oc cron ${label}] attempt ${i} failed`, JSON.stringify(r).slice(0, 200));
    if (i < 3) await new Promise(res => setTimeout(res, 60000));
  }
  console.log(`[oc cron ${label}] done`, JSON.stringify(r).slice(0, 250));
  return r;
}

// 8:00 第一次拉昨日数据（天维度优先，城市维度可能还没出齐）
cron.schedule('0 8 * * *', async () => {
  await ocDailySync('08:00');
}, { timezone: 'Asia/Shanghai' });

// 8:30 第二次拉：巨量昨日城市维度此时通常已完整，专门补城市
cron.schedule('30 8 * * *', async () => {
  await ocDailySync('08:30');
}, { timezone: 'Asia/Shanghai' });

// 9:25 日报前置补拉：AI 日报(9:30)前最后再强制拉一次昨日巨量，确保数据完整
cron.schedule('25 9 * * *', async () => {
  console.log('[oc pre-report] 09:25 force sync before AI report');
  try { await ocDailySync('09:25-pre-report'); } catch (e) { console.warn('[oc pre-report]', e.message); }
}, { timezone: 'Asia/Shanghai' });

// 每 6 小时主动 refresh 一次 token，避免凌晨过期
cron.schedule('0 */6 * * *', async () => {
  try {
    const tok = await ocGetValidToken();
    console.log('[oc token-keeper] ok=' + !!tok);
  } catch (e) { console.warn('[oc token-keeper]', e.message); }
}, { timezone: 'Asia/Shanghai' });

// ========== 巨量 token 健康巡检 + 过期告警 ==========
// 检查 advertisers[0]（实际拉数用的主 token）：access 剩 <2h 自动 refresh；refresh_token 剩 <5天 或已过期 → 推总部群告警
async function checkOcTokenHealth(reason) {
  try {
    const cfg = getConfig();
    const oc = (cfg && cfg.oceanengine) || {};
    const adv = (oc.advertisers || [])[0];
    const hq = cfg && cfg.wecomConfig && cfg.wecomConfig.hqWebhook;
    if (!adv) {
      console.warn('[oc token-health] no advertiser configured');
      if (hq) await pushWecom(hq, '## ⚠️ 巨量广告 token 告警\n> 系统未检测到任何已授权的巨量广告主，数据简报/AI日报将无投放数据。\n> 请尽快重新授权：https://crmai.quesiai.com');
      return;
    }
    const now = Date.now();
    // access 剩 <2h 主动续期
    if (adv.expireAt && now > adv.expireAt - 2 * 3600000) {
      console.log('[oc token-health] access token near expiry, refreshing... reason=' + reason);
      const r = await ocRefreshToken(adv);
      if (!r.ok) {
        console.warn('[oc token-health] refresh failed:', r.error);
        if (hq) await pushWecom(hq, '## ⚠️ 巨量广告 token 续期失败\n> 原因：' + (r.error || '未知') + '\n> access_token 已过期且自动续期失败，投放数据可能拉取不到。\n> 请重新授权：https://crmai.quesiai.com');
        return;
      }
    }
    // refresh_token 剩余天数检查（refresh 过期=必须重新人工授权）
    const fresh = getConfig();
    const a2 = ((fresh.oceanengine || {}).advertisers || [])[0] || adv;
    const rLeftDays = a2.refreshExpireAt ? (a2.refreshExpireAt - now) / 86400000 : 999;
    if (rLeftDays < 0) {
      console.warn('[oc token-health] refresh_token EXPIRED');
      if (hq) await pushWecom(hq, '## 🔴 巨量广告授权已过期\n> refresh_token 已过期，系统无法再自动续期。\n> **必须人工重新授权**，否则投放数据将持续缺失。\n> 授权入口：https://crmai.quesiai.com');
    } else if (rLeftDays < 5) {
      console.warn('[oc token-health] refresh_token expiring in', rLeftDays.toFixed(1), 'days');
      if (hq) await pushWecom(hq, '## 🟡 巨量广告授权即将到期\n> refresh_token 还有约 **' + Math.floor(rLeftDays) + ' 天** 到期。\n> 到期后系统将无法自动续期，请提前重新授权。\n> 授权入口：https://crmai.quesiai.com');
    }
    console.log('[oc token-health] ok, access剩=' + ((a2.expireAt - now) / 3600000).toFixed(1) + 'h refresh剩=' + rLeftDays.toFixed(1) + 'd reason=' + reason);
  } catch (e) {
    console.warn('[oc token-health] error:', e.message);
  }
}
// 每天 7:55 巡检（早于 8:00 拉数）
cron.schedule('55 7 * * *', () => { checkOcTokenHealth('cron-0755'); }, { timezone: 'Asia/Shanghai' });
// 启动 40s 后自检一次
setTimeout(() => { checkOcTokenHealth('startup'); }, 40000);

// ========== 数据完整性看门狗（v2）==========
// 每天 11:00 / 14:00 / 18:00 各扫一次，发现昨日数据缺失主动同步
cron.schedule('0 11,14,18 * * *', async () => {
  const d = new Date(Date.now() - 86400000);
  const date = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  const rows = db.prepare("SELECT data FROM shijing_ad WHERE deleted=0").all().map(r => JSON.parse(r.data));
  const dayCount = rows.filter(r => r.date === date && !r.cityName).length;
  const cityCount = rows.filter(r => r.date === date && r.cityName).length;
  const totalCost = rows.filter(r => r.date === date && !r.cityName).reduce((s, r) => s + (+r.cost || 0), 0);
  console.log(`[oc watchdog] ${date} day=${dayCount} city=${cityCount} cost=${totalCost.toFixed(2)}`);
  if (dayCount === 0 || totalCost < 10) {
    console.log(`[oc watchdog] ${date} missing data, triggering sync`);
    try {
      const r = await ocSync(date, date);
      console.log(`[oc watchdog] re-sync result:`, JSON.stringify(r).slice(0, 200));
    } catch (e) { console.warn(`[oc watchdog] sync error:`, e.message); }
  }
}, { timezone: 'Asia/Shanghai' });


// =========================================================================
// 媒体渠道注册中心
// 统一管理所有数据源（巨量、本地推、手动录入、未来其他渠道）
// 各渠道独立写自己的同步模块，但通过这里注册元信息 + 通用查询 API
// =========================================================================

const MEDIA_CHANNELS = [
  {
    key: 'oceanengine',
    name: '巨量引擎',
    icon: '📡',
    type: 'auto',          // auto: 自动同步 / manual: 手动录入 / import: 文件导入
    enabled: true,
    syncEndpoint: '/api/oceanengine/sync',
    backfillEndpoint: '/api/oceanengine/backfill',
    statusEndpoint: '/api/oceanengine/sync-status',
    description: '抖音/今日头条投放数据，每天凌晨5点自动同步昨日',
  },
  {
    key: 'oceanengine_legacy',
    name: '巨量历史',
    icon: '📜',
    type: 'manual',
    enabled: true,
    description: '5/01-5/21 手填导入的巨量历史数据（仅展示，无法新增）',
    readonly: true,
  },
  {
    key: 'bendituig',
    name: '本地推',
    icon: '📍',
    type: 'auto',
    enabled: false,        // 待对接
    syncEndpoint: '/api/bendituig/sync',
    description: '本地推 API 对接中，敬请期待',
    comingSoon: true,
  },
  {
    key: 'manual',
    name: '手动录入',
    icon: '✍️',
    type: 'manual',
    enabled: true,
    description: '营销线在系统内手动录入的数据（无 API 对接的渠道兜底）',
  },
];

// API：列出所有渠道（带每个渠道的实时统计）
app.get('/api/media-channels/list', (req, res) => {
  const all = db.prepare('SELECT data FROM shijing_ad WHERE deleted=0').all().map(r => JSON.parse(r.data));
  const stats = {};
  for (const x of all) {
    const k = x.mediaChannel || 'manual';
    if (!stats[k]) stats[k] = { records: 0, totalCost: 0, totalAddFans: 0, latestDate: '' };
    stats[k].records++;
    stats[k].totalCost += +x.cost || 0;
    stats[k].totalAddFans += +x.addFans || 0;
    if (x.date && x.date > stats[k].latestDate) stats[k].latestDate = x.date;
  }
  const channels = MEDIA_CHANNELS.map(c => ({ ...c, stats: stats[c.key] || { records: 0, totalCost: 0, totalAddFans: 0, latestDate: '' } }));
  res.json({ ok: true, channels });
});

// API：按渠道查看汇总（30 天）
app.get('/api/media-channels/by-channel-stats', (req, res) => {
  const days = +req.query.days || 30;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const all = db.prepare('SELECT data FROM shijing_ad WHERE deleted=0').all().map(r => JSON.parse(r.data));
  const filtered = all.filter(x => x.date >= cutoff);

  const byChannel = {};
  for (const x of filtered) {
    const k = x.mediaChannel || 'manual';
    if (x.cityName) continue; // 城市维度记录不参与渠道汇总（避免重复）
    if (!byChannel[k]) byChannel[k] = { channel: k, cost: 0, addFans: 0, deepConvert: 0, clicks: 0, impressions: 0, records: 0 };
    byChannel[k].cost += +x.cost || 0;
    byChannel[k].addFans += +x.addFans || 0;
    byChannel[k].deepConvert += +x.deepConvert || 0;
    byChannel[k].clicks += +x.clicks || 0;
    byChannel[k].impressions += +x.impressions || 0;
    byChannel[k].records++;
  }
  const channels = Object.values(byChannel).map(c => {
    const meta = MEDIA_CHANNELS.find(m => m.key === c.channel) || { name: c.channel, icon: '?', key: c.channel };
    return {
      ...c,
      name: meta.name, icon: meta.icon,
      cpc: c.clicks > 0 ? +(c.cost / c.clicks).toFixed(2) : 0,
      costPerFan: c.addFans > 0 ? +(c.cost / c.addFans).toFixed(2) : 0,
    };
  }).sort((a, b) => b.cost - a.cost);
  res.json({ ok: true, days, channels });
});

// API：本地推占位 sync（提示尚未对接）
app.post('/api/bendituig/sync', (req, res) => {
  res.json({ ok: false, error: '本地推 API 尚未对接，预留接口', comingSoon: true });
});

// =========================================================================
// 营销线 / 总部 共用：分渠道账户报表 + 分渠道城市报表
// =========================================================================

// 分渠道账户级报表：每个渠道下所有账户的 消耗 / 点击 / 加粉成本 / 高潜成本（深转成本）
// query: ?start=YYYY-MM-DD&end=YYYY-MM-DD&excludeManual=1
app.get('/api/marketing/channel-report', v6Required, (req, res) => {
  const { start, end, excludeManual } = req.query || {};
  
  const user = req.v6User;
  // 投放数据：只有 HQ 和投放用户能看
  if (user.role !== 'hq' && user.role !== 'ad') {
    return res.json({ ok: true, data: { channels: [], accounts: [] } });
  }
  const adAll = db.prepare('SELECT data FROM shijing_ad WHERE deleted=0').all().map(r => JSON.parse(r.data));
  const all = (user.role === 'hq') ? adAll : adAll.filter(r => r.teamId === user.teamId);
  const recs = all.filter(x => {
    if (start && x.date < start) return false;
    if (end && x.date > end) return false;
    if (excludeManual === '1') {
      const ch = MEDIA_CHANNELS.find(m => m.key === (x.mediaChannel || 'manual'));
      if (!ch || ch.type !== 'auto') return false;
    }
    return true;
  });
  // 按 (mediaChannel, accountId) 聚合
  const byKey = {};
  for (const r of recs) {
    const ch = r.mediaChannel || 'manual';
    const accId = r.ocAccountId || r.teamId || 'manual';
    const accName = r.ocAccountName || r.teamName || ch;
    const k = ch + '__' + accId;
    if (!byKey[k]) byKey[k] = {
      channel: ch, accountId: accId, accountName: accName,
      cost: 0, addFans: 0, deepConvert: 0, clicks: 0, impressions: 0, days: 0, latestDate: '',
    };
    byKey[k].cost += +r.cost || 0;
    byKey[k].addFans += +r.addFans || 0;
    byKey[k].deepConvert += +r.deepConvert || 0;
    byKey[k].clicks += +r.clicks || 0;
    byKey[k].impressions += +r.impressions || 0;
    byKey[k].days++;
    if (r.date > byKey[k].latestDate) byKey[k].latestDate = r.date;
  }
  // 按渠道分组
  const channelMap = {};
  for (const a of Object.values(byKey)) {
    if (!channelMap[a.channel]) {
      const meta = MEDIA_CHANNELS.find(m => m.key === a.channel) || { name: a.channel, icon: '?', key: a.channel };
      channelMap[a.channel] = {
        key: a.channel, name: meta.name, icon: meta.icon,
        accounts: [],
        totalCost: 0, totalAddFans: 0, totalDeepConvert: 0, totalClicks: 0, totalImpressions: 0,
      };
    }
    const acc = {
      ...a,
      cpc: a.clicks > 0 ? +(a.cost / a.clicks).toFixed(2) : 0,
      costPerFan: a.addFans > 0 ? +(a.cost / a.addFans).toFixed(2) : 0,
      deepConvertCost: a.deepConvert > 0 ? +(a.cost / a.deepConvert).toFixed(2) : 0,
      ctr: a.impressions > 0 ? +(a.clicks / a.impressions * 100).toFixed(2) : 0,
    };
    channelMap[a.channel].accounts.push(acc);
    channelMap[a.channel].totalCost += a.cost;
    channelMap[a.channel].totalAddFans += a.addFans;
    channelMap[a.channel].totalDeepConvert += a.deepConvert;
    channelMap[a.channel].totalClicks += a.clicks;
    channelMap[a.channel].totalImpressions += a.impressions;
  }
  const channels = Object.values(channelMap).map(c => ({
    ...c,
    accounts: c.accounts.sort((x, y) => y.cost - x.cost).map(a => ({
      ...a,
      depositRate: a.addFans > 0 ? +(a.deepConvert / a.addFans * 100).toFixed(2) : 0,
    })),
    totalCpc: c.totalClicks > 0 ? +(c.totalCost / c.totalClicks).toFixed(2) : 0,
    totalCostPerFan: c.totalAddFans > 0 ? +(c.totalCost / c.totalAddFans).toFixed(2) : 0,
    totalDeepConvertCost: c.totalDeepConvert > 0 ? +(c.totalCost / c.totalDeepConvert).toFixed(2) : 0,
    totalDepositRate: c.totalAddFans > 0 ? +(c.totalDeepConvert / c.totalAddFans * 100).toFixed(2) : 0,
  })).sort((a, b) => b.totalCost - a.totalCost);
  res.json({ ok: true, start: start || null, end: end || null, channels });
});

// 分渠道城市级报表：指定渠道下所有城市的 消耗 / 曝光 / 点击 / 加粉成本 / 高潜成本
// query: ?channel=oceanengine&start=YYYY-MM-DD&end=YYYY-MM-DD&excludeManual=1
app.get('/api/marketing/channel-city-report', v6Required, (req, res) => {
  const { channel, start, end, excludeManual } = req.query || {};
  const user = req.v6User;
  // 投放数据：只有 HQ 和投放用户能看
  if (user.role !== 'hq' && user.role !== 'ad') {
    return res.json({ ok: true, data: [] });
  }
  const adAll = db.prepare('SELECT data FROM shijing_ad WHERE deleted=0').all().map(r => JSON.parse(r.data));
  const all = (user.role === 'hq') ? adAll : adAll.filter(r => r.teamId === user.teamId);
  
  const recs = all.filter(x => {
    if (!x.cityName) return false;
    if (channel && (x.mediaChannel || 'manual') !== channel) return false;
    if (start && x.date < start) return false;
    if (end && x.date > end) return false;
    if (excludeManual === '1') {
      const ch = MEDIA_CHANNELS.find(m => m.key === (x.mediaChannel || 'manual'));
      if (!ch || ch.type !== 'auto') return false;
    }
    return true;
  });
  const byCity = {};
  for (const r of recs) {
    const c = r.cityName;
    if (!byCity[c]) byCity[c] = { city: c, cost: 0, addFans: 0, deepConvert: 0, clicks: 0, impressions: 0 };
    byCity[c].cost += +r.cost || 0;
    byCity[c].addFans += +r.addFans || 0;
    byCity[c].deepConvert += +r.deepConvert || 0;
    byCity[c].clicks += +r.clicks || 0;
    byCity[c].impressions += +r.impressions || 0;
  }
  // 营业额：从 store 表算每个城市的 op+closed 金额
  const _CITY_M = getStoreCityMap();
  const _DISTRICT_M = getStoreDistrictMap();
  const storeAll = db.prepare('SELECT data FROM shijing_store WHERE deleted=0').all().map(r => JSON.parse(r.data));
  const storeRecs = storeAll.filter(x => {
    if (start && x.date < start) return false;
    if (end && x.date > end) return false;
    return true;
  });
  for (const s of storeRecs) {
    const district = _DISTRICT_M[s.teamId];
    const cityKey = _CITY_M[s.teamId];
    // 优先匹配区级 -> 再匹配市级 -> 都不存在则用 cityKey 新建行（保证新店所在新城市不被吞）
    let t = (district && byCity[district]) ? district : (cityKey && byCity[cityKey]) ? cityKey : null;
    if (!t && cityKey) {
      // 该城市没有广告投放但有门店营业额 → 新建空行
      t = cityKey;
      byCity[t] = { city: t, cost: 0, addFans: 0, deepConvert: 0, clicks: 0, impressions: 0, revenue: 0 };
    }
    if (!t) continue;
    if (!byCity[t].revenue) byCity[t].revenue = 0;
    byCity[t].revenue += (+s.opAmount || 0) + (+s.closedAmount || 0);
  }
  const cities = Object.values(byCity).map(c => ({
    ...c,
    revenue: c.revenue || 0,
    cpc: c.clicks > 0 ? +(c.cost / c.clicks).toFixed(2) : 0,
    costPerFan: c.addFans > 0 ? +(c.cost / c.addFans).toFixed(2) : 0,
    deepConvertCost: c.deepConvert > 0 ? +(c.cost / c.deepConvert).toFixed(2) : 0,
    conversionRate: c.clicks > 0 ? +(c.addFans / c.clicks * 100).toFixed(2) : 0,
    costPerArrived: c.arrivedCount > 0 ? +(c.cost / c.arrivedCount).toFixed(2) : 0,
    depositRate: c.addFans > 0 ? +(c.deepConvert / c.addFans * 100).toFixed(2) : 0,
    roi: c.cost > 0 ? +((c.revenue || 0) / c.cost).toFixed(2) : 0,
  })).sort((a, b) => b.cost - a.cost);
  res.json({ ok: true, channel: channel || null, totalCities: cities.length, cities });
});

// 分渠道每日城市报表：返回 [{date, city, cost, addFans, deepConvert, ...}] 平铺列表 + 按日聚合
// query: ?channel=oceanengine&start=YYYY-MM-DD&end=YYYY-MM-DD&excludeManual=1
app.get('/api/marketing/channel-city-daily', v6Required, (req, res) => {
  const { channel, start, end, excludeManual } = req.query || {};
  const user = req.v6User;
  // 投放数据：只有 HQ 和投放用户能看
  if (user.role !== 'hq' && user.role !== 'ad') {
    return res.json({ ok: true, data: [] });
  }
  const adAll = db.prepare('SELECT data FROM shijing_ad WHERE deleted=0').all().map(r => JSON.parse(r.data));
  const all = (user.role === 'hq') ? adAll : adAll.filter(r => r.teamId === user.teamId);
  
  const recs = all.filter(x => {
    if (!x.cityName) return false;
    if (channel && (x.mediaChannel || 'manual') !== channel) return false;
    if (start && x.date < start) return false;
    if (end && x.date > end) return false;
    if (excludeManual === '1') {
      const ch = MEDIA_CHANNELS.find(m => m.key === (x.mediaChannel || 'manual'));
      if (!ch || ch.type !== 'auto') return false;
    }
    return true;
  });
  // 平铺：date+city 聚合（同日多账户合并）
  const byDC = {};
  for (const r of recs) {
    const k = r.date + '|' + r.cityName;
    if (!byDC[k]) byDC[k] = { date: r.date, city: r.cityName, cost: 0, addFans: 0, deepConvert: 0, clicks: 0, impressions: 0 };
    byDC[k].cost += +r.cost || 0;
    byDC[k].addFans += +r.addFans || 0;
    byDC[k].deepConvert += +r.deepConvert || 0;
    byDC[k].clicks += +r.clicks || 0;
    byDC[k].impressions += +r.impressions || 0;
  }
  const rows = Object.values(byDC).map(r => ({
    ...r,
    cpc: r.clicks > 0 ? +(r.cost / r.clicks).toFixed(2) : 0,
    costPerFan: r.addFans > 0 ? +(r.cost / r.addFans).toFixed(2) : 0,
    deepConvertCost: r.deepConvert > 0 ? +(r.cost / r.deepConvert).toFixed(2) : 0,
    depositRate: r.addFans > 0 ? +(r.deepConvert / r.addFans * 100).toFixed(2) : 0,
  })).sort((a, b) => (b.date + b.city).localeCompare(a.date + a.city));
  // 按日聚合（每天一行汇总）
  const byDay = {};
  for (const r of rows) {
    if (!byDay[r.date]) byDay[r.date] = { date: r.date, cities: 0, cost: 0, addFans: 0, deepConvert: 0, clicks: 0, impressions: 0 };
    byDay[r.date].cities++;
    byDay[r.date].cost += r.cost;
    byDay[r.date].addFans += r.addFans;
    byDay[r.date].deepConvert += r.deepConvert;
    byDay[r.date].clicks += r.clicks;
    byDay[r.date].impressions += r.impressions;
  }
  const dailyAgg = Object.values(byDay).map(d => ({
    ...d,
    costPerFan: d.addFans > 0 ? +(d.cost / d.addFans).toFixed(2) : 0,
    deepConvertCost: d.deepConvert > 0 ? +(d.cost / d.deepConvert).toFixed(2) : 0,
    depositRate: d.addFans > 0 ? +(d.deepConvert / d.addFans * 100).toFixed(2) : 0,
  })).sort((a, b) => b.date.localeCompare(a.date));
  res.json({ ok: true, channel: channel || null, totalRows: rows.length, totalDays: dailyAgg.length, rows, dailyAgg });
});


// 定金到店率：到店数(store新客) / 定金数(=高潜数 ad.deepConvert) — 整体 + 按渠道 + 按城市
// 城市映射：从门店 teamId 映射到城市（仕净5家店）
// 默认映射 + 从 teams[id].city/district 动态合并
// 城市映射规则（2026-05-29 修正）：
// - getStoreCityMap：包含已删除门店的 city（保留历史归属，让总部数据看板/城市汇总能继续统计）
// - getActiveStoreCityMap：仅活跃门店（客服邀约下拉/门店选择列表用）
// 已删除门店：teams[id].deleted=true，账号无法登录、不出现在活跃下拉，但城市映射保留
const STORE_CITY_MAP_FALLBACK = { hq_history: '长沙' };
function getStoreCityMap() {
  const cfg = getConfig() || {};
  const t = cfg.teams || {};
  // 包含 deleted（保留历史数据归属）
  return Object.assign({}, STORE_CITY_MAP_FALLBACK,
    Object.fromEntries(Object.entries(t).filter(([k,v]) => v.role === 'store' && v.city).map(([k,v]) => [k, v.city])));
}
function getActiveStoreCityMap() {
  const cfg = getConfig() || {};
  const t = cfg.teams || {};
  // 仅活跃（!deleted）
  return Object.fromEntries(Object.entries(t).filter(([k,v]) => v.role === 'store' && v.city && !v.deleted).map(([k,v]) => [k, v.city]));
}
function getStoreDistrictMap() {
  const cfg = getConfig() || {};
  const t = cfg.teams || {};
  return Object.fromEntries(Object.entries(t).filter(([k,v]) => v.role === 'store' && v.district).map(([k,v]) => [k, v.district]));
}
const STORE_CITY_MAP = new Proxy({}, { get: (_, k) => getStoreCityMap()[k] });
const STORE_DISTRICT_MAP = new Proxy({}, { get: (_, k) => getStoreDistrictMap()[k] });
app.get('/api/marketing/deposit-arrive-stats', (req, res) => {
  const { start, end, excludeManual } = req.query || {};
  const ad = db.prepare('SELECT data FROM shijing_ad WHERE deleted=0').all().map(r => JSON.parse(r.data));
  const store = db.prepare('SELECT data FROM shijing_store WHERE deleted=0').all().map(r => JSON.parse(r.data));
  // 时间过滤 + 渠道过滤
  const inDate = d => (!start || d >= start) && (!end || d <= end);
  const isAuto = x => {
    const ch = MEDIA_CHANNELS.find(m => m.key === (x.mediaChannel || 'manual'));
    return ch && ch.type === 'auto';
  };
  const adRecs = ad.filter(x => inDate(x.date) && (excludeManual !== '1' || isAuto(x)));
  const storeRecs = store.filter(x => inDate(x.date) && x.customerType === '新客');
  // 整体
  const totalDeposit = adRecs.filter(x => !x.cityName).reduce((s, x) => s + (+x.deepConvert || 0), 0);
  const totalArrive = storeRecs.length;
  const totalRate = totalDeposit > 0 ? +(totalArrive / totalDeposit * 100).toFixed(2) : 0;

  // 按渠道：定金=ad.deepConvert(按mediaChannel)；到店=门店均算（无渠道字段，挂在所有渠道汇总值上）
  // 注意：到店数没法严格分渠道，所以按渠道时定金就是该渠道的，到店是全部到店的"加权占比"
  const byChannel = {};
  for (const r of adRecs.filter(x => !x.cityName)) {
    const k = r.mediaChannel || 'manual';
    if (!byChannel[k]) byChannel[k] = { channel: k, deposit: 0, arrive: 0 };
    byChannel[k].deposit += +r.deepConvert || 0;
  }
  // 按渠道的定金占比，分摊到店数
  if (totalDeposit > 0) {
    for (const k of Object.keys(byChannel)) {
      const ratio = byChannel[k].deposit / totalDeposit;
      byChannel[k].arrive = Math.round(totalArrive * ratio);
    }
  }
  const channels = Object.values(byChannel).map(c => ({
    ...c,
    name: (MEDIA_CHANNELS.find(m => m.key === c.channel) || { name: c.channel }).name,
    rate: c.deposit > 0 ? +(c.arrive / c.deposit * 100).toFixed(2) : 0,
  })).sort((a, b) => b.deposit - a.deposit);

  // 按城市：定金=ad.deepConvert(按 cityName)；到店=门店按 teamId 映射的城市
  const byCity = {};
  for (const r of adRecs.filter(x => x.cityName)) {
    const c = r.cityName;
    if (!byCity[c]) byCity[c] = { city: c, deposit: 0, arrive: 0 };
    byCity[c].deposit += +r.deepConvert || 0;
  }
  // 累计到店数到城市（按门店 teamId 映射）
  for (const s of storeRecs) {
    const district = STORE_DISTRICT_MAP[s.teamId];   // 上海闵行/上海静安/...
    const city = STORE_CITY_MAP[s.teamId];            // 上海/长沙/佛山
    // 优先匹配区级，再匹配市级（巨量city_name是市级）
    const targets = [district, city].filter(Boolean);
    for (const t of targets) {
      if (byCity[t]) { byCity[t].arrive += 1; break; }
    }
    // 如果都没匹配到，挂到 city 级别
    if (city && !byCity[district] && !byCity[city]) {
      byCity[city] = byCity[city] || { city, deposit: 0, arrive: 0 };
      byCity[city].arrive += 1;
    }
  }
  const cities = Object.values(byCity).map(c => ({
    ...c,
    rate: c.deposit > 0 ? +(c.arrive / c.deposit * 100).toFixed(2) : 0,
  })).sort((a, b) => b.deposit - a.deposit);

  res.json({
    ok: true,
    overall: { deposit: totalDeposit, arrive: totalArrive, rate: totalRate },
    channels,
    cities,
  });
});


// ========== 客户档案+旅程（插件式，零侵入）==========
try {
  require('./v6-detail-followup')(app, db, { getConfig, pushWecom, fmtLocalDate, v6Required, v6HQRequired, cron });
  require('./v6-customer')(app, db, { getConfig, fmtLocalDate, v6Required, v6HQRequired });
  require('./v6-customer-hub')(app, db, { getConfig, fmtLocalDate, v6Required, v6HQRequired });
} catch (e) {
  console.error('[v6-customer] mount failed:', e && e.message);
}

// ========== 企业微信客户同步（插件式，零侵入）==========
try {
  require('./v6-wecom')(app, db, { getConfig, fmtLocalDate, v6Required, v6HQRequired });
} catch (e) {
  console.error('[v6-wecom] mount failed:', e && e.message);
}

// ========== AI 数据日报（插件式，零侵入）==========
try {
  require('./v6-ai-report')(app, db, {
    getConfig, setConfig, pushWecom: pushWecomAI, fmtLocalDate,
    v6Required, v6HQRequired, genToken,
  });
} catch (e) {
  console.error('[v6-ai-report] mount failed:', e && e.message);
}

// ========== 预约容量校验接口（插件式，零侵入）==========
try {
  require("./v6-slot-api")(app, db, {
    getConfig, setConfig, v6Required, v6HQRequired,
  });
} catch (e) {
  console.error("[v6-slot-api] mount failed:", e && e.message);
}

// ========== 明日各门店预约到店看板 + 22:00 推送（插件式，零侵入）==========
try {
  require('./v6-tomorrow-arrivals')(app, db, {
    getConfig, fmtLocalDate, pushWecom: pushWecomAI,
    v6Required, v6HQRequired, cron,
  });
} catch (e) {
  console.error('[v6-tomorrow-arrivals] mount failed:', e && e.message);
}

// ========== 启动 ==========
// ===== 排客容量看板模块 =====
try {
  require('./v6-slot-calendar')(app, db, v6Required, getConfig);
} catch (e) { console.warn('[v6-slot-calendar] failed:', e.message); }

// ===== AI 数据助手模块 =====
try {
  require('./v6-ai-chat')(app, db, { getConfig, v6HQRequired });
} catch (e) { console.warn('[v6-ai-chat] failed:', e.message); }

app.listen(PORT, () => {
  console.log('🦾 仕净系统已启动 -> http://localhost:' + PORT + '/');
  console.log('   数据库: ' + DB_FILE);
  console.log('   每日 9:00 自动推送数据简报 + 处理预约邀约推送');
});
