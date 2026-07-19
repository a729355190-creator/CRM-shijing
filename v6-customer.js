/**
 * V6 客户档案 + 旅程模块（插件式零侵入）
 * ------------------------------------------------------------
 * 目标（改造2 · B 全旅程）：把散落的 invite/store/cs/企微 数据按"人"归拢成客户档案。
 *
 * 身份锚点（与用户确认）：
 *   - 手机号 phone 为主锚点（客服邀约时本来就填）
 *   - 姓名 name 为辅（手机号缺失时按 姓名 兜底）
 *   - external_userid 为线上锚点（邀约新增"选企微客户"后绑定；历史单先不绑）
 *
 * 实现：纯聚合，不改任何业务表。客户档案 = 实时从 invite+store(+企微) 按手机号/姓名归拢。
 *   - 不新建冗余客户表（避免与业务表不一致），改为"视图式"实时聚合 + 轻量缓存
 *   - 邀约绑定的 external_userid 存独立表 shijing_customer_bind（phone -> external_userid）
 *   - 照片存独立表 shijing_customer_photo（手机号 + 节点 + OSS url）
 *
 * 依赖注入：getConfig, fmtLocalDate, v6Required, v6HQRequired
 * ------------------------------------------------------------
 */
'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');

module.exports = function (app, db, deps) {
  deps = deps || {};

  // ===== 预约容量校验辅助函数 =====
  function parseTimeToMinutes(isoTime) {
    const hour = parseInt(String(isoTime || "").slice(11, 13));
    const min = parseInt(String(isoTime || "").slice(14, 16));
    return hour * 60 + min;
  }

  const getConfig = deps.getConfig;
  const v6Required = deps.v6Required || ((req, res, next) => next());
  const v6HQRequired = deps.v6HQRequired || ((req, res, next) => next());

  // ===== 客户中心同步：门店操作 → customer_events / deals =====
  // 通过 phone → customer_bind → external_userid 关联到客户主档
  function syncToHub(rec, kind) {
    try {
      const ph = (rec.phone || '').replace(/\s|-/g, '');
      if (!ph) return;
      const bind = db.prepare('SELECT external_userid FROM shijing_customer_bind WHERE phone=? AND external_userid IS NOT NULL AND external_userid<>\'\'').get(ph);
      if (!bind) return; // 未绑定企微，无法挂到客户中心(等绑定后可补)
      const ext = bind.external_userid;
      const at = rec.arriveTime ? (Date.parse(rec.arriveTime.length <= 16 ? rec.arriveTime + ':00' : rec.arriveTime) || Date.now()) : Date.now();
      const now = Date.now();

      if (kind === 'reinvite') {
        // 再次邀约 → 排期事件
        db.prepare(`INSERT OR REPLACE INTO shijing_customer_events
          (id, external_userid, type, actor, source_table, source_id, payload, occurred_at, created_at)
          VALUES (?,?,?,?,?,?,?,?,?)`).run(
          'ev_reinv_' + rec.id, ext, 'scheduled', rec.csTeamName || '门店复购邀约',
          'shijing_invite', rec.id, JSON.stringify({ remark: rec.remark }), at, now);
        return;
      }

      // visit：到店事件
      db.prepare(`INSERT OR REPLACE INTO shijing_customer_events
        (id, external_userid, type, actor, source_table, source_id, payload, occurred_at, created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(
        'ev_visit_' + rec.id, ext, 'arrived', rec.performer || rec.teamId || '',
        'shijing_store', rec.id, JSON.stringify({ performer: rec.performer, customerType: rec.customerType }), at, now);

      // 成交 → deals + dealt 事件 + 贡献者（含退款：closedAmount<0 记为 kind='refund'，扣减营业额但不改变客户阶段）
      const amount = Number(rec.closedAmount || 0) || 0;
      if (rec.isClosed === '是' && amount !== 0) {
        const dealId = 'deal_visit_' + rec.id;
        const project = rec.remark ? String(rec.remark).split('\n')[0].slice(0, 40) : (amount < 0 ? '退款' : '复购/操作');
        let dealKind;
        if (amount < 0) {
          dealKind = 'refund';
        } else {
          // 判断是否复购：该客户已有成单则记 repurchase
          const hasDeal = db.prepare("SELECT COUNT(*) c FROM shijing_deals WHERE external_userid=? AND kind IN ('first_deal','repurchase')").get(ext).c;
          dealKind = hasDeal > 0 ? 'repurchase' : 'first_deal';
        }
        db.prepare(`INSERT OR REPLACE INTO shijing_deals
          (id, external_userid, kind, project, amount, performer, store_id, dealt_at, source_table, source_id, created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
          dealId, ext, dealKind, project, amount, rec.performer || '', rec.teamId || '', at, 'shijing_store', rec.id, now);
        db.prepare(`INSERT OR REPLACE INTO shijing_customer_events
          (id, external_userid, type, actor, source_table, source_id, payload, occurred_at, created_at)
          VALUES (?,?,?,?,?,?,?,?,?)`).run(
          'ev_deal_' + rec.id, ext, dealKind === 'refund' ? 'refund' : (dealKind === 'repurchase' ? 'repurchase' : 'dealt'), rec.performer || rec.teamId || '',
          'shijing_store', rec.id, JSON.stringify({ amount, performer: rec.performer, project }), at, now);
        // 贡献者：门店服务人 + 归属客服（退款不记贡献，只扣减金额）
        if (dealKind !== 'refund') {
          if (rec.performer) {
            db.prepare('INSERT OR REPLACE INTO shijing_deal_contributors (id, deal_id, contributor, role, created_at) VALUES (?,?,?,?,?)')
              .run('dc_' + dealId + '_store', dealId, rec.performer, dealKind === 'repurchase' ? 'repurchase' : 'store_deal', now);
          }
          const cust = db.prepare('SELECT follow_userid FROM shijing_wecom_customers WHERE external_userid=?').get(ext);
          if (cust && cust.follow_userid) {
            const s = db.prepare('SELECT name FROM shijing_staff WHERE wecomUserid=?').get(cust.follow_userid);
            db.prepare('INSERT OR REPLACE INTO shijing_deal_contributors (id, deal_id, contributor, role, created_at) VALUES (?,?,?,?,?)')
              .run('dc_' + dealId + '_cs', dealId, (s && s.name) || cust.follow_userid, 'cs_lead', now);
          }
          // 升级客户阶段
          db.prepare("UPDATE shijing_wecom_customers SET stage=? WHERE external_userid=?").run(dealKind === 'repurchase' ? 'repurchase' : 'dealt', ext);
        }
      } else {
        // 仅到店未成交：阶段至少 arrived
        db.prepare("UPDATE shijing_wecom_customers SET stage='arrived' WHERE external_userid=? AND stage IN ('lead','deposit','scheduled')").run(ext);
      }
    } catch (e) { /* 同步失败不影响主流程 */ console.error('[syncToHub]', e && e.message); }
  }
  const fmtLocalDate = deps.fmtLocalDate || (d => { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });

  // 照片存储目录（复用 uploads 下的子目录）
  const PHOTO_DIR = path.join(__dirname, 'uploads', 'customer');
  try { if (!fs.existsSync(PHOTO_DIR)) fs.mkdirSync(PHOTO_DIR, { recursive: true }); } catch (e) {}
  let multer = null; try { multer = require('multer'); } catch (e) {}

  // ========== 企微实时查询（用于"搜微信号"实时拉取，5分钟前加的也能搜到）==========
  function qyGet(p) {
    return new Promise((resolve, reject) => {
      https.get({ hostname: 'qyapi.weixin.qq.com', path: p, timeout: 12000 }, r => {
        let b = ''; r.on('data', c => b += c); r.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(b); } });
      }).on('error', reject).on('timeout', function () { this.destroy(); reject(new Error('timeout')); });
    });
  }
  function qyPost(p, body) {
    return new Promise((resolve, reject) => {
      const d = JSON.stringify(body);
      const req = https.request({ hostname: 'qyapi.weixin.qq.com', path: p, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) }, timeout: 12000 },
        r => { let b = ''; r.on('data', c => b += c); r.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(b); } }); });
      req.on('error', reject); req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.write(d); req.end();
    });
  }
  let _qyTok = { token: null, exp: 0 };
  async function qyToken() {
    const w = ((getConfig && getConfig()) || {}).wecom || {};
    if (!w.corpId || !w.contactSecret) throw new Error('wecom not configured');
    if (_qyTok.token && Date.now() < _qyTok.exp) return _qyTok.token;
    const t = await qyGet('/cgi-bin/gettoken?corpid=' + w.corpId + '&corpsecret=' + w.contactSecret);
    if (!t.access_token) throw new Error('gettoken failed');
    _qyTok = { token: t.access_token, exp: Date.now() + (t.expires_in - 300) * 1000 };
    return t.access_token;
  }
  // 实时拉某成员名下客户（轻量字段，给搜索用）；带 30 秒结果缓存避免频繁打接口
  const _liveCache = {}; // userid -> {at, list}
  async function liveCustomersOf(userid) {
    const c = _liveCache[userid];
    if (c && Date.now() - c.at < 30000) return c.list;
    const tk = await qyToken();
    const out = [];
    let cursor = '';
    do {
      const r = await qyPost('/cgi-bin/externalcontact/batch/get_by_user?access_token=' + tk, { userid_list: [userid], cursor, limit: 100 });
      if (r.errcode) break;
      for (const item of (r.external_contact_list || [])) {
        const ec = item.external_contact || {}; const fi = item.follow_info || {};
        out.push({ external_userid: ec.external_userid, name: ec.name || '', avatar: ec.avatar || '', follow_userid: userid, add_time: fi.createtime || 0, remark: fi.remark || '' });
      }
      cursor = r.next_cursor || '';
    } while (cursor);
    _liveCache[userid] = { at: Date.now(), list: out };
    return out;
  }

  // ============================================================
  // 0. 独立表：邀约-企微绑定 + 客户照片
  // ============================================================
  db.exec(`CREATE TABLE IF NOT EXISTS shijing_customer_bind (
    phone TEXT PRIMARY KEY,
    external_userid TEXT,
    nickname TEXT,
    boundBy TEXT,
    boundAt INTEGER
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS shijing_customer_photo (
    id TEXT PRIMARY KEY,
    phone TEXT,
    stage TEXT,            -- 节点:arrive_1/operate_1 等(第几次到店的前/后)
    url TEXT,              -- OSS 链接
    note TEXT,
    uploadedBy TEXT,
    createdAt INTEGER
  )`);

  // ============================================================
  // 1. 工具
  // ============================================================
  const norm = s => String(s == null ? '' : s).trim();
  const phoneKey = p => norm(p).replace(/\s|-/g, '');
  const num = n => +n || 0;

  function loadColl(c) {
    return db.prepare(`SELECT data FROM shijing_${c} WHERE deleted=0`).all()
      .map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
  }

  // 团队名映射
  function teamNameMap() {
    const cfg = (getConfig && getConfig()) || {};
    return cfg.teams || {};
  }

  // ============================================================
  // 2. 核心：把所有数据按客户归拢
  //    客户键 = 手机号(优先) || 'name:'+姓名(无手机号时)
  // ============================================================
  function buildCustomers() {
    const invites = loadColl('invite');
    const stores = loadColl('store');
    const teams = teamNameMap();
    const binds = db.prepare(`SELECT * FROM shijing_customer_bind`).all();
    const bindByPhone = {}; binds.forEach(b => { bindByPhone[phoneKey(b.phone)] = b; });

    const map = {}; // key -> customer

    function keyOf(phone, name) {
      const p = phoneKey(phone);
      if (p && p.length >= 7) return 'p:' + p;
      const n = norm(name);
      return n ? 'n:' + n : null;
    }
    function ensure(key, phone, name) {
      if (!map[key]) {
        map[key] = {
          key, phone: phoneKey(phone) || '', name: norm(name) || '',
          firstSeen: null, lastSeen: null,
          csTeams: new Set(), storeTeams: new Set(),
          inviteCount: 0, arriveCount: 0, dealCount: 0,
          ltv: 0, events: [],
          nickname: '', external_userid: '',
        };
      }
      return map[key];
    }

    // 邀约（旅程起点：客服→门店）
    for (const iv of invites) {
      const key = keyOf(iv.phone, iv.customerName);
      if (!key) continue;
      const c = ensure(key, iv.phone, iv.customerName);
      if (!c.name && iv.customerName) c.name = norm(iv.customerName);
      if (!c.phone && phoneKey(iv.phone)) c.phone = phoneKey(iv.phone);
      c.inviteCount++;
      if (iv.csTeamId) c.csTeams.add(iv.csTeamId);
      if (iv.storeTeamId) c.storeTeams.add(iv.storeTeamId);
      // 客服邀约时填的微信号/昵称 → 客户档案(门店也能看到)
      if (iv.wechatNickname && !c.nickname) c.nickname = norm(iv.wechatNickname);
      if (iv.external_userid && !c.external_userid) c.external_userid = iv.external_userid;
      const t = iv.createdAt || (iv.arriveTime ? new Date(iv.arriveTime).getTime() : 0);
      c.events.push({
        type: 'invite', time: t,
        date: (iv.arriveTime || '').slice(0, 10) || fmtLocalDate(new Date(t)),
        title: '客服邀约',
        detail: `${(teams[iv.csTeamId] && teams[iv.csTeamId].name) || iv.csTeamName || iv.csTeamId || ''} → ${(teams[iv.storeTeamId] && teams[iv.storeTeamId].name) || iv.storeTeamId || ''}`,
        status: iv.status, remark: iv.remark || '',
        csTeamId: iv.csTeamId || '', storeTeamId: iv.storeTeamId || '',
      });
    }

    // 门店到店/成交
    for (const st of stores) {
      const key = keyOf(st.phone, st.customerName);
      if (!key) continue;
      const c = ensure(key, st.phone, st.customerName);
      if (!c.name && st.customerName) c.name = norm(st.customerName);
      if (!c.phone && phoneKey(st.phone)) c.phone = phoneKey(st.phone);
      c.arriveCount++;
      if (st.teamId) c.storeTeams.add(st.teamId);
      const rev = num(st.opAmount) + num(st.closedAmount) || num(st.amount);
      if (st.isClosed === '是' || rev > 0) c.dealCount++;
      c.ltv += rev;
      const t = st.createdAt || (st.arriveTime ? new Date(st.arriveTime).getTime() : 0);
      c.events.push({
        type: 'store', time: t,
        date: st.date || (st.arriveTime || '').slice(0, 10) || fmtLocalDate(new Date(t)),
        title: (st.customerType || '') + '到店' + (st.isClosed === '是' ? ' · 成交' : ''),
        detail: `${(teams[st.teamId] && teams[st.teamId].name) || st.teamId || ''}` + (rev > 0 ? ` · ¥${rev.toLocaleString('zh-CN')}` : '') + (st.performer ? ` · ${st.performer}` : ''),
        remark: (st.remark || '').split('\n')[0] || '',
        photos: Array.isArray(st.photos) ? st.photos : [],
        storeTeamId: st.teamId || '', revenue: rev || 0, isDeal: st.isClosed === '是' || rev > 0,
      });
    }

    // 收尾：Set→数组、时间线排序、补企微绑定、统计首末次
    const list = Object.values(map).map(c => {
      c.csTeams = [...c.csTeams]; c.storeTeams = [...c.storeTeams];
      c.events.sort((a, b) => (a.time || 0) - (b.time || 0));
      const times = c.events.map(e => e.time).filter(Boolean);
      c.firstSeen = times.length ? Math.min(...times) : 0;
      c.lastSeen = times.length ? Math.max(...times) : 0;
      const bd = bindByPhone[c.phone];
      if (bd) { // bind 表优先（最权威），否则保留 invite 里填的
        if (bd.nickname) c.nickname = bd.nickname;
        if (bd.external_userid) c.external_userid = bd.external_userid;
      }
      c.ltv = Math.round(c.ltv);
      return c;
    });
    return list;
  }

  // 轻量缓存（60 秒），避免每次全量重算
  let _cache = { at: 0, list: null };
  function getCustomers() {
    if (_cache.list && Date.now() - _cache.at < 60000) return _cache.list;
    const list = buildCustomers();
    _cache = { at: Date.now(), list };
    return list;
  }
  function visibleFromOf(user) {
    return user && user.role !== 'hq' && /^\d{4}-\d{2}-\d{2}$/.test(String(user.dataVisibleFrom || ''))
      ? String(user.dataVisibleFrom)
      : '';
  }
  function visibleStartTs(user) {
    const from = visibleFromOf(user);
    if (!from) return 0;
    return new Date(from + 'T00:00:00').getTime();
  }
  function projectCustomerForUser(c, user) {
    const from = visibleFromOf(user);
    if (!from) return c;
    const events = (c.events || []).filter(e => String(e.date || '').slice(0, 10) >= from);
    if (!events.length) return null;
    const csTeams = new Set();
    const storeTeams = new Set();
    let inviteCount = 0, arriveCount = 0, dealCount = 0, ltv = 0;
    for (const e of events) {
      if (e.csTeamId) csTeams.add(e.csTeamId);
      if (e.storeTeamId) storeTeams.add(e.storeTeamId);
      if (e.type === 'invite') inviteCount += 1;
      if (e.type === 'store') {
        arriveCount += 1;
        ltv += +e.revenue || 0;
        if (e.isDeal) dealCount += 1;
      }
    }
    const times = events.map(e => e.time).filter(Boolean);
    return {
      ...c,
      events,
      csTeams: [...csTeams],
      storeTeams: [...storeTeams],
      inviteCount,
      arriveCount,
      dealCount,
      ltv: Math.round(ltv),
      firstSeen: times.length ? Math.min(...times) : 0,
      lastSeen: times.length ? Math.max(...times) : 0,
    };
  }
  function visibleCustomersForUser(user) {
    return getCustomers().map(c => projectCustomerForUser(c, user)).filter(Boolean);
  }

  // ============================================================
  // 3. 接口
  // ============================================================
  // 客户列表/搜索：手机号/昵称/姓名都能搜
  app.get('/api/customer/search', v6Required, (req, res) => {
    try {
      const q = norm(req.query.q).toLowerCase();
      const limit = Math.min(parseInt(req.query.limit) || 30, 100);
      let list = visibleCustomersForUser(req.v6User);
      if (q) {
        list = list.filter(c =>
          (c.name && c.name.toLowerCase().includes(q)) ||
          (c.phone && c.phone.includes(q)) ||
          (c.nickname && c.nickname.toLowerCase().includes(q))
        );
      }
      // 按最近活跃排序
      list.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
      const total = list.length;
      const teams = teamNameMap();
      const out = list.slice(0, limit).map(c => ({
        key: c.key, name: c.name, phone: c.phone, nickname: c.nickname,
        arriveCount: c.arriveCount, dealCount: c.dealCount, ltv: c.ltv,
        lastSeen: c.lastSeen,
        storeTeams: c.storeTeams.map(t => (teams[t] && teams[t].name) || t),
      }));
      res.json({ ok: true, total, customers: out });
    } catch (e) { res.json({ ok: false, error: e.message || String(e) }); }
  });

  // 客户详情（完整旅程）
  app.get('/api/customer/detail', v6Required, (req, res) => {
    try {
      const key = req.query.key;
      const c = visibleCustomersForUser(req.v6User).find(x => x.key === key);
      if (!c) return res.json({ ok: false, error: 'not found' });
      const teams = teamNameMap();
      const photos = db.prepare(`SELECT * FROM shijing_customer_photo WHERE phone=? ORDER BY createdAt`).all(c.phone || '__none__');
      res.json({
        ok: true,
        customer: {
          name: c.name, phone: c.phone, nickname: c.nickname, external_userid: c.external_userid,
          inviteCount: c.inviteCount, arriveCount: c.arriveCount, dealCount: c.dealCount, ltv: c.ltv,
          firstSeen: c.firstSeen, lastSeen: c.lastSeen,
          csTeams: c.csTeams.map(t => (teams[t] && teams[t].name) || t),
          storeTeams: c.storeTeams.map(t => (teams[t] && teams[t].name) || t),
          events: c.events,
          photos,
        },
      });
    } catch (e) { res.json({ ok: false, error: e.message || String(e) }); }
  });

  // 概览统计
  app.get('/api/customer/stats', v6Required, (req, res) => {
    try {
      const list = visibleCustomersForUser(req.v6User);
      const total = list.length;
      const dealt = list.filter(c => c.dealCount > 0).length;
      const repeat = list.filter(c => c.arriveCount > 1).length;
      const totalLtv = list.reduce((s, c) => s + c.ltv, 0);
      res.json({ ok: true, total, dealt, repeat, totalLtv: Math.round(totalLtv) });
    } catch (e) { res.json({ ok: false, error: e.message || String(e) }); }
  });

  // 企微客户搜索（给邀约页"选客户"用：实时查企微，5分钟前刚加的也能搜到；本地库兜底）
  app.get('/api/customer/wecom-search', v6Required, async (req, res) => {
    try {
      const q = norm(req.query.q);
      const limit = Math.min(parseInt(req.query.limit) || 20, 50);
      const user = req.v6User;
      // 当前登录客服(按团队)映射到该团队所有已绑企微成员
      let wecomUserids = [];
      try {
        const staffRows = db.prepare(`SELECT wecomUserid FROM shijing_staff WHERE role='cs' AND active=1 AND wecomUserid IS NOT NULL AND teamId=?`).all(user.teamId || '');
        wecomUserids = staffRows.map(s => s.wecomUserid).filter(Boolean);
      } catch (e) {}
      if (!wecomUserids.length) return res.json({ ok: true, mapped: false, customers: [] });

      // 先尝试实时查企微（5分钟前加的能搜到）；失败则回退本地库
      let merged = [];
      let live = false;
      try {
        const lists = await Promise.all(wecomUserids.map(u => liveCustomersOf(u).catch(() => [])));
        merged = [].concat(...lists);
        live = merged.length > 0;
      } catch (e) {}

      if (live) {
        let arr = merged;
        const fromTs = visibleStartTs(user);
        if (fromTs) arr = arr.filter(c => ((+c.add_time || 0) * 1000) >= fromTs);
        if (q) arr = arr.filter(c => (c.name && c.name.includes(q)) || (c.remark && c.remark.includes(q)));
        arr.sort((a, b) => (b.add_time || 0) - (a.add_time || 0));
        return res.json({ ok: true, mapped: true, live: true, customers: arr.slice(0, limit) });
      }

      // 回退本地库
      const ph = wecomUserids.map(() => '?').join(',');
      let sql = `SELECT external_userid,name,avatar,follow_userid,add_time,remark FROM shijing_wecom_customers WHERE lost=0 AND follow_userid IN (${ph})`;
      const args = [...wecomUserids];
      const fromTs = visibleStartTs(user);
      if (fromTs) { sql += ` AND add_time >= ?`; args.push(Math.floor(fromTs / 1000)); }
      if (q) { sql += ` AND (name LIKE ? OR remark LIKE ?)`; args.push('%' + q + '%', '%' + q + '%'); }
      sql += ` ORDER BY add_time DESC LIMIT ?`; args.push(limit);
      const rows = db.prepare(sql).all(...args);
      res.json({ ok: true, mapped: true, live: false, customers: rows });
    } catch (e) { res.json({ ok: false, error: e.message || String(e) }); }
  });

  // 绑定：把手机号和企微客户绑定（邀约提交时调用）
  app.post('/api/customer/bind', v6Required, (req, res) => {
    try {
      const { phone, external_userid, nickname } = req.body || {};
      if (!phone || !external_userid) return res.json({ ok: false, error: 'missing phone or external_userid' });
      db.prepare(`INSERT INTO shijing_customer_bind(phone,external_userid,nickname,boundBy,boundAt)
        VALUES(?,?,?,?,?) ON CONFLICT(phone) DO UPDATE SET external_userid=excluded.external_userid,
        nickname=excluded.nickname, boundBy=excluded.boundBy, boundAt=excluded.boundAt`)
        .run(phoneKey(phone), external_userid, nickname || '', (req.v6User && req.v6User.realName) || '', Date.now());
      _cache.at = 0; // 失效缓存
      res.json({ ok: true });
    } catch (e) { res.json({ ok: false, error: e.message || String(e) }); }
  });

  // ============================================================
  // 4b. 门店「客户中心」专用接口（store 角色，按本店过滤）
  // ============================================================
  // 当前用户能看的门店 teamId 列表：store 只看自己，hq 看全部
  function visibleStoreTeams(user) {
    if (!user) return [];
    if (user.role === 'hq') return null; // null = 全部
    if (user.role === 'store') return [user.teamId];
    return [user.teamId];
  }

  // 门店本店客户列表（基于已归拢客户，按 storeTeams 过滤）
  app.get('/api/customer/store-list', v6Required, (req, res) => {
    try {
      const user = req.v6User;
      const allow = visibleStoreTeams(user); // null=全部 或 [teamId]
      const q = norm(req.query.q).toLowerCase();
      let list = visibleCustomersForUser(user);
      if (allow) list = list.filter(c => c.storeTeams.some(t => allow.includes(t)));
      if (q) list = list.filter(c =>
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.phone && c.phone.includes(q)) ||
        (c.nickname && c.nickname.toLowerCase().includes(q)));
      list.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
      const teams = teamNameMap();
      const total = list.length;
      // 分页：page 从 1 开始，size 默认 20（最大 100）。兼容旧 limit 参数。
      const size = Math.min(parseInt(req.query.size) || parseInt(req.query.limit) || 20, 100);
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const offset = (page - 1) * size;
      const out = list.slice(offset, offset + size).map(c => ({
        key: c.key, name: c.name, phone: c.phone, nickname: c.nickname,
        arriveCount: c.arriveCount, dealCount: c.dealCount, ltv: c.ltv, lastSeen: c.lastSeen,
        storeTeams: c.storeTeams.map(t => (teams[t] && teams[t].name) || t),
      }));
      res.json({ ok: true, total, page, size, totalPage: Math.max(Math.ceil(total / size), 1), customers: out });
    } catch (e) { res.json({ ok: false, error: e.message || String(e) }); }
  });

  // 新建客户（转介绍兜底）：建首条到店记录到 store 表
  app.post('/api/customer/store-create', v6Required, (req, res) => {
    try {
      const user = req.v6User;
      const teamId = (user.role === 'store') ? user.teamId : (req.body.teamId || user.teamId);
      const b = req.body || {};
      if (!norm(b.name)) return res.json({ ok: false, error: '请填写客户姓名' });
      const rec = {
        id: 'cust_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        teamId, date: b.date || fmtLocalDate(new Date()),
        customerName: norm(b.name), phone: phoneKey(b.phone),
        arriveTime: b.arriveTime || (fmtLocalDate(new Date()) + 'T' + new Date().toTimeString().slice(0, 5)),
        customerType: b.customerType || '新客',
        isOperated: b.isOperated || '否', opAmount: num(b.opAmount),
        isClosed: b.isClosed || '否', closedAmount: num(b.closedAmount),
        performer: norm(b.performer), remark: norm(b.remark),
        amount: num(b.opAmount) + num(b.closedAmount),
        photos: Array.isArray(b.photos) ? b.photos.slice(0, 12) : [],
        source: '客户中心-新建', createdAt: Date.now(),
        lastEditBy: user.realName || '', lastEditAt: new Date().toISOString(),
      };
      db.prepare(`INSERT INTO shijing_store(id, data) VALUES(?, ?)`).run(rec.id, JSON.stringify(rec));
      _cache.at = 0;
      res.json({ ok: true, id: rec.id });
    } catch (e) { res.json({ ok: false, error: e.message || String(e) }); }
  });

  // 追加一次到店（老客复购/再次到店）：往 store 表加一条，挂同一手机号/姓名
  app.post('/api/customer/store-visit', v6Required, (req, res) => {
    try {
      const user = req.v6User;
      const teamId = (user.role === 'store') ? user.teamId : (req.body.teamId || user.teamId);
      const b = req.body || {};
      const name = norm(b.name), phone = phoneKey(b.phone);
      if (!name && !phone) return res.json({ ok: false, error: '缺少客户标识' });
      const rec = {
        id: 'visit_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        teamId, date: b.date || fmtLocalDate(new Date()),
        customerName: name, phone,
        arriveTime: b.arriveTime || (fmtLocalDate(new Date()) + 'T' + new Date().toTimeString().slice(0, 5)),
        customerType: b.customerType || '老客',
        isOperated: b.isOperated || '否', opAmount: num(b.opAmount),
        isClosed: b.isClosed || '否', closedAmount: num(b.closedAmount),
        performer: norm(b.performer), remark: norm(b.remark),
        amount: num(b.opAmount) + num(b.closedAmount),
        photos: Array.isArray(b.photos) ? b.photos.slice(0, 12) : [],
        source: '客户中心-追加到店', createdAt: Date.now(),
        lastEditBy: user.realName || '', lastEditAt: new Date().toISOString(),
      };
      db.prepare(`INSERT INTO shijing_store(id, data) VALUES(?, ?)`).run(rec.id, JSON.stringify(rec));
      _cache.at = 0;
      syncToHub(rec, 'visit'); // ★ 同步到客户中心(事件流/成交/贡献者/复购)
      res.json({ ok: true, id: rec.id });
    } catch (e) { res.json({ ok: false, error: e.message || String(e) }); }
  });

  // 再次邀约（老客复购，预约下次到店）：写 invite 表，资料自动带出
  app.post('/api/customer/store-reinvite', v6Required, (req, res) => {
    try {
      const user = req.v6User;
      const storeTeamId = (user.role === 'store') ? user.teamId : (req.body.storeTeamId || user.teamId);
      const b = req.body || {};
      const name = norm(b.name), phone = phoneKey(b.phone);
      if (!name && !phone) return res.json({ ok: false, error: '缺少客户标识' });
      if (!b.arriveTime) return res.json({ ok: false, error: '请选择预约到店时间' });
      const rec = {
        id: 'reinv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        csTeamId: '', csTeamName: '门店复购邀约',
        storeTeamId, customerName: name, phone,
        arriveTime: b.arriveTime, customerType: b.customerType || 'new', source: b.source || '门店复购邀约', remark: norm(b.remark) || '老客复购',
        status: 'pending', notified: false,
        source: '客户中心-再次邀约', createdAt: Date.now(),
      };

      // ===== 门店排客容量校验（共用容量池）=====
      try {
        const cfg = getConfig() || {};
        const teams = cfg.teams || {};
        const team = teams[storeTeamId];
        if (!team) {
          return res.json({ ok: false, error: "门店不存在" });
        }

        const maxPerSlot = team.maxPerSlot || 1;
        const slotConfig = team.slotConfig || { newCustomerMinutes: 60, oldCustomerMinutes: 30 };
        const customerType = b.customerType || "new";
        const newDuration = customerType === "new" ? slotConfig.newCustomerMinutes : slotConfig.oldCustomerMinutes;

        // 计算新预约的时间区间
        const dateStr = String(b.arriveTime).slice(0, 10);
        const newStart = parseTimeToMinutes(b.arriveTime);
        const newEnd = newStart + newDuration;

        // 获取同一天的已有pending记录（客服+门店共用容量池）
        const rows = db.prepare("SELECT id, data FROM shijing_invite WHERE deleted=0 AND id != ?").all(rec.id);
        const intervals = [];
        for (const r of rows) {
          const inv = JSON.parse(r.data);
          if (inv.status === "pending" && inv.storeTeamId === storeTeamId && String(inv.arriveTime).slice(0, 10) === dateStr) {
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
        console.error("[store-reinvite-slot-check] error:", e);
        // 校验失败时继续执行（降级策略）
      }

      db.prepare(`INSERT INTO shijing_invite(id, data) VALUES(?, ?)`).run(rec.id, JSON.stringify(rec));
      _cache.at = 0;
      syncToHub(rec, 'reinvite'); // ★ 同步到客户中心(复购排期事件)
      res.json({ ok: true, id: rec.id });
    } catch (e) { res.json({ ok: false, error: e.message || String(e) }); }
  });

  // ============================================================
  // 4d. 客服全链路看板（加粉→定金→到店→删粉 + 转化率；营业额仅 hq）
  //     权限：hq 看全员含营业额；cs 只看自己团队的转化率，营业额字段被剥离
  // ============================================================
  app.get('/api/customer/staff-funnel', v6Required, (req, res) => {
    try {
      const user = req.v6User;
      const isHQ = user.role === 'hq';
      const days = Math.min(parseInt(req.query.days) || 30, 90);
      const from = visibleFromOf(user);
      const dates = [];
      for (let i = 0; i < days; i++) {
        const d = fmtLocalDate(new Date(Date.now() - i * 86400000));
        if (!from || d >= from) dates.push(d);
      }
      const dateSet = new Set(dates);

      // 客服个人（staff 表）
      let staff = db.prepare(`SELECT * FROM shijing_staff WHERE role='cs' AND active=1`).all();
      // 非 hq：只看自己团队
      if (!isHQ) staff = staff.filter(s => s.teamId === user.teamId);

      const cfg = (getConfig && getConfig()) || {};
      const teams = cfg.teams || {};
      const customers = visibleCustomersForUser(user);

      // 各企微成员加粉数（窗口内）+ 删粉数
      const fansRows = db.prepare(`SELECT wecomUserid, date, addCount FROM shijing_wecom_fans`).all();
      const addByUser = {}; // wecomUserid -> count
      for (const r of fansRows) { if (dateSet.has(r.date)) addByUser[r.wecomUserid] = (addByUser[r.wecomUserid] || 0) + (r.addCount || 0); }
      // 删粉（客户删客服）：来自企微事件回调记录表 shijing_wecom_del_events（窗口内）
      // 注意：企微只能从配置回调起往后实时记录，无法回溯历史。
      // lostTracked 标志：必须"配了回调 Token" 才算已接入（空表+没配 Token = 待接入，避免误显示 0%）。
      const lostByUser = {};
      const wcfg = (cfg.wecom) || {};
      const lostTracked = !!(wcfg.callbackToken && wcfg.callbackAesKey); // 配了回调凭证才算接入
      if (lostTracked) {
        try {
          const delRows = db.prepare(`SELECT follow_userid, date FROM shijing_wecom_del_events`).all();
          for (const r of delRows) { if (dateSet.has(r.date)) lostByUser[r.follow_userid] = (lostByUser[r.follow_userid] || 0) + 1; }
        } catch (e) {}
      }

      // 定金/到店/营业额：按客服团队从 cs 表 + 客户档案归集
      // cs 表(团队级) 定金数
      const csRows = db.prepare(`SELECT data FROM shijing_cs WHERE deleted=0`).all().map(r => JSON.parse(r.data));
      const depositByTeam = {};
      for (const r of csRows) { if (dateSet.has(r.date)) depositByTeam[r.teamId] = (depositByTeam[r.teamId] || 0) + (+r.depositCount || 0); }

      // 到店数 + 营业额：客户档案里 csTeams 含该团队的客户的到店/成交（窗口内）
      // 简化：按团队聚合（个人级归因需邀约带 csUserId，后续可细化）
      const arriveByTeam = {}, revByTeam = {};
      for (const c of customers) {
        for (const e of c.events) {
          if (e.type !== 'store') continue;
          if (!dateSet.has(e.date)) continue;
          // 该到店客户归属的客服团队
          for (const ct of c.csTeams) {
            arriveByTeam[ct] = (arriveByTeam[ct] || 0) + 1;
          }
          // 2026-07-15 修复：营业额此前用 c.ltv（客户全生命周期累计营业额，与 days 窗口无关），
          // 导致无论选7天/30天，营业额都是同一个"全历史总额"，和到店数/加粉数窗口完全不匹配。
          // 现改为只累加窗口内(dateSet)这条到店事件自身的 revenue，与 arriveByTeam 口径统一。
          for (const ct of c.csTeams) {
            revByTeam[ct] = (revByTeam[ct] || 0) + (+e.revenue || 0);
          }
        }
      }

      // 组装：按团队聚合该团队所有客服个人的加粉/删粉，定金/到店/营业额取团队级
      const byTeam = {};
      for (const s of staff) {
        const t = s.teamId;
        byTeam[t] = byTeam[t] || { teamId: t, teamName: (teams[t] && teams[t].name) || t, members: [], addFans: 0, lost: 0 };
        const add = addByUser[s.wecomUserid] || 0;
        const lost = lostByUser[s.wecomUserid] || 0;
        byTeam[t].addFans += add; byTeam[t].lost += lost;
        byTeam[t].members.push({ name: s.name, wecomUserid: s.wecomUserid, addFans: add, lost });
      }

      const pct = (a, b) => (!b ? 0 : Math.round(a / b * 1000) / 10);
      const out = Object.values(byTeam).map(t => {
        const deposit = depositByTeam[t.teamId] || 0;
        const arrive = arriveByTeam[t.teamId] || 0;
        const row = {
          teamId: t.teamId, teamName: t.teamName, members: t.members,
          addFans: t.addFans, lost: t.lost, deposit, arrive,
          lostRate: pct(t.lost, t.addFans),       // 删粉率 = 删粉/加粉（需回调接入后才真实）
          depositRate: pct(deposit, t.addFans),   // 定金率 = 定金/加粉
          arriveRate: pct(arrive, deposit),       // 定金到店率 = 到店/定金
        };
        if (isHQ) row.revenue = Math.round(revByTeam[t.teamId] || 0); // 营业额仅 hq
        return row;
      });

      res.json({ ok: true, isHQ, days, teams: out, lostTracked });
    } catch (e) { res.json({ ok: false, error: e.message || String(e) }); }
  });

  // ============================================================
  // 4c. 照片上传（前端已压缩，存服务器 uploads/customer/，返回 url）
  // ============================================================
  if (multer) {
    const storage = multer.diskStorage({
      destination: (req, file, cb) => cb(null, PHOTO_DIR),
      filename: (req, file, cb) => {
        const ext = (path.extname(file.originalname || '').toLowerCase()) || '.jpg';
        cb(null, Date.now() + '_' + crypto.randomBytes(6).toString('hex') + ext);
      },
    });
    const upload = multer({
      storage,
      limits: { fileSize: 8 * 1024 * 1024 }, // 前端已压缩，单张上限 8MB 兜底
      fileFilter: (req, file, cb) => cb(/^image\//.test(file.mimetype) ? null : new Error('only image'), /^image\//.test(file.mimetype)),
    });
    // 多图上传，返回 url 数组（前端拿到后随到店记录一起提交）
    app.post('/api/customer/photo-upload', v6Required, upload.array('photos', 12), (req, res) => {
      try {
        const files = req.files || [];
        const urls = files.map(f => '/uploads/customer/' + f.filename);
        res.json({ ok: true, urls });
      } catch (e) { res.json({ ok: false, error: e.message || String(e) }); }
    });
  } else {
    app.post('/api/customer/photo-upload', v6Required, (req, res) => res.json({ ok: false, error: 'multer not installed' }));
  }

  console.log('[v6-customer] mounted: /api/customer/{search,detail,stats,wecom-search,bind,store-list,store-create,store-visit,store-reinvite,photo-upload,staff-funnel}');
};
