// ===== 排客容量看板前端渲染模块 =====

window.render_store_slotCalendar = async function (page) {
  const u = V6.user;
  page.innerHTML = '<div class="loading">加载排客看板...</div>';

  try {
    const r = await fetch('/api/slot/calendar').then(r => r.json());
    if (!r.ok) {
      page.innerHTML = `<div class="card"><p class="muted">加载失败：${r.error || ''}</p></div>`;
      return;
    }

    const { storeName, maxPerSlot, slotConfig, dates, calendarData } = r;

    page.innerHTML = `
      <div class="slot-calendar">
        <div class="calendar-header">
          <div class="calendar-title">
            排客容量看板<span>${storeName}</span>
          </div>
          <div style="display: flex; gap: 12px; align-items: center;">
            <div class="capacity-badge">容量上限: ${maxPerSlot}人/时段</div>
            <button class="refresh-btn" onclick="refreshSlotCalendar()">🔄 刷新</button>
          </div>
        </div>

        <div class="calendar-grid">
          <!-- 时间列 -->
          <div class="time-column">
            ${generateTimeColumn()}
          </div>

          <!-- 3天日历列 -->
          ${calendarData.map((day, idx) => generateDayColumn(day, idx, dates, maxPerSlot)).join('')}
        </div>

        <!-- 容量说明 -->
        <div style="font-size: 12px; color: var(--ink-mute); margin-top: 16px; display: flex; gap: 24px; align-items: center;">
          <span>💡 新客占用${slotConfig.newCustomerMinutes}分钟，老客占用${slotConfig.oldCustomerMinutes}分钟</span>
          <span style="display: flex; gap: 8px; align-items: center;">
            <span style="width: 12px; height: 12px; background: var(--silver-bg); border: 1px dashed var(--silver); border-radius: 2px;"></span>
            <span>空闲</span>
            <span style="width: 12px; height: 12px; background: var(--klein-soft); border: 1px solid var(--klein); border-radius: 2px;"></span>
            <span>部分占用</span>
            <span style="width: 12px; height: 12px; background: var(--danger); border-radius: 2px;"></span>
            <span>满员</span>
          </span>
        </div>
      </div>

      <!-- 快速排客浮动按钮 -->
      <button class="quick-add-btn" onclick="openQuickAddSlot()">+ 快速排客</button>
    `;

    // 注入样式（如果页面没有）
    if (!document.getElementById('slotCalendarStyles')) {
      const style = document.createElement('style');
      style.id = 'slotCalendarStyles';
      style.textContent = `
        .slot-calendar {
          background: var(--paper);
          border-radius: 8px;
          padding: 24px;
          margin: 20px auto;
          max-width: 1200px;
          box-shadow: var(--shadow-lg);
        }
        .calendar-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
          padding-bottom: 16px;
          border-bottom: 1px solid var(--silver-soft);
        }
        .calendar-title {
          font-size: 18px;
          font-weight: 600;
          color: var(--ink);
        }
        .calendar-title span {
          color: var(--klein);
          margin-left: 8px;
        }
        .capacity-badge {
          background: var(--klein-soft);
          color: var(--klein);
          padding: 6px 12px;
          border-radius: 4px;
          font-size: 13px;
          font-weight: 500;
        }
        .calendar-grid {
          display: grid;
          grid-template-columns: 80px repeat(3, 1fr);
          gap: 16px;
          margin-bottom: 20px;
        }
        .time-column {
          font-size: 12px;
          color: var(--ink-mute);
          text-align: right;
          padding-right: 12px;
          line-height: 32px;
          display: flex;
          flex-direction: column;
          justify-content: space-around;
        }
        .day-column {
          border: 1px solid var(--silver-soft);
          border-radius: 4px;
          min-height: 700px;
          position: relative;
          overflow: hidden;
        }
        .day-header {
          padding: 12px 16px;
          font-size: 14px;
          font-weight: 500;
          text-align: center;
          color: var(--paper);
        }
        .day-header.today {
          background: var(--klein);
        }
        .day-header.tomorrow {
          background: var(--silver);
          color: var(--ink);
        }
        .day-header.after_tomorrow {
          background: var(--ink-mute);
        }
        .slots-container {
          position: relative;
          height: 100%;
          padding: 8px 4px;
        }
        .slot-item {
          position: absolute;
          left: 4px;
          right: 4px;
          border-radius: 3px;
          cursor: pointer;
          transition: all 0.15s ease;
          font-size: 12px;
          padding: 4px 8px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          min-height: 32px;
        }
        .slot-empty {
          background: var(--silver-bg);
          border: 1px dashed var(--silver);
          color: var(--ink-mute);
        }
        .slot-empty:hover {
          background: var(--klein-soft);
          border-color: var(--klein);
          color: var(--klein);
        }
        .slot-partial {
          background: var(--klein-soft);
          border: 1px solid var(--klein);
          color: var(--klein);
        }
        .slot-partial:hover {
          background: var(--klein);
          color: var(--paper);
        }
        .slot-full {
          background: var(--danger);
          color: var(--paper);
          cursor: not-allowed;
        }
        .customer-tag {
          display: inline-block;
          padding: 2px 6px;
          border-radius: 2px;
          font-size: 11px;
          margin-right: 4px;
          white-space: nowrap;
        }
        .customer-tag.new {
          background: var(--info);
          color: var(--paper);
        }
        .customer-tag.old {
          background: var(--success);
          color: var(--paper);
        }
        .customer-name {
          font-weight: 500;
          margin-left: 4px;
        }
        .slot-count {
          font-weight: 600;
          font-size: 13px;
        }
        .quick-add-btn {
          position: fixed;
          bottom: 30px;
          right: 30px;
          background: var(--klein);
          color: var(--paper);
          padding: 14px 24px;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          box-shadow: var(--shadow-lg);
          transition: all 0.15s ease;
          border: none;
        }
        .quick-add-btn:hover {
          background: var(--klein-deep);
          transform: translateY(-2px);
        }
        .refresh-btn {
          background: var(--paper);
          border: 1px solid var(--silver);
          color: var(--ink-soft);
          padding: 6px 12px;
          border-radius: 4px;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .refresh-btn:hover {
          border-color: var(--klein);
          color: var(--klein);
        }
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0,0,0,0.5);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 1000;
        }
        .modal-content {
          background: var(--paper);
          border-radius: 8px;
          padding: 24px;
          width: 400px;
          max-width: 90%;
          box-shadow: var(--shadow-lg);
        }
        .modal-header {
          font-size: 18px;
          font-weight: 600;
          color: var(--ink);
          margin-bottom: 20px;
        }
        .form-group {
          margin-bottom: 16px;
        }
        .form-label {
          display: block;
          font-size: 13px;
          color: var(--ink-soft);
          margin-bottom: 6px;
        }
        .form-input, .form-select {
          width: 100%;
          padding: 10px 12px;
          border: 1px solid var(--silver);
          border-radius: 4px;
          font-size: 14px;
          background: var(--paper);
          color: var(--ink);
        }
        .form-input:focus, .form-select:focus {
          border-color: var(--klein);
          outline: none;
        }
        .btn-group {
          display: flex;
          gap: 12px;
          margin-top: 20px;
        }
        .btn-primary {
          background: var(--klein);
          color: var(--paper);
          padding: 10px 16px;
          border-radius: 4px;
          border: none;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
        }
        .btn-primary:hover {
          background: var(--klein-deep);
        }
        .btn-secondary {
          background: var(--silver-bg);
          color: var(--ink);
          padding: 10px 16px;
          border-radius: 4px;
          border: 1px solid var(--silver);
          cursor: pointer;
          font-size: 14px;
        }
        .btn-secondary:hover {
          background: var(--silver-soft);
        }
      `;
      document.head.appendChild(style);
    }

  } catch (e) {
    page.innerHTML = `<div class="card"><p class="muted">加载失败：${e.message || ''}</p></div>`;
  }
};

