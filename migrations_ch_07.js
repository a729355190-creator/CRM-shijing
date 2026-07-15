// ============================================================
// 客户中心 阶段4：加企微归因字段（打通投手环节的地基）
// 与已有客户中心体系(阶段1~阶段3)完全对齐：只在shijing_wecom_customers上加列，
// 不新建平行表结构。归因数据挂在客户身上后，会自动跟随已有的syncToHub链路
// 流转到customer_events/deals/deal_contributors，不需要在invite/store里重复存。
//
// 字段说明：
//   attribution_state    获客链接customer_channel参数解码出的原始state（企微返回，<=64字节）
//   attribution_channel  state解码后的可读归因短码，比如 "p3_oceanengine_lp01"
//                         （投手编号_媒体_落地页编号，具体编码规则由投放团队定义）
//   attribution_synced_at  该客户归因数据最近一次从企微同步的时间戳
//
// 幂等可重跑，不删任何东西。
// ============================================================
const Database = require('better-sqlite3');
const db = new Database('/opt/shijing-v6/db/shijing.db');
const log = (...a) => console.log('[migrate-07]', ...a);

function addColumn(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (cols.includes(col)) { log(`跳过 ${table}.${col}（已存在）`); return; }
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  log(`加列 ${table}.${col} ${def}`);
}

db.exec('BEGIN');
try {
  addColumn('shijing_wecom_customers', 'attribution_state', 'TEXT');
  addColumn('shijing_wecom_customers', 'attribution_channel', 'TEXT');
  addColumn('shijing_wecom_customers', 'attribution_synced_at', 'INTEGER');

  // invite 表也要能存一份归因快照（用途：客服排客时把当时查到的归因带上，
  // 即使后续客户主档的归因被更新覆盖，这一笔具体邀约当时的归因仍可追溯）。
  // 用独立的映射表而不是改invite的JSON结构，避免影响现有invite读写逻辑。
  db.exec(`CREATE TABLE IF NOT EXISTS shijing_invite_attribution (
    invite_id           TEXT PRIMARY KEY,
    external_userid     TEXT,
    attribution_channel TEXT,
    attribution_state   TEXT,
    createdAt           INTEGER
  )`);
  log('表 shijing_invite_attribution 就绪');

  db.exec(`CREATE INDEX IF NOT EXISTS idx_cust_attrch ON shijing_wecom_customers(attribution_channel)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_invatr_ext ON shijing_invite_attribution(external_userid)`);
  log('索引就绪');

  db.exec('COMMIT');
  log('阶段4 归因字段迁移完成（已提交）');
} catch (e) {
  db.exec('ROLLBACK');
  log('失败已回滚: ' + e.message);
  process.exit(1);
}

log('--- 验收 ---');
const custCols = db.prepare('PRAGMA table_info(shijing_wecom_customers)').all().map(c => c.name);
log('wecom_customers 列: ' + custCols.join(','));
const tbl = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='shijing_invite_attribution'").get();
log('shijing_invite_attribution 表: ' + (tbl ? '存在' : '不存在'));
db.close();
