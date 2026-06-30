// 排客容量看板接口模块（v6-slot-calendar.js）
// 功能：返回近3天pending状态的排客数据，按时间槽聚合

module.exports = function(app, db, v6Required, getConfig) {
  // 时间解析辅助函数
  function parseTimeToMinutes(isoTime) {
    const hour = parseInt(String(isoTime || '').slice(11, 13));
    const min = parseInt(String(isoTime || '').slice(14, 16));
    return hour * 60 + min;
  }

  // 格式化日期为 YYYY-MM-DD
  function formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // 主接口：返回近3天排客日历数据
  app.get('/api/slot/calendar', v6Required, (req, res) => {
    try {
      const user = req.v6User;
      if (user.role !== 'store') {
        return res.json({ ok: false, error: '仅门店可查看排客看板' });
      }

      const teamId = user.teamId;
      const cfg = getConfig() || {};
      const teams = cfg.teams || {};
      const team = teams[teamId];

      if (!team) {
        return res.json({ ok: false, error: '门店不存在' });
      }

      const maxPerSlot = team.maxPerSlot || 3;
      const slotConfig = team.slotConfig || { newCustomerMinutes: 60, oldCustomerMinutes: 30 };
      const storeName = team.name || teamId;

      // 计算近3天日期范围
      const today = new Date();
      const dates = [];
      for (let i = 0; i < 3; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        dates.push(formatDate(d));
      }

      // 查询pending状态的排客记录（近3天）
      const rows = db.prepare(`
        SELECT data FROM shijing_invite
        WHERE deleted=0
          AND json_extract(data, '$.status')='pending'
          AND json_extract(data, '$.storeTeamId')=?
      `).all(teamId);

      const invites = rows.map(r => JSON.parse(r.data));

      // 按日期分组，构建时间槽占用数据
      const calendarData = dates.map(date => {
        const dayInvites = invites.filter(inv =>
          String(inv.arriveTime).slice(0, 10) === date
        );

        // 构建时间槽（10:00-20:00，半小时一格）
        const slots = [];
        for (let hour = 10; hour <= 20; hour++) {
          for (let half = 0; half <= 30; half += 30) {
            const timeStr = `${String(hour).padStart(2, '0')}:${String(half).padStart(2, '0')}`;
            const slotStart = hour * 60 + half;
            const slotEnd = slotStart + 30;

            // 计算该时间槽的占用峰值
            const intervals = [];
            for (const inv of dayInvites) {
              const invType = inv.customerType || 'new';
              const invDuration = invType === 'new' ? slotConfig.newCustomerMinutes : slotConfig.oldCustomerMinutes;
              const invStart = parseTimeToMinutes(inv.arriveTime);
              const invEnd = invStart + invDuration;

              // 检查是否与当前槽重叠
              if (invStart < slotEnd && invEnd > slotStart) {
                intervals.push({
                  start: invStart,
                  end: invEnd,
                  customerName: inv.customerName,
                  customerType: invType,
                  id: inv.id,
                });
              }
            }

            // 计算峰值占用人数（扫描线算法）
            const points = [];
            for (const interval of intervals) {
              points.push({ time: Math.max(interval.start, slotStart), type: 'start' });
              points.push({ time: Math.min(interval.end, slotEnd), type: 'end' });
            }
            points.sort((a, b) => a.time - b.time || (a.type === 'end' ? -1 : 1));

            let current = 0, peak = 0;
            for (const p of points) {
              if (p.type === 'start') current++;
              else current--;
              peak = Math.max(peak, current);
            }

            slots.push({
              time: timeStr,
              occupancy: peak,
              maxPerSlot,
              customers: intervals.map(i => ({
                name: i.customerName,
                type: i.customerType,
                id: i.id,
              })),
              isFull: peak >= maxPerSlot,
              isEmpty: peak === 0,
            });
          }
        }

        return {
          date,
          slots,
          maxPerSlot,
          slotConfig,
        };
      });

      res.json({
        ok: true,
        storeName,
        teamId,
        maxPerSlot,
        slotConfig,
        dates,
        calendarData,
      });

    } catch (e) {
      console.error('[slot/calendar] error:', e);
      res.json({ ok: false, error: e.message || String(e) });
    }
  });

  console.log('[v6-slot-calendar] mounted: /api/slot/calendar');
};