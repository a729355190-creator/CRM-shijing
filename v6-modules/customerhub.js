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
    const r = await fetch('/api/hub/' + path, { credentials: 'same-origin' });
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
      <div id="hubDetail"></div>
      <style>
        .hub-input{padding:9px 12px;border:1px solid #d9dde3;border-radius:8px;font-size:16px;background:#fff;}
        .hub-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;}
        .hub-kpi{background:#f7f8fa;border-radius:10px;padding:12px 14px;}
        .hub-kpi .lbl{font-size:13px;color:#8a9099;}
        .hub-kpi .val{font-size:22px;font-weight:600;color:#1f2329;margin-top:2px;}
        .hub-row{display:flex;align-items:center;justify-content:space-between;padding:11px 13px;border:1px solid #eef0f3;border-radius:10px;margin-bottom:8px;cursor:pointer;transition:.15s;}
        .hub-row:hover{background:#f7f8fa;border-color:#d9dde3;}
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
      </style>`;

    // 统计
    const stats = await hubApi('stats');
    if (stats.ok) {
      const st = stats.byStage || {};
      document.getElementById('hubStats').innerHTML = `
        <div class="hub-kpi"><div class="lbl">客户总数</div><div class="val">${stats.total}</div></div>
        <div class="hub-kpi"><div class="lbl">线索</div><div class="val">${st.lead || 0}</div></div>
        <div class="hub-kpi"><div class="lbl">已定金</div><div class="val">${st.deposit || 0}</div></div>
        <div class="hub-kpi"><div class="lbl">已成单</div><div class="val">${st.dealt || 0}</div></div>
        <div class="hub-kpi"><div class="lbl">复购</div><div class="val">${st.repurchase || 0}</div></div>`;
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
          return `<div class="hub-row" data-ext="${esc(c.external_userid)}">
            <div style="display:flex;align-items:center;min-width:0;">
              ${c.avatar ? `<img class="hub-av" src="${esc(c.avatar)}"/>` : `<div class="hub-av"></div>`}
              <div style="min-width:0;">
                <div><span class="hub-nm">${esc(c.real_name || c.name || '(未命名)')}</span>${c.phone ? `<span class="hub-ph">${esc(c.phone)}</span>` : ''}</div>
                <div style="font-size:12px;color:#8a9099;margin-top:2px;">${esc(c.source_city || '')} ${c.name && c.real_name ? '· ' + esc(c.name) : ''}</div>
              </div>
            </div>
            <span class="hub-badge" style="background:${STAGE_COLOR[stg]}">${STAGE_LABEL[stg]}</span>
          </div>`;
        }).join('');
        box.querySelectorAll('.hub-row').forEach(el => el.onclick = () => showDetail(el.dataset.ext));
      }
      // 分页
      const totalPage = Math.ceil(data.total / data.size) || 1;
      document.getElementById('hubPager').innerHTML = totalPage > 1
        ? `<span class="hub-pgbtn" id="hubPrev">上一页</span> ${page_}/${totalPage} <span class="hub-pgbtn" id="hubNext">下一页</span>` : '';
      const prev = document.getElementById('hubPrev'), next = document.getElementById('hubNext');
      if (prev) prev.onclick = () => { if (page_ > 1) { page_--; loadList(); } };
      if (next) next.onclick = () => { if (page_ < totalPage) { page_++; loadList(); } };
    }

    async function showDetail(ext) {
      const box = document.getElementById('hubDetail');
      box.innerHTML = `<div class="card" style="margin-top:14px;"><div class="loading">加载档案…</div></div>`;
      box.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const d = await hubApi('customer/' + encodeURIComponent(ext));
      if (!d.ok) { box.innerHTML = `<div class="card" style="margin-top:14px;"><div class="muted">加载失败：${esc(d.error)}</div></div>`; return; }
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
      }).join('') : `<div class="muted" style="color:#8a9099;font-size:13px;">暂无事件记录（历史事件回填将在后续阶段补充）</div>`;

      const dealsHtml = (d.deals && d.deals.length) ? d.deals.map(dl =>
        `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0f1f3;">
          <span>${esc(dl.project || dl.kind || '成交')} <span style="font-size:12px;color:#8a9099;">${fmtTs(dl.dealt_at)}</span></span>
          <span style="font-weight:500;">¥${dl.amount || 0}</span>
        </div>`).join('') : `<div class="muted" style="color:#8a9099;font-size:13px;">暂无成交记录</div>`;

      box.innerHTML = `<div class="card" style="margin-top:14px;">
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
    }

    document.getElementById('hubSearch').oninput = () => { page_ = 1; loadList(); };
    document.getElementById('hubStage').onchange = () => { page_ = 1; loadList(); };
    loadList();
  }

  window.render_hq_customerhub = renderHub;
  window.render_store_customerhub = renderHub;
  window.render_cs_customerhub = renderHub;
})();
