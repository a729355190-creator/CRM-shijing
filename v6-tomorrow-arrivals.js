/**
 * 明日各门店预约到店看板 + 22:00 推送决策群（插件式，零侵入）
 * 数据源：shijing_invite 表，arriveTime 日期 = 明天，按 storeTeamId 分组计数。
 * 口径：total=明日预约到店总数；pending=未取消(待到店)；cancelled=已取消。
 * 依赖注入：getConfig, fmtLocalDate, pushWecom(用 pushWecomAI 不受DEV开关), v6Required, v6HQRequired, cron
 */
'use strict';

module.exports = function (app, db, deps) {
  deps = deps || {};
  const getConfig = deps.getConfig;
  const pushWecom = deps.pushWecom; // 传入时用 pushWecomAI（决策群必推）
  const v6HQRequired = deps.v6HQRequired || ((req, res, next) => next());
  const fmtLocalDate = deps.fmtLocalDate || function (d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };

  // 计算指定日期(YYYY-MM-DD)各门店预约到店统计
  function buildStats(dateStr) {
    const cfg = (getConfig && getConfig()) || {};
    const teams = cfg.teams || {};
    const stores = Object.entries(teams)
      .filter(([id, t]) => t.role === 'store' && !t.deleted)
      .map(([id, t]) => ({ id, name: t.name, city: t.city || '' }));

    const rows = db.prepare('SELECT data FROM shijing_invite WHERE deleted=0').all().map(r => JSON.parse(r.data));
    const ivs = rows.filter(x => String(x.arriveTime || '').slice(0, 10) === dateStr);

    const map = {};
    for (const s of stores) map[s.id] = { storeId: s.id, storeName: s.name, city: s.city, total: 0, pending: 0, cancelled: 0 };
    let unknownTotal = 0, unknownPending = 0;
    for (const iv of ivs) {
      const sid = iv.storeTeamId;
      if (!map[sid]) {
        // 门店已停用或未在 teams——单列“其他/已停用”
        if (!map.__other) map.__other = { storeId: '__other', storeName: '其他/已停用门店', city: '', total: 0, pending: 0, cancelled: 0 };
        map.__other.total++;
        if (iv.status === 'pending') map.__other.pending++;
        if (iv.status === 'cancelled') map.__other.cancelled++;
        continue;
      }
      map[sid].total++;
      if (iv.status === 'pending') map[sid].pending++;
      if (iv.status === 'cancelled') map[sid].cancelled++;
    }
    const list = Object.values(map).sort((a, b) => b.pending - a.pending || b.total - a.total);
    const sum = list.reduce((s, r) => ({
      total: s.total + r.total, pending: s.pending + r.pending, cancelled: s.cancelled + r.cancelled,
    }), { total: 0, pending: 0, cancelled: 0 });
    return { date: dateStr, stores: list, sum };
  }

  // 组装企微 markdown
  function buildMarkdown(stats) {
    const { date, stores, sum } = stats;
    const active = stores.filter(s => s.total > 0);
    let body = `## 📋 明日预约到店看板\n` +
      `> 日期：**${date}**\n` +
      `> 合计预约到店：<font color="info">**${sum.pending}**</font> 位` +
      (sum.cancelled > 0 ? `（另有 ${sum.cancelled} 位已取消）` : '') + `\n\n`;
    if (active.length === 0) {
      body += `明日暂无门店预约到店记录。\n`;
    } else {
      body += `各门店明日待到店：\n`;
      for (const s of active) {
        if (s.pending <= 0 && s.total <= 0) continue;
        body += `> ${s.storeName}：**${s.pending}** 位` + (s.cancelled > 0 ? `（取消 ${s.cancelled}）` : '') + `\n`;
      }
    }
    body += `\n——\n*每晚 22:00 自动推送，统计明日各门店客服预约到店数量。*`;
    return body;
  }

  // ===== 接口：总部看板数据 =====
  app.get('/api/v6/tomorrow-arrivals', v6HQRequired, (req, res) => {
    try {
      // 默认明天；支持 ?date=YYYY-MM-DD 查询任意日
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || ''))
        ? req.query.date
        : fmtLocalDate(new Date(Date.now() + 86400000));
      res.json({ ok: true, ...buildStats(date) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ===== 接口：手动触发推送（总部，便于测试）=====
  app.post('/api/v6/tomorrow-arrivals/push', v6HQRequired, async (req, res) => {
    try {
      const r = await pushTomorrow();
      res.json({ ok: true, result: r });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 推送逻辑：统计明天 → 推决策群（aiReport.webhook，回退 hqWebhook）
  async function pushTomorrow() {
    const cfg = (getConfig && getConfig()) || {};
    const date = fmtLocalDate(new Date(Date.now() + 86400000));
    const stats = buildStats(date);
    const md = buildMarkdown(stats);
    const webhook = (cfg.aiReport && cfg.aiReport.webhook)
      || (cfg.wecomConfig && cfg.wecomConfig.hqWebhook) || '';
    if (!webhook || !pushWecom) {
      console.log('[tomorrow-arrivals] no webhook, skip push');
      return { pushed: false, reason: 'no_webhook' };
    }
    const pr = await pushWecom(webhook, md);
    console.log('[tomorrow-arrivals]', date, 'pushed:', JSON.stringify(pr));
    return { pushed: pr && pr.errcode === 0, date, sum: stats.sum, resp: pr };
  }

  // ===== cron：每天 22:00 推送 =====
  let cron = deps.cron;
  if (!cron) { try { cron = require('node-cron'); } catch (e) { cron = null; } }
  if (cron) {
    cron.schedule('0 22 * * *', async () => {
      console.log('[tomorrow-arrivals] cron 22:00 push start');
      try { await pushTomorrow(); } catch (e) { console.error('[tomorrow-arrivals] cron failed', e.message); }
    }, { timezone: 'Asia/Shanghai' });
    console.log('[v6-tomorrow-arrivals] cron scheduled at 22:00 Asia/Shanghai');
  }

  console.log('[v6-tomorrow-arrivals] mounted: /api/v6/tomorrow-arrivals (+/push)');
};
