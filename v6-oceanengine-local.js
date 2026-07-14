// v6-oceanengine-local.js - 巨量本地推数据同步插件
//
// 【2026-07-05 生产环境实测结论 v2，双路径修正版】
// 之前调研以为本地推需要单独走一套 OAuth 授权 + 独立 token 存储，实测发现完全不需要：
//   - Nick 的生产配置里 oceanengine.ebpOrgId=1850451629964697 是"升级版巨量引擎工作台"
//     账户（account_role=PLATFORM_ROLE_ENTERPRISE_BP_ADMIN），其下同时挂了 AD 和 本地推
//     两类子账户，共用同一个 accessToken——本地推根本不需要单独授权/单独token！
//   - 获取本地推账户列表的正确接口（升级版工作台专用，不是旧版 customer_center）：
//       GET https://api.oceanengine.com/open_api/2/ebp/advertiser/list/
//       参数：enterprise_organization_id（工作台ID，即 ebpOrgId）
//            account_source=LOCAL（AD=巨量营销客户账号，LOCAL=本地推账户）
//       实测返回 22 个 local 账户。
//
// 【关键修正 v2】：报表汇总接口（/open_api/v3.0/local/report/account/get/）的
// convert_cnt / attribution_clue_high_intention 等字段，对新起量的计划经常返回 0
// （疑似归因聚合延迟或该计划未配置转化事件），但同一时间段用户在巨量后台UI上能看到
// 真实的"线索留资数(计费时间)"。实测改用【获取本地推线索列表】明细接口
// （POST /open_api/2/tools/clue/life/get/）后，同一账户同一时间段能查到完整的
// 31 条真实留资记录，和用户后台看到的数据完全对得上。
// 因此本模块改为"双路同步"：
//   1）报表接口（report/account/get）——负责准确的 消耗/展示/点击（这几个字段可靠）
//   2）线索明细接口（clue/life/get）——负责准确的 留资数=加粉数（按日聚合明细条数）
// 两路数据分别写入，再在 oclWriteAdRecords 合并成一条 shijing_ad 记录。
//
// 【指标口径结论（2026-07-05 与 Nick 对齐）】
//   - 消耗 cost = 报表接口 stat_cost（可靠）
//   - 线索留资数=加粉数 addFans = 线索明细接口按 create_time_detail 日期分桶计数（可靠，报表接口的
//     convert_cnt 不可靠，仅做参考不采用）
//   - 留资成本 = cost / addFans（前端算，不单独存）
//   - "预付定金数"：巨量线索明细的 effective_state 官方枚举（0新线索/1有意向/2成交/
//     3无效/6已加微信/7待再次沟通/204到店）里没有"定金"这个状态。定金/钩子品支付
//     （clue_convert_state=CLUE_HIGH_INTENTION）是需要客服/门店主动回传给巨量的字段，
//     不是巨量原生吐给我们的，暂时没有回传动作，所以这个数字目前**真实拿不到**，
//     deepConvert 暂存 0 并在前端明确标注"待回传"，不能伪造成有效数字。
//   - 到店数/成交数：线索明细 effective_state_name 有 ARRIVE_STORE(到店)/CONVERTED(成交)，
//     可用于后续扩展统计，本次先不写入，只写 addFans/cost/impressions/clicks。
//
// 挂载方式：在 server.js 的 v6-creatives 挂载后加一行：
//   require('./v6-oceanengine-local')(app, db, { getConfig, setConfig, pushWecom, cron, v6HQRequired });
// 直接复用 cfg.oceanengine.advertisers 里 ebpOrgId 对应的那个工作台账户 token，
// 不需要独立 OAuth/token 存储刷新逻辑。
//
// 本地推数据写入 shijing_ad 表，用 mediaChannel='oceanengine_local' 区分，
// id 前缀 'ocl_'，字段口径对齐 AD（cost/addFans/deepConvert等）方便前端渠道分析复用同一套聚合逻辑。

