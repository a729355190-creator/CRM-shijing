// ===== 总部 HQ v3 =====
// 改动：1) 总览补完整 KPI；2) 看板加曲线/双轴/到店/城市；3) 报表加预设+三大块；
// 4) 客服业绩→客服部数据情况(团队/个人 tab)；5) 员工查询→市场部业绩查询；
// 6) 邀约加预设；7) 设置加新部门管理

// 时间预设辅助（统一口径：昨日 / 近3天 / 近7天 / 本月 / 自定义）
window.computePreset = function (preset, customFrom, customTo) {
  const today = todayStr();
  const dayAgo = (n) => fmtDate(new Date(Date.now() - n * 86400000));
  const monthStart = today.slice(0, 8) + '01';
  if (preset === 'yesterday') { const y = dayAgo(1); return { start: y, end: y, label: '昨日' }; }
  if (preset === '3d') return { start: dayAgo(2), end: today, label: '近3天' };
  if (preset === '7d') return { start: dayAgo(6), end: today, label: '近7天' };
  if (preset === 'month') return { start: monthStart, end: today, label: '本月' };
  // 兼容旧 preset 值，避免历史调用报错
  if (preset === 'today') return { start: today, end: today, label: '今日' };
  if (preset === 'week') return { start: dayAgo(6), end: today, label: '近7天' };
  return { start: customFrom, end: customTo, label: '自定义' };
};

window.presetButtons = function (curPreset, fnName) {
  const btn = (k, t) => `<button class="btn ${curPreset === k ? 'btn-primary' : ''}" style="height:32px;padding:0 12px;font-size:12px" onclick="${fnName}('${k}')">${t}</button>`;
  return btn('yesterday', '昨日') + btn('3d', '近3天') + btn('7d', '近7天') + btn('month', '本月');
};

// ============== 总览（完整 KPI）==============
window.render_hq_overview = async function (page) {
  page.innerHTML = '<div class="loading">数据加载中...</div>';
  await loadAllData();
  const today = todayStr();
  const monthStart = today.slice(0, 8) + '01';
  const m = calcMetrics(aggregateByDate(monthStart, today));

  page.innerHTML = `
    <div class="card" style="background:linear-gradient(135deg,var(--klein),var(--klein-deep));color:#fff;border:0">
      <h2 style="color:#fff;margin:0">${V6.user.realName} 老板，欢迎回来 🦾</h2>
      <p style="opacity:.85;margin:4px 0 0">本月数据范围：${monthStart} ~ ${today}</p>
    </div>

    <div class="card">
      <h3>📊 投放数据</h3>
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-label">广告消耗</div><div class="kpi-value">${fmtMoney(m.adCost)}</div></div>
        <div class="kpi"><div class="kpi-label">加粉人数</div><div class="kpi-value">${fmtNum(m.addFans)}</div></div>
        <div class="kpi"><div class="kpi-label">加粉成本</div><div class="kpi-value">${m.addFans > 0 ? fmtMoney(m.costPerFan) : '-'}</div></div>
        <div class="kpi"><div class="kpi-label">深转成交数</div><div class="kpi-value" style="color:var(--klein)">${fmtNum(m.deepConvert)}</div></div>
        <div class="kpi"><div class="kpi-label">深转率</div><div class="kpi-value">${fmtPct(m.deepRate)}</div></div>
        <div class="kpi"><div class="kpi-label">深转成本</div><div class="kpi-value">${m.deepConvert > 0 ? fmtMoney(m.deepCost) : '-'}</div></div>
      </div>
    </div>

    <div class="card">
      <h3>💼 客服数据</h3>
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-label">定金数</div><div class="kpi-value">${fmtNum(m.depositCount)}</div></div>
        <div class="kpi"><div class="kpi-label">定金率</div><div class="kpi-value">${fmtPct(m.depositRate)}</div></div>
        <div class="kpi"><div class="kpi-label">定金收款</div><div class="kpi-value" style="color:var(--danger)">${fmtMoney(m.depositAmount)}</div></div>
        <div class="kpi"><div class="kpi-label">定金成本</div><div class="kpi-value">${m.depositCount > 0 ? fmtMoney(m.depositCost) : '-'}</div></div>
      </div>
    </div>

    <div class="card">
      <h3>🏪 门店数据</h3>
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-label">新客到店</div><div class="kpi-value">${fmtNum(m.newArriveCount)}</div></div>
        <div class="kpi"><div class="kpi-label">到店成本</div><div class="kpi-value">${m.newArriveCount > 0 ? fmtMoney(m.arriveCost) : '-'}</div></div>
        <div class="kpi"><div class="kpi-label">新客操作</div><div class="kpi-value">${fmtNum(m.newOpCount)}</div></div>
        <div class="kpi"><div class="kpi-label">操作成本</div><div class="kpi-value">${m.newOpCount > 0 ? fmtMoney(m.opCost) : '-'}</div></div>
        <div class="kpi"><div class="kpi-label">新客成交</div><div class="kpi-value" style="color:var(--success)">${fmtNum(m.newCloseCount)}</div></div>
        <div class="kpi"><div class="kpi-label">成单成本</div><div class="kpi-value">${m.newCloseCount > 0 ? fmtMoney(m.closeCost) : '-'}</div></div>
        <div class="kpi"><div class="kpi-label">新客营业额</div><div class="kpi-value">${fmtMoney(m.newRevenue)}</div></div>
        <div class="kpi"><div class="kpi-label">老客到店</div><div class="kpi-value">${fmtNum(m.oldArriveCount)}</div></div>
        <div class="kpi"><div class="kpi-label">老客操作</div><div class="kpi-value">${fmtNum(m.oldOpCount)}</div></div>
        <div class="kpi"><div class="kpi-label">老客成交</div><div class="kpi-value">${fmtNum(m.oldCloseCount)}</div></div>
        <div class="kpi"><div class="kpi-label">老客营业额</div><div class="kpi-value">${fmtMoney(m.oldRevenue)}</div></div>
      </div>
    </div>

    <div class="card" style="background:linear-gradient(135deg,#fff8f0,#fff)">
      <h3>🏆 总营业额 / ROI / 客单价</h3>
      <div class="kpi-grid">
        <div class="kpi" style="background:rgba(0,47,167,.04)"><div class="kpi-label">总营业额</div><div class="kpi-value" style="color:var(--klein);font-size:26px">${fmtMoney(m.revenue)}</div></div>
        <div class="kpi" style="background:rgba(0,47,167,.04)"><div class="kpi-label">ROI 投资回报</div><div class="kpi-value" style="color:var(--klein);font-size:26px">${m.roi.toFixed(2)}×</div></div>
        <div class="kpi" style="background:rgba(0,47,167,.04)"><div class="kpi-label">客单价（营业额/新客到店）</div><div class="kpi-value" style="color:var(--klein);font-size:26px">${m.newArriveCount > 0 ? fmtMoney(m.arpu) : '-'}</div></div>
      </div>
    </div>

    <div class="card">
      <h3>🔗 快捷入口</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn btn-primary" href="#data">📊 数据看板</a>
        <a class="btn" href="#report">⊞ 数据报表</a>
        <a class="btn" href="#cs_perf">☎ 客服明细</a>
        <a class="btn" href="#staff">◇ 市场部明细</a>
        <a class="btn" href="#invite">📞 全部排客</a>
        <a class="btn" href="#users">◈ 用户管理</a>
        <a class="btn" href="#settings">⚙️ 系统设置</a>
      </div>
    </div>
  `;
};

