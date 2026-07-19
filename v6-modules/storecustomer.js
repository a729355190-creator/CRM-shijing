/* ============================================================
 * V6 模块：门店「客户中心」（store 角色，总部也可用）
 * 处理函数：render_store_customers(page)
 * 以客户为中心：搜客户→抽屉看历次到店→追加本次(必传照片)/再次邀约；新客走新建
 * 交互：详情用底部滑出抽屉，不跳页尾。照片前端压缩后存服务器。
 * ============================================================ */
window.render_store_customers = async function (page) {
  page.innerHTML = `
    <div class="card">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        <input type="text" id="scSearch" class="sc-input" placeholder="搜索 姓名 / 手机号…" style="flex:1;min-width:180px;" />
        <button class="btn btn-primary" id="scNewBtn">+ 新建客户</button>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-top:8px;">
        <div class="muted" id="scCount" style="font-size:13px;color:#8a9099;"></div>
        <div style="display:flex;align-items:center;gap:6px;">
          <span class="muted" style="font-size:12px;color:#8a9099;">每页</span>
          <select id="scSize" class="sc-input" style="padding:5px 8px;font-size:13px;">
            <option value="20">20</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </div>
      </div>
      <div id="scList" style="margin-top:8px;"><div class="loading">加载中…</div></div>
      <div id="scPager" style="margin-top:12px;display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;"></div>
    </div>

    <div id="scDrawer" class="sc-drawer-bg" style="display:none;">
      <div class="sc-drawer" id="scDrawerInner"></div>
    </div>
    <div id="scModalHost"></div>

    <style>
      .sc-input{padding:10px 12px;border:1px solid #d9dde3;border-radius:8px;font-size:16px;}
      .sc-row{display:flex;align-items:center;justify-content:space-between;padding:12px;border:1px solid #eef0f3;border-radius:8px;margin-bottom:8px;cursor:pointer;}
      .sc-row:active{background:#f2f3f5;}
      .sc-nm{font-weight:500;font-size:15px;}
      .sc-ph{font-size:12px;color:#8a9099;margin-left:8px;}
      .sc-meta{font-size:12px;color:#646a73;text-align:right;}
      .sc-tag{display:inline-block;padding:1px 7px;border-radius:9px;font-size:11px;margin-left:6px;}
      .sc-rep{background:#e8f3ff;color:#3370ff;}
      .sc-deal{background:#e8f8f0;color:#2ba471;}
      .sc-drawer-bg{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:60;display:flex;align-items:flex-end;justify-content:center;}
      .sc-drawer{background:#fff;border-radius:16px 16px 0 0;width:100%;max-width:560px;max-height:88vh;overflow:auto;padding:16px 18px 28px;animation:scUp .22s ease;}
      @keyframes scUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
      .sc-handle{width:38px;height:4px;border-radius:2px;background:#dfe2e8;margin:0 auto 12px;}
      .sc-tl{position:relative;padding-left:20px;margin-top:6px;}
      .sc-tl::before{content:'';position:absolute;left:5px;top:4px;bottom:4px;width:2px;background:#eef0f3;}
      .sc-ti{position:relative;margin-bottom:14px;}
      .sc-dot{position:absolute;left:-18px;top:3px;width:9px;height:9px;border-radius:50%;}
      .sc-thumbs{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;}
      .sc-thumb{width:64px;height:64px;border-radius:8px;object-fit:cover;border:1px solid #eef0f3;cursor:pointer;}
      .sc-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:70;display:flex;align-items:flex-end;justify-content:center;}
      .sc-modal{background:#fff;border-radius:16px 16px 0 0;width:100%;max-width:480px;max-height:90vh;overflow:auto;padding:18px;animation:scUp .22s ease;}
      .sc-fld{margin-bottom:12px;}
      .sc-fld label{display:block;font-size:13px;color:#646a73;margin-bottom:4px;}
      .sc-fld input,.sc-fld select,.sc-fld textarea{width:100%;padding:10px 11px;border:1px solid #d9dde3;border-radius:8px;font-size:16px;box-sizing:border-box;}
      .sc-actions{display:flex;gap:8px;margin-top:10px;}
      .sc-actions .btn{flex:1;}
      .sc-photo-area{border:1.5px dashed #d9dde3;border-radius:10px;padding:14px;text-align:center;color:#8a9099;font-size:14px;cursor:pointer;}
      .sc-photo-area.has{border-style:solid;border-color:#95de64;}
      .sc-prev{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;}
      .sc-prev-item{position:relative;}
      .sc-prev-item img{width:70px;height:70px;border-radius:8px;object-fit:cover;}
      .sc-prev-del{position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;background:#d83931;color:#fff;border:none;font-size:13px;line-height:20px;cursor:pointer;}
      .sc-lightbox{position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:90;display:flex;align-items:center;justify-content:center;}
      .sc-lightbox img{max-width:94%;max-height:90%;border-radius:8px;}
      .sc-pgbtn{display:inline-block;padding:7px 14px;border:1px solid #d9dde3;border-radius:8px;cursor:pointer;font-size:13px;background:#fff;color:#1f2329;}
      .sc-pgbtn:hover{background:#f2f4f7;border-color:#c0c5cc;}
      .sc-pgbtn[disabled]{opacity:.4;cursor:not-allowed;}
      .sc-pginfo{font-size:13px;color:#646a73;min-width:90px;text-align:center;}
    </style>
  `;
  const $ = id => document.getElementById(id);
  let timer = null;
  let curPage = 1, curQ = '', curSize = 20;
  $('scSearch').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { curQ = $('scSearch').value; curPage = 1; loadList(); }, 300); });
  $('scSize').addEventListener('change', () => { curSize = parseInt($('scSize').value) || 20; curPage = 1; loadList(); });
  $('scNewBtn').onclick = () => openForm('create');
  await loadList();

  async function loadList() {
    const el = $('scList');
    el.innerHTML = '<div class="loading">加载中…</div>';
    try {
      const d = await api.get('/api/customer/store-list?page=' + curPage + '&size=' + curSize + '&q=' + encodeURIComponent(curQ || ''));
      if (!d.ok) throw new Error(d.error || '加载失败');
      const totalPage = d.totalPage || 1;
      if (curPage > totalPage) { curPage = totalPage; }
      const from = d.total ? (curPage - 1) * curSize + 1 : 0;
      const to = Math.min(curPage * curSize, d.total);
      $('scCount').textContent = '本店客户 ' + d.total + ' 位' + (curQ ? '（已筛选）' : '') + (d.total ? ` · 显示 ${from}-${to}` : '');
      if (!d.customers.length) {
        el.innerHTML = '<div style="color:#8a9099;font-size:13px;padding:10px;">没有客户。新客可点右上「+ 新建客户」。</div>';
        $('scPager').innerHTML = '';
        return;
      }
      el.innerHTML = d.customers.map(c => {
        const tags = (c.arriveCount > 1 ? '<span class="sc-tag sc-rep">复购×' + c.arriveCount + '</span>' : '')
          + (c.dealCount > 0 ? '<span class="sc-tag sc-deal">成交</span>' : '');
        return `<div class="sc-row" data-key="${esc(c.key)}">
          <div style="min-width:0;">
            <div><span class="sc-nm">${esc(c.name || '未命名')}</span><span class="sc-ph">${esc(c.phone || '无号')}</span>${tags}</div>
            ${c.nickname ? `<div style="font-size:12px;color:#8a9099;margin-top:2px;">💬 ${esc(c.nickname)}</div>` : ''}
          </div>
          <div class="sc-meta">到店${c.arriveCount} · ¥${(c.ltv || 0).toLocaleString('zh-CN')}</div>
        </div>`;
      }).join('');
      el.querySelectorAll('.sc-row').forEach(r => r.onclick = () => showDetail(r.dataset.key));
      renderPager(totalPage);
    } catch (e) { el.innerHTML = '<div style="color:#d83931;">加载失败：' + esc(e.message) + '</div>'; }
  }

  function renderPager(totalPage) {
    const box = $('scPager');
    if (totalPage <= 1) { box.innerHTML = ''; return; }
    box.innerHTML = `
      <span class="sc-pgbtn" id="scFirst" ${curPage <= 1 ? 'disabled' : ''}>« 首页</span>
      <span class="sc-pgbtn" id="scPrev" ${curPage <= 1 ? 'disabled' : ''}>‹ 上一页</span>
      <span class="sc-pginfo">${curPage} / ${totalPage} 页</span>
      <span class="sc-pgbtn" id="scNext" ${curPage >= totalPage ? 'disabled' : ''}>下一页 ›</span>
      <span class="sc-pgbtn" id="scLast" ${curPage >= totalPage ? 'disabled' : ''}>末页 »</span>`;
    const go = (p) => { if (p < 1 || p > totalPage || p === curPage) return; curPage = p; loadList(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    $('scFirst').onclick = () => go(1);
    $('scPrev').onclick = () => go(curPage - 1);
    $('scNext').onclick = () => go(curPage + 1);
    $('scLast').onclick = () => go(totalPage);
  }

  function closeDrawer() { $('scDrawer').style.display = 'none'; }

  async function showDetail(key) {
    const bg = $('scDrawer'), inner = $('scDrawerInner');
    inner.innerHTML = '<div class="sc-handle"></div><div class="loading">加载档案…</div>';
    bg.style.display = 'flex';
    bg.onclick = e => { if (e.target === bg) closeDrawer(); };
    try {
      const d = await api.get('/api/customer/detail?key=' + encodeURIComponent(key));
      if (!d.ok) throw new Error(d.error || '加载失败');
      const c = d.customer;
      const dotColor = e => e.type === 'invite' ? '#378ADD' : (e.title.includes('成交') ? '#2ba471' : '#BA7517');
      const tl = c.events.map(e => {
        const thumbs = (e.photos && e.photos.length)
          ? `<div class="sc-thumbs">${e.photos.map(u => `<img class="sc-thumb" src="${esc(u)}" data-full="${esc(u)}">`).join('')}</div>` : '';
        return `<div class="sc-ti"><div class="sc-dot" style="background:${dotColor(e)}"></div>
          <div style="font-size:13px;font-weight:500;">${esc(e.title)} <span style="color:#8a9099;font-weight:400;font-size:11px;">· ${esc(e.date)}</span></div>
          ${e.detail ? `<div style="font-size:12px;color:#646a73;">${esc(e.detail)}</div>` : ''}
          ${e.remark ? `<div style="font-size:12px;color:#8a9099;">${esc(e.remark)}</div>` : ''}
          ${thumbs}
        </div>`;
      }).join('');
      inner.innerHTML = `
        <div class="sc-handle"></div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
          <div style="width:44px;height:44px;border-radius:50%;background:#e8f3ff;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:17px;color:#3370ff;">${esc((c.name || '?').slice(0, 1))}</div>
          <div style="flex:1;min-width:0;"><div style="font-weight:600;font-size:16px;">${esc(c.name || '未命名')}${c.nickname ? `<span style="font-size:12px;font-weight:400;color:#8a9099;margin-left:8px;">💬 ${esc(c.nickname)}</span>` : ''}</div>
            <div style="font-size:13px;color:#646a73;">${esc(c.phone || '无手机号')} · 到店${c.arriveCount}次 · 累计¥${(c.ltv || 0).toLocaleString('zh-CN')}</div></div>
          <button class="btn" id="scClose" style="padding:6px 10px;">关闭</button>
        </div>
        <div class="sc-actions" style="margin-bottom:14px;">
          <button class="btn btn-primary" id="scVisitBtn">✓ 本次到店</button>
          <button class="btn" id="scReinviteBtn">📅 再次邀约</button>
        </div>
        <div style="font-weight:500;font-size:14px;margin-bottom:4px;">📋 客户旅程</div>
        <div class="sc-tl">${tl || '<div style="color:#8a9099;">暂无记录</div>'}</div>`;
      inner.querySelector('#scClose').onclick = closeDrawer;
      inner.querySelector('#scVisitBtn').onclick = () => openForm('visit', { name: c.name, phone: c.phone });
      inner.querySelector('#scReinviteBtn').onclick = () => openForm('reinvite', { name: c.name, phone: c.phone });
      inner.querySelectorAll('.sc-thumb').forEach(img => img.onclick = () => lightbox(img.dataset.full));
    } catch (e) { inner.innerHTML = '<div class="sc-handle"></div><div style="color:#d83931;">加载失败：' + esc(e.message) + '</div>'; }
  }

  function lightbox(url) {
    const lb = document.createElement('div');
    lb.className = 'sc-lightbox';
    lb.innerHTML = `<img src="${esc(url)}">`;
    lb.onclick = () => lb.remove();
    document.body.appendChild(lb);
  }

  // 前端压缩：把图片缩到最长边 1280、jpeg 0.7，控制在 ~300KB
  function compress(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        const max = 1280;
        if (width > max || height > max) {
          if (width > height) { height = Math.round(height * max / width); width = max; }
          else { width = Math.round(width * max / height); height = max; }
        }
        const cv = document.createElement('canvas');
        cv.width = width; cv.height = height;
        cv.getContext('2d').drawImage(img, 0, 0, width, height);
        cv.toBlob(b => b ? resolve(new File([b], (file.name || 'photo').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })) : reject(new Error('压缩失败')), 'image/jpeg', 0.7);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
      img.src = url;
    });
  }

  function openForm(mode, ctx) {
    ctx = ctx || {};
    const titles = { create: '新建客户（首次到店）', visit: '记录本次到店', reinvite: '再次邀约' };
    let fields = '';
    if (mode === 'create') {
      fields = `<div class="sc-fld"><label>客户姓名 *</label><input id="f_name" placeholder="必填"></div>
        <div class="sc-fld"><label>手机号</label><input id="f_phone" inputmode="numeric" placeholder="强烈建议填"></div>`;
    } else {
      fields = `<div class="sc-fld"><label>客户</label><input id="f_name" value="${esc(ctx.name || '')}" readonly style="background:#f7f8fa">
        <input type="hidden" id="f_phone" value="${esc(ctx.phone || '')}"></div>`;
    }
    let needPhoto = false;
    if (mode === 'reinvite') {
      fields += `<div class="sc-fld"><label>预约到店时间 *</label><input id="f_arrive" type="datetime-local"></div>
        <div class="sc-fld"><label>备注</label><input id="f_remark" placeholder="如：复购面部护理"></div>`;
    } else {
      needPhoto = true;
      fields += `
        <div class="sc-fld"><label>是否操作</label><select id="f_op"><option value="是">是</option><option value="否">否</option></select></div>
        <div class="sc-fld"><label>操作金额</label><input id="f_opamt" type="number" step="0.01" value="0">
          <label style="font-size:12px;color:#8a9099;display:flex;align-items:center;gap:4px;margin-top:4px"><input type="checkbox" id="f_opamt_neg" style="width:14px;height:14px"> 退款（记为负数扣减营业额）</label>
        </div>
        <div class="sc-fld"><label>是否成交</label><select id="f_close"><option value="否">否</option><option value="是">是</option></select></div>
        <div class="sc-fld"><label>成交金额</label><input id="f_closeamt" type="number" step="0.01" value="0">
          <label style="font-size:12px;color:#8a9099;display:flex;align-items:center;gap:4px;margin-top:4px"><input type="checkbox" id="f_closeamt_neg" style="width:14px;height:14px"> 退款（记为负数扣减营业额）</label>
        </div>
        <div class="sc-fld"><label>操作人</label><input id="f_performer" placeholder="选填"></div>
        <div class="sc-fld"><label>备注</label><input id="f_remark" placeholder="选填"></div>
        <div class="sc-fld"><label>操作照片 *（操作前/后对比，必传）</label>
          <div class="sc-photo-area" id="f_photo_area">📷 点击拍照 / 选择照片<br><span style="font-size:12px;">支持多张，自动压缩</span></div>
          <input type="file" id="f_photo_input" accept="image/*" capture="environment" multiple style="display:none;">
          <div class="sc-prev" id="f_photo_prev"></div>
        </div>`;
    }
    const wrap = document.createElement('div');
    wrap.className = 'sc-modal-bg';
    wrap.innerHTML = `<div class="sc-modal"><div class="sc-handle"></div><div style="font-weight:600;font-size:16px;margin-bottom:14px;">${titles[mode]}</div>${fields}
      <div class="sc-actions"><button class="btn" id="f_cancel">取消</button><button class="btn btn-primary" id="f_ok">保存</button></div></div>`;
    $('scModalHost').appendChild(wrap);
    wrap.onclick = e => { if (e.target === wrap) wrap.remove(); };
    wrap.querySelector('#f_cancel').onclick = () => wrap.remove();

    // 照片选择 + 压缩 + 预览
    let pickedFiles = [];
    if (needPhoto) {
      const area = wrap.querySelector('#f_photo_area');
      const input = wrap.querySelector('#f_photo_input');
      const prev = wrap.querySelector('#f_photo_prev');
      area.onclick = () => input.click();
      input.onchange = async () => {
        for (const f of Array.from(input.files)) {
          if (pickedFiles.length >= 12) break;
          try {
            const c = await compress(f);
            pickedFiles.push(c);
            const item = document.createElement('div');
            item.className = 'sc-prev-item';
            const u = URL.createObjectURL(c);
            item.innerHTML = `<img src="${u}"><button class="sc-prev-del">×</button>`;
            item.querySelector('.sc-prev-del').onclick = () => { pickedFiles = pickedFiles.filter(x => x !== c); item.remove(); area.classList.toggle('has', pickedFiles.length > 0); };
            prev.appendChild(item);
          } catch (e) { alert('照片处理失败：' + e.message); }
        }
        input.value = '';
        area.classList.toggle('has', pickedFiles.length > 0);
      };
    }

    wrap.querySelector('#f_ok').onclick = async () => {
      const g = id => { const el = wrap.querySelector('#' + id); return el ? el.value : ''; };
      const okBtn = wrap.querySelector('#f_ok');
      if (mode === 'create' && !g('f_name')) { alert('请填写客户姓名'); return; }
      if (mode === 'reinvite' && !g('f_arrive')) { alert('请选择预约到店时间'); return; }
      if (needPhoto && pickedFiles.length === 0) { alert('请至少上传一张操作照片'); return; }

      okBtn.disabled = true; okBtn.textContent = '保存中…';
      try {
        // 1) 先传照片
        let photoUrls = [];
        if (needPhoto && pickedFiles.length) {
          okBtn.textContent = '上传照片…';
          const fd = new FormData();
          pickedFiles.forEach(f => fd.append('photos', f));
          const up = await fetch('/api/customer/photo-upload', { method: 'POST', body: fd }).then(r => r.json());
          if (!up.ok) throw new Error(up.error || '照片上传失败');
          photoUrls = up.urls || [];
        }
        // 2) 提交记录
        okBtn.textContent = '保存中…';
        const body = { name: g('f_name'), phone: g('f_phone') };
        let url;
        if (mode === 'reinvite') {
          url = '/api/customer/store-reinvite'; body.arriveTime = g('f_arrive'); body.remark = g('f_remark');
        } else {
          url = mode === 'create' ? '/api/customer/store-create' : '/api/customer/store-visit';
          body.customerType = mode === 'create' ? '新客' : '老客';
          body.isOperated = g('f_op');
          body.opAmount = (wrap.querySelector('#f_opamt_neg').checked ? -1 : 1) * Math.abs(+g('f_opamt') || 0);
          body.isClosed = g('f_close');
          body.closedAmount = (wrap.querySelector('#f_closeamt_neg').checked ? -1 : 1) * Math.abs(+g('f_closeamt') || 0);
          body.performer = g('f_performer'); body.remark = g('f_remark');
          body.photos = photoUrls;
        }
        const r = await api.post(url, body);
        if (!r.ok) throw new Error(r.error || '保存失败');
        wrap.remove();
        closeDrawer();
        // 排客成功后跳转到"我的排客"（待到店）
        if (mode === 'reinvite') {
          alert('排客登记成功，即将跳转到"我的排客"');
          window.location.hash = '#pending';
        } else {
          await loadList($('scSearch').value);
          alert('已保存');
        }
      } catch (e) { alert('保存失败：' + e.message); okBtn.disabled = false; okBtn.textContent = '保存'; }
    };
  }
};
