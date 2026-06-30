/**
 * 仕净 v6 用户系统模块 - Staging环境适配版
 * 使用独立字段存储（不是JSON data列）
 */
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const JWT_SECRET = 'shijing-v6-' + (process.env.JWT_SECRET || 'dev-secret-2026');
const COOKIE_NAME = 'sj_v6_token';
const COOKIE_MAX_AGE = 24 * 60 * 60 * 1000; // 24h

module.exports = function(app, db) {
  app.use(cookieParser());

  // === Staging适配：直接字段查询（不依赖data列）===
  function getUserByUsername(username) {
    return db.prepare("SELECT * FROM shijing_users WHERE username=?").get(String(username).toLowerCase());
  }
  function getUserById(id) {
    return db.prepare("SELECT * FROM shijing_users WHERE id=?").get(id);
  }
  function saveUser(u) {
    // Staging直接UPDATE字段（不JSON）
    const fields = {
      username: u.username,
      passwordHash: u.passwordHash,
      realName: u.realName || '',
      role: u.role,
      teamId: u.teamId,
      status: u.status || 'pending',
      token: u.token || null,
      tokenExpire: u.tokenExpire || null,
      createdAt: u.createdAt || Date.now(),
      approvedAt: u.approvedAt || null,
      approvedBy: u.approvedBy || null,
      rejectReason: u.rejectReason || null,
      lastLoginAt: u.lastLoginAt || null,
      lastLoginIp: u.lastLoginIp || null,
      position: u.position || '',
      dataVisibleFrom: u.dataVisibleFrom || '',
    };
    db.prepare(`
      INSERT INTO shijing_users(id, username, passwordHash, realName, role, teamId, status, token, tokenExpire, createdAt, approvedAt, approvedBy, rejectReason, lastLoginAt, lastLoginIp, position, dataVisibleFrom)
      VALUES(@id, @username, @passwordHash, @realName, @role, @teamId, @status, @token, @tokenExpire, @createdAt, @approvedAt, @approvedBy, @rejectReason, @lastLoginAt, @lastLoginIp, @position, @dataVisibleFrom)
      ON CONFLICT(id) DO UPDATE SET
        username=excluded.username,
        passwordHash=excluded.passwordHash,
        realName=excluded.realName,
        role=excluded.role,
        teamId=excluded.teamId,
        status=excluded.status,
        token=excluded.token,
        tokenExpire=excluded.tokenExpire,
        approvedAt=excluded.approvedAt,
        approvedBy=excluded.approvedBy,
        lastLoginAt=excluded.lastLoginAt,
        lastLoginIp=excluded.lastLoginIp,
        position=excluded.position,
        dataVisibleFrom=excluded.dataVisibleFrom
    `).run({ id: u.id, ...fields });
  }
  function getMainConfig() {
    const row = db.prepare("SELECT data FROM shijing_config WHERE id='main'").get();
    return row ? JSON.parse(row.data) : {};
  }
  function isValidTeamRole(teamId, role) {
    const teams = (getMainConfig().teams) || {};
    const team = teams[teamId];
    return !!(team && !team.deleted && team.role === role);
  }
  function todayLocalDate() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function normalizeVisibleFrom(v) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '';
  }

  // 认证中间件
  function v6Auth(req, res, next) {
    const tok = req.cookies && req.cookies[COOKIE_NAME];
    if (!tok) return next();
    try {
      const p = jwt.verify(tok, JWT_SECRET);
      const u = getUserById(p.id);
      if (u && u.status === 'active') {
        req.v6User = u;
      }
    } catch (e) { /* invalid token, ignore */ }
    next();
  }
  app.use(v6Auth);

  // === 公开页面 ===
  app.get('/login-v6', (req, res) => {
    const f = path.join(__dirname, 'login-v6.html');
    if (fs.existsSync(f)) return res.sendFile(f);
    res.status(500).send('login-v6.html missing');
  });

  app.get('/legacy', (req, res) => {
    res.send('<html><body style="font-family:sans-serif;padding:40px"><h2>使用旧版团队账号登录</h2><p>请直接在登录页填入团队账号（如 hq / SJ88）即可，旧版账号继续可用。</p><p><a href="/">返回</a></p></body></html>');
  });

  // === 登录 API ===
  app.post('/api/v6/login', (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ ok: false, error: 'missing_credentials' });
    }
    const u = getUserByUsername(username);
    if (!u) {
      return res.status(401).json({ ok: false, error: 'invalid' });
    }
    if (!bcrypt.compareSync(password, u.passwordHash)) {
      return res.status(401).json({ ok: false, error: 'invalid' });
    }
    if (u.status === 'pending') {
      return res.status(403).json({ ok: false, error: 'pending' });
    }
    if (u.status !== 'active') {
      return res.status(403).json({ ok: false, error: 'disabled' });
    }
    const token = jwt.sign(
      { id: u.id, username: u.username, role: u.role, teamId: u.teamId },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    res.cookie(COOKIE_NAME, token, {
      maxAge: COOKIE_MAX_AGE,
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    });
    // 更新 lastLogin
    u.lastLoginAt = Date.now();
    u.lastLoginIp = req.ip;
    saveUser(u);
    res.json({
      ok: true,
      user: {
        id: u.id, username: u.username, realName: u.realName,
        role: u.role, teamId: u.teamId, position: u.position,
        dataVisibleFrom: u.dataVisibleFrom || '',
      },
    });
  });

  app.post('/api/v6/logout', (req, res) => {
    res.clearCookie(COOKIE_NAME);
    res.json({ ok: true });
  });

  app.get('/api/v6/me', (req, res) => {
    if (!req.v6User) return res.status(401).json({ ok: false, error: 'unauthorized' });
    const u = req.v6User;
    res.json({ ok: true, user: {
      id: u.id, username: u.username, realName: u.realName,
      role: u.role, teamId: u.teamId, position: u.position,
      lastLoginAt: u.lastLoginAt, dataVisibleFrom: u.dataVisibleFrom || '',
    } });
  });

  app.post('/api/v6/change-password', (req, res) => {
    if (!req.v6User) return res.status(401).json({ ok: false, error: 'unauthorized' });
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword || newPassword.length < 6) {
      return res.status(400).json({ ok: false, error: 'invalid_input' });
    }
    const u = getUserById(req.v6User.id);
    if (!bcrypt.compareSync(oldPassword, u.passwordHash)) {
      return res.status(401).json({ ok: false, error: 'old_password_invalid' });
    }
    u.passwordHash = bcrypt.hashSync(newPassword, 10);
    saveUser(u);
    res.json({ ok: true });
  });

  // === 注册申请 ===
  app.post('/api/v6/register', (req, res) => {
    const { username, realName, password, role, teamId, position, applyReason } = req.body || {};
    if (!username || !realName || !password || !role || !teamId) {
      return res.status(400).json({ ok: false, error: 'missing_fields' });
    }
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username)) {
      return res.status(400).json({ ok: false, error: 'invalid_username' });
    }
    if (password.length < 6) return res.status(400).json({ ok: false, error: 'password_too_short' });
    if (getUserByUsername(username)) return res.status(409).json({ ok: false, error: 'username_exists' });
    if (!['ad', 'cs', 'store'].includes(role)) return res.status(400).json({ ok: false, error: 'invalid_role' });
    if (!isValidTeamRole(teamId, role)) return res.status(400).json({ ok: false, error: 'invalid_team' });
    const u = {
      id: 'u_' + username.toLowerCase() + '_' + Date.now().toString(36),
      username, realName,
      passwordHash: bcrypt.hashSync(password, 10),
      role, teamId, position: position || '',
      status: 'pending',
      applyReason: applyReason || '',
      createdAt: Date.now(),
      createdVia: 'self-register',
    };
    saveUser(u);
    res.json({ ok: true, message: '注册成功，等待总部审批后即可登录' });
  });

  // === HQ 用户管理 ===
  function requireHQ(req, res, next) {
    if (!req.v6User) return res.status(401).json({ ok: false, error: 'unauthorized' });
    if (req.v6User.role !== 'hq') return res.status(403).json({ ok: false, error: 'forbidden' });
    next();
  }

  app.get('/api/v6/pending-users', requireHQ, (req, res) => {
    const pending = db.prepare("SELECT * FROM shijing_users WHERE status='pending'").all();
    res.json({ ok: true, users: pending.map(u => ({
      id: u.id, username: u.username, realName: u.realName, role: u.role,
      teamId: u.teamId, position: u.position,
      applyReason: u.rejectReason || '', // staging用rejectReason字段存applyReason
      createdAt: u.createdAt,
    })) });
  });

  app.get('/api/v6/users', requireHQ, (req, res) => {
    const rows = db.prepare("SELECT * FROM shijing_users").all();
    const list = rows.map(u => ({
      id: u.id, username: u.username, realName: u.realName, role: u.role,
      teamId: u.teamId, position: u.position, status: u.status,
      lastLoginAt: u.lastLoginAt, createdAt: u.createdAt,
      dataVisibleFrom: u.dataVisibleFrom || '',
    })).sort((a, b) => (a.role || '').localeCompare(b.role || '') || (a.realName || '').localeCompare(b.realName || ''));
    res.json({ ok: true, users: list });
  });

  app.post('/api/v6/users/:id/approve', requireHQ, (req, res) => {
    const u = getUserById(req.params.id);
    if (!u) return res.status(404).json({ ok: false, error: 'not_found' });
    u.status = 'active';
    u.approvedAt = Date.now();
    u.approvedBy = req.v6User.id;
    if (u.role !== 'hq' && !normalizeVisibleFrom(u.dataVisibleFrom)) {
      u.dataVisibleFrom = todayLocalDate();
    }
    saveUser(u);
    res.json({ ok: true });
  });

  app.post('/api/v6/users/:id/reject', requireHQ, (req, res) => {
    const u = getUserById(req.params.id);
    if (!u) return res.status(404).json({ ok: false, error: 'not_found' });
    // Staging直接删除（不是软删除）
    db.prepare("DELETE FROM shijing_users WHERE id=?").run(u.id);
    res.json({ ok: true });
  });

  app.post('/api/v6/users', requireHQ, (req, res) => {
    const { username, realName, password, role, teamId, position } = req.body || {};
    if (!username || !realName || !password || !role || !teamId) {
      return res.status(400).json({ ok: false, error: 'missing_fields' });
    }
    if (password.length < 6) return res.status(400).json({ ok: false, error: 'password_too_short' });
    if (getUserByUsername(username)) return res.status(409).json({ ok: false, error: 'username_exists' });
    if (!['ad', 'cs', 'store', 'hq'].includes(role)) return res.status(400).json({ ok: false, error: 'invalid_role' });
    if (role !== 'hq' && !isValidTeamRole(teamId, role)) return res.status(400).json({ ok: false, error: 'invalid_team' });
    const u = {
      id: 'u_' + username.toLowerCase() + '_' + Date.now().toString(36),
      username, realName,
      passwordHash: bcrypt.hashSync(password, 10),
      role, teamId, position: position || '',
      status: 'active',
      createdAt: Date.now(), createdBy: req.v6User.id,
      dataVisibleFrom: role === 'hq' ? '' : todayLocalDate(),
    };
    saveUser(u);
    res.json({ ok: true, user: { id: u.id, username: u.username, realName: u.realName, role: u.role } });
  });

  app.patch('/api/v6/users/:id', requireHQ, (req, res) => {
    const u = getUserById(req.params.id);
    if (!u) return res.status(404).json({ ok: false, error: 'not_found' });
    const { realName, role, teamId, position, status, password, dataVisibleFrom } = req.body || {};
    const nextRole = role !== undefined ? role : u.role;
    const nextTeamId = teamId !== undefined ? teamId : u.teamId;
    if (!['ad', 'cs', 'store', 'hq'].includes(nextRole)) {
      return res.status(400).json({ ok: false, error: 'invalid_role' });
    }
    if (nextRole !== 'hq' && !isValidTeamRole(nextTeamId, nextRole)) {
      return res.status(400).json({ ok: false, error: 'invalid_team' });
    }
    if (realName !== undefined) u.realName = realName;
    if (role !== undefined) u.role = role;
    if (teamId !== undefined) u.teamId = teamId;
    if (position !== undefined) u.position = position;
    if (status !== undefined) u.status = status;
    if (dataVisibleFrom !== undefined) {
      if (dataVisibleFrom && !normalizeVisibleFrom(dataVisibleFrom)) {
        return res.status(400).json({ ok: false, error: 'invalid_data_visible_from' });
      }
      u.dataVisibleFrom = dataVisibleFrom ? normalizeVisibleFrom(dataVisibleFrom) : '';
    }
    if ((role !== undefined || teamId !== undefined) && nextRole !== 'hq' && !normalizeVisibleFrom(u.dataVisibleFrom)) {
      u.dataVisibleFrom = todayLocalDate();
    }
    if (nextRole === 'hq') u.dataVisibleFrom = '';
    if (password) {
      if (password.length < 6) return res.status(400).json({ ok: false, error: 'password_too_short' });
      u.passwordHash = bcrypt.hashSync(password, 10);
    }
    saveUser(u);
    res.json({ ok: true });
  });

  app.delete('/api/v6/users/:id', requireHQ, (req, res) => {
    const u = getUserById(req.params.id);
    if (!u) return res.status(404).json({ ok: false, error: 'not_found' });
    // Staging直接删除
    db.prepare("DELETE FROM shijing_users WHERE id=?").run(u.id);
    res.json({ ok: true });
  });

  console.log('[v6-user-system-staging] mounted: /login-v6, /api/v6/login, /api/v6/me, /api/v6/users');
};