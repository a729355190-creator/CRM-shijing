// 客服线 v3（本月化总览 + 分钟下拉 + 排客改/取消 + 我的数据明细）
// 「我的排客」个人归属过滤：只返回当前客服本人排的客。
// 判定优先级：csUserId === u.id（新版排客已存）；历史无 csUserId 的记录归属不明，个人视图不显示。
window.csMyInvites = function (list, u) {
  return (list || []).filter(x => x.csUserId && x.csUserId === u.id);
};
window.render_cs_overview = async function(page) {
  const u = V6.user;
  page.innerHTML = '<div class="loading">你的数据正在加载中...</div>';
  await loadAllData();
  const cs = (DB.cs || []).filter(x => x.teamId === u.teamId);
  const inv = (DB.invite || []).filter(x => x.csTeamId === u.teamId);

  page.innerHTML = `
    <div class="card" style="background:linear-gradient(135deg,var(--klein),var(--klein-deep));color:#fff;border:0">
      <h2 style="color:#fff;margin:0">${u.realName} 👋</h2>
      <p style="opacity:.85;margin:4px 0 0" id="csOvSub">客服线 · ${u.teamId === 'cs_1' ? '1 部' : u.teamId === 'cs_2' ? '2 部' : u.teamId}</p>
    </div>
    <div class="card" style="padding:14px 16px"><div id="csOvRange"></div></div>
    <div id="csOvKpi" class="kpi-grid"></div>
    <div class="card">
      <h3>🚀 快捷入口</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn btn-primary" href="#cs_input">➕ 填每日日报</a>
        <a class="btn btn-primary" href="#invite">📞 排客登记</a>
        <a class="btn" href="#invlist">◫ 我的排客</a>
        <a class="btn" href="#cs_list">⊞ 我的数据明细</a>
        <a class="btn" href="#scripts">✎ 话术系统</a>
      </div>
    </div>
  `;

  function renderKpi(r) {
    const rCs = cs.filter(x => x.date >= r.start && x.date <= r.end);
    const rInv = inv.filter(x => { const d = (x.arriveTime || '').slice(0, 10); return d >= r.start && d <= r.end; });
    const fans = rCs.reduce((s, x) => s + (+x.addFans || 0), 0);
    const deposit = rCs.reduce((s, x) => s + (+x.depositCount || 0), 0);
    const amount = rCs.reduce((s, x) => s + (+x.depositAmount || 0), 0);
    const depositRate = fans > 0 ? deposit / fans * 100 : 0;
    const invited = rInv.length;
    const arrived = rInv.filter(x => x.status === 'arrived').length;
    const noShow = rInv.filter(x => x.status === 'no_show').length;
    const arriveRate = fans > 0 ? arrived / fans * 100 : 0;
    document.getElementById('csOvSub').textContent =
      `客服线 · ${u.teamId === 'cs_1' ? '1 部' : u.teamId === 'cs_2' ? '2 部' : u.teamId} · ${r.label}（${r.start} ~ ${r.end}）`;
    document.getElementById('csOvKpi').innerHTML = `
      <div class="kpi"><div class="kpi-label">加粉</div><div class="kpi-value">${fmtNum(fans)}</div></div>
      <div class="kpi"><div class="kpi-label">定金数</div><div class="kpi-value" style="color:var(--klein)">${fmtNum(deposit)}</div><div class="kpi-foot">${fmtMoney(amount)}</div></div>
      <div class="kpi"><div class="kpi-label">定金率</div><div class="kpi-value">${fmtPct(depositRate)}</div></div>
      <div class="kpi"><div class="kpi-label">排客</div><div class="kpi-value">${fmtNum(invited)}</div></div>
      <div class="kpi"><div class="kpi-label">已到店</div><div class="kpi-value" style="color:var(--success)">${fmtNum(arrived)}</div><div class="kpi-foot">未到 ${noShow}</div></div>
      <div class="kpi"><div class="kpi-label">到店率(到店/加粉)</div><div class="kpi-value">${fans > 0 ? fmtPct(arriveRate) : '-'}</div></div>`;
  }

  window.v6DateRange.mount('csOvRange', { preset: 'month', onChange: renderKpi });
  renderKpi(window.v6DateRange.compute('month'));
};

