// ============================================================
// 客户中心 阶段3：历史事件流回填（幂等可重跑，旁路生成）
// invite → 排期/到店事件;  store → 到店/成单事件 + deals(记项目金额)
// 关联键：phone → external_userid (经 customer_bind)
// 只回填能匹配到 external_userid 的记录;匹配不上的等阶段2客服补绑后再跑
// 幂等：用确定性 event id (来源表+来源id+类型)，重跑 INSERT OR REPLACE
// ============================================================
const Database = require('better-sqlite3');
const db = new Database('/opt/shijing-v6/db/shijing.db');
const log = (...a) => console.log('[migrate-03]', ...a);

// 手机号 → external_userid
const phoneToExt = {};
db.prepare('SELECT phone, external_userid FROM shijing_customer_bind WHERE external_userid IS NOT NULL').all()
  .forEach(b => { if (b.phone) phoneToExt[String(b.phone)] = b.external_userid; });
log('归并桥手机号映射数: ' + Object.keys(phoneToExt).length);

function tsFromArrive(s) {
  if (!s) return null;
  const t = Date.parse(s.length <= 16 ? s + ':00' : s);
  return isNaN(t) ? null : t;
}

let evScheduled = 0, evArrived = 0, evDeal = 0, dealCnt = 0, skipNoExt = 0;

const insEvent = db.prepare(`INSERT OR REPLACE INTO shijing_customer_events
  (id, external_userid, type, actor, source_table, source_id, payload, occurred_at, created_at)
  VALUES (?,?,?,?,?,?,?,?,?)`);
const insDeal = db.prepare(`INSERT OR REPLACE INTO shijing_deals
  (id, external_userid, kind, project, amount, performer, store_id, dealt_at, source_table, source_id, created_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
const upStage = db.prepare('UPDATE shijing_wecom_customers SET stage=? WHERE external_userid=? AND store_id IS NULL');
const upStoreId = db.prepare('UPDATE shijing_wecom_customers SET store_id=COALESCE(store_id,?) WHERE external_userid=?');

const now = Date.now();
db.exec('BEGIN');
try {
  // ---------- invite → 排期 + 到店事件 ----------
  const invites = db.prepare('SELECT data FROM shijing_invite WHERE deleted=0').all();
  for (const r of invites) {
    let d; try { d = JSON.parse(r.data); } catch { continue; }
    const ext = d.phone ? phoneToExt[String(d.phone)] : null;
    if (!ext) { skipNoExt++; continue; }
    const at = tsFromArrive(d.arriveTime) || d.createdAt || now;
    // 排期事件
    insEvent.run(`ev_inv_sch_${d.id}`, ext, 'scheduled', d.csTeamName || d.csTeamId || '', 'shijing_invite', d.id,
      JSON.stringify({ storeTeamId: d.storeTeamId, remark: d.remark }), d.createdAt || at, now);
    evScheduled++;
    // 到店事件(status=arrived)
    if (d.status === 'arrived') {
      insEvent.run(`ev_inv_arr_${d.id}`, ext, 'arrived', d.storeTeamId || '', 'shijing_invite', d.id,
        JSON.stringify({ arriveTime: d.arriveTime }), at, now);
      evArrived++;
    }
  }
  log('invite → 排期 ' + evScheduled + ' / 到店 ' + evArrived + ' 事件');

  // ---------- store → 到店 + 成单事件 + deals ----------
  const stores = db.prepare('SELECT data FROM shijing_store WHERE deleted=0').all();
  for (const r of stores) {
    let d; try { d = JSON.parse(r.data); } catch { continue; }
    const ext = d.phone ? phoneToExt[String(d.phone)] : null;
    if (!ext) { skipNoExt++; continue; }
    const at = tsFromArrive(d.arriveTime) || (d.date ? Date.parse(d.date) : null) || d.createdAt || now;

    // 绑定门店(store_id)到客户主档
    if (d.teamId) upStoreId.run(d.teamId, ext);

    // 到店事件
    insEvent.run(`ev_st_arr_${d.id}`, ext, 'arrived', d.teamId || '', 'shijing_store', d.id,
      JSON.stringify({ customerType: d.customerType, performer: d.performer }), at, now);
    evArrived++;

    // 成单 → deals + 成单事件
    const amount = Number(d.closedAmount || d.amount || 0) || 0;
    if (d.isClosed === '是' && amount > 0) {
      const dealId = `deal_st_${d.id}`;
      insDeal.run(dealId, ext, 'first_deal', d.remark ? String(d.remark).split('\n')[0].slice(0, 40) : '成单',
        amount, d.performer || '', d.teamId || '', at, 'shijing_store', d.id, now);
      dealCnt++;
      insEvent.run(`ev_st_deal_${d.id}`, ext, 'dealt', d.performer || d.teamId || '', 'shijing_store', d.id,
        JSON.stringify({ amount, performer: d.performer }), at, now);
      evDeal++;
      upStage.run('dealt', ext);
    } else {
      upStage.run('arrived', ext);
    }
  }
  log('store → 到店/成单事件 + ' + dealCnt + ' 笔成交');

  db.exec('COMMIT');
  log('阶段3 事件流回填完成（已提交）');
} catch (e) {
  db.exec('ROLLBACK');
  log('失败已回滚: ' + e.message);
  process.exit(1);
}

// 验收
log('--- 验收 ---');
const q = (s) => db.prepare(s).get().c;
log('事件总数: ' + q('SELECT COUNT(*) c FROM shijing_customer_events'));
const byType = db.prepare('SELECT type, COUNT(*) c FROM shijing_customer_events GROUP BY type').all();
log('事件分布: ' + byType.map(x => x.type + ':' + x.c).join(' / '));
log('成交总数: ' + q('SELECT COUNT(*) c FROM shijing_deals') + ' / 总额: ' + (db.prepare('SELECT SUM(amount) s FROM shijing_deals').get().s || 0));
log('因无ext跳过(等绑定后再回填): ' + skipNoExt);
const stageDist = db.prepare('SELECT stage, COUNT(*) c FROM shijing_wecom_customers GROUP BY stage').all();
log('客户阶段: ' + stageDist.map(s => s.stage + ':' + s.c).join(' / '));
db.close();
