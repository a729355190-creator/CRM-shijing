'use strict';
/**
 * 给 v6-wecom.js 接入落地页系统(ldyad)的精确归因数据源
 *
 * 背景：用户发现落地页管理系统(ldyad-server, /opt/ldyad-server/data/app.db)的
 * leads 表本身就记录了每个企微客户(external_userid)来自哪个投放平台
 * (adq/oceanengine/oceanengine_local)，这是落地页跳转逻辑本身判定的，
 * 不是猜测。实测验证：
 *   - 三平台合计374条有external_userid的leads，94.9%能在CRM
 *     shijing_wecom_customers里精确匹配到同一个external_userid
 *   - 与此前"企微state字符串解析"方案(仅能判定本地推)的结果交叉核对，
 *     99%一致(203条里仅2条冲突)，可放心作为更优先、更全面的数据源
 *   - 关键突破：ADQ和巨量AD此前完全没有可用的归因方案，现在通过
 *     leads.platform能直接覆盖(64/77条ADQ、75/75条巨量AD精确匹配)
 *
 * 优先级设计：ldyad leads.platform(更精确、覆盖三平台) > state字符串解析
 * (仅能覆盖本地推的lifeca_规律)。两者不冲突时用ldyad；ldyad查不到记录
 * 时才降级用state解析兜底。
 */
const path = require('path');
const fs = require('fs');

const LDYAD_DB_PATH = '/opt/ldyad-server/data/app.db';
let _ldyadDb = null;
let _ldyadDbTriedAt = 0;
function getLdyadDb() {
  const now = Date.now();
  if (_ldyadDb) return _ldyadDb;
  // 避免db不存在时每次同步都重试打开耗时，5分钟内失败一次就不再重试
  if (now - _ldyadDbTriedAt < 5 * 60 * 1000 && _ldyadDbTriedAt !== 0) return null;
  _ldyadDbTriedAt = now;
  try {
    if (!fs.existsSync(LDYAD_DB_PATH)) return null;
    const Database = require('better-sqlite3');
    _ldyadDb = new Database(LDYAD_DB_PATH, { readonly: true, fileMustExist: true });
    return _ldyadDb;
  } catch (e) {
    console.error('[wecom-ldyad] 打开落地页系统数据库失败:', e.message);
    return null;
  }
}

// 落地页系统的platform值与CRM侧mediaChannel命名完全一致(oceanengine/oceanengine_local/adq)，
// 不需要转换。只信任这三个已知平台，'unknown'/空值视为查不到。
const LDYAD_KNOWN_PLATFORMS = new Set(['oceanengine', 'oceanengine_local', 'adq']);
function lookupLdyadPlatform(externalUserId) {
  if (!externalUserId) return null;
  const ld = getLdyadDb();
  if (!ld) return null;
  try {
    const row = ld.prepare('SELECT platform FROM leads WHERE external_userid=? AND platform IS NOT NULL ORDER BY created_at DESC LIMIT 1').get(externalUserId);
    if (row && LDYAD_KNOWN_PLATFORMS.has(row.platform)) return row.platform;
  } catch (e) {
    console.error('[wecom-ldyad] 查询落地页归因失败:', e.message);
  }
  return null;
}

module.exports = { lookupLdyadPlatform };
