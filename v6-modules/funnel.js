/* ============================================================
 * V6 模块：客服全链路看板
 * 处理函数：render_hq_funnel(page) + render_cs_funnel(page)
 * 接口：/api/customer/staff-funnel（后端按角色控制营业额可见性）
 * hq：看全员含营业额；cs：看本团队转化率，无营业额
 * ============================================================ */
window._renderFunnel = async function (page) {
  page.innerHTML = `
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
        <div>
          <h3 style="margin:0;">📈 客服全链路看板</h3>
          <div class="muted" style="margin-top:4px;font-size:13px;color:#8a9099;">加粉 → 定金 → 到店 → 删粉，及各环节转化率。数据来自企微客观加粉 + 系统定金/到店。</div>
        </div>
        <select id="fnDays" class="fn-input">
          <option value="7">近 7 天</option>
          <option value="30" selected>近 30 天</option>
          <option value="90">近 90 天</option>
        </select>
      </div>
    </div>
    <div id="fnBody" style="margin-top:14px;"><div class="loading">加载中…</div></div>
    <style>
      .fn-input{padding:8px 10px;border:1px solid #d9dde3;border-radius:8px;font-size:15px;}
      .fn-card{background:#fff;border:1px solid #eef0f3;border-radius:12px;padding:16px;margin-bottom:14px;}
      .fn-team{font-weight:600;font-size:15px;margin-bottom:10px;}
      .fn-steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:8px;margin-bottom:12px;}
      .fn-step{background:#f7f8fa;border-radius:8px;padding:10px;text-align:center;}
      .fn-step .l{font-size:12px;color:#8a9099;}
      .fn-step .v{font-size:20px;font-weight:600;margin-top:2px;}
      .fn-rates{display:flex;gap:8px;flex-wrap:wrap;}
      .fn-rate{flex:1;min-width:90px;background:#eef5ff;border-radius:8px;padding:8px 10px;text-align:center;}
      .fn-rate.bad{background:#fdecee;}
      .fn-rate .l{font-size:12px;color:#646a73;}
      .fn-rate .v{font-size:18px;font-weight:600;color:#3370ff;margin-top:2px;}
      .fn-rate.bad .v{color:#d83931;}
      .fn-rev{margin-top:10px;background:#e8f8f0;border-radius:8px;padding:8px 12px;font-size:14px;color:#135200;}
      .fn-members{margin-top:8px;font-size:12px;color:#8a9099;}
    </style>
  `;
  const $ = id => document.getElementById(id);
  $('fnDays').onchange = load;
  await load();

  async function load() {
    const el = $('fnBody');
    el.innerHTML = '<div class="card"><div class="loading">加载中…</div></div>';
    try {
      const d = await api.get('/api/customer/staff-funnel?days=' + $('fnDays').value);
      if (!d.ok) throw new Error(d.error || '加载失败');
      if (!d.teams.length) { el.innerHTML = '<div class="card"><div style="color:#8a9099;">暂无数据。</div></div>'; return; }
      // 删粉是否已接入企微回调（未接入则不显示假的 0%）
      const tracked = d.lostTracked === true;
      const tipBar = tracked ? '' :
        `<div class="card" style="background:#fff8e6;border:1px solid #ffe2a8;color:#9a6b00;font-size:13px;margin-bottom:12px;">
          ⚠️ 删粉率暂未接入：企微无法回溯历史删粉，需配置「事件回调」后从配置当天起实时统计。下方删粉数据暂为占位。
        </div>`;
      el.innerHTML = tipBar + d.teams.map(t => {
        const lostBad = tracked && t.lostRate >= 10;
        const depBad = t.depositRate < 10;
        const arrBad = t.arriveRate < 40; // 定金到店率 = 到店/定金
        const members = (t.members || []).filter(m => m.addFans > 0 || m.lost > 0)
          .map(m => `${esc(m.name)}(加${m.addFans}${tracked ? '/删' + m.lost : ''})`).join('、');
        const lostCell = tracked
          ? `<div class="fn-step"><div class="l">删粉</div><div class="v" style="color:#d83931">${t.lost}</div></div>`
          : `<div class="fn-step"><div class="l">删粉</div><div class="v" style="color:#c2c6cc">—</div></div>`;
        const lostRateCell = tracked
          ? `<div class="fn-rate ${lostBad ? 'bad' : ''}" title="删粉率 = 删粉 / 加粉"><div class="l">删粉率</div><div class="v">${t.lostRate}%</div></div>`
          : `<div class="fn-rate" title="待接入企微回调"><div class="l">删粉率</div><div class="v" style="color:#c2c6cc">待接入</div></div>`;
        return `<div class="fn-card">
          <div class="fn-team">${esc(t.teamName)}</div>
          <div class="fn-steps">
            <div class="fn-step"><div class="l">加粉</div><div class="v">${t.addFans}</div></div>
            <div class="fn-step"><div class="l">定金</div><div class="v">${t.deposit}</div></div>
            <div class="fn-step"><div class="l">到店</div><div class="v">${t.arrive}</div></div>
            ${lostCell}
          </div>
          <div class="fn-rates">
            ${lostRateCell}
            <div class="fn-rate ${depBad ? 'bad' : ''}" title="定金率 = 定金 / 加粉"><div class="l">定金率</div><div class="v">${t.depositRate}%</div></div>
            <div class="fn-rate ${arrBad ? 'bad' : ''}" title="定金到店率 = 到店 / 定金"><div class="l">定金到店率</div><div class="v">${t.arriveRate}%</div></div>
          </div>
          ${typeof t.revenue === 'number' ? `<div class="fn-rev">💰 带来营业额：<b>¥${t.revenue.toLocaleString('zh-CN')}</b>（仅总部可见）</div>` : ''}
          ${members ? `<div class="fn-members">成员：${members}</div>` : ''}
        </div>`;
      }).join('');
    } catch (e) { el.innerHTML = '<div class="card"><div style="color:#d83931;">加载失败：' + esc(e.message) + '</div></div>'; }
  }
};
window.render_hq_funnel = window._renderFunnel;
window.render_cs_funnel = window._renderFunnel;
