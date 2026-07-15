// v6-adq.js - 腾讯广告(ADQ) 数据同步插件
//
// 【2026-07-15 生产环境实测结论】
// - 应用信息：client_id=1112039527，回调域名需与开发者后台登记的一致。
// - 首次授权务必显式提供 account_id 才能查询该账户信息/报表（本账户是"直客账户"模式，
//   不是代理商模式，不能不传account_id批量拉子客户列表，否则报错缺少account_id/agency_id）。
// - 实测账户 84238806（长沙净须美容有限公司，system_status=CUSTOMER_STATUS_NORMAL）授权成功，
//   跑通 advertiser/get 和 daily_reports/get，14天数据(7/1~7/14)真实拿到。
// - v3.0 daily_reports/get 关键字段名（与旧版v1.1文档不同，均已实测验证）：
//     cost                消耗，单位【分】（写入shijing_ad前需 /100 转成元）
//     view_count          曝光量（不是 impression）
//     valid_click_count   有效点击量（不是 click）
//     conversions_count   转化数（对应我们体系里的"高潜成交/深转"）
//     conversions_cost    转化成本，单位分
//   调用时必须带 group_by=["date"]，否则报错缺少group_by；level=REPORT_LEVEL_ADVERTISER。
// - advertiser/get 查询单个账户信息需要 pagination_mode=PAGINATION_MODE_NORMAL + page + page_size，
//   否则报错缺少这些必填参数（v3.0新接口的分页机制变化，跟本地推/巨量AD的分页参数不同）。
// - token机制：access_token/refresh_token 默认均为30天有效期（不是官方文档写的24小时，本应用配置
//   了长效token），每次用refresh_token刷新时，refresh_token本身也会自动续期30天。
// - 排坑记录：v1.1版旧接口 oauth/authorized_advertiser_list 对这个应用返回 code:11014"超出授权范围"，
//   即使account_id和权限都正确也一样——这是接口本身已被此应用的scope排除，不代表账户没权限，
//   应改用 v3.0/advertiser/get 并显式传account_id，才是这个应用真正可用的查询方式。
//
// 挂载方式：在 server.js 里加一行：
//   require('./v6-adq')(app, db, { getConfig, setConfig, pushWecom, cron, v6HQRequired });
//
// 配置结构 cfg.adq = {
//   clientId, clientSecret,           // 应用凭证，一次性配置
//   accounts: [{ accountId, accountName, accessToken, refreshToken, accessExpireAt, refreshExpireAt }],
//   lastSync: {...}                   // 最近一次同步汇总
// }
// 数据写入 shijing_ad 表，mediaChannel='adq'，id前缀 'adq_'，字段口径对齐现有体系
// （cost/addFans/deepConvert等），addFans留空(ADQ无"加粉"概念，用conversions_count填deepConvert)。

