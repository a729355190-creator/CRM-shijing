// ============================================================
// 客户中心 阶段1-数据建档（幂等可重跑，不删任何东西）
// ============================================================
const Database = require('better-sqlite3');
const db = new Database('/opt/shijing-v6/db/shijing.db');
const log = (...a) => console.log('[migrate-02]', ...a);
const now = Date.now();
const EMPTY = "''"; // SQL 空串字面量

const CITIES = ['长沙','湛江','深圳','广州','上海','北京','成都','武汉','杭州','南京','重庆','西安','惠州','东莞','佛山','珠海','中山','株洲','湘潭','岳阳','常德'];
function parseCity(remark) {
  if (!remark) return null;
  for (const c of CITIES) if (remark.includes(c)) return c;
  return null;
}

let cityCnt = 0, bindBackfill = 0, autoBind = 0, stageUp = 0;

db.exec('BEGIN');
try {
  // 1. 解析 remark 补 source_city
  const custs = db.prepare('SELECT external_userid, remark, source_city FROM shijing_wecom_customers').all();
  const upCity = db.prepare('UPDATE shijing_wecom_customers SET source_city=? WHERE external_userid=?');
  for (const c of custs) {
    if (c.source_city) continue;
    const city = parseCity(c.remark);
    if (city) { upCity.run(city, c.external_userid); cityCnt++; }
  }
  log('解析城市补全 ' + cityCnt + ' 个客户');

  // 2. 用现有 customer_bind 回填主档 phone/real_name
  const binds = db.prepare(`SELECT phone, external_userid, nickname, real_name FROM shijing_customer_bind WHERE external_userid IS NOT NULL AND external_userid <> ${EMPTY}`).all();
  const upPhone = db.prepare(`UPDATE shijing_wecom_customers SET phone=COALESCE(NULLIF(phone,${EMPTY}),?), real_name=COALESCE(NULLIF(real_name,${EMPTY}),?) WHERE external_userid=? AND (phone IS NULL OR phone=${EMPTY})`);
  for (const b of binds) {
    const r = upPhone.run(b.phone || null, b.real_name || null, b.external_userid);
    if (r.changes) bindBackfill++;
  }
  log('从现有归并桥回填 ' + bindBackfill + ' 个客户手机号');

  // 3. invite/store 昵称精确匹配 → 扩展归并桥(auto)
  const rows = [];
  for (const t of ['shijing_invite','shijing_store']) {
    const rs = db.prepare('SELECT data FROM ' + t + ' WHERE deleted=0').all();
    for (const r of rs) {
      try { const d = JSON.parse(r.data); if (d.customerName && d.phone) rows.push({ name: d.customerName, phone: String(d.phone) }); } catch {}
    }
  }
  const nameMap = {}, nameCount = {};
  db.prepare('SELECT external_userid, name FROM shijing_wecom_customers').all().forEach(w => {
    if (!w.name) return;
    nameCount[w.name] = (nameCount[w.name]||0)+1;
    nameMap[w.name] = w.external_userid;
  });
  const existBind = new Set(db.prepare('SELECT phone FROM shijing_customer_bind').all().map(b=>b.phone));
  const insBind = db.prepare('INSERT OR IGNORE INTO shijing_customer_bind (phone, external_userid, nickname, real_name, boundBy, boundAt, bind_status) VALUES (?,?,?,?,?,?,?)');
  const upPhone2 = db.prepare('UPDATE shijing_wecom_customers SET phone=COALESCE(phone,?), real_name=COALESCE(real_name,?) WHERE external_userid=?');
  for (const r of rows) {
    if (existBind.has(r.phone)) continue;
    if (nameCount[r.name] !== 1) continue;
    const ext = nameMap[r.name];
    if (!ext) continue;
    insBind.run(r.phone, ext, r.name, r.name, 'auto-migrate', now, 'auto');
    upPhone2.run(r.phone, r.name, ext);
    existBind.add(r.phone);
    autoBind++;
  }
  log('昵称精确匹配自动归并 ' + autoBind + ' 个(标 auto)');

  // 4. 有手机号客户 stage 升 deposit
  const upStage = db.prepare(`UPDATE shijing_wecom_customers SET stage='deposit' WHERE phone IS NOT NULL AND phone<>${EMPTY} AND stage='lead'`);
  stageUp = upStage.run().changes;
  log(stageUp + ' 个有手机号客户 stage lead->deposit');

  db.exec('COMMIT');
  log('阶段1 数据建档完成（已提交）');
} catch (e) {
  db.exec('ROLLBACK');
  log('失败已回滚: ' + e.message);
  process.exit(1);
}

log('--- 验收 ---');
const q = (sql) => db.prepare(sql).get().c;
log('客户总数: ' + q('SELECT COUNT(*) c FROM shijing_wecom_customers'));
log('有来源城市: ' + q('SELECT COUNT(*) c FROM shijing_wecom_customers WHERE source_city IS NOT NULL'));
log('有手机号(已归并): ' + q(`SELECT COUNT(*) c FROM shijing_wecom_customers WHERE phone IS NOT NULL AND phone<>${EMPTY}`));
log('归并桥记录: ' + q('SELECT COUNT(*) c FROM shijing_customer_bind'));
const stageDist = db.prepare('SELECT stage, COUNT(*) c FROM shijing_wecom_customers GROUP BY stage').all();
log('阶段分布: ' + stageDist.map(s=>s.stage+':'+s.c).join(' / '));
db.close();