// === 加粉/定金录入 ===
window.render_cs_cs_input = async function(page) {
  const u = V6.user;
  page.innerHTML = '<div class="loading">加载中，请稍后…</div>';
  await loadAllData();
  const today = todayStr();
  let selDate = window.__csReportDate || today;
  draw();
  function draw() {
  const existing = (DB.cs || []).find(x => x.date === selDate && ((x.createdByUserId || x.lastEditByUserId) ? (x.createdByUserId === u.id || x.lastEditByUserId === u.id) : x.teamId === u.teamId));
  // 自动统计选定日"本人"排客数（来自 invite 表，按 csUserId 归属到个人 + 选定日 arriveTime）
  const todayInviteCount = (DB.invite || []).filter(x => x.csUserId === u.id && (x.arriveTime || '').slice(0, 10) === selDate).length;

  page.innerHTML = `
    <div class="card">
      <h2>◊ 每日日报录入</h2>
      <p class="muted">${u.realName}（${u.teamId}）</p>
      <div style="display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap">
        <label style="font-size:13px;color:var(--ink-soft)">报告日期</label>
        <input type="date" class="input" id="f_reportDate" value="${selDate}" max="${today}" style="max-width:180px">
        ${selDate === today ? '<span style="font-size:12px;color:var(--ink-mute)">（默认今天）</span>' : '<span style="font-size:12px;color:var(--warning)">（补录 ' + selDate + '）</span>'}
      </div>
      ${existing ? '<div class="alert alert-info" style="background:var(--klein-soft);color:var(--klein);padding:10px 14px;border-radius:4px;margin-top:8px;font-size:13px">📌 该日已录入过，下方为修改模式</div>' : ''}
    </div>

    <div class="card" style="max-width:680px">
      <form id="csForm">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
          <div>
            <label style="display:block;font-size:12px;color:var(--ink-soft);margin-bottom:6px">加粉数</label>
            <input type="number" class="input" id="f_addFans" min="0" placeholder="今日加微好友数" value="${existing?existing.addFans||0:''}">
          </div>
          <div>
            <label style="display:block;font-size:12px;color:var(--ink-soft);margin-bottom:6px">定金数</label>
            <input type="number" class="input" id="f_depositCount" min="0" placeholder="今日收到定金的客户数" value="${existing?existing.depositCount||0:''}">
          </div>
          <div>
            <label style="display:block;font-size:12px;color:var(--ink-soft);margin-bottom:6px">排客数 <span style="color:var(--ink-mute);font-weight:400">（我本人当日自动统计）</span></label>
            <input type="number" class="input" id="f_inviteCount" value="${todayInviteCount}" disabled style="background:var(--silver-bg);color:var(--ink-soft);cursor:not-allowed">
            <div class="muted" style="font-size:11px;margin-top:4px">按你本人「排客登记」自动统计，无需手填</div>
          </div>
          <div>
            <label style="display:block;font-size:12px;color:var(--ink-soft);margin-bottom:6px">定金金额（元）</label>
            <input type="number" class="input" id="f_depositAmount" min="0" step="0.01" placeholder="今日定金收款总额" value="${existing?existing.depositAmount||0:''}">
          </div>
          <div>
            <label style="display:block;font-size:12px;color:var(--ink-soft);margin-bottom:6px">顾客到店数</label>
            <input type="number" class="input" id="f_arriveCount" min="0" placeholder="今日实际到店顾客数" value="${existing?(existing.arriveCount!=null?existing.arriveCount:''):''}">
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button type="submit" class="btn btn-primary">${existing?'更新':'保存'}</button>
          <a class="btn" href="#cs_list">查看我的数据明细</a>
          <span id="saveStatus" style="margin-left:12px;font-size:12px"></span>
        </div>
      </form>
    </div>
  `;

  const dateEl = document.getElementById('f_reportDate');
  if (dateEl) dateEl.addEventListener('change', (ev) => {
    const v = ev.target.value;
    if (!v) return;
    selDate = v > today ? today : v;
    window.__csReportDate = selDate;
    draw();
  });
  document.getElementById('csForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = document.getElementById('saveStatus');
    const addFans = +document.getElementById('f_addFans').value || 0;
    const depositCount = +document.getElementById('f_depositCount').value || 0;
    const depositAmount = +document.getElementById('f_depositAmount').value || 0;
    const arriveCount = +document.getElementById('f_arriveCount').value || 0;
    const depositRate = addFans > 0 ? +(depositCount / addFans * 100).toFixed(2) : 0;

    const rec = existing ? { ...existing } : { id: 'cs_v6_' + Date.now(), teamId: u.teamId, date: selDate, createdAt: Date.now(), createdByUserId: u.id };
    rec.addFans = addFans;
    rec.depositCount = depositCount;
    rec.depositAmount = depositAmount;
    rec.arriveCount = arriveCount;
    rec.depositRate = depositRate;
    rec.lastEditAt = new Date().toISOString();
    rec.lastEditBy = u.realName + '(' + u.username + ')';
    rec.lastEditByUserId = u.id;

    status.textContent = '保存中...';
    try {
      const url = existing ? '/api/update' : '/api/add';
      const r = await api.post(url, { collection: 'cs', record: rec });
      if (r.ok) {
        status.style.color = 'var(--success)';
        status.textContent = '✓ 已保存';
        window.__csReportDate = null;
        setTimeout(() => { render_cs_cs_input(document.getElementById('page')); }, 800);
      } else {
        status.style.color = 'var(--danger)';
        status.textContent = '✗ 失败：' + (r.error || '未知');
      }
    } catch (e) {
      status.style.color = 'var(--danger)';
      status.textContent = '✗ ' + e.message;
    }
  });
  } // end draw()
};