// ============== 数据看板（多曲线）==============
window.render_hq_data = async function (page) {
  page.innerHTML = '<div class="loading">数据加载中...</div>';
  await loadAllData();
  destroyCharts();
  const F = window.__hqDbFilter = window.__hqDbFilter || { preset: 'month', from: '', to: '' };
  const { start, end, label } = computePreset(F.preset, F.from, F.to);

  page.innerHTML = `
    <div class="card">
      <h3>📈 数据看板 <span style="font-size:13px;color:var(--ink-mute);font-weight:400">（${label}：${start} ~ ${end}）</span></h3>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px">
        ${presetButtons(F.preset, 'setHQDbPreset')}
        <span style="color:var(--ink-mute);margin-left:8px">自定义：</span>
        <input type="date" class="input" id="db_start" value="${start}" style="width:auto;height:32px;font-size:12px"/>
        <span style="color:var(--ink-mute)">至</span>
        <input type="date" class="input" id="db_end" value="${end}" style="width:auto;height:32px;font-size:12px"/>
        <button class="btn btn-primary" style="height:32px;padding:0 12px;font-size:12px" onclick="applyHQDbCustom()">应用</button>
      </div>
    </div>

    <div class="card">
      <h3>📊 趋势曲线</h3>
      <div class="chart-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:8px">
        <div class="chart-box"><div class="chart-title">每日广告消耗</div><div class="chart-canvas-wrap"><canvas id="ch_cost"></canvas></div></div>
        <div class="chart-box"><div class="chart-title">加粉数 vs 加粉成本</div><div class="chart-canvas-wrap"><canvas id="ch_fans"></canvas></div></div>
        <div class="chart-box"><div class="chart-title">定金数 vs 定金成本</div><div class="chart-canvas-wrap"><canvas id="ch_dep"></canvas></div></div>
        <div class="chart-box"><div class="chart-title">营业额 vs 客单价</div><div class="chart-canvas-wrap"><canvas id="ch_rev"></canvas></div></div>
        <div class="chart-box" style="grid-column:1/-1"><div class="chart-title">新客到店 vs 老客到店</div><div class="chart-canvas-wrap"><canvas id="ch_arr"></canvas></div></div>
      </div>
    </div>

    <div id="city_zone"></div>
  `;

  if (window.matchMedia('(max-width: 768px)').matches) {
    const cg = page.querySelector('.chart-grid');
    if (cg) cg.style.gridTemplateColumns = '1fr';
  }

  // 按日聚合
  const dates = [];
  const cur = new Date(start);
  const last = new Date(end);
  while (cur <= last) { dates.push(fmtDate(cur)); cur.setDate(cur.getDate() + 1); }
  const dayData = dates.map(d => calcMetrics(aggregateByDate(d, d)));

  const baseOpts = { responsive: true, maintainAspectRatio: false };
  const ax2 = (label1, label2) => ({ y: { type: 'linear', position: 'left', title: { display: true, text: label1, font: { size: 10 } } }, y1: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: label2, font: { size: 10 } } } });

  // 1) 每日广告消耗
  chartInstances.push(new Chart(document.getElementById('ch_cost'), {
    type: 'bar',
    data: { labels: dates, datasets: [{ label: '广告消耗', data: dayData.map(x => x.adCost), backgroundColor: '#002fa7' }] },
    options: { ...baseOpts, plugins: { legend: { display: false } } },
  }));

  // 2) 加粉 vs 加粉成本（双轴）
  chartInstances.push(new Chart(document.getElementById('ch_fans'), {
    type: 'bar',
    data: {
      labels: dates,
      datasets: [
        { type: 'bar', label: '加粉数', data: dayData.map(x => x.addFans), backgroundColor: '#2e5dd6', yAxisID: 'y' },
        { type: 'line', label: '加粉成本', data: dayData.map(x => +(x.costPerFan || 0).toFixed(2)), borderColor: '#e6a23c', backgroundColor: 'rgba(230,162,60,.15)', yAxisID: 'y1', tension: .3 },
      ],
    },
    options: { ...baseOpts, scales: ax2('加粉数', '加粉成本(元)'), plugins: { legend: { position: 'top', labels: { font: { size: 11 } } } } },
  }));

  // 3) 定金数 vs 定金成本（双轴）
  chartInstances.push(new Chart(document.getElementById('ch_dep'), {
    type: 'bar',
    data: {
      labels: dates,
      datasets: [
        { type: 'bar', label: '定金数', data: dayData.map(x => x.depositCount), backgroundColor: '#5a78c8', yAxisID: 'y' },
        { type: 'line', label: '定金成本', data: dayData.map(x => +(x.depositCost || 0).toFixed(2)), borderColor: '#c0392b', backgroundColor: 'rgba(192,57,43,.12)', yAxisID: 'y1', tension: .3 },
      ],
    },
    options: { ...baseOpts, scales: ax2('定金数', '定金成本(元)'), plugins: { legend: { position: 'top', labels: { font: { size: 11 } } } } },
  }));

  // 4) 营业额 vs 客单价
  chartInstances.push(new Chart(document.getElementById('ch_rev'), {
    type: 'bar',
    data: {
      labels: dates,
      datasets: [
        { type: 'bar', label: '营业额', data: dayData.map(x => x.revenue), backgroundColor: '#002fa7', yAxisID: 'y' },
        { type: 'line', label: '客单价', data: dayData.map(x => +(x.arpu || 0).toFixed(2)), borderColor: '#ffd54f', backgroundColor: 'rgba(255,213,79,.2)', yAxisID: 'y1', tension: .3 },
      ],
    },
    options: { ...baseOpts, scales: ax2('营业额', '客单价'), plugins: { legend: { position: 'top', labels: { font: { size: 11 } } } } },
  }));

  // 5) 新客 vs 老客到店
  chartInstances.push(new Chart(document.getElementById('ch_arr'), {
    type: 'line',
    data: {
      labels: dates,
      datasets: [
        { label: '新客到店', data: dayData.map(x => x.newArriveCount), borderColor: '#002fa7', backgroundColor: 'rgba(0,47,167,.12)', fill: true, tension: .3 },
        { label: '老客到店', data: dayData.map(x => x.oldArriveCount), borderColor: '#e6a23c', backgroundColor: 'rgba(230,162,60,.12)', fill: true, tension: .3 },
      ],
    },
    options: { ...baseOpts, plugins: { legend: { position: 'top', labels: { font: { size: 11 } } } } },
  }));

  // 城市
  fillCityZone(document.getElementById('city_zone'), start, end, '城市维度（消耗/营业额/ROI）');
};

window.setHQDbPreset = (p) => { window.__hqDbFilter = { preset: p, from: '', to: '' }; render_hq_data(document.getElementById('page')); };
window.applyHQDbCustom = () => {
  const from = document.getElementById('db_start').value;
  const to = document.getElementById('db_end').value;
  if (!from || !to) return alert('请选择起止日期');
  window.__hqDbFilter = { preset: 'custom', from, to };
  render_hq_data(document.getElementById('page'));
};

