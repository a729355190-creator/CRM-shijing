/**
 * V6 预约容量校验模块
 * 核心功能：区间重叠检测 + 推荐时段生成
 */

/**
 * 解析ISO时间字符串为分钟数(从当天0点开始)
 * @param {string} isoTime - 'YYYY-MM-DDTHH:MM'
 * @returns {number} 分钟数
 */
function parseTimeToMinutes(isoTime) {
  const hour = parseInt(isoTime.slice(11, 13));
  const min = parseInt(isoTime.slice(14, 16));
  return hour * 60 + min;
}

/**
 * 分钟数转ISO时间
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @param {number} minutes - 分钟数
 * @returns {string} 'YYYY-MM-DDTHH:MM'
 */
function minutesToISO(dateStr, minutes) {
  const hour = Math.floor(minutes / 60);
  const min = minutes % 60;
  return `${dateStr}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/**
 * 计算区间重叠的峰值人数
 * @param {Array} intervals - [[start1, end1], [start2, end2], ...] (分钟数)
 * @returns {number} 峰值人数
 */
function calculatePeakOccupancy(intervals) {
  if (intervals.length === 0) return 0;

  // 将所有区间端点排序
  const points = [];
  for (const [start, end] of intervals) {
    points.push({ time: start, type: 'start' });
    points.push({ time: end, type: 'end' });
  }
  points.sort((a, b) => a.time - b.time || (a.type === 'start' ? -1 : 1));

  // 计算峰值
  let current = 0, peak = 0;
  for (const p of points) {
    if (p.type === 'start') current++;
    else current--;
    peak = Math.max(peak, current);
  }

  return peak;
}

/**
 * 校验时段容量
 * @param {Object} db - better-sqlite3数据库实例
 * @param {Object} config - 系统配置对象
 * @param {string} storeTeamId - 门店ID
 * @param {string} arriveTime - ISO格式时间 'YYYY-MM-DDTHH:MM'
 * @param {string} customerType - 'new' 或 'old'
 * @returns {Object} { available, peakOccupancy, maxPerSlot, recommendations }
 */
function checkSlotCapacity(db, config, storeTeamId, arriveTime, customerType) {
  // 1. 获取门店配置
  const team = config.teams && config.teams[storeTeamId];
  if (!team) {
    return { available: false, error: '门店不存在' };
  }

  const maxPerSlot = team.maxPerSlot || 1;
  const slotConfig = team.slotConfig || { newCustomerMinutes: 60, oldCustomerMinutes: 30 };

  // 2. 计算新预约的时长(分钟)
  const newDuration = customerType === 'new'
    ? slotConfig.newCustomerMinutes
    : slotConfig.oldCustomerMinutes;

  // 3. 计算新预约的时间区间(分钟数)
  const dateStr = arriveTime.slice(0, 10);
  const newStart = parseTimeToMinutes(arriveTime);
  const newEnd = newStart + newDuration;

  // 4. 查询同一天该门店所有有效预约
  const invites = db.prepare(`
    SELECT data FROM shijing_invite
    WHERE storeTeamId = ?
      AND data LIKE ?
      AND deleted = 0
  `).all(storeTeamId, `%"arriveTime":"${dateStr}%`);

  // 5. 解析所有预约的时间区间
  const intervals = [];
  for (const inv of invites) {
    try {
      const data = JSON.parse(inv.data);
      if (data.status === 'cancelled') continue;  // 排除已取消

      const invStart = parseTimeToMinutes(data.arriveTime);
      const invType = data.customerType || 'new';  // 默认新客
      const invDuration = invType === 'new'
        ? slotConfig.newCustomerMinutes
        : slotConfig.oldCustomerMinutes;
      const invEnd = invStart + invDuration;
      intervals.push([invStart, invEnd]);
    } catch (e) {
      console.error('解析预约数据失败:', e.message);
    }
  }

  // 6. 加入新预约区间
  intervals.push([newStart, newEnd]);

  // 7. 计算峰值占用人数
  const peakOccupancy = calculatePeakOccupancy(intervals);

  // 8. 判断是否有空位
  const available = peakOccupancy <= maxPerSlot;

  // 9. 如果无空位,生成推荐时段
  if (!available) {
    const recommendations = generateRecommendations(db, config, storeTeamId, arriveTime, customerType, dateStr);
    return {
      available: false,
      peakOccupancy,
      maxPerSlot,
      recommendations,
      message: `该时段已满(峰值${peakOccupancy}人,上限${maxPerSlot}人),建议选择以下时间`
    };
  }

  return { available: true, peakOccupancy, maxPerSlot };
}

