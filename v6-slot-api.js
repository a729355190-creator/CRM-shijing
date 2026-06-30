/**
 * V6 预约容量校验接口模块（插件式）
 *
 * 提供接口：
 * - POST /api/check-slot  校验时段容量
 * - POST /api/hq/slot-config  HQ配置门店容量（仅HQ权限）
 */

const slotCheck = require('./v6-slot-check');

module.exports = function(app, db, { getConfig, setConfig, v6Required, v6HQRequired }) {

  // ========== 校验时段容量接口 ==========

  /**
   * POST /api/check-slot
   * 校验时段容量，返回推荐时段
   *
   * 请求参数：
   * - storeTeamId: 门店ID
   * - arriveTime: ISO格式时间 'YYYY-MM-DDTHH:MM'
   * - customerType: 'new' 或 'old'
   *
   * 响应：
   * - available: 是否有空位
   * - peakOccupancy: 峰值占用人数
   * - maxPerSlot: 门店容量上限
   * - recommendations: 推荐时段列表
   * - message: 提示信息
   */
  app.post('/api/check-slot', v6Required, async (req, res) => {
    try {
      const { storeTeamId, arriveTime, customerType } = req.body;

      // 参数校验
      if (!storeTeamId || !arriveTime || !customerType) {
        return res.json({ ok: false, error: '参数缺失' });
      }

      if (customerType !== 'new' && customerType !== 'old') {
        return res.json({ ok: false, error: 'customerType必须是new或old' });
      }

      // 门店权限检查：HQ可以查看所有门店，门店只能查看自己门店
      const u = req.v6User;
      if (u.role !== 'hq' && u.role !== 'cs' && u.teamId !== storeTeamId) {
        return res.json({ ok: false, error: '无权限查看该门店' });
      }

      // 获取配置
      const config = await getConfig();

      // 校验时段容量
      const result = slotCheck.checkSlotCapacity(db, config, storeTeamId, arriveTime, customerType);

      if (result.error) {
        return res.json({ ok: false, error: result.error });
      }

      res.json({
        ok: true,
        ...result
      });

    } catch (e) {
      console.error('[/api/check-slot] error:', e.message);
      res.json({ ok: false, error: e.message });
    }
  });


  // ========== HQ配置门店容量接口 ==========

  /**
   * POST /api/hq/slot-config
   * HQ配置门店容量（仅HQ权限）
   *
   * 请求参数：
   * - teamId: 门店ID
   * - maxPerSlot: 每小时最多接待人数
   * - slotConfig: { newCustomerMinutes, oldCustomerMinutes } (可选)
   */
  app.post('/api/hq/slot-config', v6HQRequired, async (req, res) => {
    try {
      const { teamId, maxPerSlot, slotConfig } = req.body;

      // 参数校验
      if (!teamId || !maxPerSlot) {
        return res.json({ ok: false, error: '参数缺失' });
      }

      if (maxPerSlot < 1 || maxPerSlot > 20) {
        return res.json({ ok: false, error: 'maxPerSlot范围1-20' });
      }

      // 获取配置
      const config = await getConfig();

      // 检查门店是否存在
      if (!config.teams || !config.teams[teamId]) {
        return res.json({ ok: false, error: '门店不存在' });
      }

      if (config.teams[teamId].role !== 'store') {
        return res.json({ ok: false, error: '只能配置门店' });
      }

      // 更新配置
      config.teams[teamId].maxPerSlot = maxPerSlot;
      if (slotConfig) {
        config.teams[teamId].slotConfig = slotConfig;
      }

      // 保存配置
      await setConfig(config);

      res.json({
        ok: true,
        message: `${config.teams[teamId].name}容量配置已更新`
      });

    } catch (e) {
      console.error('[/api/hq/slot-config] error:', e.message);
      res.json({ ok: false, error: e.message });
    }
  });

};

// setConfig需要从外部传入,这里补充定义
async function setConfig(cfg) {
  const newData = JSON.stringify(cfg);
  db.prepare('UPDATE shijing_config SET data = ?, updatedAt = ? WHERE id = ?').run(newData, Date.now(), 'main');
}