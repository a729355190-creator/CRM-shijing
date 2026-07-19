// ===== v6 通用工具 =====

// XSS 防护：HTML 字符转义（全局可用）
window.esc = function (s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
};
// 用于 HTML 属性内（含双引号场景）
window.escAttr = window.esc;

window.api = {
  async get(url) {
    const r = await fetch(url);
    return await r.json();
  },
  async post(url, body) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    return await r.json();
  },
};

// ----- 格式化 -----
window.fmtMoney = (n) => {
  const v = Number(n) || 0;
  const abs = Math.abs(v).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  return (v < 0 ? '-¥' : '¥') + abs;
};
window.fmtNum   = (n) => (Number(n) || 0).toLocaleString('zh-CN');
window.fmtPct   = (n) => (Number(n) || 0).toFixed(1) + '%';
window.fmtDate  = (d) => {
  d = d ? new Date(d) : new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
window.todayStr = () => fmtDate(new Date());
window.today    = () => fmtDate(new Date());           // v5 兼容
window.safeDiv  = (a, b) => (b === 0 || !b) ? 0 : a / b;

window.ROLE_LABEL = { ad: '营销线', cs: '客服销售线', store: '市场线', hq: '总部服务线' };

// ----- 数据加载 -----
window.loadAllData = async function () {
  // 并发拉业务数据 + 配置（teams / wecomConfig 在独立 endpoint）
  const [r1, r2] = await Promise.all([
    api.post('/api/list', {}),
    api.get('/api/config'),
  ]);
  if (!r1.ok) throw new Error('load /api/list failed');
  const data = r1.data || {};
  if (r2 && r2.ok && r2.config) {
    data.teams = r2.config.teams || {};
    data.wecomConfig = r2.config.wecomConfig || {};
  } else {
    data.teams = data.teams || {};
    data.wecomConfig = data.wecomConfig || {};
  }
  window.DB = data;
  return data;
};

// 团队映射（active = 仅未删除；all = 包含已 deleted，给历史归属用）
window.teamsByRole = function (role) {
  return Object.entries(DB.teams || {})
    .filter(([k, v]) => v.role === role && !v.deleted)
    .map(([k, v]) => ({ id: k, ...v }));
};
window.teamsByRoleAll = function (role) {
  return Object.entries(DB.teams || {})
    .filter(([k, v]) => v.role === role)
    .map(([k, v]) => ({ id: k, ...v }));
};

// ----- 聚合 + 指标计算（移植自 v5） -----
window.aggregateByDate = function (startDate, endDate, teamFilter = {}) {
  const inRange = (d) => (!startDate || d >= startDate) && (!endDate || d <= endDate);
  // ⚠️ ad 表必须 filter !cityName 防止双维度翻倍
  const ad = (DB.ad || []).filter(x => !x.cityName && inRange(x.date) && (!teamFilter.ad || x.teamId === teamFilter.ad));
  const cs = (DB.cs || []).filter(x => inRange(x.date) && (!teamFilter.cs || x.teamId === teamFilter.cs));
  const store = (DB.store || []).filter(x => inRange(x.date) && (!teamFilter.store || x.teamId === teamFilter.store));
  const invite = (DB.invite || []).filter(x => inRange(fmtDate(x.arriveTime)));
  return { ad, cs, store, invite };
};

window.calcMetrics = function ({ ad, cs, store, invite }) {
  const adCost = ad.reduce((s, x) => s + (+x.cost || 0), 0);
  const addFans = ad.reduce((s, x) => s + (+x.addFans || 0), 0);
  const deepConvert = ad.reduce((s, x) => s + (+x.deepConvert || 0), 0);
  const costPerFan = safeDiv(adCost, addFans);
  const deepRate = safeDiv(deepConvert, addFans) * 100;
  const deepCost = safeDiv(adCost, deepConvert);

  const csAddFans = cs.reduce((s, x) => s + (+x.addFans || 0), 0);
  const depositCount = cs.reduce((s, x) => s + (+x.depositCount || 0), 0);
  const depositAmount = cs.reduce((s, x) => s + (+x.depositAmount || 0), 0);
  const depositRate = safeDiv(depositCount, csAddFans) * 100;
  const depositCost = safeDiv(adCost, depositCount);

  const newCustomers = store.filter(x => x.customerType === '新客');
  const oldCustomers = store.filter(x => x.customerType === '老客');
  const newArriveCount = newCustomers.length;
  const oldArriveCount = oldCustomers.length;
  const arriveCount = newArriveCount;
  const arriveCost = safeDiv(adCost, newArriveCount);

  const newCount = newCustomers.length;
  const newOpCount = newCustomers.filter(x => x.isOperated === '是').length;
  const oldOpCount = oldCustomers.filter(x => x.isOperated === '是').length;
  const opCount = newOpCount;
  const opRate = safeDiv(newOpCount, newCount) * 100;
  const opCost = safeDiv(adCost, newOpCount);

  const newCloseCount = newCustomers.filter(x => x.isClosed === '是').length;
  const oldCloseCount = oldCustomers.filter(x => x.isClosed === '是').length;
  const closeCount = newCloseCount;
  const closeRate = safeDiv(newCloseCount, newCount) * 100;
  const closeCost = safeDiv(adCost, newCloseCount);

  const newOpAmount = newCustomers.reduce((s, x) => s + (+x.opAmount || 0), 0);
  const newCloseAmount = newCustomers.reduce((s, x) => s + (+x.closedAmount || 0), 0);
  const newRevenue = newOpAmount + newCloseAmount;
  const oldOpAmount = oldCustomers.reduce((s, x) => s + (+x.opAmount || 0), 0);
  const oldCloseAmount = oldCustomers.reduce((s, x) => s + (+x.closedAmount || 0), 0);
  const oldRevenue = oldOpAmount + oldCloseAmount;
  const opAmount = newOpAmount + oldOpAmount;
  const closeAmount = newCloseAmount + oldCloseAmount;
  const revenue = newRevenue + oldRevenue;
  const roi = safeDiv(revenue, adCost);
  const arpu = safeDiv(revenue, newArriveCount);

  return {
    adCost, addFans, costPerFan,
    deepConvert, deepRate, deepCost,
    csAddFans, depositCount, depositRate, depositAmount, depositCost,
    arriveCount, arriveCost,
    newArriveCount, oldArriveCount,
    newCount, opCount, opRate, opCost,
    newOpCount, oldOpCount,
    closeCount, closeCost, closeRate, closeAmount,
    newCloseCount, oldCloseCount,
    opAmount, revenue, roi, arpu,
    newRevenue, oldRevenue, newOpAmount, newCloseAmount, oldOpAmount, oldCloseAmount,
  };
};

// ----- Chart.js 实例管理 -----
window.chartInstances = [];
window.destroyCharts = function () {
  (window.chartInstances || []).forEach(c => { try { c.destroy(); } catch (e) {} });
  window.chartInstances = [];
};

// ----- Toast -----
window.showToast = function (text, type = 'success', duration = 1800) {
  let root = document.getElementById('v6Toast');
  if (!root) {
    root = document.createElement('div');
    root.id = 'v6Toast';
    root.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:9999;pointer-events:none';
    document.body.appendChild(root);
  }
  const color = type === 'error' ? '#c0392b' : type === 'warn' ? '#d97706' : '#00875a';
  const icon = type === 'error' ? '✕' : type === 'warn' ? '!' : '✓';
  root.innerHTML = `<div style="background:#fff;border:1px solid ${color};border-left:4px solid ${color};padding:10px 18px;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.12);font-size:13px;color:#1a1d24"><span style="color:${color};margin-right:8px;font-weight:700">${icon}</span>${text}</div>`;
  setTimeout(() => { root.innerHTML = ''; }, duration);
};

// ----- DOM helpers -----
window.h = function (tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === 'style' && typeof attrs[k] === 'object') {
      for (const sk in attrs[k]) el.style[sk] = attrs[k][sk];
    } else if (k.startsWith('on') && typeof attrs[k] === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
    } else {
      el.setAttribute(k, attrs[k]);
    }
  }
  for (const k of kids) {
    if (k == null) continue;
    if (typeof k === 'string') el.appendChild(document.createTextNode(k));
    else el.appendChild(k);
  }
  return el;
};
window.html = (s) => s;

