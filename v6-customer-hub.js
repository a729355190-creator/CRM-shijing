// ============================================================
// v6-customer-hub.js  客户中心（Customer Hub）后端模块
// 插件式零侵入：server.js 仅 require 一行
// 数据源：shijing_wecom_customers(主档) + customer_events + deals + deal_contributors
// 权限三道墙：业务线之间不通 / 团队门店之间不通 / 总部穿透
// ============================================================
module.exports = function (app, db, deps) {
  const v6Required = deps.v6Required || ((req, res, next) => next());
  const v6HQRequired = deps.v6HQRequired || ((req, res, next) => next());
  const getConfig = deps.getConfig || (() => ({}));

  // ---- 工具：取团队配置（门店/客服归属城市等）----
  function teams() {
    try {
      const row = db.prepare("SELECT data FROM shijing_config WHERE id='main'").get();
      return row ? (JSON.parse(row.data).teams || {}) : {};
    } catch { return {}; }
  }

  // ---- 取某客服 wecomUserid（用于"只看自己名下好友"）----
  function staffWecomId(user) {
    if (!user) return null;
    try {
      const s = db.prepare('SELECT wecomUserid FROM shijing_staff WHERE id=? OR name=?').get(user.username, user.realName);
      return s ? s.wecomUserid : null;
    } catch { return null; }
  }

  // ---- 客户可见范围（三道墙）----
  // hq: 全部; cs: 自己名下好友(follow_userid); store: 本店客户(store_id=自己门店)
  function visibleScope(user) {
    if (!user || user.role === 'hq') return { all: true };
    if (user.role === 'cs') {
      const wid = staffWecomId(user);
      return { followUserid: wid, csTeamId: user.csTeamId || user.teamId };
    }
    if (user.role === 'store') {
      return { storeId: user.storeTeamId || user.teamId };
    }
    return { none: true }; // 投放等角色：不开放客户档案
  }

  function applyScope(list, scope) {
    if (scope.all) return list;
    if (scope.none) return [];
    if (scope.followUserid !== undefined) {
      // 客服：只看自己名下好友（follow_userid 匹配）
      return list.filter(c => scope.followUserid && c.follow_userid === scope.followUserid);
    }
    if (scope.storeId) {
      return list.filter(c => c.store_id === scope.storeId);
    }
    return [];
  }

  // ============ 1. 客户列表（搜索 + 分页）============
  app.get('/api/hub/customers', v6Required, (req, res) => {
    try {
      const user = req.v6User;
      const scope = visibleScope(user);
      const kw = (req.query.kw || '').trim();
      const stage = (req.query.stage || '').trim();
      const page = Math.max(1, parseInt(req.query.page || '1', 10));
      const size = Math.min(100, Math.max(1, parseInt(req.query.size || '20', 10)));

      let all = db.prepare('SELECT external_userid, name, real_name, phone, avatar, follow_userid, source_city, stage, store_id, add_time, lost FROM shijing_wecom_customers').all();
      all = applyScope(all, scope);

      if (kw) {
        const k = kw.toLowerCase();
        all = all.filter(c =>
          (c.name && c.name.toLowerCase().includes(k)) ||
          (c.real_name && c.real_name.toLowerCase().includes(k)) ||
          (c.phone && c.phone.includes(kw))
        );
      }
      if (stage) all = all.filter(c => c.stage === stage);

      all.sort((a, b) => (b.add_time || 0) - (a.add_time || 0));
      const total = all.length;
      const items = all.slice((page - 1) * size, page * size);
      res.json({ ok: true, total, page, size, items });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ============ 2. 单客户档案（基本信息 + 事件流 + 成交）============
  app.get('/api/hub/customer/:ext', v6Required, (req, res) => {
    try {
      const user = req.v6User;
      const scope = visibleScope(user);
      const ext = req.params.ext;

      const c = db.prepare('SELECT * FROM shijing_wecom_customers WHERE external_userid=?').get(ext);
      if (!c) return res.status(404).json({ ok: false, error: 'not found' });
      // 权限校验：该客户是否在可见范围
      if (applyScope([c], scope).length === 0) return res.status(403).json({ ok: false, error: 'no permission' });

      const events = db.prepare('SELECT * FROM shijing_customer_events WHERE external_userid=? ORDER BY occurred_at DESC').all(ext);
      const dealsRows = db.prepare('SELECT * FROM shijing_deals WHERE external_userid=? ORDER BY dealt_at DESC').all(ext);
      // 贡献者
      const dealIds = dealsRows.map(d => d.id);
      let contribs = [];
      if (dealIds.length) {
        const ph = dealIds.map(() => '?').join(',');
        contribs = db.prepare(`SELECT * FROM shijing_deal_contributors WHERE deal_id IN (${ph})`).all(...dealIds);
      }
      const deals = dealsRows.map(d => ({ ...d, contributors: contribs.filter(x => x.deal_id === d.id) }));

      // 客服归属名（friendly）
      let followName = c.follow_userid || '';
      try {
        const s = db.prepare('SELECT name FROM shijing_staff WHERE wecomUserid=?').get(c.follow_userid);
        if (s) followName = s.name;
      } catch {}

      res.json({
        ok: true,
        customer: {
          external_userid: c.external_userid,
          name: c.name, real_name: c.real_name, phone: c.phone, avatar: c.avatar,
          source_city: c.source_city, stage: c.stage, store_id: c.store_id,
          follow_userid: c.follow_userid, follow_name: followName,
          tags: c.tags, remark: c.remark, add_time: c.add_time, lost: c.lost,
        },
        events, deals,
        totalDealAmount: deals.filter(d => d.kind !== 'deposit').reduce((s, d) => s + (d.amount || 0), 0),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ============ 3. 客户统计（按阶段/城市）============
  app.get('/api/hub/stats', v6Required, (req, res) => {
    try {
      const scope = visibleScope(req.v6User);
      let all = db.prepare('SELECT stage, source_city, lost FROM shijing_wecom_customers').all();
      // 统计也要按可见范围；为简化，HQ全量，其余复用列表逻辑
      if (!scope.all) {
        let full = db.prepare('SELECT external_userid, follow_userid, store_id, stage, source_city, lost FROM shijing_wecom_customers').all();
        all = applyScope(full, scope);
      }
      const byStage = {}, byCity = {};
      let active = 0, lost = 0;
      for (const c of all) {
        byStage[c.stage || 'lead'] = (byStage[c.stage || 'lead'] || 0) + 1;
        if (c.source_city) byCity[c.source_city] = (byCity[c.source_city] || 0) + 1;
        if (c.lost) lost++; else active++;
      }
      res.json({ ok: true, total: all.length, active, lost, byStage, byCity });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  console.log('[v6-customer-hub] mounted: /api/hub/customers, /api/hub/customer/:ext, /api/hub/stats');
};
