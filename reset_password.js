// 重置所有用户密码为 sj8888
const bcrypt = require('bcryptjs'); // 使用bcryptjs而非bcrypt
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.argv[2] || '/opt/shijing-v6/db/shijing.db';
const NEW_PASSWORD = 'sj8888';
const NEW_HASH = bcrypt.hashSync(NEW_PASSWORD, 10);

console.log('[Reset Password] Target DB:', DB_PATH);
console.log('[Reset Password] New hash:', NEW_HASH);

try {
  const db = new Database(DB_PATH);

  // 查询所有活跃用户
  const users = db.prepare("SELECT id, data FROM shijing_users WHERE deleted=0").all();
  console.log('[Reset Password] Found', users.length, 'active users');

  // 更新每个用户的passwordHash
  let updated = 0;
  for (const user of users) {
    try {
      const data = JSON.parse(user.data);
      data.passwordHash = NEW_HASH;
      data.updatedAt = Date.now();
      data.updatedBy = 'reset-script';

      db.prepare("UPDATE shijing_users SET data=? WHERE id=?").run(JSON.stringify(data), user.id);
      console.log('[Reset Password] Updated:', data.username || user.id);
      updated++;
    } catch (e) {
      console.error('[Reset Password] Failed to update user:', user.id, e.message);
    }
  }

  console.log('[Reset Password] Successfully updated', updated, 'users');
  console.log('[Reset Password] All passwords now set to:', NEW_PASSWORD);

  db.close();
} catch (e) {
  console.error('[Reset Password] Error:', e.message);
  process.exit(1);
}