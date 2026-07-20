/**
 * V6 企业微信客户同步模块（插件式零侵入）
 * ------------------------------------------------------------
 * 目标（第一优先级）：用企微客观数据核对客服自填加粉，细到「客服个人」。
 *
 * 设计：
 *   - 独立文件，server.js 仅 require 一次挂载，try/catch 包裹，零侵入
 *   - 新表 3 张，全部独立，不动任何业务表：
 *       shijing_staff       客服个人（xm1/xm2/CS1...），含 wecomUserid 映射
 *       shijing_wecom_fans  每个企微成员每天客观加粉数 + 来源分布（落库快照）
 *       shijing_wecom_customers  客户主档（external_userid 唯一），为后续客户实体打底
 *   - 凭证读 config.wecom = { corpId, contactSecret, agentId }
 *   - token 内存缓存 + 提前 5 分钟过期重取
 *   - cron 每天同步昨天/全量；也提供手动接口
 *
 * 依赖注入（server.js 提供）：getConfig, fmtLocalDate, v6Required, v6HQRequired
 * ------------------------------------------------------------
 */
'use strict';
const https = require('https');
const crypto = require('crypto');
let _lookupLdyadPlatform = null;
try { _lookupLdyadPlatform = require('./v6-wecom-ldyad-bridge').lookupLdyadPlatform; } catch (e) { console.error('[wecom] 落地页归因桥接模块加载失败(不影响其他功能):', e.message); }