// === 我的排客（支持修改 + 取消）===
window.render_cs_invlist = async function(page) {
  const u = V6.user;
  page.innerHTML = '<div class="loading">加载中...</div>';
  await loadAllData();
  const inv = (DB.invite || []).filter(x => x.csTeamId === u.teamId)
    .sort((a, b) => (b.arriveTime || '').localeCompare(a.arriveTime || ''));
  const teams = DB.teams || {};
  page.innerHTML = `
    <div class="card">
      <h2>◫ 我的排客（${inv.length}）</h2>
      <p class="muted">"待反馈"的排客可以修改时间、客户信息或主动取消；已到店/已取消不可改</p>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>到店时间</th><th>客户</th><th>电话</th><th>门店</th><th>状态</th><th>备注</th><th style="width:140px">操作</th></tr></thead>
          <tbody>
            ${inv.slice(0, 100).map(x => {
              const tag = x.status === 'arrived' ? '<span class="tag tag-success">✓ 已到店</span>' :
                          x.status === 'no_show' ? '<span class="tag tag-danger">✗ 未到店</span>' :
                          x.status === 'cancelled' ? '<span class="tag tag-danger">已取消</span>' :
                          '<span class="tag tag-warning">⏳ 待反馈</span>';
              const store = (teams[x.storeTeamId] && teams[x.storeTeamId].name) || x.storeTeamId;
              const editable = !x.status || x.status === 'pending';
              return `<tr>
                <td>${(x.arriveTime||'').slice(0,16).replace('T',' ')}</td>
                <td><b>${esc(x.customerName)}</b></td>
                <td class="muted">${esc(x.phone||'-')}</td>
                <td>${esc(store)}</td>
                <td>${tag}</td>
                <td class="muted" style="max-width:160px">${x.cancelReason ? '取消：' + esc(x.cancelReason) : esc(x.remark||'-')}</td>
                <td>
                  ${editable ? `
                    <button class="btn" style="height:26px;padding:0 8px;font-size:12px" onclick="csEditInvite('${x.id}')">改</button>
                    <button class="btn" style="height:26px;padding:0 8px;font-size:12px;color:var(--danger);border-color:rgba(192,57,43,.3)" onclick="csCancelInvite('${x.id}')">取消</button>
                  ` : '<span class="muted" style="font-size:12px">-</span>'}
                </td>
              </tr>`;
            }).join('') || '<tr><td colspan="7" class="muted" style="text-align:center;padding:24px">暂无排客</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
};

window.csCancelInvite = async function (id) {
  if (!confirm('确认取消该排客吗？\n\n取消后总部仍保留该记录，门店会收到通知。')) return;
  const reason = prompt('取消原因（必填）：');
  if (!reason || reason.trim().length < 2) return alert('请填取消原因');
  const u = V6.user;
  const r = await api.post('/api/update', {
    collection: 'invite', id, data: {
      status: 'cancelled',
      cancelReason: reason.trim(),
      cancelledAt: Date.now(),
      cancelledBy: u.realName + '(' + u.username + ')',
    }
  });
  if (r.ok) {
    showToast('已取消', 'success');
    render_cs_invlist(document.getElementById('page'));
  } else {
    showToast('失败：' + (r.error || ''), 'error');
  }
};

window.csEditInvite = async function (id) {
  await loadAllData();
  const inv = (DB.invite || []).find(x => x.id === id);
  if (!inv) return alert('找不到');
  const u = V6.user;
  const teams = DB.teams || {};
  const stores = Object.entries(teams).filter(([k, v]) => v.role === 'store' && !v.deleted).map(([k, v]) => ({ id: k, name: v.name }));
  const aDate = (inv.arriveTime || '').slice(0, 10);
  const aHour = (inv.arriveTime || '').slice(11, 13) || '19';
  const aMin = (inv.arriveTime || '').slice(14, 16) || '00';
  const overlay = document.createElement('div');
  overlay.id = 'csEditOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(20,28,56,.4);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:8px;padding:24px;max-width:560px;width:100%;box-shadow:0 12px 40px rgba(0,0,0,.2)">
      <h3 style="margin:0 0 16px">修改排客：${esc(inv.customerName)}</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div><label class="lbl">客户姓名</label><input class="input" id="ce_name" value="${esc(inv.customerName||'')}"/></div>
        <div><label class="lbl">电话</label><input class="input" id="ce_phone" value="${esc(inv.phone||'')}"/></div>
        <div style="grid-column:1/-1"><label class="lbl">预约到店时间</label>
          <div style="display:flex;gap:8px">
            <input type="date" class="input" id="ce_date" value="${aDate}" style="flex:0 0 160px">
            <select class="select" id="ce_hour" style="flex:0 0 90px">${Array.from({length:24},(_,i)=>{const h=String(i).padStart(2,'0');return `<option value="${h}" ${h===aHour?'selected':''}>${h} 时</option>`}).join('')}</select>
            <select class="select" id="ce_min" style="flex:0 0 90px">${['00','15','30','45'].map(m=>`<option value="${m}" ${m===aMin?'selected':''}>${m} 分</option>`).join('')}</select>
          </div>
        </div>
        <div style="grid-column:1/-1"><label class="lbl">门店</label>
          <select class="select" id="ce_store">
            ${stores.map(s=>`<option value="${s.id}" ${s.id===inv.storeTeamId?'selected':''}>${esc(s.name)}</option>`).join('')}
          </select>
        </div>
        <div style="grid-column:1/-1"><label class="lbl">备注</label><textarea class="textarea" id="ce_remark" rows="2">${esc(inv.remark||'')}</textarea></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
        <button class="btn" onclick="document.getElementById('csEditOverlay').remove()">取消</button>
        <button class="btn btn-primary" id="ceSave">保存</button>
      </div>
    </div>
    <style>.lbl{display:block;font-size:12px;color:var(--ink-soft);margin-bottom:6px}</style>
  `;
  document.body.appendChild(overlay);
  document.getElementById('ceSave').onclick = async () => {
    // 容量校验（客服默认新客，占用1小时）
    const arriveTime = `${document.getElementById('ce_date').value}T${document.getElementById('ce_hour').value}:${document.getElementById('ce_min').value}`;
    const storeTeamId = document.getElementById('ce_store').value;

    const saveBtn = document.getElementById('ceSave');
    saveBtn.textContent = '校验时段…';
    saveBtn.disabled = true;

    const check = await api.post('/api/check-slot', {
      storeTeamId: storeTeamId,
      arriveTime: arriveTime,
      customerType: 'new'
    });

    if (!check.ok || !check.available) {
      // 显示推荐时段
      const recs = (check.recommendations || []).map(r =>
        r.time.slice(11, 16) + '（剩余' + r.remaining + '空位）'
      ).join('、');
      alert(check.message || '该时段已满' + (recs ? '，建议选择：' + recs : ''));
      saveBtn.textContent = '保存';
      saveBtn.disabled = false;
      return;
    }

    // 校验通过，继续提交
    saveBtn.textContent = '保存中…';

    const newRec = {
      customerName: document.getElementById('ce_name').value.trim(),
      phone: document.getElementById('ce_phone').value.trim(),
      arriveTime: arriveTime,
      storeTeamId: storeTeamId,
      remark: document.getElementById('ce_remark').value.trim(),
      customerType: 'new',  // 客服排客默认新客
      source: 'cs',         // 来源：客服
      lastEditAt: Date.now(),
      lastEditBy: u.realName + '(' + u.username + ')',
      editLog: (inv.editLog ? inv.editLog + '\n' : '') + `[${new Date().toLocaleString('zh-CN')} 由 ${u.realName} 修改] 客户/时间/门店/备注 已更新`,
      // 重新触发推送
      notified: false,
      reNotify: true,
    };
    const r = await api.post('/api/update', { collection: 'invite', id, data: newRec });
    if (r.ok) {
      showToast('已修改，门店将收到通知', 'success');
      document.getElementById('csEditOverlay').remove();
      render_cs_invlist(document.getElementById('page'));
    } else {
      showToast('失败：' + (r.error || ''), 'error');
    }
  };
};

