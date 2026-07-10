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

  // 素材分类表（2026-07-10 新增：分类原来硬编码在前端，现改为可动态新增/停用）
  // kind: 'text'=文案分类 / 'file'=图片视频分类
  db.exec(`CREATE TABLE IF NOT EXISTS shijing_upload_categories (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    sortOrder INTEGER DEFAULT 0,
    deleted INTEGER DEFAULT 0,
    createdBy TEXT,
    createdAt INTEGER DEFAULT (strftime('%s','now')*1000)
  )`);

  // 首次启动：把原来硬编码的分类种子进表（表为空时才种，避免重复）
  const DEFAULT_CATS = {
    text: ['破冰', '原理解释+答疑', '获取信任', '促定金', '排客', '沉默用户唤醒'],
    file: ['效果对比', '操作过程', '朋友圈素材', '人设搭建', '环境展示', '活动促销'],
  };
  for (const kind of Object.keys(DEFAULT_CATS)) {
    const cnt = db.prepare("SELECT COUNT(*) AS n FROM shijing_upload_categories WHERE kind=? AND deleted=0").get(kind).n;
    if (cnt === 0) {
      DEFAULT_CATS[kind].forEach((name, i) => {
        const id = 'cat_' + kind + '_seed_' + i;
        db.prepare("INSERT OR IGNORE INTO shijing_upload_categories(id, kind, name, sortOrder) VALUES(?,?,?,?)")
          .run(id, kind, name, i);
      });
    }
  }

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

  // ===== 素材分类管理（2026-07-10 新增）=====
  // 列出分类（任何登录用户；kind=text|file，不传则返回全部）
  app.get('/api/v6/upload-categories', (req, res) => {
    if (!req.v6User) return res.status(401).json({ ok: false, error: 'unauthorized' });
    const { kind } = req.query || {};
    let rows;
    if (kind) {
      rows = db.prepare("SELECT id, kind, name, sortOrder FROM shijing_upload_categories WHERE deleted=0 AND kind=? ORDER BY sortOrder ASC, createdAt ASC").all(kind);
    } else {
      rows = db.prepare("SELECT id, kind, name, sortOrder FROM shijing_upload_categories WHERE deleted=0 ORDER BY sortOrder ASC, createdAt ASC").all();
    }
    res.json({ ok: true, items: rows });
  });

  // 新增分类（cs/hq 可新增，任何客服角色都能自助加类目，方便素材扩展）
  app.post('/api/v6/upload-categories', (req, res) => {
    if (!req.v6User) return res.status(401).json({ ok: false, error: 'unauthorized' });
    if (req.v6User.role !== 'cs' && req.v6User.role !== 'hq') {
      return res.status(403).json({ ok: false, error: 'forbidden_only_cs' });
    }
    const { kind, name } = req.body || {};
    if (kind !== 'text' && kind !== 'file') return res.status(400).json({ ok: false, error: 'bad_kind' });
    const n = String(name || '').trim();
    if (!n) return res.status(400).json({ ok: false, error: 'missing_name' });
    if (n.length > 20) return res.status(400).json({ ok: false, error: 'name_too_long' });
    // 同类目下不允许重名（未删除的）
    const dup = db.prepare("SELECT id FROM shijing_upload_categories WHERE kind=? AND name=? AND deleted=0").get(kind, n);
    if (dup) return res.status(400).json({ ok: false, error: 'duplicate_name' });
    const maxRow = db.prepare("SELECT MAX(sortOrder) AS m FROM shijing_upload_categories WHERE kind=? AND deleted=0").get(kind);
    const sortOrder = (maxRow && maxRow.m != null ? maxRow.m : -1) + 1;
    const id = 'cat_' + kind + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    try {
      db.prepare("INSERT INTO shijing_upload_categories(id, kind, name, sortOrder, createdBy) VALUES(?,?,?,?,?)")
        .run(id, kind, n, sortOrder, req.v6User.id);
      res.json({ ok: true, id, kind, name: n, sortOrder });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  // 停用分类（软删除，仅 HQ；防止客服误建/误删导致已有素材分类丢失显示）
  app.delete('/api/v6/upload-categories/:id', (req, res) => {
    if (!req.v6User) return res.status(401).json({ ok: false, error: 'unauthorized' });
    if (req.v6User.role !== 'hq') return res.status(403).json({ ok: false, error: 'forbidden_only_hq' });
    const row = db.prepare("SELECT id FROM shijing_upload_categories WHERE id=? AND deleted=0").get(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: 'not_found' });
    db.prepare("UPDATE shijing_upload_categories SET deleted=1 WHERE id=?").run(req.params.id);
    res.json({ ok: true });
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

  console.log('[v6-uploads] mounted: /api/v6/uploads (list/text/files/delete) + /api/v6/upload-categories (list/add/delete) + static /uploads');
};