module.exports = function installAdq(app, db, opts) {
  const { getConfig, setConfig, pushWecom, cron, v6HQRequired: v6HQRequiredIn } = opts || {};
  if (!getConfig || !setConfig) { console.warn('[adq] missing getConfig/setConfig, skip'); return; }
  const https = require('https');
  const querystring = require('querystring');
  const v6HQRequired = v6HQRequiredIn || ((req, res, next) => next());

  const ADQ_API_HOST = 'api.e.qq.com';
  const ADQ_OAUTH_AUTHORIZE_URL = 'https://developers.e.qq.com/oauth/authorize';

  function adqHttpsGet(path) {
    return new Promise(resolve => {
      https.get({ host: ADQ_API_HOST, path }, res2 => {
        let buf = ''; res2.on('data', c => buf += c);
        res2.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { resolve({ ok: false, raw: buf }); } });
      }).on('error', e => resolve({ ok: false, error: e.message }));
    });
  }

  function nonce() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
  function ts() { return Math.floor(Date.now() / 1000); }

  // ========= Token 管理 =========
  function getAdqCfg() {
    const cfg = getConfig() || {};
    cfg.adq = cfg.adq || {};
    cfg.adq.accounts = cfg.adq.accounts || [];
    return cfg;
  }

  function findAccount(cfg, accountId) {
    return (cfg.adq.accounts || []).find(a => String(a.accountId) === String(accountId));
  }

  // 用 refresh_token 刷新出新的 access_token（并发锁，避免同一账户被并发刷新把refresh_token撕坏，
  // 巨量那边已经踩过这个坑，ADQ同样按per-账户加锁处理）
  const _refreshLocks = {};
  async function refreshAccessToken(accountId) {
    if (_refreshLocks[accountId]) return _refreshLocks[accountId];
    const p = (async () => {
      const cfg = getAdqCfg();
      const acc = findAccount(cfg, accountId);
      if (!acc || !acc.refreshToken) return { ok: false, error: 'no refresh_token for account ' + accountId };
      const params = querystring.stringify({
        client_id: cfg.adq.clientId,
        client_secret: cfg.adq.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: acc.refreshToken,
      });
      const r = await adqHttpsGet('/oauth/token?' + params);
      if (!r || r.code !== 0 || !r.data) return { ok: false, error: (r && r.message) || 'refresh failed' };
      // 重新读取最新配置再写入，避免并发场景下覆盖掉其他账户在这期间的改动
      const latestCfg = getAdqCfg();
      const latestAcc = findAccount(latestCfg, accountId);
      if (latestAcc) {
        latestAcc.accessToken = r.data.access_token;
        latestAcc.refreshToken = r.data.refresh_token;
        latestAcc.accessExpireAt = Date.now() + (Number(r.data.access_token_expires_in) || 2592000) * 1000;
        latestAcc.refreshExpireAt = Date.now() + (Number(r.data.refresh_token_expires_in) || 2592000) * 1000;
        setConfig(latestCfg);
      }
      return { ok: true, accessToken: r.data.access_token };
    })();
    _refreshLocks[accountId] = p;
    try { return await p; } finally { delete _refreshLocks[accountId]; }
  }

  // 拿账户的有效 access_token，快过期（剩<2h）自动刷新
  async function getValidToken(accountId) {
    const cfg = getAdqCfg();
    const acc = findAccount(cfg, accountId);
    if (!acc || !acc.accessToken) return { ok: false, error: 'account not authorized: ' + accountId };
    const now = Date.now();
    if (!acc.accessExpireAt || acc.accessExpireAt - now < 2 * 3600 * 1000) {
      const r = await refreshAccessToken(accountId);
      if (!r.ok) return r;
      return { ok: true, accessToken: r.accessToken };
    }
    return { ok: true, accessToken: acc.accessToken };
  }

  // ========= 账户信息校验 =========
  async function fetchAdvertiserInfo(accessToken, accountId) {
    const params = querystring.stringify({
      access_token: accessToken, timestamp: ts(), nonce: nonce(),
      account_id: accountId,
      fields: JSON.stringify(['account_id', 'corporation_name', 'system_status']),
      pagination_mode: 'PAGINATION_MODE_NORMAL',
      page: 1, page_size: 10,
    });
    return await adqHttpsGet('/v3.0/advertiser/get?' + params);
  }

  // ========= 日报表同步（消耗/曝光/点击/转化）=========
  // 实测确认字段名：cost(分)/view_count(曝光)/valid_click_count(点击)/conversions_count(转化)/conversions_cost(转化成本，分)
  const ADQ_REPORT_FIELDS = ['date', 'cost', 'view_count', 'valid_click_count', 'conversions_count', 'conversions_cost'];
  async function fetchDailyReport(accessToken, accountId, startDate, endDate) {
    const params = querystring.stringify({
      access_token: accessToken, timestamp: ts(), nonce: nonce(),
      account_id: accountId,
      level: 'REPORT_LEVEL_ADVERTISER',
      date_range: JSON.stringify({ start_date: startDate, end_date: endDate }),
      group_by: JSON.stringify(['date']),
      fields: JSON.stringify(ADQ_REPORT_FIELDS),
      page: 1, page_size: 90,
    });
    return await adqHttpsGet('/v3.0/daily_reports/get?' + params);
  }

  function writeAdRecords(accId, accName, rows) {
    let written = 0, updated = 0;
    const now = Date.now();
    const upsert = db.prepare(`INSERT INTO shijing_ad(id, data, deleted) VALUES(?, ?, 0)
                                ON CONFLICT(id) DO UPDATE SET data=excluded.data`);
    for (const row of rows) {
      const date = row.date;
      if (!date) continue;
      const idKey = `adq_${accId}_${date}`;
      const rec = {
        id: idKey,
        teamId: 'adq_' + accId,
        ocAccountId: String(accId),
        ocAccountName: accName,
        date,
        sourceType: 'adq',
        mediaChannel: 'adq',
        cost: (+row.cost || 0) / 100, // 分转元
        addFans: 0, // ADQ无"加粉"概念，此渠道以conversions_count(转化)作为deepConvert口径
        deepConvert: +row.conversions_count || 0,
        impressions: +row.view_count || 0,
        clicks: +row.valid_click_count || 0,
        syncedAt: now,
      };
      const existing = db.prepare('SELECT 1 FROM shijing_ad WHERE id=?').get(idKey);
      upsert.run(idKey, JSON.stringify(rec));
      if (existing) updated++; else written++;
    }
    return { written, updated };
  }

  async function syncAccount(accountId, startDate, endDate) {
    const tok = await getValidToken(accountId);
    if (!tok.ok) return { ok: false, error: tok.error };
    const cfg = getAdqCfg();
    const acc = findAccount(cfg, accountId);
    const r = await fetchDailyReport(tok.accessToken, accountId, startDate, endDate);
    if (!r || r.code !== 0 || !r.data) return { ok: false, error: (r && r.message) || 'fetch failed', raw: r };
    const rows = r.data.list || [];
    const w = writeAdRecords(accountId, (acc && acc.accountName) || accountId, rows);
    return { ok: true, written: w.written, updated: w.updated, days: rows.length };
  }

  async function syncAll(startDate, endDate) {
    const cfg = getAdqCfg();
    const accounts = cfg.adq.accounts || [];
    const summary = { startDate, endDate, accounts: accounts.length, written: 0, updated: 0, errors: [] };
    for (const acc of accounts) {
      try {
        const r = await syncAccount(acc.accountId, startDate, endDate);
        if (r.ok) { summary.written += r.written; summary.updated += r.updated; }
        else summary.errors.push({ acc: acc.accountId, err: r.error });
      } catch (e) {
        summary.errors.push({ acc: acc.accountId, err: e.message });
      }
      await new Promise(res2 => setTimeout(res2, 150));
    }
    summary.ok = true;
    summary.finishedAt = Date.now();
    const latestCfg = getAdqCfg();
    latestCfg.adq.lastSync = summary;
    setConfig(latestCfg);
    return summary;
  }

  // ========= Token 健康巡检（access剩<2天自动刷新告警；refresh过期告警需人工重新授权）=========
  async function checkAdqTokenHealth() {
    const cfg = getAdqCfg();
    const accounts = cfg.adq.accounts || [];
    const now = Date.now();
    const hqWebhook = (cfg.wecomConfig && cfg.wecomConfig.hqWebhook) || '';
    for (const acc of accounts) {
      if (!acc.refreshExpireAt) continue;
      const rLeftDays = (acc.refreshExpireAt - now) / 86400000;
      if (rLeftDays <= 0) {
        if (hqWebhook && pushWecom) {
          await pushWecom(hqWebhook, `## 🔴 腾讯ADQ授权已过期\n> 账户：${acc.accountName || acc.accountId}\n> refresh_token 已过期，系统无法再自动续期。\n> **必须人工重新授权**，否则该账户投放数据将持续缺失。`);
        }
        continue;
      }
      if (acc.accessExpireAt && acc.accessExpireAt - now < 2 * 3600 * 1000) {
        const r = await refreshAccessToken(acc.accountId);
        if (!r.ok && hqWebhook && pushWecom) {
          await pushWecom(hqWebhook, `## ⚠️ 腾讯ADQ token续期失败\n> 账户：${acc.accountName || acc.accountId}\n> 原因：${r.error || '未知'}`);
        }
      }
    }
  }

  // ========= API 路由 =========

  // 生成OAuth授权链接（HQ登录后点击跳转，账户扫码授权后回调本系统）
  app.get('/api/adq/oauth/url', v6HQRequired, (req, res) => {
    const cfg = getAdqCfg();
    if (!cfg.adq.clientId) return res.json({ ok: false, error: 'clientId 未配置，请先在系统设置中填写ADQ应用凭证' });
    const host = req.headers.host || 'crmai.quesiai.com';
    const redirectUri = `https://${host}/api/adq/oauth/callback`;
    const state = Math.random().toString(36).slice(2);
    const params = querystring.stringify({ client_id: cfg.adq.clientId, redirect_uri: redirectUri, state });
    res.json({ ok: true, url: ADQ_OAUTH_AUTHORIZE_URL + '?' + params, redirectUri });
  });

  // OAuth回调：用code换取access_token/refresh_token，再查account信息存库
  app.get('/api/adq/oauth/callback', async (req, res) => {
    const { code, state } = req.query || {};
    if (!code) return res.status(400).send('缺少授权码(code)');
    const cfg = getAdqCfg();
    if (!cfg.adq.clientId || !cfg.adq.clientSecret) return res.status(500).send('ADQ应用凭证未配置');
    const host = req.headers.host || 'crmai.quesiai.com';
    const redirectUri = `https://${host}/api/adq/oauth/callback`;
    try {
      const tokenParams = querystring.stringify({
        client_id: cfg.adq.clientId, client_secret: cfg.adq.clientSecret,
        grant_type: 'authorization_code', authorization_code: code, redirect_uri: redirectUri,
      });
      const tokenR = await adqHttpsGet('/oauth/token?' + tokenParams);
      if (!tokenR || tokenR.code !== 0 || !tokenR.data) {
        return res.status(500).send('换取token失败：' + JSON.stringify(tokenR));
      }
      const { access_token, refresh_token, access_token_expires_in, refresh_token_expires_in } = tokenR.data;

      // 查这个token能操作的账户信息——直客模式必须知道account_id，
      // 但oauth本身不直接返回account_id，需要前端在跳转前记录，或人工告知。
      // 简化处理：先落一条"待补account_id"的记录，HQ在后台手动填account_id后再触发一次校验同步。
      const latestCfg = getAdqCfg();
      latestCfg.adq.pendingAuth = {
        accessToken: access_token,
        refreshToken: refresh_token,
        accessExpireAt: Date.now() + (Number(access_token_expires_in) || 2592000) * 1000,
        refreshExpireAt: Date.now() + (Number(refresh_token_expires_in) || 2592000) * 1000,
        authorizedAt: Date.now(),
      };
      setConfig(latestCfg);
      res.send('<h2>✅ ADQ 授权成功</h2><p>请返回系统「渠道分析-ADQ」页面，填写对应的广告账户ID完成绑定。</p>');
    } catch (e) {
      res.status(500).send('回调处理异常：' + e.message);
    }
  });

  // 手动绑定account_id到刚授权的token（因为直客OAuth回调不直接带account_id）
  app.post('/api/adq/bind-account', v6HQRequired, async (req, res) => {
    const { accountId, accountName } = req.body || {};
    if (!accountId) return res.json({ ok: false, error: '缺少accountId' });
    const cfg = getAdqCfg();
    const pending = cfg.adq.pendingAuth;
    if (!pending || !pending.accessToken) return res.json({ ok: false, error: '没有待绑定的授权，请先完成OAuth授权' });
    // 校验token确实能操作这个account_id
    const info = await fetchAdvertiserInfo(pending.accessToken, accountId);
    if (!info || info.code !== 0) return res.json({ ok: false, error: '校验失败，该token无权操作此账户：' + (info && info.message) });
    const realName = (info.data && info.data.list && info.data.list[0] && info.data.list[0].corporation_name) || accountName || accountId;

    const existing = findAccount(cfg, accountId);
    const accRec = {
      accountId: String(accountId), accountName: realName,
      accessToken: pending.accessToken, refreshToken: pending.refreshToken,
      accessExpireAt: pending.accessExpireAt, refreshExpireAt: pending.refreshExpireAt,
      boundAt: Date.now(),
    };
    if (existing) Object.assign(existing, accRec);
    else cfg.adq.accounts.push(accRec);
    delete cfg.adq.pendingAuth;
    setConfig(cfg);
    res.json({ ok: true, account: accRec });
  });

  // 手动配置应用凭证（clientId/clientSecret，一次性）
  app.post('/api/adq/config', v6HQRequired, (req, res) => {
    const { clientId, clientSecret } = req.body || {};
    const cfg = getAdqCfg();
    if (clientId) cfg.adq.clientId = clientId;
    if (clientSecret) cfg.adq.clientSecret = clientSecret;
    setConfig(cfg);
    res.json({ ok: true });
  });

  // 直接用已有的access_token/refresh_token手动录入账户（跳过标准OAuth跳转流程，运维临时用）
  app.post('/api/adq/accounts/manual-add', v6HQRequired, async (req, res) => {
    const { accountId, accessToken, refreshToken } = req.body || {};
    if (!accountId || !accessToken || !refreshToken) return res.json({ ok: false, error: '缺少必填参数' });
    const info = await fetchAdvertiserInfo(accessToken, accountId);
    if (!info || info.code !== 0) return res.json({ ok: false, error: '校验失败：' + (info && info.message), raw: info });
    const realName = (info.data && info.data.list && info.data.list[0] && info.data.list[0].corporation_name) || accountId;
    const cfg = getAdqCfg();
    const existing = findAccount(cfg, accountId);
    const accRec = {
      accountId: String(accountId), accountName: realName,
      accessToken, refreshToken,
      accessExpireAt: Date.now() + 2592000 * 1000,
      refreshExpireAt: Date.now() + 2592000 * 1000,
      boundAt: Date.now(),
    };
    if (existing) Object.assign(existing, accRec);
    else cfg.adq.accounts.push(accRec);
    setConfig(cfg);
    res.json({ ok: true, account: accRec });
  });

  app.get('/api/adq/status', v6HQRequired, (req, res) => {
    const cfg = getAdqCfg();
    res.json({
      ok: true,
      configured: !!cfg.adq.clientId,
      accountCount: (cfg.adq.accounts || []).length,
      accounts: (cfg.adq.accounts || []).map(a => ({
        accountId: a.accountId, accountName: a.accountName,
        accessExpireAt: a.accessExpireAt, refreshExpireAt: a.refreshExpireAt,
      })),
      lastSync: cfg.adq.lastSync || null,
    });
  });

  app.post('/api/adq/sync', v6HQRequired, async (req, res) => {
    const { startDate, endDate } = req.body || {};
    const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const r = await syncAll(startDate || y, endDate || y);
    res.json(r);
  });

  app.post('/api/adq/backfill', v6HQRequired, async (req, res) => {
    const end = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const start = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const r = await syncAll(start, end);
    res.json(r);
  });

  // ========= 定时任务：8:45每日同步昨日数据(避开AD 8:00/本地推8:40同步高峰) + 7:50 token健康检查 =========
  if (cron) {
    cron.schedule('50 7 * * *', () => { checkAdqTokenHealth().catch(e => console.error('[adq] token health check error', e.message)); }, { timezone: 'Asia/Shanghai' });
    cron.schedule('45 8 * * *', async () => {
      const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      try { await syncAll(y, y); } catch (e) { console.error('[adq] daily sync error', e.message); }
    }, { timezone: 'Asia/Shanghai' });
    setTimeout(() => { checkAdqTokenHealth().catch(e => console.error('[adq] token health startup error', e.message)); }, 30 * 1000);
  }

  console.log('[adq] module ready (腾讯广告ADQ对接；GET /api/adq/status 查看状态，POST /api/adq/sync 手动同步)');
};