module.exports = function installOceanengineLocal(app, db, opts) {
  const { getConfig, setConfig, pushWecom, cron, v6HQRequired: v6HQRequiredIn, oceanengineGetValidToken } = opts || {};
  if (!getConfig || !setConfig) { console.warn('[oc-local] missing getConfig/setConfig, skip'); return; }
  const https = require('https');
  const v6HQRequired = v6HQRequiredIn || ((req, res, next) => next());

  const OCL_API_HOST = 'api.oceanengine.com';

  // 报表接口指标：只取可靠字段（消耗/展示/点击），转化类字段不可靠，不采信
  const OCL_REPORT_METRICS = ['stat_cost', 'show_cnt', 'click_cnt'];

  function oclHttpsGet(path, accessToken) {
    return new Promise(resolve => {
      const req = https.get({ host: OCL_API_HOST, path, headers: { 'Access-Token': accessToken } }, res2 => {
        let buf = ''; res2.on('data', c => buf += c);
        res2.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { resolve({ ok: false, raw: buf }); } });
      });
      req.on('error', e => resolve({ ok: false, error: e.message }));
    });
  }

  function oclHttpsPost(path, accessToken, body) {
    return new Promise(resolve => {
      const payload = JSON.stringify(body);
      const req = https.request({
        host: OCL_API_HOST, path, method: 'POST',
        headers: { 'Access-Token': accessToken, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      }, res2 => {
        let buf = ''; res2.on('data', c => buf += c);
        res2.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { resolve({ ok: false, raw: buf }); } });
      });
      req.on('error', e => resolve({ ok: false, error: e.message }));
      req.write(payload);
      req.end();
    });
  }

  // 拿工作台账户（ebpOrgId 对应的那个 advertiser）的有效 accessToken。
  async function getBpToken() {
    const cfg = getConfig() || {};
    const oe = cfg.oceanengine || {};
    const bpId = oe.ebpOrgId;
    if (!bpId) return { ok: false, error: 'oceanengine.ebpOrgId 未配置' };
    if (typeof oceanengineGetValidToken === 'function') {
      const r = await oceanengineGetValidToken(bpId);
      if (r && r.ok) return { ok: true, accessToken: r.accessToken, bpId };
    }
    const bp = (oe.advertisers || []).find(a => String(a.advertiserId) === String(bpId));
    if (!bp || !bp.accessToken) return { ok: false, error: '工作台账户token不存在' };
    return { ok: true, accessToken: bp.accessToken, bpId };
  }

  // 获取升级版工作台下账户列表（account_source: 'AD' | 'LOCAL'）
  async function fetchEbpAccountList(accessToken, bpId, accountSource) {
    let page = 1;
    let all = [];
    while (true) {
      const params = new URLSearchParams({
        enterprise_organization_id: String(bpId),
        account_source: accountSource,
        page: String(page), page_size: '100',
      });
      const r = await oclHttpsGet('/open_api/2/ebp/advertiser/list/?' + params.toString(), accessToken);
      if (!r || r.code !== 0 || !r.data) break;
      const list = r.data.account_list || [];
      all = all.concat(list);
      const pi = r.data.page_info;
      if (!pi || page >= pi.total_page) break;
      page++;
    }
    return all;
  }

  // 同步一遍本地推账户列表到配置（供前端展示/选择同步范围）
  // 【2026-07-05 改为合并式更新，不再整体覆盖】：账户认领功能会在每个账户对象上
  // 挂 ownerId/ownerName/ownerTeamId/claimedAt 归属字段，这些字段不是巨量接口返回的，
  // 只存在于我们自己的配置里。如果这里每次都用接口返回的新数组整体替换掉旧数组，
  // 每天早8:40自动同步一跑，所有人认领的归属信息就会被清空——必须按 accountId 合并：
  // 已存在的账户只更新 accountName（账户名可能改），保留其余自定义字段；新出现的账户追加进去（归属为空）。
  async function syncLocalAccountList() {
    const tok = await getBpToken();
    if (!tok.ok) return tok;
    const list = await fetchEbpAccountList(tok.accessToken, tok.bpId, 'LOCAL');
    const cfg = getConfig() || {};
    cfg.oceanengine = cfg.oceanengine || {};
    const old = cfg.oceanengine.localAccounts || [];
    const oldMap = new Map(old.map(a => [String(a.accountId), a]));
    const merged = list.map(a => {
      const id = String(a.account_id);
      const prev = oldMap.get(id);
      return prev
        ? { ...prev, accountId: id, accountName: a.account_name }
        : { accountId: id, accountName: a.account_name, ownerId: null, ownerName: null, ownerTeamId: null, claimedAt: null };
    });
    cfg.oceanengine.localAccounts = merged;
    setConfig(cfg);
    return { ok: true, count: merged.length, accounts: merged };
  }

  // ========= 路径1：报表接口，拿 消耗/展示/点击（按天）=========
  async function oclFetchReport(accessToken, localAccountId, startDate, endDate) {
    const params = new URLSearchParams({
      local_account_id: String(localAccountId),
      start_date: startDate,
      end_date: endDate,
      dimensions: JSON.stringify(['stat_time_day']),
      metrics: JSON.stringify(OCL_REPORT_METRICS),
      page: '1', page_size: '50',
    });
    return await oclHttpsGet('/open_api/v3.0/local/report/account/get/?' + params.toString(), accessToken);
  }

  // ========= 路径2：线索明细接口，拿 真实留资数(=加粉数)，按天聚合条数 =========
  // POST /open_api/2/tools/clue/life/get/，local_account_ids 数组(<=50)+start_time/end_time(带时分秒)
  // __PATCHED_CLUE_COUNT__ [2026-07-15] 同时统计留资数(byDay)和预付定金数(byDayDeposit)
  // 预付定金判定：巨量线索明细字段 component_event_type_tags 数组包含 196
  // （196 = 本地推深度转化"预付定金"节点，2026-07-15 实测账户1869842055860442验证：
  //   7/10~7/14每天1-3条线索带196标签，与用户反馈"14号后台看到预付定金数"完全对应）
  const OCL_DEPOSIT_TAG = 196;
  async function oclFetchClueCountByDay(accessToken, localAccountId, startDate, endDate) {
    const byDay = {}; // date -> 留资总数
    const byDayDeposit = {}; // date -> 预付定金数(高潜成交)
    let page = 1;
    const pageSize = 100;
    while (true) {
      const body = {
        local_account_ids: [Number(localAccountId)],
        start_time: startDate + ' 00:00:00',
        end_time: endDate + ' 23:59:59',
        page, page_size: pageSize,
      };
      const r = await oclHttpsPost('/open_api/2/tools/clue/life/get/', accessToken, body);
      if (!r || r.code !== 0 || !r.data) break;
      const list = r.data.list || [];
      for (const item of list) {
        const t = item.create_time_detail || item.create_time || '';
        const date = t.slice(0, 10);
        if (!date) continue;
        byDay[date] = (byDay[date] || 0) + 1;
        const tags = item.component_event_type_tags || [];
        if (tags.includes(OCL_DEPOSIT_TAG)) {
          byDayDeposit[date] = (byDayDeposit[date] || 0) + 1;
        }
      }
      const pi = r.data.page_info;
      if (!pi || page >= pi.page_total || !list.length) break;
      page++;
      await new Promise(res2 => setTimeout(res2, 80));
    }
    return { byDay, byDayDeposit };
  }

  function oclWriteAdRecords(accId, accName, reportRows, clueResult) { // __PATCHED_WRITE_SIG__
    const clueByDay = (clueResult && clueResult.byDay) || {};
    const clueByDayDeposit = (clueResult && clueResult.byDayDeposit) || {};
    let written = 0, updated = 0;
    const now = Date.now();
    const upsert = db.prepare(`INSERT INTO shijing_ad(id, data, deleted) VALUES(?, ?, 0)
                                ON CONFLICT(id) DO UPDATE SET data=excluded.data`);
    // 以报表天维度为主表，把当天线索数合并进去；报表里没出现但线索里有的日期也要补一行（消耗记0）
    const dateSet = new Set();
    const byDate = {};
    for (const row of reportRows) {
      const date = row.stat_time_day || row.date;
      if (!date) continue;
      dateSet.add(date);
      byDate[date] = { cost: +row.stat_cost || 0, impressions: +row.show_cnt || 0, clicks: +row.click_cnt || 0 };
    }
    for (const date of Object.keys(clueByDay || {})) dateSet.add(date);
    for (const date of Object.keys(clueByDayDeposit || {})) dateSet.add(date); // __PATCHED_DATESET_DEPOSIT__

    for (const date of dateSet) {
      const r = byDate[date] || { cost: 0, impressions: 0, clicks: 0 };
      const addFans = (clueByDay && clueByDay[date]) || 0;
      const idKey = `ocl_${accId}_${date}`;
      const rec = {
        id: idKey,
        teamId: 'oceanengine_local_' + accId,
        ocAccountId: String(accId),
        ocAccountName: accName,
        date,
        sourceType: 'oceanengine_local',
        mediaChannel: 'oceanengine_local',
        cost: r.cost,
        addFans,
        deepConvert: (clueByDayDeposit && clueByDayDeposit[date]) || 0, // __PATCHED_DEEPCONVERT__ [2026-07-15] 预付定金数=线索明细component_event_type_tags含196(预付定金节点)的条目数，实测有效
        impressions: r.impressions,
        clicks: r.clicks,
        syncedAt: now,
      };
      const existing = db.prepare('SELECT 1 FROM shijing_ad WHERE id=?').get(idKey);
      upsert.run(idKey, JSON.stringify(rec));
      if (existing) updated++; else written++;
    }
    return { written, updated };
  }

  async function oclSync(startDate, endDate) {
    const tok = await getBpToken();
    if (!tok.ok) return { ok: false, error: tok.error };
    const cfg = getConfig() || {};
    let accounts = (cfg.oceanengine && cfg.oceanengine.localAccounts) || [];
    // 每次同步前都先刷新一遍账户列表（而非仅在缓存为空时才刷新），
    // 这样以后新开通的本地推账户会被自动纳入同步范围，不需要人工手动点"刷新账户"。
    // 刷新失败（如接口临时报错）时降级使用上次缓存的账户列表，保证当天同步不中断。
    const refreshed = await syncLocalAccountList();
    if (refreshed.ok) {
      accounts = refreshed.accounts;
    } else if (!accounts.length) {
      return { ok: false, error: refreshed.error };
    }
    const summary = { startDate, endDate, accounts: accounts.length, written: 0, updated: 0, errors: [] };
    for (const acc of accounts) {
      try {
        const rpt = await oclFetchReport(tok.accessToken, acc.accountId, startDate, endDate);
        const reportRows = (rpt && rpt.code === 0 && rpt.data && rpt.data.data_list) || [];
        const clueResult = await oclFetchClueCountByDay(tok.accessToken, acc.accountId, startDate, endDate); // __PATCHED_CALL__
        if (reportRows.length || Object.keys(clueResult.byDay).length) {
          const w = oclWriteAdRecords(acc.accountId, acc.accountName, reportRows, clueResult);
          summary.written += w.written; summary.updated += w.updated;
        }
        if (rpt && rpt.code !== 0) summary.errors.push({ acc: acc.accountId, phase: 'report', err: rpt.message });
        await new Promise(res2 => setTimeout(res2, 120));
      } catch (e) {
        summary.errors.push({ acc: acc.accountId, err: e.message });
      }
    }
    summary.ok = true;
    summary.finishedAt = Date.now();
    cfg.oceanengine = cfg.oceanengine || {};
    cfg.oceanengine.localLastSync = summary;
    setConfig(cfg);
    return summary;
  }

  // ========= API 路由 =========
  app.get('/api/oceanengine-local/status', v6HQRequired, async (req, res) => {
    const cfg = getConfig() || {};
    const oe = cfg.oceanengine || {};
    res.json({
      ok: true,
      configured: !!oe.ebpOrgId,
      ebpOrgId: oe.ebpOrgId || null,
      accountCount: (oe.localAccounts || []).length,
      accounts: oe.localAccounts || [],
      lastSync: oe.localLastSync || null,
    });
  });

  app.post('/api/oceanengine-local/accounts/refresh', v6HQRequired, async (req, res) => {
    const r = await syncLocalAccountList();
    res.json(r);
  });

  app.post('/api/oceanengine-local/sync', v6HQRequired, async (req, res) => {
    const { startDate, endDate } = req.body || {};
    const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const r = await oclSync(startDate || y, endDate || y);
    res.json(r);
  });

  app.post('/api/oceanengine-local/backfill', v6HQRequired, async (req, res) => {
    const end = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const start = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const r = await oclSync(start, end);
    res.json(r);
  });

  // ========= 每日自动同步（早上8:40拉昨日数据，避开AD侧同步高峰）=========
  if (cron) {
    cron.schedule('40 8 * * *', async () => {
      const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      try { await oclSync(y, y); } catch (e) { console.error('[oc-local] daily sync error', e.message); }
    }, { timezone: 'Asia/Shanghai' });
  }

  console.log('[oc-local] module ready (复用AD工作台token，双路同步：报表拉消耗+明细拉真实留资数；GET /api/oceanengine-local/status 查看状态)');
};
