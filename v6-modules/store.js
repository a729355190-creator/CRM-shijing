// ===== 门店模块 v2（移植 v5 + 总览三段 + 服务记录可改 + 业绩明细 + walkin）=====

// ============== 总览（今日/本周/本月三段）==============
window.render_store_overview = async function (page) {
  const u = V6.user;
  page.innerHTML = '<div class="loading">加载中，请稍后…</div>';
  await loadAllData();
  const today = todayStr();
  const teamId = u.teamId;
  const inv = (DB.invite || []).filter(x => x.storeTeamId === teamId);

  // 店员只看自己业绩；店长看全店
  const isStaff = false; // 门店全员看全店数据（按业务理念，不再按个人过滤）
  let stores = (DB.store || []).filter(x => x.teamId === teamId);
  if (isStaff) stores = stores.filter(x => (x.performer || '').trim() === u.realName);

  const todayInv = inv.filter(x => (x.arriveTime || '').slice(0, 10) === today);
  const todayPending = todayInv.filter(x => x.status === 'pending');
  const todayArrived = todayInv.filter(x => x.status === 'arrived');

  const todayD = new Date(); todayD.setHours(0, 0, 0, 0);
  const weekStart = (() => { const d = new Date(); const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); d.setHours(0,0,0,0); return fmtDate(d); })();
  const monthStart = (() => { const d = new Date(); d.setDate(1); return fmtDate(d); })();

  const segStat = (from, to) => {
    const inSeg = stores.filter(x => x.date >= from && x.date <= to);
    const newC = inSeg.filter(x => x.customerType === '新客').length;
    const oldC = inSeg.filter(x => x.customerType === '老客').length;
    const rev = inSeg.reduce((s, x) => s + (+x.opAmount || 0) + (+x.closedAmount || 0), 0);
    return { newC, oldC, rev, count: inSeg.length };
  };
  const tStat = segStat(today, today);
  const wStat = segStat(weekStart, today);
  const mStat = segStat(monthStart, today);
  const scopeLabel = isStaff ? `（仅自己）` : '（全店）';

  page.innerHTML = `
    <div class="card" style="background:linear-gradient(135deg,var(--klein),var(--klein-deep));color:#fff;border:0">
      <h2 style="color:#fff;margin:0">${u.realName}${u.position === 'manager' ? ' 店长' : u.position === 'staff' ? ' 店员' : ''} 👋</h2>
      <p style="opacity:.85;margin:4px 0 0">${(DB.teams && DB.teams[teamId] && DB.teams[teamId].name) || teamId} · ${isStaff ? '当前视角：仅自己业绩' : '当前视角：全店'}</p>
    </div>

    ${todayPending.length > 0 ? `
    <div class="card" style="border-left:4px solid var(--warning);background:rgba(217,119,6,.04)">
      <h3 style="color:var(--warning);margin:0 0 8px">🔔 今日待到店 ${todayPending.length} 位 / 已到 ${todayArrived.length} 位（全店）</h3>
      <a class="btn btn-primary" href="#pending">→ 去处理</a>
    </div>` : ''}

    ${segCard('📅 今日 ' + scopeLabel, tStat)}
    ${segCard('📊 本周 ' + scopeLabel, wStat)}
    ${segCard('📈 本月 ' + scopeLabel, mStat)}

    <div class="card">
      <h3>🚀 快捷入口</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn btn-primary" href="#pending">☎ 待到店（全店）</a>
        <a class="btn btn-primary" href="#walkin">✎ 到店登记</a>
        <a class="btn" href="#records">⊞ 服务记录${isStaff ? '（仅自己）' : ''}</a>
        <a class="btn" href="#team">◇ 自身数据详情</a>
      </div>
    </div>
  `;

  function segCard(title, s) {
    return `
      <div class="card">
        <h3>${title}</h3>
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi-label">新客到店</div><div class="kpi-value">${s.newC}</div></div>
          <div class="kpi"><div class="kpi-label">老客到店</div><div class="kpi-value">${s.oldC}</div></div>
          <div class="kpi"><div class="kpi-label">营业额</div><div class="kpi-value" style="color:var(--danger)">${fmtMoney(s.rev)}</div></div>
          <div class="kpi"><div class="kpi-label">服务记录数</div><div class="kpi-value">${s.count}</div></div>
        </div>
      </div>`;
  }
};

