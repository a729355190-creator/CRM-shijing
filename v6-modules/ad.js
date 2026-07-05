// 投放线 - v2（含真实素材库）
window.render_ad_overview = async function(page) {
  const u = V6.user;
  page.innerHTML = '<div class="loading">数据加载中...</div>';
  await loadAllData();
  const today = todayStr();
  const ad = (DB.ad || []).filter(x => !x.cityName);

  const monthStart = today.slice(0, 8) + '01';
  const monthAd = ad.filter(x => x.date >= monthStart && x.date <= today);
  const monthCost = monthAd.reduce((s, x) => s + (+x.cost || 0), 0);
  const monthFans = monthAd.reduce((s, x) => s + (+x.addFans || 0), 0);
  const monthDeep = monthAd.reduce((s, x) => s + (+x.deepConvert || 0), 0);

  const w7Start = fmtDate(new Date(Date.now() - 6 * 86400000));
  const w7Ad = ad.filter(x => x.date >= w7Start && x.date <= today);
  const w7Cost = w7Ad.reduce((s, x) => s + (+x.cost || 0), 0);
  const w7Fans = w7Ad.reduce((s, x) => s + (+x.addFans || 0), 0);
  const w7Deep = w7Ad.reduce((s, x) => s + (+x.deepConvert || 0), 0);

  const byDay = {};
  w7Ad.forEach(x => {
    if (!byDay[x.date]) byDay[x.date] = { date: x.date, cost: 0, fans: 0, deep: 0 };
    byDay[x.date].cost += +x.cost || 0;
    byDay[x.date].fans += +x.addFans || 0;
    byDay[x.date].deep += +x.deepConvert || 0;
  });
  const dayRows = Object.values(byDay).sort((a, b) => b.date.localeCompare(a.date));

  page.innerHTML = `
    <div class="card" style="background:linear-gradient(135deg,var(--klein),var(--klein-deep));color:#fff;border:0">
      <h2 style="color:#fff;margin:0">${u.realName} 👋</h2>
      <p style="opacity:.85;margin:4px 0 0">投放线 · ${u.teamId === 'ad_1' ? '1 部' : u.teamId === 'ad_2' ? '2 部' : u.teamId}</p>
    </div>

    <div class="card">
      <h3>📈 本月汇总（${monthStart} ~ ${today}）</h3>
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-label">广告消耗</div><div class="kpi-value">${fmtMoney(monthCost)}</div></div>
        <div class="kpi"><div class="kpi-label">加粉数</div><div class="kpi-value">${fmtNum(monthFans)}</div></div>
        <div class="kpi"><div class="kpi-label">加粉成本</div><div class="kpi-value">${monthFans > 0 ? fmtMoney(monthCost / monthFans) : '-'}</div></div>
        <div class="kpi"><div class="kpi-label">高潜成交</div><div class="kpi-value" style="color:var(--klein)">${fmtNum(monthDeep)}</div></div>
        <div class="kpi"><div class="kpi-label">高潜成本</div><div class="kpi-value">${monthDeep > 0 ? fmtMoney(monthCost / monthDeep) : '-'}</div></div>
      </div>
    </div>

    <div class="card">
      <h3>📊 近 7 天汇总</h3>
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-label">7 天消耗</div><div class="kpi-value">${fmtMoney(w7Cost)}</div></div>
        <div class="kpi"><div class="kpi-label">7 天加粉</div><div class="kpi-value">${fmtNum(w7Fans)}</div></div>
        <div class="kpi"><div class="kpi-label">加粉成本</div><div class="kpi-value">${w7Fans > 0 ? fmtMoney(w7Cost / w7Fans) : '-'}</div></div>
        <div class="kpi"><div class="kpi-label">高潜成交</div><div class="kpi-value">${fmtNum(w7Deep)}</div></div>
        <div class="kpi"><div class="kpi-label">高潜成本</div><div class="kpi-value">${w7Deep > 0 ? fmtMoney(w7Cost / w7Deep) : '-'}</div></div>
      </div>
    </div>

    <div class="card">
      <h3>📅 近 7 天每日明细</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>日期</th><th style="text-align:right">消耗</th><th style="text-align:right">加粉</th><th style="text-align:right">加粉成本</th><th style="text-align:right">高潜</th><th style="text-align:right">高潜成本</th></tr></thead>
        <tbody>
          ${dayRows.map(d => `<tr>
            <td>${d.date}</td>
            <td style="text-align:right">${fmtMoney(d.cost)}</td>
            <td style="text-align:right">${d.fans}</td>
            <td style="text-align:right">${d.fans > 0 ? fmtMoney(d.cost / d.fans) : '-'}</td>
            <td style="text-align:right;color:var(--klein)">${d.deep}</td>
            <td style="text-align:right">${d.deep > 0 ? fmtMoney(d.cost / d.deep) : '-'}</td>
          </tr>`).join('') || '<tr><td colspan="6" class="muted" style="text-align:center;padding:24px">暂无数据</td></tr>'}
        </tbody>
      </table></div>
    </div>
  `;
};