// 生成时间列（10:00-20:00）
function generateTimeColumn() {
  const times = [];
  for (let hour = 10; hour <= 20; hour++) {
    times.push(`<div>${String(hour).padStart(2, '0')}:00</div>`);
    if (hour < 20) {
      times.push(`<div>${String(hour).padStart(2, '0')}:30</div>`);
    }
  }
  return times.join('');
}

// 生成单日列
function generateDayColumn(day, idx, dates, maxPerSlot) {
  const dayLabels = ['今天', '明天', '后天'];
  const headerClasses = ['today', 'tomorrow', 'after_tomorrow'];

  const d = new Date(dates[idx]);
  const dayName = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  const dateStr = dates[idx].slice(5); // MM/DD

  // 计算槽高度（每半小时32px）
  const slotHeight = 32;
  const totalSlots = 21; // 10:00-20:00共21个槽

  // 渲染所有槽（包括空闲和占用）
  const slotsHtml = day.slots.map((slot, slotIdx) => {
    const top = slotIdx * slotHeight;
    const height = slotHeight;

    if (slot.isEmpty) {
      // 空闲槽
      const timeVal = dates[idx] + 'T' + slot.time;
      return `
        <div class="slot-item slot-empty" style="top: ${top}px; height: ${height}px;" onclick="openQuickAddSlot('${timeVal}')">
          <span class="slot-count">0/${maxPerSlot}</span>
          <span>空闲 · 点击排客</span>
        </div>`;
    } else if (slot.isFull) {
      // 满员槽
      const customerHtml = slot.customers.map(c =>
        `<span class="customer-tag ${c.type}">${c.type === 'new' ? '新客' : '老客'}</span><span class="customer-name">${c.name}</span>`
      ).join('');
      return `
        <div class="slot-item slot-full" style="top: ${top}px; height: ${height}px;">
          <div>${customerHtml}</div>
          <span class="slot-count">${slot.occupancy}/${maxPerSlot}</span>
        </div>`;
    } else {
      // 部分占用槽
      const customerHtml = slot.customers.map(c =>
        `<span class="customer-tag ${c.type}">${c.type === 'new' ? '新客' : '老客'}</span><span class="customer-name">${c.name}</span>`
      ).join('');
      return `
        <div class="slot-item slot-partial" style="top: ${top}px; height: ${height}px;" onclick="showSlotDetail('${slot.time}', '${dates[idx]}')">
          <div>${customerHtml}</div>
          <span class="slot-count">${slot.occupancy}/${maxPerSlot}</span>
        </div>`;
    }
  }).join('');

  return `
    <div class="day-column">
      <div class="day-header ${headerClasses[idx]}">${dayLabels[idx]} ${dateStr}${idx === 2 ? ' (' + dayName + ')' : ''}</div>
      <div class="slots-container">
        ${slotsHtml}
      </div>
    </div>`;
}