// ============== 待到店（支持取消/直跳登记）==============
window.render_store_pending = async function (page) {
  page.innerHTML = '<div class="loading">加载中...</div>';
  await loadAllData();
  const u = V6.user;
  const today = todayStr();
  const inv = (DB.invite || []).filter(x => x.storeTeamId === u.teamId && x.status === 'pending')
    .sort((a, b) => (a.arriveTime || '').localeCompare(b.arriveTime || ''));

  // 批量取企微昵称+头像（客服排客时已绑定 external_userid）
  let wxBrief = {};
  const extIds = [...new Set(inv.map(x => x.external_userid).filter(Boolean))];
  if (extIds.length) {
    try {
      const br = await api.get('/api/hub/wecom-brief?ext=' + encodeURIComponent(extIds.join(',')));
      if (br && br.ok) wxBrief = br.map || {};
    } catch (e) {}
  }
  const wxCell = (x) => {
    const b = x.external_userid ? wxBrief[x.external_userid] : null;
    const nick = (b && b.name) || x.wechatNickname || '';
    const avatar = b && b.avatar ? String(b.avatar).replace(/^http:\/\//, 'https://') : '';
    const fallback = `<div style="width:34px;height:34px;border-radius:50%;background:var(--klein-soft);color:var(--klein);display:flex;align-items:center;justify-content:center;font-weight:600;font-size:14px;flex:none">${esc((nick || '客').slice(0, 1))}</div>`;
    const av = avatar
      ? `<img src="${esc(avatar)}" referrerpolicy="no-referrer" style="width:34px;height:34px;border-radius:50%;object-fit:cover;flex:none;border:1px solid var(--silver-soft)" onerror="this.outerHTML='${fallback.replace(/'/g, "&#39;")}'"/>`
      : fallback;
    return `<div style="display:flex;align-items:center;gap:8px">${av}<span style="font-size:13px">${nick ? esc(nick) : '<span style="color:var(--ink-mute)">—</span>'}</span></div>`;
  };

  // 待补详情：企微链接已确认到店但服务详情未补全（autoCreated + 无照片 或 无操作/成交结果）
  const isComplete = (s) => {
    const hasPhoto = Array.isArray(s.photos) && s.photos.length > 0;
    const hasResult = !!(s.isOperated && String(s.isOperated).trim()) || !!(s.isClosed && String(s.isClosed).trim());
    return hasPhoto && hasResult;
  };
  const pendingDetail = (DB.store || [])
    .filter(x => x.teamId === u.teamId && x.autoCreated && !isComplete(x))
    .sort((a, b) => (b.arrivedAt || b.createdAt || 0) - (a.arrivedAt || a.createdAt || 0));

  const pendingDetailHtml = pendingDetail.length === 0 ? '' : `
    <div class="card" style="border:1.5px solid rgba(216,90,48,.35);background:rgba(216,90,48,.05)">
      <h2 style="color:#993C1D">⚠️ 待补服务详情（${pendingDetail.length}）<span style="font-size:12px;color:var(--ink-mute);font-weight:400;margin-left:8px">下班前必须完成</span></h2>
      <p class="muted">这些顾客已通过企微确认到店，但还没补「操作/成交 + 顾客照片」。请尽快补全，否则 18:50 会推送提醒。</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>到店日期</th><th>客户</th><th>电话</th><th>缺什么</th><th style="width:120px">操作</th></tr></thead>
          <tbody>
            ${pendingDetail.map(s => {
              const miss = [];
              if (!(Array.isArray(s.photos) && s.photos.length > 0)) miss.push('照片');
              if (!((s.isOperated && String(s.isOperated).trim()) || (s.isClosed && String(s.isClosed).trim()))) miss.push('操作/成交');
              return `<tr style="background:rgba(216,90,48,.04)">
                <td>${esc(s.date || '-')}</td>
                <td><b>${esc(s.customerName)}</b></td>
                <td><a href="tel:${esc(s.customerPhone||s.phone||'')}" class="muted">${esc(s.customerPhone || s.phone || '-')}</a></td>
                <td><span class="tag tag-warning">${miss.join(' + ')}</span></td>
                <td><button class="btn btn-primary" style="height:28px;padding:0 10px;font-size:12px" onclick="editStoreRec('${s.id}')">去补全</button></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  page.innerHTML = `
    ${pendingDetailHtml}
    <div class="card">
      <h2>☎ 待到店客户（${inv.length}）</h2>
      <p class="muted">所有还没反馈"已到店/未到店"的客户。点击「到店」直接进登记；点击「取消」会通知客服。</p>
    </div>
    ${inv.length === 0 ? '<div class="card"><p class="muted" style="text-align:center;padding:24px">所有客户都已反馈，干得漂亮 🎉</p></div>' : `
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>预约时间</th><th>客户</th><th>微信</th><th>电话</th><th>客服</th><th>备注</th><th style="width:200px">操作</th></tr></thead>
            <tbody>
              ${inv.map(x => {
                const cs = (DB.teams && DB.teams[x.csTeamId] && DB.teams[x.csTeamId].name) || x.csTeamId || '-';
                const isToday = (x.arriveTime || '').slice(0, 10) === today;
                return `<tr ${isToday ? 'style="background:rgba(255,213,79,.08)"' : ''}>
                  <td><b>${(x.arriveTime || '').slice(0, 16).replace('T', ' ')}</b>${isToday ? ' <span class="tag tag-warning">今日</span>' : ''}</td>
                  <td><b>${esc(x.customerName)}</b></td>
                  <td>${wxCell(x)}</td>
                  <td><a href="tel:${esc(x.phone||'')}" class="muted">${esc(x.phone || '-')}</a></td>
                  <td>${esc(cs)}</td>
                  <td class="muted" style="max-width:160px">${esc(x.remark || '-')}</td>
                  <td>
                    <button class="btn btn-primary" style="height:28px;padding:0 10px;font-size:12px" onclick="storeArriveAndRegister('${x.id}')">✓ 到店登记</button>
                    <button class="btn" style="height:28px;padding:0 10px;font-size:12px;color:var(--danger);border-color:rgba(192,57,43,.3)" onclick="storeCancelInvite('${x.id}')">取消</button>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `}
  `;
};

// "到店登记"按钮：把 invite 标 arrived，跳到 walkin 表单（带 inviteId）
window.storeArriveAndRegister = async function (inviteId) {
  await loadAllData();
  const inv = (DB.invite || []).find(x => x.id === inviteId);
  if (!inv) return alert('找不到该邀约');
  // 跳到 walkin，带 inviteId 上下文（不立即标 arrived，等登记成功一并改）
  window.__pendingInvite = inv;
  window.location.hash = '#walkin';
};

window.storeCancelInvite = async function (inviteId) {
  if (!confirm('确认取消这条邀约吗？\n\n取消后客服会收到通知，总部仍保留该记录。')) return;
  await loadAllData();
  const inv = (DB.invite || []).find(x => x.id === inviteId);
  if (!inv) return alert('找不到该邀约');
  const reason = prompt('取消原因（必填，会同步给客服）：');
  if (!reason || reason.trim().length < 2) return alert('请填取消原因');
  const u = V6.user;
  const data = {
    status: 'cancelled',
    cancelReason: reason.trim(),
    cancelledAt: Date.now(),
    cancelledBy: u.realName + '(' + u.username + ')',
    cancelledByUserId: u.id,
  };
  const r = await api.post('/api/update', { collection: 'invite', id: inviteId, data });
  if (r.ok) {
    showToast('已取消，客服将收到通知', 'success');
    render_store_pending(document.getElementById('page'));
  } else {
    showToast('取消失败：' + (r.error || ''), 'error');
  }
};

// ============== 到店登记（v5 walkin 移植）==============
window.render_store_walkin = async function (page) {
  await loadAllData();
  const u = V6.user;
  const ctxInv = window.__pendingInvite; // 来自待到店"到店登记"
  delete window.__pendingInvite;

  const now = new Date();
  const tz = now.getTimezoneOffset() * 60000;
  const localISO = ctxInv ? (ctxInv.arriveTime || '').slice(0, 16) : new Date(now - tz).toISOString().slice(0, 16);

  const teamName = (DB.teams && DB.teams[u.teamId] && DB.teams[u.teamId].name) || u.teamId;

  page.innerHTML = `
    <div class="card">
      <h2>✎ 服务登记 <span style="font-size:13px;color:var(--ink-mute);font-weight:400">${teamName}</span></h2>
      <p class="muted">${ctxInv ? `客户「<b>${esc(ctxInv.customerName)}</b>」从待到店进入，登记成功后自动标记为已到店并通知客服。` : '直接到店、未经客服邀约的，从这里录入。'}</p>
    </div>
    <div class="card" style="max-width:760px">
      <form id="wiForm">
        <h3 style="margin:0 0 12px">基本信息</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px">
          <div><label class="lbl">客户姓名 *</label><input class="input" id="wi_name" required value="${ctxInv ? esc(ctxInv.customerName || '') : ''}" placeholder="如 张哥"/></div>
          <div><label class="lbl">客户电话</label><input class="input" id="wi_phone" value="${ctxInv ? esc(ctxInv.phone || '') : ''}" placeholder="选填"/></div>
          <div><label class="lbl">到店时间 *</label><input type="datetime-local" class="input" id="wi_time" required value="${localISO}"/></div>
          <div><label class="lbl">到店门店</label><input class="input" value="${teamName}" disabled/></div>
          <div><label class="lbl">客户类型 *</label>
            <select class="select" id="wi_type" onchange="onWalkInTypeChangeV6()">
              <option value="新客">新客</option>
              <option value="老客">老客</option>
            </select>
          </div>
          <div id="wi_source_wrap"><label class="lbl">来源 *</label>
            <select class="select" id="wi_source">
              <option value="客服邀约">客服邀约</option>
              <option value="转介绍">转介绍</option>
              <option value="自然进店">自然进店</option>
              <option value="老客复购">老客复购</option>
              <option value="其他">其他</option>
            </select>
          </div>
          <div id="wi_visit_wrap" style="display:none"><label class="lbl">第几次操作 *</label>
            <select class="select" id="wi_visit">
              <option value="2">第 2 次</option>
              <option value="3">第 3 次</option>
              <option value="4">第 4 次</option>
              <option value="5">第 5 次</option>
              <option value="6">第 6 次</option>
              <option value="7">第 7 次</option>
            </select>
          </div>
        </div>

        <h3 style="margin:0 0 12px">服务详情</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px">
          <div><label class="lbl">是否操作</label>
            <select class="select" id="wi_op"><option value="是">是</option><option value="否">否</option></select>
          </div>
          <div><label class="lbl">操作金额（元）</label>
            <input type="number" class="input" id="wi_opamt" step="0.01" placeholder="如 338"/>
            <label style="font-size:12px;color:var(--ink-mute);display:flex;align-items:center;gap:4px;margin-top:4px"><input type="checkbox" id="wi_opamt_neg" style="width:14px;height:14px"/> 本次为退款（记为负数扣减营业额）</label>
          </div>
          <div><label class="lbl">是否成单（升单）</label>
            <select class="select" id="wi_close"><option value="否">否</option><option value="是">是</option></select>
          </div>
          <div><label class="lbl">成单金额（元）</label>
            <input type="number" class="input" id="wi_camt" step="0.01" placeholder="无则填0"/>
            <label style="font-size:12px;color:var(--ink-mute);display:flex;align-items:center;gap:4px;margin-top:4px"><input type="checkbox" id="wi_camt_neg" style="width:14px;height:14px"/> 本次为退款（记为负数扣减营业额）</label>
          </div>
          <div><label class="lbl">业绩贡献人</label><input class="input" id="wi_perf" placeholder="老师/员工姓名" value="${esc(u.position === 'staff' ? u.realName : '')}"/></div>
          <div style="grid-column:1/-1"><label class="lbl">备注</label><textarea class="textarea" id="wi_remark" rows="2" placeholder="顾客情况、特殊需求等"></textarea></div>
          <div style="grid-column:1/-1">
            <label class="lbl">顾客照片 <span style="color:var(--danger)">*（操作前/后对比，必传）</span></label>
            <div id="wi_photo_area" style="border:1.5px dashed var(--border,#d9dde3);border-radius:10px;padding:14px;text-align:center;color:var(--ink-mute);font-size:14px;cursor:pointer">📷 点击拍照 / 选择照片（自动压缩，可多张）</div>
            <input type="file" id="wi_photo_input" accept="image/*" multiple style="display:none"/>
            <div id="wi_photo_prev" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"></div>
          </div>
        </div>

        <div style="display:flex;gap:8px;align-items:center">
          <button type="submit" class="btn btn-primary" id="wi_save">提交登记</button>
          <span id="wi_status" style="font-size:12px"></span>
        </div>
      </form>
    </div>
    <style>.lbl{display:block;font-size:12px;color:var(--ink-soft);margin-bottom:6px}</style>
  `;

  // 默认源
  if (ctxInv) {
    document.getElementById('wi_source').value = '客服邀约';
  }
  onWalkInTypeChangeV6();

  // ===== 顾客照片：拍照/选图 + 前端压缩 + 预览 + 必填 =====
  let wiPhotoFiles = [];
  (function setupWiPhoto() {
    const area = document.getElementById('wi_photo_area');
    const input = document.getElementById('wi_photo_input');
    const prev = document.getElementById('wi_photo_prev');
    area.onclick = () => input.click();
    function compress(file) {
      return new Promise((resolve, reject) => {
        const img = new Image(); const url = URL.createObjectURL(file);
        img.onload = () => {
          URL.revokeObjectURL(url);
          let { width, height } = img; const max = 1280;
          if (width > max || height > max) { if (width > height) { height = Math.round(height * max / width); width = max; } else { width = Math.round(width * max / height); height = max; } }
          const cv = document.createElement('canvas'); cv.width = width; cv.height = height;
          cv.getContext('2d').drawImage(img, 0, 0, width, height);
          cv.toBlob(b => b ? resolve(new File([b], 'photo.jpg', { type: 'image/jpeg' })) : reject(new Error('压缩失败')), 'image/jpeg', 0.7);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('读取失败')); };
        img.src = url;
      });
    }
    input.onchange = async () => {
      for (const f of Array.from(input.files)) {
        if (wiPhotoFiles.length >= 12) break;
        try {
          const c = await compress(f); wiPhotoFiles.push(c);
          const item = document.createElement('div'); item.style.position = 'relative';
          const pu = URL.createObjectURL(c);
          item.innerHTML = `<img src="${pu}" style="width:72px;height:72px;border-radius:8px;object-fit:cover"><button type="button" style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;background:var(--danger);color:#fff;border:none;cursor:pointer">×</button>`;
          item.querySelector('button').onclick = () => { wiPhotoFiles = wiPhotoFiles.filter(x => x !== c); item.remove(); };
          prev.appendChild(item);
        } catch (e) { alert('照片处理失败：' + e.message); }
      }
      input.value = '';
    };
  })();

  document.getElementById('wiForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = document.getElementById('wi_status');
    const customerName = document.getElementById('wi_name').value.trim();
    const phone = document.getElementById('wi_phone').value.trim();
    const arriveTime = document.getElementById('wi_time').value;
    const customerType = document.getElementById('wi_type').value;
    if (!customerName || !arriveTime) { status.style.color = 'var(--danger)'; status.textContent = '请填客户姓名和到店时间'; return; }
    // 照片必填
    if (wiPhotoFiles.length === 0) { status.style.color = 'var(--danger)'; status.textContent = '请至少上传一张顾客照片'; return; }

    const isNew = customerType === '新客';
    const source = document.getElementById('wi_source').value;
    const visitNo = isNew ? 1 : +document.getElementById('wi_visit').value;
    let opAmount = +document.getElementById('wi_opamt').value || 0;
    if (document.getElementById('wi_opamt_neg').checked) opAmount = -Math.abs(opAmount);
    const isOperated = document.getElementById('wi_op').value;
    const isClosed = document.getElementById('wi_close').value;
    let closedAmount = +document.getElementById('wi_camt').value || 0;
    if (document.getElementById('wi_camt_neg').checked) closedAmount = -Math.abs(closedAmount);
    const performer = document.getElementById('wi_perf').value.trim();
    const remark = document.getElementById('wi_remark').value.trim();

    const saveBtn = document.getElementById('wi_save');
    saveBtn.disabled = true;
    // 先上传照片拿 url
    status.style.color = ''; status.textContent = '上传照片…';
    let photoUrls = [];
    try {
      const fd = new FormData(); wiPhotoFiles.forEach(f => fd.append('photos', f));
      const up = await fetch('/api/customer/photo-upload', { method: 'POST', body: fd }).then(r => r.json());
      if (!up.ok) throw new Error(up.error || '照片上传失败');
      photoUrls = up.urls || [];
    } catch (err) {
      status.style.color = 'var(--danger)'; status.textContent = '✗ 照片上传失败：' + err.message;
      saveBtn.disabled = false; return;
    }

    const rec = {
      id: 'store_v6_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      teamId: u.teamId,
      date: (arriveTime || '').slice(0, 10) || todayStr(),
      walkIn: !ctxInv,
      inviteId: ctxInv ? ctxInv.id : undefined,
      source,
      visitNo,
      customerName,
      phone,
      arriveTime,
      customerType,
      isOperated, opAmount,
      isClosed, closedAmount,
      performer, remark,
      photos: photoUrls,
      amount: opAmount + closedAmount,
      createdAt: Date.now(),
      createdBy: u.realName + '(' + u.username + ')',
      createdByUserId: u.id,
    };

    status.textContent = '提交中...';
    const r = await api.post('/api/add', { collection: 'store', record: rec });
    if (!r.ok) {
      status.style.color = 'var(--danger)';
      status.textContent = '✗ ' + (r.error || '失败');
      saveBtn.disabled = false;
      return;
    }

    // 如果来自待到店，把 invite 标 arrived
    if (ctxInv) {
      await api.post('/api/update', {
        collection: 'invite',
        id: ctxInv.id,
        data: {
          status: 'arrived',
          arrivedAt: Date.now(),
          arrivedBy: u.realName,
          notified: true, // 后端 hook 也会推 cs 群
        },
      });
    }

    status.style.color = 'var(--success)';
    status.textContent = '✓ 已登记' + (ctxInv ? '，已自动标记到店并通知客服' : '');
    setTimeout(() => { window.location.hash = '#records'; }, 800);
  });
};

