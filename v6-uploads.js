// 仕净 v6 客服素材库（客服自己做的前后对比图、视频、发顾客的文案）
// - 文案：直接粘贴文本提交
// - 图片/视频：本地批量上传到服务器 /opt/shijing-v6/uploads/
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

module.exports = function (app, db) {
  // 建表
  db.exec(`CREATE TABLE IF NOT EXISTS shijing_uploads (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    deleted INTEGER DEFAULT 0,
    updatedAt INTEGER DEFAULT (strftime('%s','now')*1000)
  )`);

  // 文件存储目录
  const UP_DIR = path.join(__dirname, 'uploads');
  if (!fs.existsSync(UP_DIR)) fs.mkdirSync(UP_DIR, { recursive: true });

  // 静态服务（让上传的文件可访问）
  const express = require('express');
  app.use('/uploads', express.static(UP_DIR, { maxAge: '1d' }));

  // 列出全部素材（任何登录用户）
  app.get('/api/v6/uploads', (req, res) => {
    const rows = db.prepare("SELECT data FROM shijing_uploads WHERE deleted=0").all();
    const items = rows.map(r => JSON.parse(r.data));
    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    res.json({ ok: true, items });
  });

  // 上传文案（粘贴文本，仅 cs/hq）
  app.post('/api/v6/uploads/text', (req, res) => {
    if (!req.v6User) return res.status(401).json({ ok: false, error: 'unauthorized' });
    if (req.v6User.role !== 'cs' && req.v6User.role !== 'hq') {
      return res.status(403).json({ ok: false, error: 'forbidden_only_cs' });
    }
    const { category, title, content } = req.body || {};
    if (!category || !title || !content) {
      return res.status(400).json({ ok: false, error: 'missing_fields' });
    }
    const rec = {
      id: 'up_text_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      kind: 'text',
      category, title, content,
      uploaderId: req.v6User.id,
      uploaderName: req.v6User.realName,
      uploaderRole: req.v6User.role,
      uploaderTeamId: req.v6User.teamId,
      createdAt: Date.now(),
    };
    try {
      db.prepare("INSERT INTO shijing_uploads(id, data) VALUES(?, ?)").run(rec.id, JSON.stringify(rec));
      res.json({ ok: true, id: rec.id });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  // 批量上传图片/视频（multipart）
  let multer;
  try { multer = require('multer'); } catch (e) {
    console.warn('[v6-uploads] multer not installed, file upload disabled. Run: npm i multer');
  }

  if (multer) {
    const storage = multer.diskStorage({
      destination: (req, file, cb) => cb(null, UP_DIR),
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase() || '.bin';
        const hash = crypto.randomBytes(8).toString('hex');
        cb(null, Date.now() + '_' + hash + ext);
      },
    });
    const upload = multer({
      storage,
      limits: { fileSize: 100 * 1024 * 1024 }, // 100MB / file
      fileFilter: (req, file, cb) => {
        const ok = /^(image\/|video\/)/.test(file.mimetype);
        cb(ok ? null : new Error('only image/video allowed'), ok);
      },
    });

    // 批量上传：FormData files[] + category
    app.post('/api/v6/uploads/files', upload.array('files', 30), (req, res) => {
      if (!req.v6User) return res.status(401).json({ ok: false, error: 'unauthorized' });
      if (req.v6User.role !== 'cs' && req.v6User.role !== 'hq') {
        return res.status(403).json({ ok: false, error: 'forbidden_only_cs' });
      }
      const { category } = req.body || {};
      if (!category) return res.status(400).json({ ok: false, error: 'missing_category' });
      const files = req.files || [];
      if (files.length === 0) return res.status(400).json({ ok: false, error: 'no_files' });
      const created = [];
      for (const f of files) {
        const isVideo = /^video\//.test(f.mimetype);
        const rec = {
          id: 'up_file_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          kind: isVideo ? 'video' : 'image',
          category,
          title: f.originalname,
          url: '/uploads/' + f.filename,
          mimeType: f.mimetype,
          fileSize: f.size,
          uploaderId: req.v6User.id,
          uploaderName: req.v6User.realName,
          uploaderRole: req.v6User.role,
          uploaderTeamId: req.v6User.teamId,
          createdAt: Date.now(),
        };
        try {
          db.prepare("INSERT INTO shijing_uploads(id, data) VALUES(?, ?)").run(rec.id, JSON.stringify(rec));
          created.push(rec);
        } catch (e) {
          try { fs.unlinkSync(f.path); } catch (e) {}
        }
      }
      res.json({ ok: true, count: created.length, items: created });
    });
  }

  // 删除（本人或 HQ）
  app.delete('/api/v6/uploads/:id', (req, res) => {
    if (!req.v6User) return res.status(401).json({ ok: false, error: 'unauthorized' });
    const row = db.prepare("SELECT data FROM shijing_uploads WHERE id=? AND deleted=0").get(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: 'not_found' });
    const rec = JSON.parse(row.data);
    if (rec.uploaderId !== req.v6User.id && req.v6User.role !== 'hq') {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    db.prepare("UPDATE shijing_uploads SET deleted=1 WHERE id=?").run(req.params.id);
    if (rec.url && rec.url.startsWith('/uploads/')) {
      const fp = path.join(UP_DIR, rec.url.replace('/uploads/', ''));
      try { fs.unlinkSync(fp); } catch (e) {}
    }
    res.json({ ok: true });
  });

  console.log('[v6-uploads] mounted: /api/v6/uploads (list/text/files/delete) + static /uploads');
};
