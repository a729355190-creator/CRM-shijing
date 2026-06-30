// ============================================================
// 客户中心 阶段3-修正：按"客户的最高事件阶段"重算 stage（幂等）
// 阶段优先级：repurchase > dealt > arrived > scheduled > deposit > lead
// 取每个客户事件中最高级别 + 是否有手机号(deposit) 综合判定
// ============================================================
const Database = require('better-sqlite3');
const db = new Database('/opt/shijing-v6/db/shijing.db');
const log = (...a) => console.log('[migrate-04]', ...a);

// 事件类型 → 阶段等级
const EVENT_RANK = { added: 0, chat: 0, deposit: 1, scheduled: 2, arrived: 3, no_show: 2, dealt: 4, repurchase: 5, lost: -1 };
const STAGE_BY_RANK = { 0: 'lead', 1: 'deposit', 2: 'scheduled', 3: 'arrived', 4: 'dealt', 5: 'repurchase' };

let changed = 0;
db.exec('BEGIN');
try {
  // 计算每个客户的最高事件等级
  const rows = db.prepare(`
    SELECT external_userid, type FROM shijing_customer_events
  `).all();
  const maxRank = {};
  for (const r of rows) {
    const rk = EVENT_RANK[r.type];
    if (rk === undefined) continue;
    if (maxRank[r.external_userid] === undefined || rk > maxRank[r.external_userid]) {
      maxRank[r.external_userid] = rk;
    }
  }

  const upStage = db.prepare('UPDATE shijing_wecom_customers SET stage=? WHERE external_userid=? AND stage<>?');
  for (const [ext, rk] of Object.entries(maxRank)) {
    if (rk < 0) continue;
    // 有手机号至少 deposit；事件等级与之取高
    const cust = db.prepare('SELECT phone, stage FROM shijing_wecom_customers WHERE external_userid=?').get(ext);
    if (!cust) continue;
    let finalRank = rk;
    if (cust.phone && finalRank < 1) finalRank = 1; // 有手机号至少 deposit
    const newStage = STAGE_BY_RANK[finalRank] || 'lead';
    const r = upStage.run(newStage, ext, newStage);
    if (r.changes) changed++;
  }
  db.exec('COMMIT');
  log('阶段重算完成，更新 ' + changed + ' 个客户');
} catch (e) {
  db.exec('ROLLBACK');
  log('失败已回滚: ' + e.message);
  process.exit(1);
}

log('--- 验收：客户阶段分布 ---');
db.prepare('SELECT stage, COUNT(*) c FROM shijing_wecom_customers GROUP BY stage ORDER BY c DESC').all()
  .forEach(s => log('  ' + s.stage + ': ' + s.c));
db.close();