window.onWalkInTypeChangeV6 = function () {
  const t = document.getElementById('wi_type').value;
  const visitWrap = document.getElementById('wi_visit_wrap');
  const sourceSel = document.getElementById('wi_source');
  if (t === '新客') {
    visitWrap.style.display = 'none';
    if (sourceSel && sourceSel.value === '老客复购') sourceSel.value = '客服邀约';
  } else {
    visitWrap.style.display = '';
    if (sourceSel) sourceSel.value = '老客复购';
  }
};

function esc(s) {
  return String(s || '').replace(/[<>"']/g, c => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ============== 服务记录（加备注、可改、留痕）==============
window.render_store_records = async function (page) {
  page.innerHTML = '<div class="loading">加载中，请稍后…</div>';
  await loadAllData();
  const u = V6.user;
  const isStaff = false; // 门店全员看全店数据（按业务理念，不再按个人过滤）
  let stores = (DB.store || []).filter(x => x.teamId === u.teamId);
  if (isStaff) stores = stores.filter(x => (x.performer || '').trim() === u.realName);
  stores = stores.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  page.innerHTML = `
    <div class="card">
      <h2>⊞ 服务记录（${stores.length} 条）${isStaff ? '<span style="font-size:13px;color:var(--ink-mute);font-weight:400;margin-left:8px">仅显示自己接待</span>' : ''}</h2>
      <p class="muted">点击行末「编辑」可修改任意字段，每次修改自动留痕</p>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>日期</th><th>客户</th><th>类型</th><th>来源</th><th style="text-align:right">操作额</th><th style="text-align:right">成交额</th><th>贡献人</th><th>备注</th><th style="width:100px">操作</th></tr></thead>
          <tbody>
            ${stores.slice(0, 200).map(s => `
              <tr id="row_${s.id}">
                <td>${esc(s.date || '-')}</td>
                <td><b>${esc(s.customerName || '-')}</b></td>
                <td>${esc(s.customerType || '-')}</td>
                <td>${esc(s.source || (s.walkIn === false ? '客服邀约' : '-'))}</td>
                <td style="text-align:right;${(+s.opAmount||0)<0?'color:var(--danger);font-weight:600':''}">${(+s.opAmount || 0) ? fmtMoney(s.opAmount) : '-'}</td>
                <td style="text-align:right;${(+s.closedAmount||0)<0?'color:var(--danger);font-weight:600':'color:var(--danger);font-weight:500'}">${(+s.closedAmount || 0) ? fmtMoney(s.closedAmount) : '-'}</td>
                <td>${esc(s.performer || '-')}</td>
                <td class="muted" style="max-width:200px">${esc(s.remark || '')}</td>
                <td><button class="btn" style="height:26px;padding:0 8px;font-size:12px" onclick="editStoreRec('${s.id}')">编辑</button></td>
              </tr>
            `).join('') || '<tr><td colspan="9" class="muted" style="text-align:center;padding:24px">暂无记录</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
};

window.editStoreRec = async function (id) {
  await loadAllData();
  const rec = (DB.store || []).find(x => x.id === id);
  if (!rec) return alert('找不到记录');
  const u = V6.user;
  // 弹窗式编辑（用一个 overlay div）
  const overlay = document.createElement('div');
  overlay.id = 'editOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(20,28,56,.4);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:8px;padding:24px;max-width:560px;width:100%;max-height:90vh;overflow:auto;box-shadow:0 12px 40px rgba(0,0,0,.2)">
      <h3 style="margin:0 0 16px">编辑：${esc(rec.customerName || '-')} <span class="muted" style="font-weight:400;font-size:12px">${rec.date}</span></h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div><label class="lbl">客户姓名</label><input class="input" id="er_name" value="${esc(rec.customerName || '')}"/></div>
        <div><label class="lbl">电话</label><input class="input" id="er_phone" value="${esc(rec.phone || '')}"/></div>
        ${rec.wechatNickname ? `<div style="grid-column:1/-1"><label class="lbl">客户微信号（客服登记）</label><input class="input" value="${esc(rec.wechatNickname)}" readonly style="background:var(--silver-bg)"/></div>` : ''}
        <div><label class="lbl">客户类型</label>
          <select class="select" id="er_type"><option value="新客" ${rec.customerType === '新客' ? 'selected' : ''}>新客</option><option value="老客" ${rec.customerType === '老客' ? 'selected' : ''}>老客</option></select>
        </div>
        <div><label class="lbl">是否操作</label>
          <select class="select" id="er_op"><option value="是" ${rec.isOperated === '是' ? 'selected' : ''}>是</option><option value="否" ${rec.isOperated === '否' ? 'selected' : ''}>否</option></select>
        </div>
        <div><label class="lbl">操作金额</label>
          <input type="number" class="input" id="er_opamt" step="0.01" value="${Math.abs(rec.opAmount || 0)}"/>
          <label style="font-size:12px;color:var(--ink-mute);display:flex;align-items:center;gap:4px;margin-top:4px"><input type="checkbox" id="er_opamt_neg" style="width:14px;height:14px" ${(rec.opAmount||0)<0?'checked':''}/> 本次为退款（记为负数扣减营业额）</label>
        </div>
        <div><label class="lbl">是否成单</label>
          <select class="select" id="er_close"><option value="否" ${rec.isClosed !== '是' ? 'selected' : ''}>否</option><option value="是" ${rec.isClosed === '是' ? 'selected' : ''}>是</option></select>
        </div>
        <div><label class="lbl">成单金额</label>
          <input type="number" class="input" id="er_camt" step="0.01" value="${Math.abs(rec.closedAmount || 0)}"/>
          <label style="font-size:12px;color:var(--ink-mute);display:flex;align-items:center;gap:4px;margin-top:4px"><input type="checkbox" id="er_camt_neg" style="width:14px;height:14px" ${(rec.closedAmount||0)<0?'checked':''}/> 本次为退款（记为负数扣减营业额）</label>
        </div>
        <div><label class="lbl">贡献人</label><input class="input" id="er_perf" value="${esc(rec.performer || '')}"/></div>
        <div style="grid-column:1/-1"><label class="lbl">备注</label><textarea class="textarea" id="er_remark" rows="3" placeholder="顾客情况、特殊需求等">${esc(rec.remark || '')}</textarea></div>
        <div style="grid-column:1/-1">
          <label class="lbl">顾客照片 <span style="color:var(--danger)">*（操作前/后对比，必传）</span></label>
          <div id="er_photo_existing" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
            ${(Array.isArray(rec.photos)?rec.photos:[]).map(u=>`<div style="position:relative" data-url="${esc(u)}"><img src="${esc(u)}" style="width:70px;height:70px;border-radius:8px;object-fit:cover;border:1px solid var(--border,#eef0f3)"><button type="button" class="er-ph-del" style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;background:var(--danger);color:#fff;border:none;cursor:pointer">×</button></div>`).join('')}
          </div>
          <div id="er_photo_area" style="border:1.5px dashed var(--border,#d9dde3);border-radius:10px;padding:12px;text-align:center;color:var(--ink-mute);font-size:14px;cursor:pointer">📷 点击拍照 / 选择照片（自动压缩，可多张）</div>
          <input type="file" id="er_photo_input" accept="image/*" multiple style="display:none">
          <div id="er_photo_prev" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"></div>
        </div>
        <div style="grid-column:1/-1"><label class="lbl">修改原因（必填，留痕）</label><input class="input" id="er_reason" placeholder="如：客户补缴定金、金额录错"/></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
        <button class="btn" onclick="document.getElementById('editOverlay').remove()">取消</button>
        <button class="btn btn-primary" id="erSave">保存</button>
      </div>
      ${rec.editLog ? `<div style="margin-top:16px;padding:10px;background:var(--silver-bg);border-radius:6px;font-size:11px;color:var(--ink-mute);max-height:120px;overflow:auto;white-space:pre-line">${esc(rec.editLog)}</div>` : ''}
    </div>
    <style>.lbl{display:block;font-size:12px;color:var(--ink-soft);margin-bottom:6px}</style>
  `;
  document.body.appendChild(overlay);

  // ===== 照片：已有可删 + 新增压缩上传 =====
  let existingPhotos = Array.isArray(rec.photos) ? rec.photos.slice() : [];
  let newPhotoFiles = [];
  (function setupPhoto() {
    const exWrap = document.getElementById('er_photo_existing');
    exWrap.querySelectorAll('.er-ph-del').forEach(btn => btn.onclick = () => {
      const box = btn.closest('[data-url]');
      existingPhotos = existingPhotos.filter(u => u !== box.dataset.url);
      box.remove();
    });
    const area = document.getElementById('er_photo_area');
    const input = document.getElementById('er_photo_input');
    const prev = document.getElementById('er_photo_prev');
    area.onclick = () => input.click();
    function compress(file) {
      return new Promise((resolve, reject) => {
        const img = new Image(); const url = URL.createObjectURL(file);
        img.onload = () => {
          URL.revokeObjectURL(url);
          let { width, height } = img; const max = 1280;
          if (width > max || height > max) { if (width > height) { height = Math.round(height * max / width); width = max; } else { width = Math.round(width * max / height); height = max; } }
          const cv = document.createElement('canvas'); cv.width = width; cv.height = height;
          cv.getContext('2d').drawImage(img, 0, 0, width, height);
          cv.toBlob(b => b ? resolve(new File([b], 'photo.jpg', { type: 'image/jpeg' })) : reject(new Error('压缩失败')), 'image/jpeg', 0.7);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('读取失败')); };
        img.src = url;
      });
    }
    input.onchange = async () => {
      for (const f of Array.from(input.files)) {
        if (existingPhotos.length + newPhotoFiles.length >= 12) break;
        try {
          const c = await compress(f); newPhotoFiles.push(c);
          const item = document.createElement('div'); item.style.position = 'relative';
          const pu = URL.createObjectURL(c);
          item.innerHTML = `<img src="${pu}" style="width:70px;height:70px;border-radius:8px;object-fit:cover"><button type="button" style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;background:var(--danger);color:#fff;border:none;cursor:pointer">×</button>`;
          item.querySelector('button').onclick = () => { newPhotoFiles = newPhotoFiles.filter(x => x !== c); item.remove(); };
          prev.appendChild(item);
        } catch (e) { alert('照片处理失败：' + e.message); }
      }
      input.value = '';
    };
  })();

  document.getElementById('erSave').onclick = async () => {
    const reason = document.getElementById('er_reason').value.trim();
    if (!reason) return alert('请填修改原因');
    // 照片必传校验
    if (existingPhotos.length === 0 && newPhotoFiles.length === 0) {
      return alert('请至少上传一张顾客照片');
    }
    const saveBtn = document.getElementById('erSave');
    saveBtn.disabled = true; saveBtn.textContent = '保存中…';
    // 先上传新照片
    let photoUrls = existingPhotos.slice();
    if (newPhotoFiles.length) {
      try {
        saveBtn.textContent = '上传照片…';
        const fd = new FormData(); newPhotoFiles.forEach(f => fd.append('photos', f));
        const up = await fetch('/api/customer/photo-upload', { method: 'POST', body: fd }).then(r => r.json());
        if (!up.ok) throw new Error(up.error || '照片上传失败');
        photoUrls = photoUrls.concat(up.urls || []);
      } catch (e) { alert('照片上传失败：' + e.message); saveBtn.disabled = false; saveBtn.textContent = '保存'; return; }
    }
    saveBtn.textContent = '保存中…';
    const newRec = {
      customerName: document.getElementById('er_name').value.trim(),
      phone: document.getElementById('er_phone').value.trim(),
      customerType: document.getElementById('er_type').value,
      isOperated: document.getElementById('er_op').value,
      opAmount: (document.getElementById('er_opamt_neg').checked ? -1 : 1) * Math.abs(+document.getElementById('er_opamt').value || 0),
      isClosed: document.getElementById('er_close').value,
      closedAmount: (document.getElementById('er_camt_neg').checked ? -1 : 1) * Math.abs(+document.getElementById('er_camt').value || 0),
      performer: document.getElementById('er_perf').value.trim(),
      remark: document.getElementById('er_remark').value.trim(),
      photos: photoUrls,
    };
    // 计算 diff（photos 单独比对）
    const diffs = [];
    Object.keys(newRec).forEach(k => {
      if (k === 'photos') {
        const oldP = JSON.stringify(Array.isArray(rec.photos) ? rec.photos : []);
        const newP = JSON.stringify(newRec.photos || []);
        if (oldP !== newP) diffs.push('照片: ' + (rec.photos ? rec.photos.length : 0) + ' → ' + newRec.photos.length + ' 张');
        return;
      }
      if (String(rec[k] || '') !== String(newRec[k] || '')) {
        diffs.push(`${k}: ${rec[k] || '空'} → ${newRec[k] || '空'}`);
      }
    });
    if (diffs.length === 0) { showToast('没有变化', 'warn'); saveBtn.disabled = false; saveBtn.textContent = '保存'; return; }
    newRec.amount = newRec.opAmount + newRec.closedAmount;
    const ts = new Date().toLocaleString('zh-CN');
    const editLogLine = `[${ts} 由 ${u.realName}(${u.username}) 修改] ${diffs.join('；')}；原因：${reason}`;
    newRec.editLog = (rec.editLog ? rec.editLog + '\n' : '') + editLogLine;
    newRec.lastEditAt = new Date().toISOString();
    newRec.lastEditBy = u.realName + '(' + u.username + ')';

    const r = await api.post('/api/update', { collection: 'store', id, data: newRec });
    if (r.ok) {
      showToast('已保存 ✓', 'success');
      document.getElementById('editOverlay').remove();
      render_store_records(document.getElementById('page'));
    } else {
      showToast('失败：' + (r.error || ''), 'error');
      saveBtn.disabled = false; saveBtn.textContent = '保存';
    }
  };
};

