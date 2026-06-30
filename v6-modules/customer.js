/* ============================================================
 * V6 模块：客户档案 + 旅程（仅总部 hq）
 * 处理函数：render_hq_customer(page)
 * 接口：/api/customer/{stats,search,detail}
 * ============================================================ */
window.render_hq_customer = async function (page) {
  page.innerHTML = `
    <div id="custStats" class="cust-stats"></div>

    <div class="card" style="margin-top:14px;">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        <input type="text" id="custSearch" class="cust-input" placeholder="搜索 手机号 / 姓名 / 微信昵称…" style="flex:1;min-width:200px;" />
        <span class="muted" id="custCount" style="font-size:13px;color:#8a9099;"></span>
      </div>
      <div id="custList" style="margin-top:12px;"><div class="loading">加载中…</div></div>
    </div>

    <div id="custDetail"></div>

    <style>
      .cust-input{padding:9px 12px;border:1px solid #d9dde3;border-radius:8px;font-size:16px;}
      .cust-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;}
      .cust-kpi{background:#f7f8fa;border-radius:8px;padding:12px 14px;}
      .cust-kpi .lbl{font-size:13px;color:#8a9099;}
      .cust-kpi .val{font-size:22px;font-weight:600;color:#1f2329;margin-top:2px;}
      .cust-row{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid #eef0f3;border-radius:8px;margin-bottom:8px;cursor:pointer;transition:.15s;}
      .cust-row:hover{background:#f7f8fa;border-color:#d9dde3;}
      .cust-row .nm{font-weight:500;font-size:14px;}
      .cust-row .ph{font-size:12px;color:#8a9099;margin-left:8px;}
      .cust-row .meta{font-size:12px;color:#646a73;text-align:right;}
      .cust-tag{display:inline-block;padding:1px 7px;border-radius:9px;font-size:11px;margin-left:6px;}
      .tag-repeat{background:#e8f3ff;color:#3370ff;}
      .tag-deal{background:#e8f8f0;color:#2ba471;}
      .tl{position:relative;padding-left:22px;margin-top:6px;}
      .tl::before{content:'';position:absolute;left:6px;top:4px;bottom:4px;width:2px;background:#eef0f3;}
      .tl-item{position:relative;margin-bottom:14px;}
      .tl-dot{position:absolute;left:-19px;top:3px;width:10px;height:10px;border-radius:50%;}
      .tl-t{font-size:13px;font-weight:500;color:#1f2329;}
      .tl-d{font-size:12px;color:#646a73;margin-top:1px;}
      .tl-r{font-size:12px;color:#8a9099;margin-top:1px;}
    </style>
  `;

  const $ = id => document.getElementById(id);

  // 概览
  try {
    const s = await api.get('/api/customer/stats');
    if (s.ok) {
      $('custStats').innerHTML = [
        ['客户总数', s.total],
        ['成交客户', s.dealt],
        ['复购客户', s.repeat],
        ['累计业绩', '¥' + (s.totalLtv || 0).toLocaleString('zh-CN')],
      ].map(([l, v]) => `<div class="cust-kpi"><div class="lbl">${l}</div><div class="val">${v}</div></div>`).join('');
    }
  } catch (e) {}

  let timer = null;
  $('custSearch').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => loadList($('custSearch').value), 300);
  });

  await loadList('');

  async function loadList(q) {
    const el = $('custList');
    try {
      const d = await api.get('/api/customer/search?limit=50&q=' + encodeURIComponent(q || ''));
      if (!d.ok) throw new Error(d.error || '加载失败');
      $('custCount').textContent = '共 ' + d.total + ' 位客户' + (q ? '（已筛选）' : '');
      if (!d.customers.length) { el.innerHTML = '<div class="muted" style="color:#8a9099;font-size:13px;padding:8px;">没有匹配的客户。</div>'; return; }
      el.innerHTML = d.customers.map(c => {
        const tags = (c.arriveCount > 1 ? '<span class="cust-tag tag-repeat">复购×' + c.arriveCount + '</span>' : '')
          + (c.dealCount > 0 ? '<span class="cust-tag tag-deal">成交</span>' : '');
        return `<div class="cust-row" data-key="${esc(c.key)}">
          <div><span class="nm">${esc(c.name || '未命名')}</span><span class="ph">${esc(c.phone || '无手机号')}</span>${tags}</div>
          <div class="meta">到店 ${c.arriveCount} · 业绩 ¥${(c.ltv || 0).toLocaleString('zh-CN')}<br>${esc((c.storeTeams || []).join('/'))}</div>
        </div>`;
      }).join('');
      el.querySelectorAll('.cust-row').forEach(r => r.onclick = () => showDetail(r.dataset.key));
    } catch (e) {
      el.innerHTML = '<div style="color:#d83931;">加载失败：' + esc(e.message) + '</div>';
    }
  }

  async function showDetail(key) {
    const el = $('custDetail');
    el.innerHTML = '<div class="card" style="margin-top:14px;"><div class="loading">加载档案…</div></div>';
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
      const d = await api.get('/api/customer/detail?key=' + encodeURIComponent(key));
      if (!d.ok) throw new Error(d.error || '加载失败');
      const c = d.customer;
      const fmtT = ts => ts ? new Date(ts).toLocaleDateString('zh-CN') : '-';
      const dotColor = e => e.type === 'invite' ? '#378ADD' : (e.title.includes('成交') ? '#2ba471' : '#BA7517');
      const tl = c.events.map(e => {
        const thumbs = (e.photos && e.photos.length)
          ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">${e.photos.map(u => `<img src="${esc(u)}" class="cust-thumb" data-full="${esc(u)}" style="width:64px;height:64px;border-radius:8px;object-fit:cover;border:1px solid #eef0f3;cursor:pointer;">`).join('')}</div>` : '';
        return `<div class="tl-item">
          <div class="tl-dot" style="background:${dotColor(e)}"></div>
          <div class="tl-t">${esc(e.title)} <span style="color:#8a9099;font-weight:400;font-size:11px;">· ${esc(e.date)}</span></div>
          ${e.detail ? `<div class="tl-d">${esc(e.detail)}</div>` : ''}
          ${e.remark ? `<div class="tl-r">${esc(e.remark)}</div>` : ''}
          ${thumbs}
        </div>`;
      }).join('');
      el.innerHTML = `
        <div class="card" style="margin-top:14px;">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
            <div style="width:46px;height:46px;border-radius:50%;background:#e8f3ff;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:18px;color:#3370ff;">${esc((c.name || '?').slice(0, 1))}</div>
            <div style="flex:1;">
              <div style="font-weight:600;font-size:16px;">${esc(c.name || '未命名')} ${c.nickname ? '<span style="font-size:12px;color:#8a9099;font-weight:400;">微信:' + esc(c.nickname) + '</span>' : ''}</div>
              <div style="font-size:13px;color:#646a73;">${esc(c.phone || '无手机号')} ｜ 首次 ${fmtT(c.firstSeen)} ｜ 最近 ${fmtT(c.lastSeen)}</div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px;">
            ${[['邀约', c.inviteCount], ['到店', c.arriveCount], ['成交', c.dealCount], ['累计业绩', '¥' + (c.ltv || 0).toLocaleString('zh-CN')]].map(([l, v]) => `<div style="background:#f7f8fa;border-radius:8px;padding:8px;text-align:center;"><div style="font-size:12px;color:#8a9099;">${l}</div><div style="font-size:16px;font-weight:600;">${v}</div></div>`).join('')}
          </div>
          <div style="font-size:13px;color:#646a73;margin-bottom:6px;">归属：客服 ${esc((c.csTeams || []).join('/') || '-')} ｜ 门店 ${esc((c.storeTeams || []).join('/') || '-')}</div>
          <div style="font-weight:500;font-size:14px;margin:10px 0 4px;">📋 客户旅程</div>
          <div class="tl">${tl || '<div class="muted" style="color:#8a9099;">暂无记录</div>'}</div>
        </div>`;
      el.querySelectorAll('.cust-thumb').forEach(img => img.onclick = () => {
        const l = document.createElement('div');
        l.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:9999;display:flex;align-items:center;justify-content:center';
        l.innerHTML = '<img src="' + img.dataset.full + '" style="max-width:94%;max-height:90%;border-radius:8px">';
        l.onclick = () => l.remove();
        document.body.appendChild(l);
      });
    } catch (e) {
      el.innerHTML = '<div class="card" style="margin-top:14px;color:#d83931;">加载失败：' + esc(e.message) + '</div>';
    }
  }
};