// 城市表（含营业额/ROI）
async function fillCityZone(container, s, e, title) {
  if (!container) return;
  container.innerHTML = `<div class="card"><h3>🏙 ${title}</h3><div class="loading">加载中...</div></div>`;
  try {
    const r = await fetch('/api/oceanengine/by-city?start=' + s + '&end=' + e).then(r => r.json());
    const cities = (r.cities || []).filter(c => c.cost >= 1);
    if (cities.length === 0) {
      container.innerHTML = `<div class="card"><h3>🏙 ${title}</h3><p class="muted">该区间内暂无城市数据</p></div>`;
      return;
    }
    // 用 teams[].city 把门店营业额映射到城市
    const teams = DB.teams || {};
    const stores = (DB.store || []).filter(x => x.date >= s && x.date <= e);
    const cityRev = {};
    stores.forEach(x => {
      const t = teams[x.teamId];
      const city = t && t.city ? t.city : '未知';
      if (!cityRev[city]) cityRev[city] = 0;
      cityRev[city] += (+x.opAmount || 0) + (+x.closedAmount || 0);
    });

    const totalCost = cities.reduce((s, c) => s + c.cost, 0);
    const totalFans = cities.reduce((s, c) => s + c.addFans, 0);
    const totalDeep = cities.reduce((s, c) => s + (+c.deepConvert || 0), 0);
    const totalArrived = cities.reduce((s, c) => s + (+c.arrivedCount || 0), 0);
    container.innerHTML = `
      <div class="card">
        <h3>🏙 ${title}
          <span style="font-size:12px;color:var(--ink-mute);font-weight:400;margin-left:12px">
            ${cities.length} 城 · 总消耗 ${fmtMoney(totalCost)} · 加粉 ${totalFans} · 高潜成交 ${totalDeep} · 到店 ${totalArrived}
          </span>
        </h3>
        <div class="table-wrap"><table>
          <thead><tr>
            <th>排名</th><th>城市</th><th style="text-align:right">消耗</th><th style="text-align:right">占比</th>
            <th style="text-align:right">加粉</th><th style="text-align:right">加粉成本</th>
            <th style="text-align:right">高潜成交</th><th style="text-align:right">高潜成本</th>
            <th style="text-align:right">到店数</th><th style="text-align:right">到店成本</th>
            <th style="text-align:right">营业额</th><th style="text-align:right">ROI</th>
          </tr></thead>
          <tbody>${cities.map((c, i) => {
            const rev = cityRev[c.city] || 0;
            const roi = c.cost > 0 ? rev / c.cost : 0;
            const deep = +c.deepConvert || 0;
            const deepCost = deep > 0 ? c.cost / deep : 0;
            const arrived = +c.arrivedCount || 0;
            const arrivedCost = +c.costPerArrived || 0;
            return `<tr ${i < 3 ? 'style="background:var(--klein-soft)"' : ''}>
              <td>${i + 1}</td>
              <td><b>${c.city}</b></td>
              <td style="text-align:right">${fmtMoney(c.cost)}</td>
              <td style="text-align:right">${(c.cost / totalCost * 100).toFixed(1)}%</td>
              <td style="text-align:right">${c.addFans}</td>
              <td style="text-align:right">${c.addFans > 0 ? fmtMoney(c.cost / c.addFans) : '-'}</td>
              <td style="text-align:right;color:var(--klein)">${deep}</td>
              <td style="text-align:right">${deep > 0 ? fmtMoney(deepCost) : '-'}</td>
              <td style="text-align:right;color:var(--klein)">${arrived}</td>
              <td style="text-align:right">${arrived > 0 ? fmtMoney(arrivedCost) : '-'}</td>
              <td style="text-align:right;color:var(--danger)">${rev > 0 ? fmtMoney(rev) : '-'}</td>
              <td style="text-align:right;color:var(--klein);font-weight:600">${rev > 0 ? roi.toFixed(2) + '×' : '-'}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>
        <p class="muted" style="font-size:11px;margin-top:8px">说明：城市维度的高潜成交 = 当日总高潜按城市消耗比例分摊的整数（最大余数法），保证日内合计 = 巨量返回的真实日总值；到店数 = invite 表 status='arrived' 按门店城市聚合。</p>
      </div>`;
  } catch (e) {
    container.innerHTML = `<div class="card"><p style="color:var(--danger)">加载失败：${e.message}</p></div>`;
  }
}

// ============== 数据报表（预设 + 三大块）==============
window.render_hq_report = async function (page) {
  page.innerHTML = '<div class="loading">加载中...</div>';
  await loadAllData();
  const F = window.__hqRpFilter = window.__hqRpFilter || { preset: 'month', from: '', to: '' };
  const { start, end, label } = computePreset(F.preset, F.from, F.to);

  page.innerHTML = `
    <div class="card">
      <h2>⊞ 数据报表 <span style="font-size:13px;color:var(--ink-mute);font-weight:400">（${label}：${start} ~ ${end}）</span></h2>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px">
        ${presetButtons(F.preset, 'setHQRpPreset')}
        <span style="color:var(--ink-mute);margin-left:8px">自定义：</span>
        <input type="date" class="input" id="rp_start" value="${start}" style="width:auto;height:32px;font-size:12px"/>
        <span style="color:var(--ink-mute)">至</span>
        <input type="date" class="input" id="rp_end" value="${end}" style="width:auto;height:32px;font-size:12px"/>
        <button class="btn btn-primary" style="height:32px;padding:0 12px;font-size:12px" onclick="applyHQRpCustom()">应用</button>
        <button class="btn" style="height:32px;padding:0 12px;font-size:12px" onclick="exportHQReport()">导出 CSV</button>
      </div>
    </div>

    <div class="card">
      <h3>📣 投放团队</h3>
      <div id="rp_ad"></div>
    </div>

    <div class="card">
      <h3>💼 客服团队</h3>
      <div id="rp_cs"></div>
    </div>

    <div class="card">
      <h3>🏪 门店</h3>
      <div id="rp_store"></div>
    </div>
  `;

  // 投放
  const adTeams = teamsByRoleAll('ad');
  document.getElementById('rp_ad').innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th style="width:30px"></th><th>团队</th><th style="text-align:right">消耗</th><th style="text-align:right">加粉</th><th style="text-align:right">加粉成本</th><th style="text-align:right">高潜成交</th><th style="text-align:right">高潜成本</th></tr></thead>
      <tbody>${adTeams.map(t => {
        const sm = calcMetrics(aggregateByDate(start, end, { ad: t.id }));
        return `<tr class="rp-row" data-type="ad" data-id="${t.id}" style="cursor:pointer">
          <td><span class="rp-arrow" style="color:var(--ink-mute);font-size:11px">▶</span></td>
          <td><b>${t.name}${t.deleted ? ' (停用)' : ''}</b></td>
          <td style="text-align:right">${fmtMoney(sm.adCost)}</td>
          <td style="text-align:right">${sm.addFans}</td>
          <td style="text-align:right">${sm.addFans > 0 ? fmtMoney(sm.costPerFan) : '-'}</td>
          <td style="text-align:right;color:var(--klein)">${sm.deepConvert}</td>
          <td style="text-align:right">${sm.deepConvert > 0 ? fmtMoney(sm.deepCost) : '-'}</td>
        </tr><tr class="rp-detail" id="dt-ad-${t.id}" style="display:none"><td colspan="7" style="background:var(--silver-bg);padding:0"></td></tr>`;
      }).join('')}</tbody>
    </table></div>
  `;

  // 客服
  const csTeams = teamsByRoleAll('cs');
  document.getElementById('rp_cs').innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th style="width:30px"></th><th>团队</th><th style="text-align:right">加粉</th><th style="text-align:right">定金数</th><th style="text-align:right">定金率</th><th style="text-align:right">定金收款</th><th style="text-align:right">排客</th><th style="text-align:right">已到店</th></tr></thead>
      <tbody>${csTeams.map(t => {
        const sm = calcMetrics(aggregateByDate(start, end, { cs: t.id }));
        const inv = (DB.invite || []).filter(x => x.csTeamId === t.id && (x.arriveTime || '').slice(0, 10) >= start && (x.arriveTime || '').slice(0, 10) <= end);
        return `<tr class="rp-row" data-type="cs" data-id="${t.id}" style="cursor:pointer">
          <td><span class="rp-arrow" style="color:var(--ink-mute);font-size:11px">▶</span></td>
          <td><b>${t.name}${t.deleted ? ' (停用)' : ''}</b></td>
          <td style="text-align:right">${sm.csAddFans}</td>
          <td style="text-align:right;color:var(--klein)">${sm.depositCount}</td>
          <td style="text-align:right">${sm.csAddFans > 0 ? fmtPct(sm.depositRate) : '-'}</td>
          <td style="text-align:right;color:var(--danger)">${fmtMoney(sm.depositAmount)}</td>
          <td style="text-align:right">${inv.length}</td>
          <td style="text-align:right;color:var(--success)">${inv.filter(x => x.status === 'arrived').length}</td>
        </tr><tr class="rp-detail" id="dt-cs-${t.id}" style="display:none"><td colspan="8" style="background:var(--silver-bg);padding:0"></td></tr>`;
      }).join('')}</tbody>
    </table></div>
  `;

  // 门店
  const storeTeams = teamsByRoleAll('store');
  document.getElementById('rp_store').innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th style="width:30px"></th><th>门店</th><th style="text-align:right">新到</th><th style="text-align:right">新操作</th><th style="text-align:right">新成交</th><th style="text-align:right">新营业额</th><th style="text-align:right">老到</th><th style="text-align:right">老操作</th><th style="text-align:right">老营业额</th><th style="text-align:right">总营业额</th><th style="text-align:right">客单价</th></tr></thead>
      <tbody>${storeTeams.map(t => {
        const sm = calcMetrics(aggregateByDate(start, end, { store: t.id }));
        return `<tr class="rp-row" data-type="store" data-id="${t.id}" style="cursor:pointer">
          <td><span class="rp-arrow" style="color:var(--ink-mute);font-size:11px">▶</span></td>
          <td><b>${t.name}${t.deleted ? ' (停用)' : ''}</b></td>
          <td style="text-align:right">${sm.newArriveCount}</td>
          <td style="text-align:right">${sm.newOpCount}</td>
          <td style="text-align:right">${sm.newCloseCount}</td>
          <td style="text-align:right">${fmtMoney(sm.newRevenue)}</td>
          <td style="text-align:right">${sm.oldArriveCount}</td>
          <td style="text-align:right">${sm.oldOpCount}</td>
          <td style="text-align:right">${fmtMoney(sm.oldRevenue)}</td>
          <td style="text-align:right;color:var(--danger);font-weight:500">${fmtMoney(sm.revenue)}</td>
          <td style="text-align:right">${sm.newArriveCount > 0 ? fmtMoney(sm.arpu) : '-'}</td>
        </tr><tr class="rp-detail" id="dt-store-${t.id}" style="display:none"><td colspan="11" style="background:var(--silver-bg);padding:0"></td></tr>`;
      }).join('')}</tbody>
    </table></div>
  `;

  // 绑定行点击 → 展开/收起 + 拉人员明细
  document.querySelectorAll('.rp-row').forEach(tr => {
    tr.addEventListener('click', async () => {
      const type = tr.dataset.type;
      const id = tr.dataset.id;
      const detailRow = document.getElementById(`dt-${type}-${id}`);
      const arrow = tr.querySelector('.rp-arrow');
      const isOpen = detailRow.style.display !== 'none';
      if (isOpen) {
        detailRow.style.display = 'none';
        arrow.textContent = '▶';
      } else {
        detailRow.style.display = '';
        arrow.textContent = '▼';
        // 第一次展开时拉人员明细
        const cell = detailRow.querySelector('td');
        if (!cell.dataset.loaded) {
          cell.innerHTML = '<div style="padding:14px"><div class="loading">明细加载中...</div></div>';
          cell.dataset.loaded = '1';
          await renderTeamDetail(cell, type, id, start, end);
        }
      }
    });
  });
};

// 渲染团队下钻：人员明细（按角色分别处理）
async function renderTeamDetail(cell, type, teamId, start, end) {
  const r = await api.get('/api/v6/users');
  const users = (r.users || []).filter(u => u.teamId === teamId);
  const t = (DB.teams || {})[teamId] || {};

  if (type === 'ad') {
    // 投放：按账户聚合
    const ad = (DB.ad || []).filter(x => !x.cityName && x.teamId === teamId && x.date >= start && x.date <= end);
    const byAcc = {};
    ad.forEach(x => {
      const k = x.ocAccountName || x.ocAccountId || '默认';
      if (!byAcc[k]) byAcc[k] = { name: k, cost: 0, fans: 0, deep: 0 };
      byAcc[k].cost += +x.cost || 0;
      byAcc[k].fans += +x.addFans || 0;
      byAcc[k].deep += +x.deepConvert || 0;
    });
    const accList = Object.values(byAcc).sort((a, b) => b.cost - a.cost);
    cell.innerHTML = `
      <div style="padding:14px">
        <h4 style="margin:0 0 10px;color:var(--ink-soft);font-size:13px">📌 ${t.name} · 按账户拆分（${accList.length}）</h4>
        <table style="background:#fff"><thead><tr><th>账户</th><th style="text-align:right">消耗</th><th style="text-align:right">加粉</th><th style="text-align:right">加粉成本</th><th style="text-align:right">高潜</th><th style="text-align:right">高潜成本</th></tr></thead>
        <tbody>${accList.map(a => `<tr>
          <td><b>${a.name}</b></td>
          <td style="text-align:right">${fmtMoney(a.cost)}</td>
          <td style="text-align:right">${a.fans}</td>
          <td style="text-align:right">${a.fans > 0 ? fmtMoney(a.cost / a.fans) : '-'}</td>
          <td style="text-align:right;color:var(--klein)">${a.deep}</td>
          <td style="text-align:right">${a.deep > 0 ? fmtMoney(a.cost / a.deep) : '-'}</td>
        </tr>`).join('') || '<tr><td colspan="6" class="muted" style="text-align:center;padding:14px">无账户数据</td></tr>'}</tbody></table>
      </div>
    `;
  } else if (type === 'cs') {
    // 客服：按个人
    const cs = (DB.cs || []).filter(x => x.teamId === teamId && x.date >= start && x.date <= end);
    const inv = (DB.invite || []).filter(x => x.csTeamId === teamId && (x.arriveTime || '').slice(0, 10) >= start && (x.arriveTime || '').slice(0, 10) <= end);
    const rows = users.map(u => {
      const myCs = cs.filter(x => x.lastEditByUserId === u.id || x.lastEditBy === u.realName + '(' + u.username + ')');
      const myInv = inv.filter(x => x.csUserId === u.id || x.csUserName === u.realName);
      const fans = myCs.reduce((s, x) => s + (+x.addFans || 0), 0);
      const dep = myCs.reduce((s, x) => s + (+x.depositCount || 0), 0);
      const amount = myCs.reduce((s, x) => s + (+x.depositAmount || 0), 0);
      const arrived = myInv.filter(x => x.status === 'arrived').length;
      return { name: u.realName + ' (' + u.username + ')', fans, dep, amount, invited: myInv.length, arrived };
    });
    cell.innerHTML = `
      <div style="padding:14px">
        <h4 style="margin:0 0 10px;color:var(--ink-soft);font-size:13px">📌 ${t.name} · 按个人拆分（${rows.length}）</h4>
        <table style="background:#fff"><thead><tr><th>客服</th><th style="text-align:right">加粉</th><th style="text-align:right">定金</th><th style="text-align:right">定金率</th><th style="text-align:right">定金收款</th><th style="text-align:right">排客</th><th style="text-align:right">已到店</th><th style="text-align:right">到店率</th></tr></thead>
        <tbody>${rows.map(r => `<tr>
          <td><b>${r.name}</b></td>
          <td style="text-align:right">${r.fans}</td>
          <td style="text-align:right;color:var(--klein)">${r.dep}</td>
          <td style="text-align:right">${r.fans > 0 ? fmtPct(r.dep / r.fans * 100) : '-'}</td>
          <td style="text-align:right;color:var(--danger)">${fmtMoney(r.amount)}</td>
          <td style="text-align:right">${r.invited}</td>
          <td style="text-align:right;color:var(--success)">${r.arrived}</td>
          <td style="text-align:right">${r.invited > 0 ? (r.arrived / r.invited * 100).toFixed(1) + '%' : '-'}</td>
        </tr>`).join('') || '<tr><td colspan="8" class="muted" style="text-align:center;padding:14px">该团队无个人数据</td></tr>'}</tbody></table>
      </div>
    `;
  } else if (type === 'store') {
    // 门店：按贡献人
    const stores = (DB.store || []).filter(x => x.teamId === teamId && x.date >= start && x.date <= end);
    const rows = users.map(u => {
      const myList = stores.filter(s => (s.performer || '').trim() === u.realName);
      const newC = myList.filter(x => x.customerType === '新客').length;
      const oldC = myList.filter(x => x.customerType === '老客').length;
      const opC = myList.filter(x => x.isOperated === '是').length;
      const closeC = myList.filter(x => x.isClosed === '是').length;
      const rev = myList.reduce((s, x) => s + (+x.opAmount || 0) + (+x.closedAmount || 0), 0);
      return { name: u.realName + (u.position === 'manager' ? ' (店长)' : ''), receive: myList.length, newC, oldC, opC, closeC, rev };
    });
    cell.innerHTML = `
      <div style="padding:14px">
        <h4 style="margin:0 0 10px;color:var(--ink-soft);font-size:13px">📌 ${t.name} · 按员工拆分（${rows.length}）</h4>
        <table style="background:#fff"><thead><tr><th>员工</th><th style="text-align:right">接待</th><th style="text-align:right">新客</th><th style="text-align:right">老客</th><th style="text-align:right">操作</th><th style="text-align:right">成交</th><th style="text-align:right">营业额</th><th style="text-align:right">客单价</th></tr></thead>
        <tbody>${rows.map(r => `<tr>
          <td><b>${r.name}</b></td>
          <td style="text-align:right">${r.receive}</td>
          <td style="text-align:right">${r.newC}</td>
          <td style="text-align:right">${r.oldC}</td>
          <td style="text-align:right">${r.opC}</td>
          <td style="text-align:right;color:var(--success)">${r.closeC}</td>
          <td style="text-align:right;color:var(--danger);font-weight:500">${fmtMoney(r.rev)}</td>
          <td style="text-align:right">${r.newC > 0 ? fmtMoney(r.rev / r.newC) : '-'}</td>
        </tr>`).join('') || '<tr><td colspan="8" class="muted" style="text-align:center;padding:14px">该门店无员工业绩</td></tr>'}</tbody></table>
      </div>
    `;
  }
}

window.setHQRpPreset = (p) => { window.__hqRpFilter = { preset: p, from: '', to: '' }; render_hq_report(document.getElementById('page')); };
window.applyHQRpCustom = () => {
  const from = document.getElementById('rp_start').value;
  const to = document.getElementById('rp_end').value;
  if (!from || !to) return alert('请选择起止日期');
  window.__hqRpFilter = { preset: 'custom', from, to };
  render_hq_report(document.getElementById('page'));
};

window.hqDrillTeam = function (type, id, start, end) {
  const t = (DB.teams || {})[id];
  const filter = { [type]: id };
  const sm = calcMetrics(aggregateByDate(start, end, filter));
  const lines = [
    ['广告消耗', fmtMoney(sm.adCost)], ['加粉', fmtNum(sm.addFans)], ['加粉成本', sm.addFans > 0 ? fmtMoney(sm.costPerFan) : '-'],
    ['深转', fmtNum(sm.deepConvert)], ['深转成本', sm.deepConvert > 0 ? fmtMoney(sm.deepCost) : '-'],
    ['定金数', fmtNum(sm.depositCount)], ['定金率', fmtPct(sm.depositRate)], ['定金收款', fmtMoney(sm.depositAmount)],
    ['新客到店', fmtNum(sm.newArriveCount)], ['老客到店', fmtNum(sm.oldArriveCount)],
    ['新客操作', fmtNum(sm.newOpCount)], ['新客成交', fmtNum(sm.newCloseCount)],
    ['新客营业额', fmtMoney(sm.newRevenue)], ['老客营业额', fmtMoney(sm.oldRevenue)],
    ['总营业额', fmtMoney(sm.revenue)], ['ROI', sm.roi.toFixed(2) + '×'],
  ];
  const overlay = document.createElement('div');
  overlay.id = 'drillOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(20,28,56,.4);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:8px;padding:24px;max-width:520px;width:100%;box-shadow:0 12px 40px rgba(0,0,0,.2)">
      <h3 style="margin:0 0 4px">${t ? t.name : id}</h3>
      <p class="muted" style="margin:0 0 16px">${start} ~ ${end}</p>
      <div class="table-wrap"><table>
        <thead><tr><th>指标</th><th>数值</th></tr></thead>
        <tbody>${lines.map(([k, v]) => `<tr><td>${k}</td><td><b>${v}</b></td></tr>`).join('')}</tbody>
      </table></div>
      <div style="text-align:right;margin-top:12px"><button class="btn btn-primary" onclick="document.getElementById('drillOverlay').remove()">关闭</button></div>
    </div>
  `;
  document.body.appendChild(overlay);
};

window.exportHQReport = function () {
  const F = window.__hqRpFilter;
  const { start, end } = computePreset(F.preset, F.from, F.to);
  const m = calcMetrics(aggregateByDate(start, end));
  const lines = [
    '指标,数值',
    `广告消耗,${m.adCost}`, `加粉人数,${m.addFans}`, `加粉成本,${m.costPerFan.toFixed(2)}`,
    `深转成交数,${m.deepConvert}`, `深转率,${m.deepRate.toFixed(2)}%`, `深转成本,${m.deepConvert ? m.deepCost.toFixed(2) : '-'}`,
    `定金数,${m.depositCount}`, `定金率,${m.depositRate.toFixed(2)}%`, `定金收款金额,${m.depositAmount.toFixed(2)}`,
    `新客到店数,${m.newArriveCount}`, `老客到店数,${m.oldArriveCount}`, `到店成本,${m.arriveCost.toFixed(2)}`,
    `新客操作数,${m.newOpCount}`, `新客成交数,${m.newCloseCount}`,
    `新客营业额,${m.newRevenue.toFixed(2)}`, `老客营业额,${m.oldRevenue.toFixed(2)}`, `总营业额,${m.revenue.toFixed(2)}`,
    `客单价,${m.newArriveCount ? m.arpu.toFixed(2) : '-'}`,
    `ROI,${m.roi.toFixed(2)}`,
  ];
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `仕净报表_${start}_${end}.csv`; a.click();
  URL.revokeObjectURL(url);
};

// ============== 客服部数据情况（团队 + 个人 tab）==============
window.render_hq_cs_perf = async function (page) {
  page.innerHTML = '<div class="loading">加载中，请稍后…</div>';
  await loadAllData();
  const usersR = await api.get('/api/v6/users');
  const users = (usersR.users || []).filter(u => u.role === 'cs');

  const F = window.__hqCsFilter = window.__hqCsFilter || { preset: 'month', from: '', to: '', tab: 'team' };
  const { start, end, label } = computePreset(F.preset, F.from, F.to);

  const cs = (DB.cs || []).filter(x => x.date >= start && x.date <= end);
  const inv = (DB.invite || []).filter(x => {
    const d = (x.arriveTime || '').slice(0, 10);
    return d >= start && d <= end;
  });

  page.innerHTML = `
    <div class="card">
      <h2>☎ 客服明细 <span style="font-size:13px;color:var(--ink-mute);font-weight:400">（${label}：${start} ~ ${end}）</span></h2>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px">
        ${presetButtons(F.preset, 'setHQCsPreset')}
        <input type="date" class="input" id="cp_start" value="${start}" style="width:auto;height:32px;font-size:12px"/>
        <span style="color:var(--ink-mute)">至</span>
        <input type="date" class="input" id="cp_end" value="${end}" style="width:auto;height:32px;font-size:12px"/>
        <button class="btn btn-primary" style="height:32px;padding:0 12px;font-size:12px" onclick="applyHQCsCustom()">应用</button>
      </div>
      <p class="muted" style="margin-top:8px;font-size:12px">先看团队总数，点击团队行可展开/收起该团队下的客服个人明细。</p>
    </div>
  `;

  // 按团队聚合，团队下挂个人；点团队行展开个人
  const csTeams = teamsByRoleAll('cs');
  const teamBlocks = csTeams.map(t => {
    const teamCs = cs.filter(x => x.teamId === t.id);
    const teamInv = inv.filter(x => x.csTeamId === t.id);
    const teamRow = csStat(t.name + (t.deleted ? ' (停用)' : ''), teamCs, teamInv);
    // 团队下的客服个人
    const teamUsers = users.filter(u => (u.csTeamId || u.teamId) === t.id);
    const memberRows = teamUsers.map(u => {
      const myCs = teamCs.filter(x => x.lastEditByUserId === u.id || x.lastEditBy === u.realName + '(' + u.username + ')');
      const myInv = teamInv.filter(x => x.csUserId === u.id || x.csUserName === u.realName);
      return csStat(u.realName + '（' + u.username + '）', myCs, myInv);
    }).sort((a, b) => b.dep - a.dep);
    return { team: t, teamRow, memberRows };
  }).sort((a, b) => b.teamRow.dep - a.teamRow.dep);

  page.appendChild(buildTeamTable(teamBlocks));

  function csStat(name, csList, invList) {
    const fans = csList.reduce((s, x) => s + (+x.addFans || 0), 0);
    const dep = csList.reduce((s, x) => s + (+x.depositCount || 0), 0);
    const amount = csList.reduce((s, x) => s + (+x.depositAmount || 0), 0);
    const invited = invList.length;
    const arrived = invList.filter(x => x.status === 'arrived').length;
    return {
      name, fans, dep, amount, invited, arrived,
      depRate: fans > 0 ? (dep / fans * 100).toFixed(1) : null,
      // 到店率 = 已到店 / 加粉数（2026-07-15 修正：原先误写成 已到店/排客数）
      arriveRate: fans > 0 ? (arrived / fans * 100).toFixed(1) : null,
      depArrRate: dep > 0 ? (arrived / dep * 100).toFixed(1) : null,
    };
  }

  function statCells(r) {
    return `
      <td style="text-align:right">${r.fans}</td>
      <td style="text-align:right;color:var(--klein);font-weight:500">${r.dep}</td>
      <td style="text-align:right">${r.invited}</td>
      <td style="text-align:right;color:var(--success)">${r.arrived}</td>
      <td style="text-align:right">${r.depRate ? r.depRate + '%' : '-'}</td>
      <td style="text-align:right">${r.arriveRate ? r.arriveRate + '%' : '-'}</td>
      <td style="text-align:right">${r.depArrRate ? r.depArrRate + '%' : '-'}</td>
      <td style="text-align:right;color:var(--danger)">${fmtMoney(r.amount)}</td>`;
  }

  function buildTeamTable(blocks) {
    const div = document.createElement('div');
    div.className = 'card';
    let bodyHtml = '';
    blocks.forEach((b, i) => {
      const tid = 'csgrp_' + b.team.id;
      const hasMembers = b.memberRows.length > 0;
      bodyHtml += `<tr class="cs-team-row" data-grp="${tid}" style="cursor:${hasMembers ? 'pointer' : 'default'};background:var(--klein-soft)">
        <td>${i + 1}</td>
        <td><b>${hasMembers ? `<span class="cs-arw" style="display:inline-block;width:14px;transition:transform .15s">▸</span> ` : ''}${b.teamRow.name}</b>${hasMembers ? `<span class="muted" style="font-size:11px;margin-left:6px">${b.memberRows.length}人</span>` : ''}</td>
        ${statCells(b.teamRow)}
      </tr>`;
      b.memberRows.forEach(m => {
        bodyHtml += `<tr class="cs-mem-row ${tid}" style="display:none;background:#fff">
          <td></td>
          <td style="padding-left:28px;color:var(--ink-soft)">${m.name}</td>
          ${statCells(m)}
        </tr>`;
      });
      if (!hasMembers) {
        bodyHtml += `<tr class="cs-mem-row ${tid}" style="display:none"><td></td><td colspan="9" class="muted" style="padding-left:28px">该团队暂无已注册客服账号</td></tr>`;
      }
    });
    div.innerHTML = `
      <h3>客服团队明细</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>排名</th><th>团队 / 客服</th><th style="text-align:right">加粉数</th><th style="text-align:right">定金数</th><th style="text-align:right">排客数</th><th style="text-align:right">已到店</th><th style="text-align:right">定金率</th><th style="text-align:right">到店率</th><th style="text-align:right">定金到店率</th><th style="text-align:right">定金金额</th></tr></thead>
        <tbody>${bodyHtml || '<tr><td colspan="10" class="muted" style="text-align:center;padding:24px">暂无数据</td></tr>'}</tbody>
      </table></div>
      <p class="muted" style="margin-top:8px;font-size:11px">点击蓝色团队行可展开该团队下的客服个人明细。到店率 = 已到店 / 加粉数；定金到店率 = 已到店 / 定金数（允许 >100%）。</p>
    `;
    // 展开/收起
    div.querySelectorAll('.cs-team-row').forEach(tr => {
      tr.onclick = () => {
        const grp = tr.dataset.grp;
        const arw = tr.querySelector('.cs-arw');
        const mems = div.querySelectorAll('.' + grp);
        const open = mems.length && mems[0].style.display !== 'none';
        mems.forEach(m => m.style.display = open ? 'none' : '');
        if (arw) arw.style.transform = open ? '' : 'rotate(90deg)';
      };
    });
    return div;
  }
};
window.setHQCsPreset = (p) => { window.__hqCsFilter = { ...window.__hqCsFilter, preset: p, from: '', to: '' }; render_hq_cs_perf(document.getElementById('page')); };
window.setHQCsTab = (t) => { window.__hqCsFilter = { ...window.__hqCsFilter, tab: t }; render_hq_cs_perf(document.getElementById('page')); };
window.applyHQCsCustom = () => {
  const from = document.getElementById('cp_start').value;
  const to = document.getElementById('cp_end').value;
  if (!from || !to) return alert('请选起止日期');
  window.__hqCsFilter = { ...window.__hqCsFilter, preset: 'custom', from, to };
  render_hq_cs_perf(document.getElementById('page'));
};

// ============== 市场部业绩查询（原"员工查询"）==============
window.render_hq_staff = async function (page) {
  page.innerHTML = '<div class="loading">加载中...</div>';
  await loadAllData();
  const r = await api.get('/api/v6/users');
  const allUsers = (r.users || []).filter(u => u.role === 'store');
  const F = window.__hqStaffFilter = window.__hqStaffFilter || { preset: 'month', from: '', to: '' };
  const { start, end, label } = computePreset(F.preset, F.from, F.to);

  const stores = (DB.store || []).filter(x => x.date >= start && x.date <= end);
  const teams = teamsByRoleAll('store');

  page.innerHTML = `
    <div class="card">
      <h2>◇ 市场部明细 <span style="font-size:13px;color:var(--ink-mute);font-weight:400">（${label}：${start} ~ ${end}）</span></h2>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px">
        ${presetButtons(F.preset, 'setHQStaffPreset')}
        <input type="date" class="input" id="st_start" value="${start}" style="width:auto;height:32px;font-size:12px"/>
        <span style="color:var(--ink-mute)">至</span>
        <input type="date" class="input" id="st_end" value="${end}" style="width:auto;height:32px;font-size:12px"/>
        <button class="btn btn-primary" style="height:32px;padding:0 12px;font-size:12px" onclick="applyHQStaffCustom()">应用</button>
      </div>
    </div>
    ${teams.map(t => {
      const teamStores = stores.filter(x => x.teamId === t.id);
      const teamUsers = allUsers.filter(u => u.teamId === t.id);
      const teamRev = teamStores.reduce((s, x) => s + (+x.opAmount || 0) + (+x.closedAmount || 0), 0);
      return `
        <div class="card">
          <h3>${t.name}${t.deleted ? ' <span class="tag tag-danger" style="margin-left:6px">已停用</span>' : ''} <span class="muted" style="font-size:13px;font-weight:400;margin-left:8px">总营业额 ${fmtMoney(teamRev)} · ${teamStores.length} 单</span></h3>
          ${teamUsers.length === 0 ? '<p class="muted">该门店暂无员工</p>' : `
            <div class="table-wrap"><table>
              <thead><tr><th>姓名</th><th>职位</th><th style="text-align:right">接待</th><th style="text-align:right">新客</th><th style="text-align:right">老客</th><th style="text-align:right">操作数</th><th style="text-align:right">营业额</th><th style="text-align:right">客单价</th></tr></thead>
              <tbody>${teamUsers.map(u => {
                const myList = teamStores.filter(s => (s.performer || '').trim() === u.realName);
                const newC = myList.filter(x => x.customerType === '新客').length;
                const oldC = myList.filter(x => x.customerType === '老客').length;
                const opC = myList.filter(x => x.isOperated === '是').length;
                const rev = myList.reduce((s, x) => s + (+x.opAmount || 0) + (+x.closedAmount || 0), 0);
                const arpu = newC > 0 ? rev / newC : 0;
                return `<tr>
                  <td><b>${u.realName}</b></td>
                  <td>${u.position === 'manager' ? '店长' : u.position === 'staff' ? '员工' : '-'}</td>
                  <td style="text-align:right">${myList.length}</td>
                  <td style="text-align:right">${newC}</td>
                  <td style="text-align:right">${oldC}</td>
                  <td style="text-align:right">${opC}</td>
                  <td style="text-align:right;color:var(--danger);font-weight:500">${fmtMoney(rev)}</td>
                  <td style="text-align:right">${newC > 0 ? fmtMoney(arpu) : '-'}</td>
                </tr>`;
              }).join('')}</tbody>
            </table></div>
          `}
        </div>
      `;
    }).join('')}
  `;
};
window.setHQStaffPreset = (p) => { window.__hqStaffFilter = { preset: p, from: '', to: '' }; render_hq_staff(document.getElementById('page')); };
window.applyHQStaffCustom = () => {
  const from = document.getElementById('st_start').value;
  const to = document.getElementById('st_end').value;
  if (!from || !to) return alert('请选起止日期');
  window.__hqStaffFilter = { preset: 'custom', from, to };
  render_hq_staff(document.getElementById('page'));
};

// ============== 全部排客（加预设）==============
window.render_hq_invite = async function (page) {
  page.innerHTML = '<div class="loading">加载中...</div>';
  await loadAllData();
  const all = [...(DB.invite || [])].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const F = window.__hqInviteFilter = window.__hqInviteFilter || { preset: '', from: '', to: '', status: '', cs: '', store: '', kw: '' };

  // preset → from/to
  let { from, to } = F;
  if (F.preset) {
    const p = computePreset(F.preset, F.from, F.to);
    from = p.start; to = p.end;
  }

  const csTeams = teamsByRoleAll('cs');
  const storeTeams = teamsByRoleAll('store');

  const list = all.filter(x => {
    const d = (x.arriveTime || '').slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (F.status && x.status !== F.status) return false;
    if (F.cs && x.csTeamId !== F.cs) return false;
    if (F.store && x.storeTeamId !== F.store) return false;
    if (F.kw) {
      const k = F.kw.toLowerCase();
      if (!(x.customerName || '').toLowerCase().includes(k) && !(x.phone || '').includes(k) && !(x.wechatNickname || '').toLowerCase().includes(k)) return false;
    }
    return true;
  });

  const sum = {
    total: list.length,
    arrived: list.filter(x => x.status === 'arrived').length,
    noShow: list.filter(x => x.status === 'no_show').length,
    cancelled: list.filter(x => x.status === 'cancelled').length,
    pending: list.filter(x => x.status === 'pending' || !x.status).length,
  };
  const tag = s => s === 'arrived' ? '<span class="tag tag-success">已到店</span>'
    : s === 'no_show' ? '<span class="tag tag-danger">未到店</span>'
    : s === 'cancelled' ? '<span class="tag tag-danger">已取消</span>'
    : '<span class="tag tag-warning">待反馈</span>';

  page.innerHTML = `
    <div class="card">
      <h2>📞 全部排客（共 ${all.length} 条 · 当前筛选 ${sum.total}）</h2>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px">
        ${presetButtons(F.preset, 'setHQInvitePreset')}
        <input type="date" class="input" id="hi_from" value="${from || ''}" style="width:auto;height:32px;font-size:12px"/>
        <span style="color:var(--ink-mute)">~</span>
        <input type="date" class="input" id="hi_to" value="${to || ''}" style="width:auto;height:32px;font-size:12px"/>
        <select class="select" id="hi_status" style="width:auto;height:32px;font-size:12px">
          <option value="">全部状态</option>
          <option value="pending"   ${F.status === 'pending'   ? 'selected' : ''}>待反馈</option>
          <option value="arrived"   ${F.status === 'arrived'   ? 'selected' : ''}>已到店</option>
          <option value="no_show"   ${F.status === 'no_show'   ? 'selected' : ''}>未到店</option>
          <option value="cancelled" ${F.status === 'cancelled' ? 'selected' : ''}>已取消</option>
        </select>
        <select class="select" id="hi_cs" style="width:auto;height:32px;font-size:12px">
          <option value="">全部客服</option>
          ${csTeams.map(t => `<option value="${t.id}" ${F.cs === t.id ? 'selected' : ''}>${t.name}${t.deleted ? '(停用)' : ''}</option>`).join('')}
        </select>
        <select class="select" id="hi_store" style="width:auto;height:32px;font-size:12px">
          <option value="">全部门店</option>
          ${storeTeams.map(t => `<option value="${t.id}" ${F.store === t.id ? 'selected' : ''}>${t.name}${t.deleted ? '(停用)' : ''}</option>`).join('')}
        </select>
        <input class="input" id="hi_kw" value="${F.kw}" placeholder="客户/电话/微信昵称" style="width:160px;height:32px;font-size:12px"/>
        <button class="btn btn-primary" onclick="applyHQInviteFilter()">筛选</button>
        <button class="btn" onclick="resetHQInviteFilter()">重置</button>
      </div>
      <div style="margin-top:12px;padding:10px;background:var(--klein-soft);border-radius:6px;font-size:13px;color:var(--klein)">
        汇总：共 <b>${sum.total}</b> · 已到店 <b style="color:var(--success)">${sum.arrived}</b> · 未到店 <b style="color:var(--danger)">${sum.noShow}</b> · 已取消 <b style="color:var(--danger)">${sum.cancelled}</b> · 待反馈 <b style="color:var(--warning)">${sum.pending}</b>
      </div>
      ${list.length === 0 ? '<p class="muted" style="margin-top:16px">无匹配数据</p>' :
      `<div class="table-wrap" style="margin-top:12px"><table>
        <thead><tr><th>客户</th><th>微信昵称</th><th>电话</th><th>到店时间</th><th>客服</th><th>门店</th><th>状态</th><th>备注</th></tr></thead>
        <tbody>${list.slice(0, 500).map(x => `<tr>
          <td>${esc(x.customerName || '-')}</td><td>${x.wechatNickname ? esc(x.wechatNickname) : '<span style="color:var(--ink-mute)">-</span>'}</td><td>${esc(x.phone || '-')}</td><td>${(x.arriveTime || '').replace('T', ' ')}</td>
          <td>${esc(x.csTeamName || '-')}</td><td>${esc((DB.teams[x.storeTeamId] && DB.teams[x.storeTeamId].name) || '-')}</td>
          <td>${tag(x.status)}</td>
          <td style="font-size:11px;color:var(--ink-mute);max-width:280px">${x.cancelReason ? '取消：' + x.cancelReason : (x.noShowFeedback ? '未到店反馈' : (x.remark || '-'))}</td>
        </tr>`).join('')}</tbody>
      </table></div>${list.length > 500 ? `<p class="muted" style="margin-top:8px">仅显示前 500 条，请用筛选缩小范围</p>` : ''}`}
    </div>
  `;
};
window.setHQInvitePreset = (p) => { window.__hqInviteFilter = { ...window.__hqInviteFilter, preset: p, from: '', to: '' }; render_hq_invite(document.getElementById('page')); };
window.applyHQInviteFilter = () => {
  window.__hqInviteFilter = {
    ...window.__hqInviteFilter,
    preset: '',
    from: document.getElementById('hi_from').value,
    to: document.getElementById('hi_to').value,
    status: document.getElementById('hi_status').value,
    cs: document.getElementById('hi_cs').value,
    store: document.getElementById('hi_store').value,
    kw: document.getElementById('hi_kw').value.trim(),
  };
  render_hq_invite(document.getElementById('page'));
};
window.resetHQInviteFilter = () => {
  window.__hqInviteFilter = { preset: '', from: '', to: '', status: '', cs: '', store: '', kw: '' };
  render_hq_invite(document.getElementById('page'));
};

// ============== 用户管理（保留原有）==============
window.render_hq_users = async function (page) {
  page.innerHTML = '<div class="loading">加载用户列表...</div>';
  const r = await api.get('/api/v6/users');
  if (!r.ok) {
    page.innerHTML = `<div class="card"><h3>加载失败</h3><p class="muted">${r.error}</p></div>`;
    return;
  }
  await loadAllData();
  const users = r.users || [];
  const pendingUsers = users.filter(u => u.status === 'pending');
  const teams = (DB && DB.teams) || {};

  page.innerHTML = `
    ${pendingUsers.length > 0 ? `
      <div class="card" style="border-left:4px solid var(--warning);background:rgba(217,119,6,.04)">
        <h3 style="color:var(--warning);margin:0 0 8px">⏳ 待审批 ${pendingUsers.length} 人</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>姓名</th><th>用户名</th><th>角色</th><th>团队</th><th>申请说明</th><th>申请时间</th><th>操作</th></tr></thead>
          <tbody>${pendingUsers.map(u => `<tr>
            <td><b>${u.realName || '-'}</b></td>
            <td><code>${u.username}</code></td>
            <td>${({ad:'投放',cs:'客服',store:'门店',hq:'总部'})[u.role] || u.role}</td>
            <td>${(teams[u.teamId] && teams[u.teamId].name) || u.teamId}</td>
            <td class="muted" style="max-width:200px">${u.applyReason || '-'}</td>
            <td class="muted">${u.createdAt ? new Date(u.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}</td>
            <td>
              <button class="btn btn-primary" style="height:28px;padding:0 10px;font-size:12px" onclick="hqApproveUser('${u.id}')">通过</button>
              <button class="btn" style="height:28px;padding:0 10px;font-size:12px;color:var(--danger);border-color:rgba(192,57,43,.3)" onclick="hqRejectUser('${u.id}')">拒绝</button>
            </td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>
    ` : ''}

    <div class="card">
      <h2>◈ 用户管理（${users.length}）</h2>
      <p class="muted">所有可登录系统的人员账号</p>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn btn-primary" onclick="openCreateUserDialog()">+ 添加用户</button>
        <input class="input" id="userSearch" placeholder="搜索姓名/用户名" style="flex:1;max-width:300px">
      </div>
    </div>
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>姓名</th><th>用户名</th><th>角色</th><th>所属</th><th>职位</th><th>状态</th><th>最近登录</th><th>操作</th></tr></thead>
        <tbody id="userTbody">
          ${users.map(u => userRow(u, teams)).join('')}
        </tbody>
      </table></div>
    </div>
  `;
  function userRow(u, teams) {
    const teamName = (teams[u.teamId] && teams[u.teamId].name) || u.teamId || '-';
    const roleLabel = { hq: '总部', ad: '投放', cs: '客服', store: '门店' }[u.role] || u.role;
    const last = u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '从未';
    const statusTag = u.status === 'active' ? 'tag-success' : u.status === 'pending' ? 'tag-warning' : 'tag-danger';
    const statusText = u.status === 'pending' ? '待审批' : u.status;
    return `
      <tr data-search="${(u.realName || '') + ' ' + (u.username || '')}">
        <td><b>${u.realName || '-'}</b></td>
        <td><code>${u.username}</code></td>
        <td>${roleLabel}</td>
        <td>${teamName}</td>
        <td>${u.position === 'manager' ? '店长' : u.position === 'staff' ? '店员' : '-'}</td>
        <td><span class="tag ${statusTag}">${statusText}</span></td>
        <td class="muted">${last}</td>
        <td style="white-space:nowrap">
          <button class="btn" style="height:28px;padding:0 10px;font-size:12px" onclick="resetUserPwd('${u.id}','${u.username}')">改密</button>
          ${u.role === 'hq' ? '' : (u.status === 'active'
            ? `<button class="btn" style="height:28px;padding:0 10px;font-size:12px;color:var(--danger);border-color:rgba(192,57,43,.3)" onclick="hqToggleUserStatus('${u.id}','${esc(u.realName || u.username)}','disable')">停用</button>`
            : u.status === 'disabled'
              ? `<button class="btn btn-primary" style="height:28px;padding:0 10px;font-size:12px" onclick="hqToggleUserStatus('${u.id}','${esc(u.realName || u.username)}','enable')">启用</button>`
              : '')}
        </td>
      </tr>
    `;
  }
  document.getElementById('userSearch').addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('#userTbody tr').forEach(tr => {
      tr.style.display = !q || tr.dataset.search.toLowerCase().includes(q) ? '' : 'none';
    });
  });
};

window.hqApproveUser = async function (id) {
  if (!confirm('通过该用户的注册申请？通过后即可登录。')) return;
  const r = await fetch('/api/v6/users/' + id + '/approve', { method: 'POST' }).then(r => r.json());
  if (r.ok) { showToast('已通过', 'success'); render_hq_users(document.getElementById('page')); }
  else showToast('失败：' + (r.error || ''), 'error');
};
window.hqRejectUser = async function (id) {
  if (!confirm('拒绝该用户的注册申请？拒绝后该账号将被删除。')) return;
  const r = await fetch('/api/v6/users/' + id + '/reject', { method: 'POST' }).then(r => r.json());
  if (r.ok) { showToast('已拒绝', 'success'); render_hq_users(document.getElementById('page')); }
  else showToast('失败：' + (r.error || ''), 'error');
};
window.resetUserPwd = async function (id, username) {
  const np = prompt(`重置 ${username} 的密码（至少 6 位）：`);
  if (!np || np.length < 6) return;
  const r = await fetch(`/api/v6/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: np }),
  });
  const j = await r.json();
  alert(j.ok ? '已重置 ✓' : '失败：' + (j.error || ''));
};
// 一键停用/启用账号（离职人员管理）
window.hqToggleUserStatus = async function (id, name, action) {
  const disable = action === 'disable';
  const tip = disable
    ? `确认停用「${name}」的账号？\n\n停用后该账号将无法登录系统（适用于离职/调岗）。其历史数据和业绩归属保留不变，需要时可随时「启用」恢复。`
    : `确认重新启用「${name}」的账号？\n\n启用后该账号可正常登录。`;
  if (!confirm(tip)) return;
  const r = await fetch(`/api/v6/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: disable ? 'disabled' : 'active' }),
  });
  const j = await r.json();
  if (j.ok) { showToast(disable ? '已停用' : '已启用', 'success'); render_hq_users(document.getElementById('page')); }
  else showToast('失败：' + (j.error || ''), 'error');
};
window.openCreateUserDialog = async function () {
  await loadAllData();
  const esc = (x) => (x == null ? '' : String(x)).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ROLE_LABEL = { hq: '总部', ad: '投放', cs: '客服', store: '门店' };
  const buildTeamOpts = (role) => {
    if (role === 'hq') return '<option value="">（总部无需团队）</option>';
    const list = (typeof teamsByRoleAll === 'function' ? teamsByRoleAll(role) : [])
      .filter(t => !t.deleted);
    if (!list.length) return `<option value="">（暂无${ROLE_LABEL[role]}团队，请先在部门管理创建）</option>`;
    return list.map(t => `<option value="${esc(t.id)}">${esc(t.name)}（${esc(t.id)}）</option>`).join('');
  };
  const old = document.getElementById('createUserOverlay');
  if (old) old.remove();
  const overlay = document.createElement('div');
  overlay.id = 'createUserOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(20,28,56,.4);z-index:1200;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:14px;width:100%;max-width:460px;padding:22px 24px;box-shadow:0 12px 40px rgba(0,0,0,.18)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div style="font-size:17px;font-weight:600">➕ 新增用户</div>
        <span id="cuClose" style="cursor:pointer;font-size:20px;color:#8a9099;line-height:1">×</span>
      </div>
      <div style="display:grid;gap:13px">
        <div><label class="lbl">用户名（英文登录名）</label><input class="input" id="cu_username" placeholder="如 zhangsan" autocomplete="off"/></div>
        <div><label class="lbl">真实姓名</label><input class="input" id="cu_realname" placeholder="如 张三"/></div>
        <div><label class="lbl">角色</label>
          <select class="select" id="cu_role">
            <option value="cs">客服</option>
            <option value="store">门店</option>
            <option value="ad">投放</option>
            <option value="hq">总部</option>
          </select>
        </div>
        <div id="cu_team_wrap"><label class="lbl">所属团队</label>
          <select class="select" id="cu_team">${buildTeamOpts('cs')}</select>
        </div>
        <div><label class="lbl">初始密码（≥6 位）</label><input class="input" id="cu_password" type="text" placeholder="如 sj8888"/></div>
      </div>
      <div id="cuMsg" style="margin-top:10px;font-size:13px;color:#e23b3b;min-height:16px"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:6px">
        <button class="btn" id="cuCancel">取消</button>
        <button class="btn btn-primary" id="cuSubmit">创建</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const $ = (id) => overlay.querySelector('#' + id);
  const close = () => overlay.remove();
  $('cuClose').onclick = close; $('cuCancel').onclick = close;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  // 角色切换 → 团队下拉联动
  const roleSel = $('cu_role'), teamWrap = $('cu_team_wrap'), teamSel = $('cu_team');
  roleSel.onchange = () => {
    const rl = roleSel.value;
    teamSel.innerHTML = buildTeamOpts(rl);
    teamWrap.style.display = rl === 'hq' ? 'none' : '';
  };
  $('cuSubmit').onclick = async () => {
    const msg = $('cuMsg'); msg.textContent = '';
    const username = $('cu_username').value.trim();
    const realName = $('cu_realname').value.trim();
    const role = roleSel.value;
    const teamId = role === 'hq' ? '' : teamSel.value;
    const password = $('cu_password').value;
    if (!username) return msg.textContent = '请填写用户名';
    if (!realName) return msg.textContent = '请填写真实姓名';
    if (role !== 'hq' && !teamId) return msg.textContent = '请选择所属团队（如无可选，请先到部门管理创建团队）';
    if (!password || password.length < 6) return msg.textContent = '密码至少 6 位';
    $('cuSubmit').disabled = true; $('cuSubmit').textContent = '创建中…';
    try {
      const r = await fetch('/api/v6/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, realName, role, teamId, password, position: '' }),
      });
      const j = await r.json();
      if (j.ok) { showToast('创建成功 ✓', 'success'); close(); render_hq_users(document.getElementById('page')); }
      else { msg.textContent = '失败：' + (j.error || ''); $('cuSubmit').disabled = false; $('cuSubmit').textContent = '创建'; }
    } catch (e) {
      msg.textContent = '网络错误：' + e.message; $('cuSubmit').disabled = false; $('cuSubmit').textContent = '创建';
    }
  };
};