/**
 * 生成推荐时段
 * @returns {Array} [{ time, remaining }]
 */
function generateRecommendations(db, config, storeTeamId, arriveTime, customerType, dateStr) {
  const recommendations = [];
  const team = config.teams && config.teams[storeTeamId];
  if (!team) return recommendations;

  const maxPerSlot = team.maxPerSlot || 1;
  const slotConfig = team.slotConfig || { newCustomerMinutes: 60, oldCustomerMinutes: 30 };
  const newDuration = customerType === 'new' ? slotConfig.newCustomerMinutes : slotConfig.oldCustomerMinutes;

  // 1. 推荐当天稍晚时段(最多4个)
  const baseHour = parseInt(arriveTime.slice(11, 13));

  for (let h = baseHour + 1; h <= 20 && recommendations.length < 4; h++) {
    for (let m = 0; m <= 45; m += 15) {
      const slot = minutesToISO(dateStr, h * 60 + m);

      // 校验该时段
      const check = checkSlotCapacityWithoutNew(db, config, storeTeamId, slot, newDuration, dateStr, slotConfig);
      if (check.peakOccupancy < maxPerSlot) {
        recommendations.push({
          time: slot,
          remaining: maxPerSlot - check.peakOccupancy
        });
      }
    }
  }

  // 2. 推荐相邻天同一时段(最多2个)
  for (let day = 1; day <= 2 && recommendations.length < 6; day++) {
    const nextDate = addDays(dateStr, day);
    const slot = `${nextDate}T${arriveTime.slice(11)}`;

    const check = checkSlotCapacityWithoutNew(db, config, storeTeamId, slot, newDuration, nextDate, slotConfig);
    if (check.peakOccupancy < maxPerSlot) {
      recommendations.push({
        time: slot,
        remaining: maxPerSlot - check.peakOccupancy
      });
    }
  }

  return recommendations;
}

/**
 * 校验时段容量(不包含新预约本身)
 * 用于生成推荐时段时校验已有预约
 */
function checkSlotCapacityWithoutNew(db, config, storeTeamId, slot, duration, dateStr, slotConfig) {
  // 查询该天已有预约
  const invites = db.prepare(`
    SELECT data FROM shijing_invite
    WHERE storeTeamId = ?
      AND data LIKE ?
      AND deleted = 0
  `).all(storeTeamId, `%"arriveTime":"${dateStr}%`);

  const intervals = [];
  for (const inv of invites) {
    try {
      const data = JSON.parse(inv.data);
      if (data.status === 'cancelled') continue;

      const invStart = parseTimeToMinutes(data.arriveTime);
      const invType = data.customerType || 'new';
      const invDuration = invType === 'new' ? slotConfig.newCustomerMinutes : slotConfig.oldCustomerMinutes;
      intervals.push([invStart, invStart + invDuration]);
    } catch (e) {}
  }

  // 加入待校验时段
  const slotStart = parseTimeToMinutes(slot);
  intervals.push([slotStart, slotStart + duration]);

  const peakOccupancy = calculatePeakOccupancy(intervals);
  const maxPerSlot = (config.teams && config.teams[storeTeamId] && config.teams[storeTeamId].maxPerSlot) || 1;

  return { peakOccupancy, maxPerSlot };
}

/**
 * 增加天数
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @param {number} days - 增加天数
 * @returns {string} 'YYYY-MM-DD'
 */
function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

module.exports = {
  checkSlotCapacity,
  parseTimeToMinutes,
  minutesToISO,
  calculatePeakOccupancy
};