// ============================================================
// 统一时间范围选择器 v6DateRange
// 预设：昨日 / 近3天 / 近7天 / 本月 / 自定义(任意起止)
// 用法：
//   容器: <div id="myDR"></div>
//   初始化: window.v6DateRange.mount('myDR', { preset:'7d', onChange:(range)=>{...} })
//   range = { start:'YYYY-MM-DD', end:'YYYY-MM-DD', preset:'7d', label:'近7天' }
// ============================================================
window.v6DateRange = (function () {
  function compute(preset, cf, ct) {
    const today = todayStr();
    const dayAgo = (n) => fmtDate(new Date(Date.now() - n * 86400000));
    const monthStart = today.slice(0, 8) + '01';
    switch (preset) {
      case 'yesterday': { const y = dayAgo(1); return { start: y, end: y, preset, label: '昨日' }; }
      case '3d': return { start: dayAgo(2), end: today, preset, label: '近3天' };
      case '7d': return { start: dayAgo(6), end: today, preset, label: '近7天' };
      case 'month': return { start: monthStart, end: today, preset, label: '本月' };
      case 'custom': return { start: cf || today, end: ct || today, preset: 'custom', label: '自定义' };
      default: return { start: dayAgo(6), end: today, preset: '7d', label: '近7天' };
    }
  }

  const PRESETS = [
    { k: 'yesterday', t: '昨日' },
    { k: '3d', t: '近3天' },
    { k: '7d', t: '近7天' },
    { k: 'month', t: '本月' },
    { k: 'custom', t: '自定义' },
  ];

  function mount(elId, opts) {
    opts = opts || {};
    const el = (typeof elId === 'string') ? document.getElementById(elId) : elId;
    if (!el) return null;
    const state = compute(opts.preset || '7d', opts.start, opts.end);
    if (opts.start && opts.end && opts.preset === 'custom') { state.start = opts.start; state.end = opts.end; }

    function render() {
      const btns = PRESETS.map(p =>
        `<button type="button" class="v6dr-btn${state.preset === p.k ? ' active' : ''}" data-k="${p.k}">${p.t}</button>`
      ).join('');
      const custom = state.preset === 'custom'
        ? `<span class="v6dr-custom">
             <input type="date" class="v6dr-date" data-r="start" value="${state.start}" max="${todayStr()}">
             <span class="v6dr-sep">~</span>
             <input type="date" class="v6dr-date" data-r="end" value="${state.end}" max="${todayStr()}">
           </span>` : '';
      el.innerHTML = `<div class="v6dr">${btns}${custom}</div>`;
      el.querySelectorAll('.v6dr-btn').forEach(b => {
        b.onclick = () => {
          const k = b.dataset.k;
          const next = compute(k, state.start, state.end);
          state.preset = next.preset; state.label = next.label;
          if (k !== 'custom') { state.start = next.start; state.end = next.end; }
          render();
          fire();
        };
      });
      el.querySelectorAll('.v6dr-date').forEach(inp => {
        inp.onchange = () => {
          if (inp.dataset.r === 'start') state.start = inp.value;
          else state.end = inp.value;
          if (state.start && state.end && state.start > state.end) {
            // 自动纠正：起止颠倒则对调
            const t = state.start; state.start = state.end; state.end = t;
            render();
          }
          state.label = '自定义';
          fire();
        };
      });
    }
    function fire() { if (typeof opts.onChange === 'function') opts.onChange({ start: state.start, end: state.end, preset: state.preset, label: state.label }); }

    render();
    return { get: () => ({ start: state.start, end: state.end, preset: state.preset, label: state.label }) };
  }

  return { mount, compute };
})();