// === 我的数据明细（原"我的定金记录"重构）===
window.render_cs_cs_list = async function(page) {
  const u = V6.user;
  page.innerHTML = '<div class="loading">加载中...</div>';
  await loadAllData();
  let lostInfo = null;
  try { const lr = await api.get('/api/wecom/my-lost-rate?days=30'); if (lr && lr.ok) lostInfo = lr; } catch (e) {}
  const cs = (DB.cs || []).filter(x => x.teamId === u.teamId);
  const inv = (DB.invite || []).filter(x => x.csTeamId === u.teamId);

  // 按日期聚合
  const byDate = {};
  cs.forEach(c => {
    if (!byDate[c.date]) byDate[c.date] = { date: c.date, fans: 0, dep: 0, amount: 0 };
    byDate[c.date].fans += +c.addFans || 0;
    byDate[c.date].dep += +c.depositCount || 0;
    byDate[c.date].amount += +c.depositAmount || 0;
  });
  inv.forEach(i => {
    const d = (i.arriveTime || '').slice(0, 10);
    if (!d) return;
    if (!byDate[d]) byDate[d] = { date: d, fans: 0, dep: 0, amount: 0 };
    byDate[d].invited = (byDate[d].invited || 0) + 1;
    if (i.status === 'arrived') byDate[d].arrived = (byDate[d].arrived || 0) + 1;
    if (i.status === 'no_show') byDate[d].noShow = (byDate[d].noShow || 0) + 1;
  });
  const list = Object.values(byDate).sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  // 全月汇总
  const todayS = todayStr();
  const monthStart = todayS.slice(0, 8) + '01';
  const mList = list.filter(r => r.date >= monthStart && r.date <= todayS);
  const sum = mList.reduce((s, r) => ({
    fans: s.fans + (r.fans || 0),
    dep: s.dep + (r.dep || 0),
    amount: s.amount + (r.amount || 0),
    invited: s.invited + (r.invited || 0),
    arrived: s.arrived + (r.arrived || 0),
    noShow: s.noShow + (r.noShow || 0),
  }), { fans: 0, dep: 0, amount: 0, invited: 0, arrived: 0, noShow: 0 });

  page.innerHTML = `
    <div class="card">
      <h2>⊞ 我的数据明细</h2>
      <p class="muted">本月汇总 + 按日明细。「到店」以门店确认为准（status=arrived）</p>
    </div>

    <div class="card">
      <h3>📊 本月汇总（${monthStart} ~ ${todayS}）</h3>
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-label">加粉数</div><div class="kpi-value">${fmtNum(sum.fans)}</div></div>
        <div class="kpi"><div class="kpi-label">定金数</div><div class="kpi-value" style="color:var(--klein)">${fmtNum(sum.dep)}</div></div>
        <div class="kpi"><div class="kpi-label">定金率</div><div class="kpi-value">${sum.fans > 0 ? fmtPct(sum.dep / sum.fans * 100) : '-'}</div></div>
        <div class="kpi"><div class="kpi-label">定金收款</div><div class="kpi-value" style="color:var(--danger)">${fmtMoney(sum.amount)}</div></div>
        ${lostInfo ? (lostInfo.tracked ? `<div class="kpi"><div class="kpi-label">删粉率(近30天)</div><div class="kpi-value" style="color:var(--danger)">${fmtPct(lostInfo.lostRate)}</div></div><div class="kpi"><div class="kpi-label">删粉数(近30天)</div><div class="kpi-value">${fmtNum(lostInfo.lost)}</div></div>` : `<div class="kpi"><div class="kpi-label">删粉率</div><div class="kpi-value" style="font-size:13px;color:var(--ink-mute)">待接入回调</div></div>`) : ''}
        <div class="kpi"><div class="kpi-label">排客数</div><div class="kpi-value">${fmtNum(sum.invited)}</div></div>
        <div class="kpi"><div class="kpi-label">排客率(排客/加粉)</div><div class="kpi-value">${sum.fans > 0 ? fmtPct(sum.invited / sum.fans * 100) : '-'}</div></div>
        <div class="kpi"><div class="kpi-label">到店数</div><div class="kpi-value" style="color:var(--success)">${fmtNum(sum.arrived)}</div></div>
<div class="kpi"><div class="kpi-label">加粉到店率(到店/加粉)</div><div class="kpi-value">${sum.fans > 0 ? fmtPct(sum.arrived / sum.fans * 100) : "-"}</div></div>
                <div class="kpi"><div class="kpi-label">到店率(到店/加粉)</div><div class="kpi-value">${(sum.arrived + sum.noShow) > 0 ? fmtPct(sum.arrived / sum.fans * 100) : '-'}</div></div>
      </div>
    </div>

    <div class="card">
      <h3>📅 按日明细</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>日期</th><th style="text-align:right">加粉</th><th style="text-align:right">定金数</th><th style="text-align:right">定金率</th><th style="text-align:right">定金金额</th><th style="text-align:right">排客</th><th style="text-align:right">已到店</th><th style="text-align:right">未到店</th><th style="text-align:right">到店率</th></tr></thead>
        <tbody>${list.slice(0, 80).map(r => `
          <tr>
            <td>${r.date}</td>
            <td style="text-align:right">${r.fans || 0}</td>
            <td style="text-align:right;color:var(--klein);font-weight:500">${r.dep || 0}</td>
            <td style="text-align:right">${r.fans > 0 ? fmtPct(r.dep / r.fans * 100) : '-'}</td>
            <td style="text-align:right;color:var(--danger)">${fmtMoney(r.amount || 0)}</td>
            <td style="text-align:right">${r.invited || 0}</td>
            <td style="text-align:right;color:var(--success)">${r.arrived || 0}</td>
            <td style="text-align:right">${r.noShow || 0}</td>
            <td style="text-align:right">${(r.addFans || 0) > 0 ? fmtPct((r.arrived || 0) / (r.addFans || 0) * 100) : '-'}</td>
          </tr>
        `).join('') || '<tr><td colspan="9" class="muted" style="text-align:center;padding:24px">暂无记录</td></tr>'}</tbody>
      </table></div>
    </div>
  `;
};

