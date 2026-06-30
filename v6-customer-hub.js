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
  // 匹配优先级：username(最稳定) > realName > id，任一命中即可
  // 注：登录账号 username 与 staff.id 常一致(如 zhouxiaoyu)，realName 与 staff.name 一致(如 WP-ZXY)
  function staffWecomId(user) {
    if (!user) return null;
    try {
      const s = db.prepare(
        'SELECT wecomUserid FROM shijing_staff WHERE id=? OR id=? OR name=? OR name=?'
      ).get(user.username, user.id, user.realName, user.username);
      return s && s.wecomUserid ? s.wecomUserid : null;
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

  // ============ 4. 客服企微映射管理（仅总部）============
  // 列出所有客服账号 + 当前企微映射 + 可分配的企微号清单
  app.get('/api/hub/cs-mapping', v6HQRequired, (req, res) => {
    try {
      // 所有 cs 角色登录用户
      const users = db.prepare('SELECT id, data FROM shijing_users').all()
        .map(r => { try { const d = JSON.parse(r.data); return { id: r.id, ...d }; } catch { return null; } })
        .filter(u => u && u.role === 'cs');
      // staff 映射
      const staffList = db.prepare('SELECT id, name, wecomUserid FROM shijing_staff').all();
      const rows = users.map(u => {
        const s = staffList.find(x => x.id === u.username || x.id === u.id || x.name === u.realName || x.name === u.username);
        return {
          username: u.username, realName: u.realName, csTeamId: u.csTeamId || u.teamId,
          wecomUserid: s ? s.wecomUserid : null, staffId: s ? s.id : null,
        };
      });
      // 企微号清单(带客户数)
      const wecomList = db.prepare(`SELECT follow_userid AS wecomUserid, COUNT(*) AS customerCount
        FROM shijing_wecom_customers WHERE follow_userid IS NOT NULL AND follow_userid <> '' GROUP BY follow_userid`).all();
      res.json({ ok: true, mappings: rows, wecomList });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 设置某客服的企微映射（仅总部）
  app.post('/api/hub/cs-mapping', v6HQRequired, (req, res) => {
    try {
      const { username, realName, wecomUserid, csTeamId } = req.body || {};
      if (!username) return res.json({ ok: false, error: '缺少 username' });
      const now = Date.now();
      // 以 username 作为 staff.id（稳定关联）；upsert
      const exist = db.prepare('SELECT id FROM shijing_staff WHERE id=?').get(username);
      if (exist) {
        db.prepare('UPDATE shijing_staff SET name=?, wecomUserid=?, teamId=?, role=?, updatedAt=? WHERE id=?')
          .run(realName || username, wecomUserid || '', csTeamId || '', 'cs', now, username);
      } else {
        db.prepare('INSERT INTO shijing_staff (id, name, teamId, role, wecomUserid, active, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?)')
          .run(username, realName || username, csTeamId || '', 'cs', wecomUserid || '', now, now);
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  console.log('[v6-customer-hub] mounted: /api/hub/customers, /api/hub/customer/:ext, /api/hub/stats, /api/hub/cs-mapping');
};