// ============== 自身数据详情（店员）/ 本店成员业绩明细（店长）==============
window.render_store_team = async function (page) {
  page.innerHTML = '<div class="loading">加载中，请稍后…</div>';
  const u = V6.user;
  await loadAllData();
  const isStaff = false; // 门店全员看全店数据（按业务理念，不再按个人过滤）
  // 成员名单：不再调 HQ 专属的 /api/v6/users（店长无权限会 401 导致整页空白）。
  // 改为直接从本店服务记录的"业绩贡献人(performer)"字段提取，覆盖所有实际有业绩的老师（含未注册账号的）。
  const storeRows0 = (DB.store || []).filter(x => x.teamId === u.teamId);
  let teamMembers;
  if (isStaff) {
    teamMembers = [{ realName: u.realName }];
  } else {
    const names = [...new Set(storeRows0.map(x => (x.performer || '').trim()).filter(Boolean))].sort();
    teamMembers = names.map(n => ({ realName: n }));
  }

  const today = todayStr();
  const weekStart = (() => { const d = new Date(); const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return fmtDate(d); })();
  const monthStart = (() => { const d = new Date(); d.setDate(1); return fmtDate(d); })();

  const stores = (DB.store || []).filter(x => x.teamId === u.teamId);
  const performerStat = (name, from, to) => {
    const inSeg = stores.filter(s => (s.performer || '').trim() === name && s.date >= from && s.date <= to);
    const newOnes = inSeg.filter(x => x.customerType === '新客');
    const oldOnes = inSeg.filter(x => x.customerType === '老客');
    const totalRev = inSeg.reduce((s, x) => s + (+x.opAmount || 0) + (+x.closedAmount || 0), 0);
    const totalOp = inSeg.filter(x => x.isOperated === '是').length;
    const totalClose = inSeg.filter(x => x.isClosed === '是').length;
    const arpu = newOnes.length > 0 ? totalRev / newOnes.length : 0;
    return {
      newCount: newOnes.length,
      oldCount: oldOnes.length,
      receive: inSeg.length,
      opCount: totalOp,
      closeCount: totalClose,
      rev: totalRev,
      arpu,
    };
  };

  // 全店合计（仅店长视角）
  const storeTotalStat = (from, to) => {
    const inSeg = stores.filter(s => s.date >= from && s.date <= to);
    const newOnes = inSeg.filter(x => x.customerType === '新客');
    const oldOnes = inSeg.filter(x => x.customerType === '老客');
    const totalRev = inSeg.reduce((s, x) => s + (+x.opAmount || 0) + (+x.closedAmount || 0), 0);
    return {
      newCount: newOnes.length,
      oldCount: oldOnes.length,
      receive: inSeg.length,
      opCount: inSeg.filter(x => x.isOperated === '是').length,
      closeCount: inSeg.filter(x => x.isClosed === '是').length,
      rev: totalRev,
      arpu: newOnes.length > 0 ? totalRev / newOnes.length : 0,
    };
  };

  const title = '◇ 门店详情';
  const subtitle = isStaff
    ? `仅显示 ${u.realName} 自己的业绩`
    : `${(DB.teams && DB.teams[u.teamId] && DB.teams[u.teamId].name) || u.teamId} · 全店成员业绩明细`;

  page.innerHTML = `
    <div class="card">
      <h2>${title}${isStaff ? '' : `（${teamMembers.length} 人）`}</h2>
      <p class="muted">${subtitle}</p>
    </div>

    <div class="card" style="padding:14px 16px">
      <div style="font-size:13px;color:var(--ink-soft);margin-bottom:8px;">🔎 自定义查询</div>
      <div id="stTeamRange"></div>
      <div id="stTeamCustom" style="margin-top:12px;"></div>
    </div>

    ${rangeBlock('📅 今日（' + today + '）', teamMembers, name => performerStat(name, today, today), storeTotalStat(today, today))}
    ${rangeBlock('📊 本周（' + weekStart + ' ~ ' + today + '）', teamMembers, name => performerStat(name, weekStart, today), storeTotalStat(weekStart, today))}
    ${rangeBlock('📈 本月（' + monthStart + ' ~ ' + today + '）', teamMembers, name => performerStat(name, monthStart, today), storeTotalStat(monthStart, today))}
  `;

  // 自定义时间查询块
  function renderCustom(r) {
    document.getElementById('stTeamCustom').innerHTML =
      rangeBlock(`📋 ${r.label}（${r.start} ~ ${r.end}）`, teamMembers,
        name => performerStat(name, r.start, r.end), storeTotalStat(r.start, r.end));
  }
  window.v6DateRange.mount('stTeamRange', { preset: 'month', onChange: renderCustom });
  renderCustom(window.v6DateRange.compute('month'));

  function rangeBlock(title, members, fn, total) {
    return `
      <div class="card">
        <h3>${title}</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>姓名</th><th style="text-align:right">接待</th><th style="text-align:right">新客</th><th style="text-align:right">老客</th><th style="text-align:right">操作数</th><th style="text-align:right">成交</th><th style="text-align:right">营业额</th><th style="text-align:right">客单价</th></tr></thead>
          <tbody>
          ${members.map(m => {
            const s = fn(m.realName);
            return `<tr>
              <td><b>${m.realName}</b></td>
              <td style="text-align:right">${s.receive}</td>
              <td style="text-align:right">${s.newCount}</td>
              <td style="text-align:right">${s.oldCount}</td>
              <td style="text-align:right">${s.opCount}</td>
              <td style="text-align:right;color:var(--success)">${s.closeCount}</td>
              <td style="text-align:right;color:var(--danger);font-weight:500">${fmtMoney(s.rev)}</td>
              <td style="text-align:right">${s.newCount > 0 ? fmtMoney(s.arpu) : '-'}</td>
            </tr>`;
          }).join('')}
          ${!isStaff && total ? `<tr style="background:var(--klein-soft);font-weight:600">
            <td>📊 全店合计</td>
            <td style="text-align:right">${total.receive}</td>
            <td style="text-align:right">${total.newCount}</td>
            <td style="text-align:right">${total.oldCount}</td>
            <td style="text-align:right">${total.opCount}</td>
            <td style="text-align:right;color:var(--success)">${total.closeCount}</td>
            <td style="text-align:right;color:var(--danger)">${fmtMoney(total.rev)}</td>
            <td style="text-align:right">${total.newCount > 0 ? fmtMoney(total.arpu) : '-'}</td>
          </tr>` : ''}
          </tbody>
        </table></div>
      </div>`;
  }
};

