/* ============================================================
 * V6 模块：客户中心档案（Customer Hub）
 * 处理函数：render_hq_customerhub(page) / render_store_customerhub / render_cs_customerhub
 * 接口：/api/hub/{stats,customers,customer/:ext}
 * 数据源：客户中心新模型（wecom_customers + customer_events + deals）
 * ============================================================ */
(function () {
  const STAGE_LABEL = {
    lead: '线索', deposit: '已定金', scheduled: '已排期',
    arrived: '已到店', dealt: '已成单', repurchase: '复购', lost: '流失'
  };
  const STAGE_COLOR = {
    lead: '#8a9099', deposit: '#3370ff', scheduled: '#7a5af0',
    arrived: '#ff8c1a', dealt: '#2ba471', repurchase: '#e23b3b', lost: '#b0b4ba'
  };
  const EVENT_LABEL = {
    added: '加粉', chat: '沟通', deposit: '缴定金', scheduled: '排期',
    arrived: '到店', no_show: '爽约', dealt: '成单', repurchase: '复购', lost: '流失'
  };

  async function hubApi(path) {
    const sep = path.indexOf('?') >= 0 ? '&' : '?';
    const r = await fetch('/api/hub/' + path + sep + '_t=' + Date.now(), { credentials: 'same-origin', cache: 'no-store' });
    return r.json();
  }
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function fmtTs(ts) {
    if (!ts) return '-';
    const d = new Date(ts < 2e10 ? ts * 1000 : ts);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  async function renderHub(page) {
    page.innerHTML = `
      <div id="hubStats" class="hub-stats"></div>
      <div class="card" style="margin-top:14px;">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <input type="text" id="hubSearch" class="hub-input" placeholder="搜索 姓名 / 手机号 / 微信昵称…" style="flex:1;min-width:200px;" />
          <select id="hubStage" class="hub-input">
            <option value="">全部阶段</option>
            ${Object.keys(STAGE_LABEL).map(k => `<option value="${k}">${STAGE_LABEL[k]}</option>`).join('')}
          </select>
          <span class="muted" id="hubCount" style="font-size:13px;color:#8a9099;"></span>
        </div>
        <div id="hubList" style="margin-top:12px;"><div class="loading">加载中…</div></div>
        <div id="hubPager" style="margin-top:12px;text-align:center;"></div>
      </div>
      <style>
        .hub-input{padding:9px 12px;border:1px solid #d9dde3;border-radius:8px;font-size:16px;background:#fff;}
        .hub-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;}
        .hub-kpi{background:#f7f8fa;border-radius:10px;padding:12px 14px;}
        .hub-kpi .lbl{font-size:13px;color:#8a9099;}
        .hub-kpi .val{font-size:22px;font-weight:600;color:#1f2329;margin-top:2px;}
        .hub-item{border:1px solid #eef0f3;border-radius:10px;margin-bottom:8px;overflow:hidden;transition:.15s;}
        .hub-item.open{border-color:#c9d2ec;box-shadow:0 2px 10px rgba(0,47,167,.06);}
        .hub-row{display:flex;align-items:center;justify-content:space-between;padding:11px 13px;cursor:pointer;transition:.15s;}
        .hub-row:hover{background:#f7f8fa;}
        .hub-item.open>.hub-row{background:#f4f6fc;}
        .hub-caret{color:#a4abb6;font-size:12px;transition:transform .18s;display:inline-block;}
        .hub-item.open .hub-caret{color:#002fa7;}
        .hub-inline{border-top:1px solid #eef0f3;background:#fcfcfd;animation:hubFade .2s ease;}
        .hub-inline-load{padding:20px;text-align:center;}
        .hub-inline-body{padding:16px 16px 18px;}
        @keyframes hubFade{from{opacity:0;transform:translateY(-4px);}to{opacity:1;transform:translateY(0);}}
        .hub-av{width:34px;height:34px;border-radius:50%;background:#eef0f3;margin-right:10px;object-fit:cover;flex:none;}
        .hub-nm{font-weight:500;font-size:14px;}
        .hub-ph{font-size:12px;color:#8a9099;margin-left:8px;}
        .hub-badge{display:inline-block;padding:1px 9px;border-radius:10px;font-size:11px;color:#fff;}
        .hub-pgbtn{display:inline-block;padding:6px 14px;margin:0 4px;border:1px solid #d9dde3;border-radius:8px;cursor:pointer;font-size:13px;background:#fff;}
        .hub-pgbtn:hover{background:#f7f8fa;}
        .hub-tl{position:relative;padding-left:24px;margin-top:10px;}
        .hub-tl::before{content:'';position:absolute;left:7px;top:4px;bottom:4px;width:2px;background:#eef0f3;}
        .hub-tli{position:relative;margin-bottom:16px;}
        .hub-tld{position:absolute;left:-21px;top:3px;width:11px;height:11px;border-radius:50%;border:2px solid #fff;}
        .hub-tlt{font-size:13px;font-weight:500;color:#1f2329;}
        .hub-tlm{font-size:12px;color:#8a9099;margin-top:1px;}
        .hub-topkpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;}
        .hub-panels{display:grid;grid-template-columns:1.4fr 1fr;gap:14px;margin-top:14px;}
        @media(max-width:760px){.hub-panels{grid-template-columns:1fr;}}
        .hub-panel{padding:16px 18px;}
        .panel-tt{font-size:14px;font-weight:600;color:#1f2329;margin-bottom:14px;}
        .panel-sub{font-size:12px;font-weight:400;color:#8a9099;}
        .fn-row{display:flex;align-items:center;gap:10px;margin-bottom:10px;}
        .fn-lbl{width:52px;font-size:13px;color:#5a6068;flex:none;text-align:right;}
        .fn-bar-wrap{flex:1;background:#f2f4f7;border-radius:6px;overflow:hidden;height:26px;}
        .fn-bar{height:26px;border-radius:6px;display:flex;align-items:center;justify-content:flex-end;padding-right:8px;min-width:24px;transition:width .5s ease;}
        .fn-val{color:#fff;font-size:12px;font-weight:600;}
        .fn-conv{width:48px;font-size:12px;color:#8a9099;flex:none;text-align:left;}
        .ct-row{display:flex;align-items:center;gap:10px;margin-bottom:9px;}
        .ct-lbl{width:42px;font-size:13px;color:#5a6068;flex:none;text-align:right;}
        .ct-bar-wrap{flex:1;background:#f2f4f7;border-radius:5px;overflow:hidden;height:18px;}
        .ct-bar{height:18px;border-radius:5px;background:linear-gradient(90deg,#3370ff,#5a8bff);transition:width .5s ease;}
        .ct-val{width:40px;font-size:12px;color:#5a6068;flex:none;text-align:left;}
      </style>`;

    // 统计 + 转化漏斗 + 城市分布
    const stats = await hubApi('stats');
    if (stats.ok) {
      const st = stats.byStage || {};
      const total = stats.total || 0;
      // 漏斗按"累计到达"口径：到达某阶段=该阶段及更深阶段的人数之和（业务漏斗只往下走）
      const order = ['lead', 'deposit', 'scheduled', 'arrived', 'dealt', 'repurchase'];
      const raw = {};
      order.forEach(k => raw[k] = st[k] || 0);
      // 累计：每个阶段 = 自身 + 后续所有更深阶段
      const cum = {};
      for (let i = 0; i < order.length; i++) {
        let s = 0;
        for (let j = i; j < order.length; j++) s += raw[order[j]];
        cum[order[i]] = s;
      }
      const funnelSteps = [
        { k: 'lead', t: '线索' }, { k: 'deposit', t: '已定金' }, { k: 'scheduled', t: '已排期' },
        { k: 'arrived', t: '已到店' }, { k: 'dealt', t: '已成单' }, { k: 'repurchase', t: '复购' }
      ];
      const maxV = cum['lead'] || total || 1;
      const funnelHtml = funnelSteps.map((s, i) => {
        const v = cum[s.k] || 0;
        const pct = maxV > 0 ? (v / maxV * 100) : 0;
        // 相对上一阶段的转化率
        const prevV = i > 0 ? (cum[funnelSteps[i - 1].k] || 0) : 0;
        const convR = (i > 0 && prevV > 0) ? (v / prevV * 100).toFixed(1) + '%' : (i === 0 ? '—' : '0%');
        return `<div class="fn-row">
          <div class="fn-lbl">${s.t}</div>
          <div class="fn-bar-wrap">
            <div class="fn-bar" style="width:${Math.max(pct, 2)}%;background:${STAGE_COLOR[s.k]};">
              <span class="fn-val">${v}</span>
            </div>
          </div>
          <div class="fn-conv">${convR}</div>
        </div>`;
      }).join('');

      const cities = Object.entries(stats.byCity || {}).sort((a, b) => b[1] - a[1]);
      const cityMax = cities.length ? cities[0][1] : 1;
      const cityHtml = cities.length ? cities.map(([city, n]) => `
        <div class="ct-row">
          <div class="ct-lbl">${esc(city)}</div>
          <div class="ct-bar-wrap"><div class="ct-bar" style="width:${Math.max(n / cityMax * 100, 3)}%;"></div></div>
          <div class="ct-val">${n}</div>
        </div>`).join('') : '<div class="muted" style="color:#8a9099;font-size:13px;">暂无城市数据</div>';

      document.getElementById('hubStats').innerHTML = `
        <div class="hub-topkpi">
          <div class="hub-kpi"><div class="lbl">客户总数</div><div class="val">${total}</div></div>
          <div class="hub-kpi"><div class="lbl">活跃</div><div class="val" style="color:#2ba471;">${stats.active || 0}</div></div>
          <div class="hub-kpi"><div class="lbl">流失</div><div class="val" style="color:#b0b4ba;">${stats.lost || 0}</div></div>
          <div class="hub-kpi"><div class="lbl">成单转化</div><div class="val" style="color:#e23b3b;">${maxV > 0 ? (((cum['dealt'] || 0) / maxV) * 100).toFixed(1) : 0}%</div></div>
        </div>
        <div class="hub-panels">
          <div class="card hub-panel">
            <div class="panel-tt">转化漏斗 <span class="panel-sub">（累计到达口径）</span></div>
            <div class="fn-wrap">${funnelHtml}</div>
          </div>
          <div class="card hub-panel">
            <div class="panel-tt">城市分布</div>
            <div class="ct-wrap">${cityHtml}</div>
          </div>
        </div>`;
    }

    let page_ = 1;
    async function loadList() {
      const kw = document.getElementById('hubSearch').value.trim();
      const stage = document.getElementById('hubStage').value;
      const data = await hubApi(`customers?kw=${encodeURIComponent(kw)}&stage=${stage}&page=${page_}&size=20`);
      const box = document.getElementById('hubList');
      if (!data.ok) { box.innerHTML = `<div class="muted">加载失败：${esc(data.error)}</div>`; return; }
      document.getElementById('hubCount').textContent = `共 ${data.total} 位客户`;
      if (!data.items.length) { box.innerHTML = `<div class="muted" style="padding:20px;text-align:center;color:#8a9099;">没有匹配的客户</div>`; }
      else {
        box.innerHTML = data.items.map(c => {
          const stg = c.stage || 'lead';
          return `<div class="hub-item" data-ext="${esc(c.external_userid)}">
            <div class="hub-row">
              <div style="display:flex;align-items:center;min-width:0;">
                ${c.avatar ? `<img class="hub-av" src="${esc(c.avatar)}"/>` : `<div class="hub-av"></div>`}
                <div style="min-width:0;">
                  <div><span class="hub-nm">${esc(c.real_name || c.name || '(未命名)')}</span>${c.phone ? `<span class="hub-ph">${esc(c.phone)}</span>` : ''}</div>
                  <div style="font-size:12px;color:#8a9099;margin-top:2px;">${esc(c.source_city || '')} ${c.name && c.real_name ? '· ' + esc(c.name) : ''}</div>
                </div>
              </div>
              <span style="display:flex;align-items:center;gap:8px;">
                <span class="hub-badge" style="background:${STAGE_COLOR[stg]}">${STAGE_LABEL[stg]}</span>
                <span class="hub-caret">▸</span>
              </span>
            </div>
            <div class="hub-inline" style="display:none;"></div>
          </div>`;
        }).join('');
        box.querySelectorAll('.hub-item').forEach(item => {
          const row = item.querySelector('.hub-row');
          row.onclick = () => toggleDetail(item);
        });
      }
      // 分页
      const totalPage = Math.ceil(data.total / data.size) || 1;
      document.getElementById('hubPager').innerHTML = totalPage > 1
        ? `<span class="hub-pgbtn" id="hubPrev">上一页</span> ${page_}/${totalPage} <span class="hub-pgbtn" id="hubNext">下一页</span>` : '';
      const prev = document.getElementById('hubPrev'), next = document.getElementById('hubNext');
      if (prev) prev.onclick = () => { if (page_ > 1) { page_--; loadList(); } };
      if (next) next.onclick = () => { if (page_ < totalPage) { page_++; loadList(); } };
    }

    async function toggleDetail(item) {
      const ext = item.dataset.ext;
      const box = item.querySelector('.hub-inline');
      const caret = item.querySelector('.hub-caret');
      // 已展开 → 收起
      if (item.classList.contains('open')) {
        item.classList.remove('open');
        box.style.display = 'none';
        box.innerHTML = '';
        if (caret) caret.textContent = '▸';
        return;
      }
      // 先收起同列表其它已展开的行（每次只展开一个，避免页面过长）
      const list = document.getElementById('hubList');
      list.querySelectorAll('.hub-item.open').forEach(other => {
        other.classList.remove('open');
        const ob = other.querySelector('.hub-inline');
        if (ob) { ob.style.display = 'none'; ob.innerHTML = ''; }
        const oc = other.querySelector('.hub-caret');
        if (oc) oc.textContent = '▸';
      });
      // 展开当前
      item.classList.add('open');
      if (caret) caret.textContent = '▾';
      box.style.display = 'block';
      box.innerHTML = `<div class="hub-inline-load"><div class="loading">加载档案…</div></div>`;
      const d = await hubApi('customer/' + encodeURIComponent(ext));
      if (!d.ok) { box.innerHTML = `<div class="hub-inline-load"><div class="muted">加载失败：${esc(d.error)}</div></div>`; return; }
      const c = d.customer;
      const stg = c.stage || 'lead';
      const eventsHtml = (d.events && d.events.length) ? d.events.map(e => {
        let extra = '';
        try { const p = e.payload ? JSON.parse(e.payload) : null; if (p && p.amount) extra = ` ¥${p.amount}`; if (p && p.project) extra += ' · ' + esc(p.project); } catch {}
        return `<div class="hub-tli">
          <div class="hub-tld" style="background:${STAGE_COLOR[e.type] || '#8a9099'}"></div>
          <div class="hub-tlt">${EVENT_LABEL[e.type] || esc(e.type)}${extra}</div>
          <div class="hub-tlm">${fmtTs(e.occurred_at)}${e.actor ? ' · ' + esc(e.actor) : ''}</div>
        </div>`;
      }).join('') : `<div class="muted" style="color:#8a9099;font-size:13px;">暂无事件记录</div>`;

      const dealsHtml = (d.deals && d.deals.length) ? d.deals.map(dl =>
        `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0f1f3;">
          <span>${esc(dl.project || dl.kind || '成交')} <span style="font-size:12px;color:#8a9099;">${fmtTs(dl.dealt_at)}</span></span>
          <span style="font-weight:500;">¥${dl.amount || 0}</span>
        </div>`).join('') : `<div class="muted" style="color:#8a9099;font-size:13px;">暂无成交记录</div>`;

      box.innerHTML = `<div class="hub-inline-body">
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
          ${c.avatar ? `<img class="hub-av" style="width:54px;height:54px;" src="${esc(c.avatar)}"/>` : `<div class="hub-av" style="width:54px;height:54px;"></div>`}
          <div>
            <div style="font-size:18px;font-weight:600;">${esc(c.real_name || c.name || '(未命名)')}
              <span class="hub-badge" style="background:${STAGE_COLOR[stg]};margin-left:8px;">${STAGE_LABEL[stg]}</span></div>
            <div style="font-size:13px;color:#646a73;margin-top:4px;">
              ${c.phone ? '📱 ' + esc(c.phone) + '　' : ''}${c.source_city ? '📍 ' + esc(c.source_city) + '　' : ''}${c.follow_name ? '客服：' + esc(c.follow_name) : ''}
            </div>
            ${c.name && c.real_name ? `<div style="font-size:12px;color:#8a9099;margin-top:2px;">企微昵称：${esc(c.name)}</div>` : ''}
          </div>
          <div style="margin-left:auto;text-align:right;">
            <div style="font-size:12px;color:#8a9099;">累计成交</div>
            <div style="font-size:20px;font-weight:600;color:#2ba471;">¥${d.totalDealAmount || 0}</div>
          </div>
        </div>
        ${c.phone ? `<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">
          <span class="hub-pgbtn hub-add-deal" style="background:#2ba471;color:#fff;border-color:#2ba471;padding:7px 16px;">+ 新增到店/复购</span>
        </div>` : `<div style="margin-top:12px;font-size:12px;color:#e23b3b;">该客户暂无手机号，无法记录到店/复购（需先在排客时绑定手机号）</div>`}
        <div class="hubAddForm" style="display:none;margin-top:12px;padding:14px;background:#f7f8fa;border-radius:10px;"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:18px;">
          <div>
            <div style="font-size:14px;font-weight:500;margin-bottom:6px;">生命周期轨迹</div>
            <div class="hub-tl">${eventsHtml}</div>
          </div>
          <div>
            <div style="font-size:14px;font-weight:500;margin-bottom:6px;">成交记录</div>
            ${dealsHtml}
          </div>
        </div>
      </div>`;

      // 新增到店/复购 表单
      const addBtn = box.querySelector('.hub-add-deal');
      if (addBtn) {
        const formBox = box.querySelector('.hubAddForm');
        addBtn.onclick = () => {
          if (formBox.style.display === 'block') { formBox.style.display = 'none'; return; }
          formBox.style.display = 'block';
          formBox.innerHTML = `
            <div style="font-size:13px;font-weight:500;margin-bottom:10px;">记录本次到店 / 复购（客户：${esc(c.real_name || c.name || '')}）</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
              <div><label style="font-size:12px;color:#646a73;">项目/卡项</label>
                <input id="ad_project" class="hub-input" style="width:100%;font-size:14px;padding:8px 10px;" placeholder="如：面部护理 5次卡"/></div>
              <div><label style="font-size:12px;color:#646a73;">成交金额</label>
                <input id="ad_amount" class="hub-input" type="number" style="width:100%;font-size:14px;padding:8px 10px;" placeholder="0=仅到店未成交"/></div>
              <div><label style="font-size:12px;color:#646a73;">服务人</label>
                <input id="ad_perf" class="hub-input" style="width:100%;font-size:14px;padding:8px 10px;" placeholder="服务人姓名"/></div>
              <div><label style="font-size:12px;color:#646a73;">备注</label>
                <input id="ad_remark" class="hub-input" style="width:100%;font-size:14px;padding:8px 10px;" placeholder="选填"/></div>
            </div>
            <div style="margin-top:10px;display:flex;gap:8px;align-items:center;">
              <span class="hub-pgbtn hub-do-save" style="background:#2ba471;color:#fff;border-color:#2ba471;padding:7px 16px;">保存</span>
              <span class="hub-pgbtn hub-do-cancel" style="padding:7px 16px;">取消</span>
              <span id="ad_msg" style="font-size:13px;"></span>
            </div>`;
          formBox.querySelector('.hub-do-cancel').onclick = () => { formBox.style.display = 'none'; };
          formBox.querySelector('.hub-do-save').onclick = async () => {
            const amount = +formBox.querySelector('#ad_amount').value || 0;
            const body = {
              name: c.real_name || c.name, phone: c.phone,
              isOperated: '是', opAmount: 0,
              isClosed: amount > 0 ? '是' : '否', closedAmount: amount,
              performer: formBox.querySelector('#ad_perf').value.trim(),
              remark: (formBox.querySelector('#ad_project').value.trim() + ' ' + formBox.querySelector('#ad_remark').value.trim()).trim(),
              customerType: '老客',
            };
            const msg = formBox.querySelector('#ad_msg');
            msg.textContent = '保存中…'; msg.style.color = '#8a9099';
            try {
              const r = await fetch('/api/customer/store-visit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
              const j = await r.json();
              if (j.ok) {
                msg.textContent = '✅ 已记录'; msg.style.color = '#2ba471';
                // 重新加载当前行详情（先收起再展开=刷新）
                setTimeout(() => { item.classList.remove('open'); toggleDetail(item); }, 700);
              }
              else { msg.textContent = '❌ ' + j.error; msg.style.color = '#e23b3b'; }
            } catch (e) { msg.textContent = '❌ ' + e.message; msg.style.color = '#e23b3b'; }
          };
        };
      }
    }

    document.getElementById('hubSearch').oninput = () => { page_ = 1; loadList(); };
    document.getElementById('hubStage').onchange = () => { page_ = 1; loadList(); };
    loadList();
  }

  // ============ HQ 专属：客服企微绑定管理 ============
  async function renderCsMapping(page) {
    page.innerHTML = `<div class="card"><div class="loading">加载客服映射…</div></div>`;
    const d = await hubApi('cs-mapping');
    if (!d.ok) { page.innerHTML = `<div class="card"><div class="muted">加载失败：${esc(d.error)}</div></div>`; return; }
    const wecomOpts = `<option value="">未配置</option>` + d.wecomList.map(w =>
      `<option value="${esc(w.wecomUserid)}">${esc(w.wecomUserid)}（${w.customerCount}客户）</option>`).join('');
    page.innerHTML = `
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <div style="font-size:15px;font-weight:500;">客服企微绑定</div>
          <span id="csmapRefresh" class="hub-pgbtn" style="padding:6px 14px;">🔄 刷新客服列表</span>
        </div>
        <div class="muted" style="font-size:12px;color:#8a9099;margin-bottom:14px;">
          绑定后，该客服登录"客户中心"只能看到自己名下的企微好友。一个企微号只应绑一位客服。</div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead><tr style="text-align:left;color:#8a9099;border-bottom:1px solid #eef0f3;">
            <th style="padding:8px 6px;">客服账号</th><th>姓名</th><th>团队</th><th>企微号绑定</th><th></th>
          </tr></thead>
          <tbody>${d.mappings.map((m, i) => `
            <tr style="border-bottom:1px solid #f4f5f7;">
              <td style="padding:9px 6px;font-weight:500;">${esc(m.username)}</td>
              <td>${esc(m.realName || '')}</td>
              <td style="color:#8a9099;">${esc(m.csTeamId || '')}</td>
              <td><select class="hub-input" data-u="${esc(m.username)}" data-rn="${esc(m.realName || '')}" data-tm="${esc(m.csTeamId || '')}" style="font-size:13px;padding:5px 8px;">
                ${wecomOpts.replace(`value="${esc(m.wecomUserid || '')}"`, `value="${esc(m.wecomUserid || '')}" selected`)}
              </select></td>
              <td><span class="hub-pgbtn csmap-save" data-i="${i}" style="padding:5px 12px;">保存</span></td>
            </tr>`).join('')}</tbody>
        </table>
        <div id="csmapMsg" style="margin-top:10px;font-size:13px;"></div>
      </div>
      <style>.hub-input{padding:9px 12px;border:1px solid #d9dde3;border-radius:8px;background:#fff;}
        .hub-pgbtn{display:inline-block;border:1px solid #d9dde3;border-radius:8px;cursor:pointer;font-size:13px;background:#fff;}
        .hub-pgbtn:hover{background:#f7f8fa;}</style>`;
    const _rf = page.querySelector('#csmapRefresh');
    if (_rf) _rf.onclick = () => renderCsMapping(page);
    page.querySelectorAll('.csmap-save').forEach(btn => {
      btn.onclick = async () => {
        const sel = page.querySelectorAll('select.hub-input')[+btn.dataset.i];
        const body = { username: sel.dataset.u, realName: sel.dataset.rn, csTeamId: sel.dataset.tm, wecomUserid: sel.value };
        const r = await fetch('/api/hub/cs-mapping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
        const j = await r.json();
        const msg = document.getElementById('csmapMsg');
        msg.textContent = j.ok ? `✅ ${body.username} 已绑定 ${body.wecomUserid || '（清空）'}` : `❌ ${j.error}`;
        msg.style.color = j.ok ? '#2ba471' : '#e23b3b';
      };
    });
  }

  window.render_hq_customerhub = renderHub;
  window.render_hq_csmapping = renderCsMapping;
  window.render_store_customerhub = renderHub;
  window.render_cs_customerhub = renderHub;
})();