module.exports = function (app, db, deps) {
  deps = deps || {};
  const getConfig = deps.getConfig;
  const v6Required = deps.v6Required || ((req, res, next) => next());
  const v6HQRequired = deps.v6HQRequired || ((req, res, next) => next());
  const fmtLocalDate = deps.fmtLocalDate || function (d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };

  // ============================================================
  // 0. 建表（独立，不碰业务表）
  // ============================================================
  db.exec(`CREATE TABLE IF NOT EXISTS shijing_staff (
    id TEXT PRIMARY KEY,            -- 客服个人ID，如 xm1 / xm2 / CS1
    name TEXT,                      -- 显示名（真实姓名）
    teamId TEXT,                    -- 归属团队 cs_1 / cs_2 ...
    role TEXT DEFAULT 'cs',         -- cs / store / hq
    wecomUserid TEXT,               -- 对应企微成员 userid（如 JianFen）
    active INTEGER DEFAULT 1,
    createdAt INTEGER,
    updatedAt INTEGER
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS shijing_wecom_fans (
    wecomUserid TEXT,               -- 企微成员
    date TEXT,                      -- 加好友日期 YYYY-MM-DD
    addCount INTEGER DEFAULT 0,     -- 当天客观新增客户数
    ways TEXT,                      -- 来源分布 JSON {渠道:数量}
    syncedAt INTEGER,
    PRIMARY KEY (wecomUserid, date)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS shijing_wecom_customers (
    external_userid TEXT PRIMARY KEY,
    name TEXT,                      -- 客户昵称
    avatar TEXT,
    type INTEGER,                   -- 1=微信 2=企微
    follow_userid TEXT,             -- 归属成员
    add_time INTEGER,               -- 加好友时间戳
    add_way INTEGER,                -- 来源代码
    remark TEXT,
    tags TEXT,                      -- 标签 JSON
    lost INTEGER DEFAULT 0,         -- 是否已流失（删除）
    updatedAt INTEGER
  )`);

  // 删粉事件表（企微回调 del_external_contact 实时写入；表存在=已接入回调）
  db.exec(`CREATE TABLE IF NOT EXISTS shijing_wecom_del_events (
    id TEXT PRIMARY KEY,            -- 去重ID：external_userid + follow_userid + 事件时间
    external_userid TEXT,           -- 删人的客户
    follow_userid TEXT,             -- 被删的客服（企微成员）
    del_type TEXT,                  -- del_external_contact(客户删客服) / del_follow_user(客服删客户)
    event_time INTEGER,             -- 事件时间戳（秒）
    date TEXT,                      -- 事件日期 YYYY-MM-DD
    createdAt INTEGER
  )`);

  // 首次：写入已确认的客服个人映射（幂等）
  // id 用登录 username 作稳定锚点；name 用中文真名（与 shijing_users.realName 一致）
  const seedStaff = [
    { id: 'xiehaobin',  name: '谢昊斌-丽娜', teamId: 'cs_1', wecomUserid: 'JianFen' },
    { id: 'zhouxiaoyu', name: '周小玉',     teamId: 'cs_1', wecomUserid: 'ZhouJiaXiaoYu' },
    { id: 'zengyifeng', name: '曾意峰',     teamId: 'cs_2', wecomUserid: 'JingXuMeiRong' },
  ];
  const upStaff = db.prepare(`INSERT INTO shijing_staff(id,name,teamId,role,wecomUserid,active,createdAt,updatedAt)
    VALUES(@id,@name,@teamId,'cs',@wecomUserid,1,@ts,@ts)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, teamId=excluded.teamId,
      wecomUserid=excluded.wecomUserid, updatedAt=excluded.updatedAt`);
  for (const s of seedStaff) upStaff.run({ ...s, ts: Date.now() });
  // 清理历史遗留旧 id 种子（xm1/xm2/CS1），避免同一企微号在 staff 表重复
  try { db.prepare("DELETE FROM shijing_staff WHERE id IN ('xm1','xm2','CS1')").run(); } catch (e) {}

  // ============================================================
  // 1. 企微 API 封装
  // ============================================================
  const ADD_WAY = {
    0: '未知', 1: '手机号', 2: '扫码', 3: '名片', 4: '群聊', 5: '手机联系人',
    6: '微信好友', 7: '来源不明', 8: '第三方', 9: 'API导入', 10: '分享',
    11: '公众号', 12: '活动', 13: '外部', 16: '获客助手', 24: '视频号',
    201: '内部分享', 202: '管理员分配',
  };
  const wayName = w => ADD_WAY[w] || ('渠道' + w);

  // state -> 投放平台归因解析（仅识别已验证规律，未识别格式返回null，不猜测）
  function parseAttributionChannel(state) {
    if (!state) return null;
    if (state.startsWith('lifeca_')) return 'oceanengine_local'; // 巨量本地推(本地生活)获客助手
    return null; // Lmr*等其他格式尚未确认归属平台，暂不判定
  }

  // 归因判定优先级：①落地页系统(ldyad)的leads.platform(2026-07-20接入，
  // 由落地页跳转逻辑本身判定，覆盖adq/oceanengine/oceanengine_local三平台，
  // 实测94.9%能精确匹配到同一个external_userid，与旧state解析交叉核对
  // 99%一致) ②降级用state字符串解析(仅能识别本地推的lifeca_规律，作为
  // 落地页系统查不到记录时的兜底，例如客户没走落地页直接扫码/旧链接加粉)
  function resolveAttributionChannel(externalUserId, state) {
    if (_lookupLdyadPlatform) {
      const p = _lookupLdyadPlatform(externalUserId);
      if (p) return p;
    }
    return parseAttributionChannel(state);
  }

  function httpGet(path) {
    return new Promise((resolve, reject) => {
      https.get({ hostname: 'qyapi.weixin.qq.com', path, timeout: 20000 }, r => {
        let b = ''; r.on('data', c => b += c);
        r.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(b); } });
      }).on('error', reject).on('timeout', function () { this.destroy(); reject(new Error('timeout')); });
    });
  }
  function httpPost(path, body) {
    return new Promise((resolve, reject) => {
      const d = JSON.stringify(body);
      const req = https.request({
        hostname: 'qyapi.weixin.qq.com', path, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) },
        timeout: 20000,
      }, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(b); } }); });
      req.on('error', reject); req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.write(d); req.end();
    });
  }

  // token 缓存
  let _tokenCache = { token: null, expireAt: 0 };
  async function getToken() {
    const cfg = (getConfig && getConfig()) || {};
    const w = cfg.wecom || {};
    if (!w.corpId || !w.contactSecret) throw new Error('wecom not configured');
    if (_tokenCache.token && Date.now() < _tokenCache.expireAt) return _tokenCache.token;
    const t = await httpGet('/cgi-bin/gettoken?corpid=' + w.corpId + '&corpsecret=' + w.contactSecret);
    if (!t.access_token) throw new Error('gettoken failed: ' + JSON.stringify(t));
    _tokenCache = { token: t.access_token, expireAt: Date.now() + (t.expires_in - 300) * 1000 };
    return t.access_token;
  }

  // 拉「配置了客户联系」的成员
  async function getFollowUsers() {
    const tk = await getToken();
    const r = await httpGet('/cgi-bin/externalcontact/get_follow_user_list?access_token=' + tk);
    return r.follow_user || [];
  }

  // 拉某成员全部客户详情（batch，含 follow_info.createtime/add_way）
  async function getCustomersOf(userid) {
    const tk = await getToken();
    const out = [];
    let cursor = '';
    do {
      const r = await httpPost('/cgi-bin/externalcontact/batch/get_by_user?access_token=' + tk,
        { userid_list: [userid], cursor, limit: 100 });
      if (r.errcode) { return { err: r.errcode, msg: r.errmsg, list: out }; }
      for (const item of (r.external_contact_list || [])) {
        const ec = item.external_contact || {};
        const fi = item.follow_info || {};
        out.push({
          external_userid: ec.external_userid,
          name: ec.name, avatar: ec.avatar, type: ec.type,
          follow_userid: userid,
          add_time: fi.createtime, add_way: fi.add_way,
          remark: fi.remark, tags: (fi.tags || []).map(t => t.tag_name),
          state: fi.state || '',
        });
      }
      cursor = r.next_cursor || '';
    } while (cursor);
    return { list: out };
  }

  // ============================================================
  // 2. 同步：拉所有「客服成员」的客户 → 落库加粉快照 + 客户主档
  // ============================================================
  async function syncFans() {
    // 只同步在 staff 表里登记为 cs 的成员（门店老师/管理员不拉）
    const staffRows = db.prepare(`SELECT * FROM shijing_staff WHERE role='cs' AND active=1 AND wecomUserid IS NOT NULL`).all();
    const targets = staffRows.map(s => s.wecomUserid);
    if (!targets.length) return { ok: false, error: 'no cs staff mapped' };

    const upFans = db.prepare(`INSERT INTO shijing_wecom_fans(wecomUserid,date,addCount,ways,syncedAt)
      VALUES(?,?,?,?,?) ON CONFLICT(wecomUserid,date) DO UPDATE SET
      addCount=excluded.addCount, ways=excluded.ways, syncedAt=excluded.syncedAt`);
    const upCust = db.prepare(`INSERT INTO shijing_wecom_customers
      (external_userid,name,avatar,type,follow_userid,add_time,add_way,remark,tags,lost,updatedAt,
       attribution_state,attribution_channel,attribution_synced_at)
      VALUES(@external_userid,@name,@avatar,@type,@follow_userid,@add_time,@add_way,@remark,@tags,0,@ts,
       @attribution_state,@attribution_channel,@attribution_synced_at)
      ON CONFLICT(external_userid) DO UPDATE SET name=excluded.name, avatar=excluded.avatar,
      follow_userid=excluded.follow_userid, remark=excluded.remark, tags=excluded.tags,
      lost=0, updatedAt=excluded.updatedAt,
      attribution_state=excluded.attribution_state,
      attribution_channel=CASE WHEN excluded.attribution_channel IS NOT NULL THEN excluded.attribution_channel ELSE shijing_wecom_customers.attribution_channel END,
      attribution_synced_at=excluded.attribution_synced_at`);

    const result = {};
    const now = Date.now();
    for (const userid of targets) {
      const r = await getCustomersOf(userid);
      if (r.err) { result[userid] = { err: r.err }; continue; }
      // 按日期聚合
      const byDate = {}; // date -> {count, ways:{}}
      for (const c of r.list) {
        if (c.add_time) {
          const d = fmtLocalDate(new Date(c.add_time * 1000));
          byDate[d] = byDate[d] || { count: 0, ways: {} };
          byDate[d].count++;
          const wn = wayName(c.add_way);
          byDate[d].ways[wn] = (byDate[d].ways[wn] || 0) + 1;
        }
        // 写客户主档
        upCust.run({
          external_userid: c.external_userid, name: c.name || '', avatar: c.avatar || '',
          type: c.type || 1, follow_userid: c.follow_userid, add_time: c.add_time || 0,
          add_way: c.add_way || 0, remark: c.remark || '', tags: JSON.stringify(c.tags || []), ts: now,
          attribution_state: c.state || null,
          attribution_channel: resolveAttributionChannel(c.external_userid, c.state),
          attribution_synced_at: (c.state || resolveAttributionChannel(c.external_userid, c.state)) ? now : null,
        });
      }
      const tx = db.transaction(() => {
        for (const [d, v] of Object.entries(byDate)) {
          upFans.run(userid, d, v.count, JSON.stringify(v.ways), now);
        }
      });
      tx();
      result[userid] = { total: r.list.length, days: Object.keys(byDate).length };
    }
    return { ok: true, syncedAt: now, result };
  }

  // ============================================================
  // 3. 流失名单（谁删了客服）
  // ============================================================
  async function getUnassigned() {
    const tk = await getToken();
    const out = [];
    let cursor = '', page = 0;
    do {
      const body = { page_size: 1000, cursor };
      const r = await httpPost('/cgi-bin/externalcontact/get_unassigned_list?access_token=' + tk, body);
      if (r.errcode) return { err: r.errcode, msg: r.errmsg, list: out };
      for (const it of (r.info || [])) out.push(it); // {handover_userid, external_userid, dimission_time}
      cursor = r.next_cursor || '';
      if (++page > 20) break;
    } while (cursor);
    return { list: out };
  }

  // ============================================================
  // 4. 接口
  // ============================================================
  // 手动同步（hq）
  app.post('/api/wecom/sync', v6HQRequired, async (req, res) => {
    try { res.json(await syncFans()); }
    catch (e) { res.json({ ok: false, error: e.message || String(e) }); }
  });

  // 加粉核对：按客服个人 × 日期返回客观加粉 + 团队自填对比
  app.get('/api/wecom/fans-check', v6Required, (req, res) => {
    try {
      const dates = [];
      const qs = (req.query.start || '').trim(), qe = (req.query.end || '').trim();
      if (qs && qe) {
        // 自定义区间（最多 92 天，防爆表）
        let cur = new Date(qs + 'T00:00:00'), endD = new Date(qe + 'T00:00:00');
        if (cur > endD) { const t = cur; cur = endD; endD = t; }
        let guard = 0;
        while (cur <= endD && guard < 92) { dates.push(fmtLocalDate(cur)); cur = new Date(cur.getTime() + 86400000); guard++; }
      } else {
        const days = Math.min(parseInt(req.query.days) || 7, 60);
        for (let i = days - 1; i >= 0; i--) dates.push(fmtLocalDate(new Date(Date.now() - i * 86400000)));
      }
      if (!dates.length) return res.json({ ok: true, dates: [], staff: [], teamCompare: [] });

      const staff = db.prepare(`SELECT * FROM shijing_staff WHERE role='cs' AND active=1`).all();
      const cfg = (getConfig && getConfig()) || {};
      const teams = cfg.teams || {};

      // 客观：每个客服每天
      const objective = staff.map(s => {
        const row = {};
        let total = 0, ways = {};
        for (const d of dates) {
          const f = db.prepare(`SELECT addCount, ways FROM shijing_wecom_fans WHERE wecomUserid=? AND date=?`).get(s.wecomUserid, d);
          const c = f ? f.addCount : 0;
          row[d] = c; total += c;
          if (f && f.ways) { const w = JSON.parse(f.ways); for (const k in w) ways[k] = (ways[k] || 0) + w[k]; }
        }
        return { staffId: s.id, name: s.name, teamId: s.teamId, teamName: (teams[s.teamId] && teams[s.teamId].name) || s.teamId, wecomUserid: s.wecomUserid, byDate: row, total, ways };
      });

      // 团队自填（cs 表 addFans，按 teamId×date）
      const csRows = db.prepare(`SELECT data FROM shijing_cs WHERE deleted=0`).all().map(r => JSON.parse(r.data));
      const selfByTeamDate = {}; // teamId -> date -> addFans
      for (const r of csRows) {
        if (!dates.includes(r.date)) continue;
        selfByTeamDate[r.teamId] = selfByTeamDate[r.teamId] || {};
        selfByTeamDate[r.teamId][r.date] = (selfByTeamDate[r.teamId][r.date] || 0) + (+r.addFans || 0);
      }
      // 客观团队汇总（同团队多个客服求和）
      const objByTeamDate = {};
      for (const o of objective) {
        objByTeamDate[o.teamId] = objByTeamDate[o.teamId] || {};
        for (const d of dates) objByTeamDate[o.teamId][d] = (objByTeamDate[o.teamId][d] || 0) + (o.byDate[d] || 0);
      }
      const teamCompare = Object.keys(objByTeamDate).map(tid => {
        const obj = {}, self = {}; let objTotal = 0, selfTotal = 0;
        for (const d of dates) {
          obj[d] = objByTeamDate[tid][d] || 0;
          self[d] = (selfByTeamDate[tid] && selfByTeamDate[tid][d]) || 0;
          objTotal += obj[d]; selfTotal += self[d];
        }
        return { teamId: tid, teamName: (teams[tid] && teams[tid].name) || tid, obj, self, objTotal, selfTotal, diff: selfTotal - objTotal };
      });

      res.json({ ok: true, dates, staff: objective, teamCompare });
    } catch (e) { res.json({ ok: false, error: e.message || String(e) }); }
  });

  // 流失名单（hq）
  app.get('/api/wecom/lost', v6HQRequired, async (req, res) => {
    try { res.json(await getUnassigned()); }
    catch (e) { res.json({ ok: false, error: e.message || String(e) }); }
  });

  // 客服成员管理：列表
  app.get('/api/wecom/staff', v6Required, (req, res) => {
    const rows = db.prepare(`SELECT * FROM shijing_staff ORDER BY teamId, id`).all();
    res.json({ ok: true, staff: rows });
  });

  // 发现企微成员：列出所有「配置了客户联系」的成员，标注是否已在 staff 表映射
  // 用于总部发现新客服(如 DanBanZongJian)并一键绑定
  app.get('/api/wecom/discover', v6HQRequired, async (req, res) => {
    try {
      const followUsers = await getFollowUsers(); // 企微 userid 数组
      const staffRows = db.prepare(`SELECT * FROM shijing_staff`).all();
      const mappedSet = new Set(staffRows.map(s => s.wecomUserid).filter(Boolean));
      // 每个企微成员：是否已映射 + 已映射到谁 + 近30天加粉数(若已同步过)
      const since = fmtLocalDate(new Date(Date.now() - 30 * 86400000));
      const fansRows = db.prepare(`SELECT wecomUserid, SUM(addCount) c FROM shijing_wecom_fans WHERE date>=? GROUP BY wecomUserid`).all(since);
      const fansMap = {}; fansRows.forEach(r => fansMap[r.wecomUserid] = r.c || 0);
      const members = followUsers.map(uid => {
        const st = staffRows.find(s => s.wecomUserid === uid);
        return {
          wecomUserid: uid,
          mapped: mappedSet.has(uid),
          staffId: st ? st.id : null,
          staffName: st ? st.name : null,
          teamId: st ? st.teamId : null,
          active: st ? !!st.active : null,
          recentFans: fansMap[uid] || 0,
        };
      });
      res.json({ ok: true, members, total: members.length, unmapped: members.filter(m => !m.mapped).length });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  // 新增/编辑客服映射（HQ）：绑定 企微userid ↔ 客服姓名/团队
  app.post('/api/wecom/staff-upsert', v6HQRequired, (req, res) => {
    try {
      const { id, name, teamId, wecomUserid } = req.body || {};
      if (!name || !teamId || !wecomUserid) return res.json({ ok: false, error: '姓名/团队/企微号必填' });
      const staffId = (id || name.trim() || wecomUserid).toString();
      const now = Date.now();
      // 同一 wecomUserid 只能绑一个 staff：先清掉别人占用的（避免重复映射）
      db.prepare(`DELETE FROM shijing_staff WHERE wecomUserid=? AND id<>?`).run(wecomUserid, staffId);
      const exists = db.prepare(`SELECT id FROM shijing_staff WHERE id=?`).get(staffId);
      if (exists) {
        db.prepare(`UPDATE shijing_staff SET name=?, teamId=?, wecomUserid=?, role='cs', active=1, updatedAt=? WHERE id=?`)
          .run(name.trim(), teamId, wecomUserid, now, staffId);
      } else {
        db.prepare(`INSERT INTO shijing_staff(id,name,teamId,role,wecomUserid,active,createdAt,updatedAt)
          VALUES(?,?,?,'cs',?,1,?,?)`).run(staffId, name.trim(), teamId, wecomUserid, now, now);
      }
      res.json({ ok: true, id: staffId });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  // 停用/启用客服映射（HQ）：离职客服停用，数据保留
  app.post('/api/wecom/staff-toggle', v6HQRequired, (req, res) => {
    try {
      const { id, active } = req.body || {};
      if (!id) return res.json({ ok: false, error: '缺少 id' });
      db.prepare(`UPDATE shijing_staff SET active=?, updatedAt=? WHERE id=?`).run(active ? 1 : 0, Date.now(), id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  // ============================================================
  // 5. cron：每天 08:50 同步（赶在 9:00 简报 / 9:30 AI日报 前）
  // ============================================================
  let cron;
  try { cron = require('node-cron'); } catch (e) { cron = null; }
  if (cron) {
    cron.schedule('50 8 * * *', async () => {
      console.log('[wecom] daily sync start');
      try { const r = await syncFans(); console.log('[wecom] sync done', JSON.stringify(r.result || r)); }
      catch (e) { console.error('[wecom] sync failed', e.message); }
    }, { timezone: 'Asia/Shanghai' });
    cron.schedule('25 9 * * *', async () => {
      console.log('[wecom] 09:25 pre-report sync start');
      try { const r = await syncFans(); console.log('[wecom] pre-report sync done', JSON.stringify(r.result || r)); }
      catch (e) { console.error('[wecom] pre-report sync failed', e.message); }
    }, { timezone: 'Asia/Shanghai' });
    console.log('[v6-wecom] cron scheduled at 08:50 Asia/Shanghai');
  }

  // ============================================================
  // 6. 企微事件回调（接收"客户删客服 del_external_contact"等事件，实时记录删粉）
  //    需用户在企微后台「客户联系→API→接收事件服务器配置」填：
  //      URL = https://crmai.quesiai.com/api/wecom/callback
  //      Token / EncodingAESKey（企微生成）→ 写入 config.wecom.callbackToken / callbackAesKey
  // ============================================================
  function getCb() {
    const w = ((getConfig && getConfig()) || {}).wecom || {};
    return { token: w.callbackToken || '', aesKey: w.callbackAesKey || '', corpId: w.corpId || '' };
  }
  // 企微签名：sha1(sort(token, timestamp, nonce, encrypt))
  function wxSign(token, timestamp, nonce, encrypt) {
    const arr = [token, timestamp, nonce, encrypt].sort();
    return crypto.createHash('sha1').update(arr.join('')).digest('hex');
  }
  // AES-256-CBC 解密（EncodingAESKey 43位base64 → 32字节；IV取key前16字节）
  function wxDecrypt(aesKey, encrypt) {
    const key = Buffer.from(aesKey + '=', 'base64');
    const iv = key.slice(0, 16);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    decipher.setAutoPadding(false);
    let decoded = Buffer.concat([decipher.update(Buffer.from(encrypt, 'base64')), decipher.final()]);
    // 去 PKCS7 padding
    const pad = decoded[decoded.length - 1];
    decoded = decoded.slice(0, decoded.length - pad);
    // 结构：16字节随机 + 4字节msg长度(网络序) + msg + corpid
    const msgLen = decoded.readUInt32BE(16);
    const msg = decoded.slice(20, 20 + msgLen).toString('utf8');
    const fromCorp = decoded.slice(20 + msgLen).toString('utf8');
    return { msg, fromCorp };
  }
  function xmlVal(xml, tag) {
    const m = xml.match(new RegExp('<' + tag + '>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</' + tag + '>'));
    return m ? m[1] : '';
  }
  // 原始 body 读取（企微 POST 的是 XML，不能走 express.json）
  function readRaw(req) {
    return new Promise(resolve => {
      if (req.body && typeof req.body === 'string') return resolve(req.body);
      let b = ''; req.on('data', c => b += c); req.on('end', () => resolve(b));
      setTimeout(() => resolve(b), 8000);
    });
  }

  // GET：企微回调 URL 验证（返回解密后的 echostr）
  app.get('/api/wecom/callback', (req, res) => {
    try {
      const { token, aesKey } = getCb();
      const { msg_signature, timestamp, nonce, echostr } = req.query;
      if (!token || !aesKey) return res.status(503).send('callback not configured');
      const sign = wxSign(token, timestamp, nonce, echostr);
      if (sign !== msg_signature) return res.status(401).send('signature mismatch');
      const { msg } = wxDecrypt(aesKey, echostr);
      res.send(msg); // 原样返回明文 echostr
    } catch (e) { res.status(500).send('err: ' + (e.message || e)); }
  });

  // POST：接收事件
  app.post('/api/wecom/callback', async (req, res) => {
    try {
      const { token, aesKey } = getCb();
      if (!token || !aesKey) return res.status(503).send('not configured');
      const raw = await readRaw(req);
      const encrypt = xmlVal(raw, 'Encrypt');
      const { msg_signature, timestamp, nonce } = req.query;
      const sign = wxSign(token, timestamp, nonce, encrypt);
      if (sign !== msg_signature) return res.status(401).send('signature mismatch');
      const { msg } = wxDecrypt(aesKey, encrypt);
      // msg 是事件明文 XML
      const event = xmlVal(msg, 'Event');
      const changeType = xmlVal(msg, 'ChangeType');
      // 外部联系人变更事件
      if (event === 'change_external_contact' && (changeType === 'del_external_contact' || changeType === 'del_follow_user')) {
        const externalUserid = xmlVal(msg, 'ExternalUserID');
        const followUser = xmlVal(msg, 'UserID'); // 被删/删人的成员
        const createTime = parseInt(xmlVal(msg, 'CreateTime')) || Math.floor(Date.now() / 1000);
        const date = fmtLocalDate(new Date(createTime * 1000));
        const id = externalUserid + '_' + followUser + '_' + createTime;
        try {
          db.prepare(`INSERT OR IGNORE INTO shijing_wecom_del_events
            (id, external_userid, follow_userid, del_type, event_time, date, createdAt)
            VALUES (?,?,?,?,?,?,?)`).run(id, externalUserid, followUser, changeType, createTime, date, Date.now());
          // 同时把客户主档标记 lost
          db.prepare(`UPDATE shijing_wecom_customers SET lost=1, updatedAt=? WHERE external_userid=?`).run(Date.now(), externalUserid);
          console.log('[wecom-callback] ' + changeType + ' ' + followUser + ' lost ' + externalUserid);
        } catch (e) { console.error('[wecom-callback] db err', e.message); }
      }
      res.send('success'); // 企微要求回 success
    } catch (e) { console.error('[wecom-callback] err', e.message); res.send('success'); }
  });

  // 删粉统计（hq）：按企微成员/团队，从回调事件表算
  app.get('/api/wecom/del-stats', v6HQRequired, (req, res) => {
    try {
      const days = Math.min(parseInt(req.query.days) || 30, 90);
      const since = fmtLocalDate(new Date(Date.now() - (days - 1) * 86400000));
      const rows = db.prepare(`SELECT follow_userid, COUNT(*) n FROM shijing_wecom_del_events WHERE date >= ? GROUP BY follow_userid`).all(since);
      const total = db.prepare(`SELECT COUNT(*) n FROM shijing_wecom_del_events`).get().n;
      res.json({ ok: true, tracked: true, days, byMember: rows, totalAllTime: total });
    } catch (e) { res.json({ ok: false, tracked: false, error: e.message || String(e) }); }
  });

  // 我的删粉率（客服/总部均可）：按当前用户团队下的企微成员，窗口内 删粉/加粉
  app.get('/api/wecom/my-lost-rate', v6Required, (req, res) => {
    try {
      const user = req.v6User;
      const days = Math.min(parseInt(req.query.days) || 30, 90);
      const dates = new Set();
      for (let i = 0; i < days; i++) {
        const d = fmtLocalDate(new Date(Date.now() - i * 86400000));
        dates.add(d);
      }
      let staff = db.prepare("SELECT * FROM shijing_staff WHERE role='cs' AND active=1").all();
      if (user.role !== 'hq') staff = staff.filter(s => s.teamId === user.teamId);
      const ids = staff.map(s => s.wecomUserid).filter(Boolean);
      const cfg = (getConfig && getConfig()) || {};
      const wcfg = cfg.wecom || {};
      const lostTracked = !!(wcfg.callbackToken && wcfg.callbackAesKey);

      const addByUser = {};
      const fansRows = db.prepare("SELECT wecomUserid, date, addCount FROM shijing_wecom_fans").all();
      for (const r of fansRows) { if (dates.has(r.date) && ids.includes(r.wecomUserid)) addByUser[r.wecomUserid] = (addByUser[r.wecomUserid] || 0) + (r.addCount || 0); }

      const lostByUser = {};
      if (lostTracked) {
        try {
          const delRows = db.prepare("SELECT follow_userid, date FROM shijing_wecom_del_events").all();
          for (const r of delRows) { if (dates.has(r.date) && ids.includes(r.follow_userid)) lostByUser[r.follow_userid] = (lostByUser[r.follow_userid] || 0) + 1; }
        } catch (e) {}
      }

      const pct = (a, b) => (!b ? 0 : Math.round(a / b * 1000) / 10);
      let addFans = 0, lost = 0;
      const members = staff.map(s => {
        const a = addByUser[s.wecomUserid] || 0;
        const l = lostByUser[s.wecomUserid] || 0;
        addFans += a; lost += l;
        return { name: s.name, wecomUserid: s.wecomUserid, addFans: a, lost: l, lostRate: pct(l, a) };
      });
      res.json({ ok: true, tracked: lostTracked, days, addFans, lost, lostRate: pct(lost, addFans), members });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  console.log('[v6-wecom] mounted: /api/wecom/{sync,fans-check,lost,staff,discover,staff-upsert,staff-toggle,callback,del-stats,my-lost-rate}');
};