// ============== 顾客演练（LILI 金牌销售对练 + 反训 + 进化招式库）==============
window.render_store_training = async function (page) {
  if (!window.__coachState) {
    window.__coachState = {
      step: 'pick',     // pick | practice | reverse | done
      profile: '',
      profileLabel: '',
      stage: '',
      mode: 'practice', // practice 正训 LILI 演销售 / reverse 反训 LILI 演顾客
      messages: [],
      busy: false,
      summary: null,
      outcome: null,
      movesAdded: 0,
      practiceMessages: null,  // 正训保存
    };
  }
  const st = window.__coachState;

  // ===== 顶部欢迎 + 切招式库按钮 =====
  function header() {
    return `
      <div class="card" style="background:linear-gradient(135deg,var(--klein),var(--klein-deep));color:#fff;border:0">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
          <div>
            <h2 style="color:#fff;margin:0">💎 LILI 金牌销售训练</h2>
            <p style="opacity:.92;margin:6px 0 0;font-size:13px;line-height:1.6">
              门店面销实战训练 · 顾客 388 体验后现场升单到套餐（2680~6680）<br>
              <span style="opacity:.8">${st.step === 'pick' ? '先选顾客类型 → 正训观察 LILI → 反训亲自上手 → 复盘沉淀金句' :
                st.mode === 'practice' ? '【正训】员工演顾客 / LILI 演金牌销售示范' :
                st.mode === 'reverse' ? '【反训】员工亲自做销售 / LILI 演顾客考验你' :
                '复盘阶段'}</span>
            </p>
          </div>
          <button class="btn" style="height:32px;padding:0 14px;font-size:12px;background:rgba(255,255,255,.18);color:#fff;border:0" onclick="coachShowMoves()">📚 金句库</button>
        </div>
      </div>
    `;
  }

  // ===== 步骤 1：选顾客类型 =====
  if (st.step === 'pick') {
    const profiles = [
      { tier: '🟢 简单档', items: [
        { k: '主动型：体验完很满意，主动问"还能继续做吗"', s: '操作后顾客已经被效果折服，主动问下一步 → 练基本功' },
        { k: '配合型：对效果满意，礼貌但需要被引导', s: '不主动反对也不主动办，需要 LILI 主动推 → 练节奏掌控' },
      ]},
      { tier: '🟡 中等档', items: [
        { k: '理性派：要看疗程证据、要对比医美', s: '要专业说服 → 练价值锚定 + 单边对比' },
        { k: '价格纠结：满意但觉得套餐 2680/4880 贵', s: '已认可效果，卡在价格 → 练算"价值账"+ 套餐组合 + 立省话术' },
      ]},
      { tier: '🔴 困难档', items: [
        { k: '装穷型：开口"我没钱""我就 388 试试不办套餐"', s: '故意装穷设防 → 练心理穿透 + 反向松绑' },
        { k: '外部干扰：要回家问老婆 / 朋友说不要冲动消费', s: '决策权不在自己 → 练拆解外部干扰 + 当场决策技巧' },
      ]},
      { tier: '🔥 变态档', items: [
        { k: '砍价型：直接"你给我 1500 我现在就办，不然走"', s: '强势砍价 → 练守价 + 锁价小定兜底' },
        { k: '同行试探：装做客户其实在套你话术', s: '考验员工识别能力 + 反套路 → 给老员工拔尖' },
      ]},
    ];

    page.innerHTML = `
      ${header()}

      <div class="card">
        <h3>第 1 步：选今天要练的顾客类型</h3>
        <p class="muted">LILI 会按这个画像演（正训中她演 LILI 销售 / 反训她演这个顾客）</p>
        ${profiles.map(g => `
          <div style="margin-top:14px">
            <div style="font-size:13px;font-weight:600;color:var(--ink);margin-bottom:8px">${g.tier}</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:10px">
              ${g.items.map(p => `
                <button type="button" class="profile-card" data-profile="${p.k}" data-stage="${p.s}" style="text-align:left;padding:14px;border:1px solid var(--silver-soft);border-radius:8px;background:#fff;cursor:pointer;transition:all .2s">
                  <div style="font-size:13px;color:var(--ink);font-weight:500;margin-bottom:6px;line-height:1.5">${p.k}</div>
                  <div style="font-size:11px;color:var(--ink-mute);line-height:1.5">${p.s}</div>
                </button>
              `).join('')}
            </div>
          </div>
        `).join('')}

        <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--silver-soft)">
          <label class="lbl">或自定义顾客（选填）</label>
          <input class="input" id="custom_profile" placeholder="如：35 岁互联网中层，最近换工作焦虑形象">
        </div>
      </div>

      <div class="card">
        <h3>第 2 步：开始正训（LILI 演销售示范）</h3>
        <p class="muted">先观察 LILI 怎么把这位顾客拿下，员工演顾客刁难她</p>
        <button class="btn btn-primary" id="startBtn" style="height:44px;padding:0 28px;font-size:14px" disabled>选好顾客类型后开始 →</button>
        <span id="tip" class="muted" style="margin-left:12px;font-size:12px">先选一个顾客类型</span>
      </div>

      <style>
        .lbl{display:block;font-size:12px;color:var(--ink-soft);margin-bottom:6px}
        .profile-card:hover{border-color:var(--klein)!important;box-shadow:0 2px 8px rgba(0,32,165,.08)}
        .profile-card.active{border-color:var(--klein)!important;background:var(--klein-soft)!important;box-shadow:0 2px 8px rgba(0,32,165,.12)}
      </style>
    `;

    let pickedProfile = '';
    let pickedStage = '';
    document.querySelectorAll('.profile-card').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.profile-card').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        pickedProfile = b.dataset.profile;
        pickedStage = b.dataset.stage;
        document.getElementById('custom_profile').value = '';
        document.getElementById('startBtn').disabled = false;
        document.getElementById('tip').textContent = '准备就绪';
      });
    });
    document.getElementById('custom_profile').addEventListener('input', e => {
      document.querySelectorAll('.profile-card').forEach(x => x.classList.remove('active'));
      pickedProfile = e.target.value.trim();
      pickedStage = '';
      const ok = pickedProfile.length > 3;
      document.getElementById('startBtn').disabled = !ok;
      document.getElementById('tip').textContent = ok ? '自定义顾客准备就绪' : '至少 4 个字描述顾客';
    });
    document.getElementById('startBtn').addEventListener('click', async () => {
      st.profile = pickedProfile;
      st.profileLabel = pickedProfile.length > 30 ? pickedProfile.slice(0, 30) + '…' : pickedProfile;
      st.stage = pickedStage;
      st.step = 'practice';
      st.mode = 'practice';
      st.messages = [];
      st.summary = null;
      await coachSend(null);
    });
    return;
  }

  // ===== 聊天 UI（正训 + 反训共用）=====
  if (st.step === 'practice' || st.step === 'reverse') {
    const isPractice = st.step === 'practice';
    const minTurns = 6;  // 至少 3 来回才能复盘
    const reachedMin = st.messages.length >= minTurns;

    page.innerHTML = `
      ${header()}

      <div class="card" style="padding:0;overflow:hidden">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 18px;background:var(--silver-bg);border-bottom:1px solid var(--silver-soft);font-size:12px">
          <div>
            <span style="font-weight:600;color:var(--klein)">${isPractice ? '🎓 正训' : '💪 反训'}</span>
            <span class="muted" style="margin-left:8px">${st.profileLabel}</span>
            <span class="muted" style="margin-left:12px">已 ${Math.floor(st.messages.length / 2)} 来回</span>
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn" style="height:26px;padding:0 10px;font-size:11px" onclick="coachReset()">↻ 换顾客</button>
            ${isPractice
              ? `<button class="btn ${reachedMin ? 'btn-primary' : ''}" style="height:26px;padding:0 10px;font-size:11px" onclick="coachStartReverse()" ${reachedMin ? '' : 'disabled'}>${reachedMin ? '💪 进入反训（轮到你做销售）→' : `还需 ${Math.ceil((minTurns - st.messages.length) / 2)} 轮`}</button>`
              : `<button class="btn ${reachedMin ? 'btn-primary' : ''}" style="height:26px;padding:0 10px;font-size:11px" onclick="coachSummary()" ${reachedMin ? '' : 'disabled'}>${reachedMin ? '📋 复盘总结' : `还需 ${Math.ceil((minTurns - st.messages.length) / 2)} 轮`}</button>`}
          </div>
        </div>

        <div id="chat_log" style="max-height:55vh;overflow-y:auto;padding:18px 20px;background:linear-gradient(180deg,#fafbfd 0%,#fff 100%)">
          ${st.messages.length === 0 ? '<div class="muted" style="text-align:center;padding:40px 0">LILI 准备中…</div>' : st.messages.map(m => coachBubble(m, st.mode)).join('')}
          ${st.busy ? `<div style="display:flex;align-items:center;gap:10px;color:var(--ink-mute);font-size:13px;padding:10px 0"><span class="spinner-mini"></span> LILI 思考中…</div>` : ''}
        </div>
        <div style="border-top:1px solid var(--silver-soft);padding:14px 16px;background:#fff">
          <div style="display:flex;gap:8px;align-items:flex-end">
            <textarea id="chat_input" class="textarea" rows="2" placeholder="${isPractice ? '你扮演这位顾客，找各种理由刁难 LILI（卡壳时输入"LILI 给我建议"）' : '你扮演销售，把这位顾客拿下（卡壳时输入"LILI 给我建议"）'}" style="flex:1;font-size:14px;line-height:1.6;resize:none;${st.busy ? 'opacity:.6' : ''}" ${st.busy ? 'disabled' : ''}></textarea>
            <button class="btn btn-primary" id="send_btn" style="height:46px;padding:0 22px;font-size:14px" ${st.busy ? 'disabled' : ''}>发送</button>
          </div>
          <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
            ${(isPractice
              ? ['你这价格太贵了我不办', '我回去想想', '这个真的有效吗', '我朋友说不要冲动消费', 'LILI 给我建议']
              : ['（夸顾客形象）', '（指出单边对比效果）', '（推荐合适的套餐）', '（用价值锚定算账）', 'LILI 给我建议']
            ).map(q => `<button class="btn" style="height:26px;padding:0 10px;font-size:11px" onclick="coachQuick('${q.replace(/'/g, '&#39;')}')" ${st.busy ? 'disabled' : ''}>${q}</button>`).join('')}
          </div>
        </div>
      </div>

      <style>
        .spinner-mini{display:inline-block;width:12px;height:12px;border:2px solid var(--silver);border-top-color:var(--klein);border-radius:50%;animation:spin .8s linear infinite}
        @keyframes spin{to{transform:rotate(360deg)}}
      </style>
    `;

    const log = document.getElementById('chat_log');
    if (log) log.scrollTop = log.scrollHeight;
    const sendBtn = document.getElementById('send_btn');
    const inputEl = document.getElementById('chat_input');
    if (sendBtn) sendBtn.addEventListener('click', () => {
      const text = inputEl.value.trim();
      if (!text) return;
      inputEl.value = '';
      coachSend(text);
    });
    if (inputEl) {
      inputEl.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBtn.click(); }
      });
      if (!st.busy) inputEl.focus();
    }
    return;
  }

  // ===== 复盘 =====
  if (st.step === 'done') {
    const outcomeStyle = {
      '完美胜利': { bg: '#10b981', icon: '🏆', text: '完美胜利' },
      '标准胜利': { bg: 'var(--klein)', icon: '✅', text: '标准胜利' },
      '兜底胜利': { bg: '#f59e0b', icon: '💰', text: '兜底胜利（锁价小定）' },
      '完全失败': { bg: 'var(--danger)', icon: '❌', text: '完全失败' },
    }[st.outcome] || { bg: 'var(--ink-soft)', icon: '?', text: st.outcome || '未识别' };

    page.innerHTML = `
      ${header()}

      <div class="card" style="background:${outcomeStyle.bg};color:#fff;border:0">
        <div style="display:flex;align-items:center;gap:14px">
          <div style="font-size:48px">${outcomeStyle.icon}</div>
          <div>
            <h2 style="color:#fff;margin:0">${outcomeStyle.text}</h2>
            <p style="opacity:.92;margin:4px 0 0">本次训练为「全员金句库」沉淀了 ${st.movesAdded} 条新金句</p>
          </div>
        </div>
      </div>

      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3 style="margin:0">📋 LILI 复盘报告</h3>
          <div style="display:flex;gap:6px">
            <button class="btn" style="height:28px;padding:0 12px;font-size:12px" onclick="coachCopySummary()">复制</button>
            <button class="btn btn-primary" style="height:28px;padding:0 12px;font-size:12px" onclick="coachReset()">↻ 再练一位</button>
          </div>
        </div>
        <div id="summary_content" style="font-size:13px;line-height:1.85;color:var(--ink);white-space:pre-wrap;background:var(--silver-bg);padding:18px;border-radius:6px">${esc(st.summary || '')}</div>
      </div>
    `;
    return;
  }
};

