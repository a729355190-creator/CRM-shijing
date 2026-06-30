/**
 * v6 静态资源 + 路由（让登录后默认进 workspace）
 * 在 server.js 中 require 调用：require('./v6-app-routes')(app, db);
 */
const path = require('path');
const fs = require('fs');

module.exports = function(app, db) {
  const ROOT = __dirname;
  const STATIC = ROOT;

  // v6 工作台静态资源（CSS / JS / HTML）
  app.get('/v6-app.css', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(STATIC, 'v6-app.css'));
  });
  app.get('/v6-modules/:file', (req, res) => {
    const f = path.join(STATIC, 'v6-modules', req.params.file);
    if (!fs.existsSync(f) || !req.params.file.endsWith('.js')) return res.status(404).send('not found');
    res.set('Content-Type', 'application/javascript; charset=utf-8');
    res.set('Cache-Control', 'no-cache');
    res.sendFile(f);
  });

  // 工作台 (登录后 v6 用户默认进这里)
  app.get('/workspace', (req, res) => {
    res.sendFile(path.join(STATIC, 'workspace.html'));
  });

  // === 拦截 / 路径 ===
  // v6 用户：直接进 /workspace
  // 没登录 v6：判断是否登录了 v5（有 ses cookie）；都没有 → /login-v6
  // 登录了 v5 没登录 v6：保持 v5 行为
  app.get(['/', '/index.html'], (req, res, next) => {
    if (req.v6User) {
      return res.redirect('/workspace');
    }
    // 未登录 → 直接到 v6 登录页（v5 老入口仍可走 /legacy 或直接访问 /api/login）
    return res.redirect('/login-v6');
  });

  // === 话术系统 API（解析手册 markdown）===
  let _scriptCache = null;
  app.get('/api/v6/scripts', (req, res) => {
    if (!req.v6User) return res.status(401).json({ ok: false, error: 'unauthorized' });
    if (req.v6User.role !== 'cs' && req.v6User.role !== 'hq') {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    if (!_scriptCache) {
      const f = path.join(ROOT, 'scripts-handbook.md');
      if (!fs.existsSync(f)) return res.status(500).json({ ok: false, error: 'handbook_missing' });
      const md = fs.readFileSync(f, 'utf8');
      // 按 ## 二级标题切分
      const sections = [];
      const lines = md.split('\n');
      let cur = null;
      for (const line of lines) {
        const m = line.match(/^##\s+(.+)$/);
        if (m) {
          if (cur) sections.push(cur);
          cur = { title: m[1].trim(), content: '' };
        } else if (cur) {
          cur.content += line + '\n';
        }
      }
      if (cur) sections.push(cur);
      _scriptCache = sections;
    }
    res.json({ ok: true, sections: _scriptCache });
  });

  console.log('[v6-app-routes] mounted: /workspace, /v6-app.css, /v6-modules/*, /api/v6/scripts');
};
