// 从备份恢复生产环境原密码hash（撤销sj8888统一重置）
const Database = require('better-sqlite3');
const fs = require('fs');

const PRODUCTION_DB = '/opt/shijing-v6/db/shijing.db';
const BACKUP_DB = '/opt/shijing-v6/db/shijing.db.bak-aikfmerge-20260619-201942';

console.log('=== 恢复生产环境原密码 ===');

// 打开备份数据库
const backupDb = new Database(BACKUP_DB);
const backupUsers = backupDb.prepare(`
  SELECT id, data
  FROM shijing_users
  WHERE deleted=0
`).all();

console.log(`备份中找到 ${backupUsers.length} 个活跃用户`);

// 提取原密码hash
const originalHashes = {};
backupUsers.forEach(row => {
  const data = JSON.parse(row.data);
  if (data.username && data.passwordHash) {
    originalHashes[data.username] = {
      id: row.id,
      hash: data.passwordHash
    };
  }
});

console.log('原密码hash示例（前3个）:');
Object.keys(originalHashes).slice(0, 3).forEach(username => {
  console.log(`  ${username}: ${originalHashes[username].hash.substring(0, 30)}...`);
});

// 打开生产数据库
const prodDb = new Database(PRODUCTION_DB);

// 恢复原密码hash
let restoredCount = 0;
Object.keys(originalHashes).forEach(username => {
  const { id, hash } = originalHashes[username];
  try {
    // 查询当前数据
    const currentRow = prodDb.prepare('SELECT data FROM shijing_users WHERE id=?').get(id);
    if (!currentRow) {
      console.log(`⚠️ 用户 ${username} 在生产库不存在`);
      return;
    }

    // 更新JSON中的passwordHash
    const currentData = JSON.parse(currentRow.data);
    currentData.passwordHash = hash;

    // 写回数据库
    prodDb.prepare('UPDATE shijing_users SET data=? WHERE id=?').run(JSON.stringify(currentData), id);
    restoredCount++;
    console.log(`✅ ${username} 密码已恢复`);
  } catch (e) {
    console.error(`❌ ${username} 恢复失败:`, e.message);
  }
});

console.log(`\n=== 恢复完成 ===`);
console.log(`成功恢复 ${restoredCount} 个用户密码`);
console.log(`生产环境密码已恢复到6月19日备份状态`);

backupDb.close();
prodDb.close();