function coachBubble(m, mode) {
  const isUser = m.role === 'user';
  const isLILI = !isUser;
  const isAdvice = isLILI && /【LILI 提示】/.test(m.content);
  // 正训：LILI 演销售（粉/克莱因）/ 用户演顾客（灰）
  // 反训：LILI 演顾客（灰）/ 用户演销售（克莱因）
  let bg, color, label, labelColor;
  if (isAdvice) {
    bg = 'rgba(124,58,237,.08)'; color = 'var(--ink)';
    label = '🎓 LILI 提示'; labelColor = '#7c3aed';
  } else if (mode === 'practice') {
    if (isLILI) { bg = '#fff'; color = 'var(--ink)'; label = '💎 LILI（销售）'; labelColor = 'var(--klein)'; }
    else { bg = 'var(--silver-bg)'; color = 'var(--ink)'; label = '👤 你（演顾客）'; labelColor = 'var(--ink-mute)'; }
  } else {
    // reverse
    if (isLILI) { bg = 'var(--silver-bg)'; color = 'var(--ink)'; label = '👤 LILI（顾客）'; labelColor = 'var(--ink-mute)'; }
    else { bg = 'var(--klein)'; color = '#fff'; label = '💪 你（销售）'; labelColor = 'var(--klein)'; }
  }
  const align = isUser ? 'flex-end' : 'flex-start';
  const border = isAdvice ? '1px solid rgba(124,58,237,.4)' : (bg === '#fff' ? '1px solid var(--silver-soft)' : '0');
  return `
    <div style="display:flex;flex-direction:column;align-items:${align};margin-bottom:14px">
      <div style="font-size:11px;color:${labelColor};margin-bottom:4px;font-weight:500">${label}</div>
      <div style="max-width:78%;background:${bg};color:${color};border:${border};border-radius:10px;padding:10px 14px;font-size:13px;line-height:1.7;white-space:pre-wrap">${esc(m.content)}</div>
    </div>
  `;
}

