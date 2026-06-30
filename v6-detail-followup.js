'use strict';
// ============================================================
// 门店「服务详情补录」跟进模块（插件式，零侵入）
// 流程：客服邀约 → 企微机器人链接「✓已到店」→ /c/:token 自动建占位记录(autoCreated+pendingDetail)
//      → 门店当天必须回系统补「操作/成交 + 顾客照片」→ 补全后 pendingDetail 解除
//      → 当天 18:50 仍未补全的，按门店各自群推送提醒，必须完成
// 补全判定(B)：有照片 且 (isOperated 或 isClosed 已填) 即视为补全
// ============================================================
module.exports = function (app, db, deps) {
  deps = deps || {};
  const getConfig = deps.getConfig;
  const pushWecom = deps.pushWecom;
  const fmtLocalDate = deps.fmtLocalDate || (d => { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });
  const v6Required = deps.v6Required || ((req, res, next) => next());
  const v6HQRequired = deps.v6HQRequired || ((req, res, next) => next());
  const cron = deps.cron;

  // —— 补全判定（B）：导出给别处复用 —— //
  // 仅对 autoCreated 占位记录有意义；补全 = 有照片 且 (操作或成交结果已填)
  function isDetailComplete(rec) {
    if (!rec) return true;
    const hasPhoto = Array.isArray(rec.photos) && rec.photos.length > 0;
    const hasResult = !!(rec.isOperated && String(rec.isOperated).trim())
      || !!(rec.isClosed && String(rec.isClosed).trim());
    return hasPhoto && hasResult;
  }
  // 是否「待补录」= 占位记录 且 未补全
  function isPendingDetail(rec) {
    if (!rec) return false;
    if (!rec.autoCreated) return false;
    return !isDetailComplete(rec);
  }
  // 暴露给 server.js 其它模块用（不计业绩判定）
  app.locals = app.locals || {};
  app.locals.isPendingDetail = isPendingDetail;
  app.locals.isDetailComplete = isDetailComplete;

  function loadStore() {
    return db.prepare(`SELECT id, data FROM shijing_store WHERE deleted=0`).all()
      .map(r => { const d = JSON.parse(r.data); d.__id = r.id; return d; });
  }

  // 列出某门店（或全部）当天待补录的占位记录
  function listPending(teamId, date) {
    const all = loadStore();
    return all.filter(x =>
      isPendingDetail(x)
      && (!teamId || x.teamId === teamId)
      && (!date || x.date === date)
    );
  }

  // ============================================================
  // 接口：本店待补详情列表（门店登录可见自己的；hq 看全部）
  // ============================================================
  app.get('/api/store/pending-detail', v6Required, (req, res) => {
    try {
      const user = req.v6User || {};
      const teamId = (user.role === 'hq') ? (req.query.teamId || null) : user.teamId;
      const date = req.query.date || null; // 不传=全部历史待补
      const list = listPending(teamId, date);
      const cfg = (getConfig && getConfig()) || {};
      const teams = cfg.teams || {};
      list.sort((a, b) => (b.arrivedAt || b.createdAt || 0) - (a.arrivedAt || a.createdAt || 0));
      res.json({
        ok: true,
        total: list.length,
        list: list.map(x => ({
          id: x.__id,
          customerName: x.customerName,
          phone: x.customerPhone || x.phone || '',
          date: x.date,
          teamId: x.teamId,
          teamName: (teams[x.teamId] && teams[x.teamId].name) || x.teamId,
          arrivedAt: x.arrivedAt || x.createdAt,
          hasPhoto: Array.isArray(x.photos) && x.photos.length > 0,
          hasResult: !!(x.isOperated && String(x.isOperated).trim()) || !!(x.isClosed && String(x.isClosed).trim()),
        })),
      });
    } catch (e) { res.json({ ok: false, error: e.message || String(e) }); }
  });

  // ============================================================
  // 推送逻辑：扫当天未补录，按门店分组推各自群
  // ============================================================
  async function runDetailRemind(date) {
    const cfg = (getConfig && getConfig()) || {};
    const storeWebhooks = (cfg.wecomConfig && cfg.wecomConfig.storeWebhooks) || {};
    const teams = cfg.teams || {};
    const today = date || fmtLocalDate(new Date());

    const pending = listPending(null, today);
    // 按门店分组
    const byStore = {};
    for (const r of pending) {
      (byStore[r.teamId] = byStore[r.teamId] || []).push(r);
    }

    let pushedStores = 0, pushedCount = 0, noWebhook = 0;
    for (const teamId of Object.keys(byStore)) {
      const list = byStore[teamId];
      const url = storeWebhooks[teamId];
      const storeName = (teams[teamId] && teams[teamId].name) || teamId;
      if (!url) { noWebhook++; console.log('[detail-remind] no webhook for', teamId, '(', list.length, '待补)'); continue; }

      const names = list.map(x => `**${x.customerName}**${x.customerPhone || x.phone ? '（' + String(x.customerPhone || x.phone).slice(-4) + '）' : ''}`).join('、');
      const content = `## 📋 服务详情待补录提醒\n` +
        `> <font color="warning">${storeName} 今日有 ${list.length} 位顾客已确认到店，但服务详情尚未补全，请下班前完成！</font>\n\n` +
        `> 待补录顾客：${names}\n\n` +
        `请进入系统「客户中心 / 服务记录」找到这些顾客，补填：\n` +
        `① 是否操作 / 成交情况\n② **顾客照片（必传）**\n\n` +
        `<font color="comment">补全后本提醒自动解除；今日未完成将持续提醒。</font>`;

      const pr = await pushWecom(url, content);
      if (pr && pr.errcode === 0) { pushedStores++; pushedCount += list.length; }
      console.log('[detail-remind]', storeName, list.length, '待补 →', pr && pr.errcode === 0 ? 'OK' : ('FAIL ' + (pr && pr.errmsg)));
    }
    console.log('[detail-remind] done. stores:', pushedStores, 'customers:', pushedCount, 'noWebhook:', noWebhook);
    return { ok: true, date: today, totalPending: pending.length, pushedStores, pushedCount, noWebhook };
  }

  // 手动触发（hq）
  app.post('/api/store/detail-remind', v6HQRequired, async (req, res) => {
    try {
      const date = (req.body && req.body.date) || null;
      const r = await runDetailRemind(date);
      res.json(r);
    } catch (e) { res.json({ ok: false, error: e.message || String(e) }); }
  });

  // ============================================================
  // cron 18:50 每天提醒（下班前）
  // ============================================================
  if (cron) {
    cron.schedule('50 18 * * *', () => {
      runDetailRemind().catch(e => console.error('[detail-remind cron]', e && e.message));
    }, { timezone: 'Asia/Shanghai' });
    console.log('[v6-detail-followup] cron scheduled at 18:50 Asia/Shanghai');
  }

  console.log('[v6-detail-followup] mounted: /api/store/{pending-detail,detail-remind}');
};