// === 排客登记 ===
window.render_cs_invite = async function(page) {
  const u = V6.user;
  await loadAllData();
  const teams = DB.teams || {};
  const stores = Object.entries(teams).filter(([k, v]) => v.role === 'store' && !v.deleted).map(([k, v]) => ({ id: k, name: v.name }));

  // 默认：当天日期 + 19:00
  const today = new Date();
  const defaultDate = fmtDate(today);
  const hours = Array.from({length: 24}, (_, i) => i);
  const mins = ['00', '15', '30', '45'];

  page.innerHTML = `
    <div class="card">
      <h2>☎ 客户排客登记</h2>
      <p class="muted">${u.realName} · ${u.teamId === 'cs_1' ? '1 部' : '2 部'} · 登记的客户由对应门店反馈到店情况</p>
    </div>

    <div class="card" style="max-width:680px">
      <form id="invForm">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
          <div>
            <label style="display:block;font-size:12px;color:var(--ink-soft);margin-bottom:6px">客户姓名 *</label>
            <input class="input" id="i_name" required placeholder="如：张先生">
          </div>
          <div>
            <label style="display:block;font-size:12px;color:var(--ink-soft);margin-bottom:6px">客户电话 *</label>
            <input class="input" id="i_phone" required placeholder="11 位手机号">
          </div>
          <div style="grid-column:1/-1;position:relative">
            <label style="display:block;font-size:12px;color:var(--ink-soft);margin-bottom:6px">客户企微 <span style="color:var(--danger)">*</span> <span style="color:var(--ink-mute)">（搜索并选择你名下的企微好友，确保数据精准）</span></label>
            <input class="input" id="i_wechat" placeholder="输入微信昵称/备注搜索你名下的企微好友…" autocomplete="off">
            <input type="hidden" id="i_external_userid">
            <input type="hidden" id="i_wx_bound" value="0">
            <div id="i_wx_dropdown" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:30;background:#fff;border:1px solid var(--border,#d9dde3);border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.12);max-height:240px;overflow:auto;margin-top:2px"></div>
            <div id="i_wx_hint" style="margin-top:6px;font-size:12px;color:var(--ink-mute)">必须从下拉中选择企微好友。搜不到？<a href="javascript:void(0)" id="i_wx_manual" style="color:var(--klein)">手动新建（标记待补绑）</a></div>
            <div id="i_wx_selected" style="display:none;margin-top:6px;font-size:12px"></div>
          </div>
          <div style="grid-column:1/-1">
            <label style="display:block;font-size:12px;color:var(--ink-soft);margin-bottom:6px">预约到店时间 *</label>
            <div style="display:flex;gap:8px;align-items:center">
              <input type="date" class="input" id="i_arrive_date" required value="${defaultDate}" style="flex:0 0 160px">
              <select class="select" id="i_arrive_hour" required style="flex:0 0 90px">
                ${hours.map(h => `<option value="${String(h).padStart(2,'0')}" ${h===10?'selected':''}>${String(h).padStart(2,'0')} 时</option>`).join('')}
              </select>
              <select class="select" id="i_arrive_min" required style="flex:0 0 90px">
                ${mins.map(m => `<option value="${m}">${m} 分</option>`).join('')}
              </select>
            </div>
          </div>
          <div>
            <label style="display:block;font-size:12px;color:var(--ink-soft);margin-bottom:6px">到店门店 *</label>
            <select class="select" id="i_store" required>
              <option value="">请选择门店</option>
              ${stores.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
            </select>
          </div>
          <div style="grid-column:1/-1">
            <label style="display:block;font-size:12px;color:var(--ink-soft);margin-bottom:6px">备注</label>
            <textarea class="textarea" id="i_remark" rows="2" placeholder="客户重点、特殊需求等"></textarea>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button type="submit" class="btn btn-primary">登记并通知门店</button>
          <span id="invStatus" style="margin-left:12px;font-size:12px"></span>
        </div>
      </form>
    </div>
  `;

  // ===== 客户企微：强制从企微好友下拉选择（搜不到可显式"手动新建·待补绑"） =====
  (function setupWxSearch() {
    const inp = document.getElementById('i_wechat');
    const dd = document.getElementById('i_wx_dropdown');
    const hid = document.getElementById('i_external_userid');
    const bound = document.getElementById('i_wx_bound');
    const hint = document.getElementById('i_wx_hint');
    const selBox = document.getElementById('i_wx_selected');
    const manualLink = document.getElementById('i_wx_manual');
    let t = null;

    function resetSelection() {
      hid.value = ''; bound.value = '0';
      selBox.style.display = 'none'; selBox.innerHTML = '';
      hint.style.display = 'block';
    }
    function markSelected(eid, nm, isManual) {
      hid.value = eid || '';
      bound.value = isManual ? 'manual' : '1';
      selBox.style.display = 'block';
      selBox.innerHTML = isManual
        ? `<span class="tag tag-warning">⚠ 手动新建·待补绑企微</span> <span style="color:var(--ink-mute)">${esc(nm || '')}</span>`
        : `<span class="tag tag-success">✓ 已绑定企微好友</span> <span style="color:var(--ink-mute)">${esc(nm || '')}</span>`;
      hint.style.display = isManual ? 'block' : 'none';
    }

    inp.addEventListener('input', () => {
      resetSelection();
      clearTimeout(t);
      const q = inp.value.trim();
      if (q.length < 1) { dd.style.display = 'none'; return; }
      t = setTimeout(async () => {
        try {
          const r = await api.get('/api/customer/wecom-search?limit=20&q=' + encodeURIComponent(q));
          if (!r.ok) { dd.style.display = 'none'; return; }
          if (!r.mapped) {
            dd.innerHTML = '<div style="padding:10px;color:var(--warning);font-size:13px">你的账号尚未绑定企微号，无法搜索企微好友。请联系总部在「客服绑定」配置，或用下方"手动新建"。</div>';
            dd.style.display = 'block'; return;
          }
          if (!r.customers.length) {
            dd.innerHTML = '<div style="padding:10px;color:var(--ink-mute);font-size:13px">未找到匹配的企微好友。换关键词，或用下方"手动新建·待补绑"。</div>';
            dd.style.display = 'block'; return;
          }
          dd.innerHTML = r.customers.map(c =>
            `<div class="wx-opt" data-eid="${esc(c.external_userid)}" data-nm="${esc(c.name||'')}" style="padding:9px 12px;cursor:pointer;border-bottom:1px solid #f2f3f5;font-size:14px">
              <b>${esc(c.name||'(无昵称)')}</b>${c.remark?`<span style="color:var(--ink-mute);font-size:12px;margin-left:8px">备注:${esc(c.remark)}</span>`:''}
            </div>`).join('');
          dd.style.display = 'block';
          dd.querySelectorAll('.wx-opt').forEach(o => o.onclick = () => {
            inp.value = o.dataset.nm; dd.style.display = 'none';
            markSelected(o.dataset.eid, o.dataset.nm, false);
          });
        } catch (e) { dd.style.display = 'none'; }
      }, 300);
    });

    // 手动新建·待补绑：显式确认后才允许，记录标记 needsBind
    manualLink.onclick = () => {
      const nm = inp.value.trim();
      if (!nm) { showToast('请先在上方输入客户微信昵称', 'error'); inp.focus(); return; }
      if (!confirm('确认手动新建该客户？\n\n该客户未绑定企微好友，会被标记为「待补绑企微」，请尽快在企微加为好友后补绑，以保证数据精准。')) return;
      dd.style.display = 'none';
      markSelected('', nm, true);
    };

    document.addEventListener('click', e => { if (!dd.contains(e.target) && e.target !== inp) dd.style.display = 'none'; });
  })();

  document.getElementById('invForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    const status = document.getElementById('invStatus');
    const name = document.getElementById('i_name').value.trim();
    const phone = document.getElementById('i_phone').value.trim();
    const wechatNickname = document.getElementById('i_wechat').value.trim();
    const externalUserid = document.getElementById('i_external_userid').value.trim();
    const wxBound = document.getElementById('i_wx_bound').value; // '1'=选了企微好友 'manual'=手动新建待补绑 '0'=未选
    const needsBind = wxBound === 'manual';
    const aDate = document.getElementById('i_arrive_date').value;
    const aHour = document.getElementById('i_arrive_hour').value;
    const aMin = document.getElementById('i_arrive_min').value;
    const arrive = (aDate && aHour && aMin) ? `${aDate}T${aHour}:${aMin}` : '';
    const storeId = document.getElementById('i_store').value;
    const remark = document.getElementById('i_remark').value.trim();
    if (!name || !phone || !arrive || !storeId) {
      status.style.color = 'var(--danger)';
      status.textContent = '✗ 请填写完整';
      return;
    }
    // 强制：必须选企微好友(wxBound='1') 或 显式手动新建(wxBound='manual')
    if (wxBound === '0') {
      status.style.color = 'var(--danger)';
      status.textContent = '✗ 请从下拉选择客户企微好友（搜不到可点"手动新建·待补绑"）';
      document.getElementById('i_wechat').focus();
      return;
    }
    btn.disabled = true;
    btn.textContent = '登记中...';
    status.textContent = '';
    const rec = {
      id: 'inv_v6_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      csTeamId: u.teamId,
      csTeamName: u.teamId === 'cs_1' ? '客服 1 部' : '客服 2 部',
      csUserId: u.id,
      csUserName: u.realName,
      storeTeamId: storeId,
      customerName: name,
      phone,
      wechatNickname,
      external_userid: externalUserid,
      needsBind,
      arriveTime: arrive,
      remark,
      status: 'pending',
      notified: false,
      createdAt: Date.now(),
    };
    try {
      const r = await api.post('/api/add', { collection: 'invite', record: rec });
      // 若选了企微客户，绑定 手机号↔external_userid（门店/档案后续可关联）
      if (r.ok && externalUserid && phone) {
        try { await api.post('/api/customer/bind', { phone, external_userid: externalUserid, nickname: wechatNickname }); } catch (e) {}
      }
      if (r.ok) {
        // 若到店日期是今天，立即推送门店（当天临时排客不用等 9:00 cron）；未来日期仍走 9:00 定时推
        const arriveDay = (arrive || '').slice(0, 10);
        const todayStrLocal = (function(){ const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); })();
        if (arriveDay === todayStrLocal) {
          status.style.color = 'var(--success)';
          status.textContent = '✓ 已登记，正在通知门店…';
          try {
            const pr = await api.post('/api/wecom-push-arrival', { inviteId: rec.id });
            status.textContent = (pr && pr.ok) ? '✓ 已登记，门店已收到到店通知' : '✓ 已登记（门店通知待 9:00 自动补推）';
          } catch (e) {
            status.textContent = '✓ 已登记（门店通知待 9:00 自动补推）';
          }
        } else {
          status.style.color = 'var(--success)';
          status.textContent = '✓ 已登记，门店将于到店当日 9:00 收到通知';
        }
        setTimeout(() => { router(); window.location.hash = '#invlist'; }, 1500);
      } else {
        status.style.color = 'var(--danger)';
        status.textContent = '✗ ' + (r.error || '失败');
        btn.disabled = false;
        btn.textContent = '登记并通知门店';
      }
    } catch (e) {
      status.style.color = 'var(--danger)';
      status.textContent = '✗ ' + e.message;
      btn.disabled = false;
      btn.textContent = '登记并通知门店';
    }
  });
};

