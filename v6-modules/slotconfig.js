/**
 * 排客容量管理面板（总部专用）
 * 处理函数：render_hq_slotconfig(page)
 *
 * 后端：
 * - GET  /api/hq/slot-config-list  取所有门店容量配置+今日排客数
 * - POST /api/hq/slot-config       保存单个门店 { teamId, maxPerSlot, slotConfig:{newCustomerMinutes,oldCustomerMinutes} }
 *
 * 容量模型：门店同时最多接待 maxPerSlot 位客户；新客/老客各占用 N 分钟。
 * 系统用"区间重叠峰值"判断某时段是否已满。
 */
window.render_hq_slotconfig = async function (page) {
  const DURS = [30, 45, 60, 90, 120, 150, 180];
  const durLabel = (m) => m >= 60 ? (m % 60 === 0 ? (m / 60) + ' 小时' : (Math.floor(m / 60)) + ' 小时' + (m % 60) + ' 分') : m + ' 分钟';

  page.innerHTML = `
    <div class="card">
      <h2>🗓️ 排客容量管理</h2>
      <p class="muted" style="margin-top:4px;">按门店实际接待能力，设置每家店"同一时段最多接几个客户"和"每位客户占用时长"。客服排客时系统会据此自动判断时段是否已满。</p>
    </div>
    <div id="scfgBody" style="margin-top:14px;"><div class="loading">加载门店配置…</div></div>

    <style>
      .scfg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px;}
      .scfg-card{background:var(--paper,#fff);border:1px solid var(--silver-soft,#eef0f3);border-radius:12px;padding:16px;transition:.15s;}
      .scfg-card:hover{box-shadow:0 4px 16px rgba(20,28,56,.06);}
      .scfg-hd{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px;}
      .scfg-nm{font-size:15px;font-weight:600;color:var(--ink,#1a1d24);}
      .scfg-city{font-size:12px;color:var(--ink-mute,#8b919c);margin-left:6px;font-weight:400;}
      .scfg-today{font-size:11px;color:var(--klein,#002fa7);background:var(--klein-soft,#e6ebfa);padding:2px 8px;border-radius:10px;white-space:nowrap;}
      .scfg-lbl{font-size:12px;color:var(--ink-soft,#4a4e57);margin:12px 0 6px;font-weight:500;}
      .scfg-cap{display:flex;align-items:center;gap:10px;}
      .scfg-step{width:30px;height:30px;border-radius:8px;border:1px solid var(--silver,#c0c5cc);background:#fff;font-size:16px;cursor:pointer;color:var(--ink,#1a1d24);display:flex;align-items:center;justify-content:center;user-select:none;}
      .scfg-step:hover{border-color:var(--klein,#002fa7);color:var(--klein,#002fa7);}
      .scfg-capval{font-size:20px;font-weight:700;color:var(--klein,#002fa7);min-width:28px;text-align:center;}
      .scfg-durs{display:flex;flex-wrap:wrap;gap:6px;}
      .scfg-dur{padding:5px 11px;border:1px solid var(--silver,#c0c5cc);border-radius:16px;font-size:12px;cursor:pointer;background:#fff;color:var(--ink-soft,#4a4e57);transition:.12s;}
      .scfg-dur.on{background:var(--klein,#002fa7);border-color:var(--klein,#002fa7);color:#fff;font-weight:500;}
      .scfg-explain{margin-top:12px;padding:9px 11px;background:var(--silver-bg,#f6f7f9);border-radius:8px;font-size:12.5px;color:var(--ink-soft,#4a4e57);line-height:1.6;}
      .scfg-explain b{color:var(--klein,#002fa7);}
      .scfg-save{margin-top:12px;width:100%;height:38px;border:0;border-radius:9px;background:var(--klein,#002fa7);color:#fff;font-size:13px;font-weight:500;cursor:pointer;transition:.15s;}
      .scfg-save:hover{background:var(--klein-deep,#001f6f);}
      .scfg-save.saved{background:#2ba471;}
      .scfg-save:disabled{opacity:.6;cursor:default;}
    </style>
  `;

  const body = document.getElementById('scfgBody');
  const d = await api.get('/api/hq/slot-config-list');
  if (!d.ok) { body.innerHTML = `<div class="card"><div class="muted">加载失败：${esc(d.error || '')}</div></div>`; return; }
  if (!d.stores.length) { body.innerHTML = `<div class="card"><div class="muted">暂无门店</div></div>`; return; }

  // 每个门店维护一份本地编辑态
  const state = {};
  d.stores.forEach(s => { state[s.teamId] = { max: s.maxPerSlot, nu: s.newCustomerMinutes, old: s.oldCustomerMinutes }; });

  function explainText(st) {
    // 用业务语言解读：同时最多 max 人；新客占 nu 分，老客占 old 分
    return `本店<b>同一时段最多同时接待 ${st.max} 位</b>客户。<br>`
      + `每位<b>新客占用 ${durLabel(st.nu)}</b>、<b>老客占用 ${durLabel(st.old)}</b>。<br>`
      + `例如：${st.max === 1 ? `${durLabel(st.nu)}内只能接 1 位新客` : `同一时刻挤满 ${st.max} 位后，需等有人做完才能再排`}。`;
  }

  function cardHtml(s) {
    const st = state[s.teamId];
    const durBtns = (val, key) => DURS.map(m =>
      `<span class="scfg-dur ${m === val ? 'on' : ''}" data-store="${s.teamId}" data-key="${key}" data-min="${m}">${durLabel(m)}</span>`
    ).join('');
    return `<div class="scfg-card" data-store="${s.teamId}">
      <div class="scfg-hd">
        <div><span class="scfg-nm">${esc(s.name)}</span>${s.city ? `<span class="scfg-city">${esc(s.city)}</span>` : ''}</div>
        <span class="scfg-today">今日已排 ${s.todayCount} 单</span>
      </div>

      <div class="scfg-lbl">同一时段最多同时接待</div>
      <div class="scfg-cap">
        <span class="scfg-step" data-store="${s.teamId}" data-act="minus">−</span>
        <span class="scfg-capval" id="cap-${s.teamId}">${st.max}</span>
        <span class="scfg-step" data-store="${s.teamId}" data-act="plus">＋</span>
        <span style="font-size:13px;color:var(--ink-mute,#8b919c);">位客户</span>
      </div>

      <div class="scfg-lbl">新客单人时长</div>
      <div class="scfg-durs" id="durs-nu-${s.teamId}">${durBtns(st.nu, 'nu')}</div>

      <div class="scfg-lbl">老客单人时长</div>
      <div class="scfg-durs" id="durs-old-${s.teamId}">${durBtns(st.old, 'old')}</div>

      <div class="scfg-explain" id="exp-${s.teamId}">${explainText(st)}</div>

      <button class="scfg-save" data-store="${s.teamId}">保存此门店设置</button>
    </div>`;
  }

  body.innerHTML = `<div class="scfg-grid">${d.stores.map(cardHtml).join('')}</div>`;

  // ---- 交互绑定 ----
  function refreshCard(teamId) {
    const st = state[teamId];
    document.getElementById('cap-' + teamId).textContent = st.max;
    document.getElementById('exp-' + teamId).innerHTML = explainText(st);
    // 时长按钮高亮
    document.querySelectorAll(`#durs-nu-${teamId} .scfg-dur`).forEach(b => b.classList.toggle('on', +b.dataset.min === st.nu));
    document.querySelectorAll(`#durs-old-${teamId} .scfg-dur`).forEach(b => b.classList.toggle('on', +b.dataset.min === st.old));
    // 改动后保存按钮恢复
    const btn = document.querySelector(`.scfg-save[data-store="${teamId}"]`);
    if (btn) { btn.classList.remove('saved'); btn.textContent = '保存此门店设置'; }
  }

  // 加减容量
  body.querySelectorAll('.scfg-step').forEach(el => {
    el.onclick = () => {
      const id = el.dataset.store, act = el.dataset.act;
      const st = state[id];
      if (act === 'plus') st.max = Math.min(20, st.max + 1);
      else st.max = Math.max(1, st.max - 1);
      refreshCard(id);
    };
  });

  // 时长选择
  body.querySelectorAll('.scfg-dur').forEach(el => {
    el.onclick = () => {
      const id = el.dataset.store, key = el.dataset.key, min = +el.dataset.min;
      if (key === 'nu') state[id].nu = min; else state[id].old = min;
      refreshCard(id);
    };
  });

  // 保存
  body.querySelectorAll('.scfg-save').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.store;
      const st = state[id];
      btn.disabled = true; btn.textContent = '保存中…';
      const r = await api.post('/api/hq/slot-config', {
        teamId: id,
        maxPerSlot: st.max,
        slotConfig: { newCustomerMinutes: st.nu, oldCustomerMinutes: st.old },
      });
      btn.disabled = false;
      if (r.ok) {
        btn.classList.add('saved'); btn.textContent = '✓ 已保存';
        setTimeout(() => { btn.classList.remove('saved'); btn.textContent = '保存此门店设置'; }, 2500);
      } else {
        btn.textContent = '✗ 保存失败'; alert('保存失败：' + (r.error || ''));
        setTimeout(() => { btn.textContent = '保存此门店设置'; }, 2000);
      }
    };
  });
};