// 快速排客弹窗
window.openQuickAddSlot = function(time = null) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">快速排客</div>
      <div class="form-group">
        <label class="form-label">预约时间</label>
        <input type="datetime-local" class="form-input" id="slotArriveTime" value="${time || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">客户姓名</label>
        <input type="text" class="form-input" id="slotCustomerName" placeholder="输入客户姓名">
      </div>
      <div class="form-group">
        <label class="form-label">联系电话</label>
        <input type="text" class="form-input" id="slotPhone" placeholder="输入联系电话">
      </div>
      <div class="form-group">
        <label class="form-label">客户类型</label>
        <select class="form-select" id="slotCustomerType">
          <option value="new">新客（占用1小时）</option>
          <option value="old">老客（占用30分钟）</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">备注</label>
        <input type="text" class="form-input" id="slotRemark" placeholder="可选备注">
      </div>
      <div class="btn-group">
        <button class="btn-secondary" onclick="closeSlotModal()">取消</button>
        <button class="btn-primary" onclick="submitSlotInvite()">提交排客</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.style.display = 'flex';
  modal.onclick = (e) => { if (e.target === modal) closeSlotModal(); };
};

window.closeSlotModal = function() {
  const modal = document.querySelector('.modal-overlay');
  if (modal) modal.remove();
};

window.submitSlotInvite = async function() {
  const arriveTime = document.getElementById('slotArriveTime').value;
  const customerName = document.getElementById('slotCustomerName').value.trim();
  const phone = document.getElementById('slotPhone').value.trim();
  const customerType = document.getElementById('slotCustomerType').value;
  const remark = document.getElementById('slotRemark').value.trim();

  if (!arriveTime || !customerName || !phone) {
    alert('请填写客户姓名、电话和预约时间');
    return;
  }

  try {
    const r = await fetch('/api/customer/store-reinvite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        arriveTime,
        customerName,
        phone,
        customerType,
        remark,
        source: '排客看板-快速排客',
      })
    }).then(r => r.json());

    if (!r.ok) {
      if (r.suggestTime) {
        alert('时段已满，建议预约时间：' + r.suggestTime.replace('T', ' '));
      } else {
        alert('提交失败：' + (r.error || ''));
      }
      return;
    }

    alert('排客成功！');
    closeSlotModal();
    refreshSlotCalendar();

  } catch (e) {
    alert('网络错误：' + e.message);
  }
};

// 刷新看板
window.refreshSlotCalendar = async function() {
  await render_store_slotCalendar(document.getElementById('page'));
};

// 显示时段详情（待实现）
window.showSlotDetail = function(time, date) {
  alert('时段详情功能待实现：' + date + ' ' + time);
};

console.log('[v6-modules/slotcalendar] loaded');