window.coachSend = async function (text) {
  const st = window.__coachState;
  if (st.busy) return;
  if (text) st.messages.push({ role: 'user', content: text });
  st.busy = true;
  render_store_training(document.getElementById('page'));
  try {
    const r = await api.post('/api/v6/scripts/coach/chat', {
      messages: st.messages,
      customerProfile: st.profile,
      stage: st.stage,
      mode: st.mode,
    });
    if (r.ok) st.messages.push({ role: 'assistant', content: r.reply });
    else st.messages.push({ role: 'assistant', content: '⚠️ LILI 暂时无法回复：' + (r.error || '') });
  } catch (e) {
    st.messages.push({ role: 'assistant', content: '⚠️ 网络错误：' + e.message });
  }
  st.busy = false;
  render_store_training(document.getElementById('page'));
};

window.coachQuick = function (text) {
  const inputEl = document.getElementById('chat_input');
  if (inputEl) { inputEl.value = text; inputEl.focus(); }
};

window.coachStartReverse = function () {
  const st = window.__coachState;
  if (!confirm('准备好了吗？\n\n反训阶段：你扮演销售，亲自把刚才那位顾客拿下。\nLILI 会演这位顾客来考验你，卡壳时输入"LILI 给我建议"。')) return;
  st.practiceMessages = st.messages.slice();
  st.messages = [];
  st.step = 'reverse';
  st.mode = 'reverse';
  coachSend(null);
};