// ============== 系统设置（含部门管理）==============
window.render_hq_settings = async function (page) {
  page.innerHTML = '<div class="loading">加载中...</div>';
  await loadAllData();
  
  // ★ 新增：调用后端接口获取真实环境信息
  const envInfo = await fetch('/api/v6/env').then(r => r.json()).catch(() => ({ok:false}));
  const pushEnabled = envInfo.ok && envInfo.pushEnabled;
  const devMode = envInfo.ok && envInfo.devMode;
  const dbPath = envInfo.db || '/opt/shijing-v6/db/shijing.db';
  const host = envInfo.host || '未知';
  
  const cfg = DB.wecomConfig || {};
  const teams = DB.teams || {};
  const stores = teamsByRoleAll('store');
  const csTeams = teamsByRoleAll('cs');
  const adTeams = teamsByRoleAll('ad');

  page.innerHTML = `
    <div class="card">
      <h3>🏢 部门 / 团队管理</h3>
      <p class="muted">新增团队后，对应"用户管理"创建账号时可选用此 teamId</p>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr 100px;gap:8px;margin-top:8px;align-items:end">
        <div><label class="lbl">team ID（英文，唯一）</label><input class="input" id="nt_id" placeholder="如 store_5"/></div>
        <div><label class="lbl">名称</label><input class="input" id="nt_name" placeholder="如 上海徐汇店"/></div>
        <div><label class="lbl">角色</label>
          <select class="select" id="nt_role">
            <option value="store">门店</option>
            <option value="cs">客服</option>
            <option value="ad">投放</option>
          </select>
        </div>
        <div><label class="lbl">城市（门店必填）</label><input class="input" id="nt_city" placeholder="如 上海"/></div>
        <div><button class="btn btn-primary" onclick="hqAddTeam()">添加</button></div>
      </div>
      <div style="margin-top:16px">
        <div class="table-wrap"><table>
          <thead><tr><th>ID</th><th>名称</th><th>角色</th><th>城市</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            ${Object.entries(teams).map(([id, t]) => `<tr ${t.deleted ? 'style="opacity:.5"' : ''}>
              <td><code>${id}</code></td>
              <td>${t.name || '-'}</td>
              <td>${({ad:'投放',cs:'客服',store:'门店',hq:'总部'})[t.role] || t.role}</td>
              <td>${t.city || '-'}</td>
              <td>${t.deleted ? '<span class="tag tag-danger">已停用</span>' : '<span class="tag tag-success">活跃</span>'}</td>
              <td>
                ${t.deleted
                  ? `<button class="btn" style="height:26px;padding:0 8px;font-size:12px" onclick="hqRestoreTeam('${id}')">恢复</button>`
                  : `<button class="btn" style="height:26px;padding:0 8px;font-size:12px" onclick="hqDeleteTeam('${id}')">停用</button>`}
              </td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>
    </div>

    <div class="card">
      <h3>🔔 企业微信群机器人配置</h3>

      <div style="margin:12px 0 8px;padding:8px 12px;background:var(--klein-soft);border-radius:4px;font-size:13px;color:var(--klein);font-weight:600">🏪 门店企微群</div>
      ${stores.map(s => `
        <div style="margin-bottom:10px">
          <label class="lbl">${s.name}${s.deleted ? ' (已停用)' : ''}</label>
          <input class="input" id="wh_${s.id}" value="${(cfg.storeWebhooks && cfg.storeWebhooks[s.id]) || ''}" placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxxx"/>
        </div>`).join('')}

      <div style="margin:18px 0 8px;padding:8px 12px;background:var(--klein-soft);border-radius:4px;font-size:13px;color:var(--klein);font-weight:600">💼 客服销售线企微群</div>
      ${csTeams.map(c => `
        <div style="margin-bottom:10px">
          <label class="lbl">${c.name}${c.deleted ? ' (已停用)' : ''}</label>
          <input class="input" id="csh_${c.id}" value="${(cfg.csWebhooks && cfg.csWebhooks[c.id]) || ''}" placeholder="留空则用总部群兜底"/>
        </div>`).join('')}

      <div style="margin-bottom:10px">
        <label class="lbl">客户档案企业微信文档地址（选填）</label>
        <input class="input" id="doc_url" value="${cfg.docArchiveUrl || ''}"/>
      </div>

      <div style="margin-bottom:10px">
        <label class="lbl">总部数据简报群 Webhook</label>
        <input class="input" id="hq_webhook" value="${cfg.hqWebhook || ''}" placeholder="留空则用市场线1店"/>
      </div>

      <div style="margin-bottom:10px;max-width:200px">
        <label class="lbl">未反馈提醒时间（小时 0~23）</label>
        <input type="number" class="input" id="rem_hour" value="${cfg.reminderHour != null ? cfg.reminderHour : 19}" min="0" max="23"/>
      </div>

      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="btn btn-primary" onclick="saveV6WecomConfig()">💾 保存配置</button>
      </div>
    </div>

    <div class="card">
      <h3>🛠 系统环境信息</h3>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;font-size:13px">
        <div class="muted">环境</div><div><span class="tag ${devMode ? 'tag-warning' : 'tag-success'}">${devMode ? 'DEV' : 'PROD'}</span> · ${host}</div>
        <div class="muted">推送状态</div><div><span class="tag ${pushEnabled ? 'tag-success' : 'tag-warning'}">${pushEnabled ? '已启用' : '已暂停'} (V6_DEV_MODE=${devMode})</span></div>
        <div class="muted">数据库</div><div><code>${dbPath}</code></div>
      </div>
    </div>

    <style>.lbl{display:block;font-size:12px;color:var(--ink-soft);margin-bottom:4px}</style>
  `;
};

window.hqAddTeam = async function () {
  const id = document.getElementById('nt_id').value.trim();
  const name = document.getElementById('nt_name').value.trim();
  const role = document.getElementById('nt_role').value;
  const city = document.getElementById('nt_city').value.trim();
  if (!id || !name) return alert('请填 ID 和名称');
  if (!/^[a-z0-9_]+$/.test(id)) return alert('ID 只能用小写字母/数字/下划线');
  await loadAllData();
  const teams = DB.teams || {};
  if (teams[id]) return alert('ID 已存在');
  teams[id] = { name, role, city: city || undefined };
  const r = await fetch('/api/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teams }),
  }).then(r => r.json());
  if (r.ok) { showToast('已添加', 'success'); render_hq_settings(document.getElementById('page')); }
  else showToast('失败：' + (r.error || ''), 'error');
};
window.hqDeleteTeam = async function (id) {
  if (!confirm('停用该团队？停用后账号无法登录、不出现在排客下拉，但历史数据保留。')) return;
  await loadAllData();
  const teams = DB.teams;
  if (!teams[id]) return;
  teams[id].deleted = true;
  teams[id].deletedAt = Date.now();
  const r = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ teams }) }).then(r => r.json());
  if (r.ok) { showToast('已停用', 'success'); render_hq_settings(document.getElementById('page')); }
};
window.hqRestoreTeam = async function (id) {
  await loadAllData();
  const teams = DB.teams;
  delete teams[id].deleted;
  delete teams[id].deletedAt;
  const r = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ teams }) }).then(r => r.json());
  if (r.ok) { showToast('已恢复', 'success'); render_hq_settings(document.getElementById('page')); }
};

window.saveV6WecomConfig = async function () {
  const stores = teamsByRoleAll('store');
  const csTeams = teamsByRoleAll('cs');
  const storeWebhooks = {};
  stores.forEach(s => {
    const v = document.getElementById('wh_' + s.id).value.trim();
    if (v) storeWebhooks[s.id] = v;
  });
  const csWebhooks = {};
  csTeams.forEach(c => {
    const v = document.getElementById('csh_' + c.id).value.trim();
    if (v) csWebhooks[c.id] = v;
  });
  const wecomConfig = {
    storeWebhooks, csWebhooks,
    docArchiveUrl: document.getElementById('doc_url').value.trim(),
    hqWebhook: document.getElementById('hq_webhook').value.trim(),
    reminderHour: +document.getElementById('rem_hour').value || 19,
  };
  const r = await fetch('/api/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wecomConfig }),
  }).then(r => r.json());
  if (r.ok) showToast('配置已保存', 'success');
  else showToast('失败：' + (r.error || ''), 'error');
};
