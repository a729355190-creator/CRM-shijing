// ============================================================
// 客户中心 阶段3-增强：用 invite/store 自带的 external_userid 做高可信归并
// 这些是之前版本排客时客服手动选企微好友存下的，准确度最高
// 然后重跑事件流回填(03)+阶段重算(04)+贡献者(05) 由调用方依次执行
// ============================================================
const Database = require('better-sqlite3');
const db = new Database('/opt/shijing-v6/db/shijing.db');
const log = (...a) => console.log('[migrate-06]', ...a);
const now = Date.now();

let bindAdd = 0, phoneBackfill = 0;
const existBindPhone = new Set(db.prepare('SELECT phone FROM shijing_customer_bind').all().map(b => b.phone));
const insBind = db.prepare(`INSERT OR REPLACE INTO shijing_customer_bind
  (phone, external_userid, nickname, real_name, boundBy, boundAt, bind_status) VALUES (?,?,?,?,?,?,?)`);
const upCust = db.prepare(`UPDATE shijing_wecom_customers
  SET phone=COALESCE(NULLIF(phone,''),?), real_name=COALESCE(NULLIF(real_name,''),?)
  WHERE external_userid=?`);

db.exec('BEGIN');
try {
  // 从 invite 和 store 收集自带 external_userid 的 (phone, ext, name)
  const pairs = [];
  for (const t of ['shijing_invite', 'shijing_store']) {
    db.prepare(`SELECT data FROM ${t} WHERE deleted=0`).all().forEach(r => {
      try {
        const d = JSON.parse(r.data);
        if (d.external_userid && d.phone) {
          pairs.push({ phone: String(d.phone), ext: d.external_userid, name: d.customerName || d.wechatNickname || '' });
        }
      } catch {}
    });
  }
  log('收集到自带ext的记录: ' + pairs.length);

  for (const p of pairs) {
    // 写绑定桥（high confidence，标 confirmed）
    insBind.run(p.phone, p.ext, p.name, p.name, 'invite-ext', now, 'confirmed');
    if (!existBindPhone.has(p.phone)) { bindAdd++; existBindPhone.add(p.phone); }
    // 回填客户主档手机号/真名
    const r = upCust.run(p.phone, p.name, p.ext);
    if (r.changes) phoneBackfill++;
  }
  db.exec('COMMIT');
  log('绑定桥新增/更新 ' + pairs.length + ' (其中新phone ' + bindAdd + ')，客户主档回填 ' + phoneBackfill);
} catch (e) {
  db.exec('ROLLBACK');
  log('失败已回滚: ' + e.message);
  process.exit(1);
}

log('--- 验收 ---');
const q = (s) => db.prepare(s).get().c;
log('customer_bind 总数: ' + q('SELECT COUNT(*) c FROM shijing_customer_bind'));
log('客户主档有手机号: ' + q("SELECT COUNT(*) c FROM shijing_wecom_customers WHERE phone IS NOT NULL AND phone<>''"));
db.close();
