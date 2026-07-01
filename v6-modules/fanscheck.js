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
          <div id="fcRange"></div>
          <button class="btn" id="fcMapBtn">👥 客服映射管理</button>
          <button class="btn btn-primary" id="fcSyncBtn">立即同步企微</button>
        </div>
      </div>
    </div>

    <div id="fcMapPanel" style="margin-top:14px;display:none;"></div>
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
  let curRange = window.v6DateRange.compute('7d');
  window.v6DateRange.mount('fcRange', { preset: '7d', onChange: (r) => { curRange = r; load(); } });
  $('fcMapBtn').onclick = () => toggleMapPanel();
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
    $('fcTeam').innerHTML = '<div class="card"><div class="loading">加载中…</div></div>';
    $('fcStaff').innerHTML = '';
    try {
      const d = await api.get('/api/wecom/fans-check?start=' + curRange.start + '&end=' + curRange.end);
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

  // ===== 客服映射管理：发现企微成员 + 新增/绑定/停用 =====
  let mapOpen = false;
  async function toggleMapPanel() {
    mapOpen = !mapOpen;
    const box = $('fcMapPanel');
    box.style.display = mapOpen ? 'block' : 'none';
    if (mapOpen) await loadMap();
  }
  async function loadMap() {
    const box = $('fcMapPanel');
    box.innerHTML = '<div class="card"><div class="loading">正在从企微获取成员列表…</div></div>';
    try {
      const [disc, cfgR] = await Promise.all([
        api.get('/api/wecom/discover'),
        api.get('/api/config'),
      ]);
      if (!disc.ok) throw new Error(disc.error || '获取失败');
      const teams = (cfgR && cfgR.ok && cfgR.config && cfgR.config.teams) || {};
      const csTeams = Object.entries(teams).filter(([, v]) => v && v.role === 'cs' && !v.deleted).map(([id, v]) => ({ id, name: v.name }));
      const teamOpts = (sel) => csTeams.map(t => `<option value="${t.id}" ${t.id === sel ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
      // 排序：未映射的排前面(提醒绑定)，再按近30天加粉降序
      const members = disc.members.slice().sort((a, b) => (a.mapped === b.mapped ? (b.recentFans - a.recentFans) : (a.mapped ? 1 : -1)));
      const rows = members.map(m => {
        const status = m.mapped
          ? (m.active ? '<span class="tag tag-success">已绑定</span>' : '<span class="tag tag-warning">已停用</span>')
          : '<span class="tag tag-danger">未绑定 ⚠</span>';
        const nameInput = `<input class="fc-input" style="width:120px;padding:6px 8px;font-size:13px" id="mp_name_${esc(m.wecomUserid)}" placeholder="客服姓名" value="${esc(m.staffName || '')}">`;
        const teamSel = `<select class="fc-input" style="width:130px;padding:6px 8px;font-size:13px" id="mp_team_${esc(m.wecomUserid)}">${teamOpts(m.teamId || (csTeams[0] && csTeams[0].id))}</select>`;
        const bindBtn = `<button class="btn btn-primary" style="height:28px;padding:0 10px;font-size:12px" onclick="fcSaveMap('${esc(m.wecomUserid)}','${esc(m.staffId || '')}')">${m.mapped ? '更新' : '绑定'}</button>`;
        const toggleBtn = m.mapped
          ? `<button class="btn" style="height:28px;padding:0 10px;font-size:12px;${m.active ? 'color:var(--danger);border-color:rgba(192,57,43,.3)' : ''}" onclick="fcToggleMap('${esc(m.staffId)}',${m.active ? 0 : 1})">${m.active ? '停用' : '启用'}</button>`
          : '';
        return `<tr>
          <td class="name"><code style="font-size:12px">${esc(m.wecomUserid)}</code></td>
          <td>${status}</td>
          <td style="text-align:right">${m.recentFans}</td>
          <td>${nameInput}</td>
          <td>${teamSel}</td>
          <td style="white-space:nowrap">${bindBtn} ${toggleBtn}</td>
        </tr>`;
      }).join('');
      box.innerHTML = `
        <div class="card">
          <h3 style="margin-top:0;">👥 客服映射管理 <span class="muted" style="font-size:12px;font-weight:400">（企微成员 ${disc.total} 个，${disc.unmapped} 个未绑定）</span></h3>
          <div class="muted" style="font-size:13px;margin-bottom:10px">系统自动列出企微里所有「开通了获客助手」的成员。<b style="color:var(--danger)">红色未绑定</b>的（如新客服）填姓名+团队后点「绑定」，即可纳入加粉核对；离职客服点「停用」（数据保留）。绑定后记得点右上「立即同步企微」拉取其历史加粉。</div>
          <div class="fc-wrap"><table class="fc-tbl">
            <thead><tr><th style="text-align:left">企微成员ID</th><th>状态</th><th>近30天加粉</th><th>客服姓名</th><th>所属团队</th><th>操作</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="6" class="fc-zero">未获取到企微成员（检查企微通讯录密钥配置）</td></tr>'}</tbody>
          </table></div>
        </div>`;
    } catch (e) {
      box.innerHTML = '<div class="card"><div style="color:#d83931;">加载失败：' + esc(e.message) + '<br><span class="muted" style="font-size:12px">需企微「客户联系」权限+通讯录密钥，请确认 config.wecom 配置。</span></div></div>';
    }
  }
  // 暴露给行内 onclick
  window.fcSaveMap = async (wecomUserid, staffId) => {
    const name = (document.getElementById('mp_name_' + wecomUserid) || {}).value;
    const teamId = (document.getElementById('mp_team_' + wecomUserid) || {}).value;
    if (!name || !name.trim()) { alert('请填写客服姓名'); return; }
    const r = await api.post('/api/wecom/staff-upsert', { id: staffId || undefined, name: name.trim(), teamId, wecomUserid });
    if (r.ok) { showToast('已保存映射', 'success'); await loadMap(); }
    else showToast('失败：' + (r.error || ''), 'error');
  };
  window.fcToggleMap = async (staffId, active) => {
    if (!confirm(active ? '启用该客服？' : '停用该客服？停用后不计入加粉核对，历史数据保留，可随时启用。')) return;
    const r = await api.post('/api/wecom/staff-toggle', { id: staffId, active });
    if (r.ok) { showToast(active ? '已启用' : '已停用', 'success'); await loadMap(); }
    else showToast('失败：' + (r.error || ''), 'error');
  };
};
