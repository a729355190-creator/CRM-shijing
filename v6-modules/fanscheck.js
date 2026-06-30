/* ============================================================
 * V6 模块：加粉核对（仅总部 hq）
 * 客服个人企微客观加粉 vs 团队自填，差异标红
 * 处理函数：render_hq_fanscheck(page)
 * 依赖后端：/api/wecom/{fans-check, sync, staff}
 * ============================================================ */
window.render_hq_fanscheck = async function (page) {
  page.innerHTML = `
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
        <div>
          <h3 style="margin:0;">📲 加粉核对</h3>
          <div class="muted" style="margin-top:4px;font-size:13px;color:#8a9099;">
            企业微信客观加粉数（每天 08:50 自动同步），与客服自填并排对比。仅统计走获客助手的客服。
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <select id="fcDays" class="fc-input">
            <option value="7">近 7 天</option>
            <option value="14">近 14 天</option>
            <option value="30">近 30 天</option>
          </select>
          <button class="btn btn-primary" id="fcSyncBtn">立即同步企微</button>
        </div>
      </div>
    </div>

    <div id="fcTeam" style="margin-top:14px;"></div>
    <div id="fcStaff" style="margin-top:14px;"></div>

    <style>
      .fc-input{padding:8px 10px;border:1px solid #d9dde3;border-radius:8px;font-size:15px;}
      .fc-tbl{width:100%;border-collapse:collapse;font-size:13px;}
      .fc-tbl th,.fc-tbl td{border:1px solid #eef0f3;padding:7px 9px;text-align:center;white-space:nowrap;}
      .fc-tbl th{background:#f7f8fa;font-weight:500;color:#1f2329;}
      .fc-tbl td.name{text-align:left;font-weight:500;}
      .fc-wrap{overflow-x:auto;}
      .fc-diff-bad{color:#d83931;font-weight:500;}
      .fc-diff-ok{color:#2ba471;}
      .fc-zero{color:#c2c6cc;}
      .fc-src{font-size:12px;color:#8a9099;}
    </style>
  `;

  const $ = id => document.getElementById(id);
  $('fcDays').onchange = load;
  $('fcSyncBtn').onclick = async () => {
    const btn = $('fcSyncBtn');
    btn.disabled = true; btn.textContent = '同步中…';
    try {
      const r = await api.post('/api/wecom/sync', {});
      if (!r.ok) throw new Error(r.error || '同步失败');
      await load();
      btn.textContent = '同步完成 ✓';
      setTimeout(() => { btn.textContent = '立即同步企微'; btn.disabled = false; }, 1500);
    } catch (e) {
      alert('同步失败：' + e.message);
      btn.textContent = '立即同步企微'; btn.disabled = false;
    }
  };

  await load();

  async function load() {
    const days = $('fcDays').value;
    $('fcTeam').innerHTML = '<div class="card"><div class="loading">加载中…</div></div>';
    $('fcStaff').innerHTML = '';
    try {
      const d = await api.get('/api/wecom/fans-check?days=' + days);
      if (!d.ok) throw new Error(d.error || '加载失败');
      renderTeam(d);
      renderStaff(d);
    } catch (e) {
      $('fcTeam').innerHTML = '<div class="card"><div style="color:#d83931;">加载失败：' + esc(e.message) + '</div></div>';
    }
  }

  function renderTeam(d) {
    let rows = d.teamCompare.map(t => {
      const diffCls = t.diff === 0 ? 'fc-diff-ok' : 'fc-diff-bad';
      const diffTxt = t.diff === 0 ? '一致 ✓' : (t.diff > 0 ? '自填多 +' + t.diff : '自填少 ' + t.diff);
      return '<tr>'
        + '<td class="name">' + esc(t.teamName) + '</td>'
        + '<td>' + t.selfTotal + '</td>'
        + '<td><strong>' + t.objTotal + '</strong></td>'
        + '<td class="' + diffCls + '">' + diffTxt + '</td>'
        + '</tr>';
    }).join('');
    $('fcTeam').innerHTML = `
      <div class="card">
        <h3 style="margin-top:0;">团队汇总：自填 vs 企微客观</h3>
        <div class="fc-wrap"><table class="fc-tbl">
          <thead><tr><th style="text-align:left;">团队</th><th>客服自填</th><th>企微客观</th><th>差异</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4" class="fc-zero">暂无数据</td></tr>'}</tbody>
        </table></div>
        <div class="muted" style="margin-top:8px;font-size:12px;color:#8a9099;">差异为红 = 自填与企微客观对不上，需核查（自填多可能虚报，自填少可能漏录）。</div>
      </div>`;
  }

  function renderStaff(d) {
    const dateHead = d.dates.map(dt => '<th>' + dt.slice(5) + '</th>').join('');
    let rows = d.staff.map(s => {
      const cells = d.dates.map(dt => {
        const v = s.byDate[dt] || 0;
        return '<td' + (v === 0 ? ' class="fc-zero"' : '') + '>' + v + '</td>';
      }).join('');
      const srcArr = Object.entries(s.ways || {}).map(([k, v]) => k + v).join(' ');
      return '<tr>'
        + '<td class="name">' + esc(s.name) + '<br><span class="fc-src">' + esc(s.teamName) + '</span></td>'
        + cells
        + '<td><strong>' + s.total + '</strong></td>'
        + '<td class="fc-src">' + esc(srcArr || '-') + '</td>'
        + '</tr>';
    }).join('');
    $('fcStaff').innerHTML = `
      <div class="card">
        <h3 style="margin-top:0;">客服个人 · 企微客观加粉（每日）</h3>
        <div class="fc-wrap"><table class="fc-tbl">
          <thead><tr><th style="text-align:left;">客服</th>${dateHead}<th>合计</th><th>来源</th></tr></thead>
          <tbody>${rows || '<tr><td class="fc-zero">暂无已映射的客服</td></tr>'}</tbody>
        </table></div>
      </div>`;
  }
};
