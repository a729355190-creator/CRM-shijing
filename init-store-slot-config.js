/**
 * 初始化门店容量配置
 * 给所有门店添加 maxPerSlot 和 slotConfig 字段
 *
 * 执行方式：ssh root@112.124.25.213 'cd /opt/shijing-v6 && node init-store-slot-config.js'
 */

const fs = require('fs');
const Database = require('better-sqlite3');

const dbPath = '/opt/shijing-v6/db/shijing.db';
const db = new Database(dbPath);

try {
  // 1. 读取当前配置
  const row = db.prepare('SELECT data FROM shijing_config WHERE id = ?').get('main');
  if (!row) {
    throw new Error('配置不存在');
  }

  const config = JSON.parse(row.data);
  console.log('当前门店数量:', Object.keys(config.teams).filter(k => config.teams[k].role === 'store').length);

  // 2. 给所有门店添加容量配置
  const stores = Object.keys(config.teams).filter(k => config.teams[k].role === 'store');
  stores.forEach(storeId => {
    const store = config.teams[storeId];
    if (!store.maxPerSlot) {
      store.maxPerSlot = 1;  // 默认每小时1人
      store.slotConfig = {
        newCustomerMinutes: 60,  // 新客60分钟
        oldCustomerMinutes: 30   // 老客30分钟
      };
      console.log(`✓ ${store.name} 已添加容量配置: maxPerSlot=1`);
    } else {
      console.log(`○ ${store.name} 已有容量配置: maxPerSlot=${store.maxPerSlot}`);
    }
  });

  // 3. 更新配置
  const newData = JSON.stringify(config);
  db.prepare('UPDATE shijing_config SET data = ?, updatedAt = ? WHERE id = ?').run(newData, Date.now(), 'main');

  console.log('\n✅ 配置初始化完成');
  console.log('已配置门店数量:', stores.length);

} catch (e) {
  console.error('❌ 初始化失败:', e.message);
  process.exit(1);
}

db.close();