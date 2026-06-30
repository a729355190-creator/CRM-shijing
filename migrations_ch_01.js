// ============================================================
// 客户中心 阶段1：建表 + 补字段 + 建索引（只增不改，幂等可重跑）
// ============================================================
const Database = require('better-sqlite3');
const db = new Database('/opt/shijing-v6/db/shijing.db');

const log = (...a) => console.log('[migrate-01]', ...a);

// 工具：安全加列（列已存在则跳过）
function addColumn(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (cols.includes(col)) { log(`跳过 ${table}.${col}（已存在）`); return; }
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  log(`✅ 加列 ${table}.${col} ${def}`);
}

db.exec('BEGIN');
try {
  // ---------- 1. 主表 wecom_customers 补字段 ----------
  addColumn('shijing_wecom_customers', 'real_name', 'TEXT');
  addColumn('shijing_wecom_customers', 'phone', 'TEXT');
  addColumn('shijing_wecom_customers', 'source_city', 'TEXT');
  addColumn('shijing_wecom_customers', 'stage', "TEXT DEFAULT 'lead'");
  addColumn('shijing_wecom_customers', 'store_id', 'TEXT');

  // ---------- 2. 归并桥 customer_bind 扩展 ----------
  addColumn('shijing_customer_bind', 'real_name', 'TEXT');
  addColumn('shijing_customer_bind', 'bind_status', "TEXT DEFAULT 'confirmed'");

  // ---------- 3. 事件流表（核心，新建） ----------
  db.exec(`CREATE TABLE IF NOT EXISTS shijing_customer_events (
    id              TEXT PRIMARY KEY,
    external_userid TEXT NOT NULL,
    type            TEXT NOT NULL,
    actor           TEXT,
    source_table    TEXT,
    source_id       TEXT,
    payload         TEXT,
    occurred_at     INTEGER NOT NULL,
    created_at      INTEGER DEFAULT (strftime('%s','now')*1000)
  )`);
  log('✅ 表 shijing_customer_events 就绪');

  // ---------- 4. 成交明细表（支撑复购项目分析） ----------
  db.exec(`CREATE TABLE IF NOT EXISTS shijing_deals (
    id              TEXT PRIMARY KEY,
    external_userid TEXT NOT NULL,
    kind            TEXT,
    project         TEXT,
    amount          INTEGER DEFAULT 0,
    performer       TEXT,
    store_id        TEXT,
    dealt_at        INTEGER,
    source_table    TEXT,
    source_id       TEXT,
    created_at      INTEGER DEFAULT (strftime('%s','now')*1000)
  )`);
  log('✅ 表 shijing_deals 就绪');

  // ---------- 5. 贡献者关联表（营收唯一、贡献共享） ----------
  db.exec(`CREATE TABLE IF NOT EXISTS shijing_deal_contributors (
    id          TEXT PRIMARY KEY,
    deal_id     TEXT NOT NULL,
    contributor TEXT NOT NULL,
    role        TEXT,
    created_at  INTEGER DEFAULT (strftime('%s','now')*1000)
  )`);
  log('✅ 表 shijing_deal_contributors 就绪');

  // ---------- 6. 索引 ----------
  const idx = [
    'CREATE INDEX IF NOT EXISTS idx_events_customer ON shijing_customer_events(external_userid, occurred_at)',
    'CREATE INDEX IF NOT EXISTS idx_events_type ON shijing_customer_events(type, occurred_at)',
    'CREATE INDEX IF NOT EXISTS idx_deals_customer ON shijing_deals(external_userid, dealt_at)',
    'CREATE INDEX IF NOT EXISTS idx_deals_perf ON shijing_deals(performer)',
    'CREATE INDEX IF NOT EXISTS idx_dealcontrib ON shijing_deal_contributors(contributor, deal_id)',
    'CREATE INDEX IF NOT EXISTS idx_cust_follow ON shijing_wecom_customers(follow_userid)',
    'CREATE INDEX IF NOT EXISTS idx_cust_phone ON shijing_wecom_customers(phone)',
    'CREATE INDEX IF NOT EXISTS idx_cust_stage ON shijing_wecom_customers(stage)',
    'CREATE INDEX IF NOT EXISTS idx_cust_store ON shijing_wecom_customers(store_id)',
    'CREATE INDEX IF NOT EXISTS idx_bind_phone ON shijing_customer_bind(phone)',
    'CREATE INDEX IF NOT EXISTS idx_bind_ext ON shijing_customer_bind(external_userid)',
  ];
  idx.forEach(s => db.exec(s));
  log(`✅ 建立 ${idx.length} 个索引`);

  db.exec('COMMIT');
  log('🎉 阶段1 建表迁移完成（已提交）');
} catch (e) {
  db.exec('ROLLBACK');
  log('❌ 失败已回滚:', e.message);
  process.exit(1);
}

// ---------- 验收 ----------
log('--- 验收：新表与列 ---');
['shijing_customer_events','shijing_deals','shijing_deal_contributors'].forEach(t => {
  const n = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
  log(`  ${t}: 存在, 当前 ${n} 行`);
});
const custCols = db.prepare('PRAGMA table_info(shijing_wecom_customers)').all().map(c=>c.name);
log('  wecom_customers 列:', custCols.join(','));
db.close();
