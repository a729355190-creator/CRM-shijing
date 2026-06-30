// ============================================================
// 客户中心 阶段3-补：为已回填的 deals 写贡献者(deal_contributors)
// 营收唯一、贡献共享：成交 → 门店服务人(store_deal) + 归属客服(cs_lead)
// 幂等：确定性 id (deal_id + role)
// ============================================================
const Database = require('better-sqlite3');
const db = new Database('/opt/shijing-v6/db/shijing.db');
const log = (...a) => console.log('[migrate-05]', ...a);

// follow_userid → 客服姓名(staff)
const followToName = {};
db.prepare('SELECT wecomUserid, name FROM shijing_staff WHERE wecomUserid IS NOT NULL').all()
  .forEach(s => { followToName[s.wecomUserid] = s.name; });

let added = 0;
const ins = db.prepare(`INSERT OR REPLACE INTO shijing_deal_contributors
  (id, deal_id, contributor, role, created_at) VALUES (?,?,?,?,?)`);
const now = Date.now();

db.exec('BEGIN');
try {
  const deals = db.prepare('SELECT id, external_userid, performer FROM shijing_deals').all();
  for (const d of deals) {
    // 1. 门店服务人(成交环节)
    if (d.performer) {
      ins.run(`dc_${d.id}_store`, d.id, d.performer, 'store_deal', now);
      added++;
    }
    // 2. 归属客服(促单环节)
    const cust = db.prepare('SELECT follow_userid FROM shijing_wecom_customers WHERE external_userid=?').get(d.external_userid);
    if (cust && cust.follow_userid) {
      const csName = followToName[cust.follow_userid] || cust.follow_userid;
      ins.run(`dc_${d.id}_cs`, d.id, csName, 'cs_lead', now);
      added++;
    }
  }
  db.exec('COMMIT');
  log('写入贡献者记录 ' + added + ' 条');
} catch (e) {
  db.exec('ROLLBACK');
  log('失败已回滚: ' + e.message);
  process.exit(1);
}

log('--- 验收 ---');
const byRole = db.prepare('SELECT role, COUNT(*) c FROM shijing_deal_contributors GROUP BY role').all();
log('贡献者分布: ' + byRole.map(x => x.role + ':' + x.c).join(' / '));
// 个人业绩示例：门店服务人成交额(营收口径取deals唯一)
log('--- 门店人员成交贡献(按服务人) ---');
db.prepare(`SELECT dc.contributor, COUNT(DISTINCT dc.deal_id) cnt, SUM(d.amount) amt
  FROM shijing_deal_contributors dc JOIN shijing_deals d ON d.id=dc.deal_id
  WHERE dc.role='store_deal' GROUP BY dc.contributor ORDER BY amt DESC`).all()
  .forEach(r => log('  ' + r.contributor + ': ' + r.cnt + '单 / ¥' + r.amt));
db.close();