// === 我的排客（仅本人）===
window.render_cs_invlist = async function(page) {
  const u = V6.user;
  await loadAllData();
  const teamInv = (DB.invite || []).filter(x => x.csTeamId === u.teamId);
  const inv = window.csMyInvites(teamInv, u)
    .sort((a, b) => (b.arriveTime || '').localeCompare(a.arriveTime || ''));
  const teams = DB.teams || {};
  page.innerHTML = `
    <div class="card">
      <h2>◫ 我的排客（${inv.length}）</h2>
      <p class="muted">“待反馈”的排客可以改时间/客户/门店，或主动取消；已到店/已取消不可改。改或取消后门店会收到通知。</p>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>到店时间</th><th>客户</th><th>电话</th><th>门店</th><th>状态</th><th>备注</th><th style="width:120px">操作</th></tr></thead>
          <tbody>
            ${inv.slice(0, 100).map(x => {
              const tag = x.status === 'arrived' ? '<span class="tag tag-success">✓ 已到店</span>' :
                          x.status === 'no_show' ? '<span class="tag tag-danger">✗ 未到店</span>' :
                          x.status === 'pending' ? '<span class="tag tag-warning">⏳ 待反馈</span>' :
                          '<span class="tag">已取消</span>';
              const store = (teams[x.storeTeamId] && teams[x.storeTeamId].name) || x.storeTeamId;
              const canEdit = x.status === 'pending';
              const ops = canEdit
                ? `<button class="btn" style="height:26px;padding:0 8px;font-size:12px" onclick="csEditInvite('${x.id}')">改</button> <button class="btn" style="height:26px;padding:0 8px;font-size:12px;color:var(--danger);border-color:rgba(192,57,43,.3)" onclick="csCancelInvite('${x.id}')">取消</button>`
                : '<span class="muted" style="font-size:12px">—</span>';
              return `<tr>
                <td>${(x.arriveTime||'').slice(0,16).replace('T',' ')}</td>
                <td><b>${x.customerName}</b></td>
                <td class="muted">${x.phone||'-'}</td>
                <td>${store}</td>
                <td>${tag}</td>
                <td class="muted" style="max-width:200px">${x.status==='cancelled'&&x.cancelReason ? ('取消：'+esc(x.cancelReason)) : (x.remark||'-')}</td>
                <td style="white-space:nowrap">${ops}</td>
              </tr>`;
            }).join('') || '<tr><td colspan="7" class="muted" style="text-align:center;padding:24px">暂无排客</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
};

// === 话术系统 v2：搜索即用 + 一键复制 ===
window.render_cs_scripts = async function(page) {
  page.innerHTML = '<div class="loading">加载话术库...</div>';
  let data;
  try {
    const r = await api.get('/api/v6/scripts/all');
    if (!r.ok) throw new Error(r.error || 'load failed');
    data = r;
  } catch (e) {
    page.innerHTML = `<div class="card"><h2>✎ 话术系统</h2><p class="muted">加载失败：${e.message}</p></div>`;
    return;
  }
  window.__scriptsData = data;
  if (!window.__scriptState) window.__scriptState = { q: '', cat: '', tab: 'use' };
  const st = window.__scriptState;

  const cats = data.stats.byCategory;

  page.innerHTML = `
    <div class="card" style="position:sticky;top:0;z-index:5;padding:14px 18px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
        <h2 style="margin:0;font-size:18px;flex:1">💬 话术中心</h2>
        <div class="tabs" style="display:flex;gap:0;border:1px solid var(--silver-soft);border-radius:6px;overflow:hidden">
          <button class="tab-btn ${st.tab==='use'?'active':''}" data-tab="use" style="padding:6px 14px;background:${st.tab==='use'?'var(--klein)':'#fff'};color:${st.tab==='use'?'#fff':'var(--ink)'};border:0;cursor:pointer;font-size:13px">日常用</button>
          <button class="tab-btn ${st.tab==='learn'?'active':''}" data-tab="learn" style="padding:6px 14px;background:${st.tab==='learn'?'var(--klein)':'#fff'};color:${st.tab==='learn'?'#fff':'var(--ink)'};border:0;cursor:pointer;font-size:13px">学习专区</button>
        </div>
      </div>
      <div id="searchArea" style="display:${st.tab==='use'?'block':'none'}">
        <div style="position:relative">
          <input class="input" id="scQ" placeholder="🔍 搜一下顾客在问什么（如「会不会再长」「会留疤」「价格多少」）" value="${st.q||''}" style="padding-left:14px;font-size:14px;height:42px">
        </div>
        <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap" id="catChips">
          <button class="chip" data-cat="" style="padding:5px 14px;border:1px solid var(--silver);border-radius:14px;background:${!st.cat?'var(--klein)':'#fff'};color:${!st.cat?'#fff':'var(--ink)'};font-size:12px;cursor:pointer">全部 (${data.cards.length})</button>
          ${Object.entries(cats).map(([k,v]) => `
            <button class="chip" data-cat="${k}" style="padding:5px 14px;border:1px solid var(--silver);border-radius:14px;background:${st.cat===k?'var(--klein)':'#fff'};color:${st.cat===k?'#fff':'var(--ink)'};font-size:12px;cursor:pointer">${k} (${v})</button>
          `).join('')}
        </div>
      </div>
    </div>
    <div id="scriptResult"></div>
  `;

  // tab 切换
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.addEventListener('click', () => {
      st.tab = b.dataset.tab;
      window.render_cs_scripts(page);
    });
  });

  if (st.tab === 'learn') {
    renderLearning();
    return;
  }

  // 搜索框
  const inp = document.getElementById('scQ');
  let timer = null;
  inp.addEventListener('input', e => {
    st.q = e.target.value.trim();
    clearTimeout(timer);
    timer = setTimeout(doSearch, 200);
  });
  // 分类 chip
  document.querySelectorAll('#catChips .chip').forEach(b => {
    b.addEventListener('click', () => {
      st.cat = b.dataset.cat;
      window.render_cs_scripts(page);
    });
  });

  doSearch();

  async function doSearch() {
    const box = document.getElementById('scriptResult');
    box.innerHTML = '<div class="loading">搜索中...</div>';
    const params = new URLSearchParams();
    if (st.q) params.set('q', st.q);
    if (st.cat) params.set('category', st.cat);
    const r = await api.get('/api/v6/scripts/search?' + params.toString());
    if (!r.ok) {
      box.innerHTML = `<div class="card empty">搜索失败</div>`;
      return;
    }
    if (!r.cards.length) {
      box.innerHTML = `
        <div class="card" style="text-align:center;padding:48px 24px">
          <div style="font-size:36px;margin-bottom:12px">🤔</div>
          <div style="font-size:15px;color:var(--ink);margin-bottom:8px">话术库里没找到「${esc(st.q)}」</div>
          <div class="muted" style="margin-bottom:20px">让 AI 基于品牌口径帮你生成 3 条候选话术</div>
          <button class="btn btn-primary" id="aiGenBtn" style="background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;border:0;padding:10px 28px;border-radius:6px;font-size:14px;cursor:pointer;font-weight:600;box-shadow:0 4px 12px rgba(124,58,237,.3)">
            🤖 让 AI 帮我生成话术
          </button>
          <div class="muted" style="margin-top:14px;font-size:11px">由 DeepSeek 提供 · 学习品牌话术库口径 · 通常 3~8 秒</div>
        </div>`;
      document.getElementById('aiGenBtn').addEventListener('click', () => callAIGenerate(st.q));
      return;
    }
    box.innerHTML = `
      <div style="margin:10px 0;color:var(--ink-mute);font-size:12px;display:flex;justify-content:space-between;align-items:center">
        <div>${st.q ? `搜索「${st.q}」找到 ${r.total} 条` : `共 ${r.total} 条`}${st.cat ? ` · 分类：${st.cat}` : ''}</div>
        ${st.q ? `<button class="btn" id="aiGenBtnTop" style="background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;border:0;padding:6px 14px;border-radius:5px;font-size:12px;cursor:pointer">🤖 让 AI 再生成 3 条</button>` : ''}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:14px" id="cardGrid">
        ${r.cards.map(c => renderCard(c)).join('')}
      </div>
    `;
    if (st.q) {
      document.getElementById('aiGenBtnTop')?.addEventListener('click', () => callAIGenerate(st.q));
    }
    bindCopyButtons(r.cards);
  }

  function bindCopyButtons(cards) {
    document.getElementById('scriptResult').querySelectorAll('.copy-btn').forEach(b => {
      b.addEventListener('click', () => {
        const cardId = b.dataset.id;
        const card = cards.find(x => x.id === cardId) || (window.__aiCards||[]).find(x => x.id === cardId);
        if (!card) return;
        copyText(card.content, b);
      });
    });
  }

  async function callAIGenerate(customerSay) {
    const grid = document.getElementById('cardGrid') || document.getElementById('scriptResult');
    const aiArea = document.createElement('div');
    aiArea.id = 'aiGenArea';
    aiArea.innerHTML = `
      <div class="card" style="margin-top:14px;border:2px dashed #7c3aed;background:linear-gradient(135deg,#faf5ff,#fff)">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#a855f7);display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px">🤖</div>
          <div>
            <div style="font-weight:600">AI 生成中...</div>
            <div class="muted" style="font-size:11px">DeepSeek 正在学习品牌话术库 + 基于「${esc(customerSay)}」生成 3 条候选</div>
          </div>
          <div class="loading-spin" style="width:18px;height:18px;border:2px solid #ddd;border-top-color:#7c3aed;border-radius:50%;animation:spin 1s linear infinite;margin-left:auto"></div>
        </div>
      </div>
      <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
    `;
    // 移除旧 AI 区
    document.getElementById('aiGenArea')?.remove();
    document.getElementById('scriptResult').appendChild(aiArea);

    const r = await api.post('/api/v6/scripts/ai-generate', { customerSay });
    if (!r.ok) {
      aiArea.innerHTML = `<div class="card" style="border:1px solid var(--danger);color:var(--danger)">AI 生成失败：${r.error||''} ${r.message||''}</div>`;
      return;
    }
    window.__aiCards = r.cards;
    aiArea.innerHTML = `
      <div class="card" style="background:linear-gradient(135deg,#faf5ff,#fff);border:1px solid #ddd6fe">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
          <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#a855f7);display:flex;align-items:center;justify-content:center;color:#fff">🤖</div>
          <div style="flex:1">
            <div style="font-weight:600">AI 推荐 ${r.cards.length} 条候选话术</div>
            <div class="muted" style="font-size:11px">基于客户原话「${esc(customerSay)}」· 参考库内 ${r.referenceCount} 条相似话术 · 用了 ${r.tokensUsed} tokens</div>
          </div>
          <button class="btn" onclick="document.getElementById('aiGenArea').remove()" style="padding:4px 10px;font-size:11px">关闭</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:14px">
          ${r.cards.map(c => renderCard(c)).join('')}
        </div>
        <div style="margin-top:14px;padding:10px 14px;background:#fef3c7;border-radius:6px;font-size:12px;color:#92400e">
          ⚠️ AI 生成内容仅供参考，发送前请快速过一眼是否符合品牌口径（不要说"永久去除""保证一辈子不长"等禁用词）
        </div>
      </div>
    `;
    // 绑定复制按钮（AI 卡）
    aiArea.querySelectorAll('.copy-btn').forEach(b => {
      b.addEventListener('click', () => {
        const cardId = b.dataset.id;
        const card = r.cards.find(x => x.id === cardId);
        if (!card) return;
        copyText(card.content, b);
      });
    });
    aiArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderCard(c) {
    const previewLines = c.content.split('\n').slice(0, 6).join('\n');
    const hasMore = c.content.split('\n').length > 6;
    return `
      <div class="script-card" style="background:#fff;border:1px solid var(--silver-soft);border-radius:8px;overflow:hidden;display:flex;flex-direction:column">
        <div style="padding:10px 14px;border-bottom:1px solid var(--silver-soft);background:${c.categoryColor}10;display:flex;align-items:center;gap:8px">
          <span style="background:${c.categoryColor};color:#fff;font-size:11px;padding:2px 8px;border-radius:10px">${c.category}</span>
          <span style="font-size:13px;font-weight:600;color:var(--ink);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escAttr(c.title)}">${esc(c.title)}</span>
        </div>
        ${c.scene ? `<div style="padding:6px 14px;font-size:11px;color:var(--ink-mute);background:var(--paper-soft)">📍 ${esc(c.scene)}</div>` : ''}
        <div class="script-body" style="padding:14px;font-size:13px;line-height:1.85;white-space:pre-wrap;color:var(--ink);flex:1;max-height:280px;overflow-y:auto">${esc(c.content)}</div>
        <div style="padding:10px 14px;border-top:1px solid var(--silver-soft);display:flex;gap:8px;background:var(--paper-soft)">
          <button class="btn copy-btn" data-id="${c.id}" style="flex:1;background:var(--klein);color:#fff;border:0;padding:8px 0;border-radius:5px;font-weight:600;cursor:pointer;font-size:13px">📋 复制全文</button>
        </div>
      </div>
    `;
  }

  function renderLearning() {
    const box = document.getElementById('scriptResult');
    const items = data.learning || [];
    box.innerHTML = `
      <div class="card">
        <h3 style="margin-top:0">📚 学习专区</h3>
        <p class="muted" style="margin:0 0 16px;font-size:12px">这里是入职新人需要熟悉的内容（品牌定位、价格、SOP、培训计划）。日常工作不需要每天看，背熟即可。</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">
          ${items.map(it => `
            <div class="learn-item" data-id="${it.id}" style="background:#fff;border:1px solid var(--silver-soft);border-radius:8px;padding:18px;cursor:pointer;transition:all .15s" onmouseenter="this.style.borderColor='var(--klein)'" onmouseleave="this.style.borderColor='var(--silver-soft)'">
              <div style="font-size:24px;margin-bottom:6px">${it.icon}</div>
              <div style="font-size:14px;font-weight:600;color:var(--ink)">${esc(it.title)}</div>
              <div style="margin-top:8px;font-size:11px;color:var(--ink-mute)">点击展开 →</div>
            </div>
          `).join('')}
        </div>
        <div id="learnDetail" style="margin-top:24px"></div>
      </div>
    `;
    box.querySelectorAll('.learn-item').forEach(el => {
      el.addEventListener('click', () => {
        const it = items.find(x => x.id === el.dataset.id);
        if (!it) return;
        const detail = document.getElementById('learnDetail');
        detail.innerHTML = `
          <div style="background:#fff;border:1px solid var(--klein);border-radius:8px;padding:24px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
              <h3 style="margin:0">${it.icon} ${esc(it.title)}</h3>
              <button class="btn" onclick="document.getElementById('learnDetail').innerHTML=''" style="padding:4px 10px;font-size:12px">收起</button>
            </div>
            <div style="font-size:13px;line-height:1.85;white-space:pre-wrap;color:var(--ink);max-height:600px;overflow-y:auto;padding:12px;background:var(--paper-soft);border-radius:6px">${esc(it.content)}</div>
          </div>
        `;
        detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  function esc(s) { return String(s||'').replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
  function escAttr(s) { return String(s||'').replace(/"/g, '&quot;'); }

  function copyText(text, btn) {
    // 优先用现代 API，降级用 textarea
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).catch(fallback);
    } else {
      fallback();
    }
    const old = btn.innerHTML;
    btn.innerHTML = '✓ 已复制，去微信粘贴';
    btn.style.background = 'var(--success, #22c55e)';
    setTimeout(() => { btn.innerHTML = old; btn.style.background = 'var(--klein)'; }, 1800);
  }
};

window.render_cs_materials = function(page) {
  page.innerHTML = `<div class="card"><h2>◐ 素材推送</h2><p class="muted">向客户推送的图片/视频素材库（建设中）</p></div>`;
};