window.coachReset = function () {
  if (!confirm('换一位顾客重新开始？当前训练记录将清空（如果还没复盘建议先复盘）')) return;
  window.__coachState = null;
  render_store_training(document.getElementById('page'));
};

window.coachSummary = async function () {
  const st = window.__coachState;
  if (st.busy || st.messages.length < 4) return;
  st.busy = true;
  render_store_training(document.getElementById('page'));
  try {
    const r = await api.post('/api/v6/scripts/coach/summary', {
      messages: st.messages,
      customerProfile: st.profile,
      mode: st.mode,
    });
    if (r.ok) {
      st.summary = r.summary;
      st.outcome = r.outcome;
      st.movesAdded = r.movesAdded || 0;
      st.step = 'done';
    } else {
      alert('生成复盘失败：' + (r.error || ''));
    }
  } catch (e) { alert('网络错误：' + e.message); }
  st.busy = false;
  render_store_training(document.getElementById('page'));
};

window.coachCopySummary = async function () {
  const st = window.__coachState;
  if (!st.summary) return;
  await navigator.clipboard.writeText(st.summary);
  showToast('已复制', 'success');
};

window.coachShowMoves = async function () {
  const r = await api.get('/api/v6/scripts/coach/moves');
  const moves = (r && r.moves) || [];
  const isHQ = !!(r && r.isHQ);
  const overlay = document.createElement('div');
  overlay.id = 'movesOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(20,28,56,.5);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
  const styleGroups = {};
  moves.forEach(m => {
    const k = m.style || '其他';
    if (!styleGroups[k]) styleGroups[k] = [];
    styleGroups[k].push(m);
  });
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:10px;padding:24px;max-width:760px;width:100%;max-height:80vh;overflow:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <h3 style="margin:0">📚 全员金句库（${moves.length} 条 · 全员训练沉淀）</h3>
        <button class="btn" style="height:28px;padding:0 12px;font-size:12px" onclick="document.getElementById('movesOverlay').remove()">关闭</button>
      </div>
      ${isHQ ? '<p class="muted" style="font-size:11px;margin:-4px 0 12px">您是总部账号，可点击「✕」按钮删除低质量金句</p>' : ''}
      ${moves.length === 0 ? '<p class="muted" style="text-align:center;padding:30px">还没有金句，做完第一次训练复盘后会自动沉淀</p>' :
        Object.entries(styleGroups).map(([style, list]) => `
          <div style="margin-bottom:18px">
            <div style="font-weight:600;color:var(--klein);margin-bottom:8px;font-size:13px">▸ ${esc(style)}（${list.length}）</div>
            ${list.map(m => `
              <div style="border-left:3px solid var(--klein-soft);padding:8px 12px;margin-bottom:6px;background:var(--silver-bg);border-radius:0 4px 4px 0;position:relative">
                <div style="font-size:13px;line-height:1.7;color:var(--ink);margin-bottom:4px;padding-right:${isHQ ? '24px' : '0'}">"${esc(m.move || m.keyLine || '')}"</div>
                <div style="font-size:11px;color:var(--ink-mute)">
                  ${m.scene ? '🎯 ' + esc(m.scene) + ' · ' : ''}${esc(m.outcome || '')} · ${esc(m.uploaderName || '佚名')} · ${new Date(m.createdAt || 0).toLocaleDateString('zh-CN')}
                </div>
                ${isHQ ? `<button onclick="hqDelMove('${esc(m.id)}', this)" title="删除该金句" style="position:absolute;top:6px;right:6px;width:22px;height:22px;border:0;background:transparent;color:var(--danger);cursor:pointer;font-size:14px;line-height:1">✕</button>` : ''}
              </div>
            `).join('')}
          </div>
        `).join('')}
    </div>
  `;
  document.body.appendChild(overlay);
};

window.hqDelMove = async function (id, btn) {
  if (!confirm('确认删除该金句？删除后该金句不再出现在金句库和 LILI 训练注入。')) return;
  try {
    const r = await fetch('/api/v6/scripts/coach/moves/' + encodeURIComponent(id), { method: 'DELETE' }).then(r => r.json());
    if (r.ok) {
      // 删除整行
      btn.closest('div[style*="border-left"]').remove();
      showToast('已删除', 'success');
    } else {
      alert('删除失败：' + (r.error || ''));
    }
  } catch (e) { alert('网络错误：' + e.message); }
};