// === 素材库（合并已投放性能 + 文件预览 + AI 文案）===
window.render_ad_materials = async function(page) {
  if (!window.__adMatState) {
    const today = new Date();
    const yest = new Date(today.getTime() - 86400000);
    const fmt = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    const ago = n => fmt(new Date(today.getTime() - n*86400000));
    window.__adMatState = {
      dateMode: 'preset',  // 'preset' | 'custom'
      preset: 30,           // 7 / 14 / 30，默认改 30
      startDate: ago(30),
      endDate: fmt(yest),
      sortBy: 'cost', minCost: 0, view: 'card',
      // 兼容旧 days 字段
      get days() { return this.preset; },
    };
  }
  const st = window.__adMatState;

  page.innerHTML = `
    <div class="card">
      <h2 style="margin:0">★ 素材库</h2>
      <p class="muted" style="margin:6px 0 0">每个素材的近期投放表现（消耗 / 加粉数 / 加粉成本 / 转化数 / 转化成本 / CTR / CVR / CPM / CPC），点击素材卡片打开链接</p>
      <div style="margin-top:14px;display:flex;flex-wrap:wrap;align-items:center;gap:8px">
        <span class="muted" style="font-size:12px">日期：</span>
        <div style="display:flex;border:1px solid var(--silver-soft);border-radius:5px;overflow:hidden" id="m_preset_group">
          <button data-preset="7"  class="m-preset-btn" style="padding:6px 12px;border:0;background:${st.dateMode==='preset'&&st.preset==7?'var(--klein)':'#fff'};color:${st.dateMode==='preset'&&st.preset==7?'#fff':'var(--ink)'};cursor:pointer;font-size:12px;border-right:1px solid var(--silver-soft)">近 7 天</button>
          <button data-preset="14" class="m-preset-btn" style="padding:6px 12px;border:0;background:${st.dateMode==='preset'&&st.preset==14?'var(--klein)':'#fff'};color:${st.dateMode==='preset'&&st.preset==14?'#fff':'var(--ink)'};cursor:pointer;font-size:12px;border-right:1px solid var(--silver-soft)">近 14 天</button>
          <button data-preset="30" class="m-preset-btn" style="padding:6px 12px;border:0;background:${st.dateMode==='preset'&&st.preset==30?'var(--klein)':'#fff'};color:${st.dateMode==='preset'&&st.preset==30?'#fff':'var(--ink)'};cursor:pointer;font-size:12px">近 30 天</button>
        </div>
        <input type="date" class="input" id="m_start" value="${st.startDate}" max="${st.endDate}" style="width:140px;height:32px;font-size:12px;padding:0 8px">
        <span class="muted" style="font-size:12px">至</span>
        <input type="date" class="input" id="m_end" value="${st.endDate}" style="width:140px;height:32px;font-size:12px;padding:0 8px">
        <span style="font-size:11px;color:${st.dateMode==='custom'?'var(--klein)':'var(--ink-mute)'}" id="m_date_hint">${st.dateMode==='custom'?'自定义区间':'预设期间'}</span>
        <span style="flex:1"></span>
        <select class="select" id="m_sort" style="width:160px">
          <option value="cost" ${st.sortBy==='cost'?'selected':''}>按消耗排序</option>
          <option value="wechatFans" ${st.sortBy==='wechatFans'?'selected':''}>按加微数</option>
          <option value="wechatFanCost" ${st.sortBy==='wechatFanCost'?'selected':''}>加微成本（升）</option>
          <option value="ctr" ${st.sortBy==='ctr'?'selected':''}>按 CTR</option>
          <option value="cvr" ${st.sortBy==='cvr'?'selected':''}>按 CVR</option>
          <option value="convert" ${st.sortBy==='convert'?'selected':''}>按转化数</option>
          <option value="convertCost" ${st.sortBy==='convertCost'?'selected':''}>转化成本（升）</option>
        </select>
        <select class="select" id="m_min" style="width:120px">
          <option value="0" ${st.minCost==0?'selected':''}>全部素材</option>
          <option value="100" ${st.minCost==100?'selected':''}>≥ ¥100</option>
          <option value="500" ${st.minCost==500?'selected':''}>≥ ¥500</option>
          <option value="1000" ${st.minCost==1000?'selected':''}>≥ ¥1000</option>
        </select>
        <div style="display:flex;border:1px solid var(--silver-soft);border-radius:5px;overflow:hidden">
          <button class="${st.view==='card'?'view-active':''}" id="vc" style="padding:6px 12px;border:0;background:${st.view==='card'?'var(--klein)':'#fff'};color:${st.view==='card'?'#fff':'var(--ink)'};cursor:pointer;font-size:12px">卡片</button>
          <button class="${st.view==='table'?'view-active':''}" id="vt" style="padding:6px 12px;border:0;background:${st.view==='table'?'var(--klein)':'#fff'};color:${st.view==='table'?'#fff':'var(--ink)'};cursor:pointer;font-size:12px">表格</button>
        </div>
        <button class="btn btn-primary" onclick="loadMat()">🔄 加载</button>
        <button class="btn" onclick="forceRefresh()" title="清缓存重拉巨量">强刷</button>
      </div>
      <div style="margin-top:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <button id="aiTitleRewriteBtn" class="btn" onclick="batchRewriteTitles()" disabled style="background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;border:0;font-weight:600;opacity:.5;cursor:not-allowed">🤖 AI 改写素材标题</button>
        <span class="muted" style="font-size:11px">勾选下面卡片右上角的「选」框，可批量让 AI 改写素材文件名为爆款标题（每条 3 个候选）</span>
      </div>
    </div>
    <div id="matResult"></div>
  `;
  // 预设按钮：点了立刻自动加载
  document.querySelectorAll('.m-preset-btn').forEach(b => {
    b.addEventListener('click', () => {
      st.dateMode = 'preset';
      st.preset = +b.dataset.preset;
      // 同步 startDate/endDate（向用户展示当前对应日期）
      const today = new Date(); const yest = new Date(today.getTime() - 86400000);
      const fmtD = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
      st.endDate = fmtD(yest);
      st.startDate = fmtD(new Date(today.getTime() - st.preset*86400000));
      window.render_ad_materials(page);
      setTimeout(() => loadMat(), 50);
    });
  });
  // 自定义日期：失焦或回车后自动加载
  let customTimer = null;
  function customDateChanged() {
    const sd = document.getElementById('m_start').value;
    const ed = document.getElementById('m_end').value;
    if (!sd || !ed) return;
    if (sd > ed) { alert('开始日期不能晚于结束日期'); return; }
    const diff = (new Date(ed) - new Date(sd)) / 86400000 + 1;
    if (diff > 31) { alert('日期区间不能超过 31 天（巨量限制）'); return; }
    st.dateMode = 'custom';
    st.startDate = sd;
    st.endDate = ed;
    document.getElementById('m_date_hint').textContent = `自定义区间 · ${diff} 天`;
    document.getElementById('m_date_hint').style.color = 'var(--klein)';
    // 切换 preset 按钮状态视觉
    document.querySelectorAll('.m-preset-btn').forEach(b => {
      b.style.background = '#fff';
      b.style.color = 'var(--ink)';
    });
    clearTimeout(customTimer);
    customTimer = setTimeout(() => loadMat(), 300);
  }
  document.getElementById('m_start').addEventListener('change', customDateChanged);
  document.getElementById('m_end').addEventListener('change', customDateChanged);

  document.getElementById('m_sort').addEventListener('change', e => { st.sortBy = e.target.value; renderMat(); });
  document.getElementById('m_min').addEventListener('change', e => { st.minCost = +e.target.value; renderMat(); });
  document.getElementById('vc').addEventListener('click', () => { st.view = 'card'; window.render_ad_materials(page); });
  document.getElementById('vt').addEventListener('click', () => { st.view = 'table'; window.render_ad_materials(page); });

  window.forceRefresh = async function() {
    await api.post('/api/v6/oc/materials/refresh', {});
    return loadMat();
  };

  window.loadMat = async function() {
    const box = document.getElementById('matResult');
    const rangeLabel = st.dateMode === 'custom'
      ? `${st.startDate} ~ ${st.endDate}`
      : `近 ${st.preset} 天`;
    box.innerHTML = `<div class="loading">正在从巨量拉取 <b>${rangeLabel}</b> 所有账户的素材数据 + 反查文件 URL...约 30~60 秒（首次较慢，5 分钟内有缓存）</div>`;
    const params = st.dateMode === 'custom'
      ? `startDate=${st.startDate}&endDate=${st.endDate}`
      : `days=${st.preset}`;
    const r = await api.get(`/api/v6/oc/materials?${params}`);
    if (!r.ok) {
      box.innerHTML = `<div class="card">加载失败：${r.error || ''} ${r.message || ''}</div>`;
      return;
    }
    window.__matData = r;
    renderMat();
  };

  function renderMat() {
    const box = document.getElementById('matResult');
    const r = window.__matData;
    if (!r) return;
    let list = (r.materials || []).slice();
    if (st.minCost > 0) list = list.filter(m => m.cost >= st.minCost);

    const ascSort = ['wechatFanCost', 'convertCost', 'cpc', 'cpm'];
    list.sort((a, b) => {
      return ascSort.includes(st.sortBy)
        ? (a[st.sortBy] || Infinity) - (b[st.sortBy] || Infinity)
        : b[st.sortBy] - a[st.sortBy];
    });
    if (st.sortBy === 'wechatFanCost') list = list.filter(m => m.wechatFans > 0);
    if (st.sortBy === 'convertCost') list = list.filter(m => m.convert > 0);

    if (!list.length) {
      box.innerHTML = `<div class="card empty" style="text-align:center;padding:60px 0;color:var(--ink-mute)">没有匹配的素材</div>`;
      return;
    }

    const t = r.totals;
    // 去掉广告整体 KPI 大块，只保留一行简短统计
    const kpiHtml = `
      <div class="muted" style="font-size:12px;padding:0 4px;margin:14px 0 10px">${r.dateRange} · ${t.materialCount} 个素材（${t.withFileCount} 反查到文件）${r.cached?` <span style="background:var(--silver-bg);padding:2px 8px;border-radius:10px;color:var(--ink-soft);font-size:11px;margin-left:4px">缓存 ${r.cacheAge}s 前</span>`:''}</div>
    `;

    if (st.view === 'card') {
      box.innerHTML = kpiHtml + `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;margin-top:14px">
          ${list.slice(0, 60).map((m, i) => renderCardItem(m, i)).join('')}
        </div>
      `;
    } else {
      box.innerHTML = kpiHtml + `
        <div class="card" style="padding:0;overflow:hidden">
          <div class="table-wrap" style="max-height:75vh;overflow:auto">
            <table style="font-size:12px">
              <thead style="position:sticky;top:0;background:var(--paper-soft);z-index:1">
                <tr>
                  <th style="width:30px;padding:12px 10px"><input type="checkbox" id="pickAll"></th>
                  <th style="width:40px;padding:12px 10px">#</th>
                  <th style="padding:12px 10px">素材</th>
                  <th style="padding:12px 10px">素材 ID / 文件名</th>
                  <th style="padding:12px 10px">账户</th>
                  <th style="text-align:right;padding:12px 10px">消耗</th>
                  <th style="text-align:right;padding:12px 10px">加粉数</th>
                  <th style="text-align:right;padding:12px 10px">加粉成本</th>
                  <th style="text-align:right;padding:12px 10px">转化数</th>
                  <th style="text-align:right;padding:12px 10px">转化成本</th>
                  <th style="text-align:right;padding:12px 10px">CTR</th>
                  <th style="text-align:right;padding:12px 10px">CVR</th>
                  <th style="text-align:right;padding:12px 10px">CPM</th>
                  <th style="text-align:right;padding:12px 10px">CPC</th>
                  <th style="width:120px;padding:12px 10px">操作</th>
                </tr>
              </thead>
              <tbody style="line-height:1.8">
                ${list.slice(0, 100).map((m, i) => renderRow(m, i)).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    bindActions(list);
  }

  function renderCardItem(m, i) {
    const f = m.file;
    const isVideo = f && f.type === 'video';
    const ctrColor = m.ctr >= 2 ? 'color:var(--success);font-weight:600' : '';
    const wcColor = m.wechatFans >= 50 ? 'color:var(--success);font-weight:600' : '';
    const rankBg = i < 3 ? 'background:#ffd54f;color:#000' : i < 10 ? 'background:#e8f0ff;color:var(--klein)' : 'background:rgba(0,0,0,.6);color:#fff';
    const acctName = m.sourceAccountName || (m.accounts[0]||'');
    const acctId = m.sourceAccountId || '';
    const fileUrl = f?.url || '';
    return `
      <div class="card" style="padding:0;overflow:hidden;display:flex;flex-direction:column">
        <div style="position:relative;aspect-ratio:9/16;background:#000;overflow:hidden">
          <span style="position:absolute;top:6px;left:6px;${rankBg};border-radius:10px;padding:2px 8px;font-size:11px;font-weight:700;z-index:2">#${i+1}</span>
          <label style="position:absolute;top:6px;right:6px;z-index:2;background:rgba(255,255,255,.9);border-radius:4px;padding:3px 6px;cursor:pointer;font-size:11px">
            <input type="checkbox" class="mat-pick" data-id="${m.materialId}" data-name="${escAttr(f?.name||'')}" style="vertical-align:middle;margin-right:4px"> 选
          </label>
          ${f ? `
            <img src="${f.cover}" style="width:100%;height:100%;object-fit:cover" loading="lazy" referrerpolicy="no-referrer">
            ${isVideo ? `
              <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;cursor:pointer" onclick="playVideo('${m.materialId}','${escAttr(fileUrl)}','${escAttr(f.cover||'')}','${escAttr(f.name||'')}')">
                <span style="background:rgba(0,0,0,.7);color:#fff;width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px">▶</span>
              </div>
              ${f.duration ? `<span style="position:absolute;bottom:6px;right:6px;background:rgba(0,0,0,.7);color:#fff;font-size:10px;padding:2px 6px;border-radius:3px">${Math.round(f.duration)}s</span>` : ''}
            ` : ''}
          ` : `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#666;font-size:11px;text-align:center;padding:20px">素材文件已删除<br><span style="font-size:10px;font-family:monospace">${m.materialId.slice(0,12)}</span></div>`}
        </div>
        <div style="padding:10px;font-size:12px;flex:1;display:flex;flex-direction:column">
          <div style="font-weight:600;font-size:13px;margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escAttr(f?.name||m.materialId)}">${esc(f?.name || '(无文件名)')}</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px 8px;margin-bottom:8px">
            <div><span class="muted">消耗</span> <b>¥${num(m.cost)}</b></div>
            <div><span class="muted">加微</span> <b style="${wcColor}">${m.wechatFans||'-'}</b></div>
            <div><span class="muted">加微¥</span> ${m.wechatFans>0?'¥'+m.wechatFanCost:'-'}</div>
            <div><span class="muted">转化</span> ${m.convert||'-'}</div>
            <div style="${ctrColor}"><span class="muted">CTR</span> ${m.ctr}%</div>
            <div><span class="muted">CVR</span> ${m.cvr}%</div>
            <div><span class="muted">CPM</span> ¥${m.cpm}</div>
            <div><span class="muted">CPC</span> ¥${m.cpc}</div>
          </div>
          <div style="border-top:1px dashed var(--silver-soft);padding-top:6px;font-size:10.5px;line-height:1.6;color:var(--ink-soft);font-family:monospace;word-break:break-all">
            <div title="完整素材 ID"><span class="muted">ID</span> ${m.materialId}</div>
            <div title="${escAttr(m.accounts.join(', '))}"><span class="muted">账户</span> ${esc(acctName)}${acctId?` <span class="muted">(${acctId})</span>`:''}${m.accountCount>1?` <span class="muted">+${m.accountCount-1}</span>`:''}</div>
          </div>
          <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
            ${fileUrl && isVideo ? `<a href="${fileUrl}" target="_blank" rel="noopener" style="flex:1;text-align:center;font-size:11px;padding:6px 0;background:var(--klein);color:#fff;border-radius:4px;text-decoration:none;font-weight:600">▶ 打开视频</a>` : ''}
            ${fileUrl && !isVideo ? `<a href="${fileUrl}" target="_blank" rel="noopener" style="flex:1;text-align:center;font-size:11px;padding:6px 0;background:var(--klein);color:#fff;border-radius:4px;text-decoration:none;font-weight:600">🖼 打开原图</a>` : ''}
            <button class="btn copy-id" data-id="${m.materialId}" style="font-size:11px;padding:6px 10px">📋 ID</button>
            ${fileUrl ? `<button class="btn copy-url" data-url="${escAttr(fileUrl)}" style="font-size:11px;padding:6px 10px">🔗 链接</button>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  function renderRow(m, i) {
    const f = m.file;
    const isVideo = f && f.type === 'video';
    const ctrColor = m.ctr >= 2 ? 'color:var(--success);font-weight:600' : '';
    const wcColor = m.wechatFans >= 50 ? 'color:var(--success);font-weight:600' : '';
    const rankBg = i < 3 ? 'background:#ffd54f;color:#000' : i < 10 ? 'background:#e8f0ff;color:var(--klein)' : 'background:var(--silver-bg);color:var(--ink-soft)';
    const acctName = m.sourceAccountName || (m.accounts[0]||'');
    const acctId = m.sourceAccountId || '';
    const fileUrl = f?.url || '';
    return `
      <tr>
        <td><input type="checkbox" class="mat-pick" data-id="${m.materialId}" data-name="${escAttr(f?.name||'')}"></td>
        <td><span style="${rankBg};border-radius:8px;padding:1px 6px;font-size:10px;font-weight:600">${i+1}</span></td>
        <td>
          ${f ? `<div style="position:relative;width:40px;height:60px;background:#000;border-radius:3px;overflow:hidden;cursor:${isVideo?'pointer':'default'}" ${isVideo?`onclick="playVideo('${m.materialId}','${escAttr(fileUrl)}','${escAttr(f.cover||'')}','${escAttr(f.name||'')}')"`:''}>
            <img src="${f.cover}" style="width:100%;height:100%;object-fit:cover" loading="lazy" referrerpolicy="no-referrer">
            ${isVideo ? '<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px">▶</span>' : ''}
          </div>` : `<span class="muted" style="font-size:10px">无</span>`}
        </td>
        <td style="max-width:240px">
          <div style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escAttr(f?.name||'')}">${esc(f?.name || '(无文件名)')}</div>
          <div style="font-size:10px;color:var(--ink-mute);font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${m.materialId}">${m.materialId}</div>
        </td>
        <td style="font-size:11px" title="${escAttr(m.accounts.join(', '))}">${esc(acctName)}<br><span class="muted" style="font-size:10px;font-family:monospace">${acctId}</span>${m.accountCount>1?` <span class="muted">+${m.accountCount-1}</span>`:''}</td>
        <td style="text-align:right"><b>¥${num(m.cost)}</b></td>
        <td style="text-align:right;${wcColor}">${m.wechatFans||'-'}</td>
        <td style="text-align:right">${m.wechatFans>0?'¥'+m.wechatFanCost:'-'}</td>
        <td style="text-align:right;color:var(--klein)">${m.convert||'-'}</td>
        <td style="text-align:right">${m.convert>0?'¥'+m.convertCost:'-'}</td>
        <td style="text-align:right;${ctrColor}">${m.ctr}%</td>
        <td style="text-align:right">${m.cvr}%</td>
        <td style="text-align:right">¥${m.cpm}</td>
        <td style="text-align:right">¥${m.cpc}</td>
        <td>
          ${fileUrl ? `<a href="${fileUrl}" target="_blank" rel="noopener" style="background:var(--klein);color:#fff;padding:5px 10px;font-size:11px;border-radius:4px;text-decoration:none">${isVideo?'▶ 视频':'🖼 图片'}</a>` : '<span class="muted" style="font-size:10px">无链接</span>'}
        </td>
      </tr>
    `;
  }

  function bindActions(list) {
    document.querySelectorAll('.copy-id').forEach(b => {
      b.addEventListener('click', () => {
        navigator.clipboard.writeText(b.dataset.id);
        const old = b.innerHTML;
        b.innerHTML = '✓';
        setTimeout(() => b.innerHTML = old, 1200);
      });
    });
    document.querySelectorAll('.copy-url').forEach(b => {
      b.addEventListener('click', () => {
        navigator.clipboard.writeText(b.dataset.url);
        const old = b.innerHTML;
        b.innerHTML = '✓';
        setTimeout(() => b.innerHTML = old, 1200);
      });
    });
    // 表格全选
    const pickAll = document.getElementById('pickAll');
    if (pickAll) pickAll.addEventListener('change', () => {
      document.querySelectorAll('.mat-pick').forEach(cb => cb.checked = pickAll.checked);
      updateRewriteBtn();
    });
    document.querySelectorAll('.mat-pick').forEach(cb => {
      cb.addEventListener('change', updateRewriteBtn);
    });
    updateRewriteBtn();
  }
  function updateRewriteBtn() {
    const n = document.querySelectorAll('.mat-pick:checked').length;
    const btn = document.getElementById('aiTitleRewriteBtn');
    if (btn) {
      btn.textContent = n > 0 ? `🤖 AI 改写选中 ${n} 条标题` : '🤖 AI 改写素材标题';
      btn.disabled = n === 0;
      btn.style.opacity = n === 0 ? '.5' : '1';
      btn.style.cursor = n === 0 ? 'not-allowed' : 'pointer';
    }
  }

  window.playVideo = function(matId, url, cover, name) {
    if (!url) return;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.innerHTML = `
      <div style="position:relative;max-width:400px;width:100%">
        <button style="position:absolute;top:-40px;right:0;background:transparent;border:0;color:#fff;font-size:28px;cursor:pointer" onclick="this.parentElement.parentElement.remove()">✕</button>
        <video controls autoplay playsinline poster="${cover}" style="width:100%;border-radius:8px;max-height:80vh">
          <source src="${url}" type="video/mp4">
        </video>
        <div style="color:#fff;font-size:12px;margin-top:10px;text-align:center">${esc(name||matId)}</div>
      </div>
    `;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  };

  window.batchRewriteTitles = async function() {
    const picks = [...document.querySelectorAll('.mat-pick:checked')].map(cb => ({
      id: cb.dataset.id,
      name: cb.dataset.name || ''
    })).filter(x => x.name);
    if (!picks.length) {
      alert('请先勾选要改写标题的素材（仅勾选有文件名的素材）');
      return;
    }
    if (picks.length > 10) {
      alert('一次最多改写 10 条，请减少勾选');
      return;
    }

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9998;display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:10px;max-width:760px;width:100%;max-height:90vh;overflow:auto;padding:24px;position:relative">
        <button style="position:absolute;top:14px;right:14px;background:transparent;border:0;font-size:22px;cursor:pointer" onclick="this.parentElement.parentElement.remove()">✕</button>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px">
          <div style="width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#a855f7);display:flex;align-items:center;justify-content:center;color:#fff;font-size:20px">🤖</div>
          <div style="flex:1">
            <div style="font-weight:700;font-size:16px">AI 批量改写素材标题</div>
            <div class="muted" style="font-size:12px">DeepSeek 基于仕净品牌口径，给每条素材改写 3 条爆款标题候选</div>
          </div>
        </div>
        <div style="background:var(--paper-soft);padding:10px 14px;border-radius:6px;margin-bottom:14px;font-size:12px;color:var(--ink-soft);max-height:120px;overflow:auto">
          <div class="muted" style="margin-bottom:6px">已选 ${picks.length} 条原始文件名：</div>
          ${picks.map((p,i)=>`<div style="margin-bottom:3px">${i+1}. ${esc(p.name)}</div>`).join('')}
        </div>
        <div id="aiTitleResult"><div class="loading-spin" style="width:30px;height:30px;border:3px solid #ddd;border-top-color:#7c3aed;border-radius:50%;animation:spin 1s linear infinite;margin:30px auto"></div><div style="text-align:center;color:var(--ink-mute);font-size:12px">AI 改写中...约 ${5+picks.length*2}~${10+picks.length*3} 秒</div></div>
      </div>
      <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    const r = await api.post('/api/v6/oc/title-rewrite', { items: picks });
    const result = document.getElementById('aiTitleResult');
    if (!r.ok) {
      result.innerHTML = `<div style="text-align:center;color:var(--danger);padding:30px">AI 失败：${r.error||''}</div>`;
      return;
    }
    result.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:14px">
        ${r.results.map((res, i) => `
          <div style="border:1px solid #ddd6fe;border-radius:8px;padding:14px;background:linear-gradient(135deg,#faf5ff,#fff)">
            <div style="font-size:11px;color:var(--ink-mute);margin-bottom:6px">原文件名</div>
            <div style="font-size:13px;font-weight:600;margin-bottom:10px;word-break:break-all">${esc(res.original)}</div>
            <div style="font-size:11px;color:#7c3aed;margin-bottom:6px">AI 改写后的 ${res.titles.length} 条候选 ↓</div>
            <div style="display:flex;flex-direction:column;gap:6px">
              ${res.titles.map(t => `
                <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#fff;border:1px solid var(--silver-soft);border-radius:5px">
                  <div style="flex:1;font-size:13px">${esc(t)}</div>
                  <button class="btn ait-copy" data-text="${escAttr(t)}" style="padding:4px 10px;font-size:11px;background:#7c3aed;color:#fff;border:0;border-radius:4px;cursor:pointer;white-space:nowrap">📋 复制</button>
                </div>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>
      <div class="muted" style="font-size:11px;margin-top:12px;text-align:center">共 ${r.totalTokens} tokens · ¥${(r.totalTokens*0.0001).toFixed(4)}</div>
    `;
    result.querySelectorAll('.ait-copy').forEach(b => {
      b.addEventListener('click', () => {
        const text = b.dataset.text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        navigator.clipboard.writeText(text);
        b.innerHTML = '✓ 已复制';
        b.style.background = '#22c55e';
        setTimeout(() => { b.innerHTML = '📋 复制'; b.style.background = '#7c3aed'; }, 1800);
      });
    });
  };

  function num(n) { return (+n||0).toLocaleString('zh-CN'); }
  function esc(s) { return String(s||'').replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
  function escAttr(s) { return String(s||'').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

  loadMat();
};

// 旧路由兼容
window.render_ad_deployed = window.render_ad_materials;
window.render_ad_creatives = window.render_ad_materials;

// === 爆款灵感（基于自己的成功素材 + 全网热点）===
window.render_ad_discover = async function(page) {
  page.innerHTML = `
    <div class="card">
      <h2>🔍 爆款灵感</h2>
      <p class="muted">基于"已投放素材性能榜"中 CTR ≥ 2% 的高表现素材，AI 拆解爆款公式 + 给出新选题。</p>
    </div>
    <div class="card">
      <h3 style="margin-top:0">📌 当前可用的方式</h3>
      <ol style="line-height:2;font-size:14px;color:var(--ink)">
        <li><b>已投放素材性能榜</b>（左侧菜单 📊）→ 看 CTR ≥ 2% 的素材有什么共性 → 复制公式，仿做</li>
        <li><b>巨量·创意中心</b>（外部）：<a href="https://cc.oceanengine.com/inspiration" target="_blank" style="color:var(--klein)">cc.oceanengine.com/inspiration</a> 查询关键词「胡须」「脱毛」搜索热门投放素材</li>
        <li><b>蝉妈妈/飞瓜</b>（第三方）：抖音爆款短视频榜 + 同行投放分析（需付费订阅）</li>
        <li><b>小红书蒲公英</b>：<a href="https://pgy.xiaohongshu.com" target="_blank" style="color:var(--klein)">pgy.xiaohongshu.com</a> 查"美容/医美"垂类热门笔记</li>
      </ol>
      <p class="muted" style="margin-top:16px;font-size:12px;line-height:1.7">
        <b>⚠️ 关于"全网爆款抓取"</b>：抖音/小红书没有开放的"搜索任意关键词返回爆款列表"的官方 API，<br>
        第三方接口（如蝉妈妈、新榜、果集）多是付费订阅制，单价 1500~5000 元/月。<br>
        <b>建议方案</b>：先用「已投放性能榜」沉淀你自己的爆款公式（投了几百条数据已经够），<br>
        想拓展时再考虑外购第三方数据。下一步可以做：AI 拆解你自己 TOP10 素材的脚本结构 + 自动生成 5 条仿写文案。
      </p>
    </div>
    <div class="card">
      <h3 style="margin-top:0">🤖 AI 仿写（占位）</h3>
      <p class="muted">下一步接 GPT/Claude API：你贴一条爆款脚本 → AI 给出 3 条变体（钩子换、痛点换、CTA 换）。</p>
      <button class="btn" disabled>等 OpenAI / Anthropic 接入后启用</button>
    </div>
  `;
};

window.render_ad_report = async function(page) {
  page.innerHTML = '<div class="loading">加载中，请稍后…</div>';
  await loadAllData();
  const F = window.__adReportFilter = window.__adReportFilter || { preset: '7d', from: '', to: '' };
  const _p = window.v6DateRange.compute(F.preset, F.from, F.to);
  let start = _p.start, end = _p.end, label = _p.label;
  if (F.preset === 'custom') { start = F.from; end = F.to; label = '自定义'; }

  const presetBtn = (k, t) => `<button class="btn ${F.preset === k ? 'btn-primary' : ''}" style="height:32px;padding:0 12px;font-size:12px" onclick="setAdReportPreset('${k}')">${t}</button>`;

  page.innerHTML = `
    <div class="card">
      <h2>⊞ 数据报表 <span style="font-size:13px;color:var(--ink-mute);font-weight:400">（${label}：${start} ~ ${end}）</span></h2>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px">
        ${presetBtn('yesterday', '昨日')}
        ${presetBtn('3d', '近3天')}
        ${presetBtn('7d', '近7天')}
        ${presetBtn('month', '本月')}
        <span style="color:var(--ink-mute);margin-left:8px">自定义：</span>
        <input type="date" class="input" id="ar_start" value="${start}" style="width:auto;height:32px;font-size:12px"/>
        <span style="color:var(--ink-mute)">至</span>
        <input type="date" class="input" id="ar_end" value="${end}" style="width:auto;height:32px;font-size:12px"/>
        <button class="btn btn-primary" style="height:32px;padding:0 12px;font-size:12px" onclick="applyAdReportCustom()">应用</button>
      </div>
    </div>

    <div id="ar_account"></div>
    <div id="ar_city"></div>
  `;

  // ===== 账户维度（同步渲染）=====
  {
    // 渠道来源标注：mediaChannel -> {label, badge}
    const CH_META = {
      oceanengine:        { label: '巨量 AD',  color: '#1677ff', bg: '#e8f2ff' },
      oceanengine_legacy:  { label: '巨量历史', color: '#8c8c8c', bg: '#f0f0f0' },
      oceanengine_local:  { label: '本地推',   color: '#fa8c16', bg: '#fff3e6' },
      adq:                { label: '腾讯 ADQ', color: '#07c160', bg: '#e6f9ee' },
      manual:             { label: '手动录入', color: '#8c8c8c', bg: '#f0f0f0' },
    };
    const chMeta = ch => CH_META[ch] || { label: ch || '未知', color: '#8c8c8c', bg: '#f0f0f0' };

    const ad = (DB.ad || []).filter(x => !x.cityName && x.date >= start && x.date <= end);
    const byAccount = {};
    ad.forEach(x => {
      const ch = x.mediaChannel || 'manual';
      const name = x.ocAccountName || x.ocAccountId || x.teamId;
      const k = ch + '__' + name;
      if (!byAccount[k]) byAccount[k] = { name, channel: ch, cost: 0, addFans: 0, deepConvert: 0 };
      byAccount[k].cost += +x.cost || 0;
      byAccount[k].addFans += +x.addFans || 0;
      byAccount[k].deepConvert += +x.deepConvert || 0;
    });
    const accList = Object.values(byAccount).sort((a, b) => b.cost - a.cost);
    const totCost = accList.reduce((s, a) => s + a.cost, 0);
    const totFans = accList.reduce((s, a) => s + a.addFans, 0);
    const totDeep = accList.reduce((s, a) => s + a.deepConvert, 0);
    document.getElementById('ar_account').innerHTML = `
      <div class="card">
        <h3>📊 按账户维度（${accList.length} 个 · 总消耗 ${fmtMoney(totCost)} · 加粉 ${totFans} · 高潜 ${totDeep}）</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>渠道来源</th><th>账户</th><th style="text-align:right">消耗</th><th style="text-align:right">占比</th><th style="text-align:right">加粉</th><th style="text-align:right">加粉成本</th><th style="text-align:right">高潜成交</th><th style="text-align:right">高潜成本</th></tr></thead>
          <tbody>${accList.map(a => {
            const m = chMeta(a.channel);
            return `<tr>
            <td><span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;color:${m.color};background:${m.bg}">${m.label}</span></td>
            <td><b>${a.name}</b></td>
            <td style="text-align:right">${fmtMoney(a.cost)}</td>
            <td style="text-align:right">${totCost > 0 ? (a.cost / totCost * 100).toFixed(1) + '%' : '-'}</td>
            <td style="text-align:right">${a.addFans}</td>
            <td style="text-align:right">${a.addFans > 0 ? fmtMoney(a.cost / a.addFans) : '-'}</td>
            <td style="text-align:right;color:var(--klein)">${a.deepConvert}</td>
            <td style="text-align:right">${a.deepConvert > 0 ? fmtMoney(a.cost / a.deepConvert) : '-'}</td>
          </tr>`;
          }).join('') || '<tr><td colspan="8" class="muted" style="text-align:center;padding:24px">该区间暂无数据</td></tr>'}</tbody>
        </table></div>
      </div>
    `;
  }

  // ===== 城市维度（异步加载，独立卡片）=====
  const cityBox = document.getElementById('ar_city');
  cityBox.innerHTML = '<div class="card"><h3>🏙 按城市维度</h3><div class="loading">加载城市数据…</div></div>';
  try {
    const r = await fetch(`/api/oceanengine/by-city?start=${start}&end=${end}`).then(r => r.json());
    const cities = (r.cities || []).filter(c => c.cost >= 1);
    if (cities.length === 0) {
      cityBox.innerHTML = '<div class="card"><h3>🏙 按城市维度</h3><p class="muted">该区间暂无城市数据</p></div>';
    } else {
      const totalCost = cities.reduce((s, c) => s + c.cost, 0);
      const totalDeep = cities.reduce((s, c) => s + (+c.deepConvert || 0), 0);
      const totalFans = cities.reduce((s, c) => s + c.addFans, 0);
      cityBox.innerHTML = `
        <div class="card">
          <h3>🏙 按城市维度（${cities.length} 城 · 总消耗 ${fmtMoney(totalCost)} · 加粉 ${totalFans} · 高潜成交 ${totalDeep}）</h3>
          <div class="table-wrap"><table>
            <thead><tr><th>排名</th><th>城市</th><th style="text-align:right">消耗</th><th style="text-align:right">占比</th><th style="text-align:right">曝光</th><th style="text-align:right">点击</th><th style="text-align:right">CPC</th><th style="text-align:right">加粉</th><th style="text-align:right">加粉成本</th><th style="text-align:right">高潜成交</th><th style="text-align:right">高潜成本</th></tr></thead>
            <tbody>${cities.map((c, i) => {
              const deep = +c.deepConvert || 0;
              return `<tr ${i < 3 ? 'style="background:var(--klein-soft)"' : ''}>
              <td>${i + 1}</td>
              <td><b>${c.city}</b></td>
              <td style="text-align:right">${fmtMoney(c.cost)}</td>
              <td style="text-align:right">${(c.cost / totalCost * 100).toFixed(1)}%</td>
              <td style="text-align:right">${(c.impressions || 0).toLocaleString('zh-CN')}</td>
              <td style="text-align:right">${(c.clicks || 0).toLocaleString('zh-CN')}</td>
              <td style="text-align:right">${c.cpc ? '¥' + c.cpc.toFixed(2) : '-'}</td>
              <td style="text-align:right">${c.addFans}</td>
              <td style="text-align:right">${c.addFans > 0 ? fmtMoney(c.cost / c.addFans) : '-'}</td>
              <td style="text-align:right;color:var(--klein)">${deep}</td>
              <td style="text-align:right">${deep > 0 ? fmtMoney(c.cost / deep) : '-'}</td>
            </tr>`;
            }).join('')}</tbody>
          </table></div>
          <p class="muted" style="font-size:11px;margin-top:8px">说明：高潜成交按当日消耗权重整数分摊（最大余数法），日内合计 = 巨量真实日总值。</p>
        </div>
      `;
    }
  } catch (e) {
    cityBox.innerHTML = `<div class="card"><h3>🏙 按城市维度</h3><p style="color:var(--danger)">加载失败：${e.message}</p></div>`;
  }
};

window.setAdReportPreset = (k) => { window.__adReportFilter = { ...window.__adReportFilter, preset: k, from: '', to: '' }; render_ad_report(document.getElementById('page')); };
window.applyAdReportCustom = () => {
  const from = document.getElementById('ar_start').value;
  const to = document.getElementById('ar_end').value;
  if (!from || !to) return alert('请选起止日期');
  window.__adReportFilter = { ...window.__adReportFilter, preset: 'custom', from, to };
  render_ad_report(document.getElementById('page'));
};

// === 渠道分析 MVP（巨量 ad / 本地推 / ADQ）===
window.render_ad_channels = async function(page) {
  page.innerHTML = '<div class="loading">加载中，请稍后…</div>';
  if (!window.__chState) window.__chState = { tab: 'oc', preset: '7d', from: '', to: '' };
  const st = window.__chState;
  await loadAllData();

  const _p = window.v6DateRange.compute(st.preset, st.from, st.to);
  let start = _p.start, end = _p.end, label = _p.label;
  if (st.preset === 'custom') { start = st.from; end = st.to; label = '自定义'; }

  const tabBtn = (k, t, sub) => `<button class="btn ${st.tab===k?'btn-primary':''}" style="padding:8px 18px;font-size:13px" onclick="setChTab('${k}')">${t}<br><small style="font-size:10px;opacity:.7">${sub}</small></button>`;
  const presetBtn = (k, t) => `<button class="btn ${st.preset===k?'btn-primary':''}" style="height:30px;padding:0 12px;font-size:12px" onclick="setChPreset('${k}')">${t}</button>`;

  page.innerHTML = `
    <div class="card">
      <h2>◫ 渠道分析 <span style="font-size:13px;color:var(--ink-mute);font-weight:400">（${label}：${start} ~ ${end}）</span></h2>
      <p class="muted">三大投放渠道横向对比：消耗、加粉、加粉成本、高潜成交、高潜成本</p>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        ${tabBtn('oc', '巨量 AD', '抖音/穿山甲信息流')}
        ${tabBtn('local', '本地推', '巨量本地推/抖音同城')}
        ${tabBtn('adq', '腾讯 ADQ', '微信朋友圈/视频号')}
      </div>
      <div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap;align-items:center">
        ${presetBtn('yesterday','昨日')}${presetBtn('3d','近3天')}${presetBtn('7d','近7天')}${presetBtn('month','本月')}
        <span style="color:var(--ink-mute);margin-left:8px">自定义：</span>
        <input type="date" class="input" id="ch_start" value="${start}" style="width:auto;height:30px;font-size:12px"/>
        <span style="color:var(--ink-mute)">至</span>
        <input type="date" class="input" id="ch_end" value="${end}" style="width:auto;height:30px;font-size:12px"/>
        <button class="btn btn-primary" style="height:30px;padding:0 12px;font-size:12px" onclick="applyChCustom()">应用</button>
      </div>
    </div>
    <div id="ch_body"></div>
  `;

  const body = document.getElementById('ch_body');
  if (st.tab === 'oc') {
    // 巨量 AD：用 ad 表（!cityName）按账户聚合
    const ad = (DB.ad || []).filter(x => !x.cityName && x.date >= start && x.date <= end && (x.mediaChannel === 'oceanengine' || x.mediaChannel === 'oceanengine_legacy' || !x.mediaChannel));
    body.innerHTML = renderChannelTable('巨量 AD（信息流）', ad);
  } else if (st.tab === 'local') {
    // 巨量本地推：2026-07-05 已接入，复用AD工作台token双路同步（报表接口拉消耗/展示/点击 + 线索明细接口拉真实留资数）
    const local = (DB.ad || []).filter(x => x.date >= start && x.date <= end && x.mediaChannel === 'oceanengine_local');
    if (local.length) {
      body.innerHTML = renderChannelTable('巨量本地推', local, { deepLabel: '预付定金', deepNote: '⚠️ 预付定金数暂缺：巨量本地推线索接口未回传该状态（需门店/客服在巨量后台标记"定金或钩子品支付"后才有数据，目前尚未配置回传，故此列恒为0，不代表真实转化为0）。消耗、留资数（=加粉数）均为真实数据。' });
    } else {
      body.innerHTML = `
        <div class="card">
          <h3>📍 本地推</h3>
          <p class="muted">该时间段本地推账户无消耗数据（22个已授权账户中通常仅1个在跑量）。</p>
          <div class="kpi-grid">
            <div class="kpi"><div class="kpi-label">本月消耗</div><div class="kpi-value muted">¥0</div></div>
            <div class="kpi"><div class="kpi-label">加粉</div><div class="kpi-value muted">0</div></div>
            <div class="kpi"><div class="kpi-label">高潜</div><div class="kpi-value muted">-</div></div>
          </div>
        </div>
      `;
    }
  } else {
    body.innerHTML = `
      <div class="card">
        <h3>💬 腾讯 ADQ</h3>
        <p class="muted">微信朋友圈、视频号、QQ 等腾讯系投放。腾讯营销 API（marketing-api.qq.com）需独立授权和 access_token。</p>
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi-label">本月消耗</div><div class="kpi-value muted">待授权</div></div>
          <div class="kpi"><div class="kpi-label">加粉</div><div class="kpi-value muted">待授权</div></div>
          <div class="kpi"><div class="kpi-label">高潜</div><div class="kpi-value muted">待授权</div></div>
        </div>
        <p class="muted" style="font-size:11px;margin-top:12px">📌 接口口子已留：POST /api/v6/adq/sync 待对接。需要：① 申请腾讯营销 API 应用 ② 用户授权 OAuth ③ 复用 ad 表 mediaChannel='adq'。</p>
      </div>
    `;
  }

  function renderChannelTable(title, data, opts) {
    opts = opts || {};
    const deepLabel = opts.deepLabel || '高潜';
    const byAcc = {};
    data.forEach(x => {
      const k = x.ocAccountName || x.ocAccountId || x.teamId || '默认';
      if (!byAcc[k]) byAcc[k] = { name: k, cost: 0, fans: 0, deep: 0 };
      byAcc[k].cost += +x.cost || 0;
      byAcc[k].fans += +x.addFans || 0;
      byAcc[k].deep += +x.deepConvert || 0;
    });
    const rows = Object.values(byAcc).sort((a, b) => b.cost - a.cost);
    const tot = rows.reduce((s, r) => ({ cost: s.cost + r.cost, fans: s.fans + r.fans, deep: s.deep + r.deep }), { cost: 0, fans: 0, deep: 0 });
    return `
      <div class="card">
        <h3>${title}（${rows.length} 个账户）</h3>
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi-label">总消耗</div><div class="kpi-value">${fmtMoney(tot.cost)}</div></div>
          <div class="kpi"><div class="kpi-label">总加粉</div><div class="kpi-value">${tot.fans}</div></div>
          <div class="kpi"><div class="kpi-label">加粉成本</div><div class="kpi-value">${tot.fans > 0 ? fmtMoney(tot.cost / tot.fans) : '-'}</div></div>
          <div class="kpi"><div class="kpi-label">总${deepLabel}</div><div class="kpi-value" style="color:var(--klein)">${tot.deep}</div></div>
          <div class="kpi"><div class="kpi-label">${deepLabel}成本</div><div class="kpi-value">${tot.deep > 0 ? fmtMoney(tot.cost / tot.deep) : '-'}</div></div>
        </div>
        ${opts.deepNote ? `<p class="muted" style="font-size:11px;margin-top:10px;line-height:1.6">${opts.deepNote}</p>` : ''}
        <div class="table-wrap" style="margin-top:14px"><table>
          <thead><tr><th>账户</th><th style="text-align:right">消耗</th><th style="text-align:right">占比</th><th style="text-align:right">加粉</th><th style="text-align:right">加粉成本</th><th style="text-align:right">高潜</th><th style="text-align:right">高潜成本</th></tr></thead>
          <tbody>${rows.map(r => `<tr>
            <td><b>${r.name}</b></td>
            <td style="text-align:right">${fmtMoney(r.cost)}</td>
            <td style="text-align:right">${tot.cost > 0 ? (r.cost / tot.cost * 100).toFixed(1) + '%' : '-'}</td>
            <td style="text-align:right">${r.fans}</td>
            <td style="text-align:right">${r.fans > 0 ? fmtMoney(r.cost / r.fans) : '-'}</td>
            <td style="text-align:right;color:var(--klein)">${r.deep}</td>
            <td style="text-align:right">${r.deep > 0 ? fmtMoney(r.cost / r.deep) : '-'}</td>
          </tr>`).join('') || '<tr><td colspan="7" class="muted" style="text-align:center;padding:24px">该区间无数据</td></tr>'}</tbody>
        </table></div>
      </div>
    `;
  }
};
window.setChTab = (k) => { window.__chState.tab = k; render_ad_channels(document.getElementById('page')); };
window.setChPreset = (k) => { window.__chState.preset = k; window.__chState.from = ''; window.__chState.to = ''; render_ad_channels(document.getElementById('page')); };
window.applyChCustom = () => {
  const from = document.getElementById('ch_start').value;
  const to = document.getElementById('ch_end').value;
  if (!from || !to) return alert('请选起止日期');
  window.__chState = { ...window.__chState, preset: 'custom', from, to };
  render_ad_channels(document.getElementById('page'));
};

// === 素材上传（仅客服客服 + HQ）===
window.render_cs_upload = window.render_hq_upload = async function (page) {
  page.innerHTML = '<div class="loading">加载中，请稍后…</div>';
  await loadAllData();
  const u = V6.user;
  if (u.role !== 'cs' && u.role !== 'hq') {
    page.innerHTML = '<div class="card"><h2>⤴ 素材上传</h2><p class="muted">仅客服角色可上传素材</p></div>';
    return;
  }
  if (!window.__upState) window.__upState = { tab: 'list', kind: 'image', filter: '' };
  const st = window.__upState;

  // 拉素材列表
  let list = [];
  try {
    const r = await api.get('/api/v6/uploads');
    if (r.ok) list = r.items || [];
  } catch (e) {}

  // 客服素材分类（不再按文案/图片视频拆，统一一组场景类）
  const TXT_CATS = ['破冰', '原理解释+答疑', '获取信任', '促定金', '排客', '沉默用户唤醒'];
  const FILE_CATS = ['效果对比', '操作过程', '朋友圈素材', '人设搭建', '环境展示', '活动促销'];

  const tabBtn = (k, t) => `<button class="btn ${st.tab===k?'btn-primary':''}" style="padding:8px 18px" onclick="setUpTab('${k}')">${t}</button>`;
  const kindBtn = (k, t) => `<button class="btn ${st.kind===k?'btn-primary':''}" style="height:30px;padding:0 12px;font-size:12px" onclick="setUpKind('${k}')">${t}</button>`;

  page.innerHTML = `
    <div class="card">
      <h2>⤴ 客服素材库</h2>
      <p class="muted">上传你做的前后对比图、操作视频、发顾客的话术文案。无需审核，所有客服共享复用。</p>
      <div style="display:flex;gap:8px;margin-top:12px">
        ${tabBtn('list', '📚 素材库')}
        ${tabBtn('paste', '📝 文案粘贴')}
        ${tabBtn('files', '🖼 图片/视频上传')}
      </div>
    </div>
    <div id="up_body"></div>
  `;

  if (st.tab === 'list') {
    document.getElementById('up_body').innerHTML = `
      <div class="card">
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
          ${kindBtn('image', '🖼 图片')}${kindBtn('video', '🎥 视频')}${kindBtn('text', '📝 文案')}
          <input class="input" id="up_filter" placeholder="搜索分类/标题/内容" value="${st.filter}" style="width:240px;height:30px;font-size:12px;margin-left:8px"/>
        </div>
        <div id="up_grid"></div>
      </div>
    `;
    const filtered = list.filter(it => {
      if (it.kind !== st.kind) return false;
      if (!st.filter) return true;
      const k = st.filter.toLowerCase();
      return (it.title || '').toLowerCase().includes(k) || (it.category || '').toLowerCase().includes(k) || (it.content || '').toLowerCase().includes(k);
    });
    const grid = document.getElementById('up_grid');
    if (filtered.length === 0) {
      grid.innerHTML = '<p class="muted" style="text-align:center;padding:32px">暂无该类型素材，去上方 tab 上传第一条</p>';
    } else if (st.kind === 'text') {
      grid.innerHTML = filtered.map(it => `
        <div style="border:1px solid var(--silver-soft);border-radius:8px;padding:14px;margin-bottom:10px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <div>
              <span class="tag tag-klein">${it.category || '-'}</span>
              <b style="margin-left:8px">${esc(it.title)}</b>
            </div>
            <span class="muted" style="font-size:11px">${it.uploaderName || '-'} · ${new Date(it.createdAt || 0).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div style="font-size:14px;color:var(--ink);line-height:1.7;white-space:pre-wrap;background:var(--silver-bg);padding:10px;border-radius:4px">${esc(it.content || '')}</div>
          <div style="display:flex;gap:6px;margin-top:8px">
            <button class="btn btn-primary" style="height:28px;padding:0 12px;font-size:12px" onclick="copyUpText('${it.id}')">📋 一键复制</button>
            ${(it.uploaderId === V6.user.id || V6.user.role === 'hq') ? `<button class="btn" style="height:28px;padding:0 10px;font-size:12px;color:var(--danger)" onclick="delUpItem('${it.id}')">删除</button>` : ''}
          </div>
        </div>
      `).join('');
    } else {
      grid.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px">
        ${filtered.map(it => `
          <div style="border:1px solid var(--silver-soft);border-radius:8px;overflow:hidden">
            ${it.kind === 'video'
              ? `<a href="${esc(it.url)}" target="_blank" style="display:block;aspect-ratio:9/16;background:#000;color:#fff;text-align:center;line-height:1;padding-top:40%;font-size:36px;text-decoration:none">▶</a>`
              : `<a href="${esc(it.url)}" target="_blank"><img src="${esc(it.url)}" style="width:100%;aspect-ratio:9/16;object-fit:cover;display:block;background:var(--silver-bg)" loading="lazy"/></a>`}
            <div style="padding:10px">
              <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--ink-mute);margin-bottom:4px">
                <span class="tag tag-klein" style="height:18px;font-size:10px">${it.category || '-'}</span>
                <span>${it.uploaderName || '-'}</span>
              </div>
              <div style="font-size:12px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(it.title)}">${esc(it.title || '(无标题)')}</div>
              <div style="display:flex;gap:4px;margin-top:6px">
                <a class="btn" href="${esc(it.url)}" target="_blank" style="height:24px;padding:0 8px;font-size:11px">查看</a>
                ${(it.uploaderId === V6.user.id || V6.user.role === 'hq') ? `<button class="btn" style="height:24px;padding:0 8px;font-size:11px;color:var(--danger)" onclick="delUpItem('${it.id}')">删除</button>` : ''}
              </div>
            </div>
          </div>
        `).join('')}
      </div>`;
    }
    const fIn = document.getElementById('up_filter');
    if (fIn) fIn.addEventListener('input', e => { st.filter = e.target.value; render_cs_upload(document.getElementById('page')); });
  } else if (st.tab === 'paste') {
    // 文案粘贴
    document.getElementById('up_body').innerHTML = `
      <div class="card" style="max-width:780px">
        <h3>📝 粘贴话术 / 文案</h3>
        <p class="muted">把日常发顾客的话术、朋友圈文案直接粘进来，所有客服都能搜到复用。</p>
        <div style="margin-top:14px">
          <label class="lbl">分类 *</label>
          <div id="cat_chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">
            ${TXT_CATS.map(c => `<button type="button" class="cat-chip" data-cat="${c}" style="padding:6px 14px;border:1px solid var(--silver);border-radius:14px;background:#fff;cursor:pointer;font-size:12px">${c}</button>`).join('')}
          </div>
          <label class="lbl">标题 *（一句话概括，方便搜）</label>
          <input class="input" id="t_title" placeholder="如：定金犹豫客户的临门一脚" style="margin-bottom:12px"/>
          <label class="lbl">文案内容 *</label>
          <textarea class="textarea" id="t_content" rows="10" placeholder="直接 Ctrl+V 粘贴话术全文" style="font-size:14px;line-height:1.7"></textarea>
          <div style="display:flex;gap:8px;margin-top:14px;align-items:center">
            <button class="btn btn-primary" id="t_submit">提交</button>
            <span id="t_status" style="font-size:12px"></span>
          </div>
        </div>
      </div>
      <style>.lbl{display:block;font-size:12px;color:var(--ink-soft);margin-bottom:6px}.cat-chip.active{background:var(--klein)!important;color:#fff!important;border-color:var(--klein)!important}</style>
    `;
    let pickedCat = null;
    document.querySelectorAll('.cat-chip').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.cat-chip').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        pickedCat = b.dataset.cat;
      });
    });
    document.getElementById('t_submit').addEventListener('click', async () => {
      const status = document.getElementById('t_status');
      const title = document.getElementById('t_title').value.trim();
      const content = document.getElementById('t_content').value.trim();
      if (!pickedCat) { status.style.color = 'var(--danger)'; status.textContent = '请选分类'; return; }
      if (!title) { status.style.color = 'var(--danger)'; status.textContent = '请填标题'; return; }
      if (!content || content.length < 5) { status.style.color = 'var(--danger)'; status.textContent = '请粘贴完整文案（至少 5 字）'; return; }
      status.textContent = '提交中...';
      const r = await api.post('/api/v6/uploads/text', { category: pickedCat, title, content });
      if (r.ok) {
        status.style.color = 'var(--success)';
        status.textContent = '✓ 已上传';
        st.tab = 'list';
        st.kind = 'text';
        setTimeout(() => render_cs_upload(document.getElementById('page')), 600);
      } else {
        status.style.color = 'var(--danger)';
        status.textContent = '✗ ' + (r.error || '失败');
      }
    });
  } else {
    // 图片/视频批量上传
    document.getElementById('up_body').innerHTML = `
      <div class="card" style="max-width:780px">
        <h3>🖼 批量上传图片 / 视频</h3>
        <p class="muted">支持一次选多个文件（最多 30 个，单个 ≤100MB）。图片自动识别为图片，视频自动识别为视频。</p>
        <div style="margin-top:14px">
          <label class="lbl">分类 *</label>
          <div id="fcat_chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">
            ${FILE_CATS.map(c => `<button type="button" class="cat-chip" data-cat="${c}" style="padding:6px 14px;border:1px solid var(--silver);border-radius:14px;background:#fff;cursor:pointer;font-size:12px">${c}</button>`).join('')}
          </div>
          <label class="lbl">选择文件（可多选）*</label>
          <div id="drop_zone" style="border:2px dashed var(--silver);border-radius:8px;padding:30px;text-align:center;cursor:pointer;background:var(--silver-bg)">
            <input type="file" id="f_input" accept="image/*,video/*" multiple style="display:none"/>
            <div style="font-size:36px;margin-bottom:8px">📂</div>
            <div style="font-size:14px;color:var(--ink-soft)">点击或拖拽文件到此处</div>
            <div class="muted" style="margin-top:6px;font-size:11px">支持 jpg / png / mp4 / mov 等</div>
          </div>
          <div id="f_list" style="margin-top:12px"></div>
          <div style="display:flex;gap:8px;margin-top:14px;align-items:center">
            <button class="btn btn-primary" id="f_submit" disabled>开始上传</button>
            <span id="f_status" style="font-size:12px"></span>
          </div>
        </div>
      </div>
      <style>.lbl{display:block;font-size:12px;color:var(--ink-soft);margin-bottom:6px}.cat-chip.active{background:var(--klein)!important;color:#fff!important;border-color:var(--klein)!important}</style>
    `;
    let pickedCat = null;
    let pickedFiles = [];
    document.querySelectorAll('#fcat_chips .cat-chip').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('#fcat_chips .cat-chip').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        pickedCat = b.dataset.cat;
        updateSubmit();
      });
    });
    const drop = document.getElementById('drop_zone');
    const fIn = document.getElementById('f_input');
    drop.addEventListener('click', () => fIn.click());
    ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => {
      e.preventDefault(); drop.style.borderColor = 'var(--klein)'; drop.style.background = 'var(--klein-soft)';
    }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => {
      e.preventDefault(); drop.style.borderColor = 'var(--silver)'; drop.style.background = 'var(--silver-bg)';
    }));
    drop.addEventListener('drop', e => {
      e.preventDefault();
      pickedFiles = [...e.dataTransfer.files].filter(f => /^(image|video)\//.test(f.type));
      renderFileList();
    });
    fIn.addEventListener('change', () => {
      pickedFiles = [...fIn.files];
      renderFileList();
    });
    function renderFileList() {
      const total = pickedFiles.reduce((s, f) => s + f.size, 0);
      document.getElementById('f_list').innerHTML = pickedFiles.length === 0 ? '' : `
        <div style="font-size:12px;color:var(--ink-soft);margin-bottom:6px">已选 ${pickedFiles.length} 个文件，合计 ${(total / 1024 / 1024).toFixed(1)} MB</div>
        <div style="max-height:240px;overflow:auto;border:1px solid var(--silver-soft);border-radius:6px">
          ${pickedFiles.map((f, i) => `
            <div style="display:flex;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--silver-soft);font-size:12px">
              <span>${/^video/.test(f.type) ? '🎥' : '🖼'} ${f.name}</span>
              <span class="muted">${(f.size / 1024 / 1024).toFixed(2)} MB</span>
            </div>
          `).join('')}
        </div>
      `;
      updateSubmit();
    }
    function updateSubmit() {
      const ok = pickedCat && pickedFiles.length > 0;
      document.getElementById('f_submit').disabled = !ok;
    }
    document.getElementById('f_submit').addEventListener('click', async () => {
      if (!pickedCat || pickedFiles.length === 0) return;
      const status = document.getElementById('f_status');
      const btn = document.getElementById('f_submit');
      btn.disabled = true; status.style.color = 'var(--ink)'; status.textContent = '上传中（' + pickedFiles.length + '）...';
      const fd = new FormData();
      fd.append('category', pickedCat);
      pickedFiles.forEach(f => fd.append('files', f));
      try {
        const r = await fetch('/api/v6/uploads/files', { method: 'POST', body: fd }).then(r => r.json());
        if (r.ok) {
          status.style.color = 'var(--success)';
          status.textContent = '✓ 已上传 ' + r.count + ' 个文件';
          st.tab = 'list';
          st.kind = pickedFiles[0] && /^video/.test(pickedFiles[0].type) ? 'video' : 'image';
          setTimeout(() => render_cs_upload(document.getElementById('page')), 800);
        } else {
          status.style.color = 'var(--danger)';
          status.textContent = '✗ ' + (r.error || '失败');
          btn.disabled = false;
        }
      } catch (e) {
        status.style.color = 'var(--danger)';
        status.textContent = '✗ ' + e.message;
        btn.disabled = false;
      }
    });
  }
};
window.setUpTab = (k) => { window.__upState.tab = k; render_cs_upload(document.getElementById('page')); };
window.setUpKind = (k) => { window.__upState.kind = k; render_cs_upload(document.getElementById('page')); };
window.copyUpText = async function (id) {
  const r = await api.get('/api/v6/uploads');
  const it = (r.items || []).find(x => x.id === id);
  if (!it) return;
  await navigator.clipboard.writeText(it.content || '');
  showToast('已复制到剪贴板', 'success');
};
window.delUpItem = async function (id) {
  if (!confirm('删除这条素材？')) return;
  const r = await fetch('/api/v6/uploads/' + id, { method: 'DELETE' }).then(r => r.json());
  if (r.ok) { showToast('已删除', 'success'); render_cs_upload(document.getElementById('page')); }
  else showToast('失败：' + (r.error || ''), 'error');
};

// 客服 + HQ 的 materials 也指向素材库（直接复用 upload 渲染的"素材库"tab）
window.render_cs_materials = function (page) {
  if (!window.__upState) window.__upState = { tab: 'list', kind: 'image', filter: '' };
  window.__upState.tab = 'list';
  return render_cs_upload(page);
};

// ===== 投放线：账户认领（2026-07-05）=====
// 投放人员自助多选巨量AD/本地推账户进行认领，认领后立即生效归属自己所在团队。
// 唯一归属：一个账户只能被一个团队认领；已被其他团队认领的账户接口层面完全不返回。
window.__adClaimState = { selected: new Set() }; // key = accountType+'_'+accountId

window.render_ad_claim = async function (page) {
  page.innerHTML = '<div class="loading">数据加载中...</div>';
  const r = await api.get('/api/oceanengine/accounts/claimable');
  if (!r.ok) { page.innerHTML = `<div class="card"><p class="muted">加载失败：${esc(r.error || '')}</p></div>`; return; }
  window.__adClaimData = r;
  window.__adClaimState.selected = new Set();
  renderAdClaimPage(page);
};

function renderAdClaimPage(page) {
  const { adAccounts = [], localAccounts = [] } = window.__adClaimData || {};
  const sel = window.__adClaimState.selected;

  const rowHtml = (a) => {
    const key = a.accountType + '_' + a.accountId;
    const checked = sel.has(key) ? 'checked' : '';
    const statusBadge = a.mine
      ? `<span style="color:var(--klein);font-weight:600">已认领（我）</span>`
      : `<span class="muted">未认领</span>`;
    return `
      <tr>
        <td><input type="checkbox" data-key="${escAttr(key)}" onchange="toggleAdClaimSelect(this)" ${checked}></td>
        <td>${esc(a.accountName)}</td>
        <td class="muted" style="font-size:12px">${esc(a.accountId)}</td>
        <td>${statusBadge}</td>
        <td class="muted" style="font-size:12px">${a.claimedAt ? new Date(a.claimedAt).toLocaleString('zh-CN') : '-'}</td>
      </tr>`;
  };

  const selCount = sel.size;

  page.innerHTML = `
    <div class="card">
      <h3>🎯 账户认领</h3>
      <p class="muted" style="margin:4px 0 12px">勾选下方巨量AD/本地推账户后点击"认领选中账户"，认领后立即归属你所在的团队。已被其他团队认领的账户不会显示在此列表。</p>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <button id="adClaimBtn" class="btn btn-primary" onclick="submitAdClaim('claim')" ${selCount ? '' : 'disabled'}>✅ 认领选中账户（${selCount}）</button>
        <button id="adUnclaimBtn" class="btn" onclick="submitAdClaim('unclaim')" ${selCount ? '' : 'disabled'}>↩️ 取消认领选中账户</button>
      </div>
    </div>

    <div class="card">
      <h3>📡 巨量AD账户（${adAccounts.length}）</h3>
      <div class="table-wrap"><table>
        <thead><tr><th></th><th>账户名</th><th>账户ID</th><th>状态</th><th>认领时间</th></tr></thead>
        <tbody>${adAccounts.map(rowHtml).join('') || '<tr><td colspan="5" class="muted" style="text-align:center;padding:24px">暂无可见账户</td></tr>'}</tbody>
      </table></div>
    </div>

    <div class="card">
      <h3>📍 本地推账户（${localAccounts.length}）</h3>
      <div class="table-wrap"><table>
        <thead><tr><th></th><th>账户名</th><th>账户ID</th><th>状态</th><th>认领时间</th></tr></thead>
        <tbody>${localAccounts.map(rowHtml).join('') || '<tr><td colspan="5" class="muted" style="text-align:center;padding:24px">暂无可见账户</td></tr>'}</tbody>
      </table></div>
    </div>
  `;
}

window.toggleAdClaimSelect = function (checkbox) {
  const key = checkbox.dataset.key;
  if (checkbox.checked) window.__adClaimState.selected.add(key);
  else window.__adClaimState.selected.delete(key);
  // 只需要更新按钮上的计数，不用整页重渲染（避免丢失其他勾选状态）
  const n = window.__adClaimState.selected.size;
  const claimBtn = document.getElementById('adClaimBtn');
  const unclaimBtn = document.getElementById('adUnclaimBtn');
  if (claimBtn) { claimBtn.textContent = `✅ 认领选中账户（${n}）`; claimBtn.disabled = n === 0; }
  if (unclaimBtn) unclaimBtn.disabled = n === 0;
};

window.submitAdClaim = async function (action) {
  const sel = window.__adClaimState.selected;
  if (!sel.size) return;
  const items = [...sel].map(key => {
    const idx = key.indexOf('_');
    return { accountType: key.slice(0, idx), accountId: key.slice(idx + 1) };
  });
  const url = action === 'claim' ? '/api/oceanengine/accounts/claim' : '/api/oceanengine/accounts/unclaim';
  const r = await api.post(url, { items });
  if (!r.ok && action === 'claim' && r.conflicts && r.conflicts.length) {
    const msg = r.conflicts.map(c => `${c.accountName || c.accountId}：${c.error}`).join('；');
    showToast('部分账户认领失败：' + msg, 'error', 3000);
  } else if (r.ok) {
    showToast(action === 'claim' ? '认领成功' : '已取消认领', 'success');
  } else {
    showToast('操作失败：' + (r.error || ''), 'error');
  }
  await render_ad_claim(document.getElementById('page'));
};
window.render_hq_materials = window.render_cs_materials;
