/**
 * v6 投放素材 API（v5：合并素材库 + 已投放性能 + 反查文件 URL/封面）
 *
 * 关键 API：/api/v6/oc/materials?days=14
 * 返回：
 *   - 已投放素材（report data）+ 完整指标（消耗/加微/转化/CTR/CVR/CPM/CPC）
 *   - 素材文件信息（封面 url / 视频 url / 文件名 / 时长 / 分辨率）via file/video|image/get
 *   - 库内但没投放的素材（cost=0）
 *
 * 实测：report 的 material_id == file 接口的 material_id（同账户内），跨账户 ID 不通。
 * 所以策略：对每个有报告数据的 sub account，单独拉 file 全量，按 material_id map。
 */
const https = require('https');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
if (!DEEPSEEK_API_KEY) console.warn('[' + require('path').basename(__filename) + '] DEEPSEEK_API_KEY not set in .env, AI features will fail.');

module.exports = function(app, db, deps) {
  const { ocGetValidToken, getConfig } = deps;
  const OC_API_HOST = 'api.oceanengine.com';

  function ocGet(accessToken, path) {
    return new Promise((resolve) => {
      const req = https.request({
        hostname: OC_API_HOST, path, method: 'GET',
        headers: { 'Access-Token': accessToken },
        timeout: 20000,
      }, (res) => {
        let buf = '';
        res.on('data', d => buf += d);
        res.on('end', () => {
          try {
            // 关键：把 material_id 等 19 位数字 ID 转成字符串再 parse，避免 Number 精度丢失
            const fixed = buf
              .replace(/("material_id":\s*)(\d{16,})/g, '$1"$2"')
              .replace(/("ad_id":\s*)(\d{16,})/g, '$1"$2"')
              .replace(/("aweme_id":\s*)(\d{16,})/g, '$1"$2"');
            resolve({ ok: true, status: res.statusCode, raw: JSON.parse(fixed) });
          }
          catch (e) { resolve({ ok: false, status: res.statusCode, error: 'parse_error', body: buf.slice(0, 500) }); }
        });
      });
      req.on('error', e => resolve({ ok: false, error: e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
      req.end();
    });
  }

  function v6AuthRequired(req, res, next) {
    if (!req.v6User) return res.status(401).json({ ok: false, error: 'unauthorized' });
    if (req.v6User.role !== 'ad' && req.v6User.role !== 'hq') {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    next();
  }

  // ========== 1. 子账户列表 ==========
  app.get('/api/v6/oc/accounts', v6AuthRequired, (req, res) => {
    const cfg = getConfig() || {};
    const oc = cfg.oceanengine || {};
    const subs = oc.subAccounts || [];
    res.json({ ok: true, accounts: subs.map(s => ({ id: s.accountId, name: s.accountName })) });
  });

  // ========== 2. 已投放素材 + 素材文件（聚合）==========
  // 缓存：5 分钟
  const _cache = new Map();
  const CACHE_TTL = 5 * 60 * 1000;

  // 对单个账户：1) 拉 report；2) 拉 file/video 全量；3) 拉 file/image 全量
  async function fetchAccountFull(tok, accId, fmt, start, end) {
    const METRICS = '["stat_cost","show_cnt","click_cnt","convert_cnt","ctr","cpm_platform","cpc_platform","conversion_cost","conversion_rate","attribution_work_wechat_added_count"]';
    const reportPath = `/open_api/v3.0/report/custom/get/?` + [
      `advertiser_id=${accId}`,
      `start_time=${fmt(start)}`,
      `end_time=${fmt(end)}`,
      `dimensions=${encodeURIComponent('["material_id"]')}`,
      `metrics=${encodeURIComponent(METRICS)}`,
      `data_topic=BASIC_DATA`,
      `data_level=AD_LEVEL_MATERIAL`,
      `filters=${encodeURIComponent('[]')}`,
      `order_by=${encodeURIComponent('[{"field":"stat_cost","type":"DESC"}]')}`,
      `page=1`,
      `page_size=100`,
    ].join('&');
    const r = await ocGet(tok, reportPath);
    if (!r.ok || !r.raw || r.raw.code !== 0) {
      return { rows: [], files: {}, error: r.raw?.message || r.error, code: r.raw?.code };
    }
    const rows = (r.raw.data?.rows || []).map(x => ({
      materialId: String(x.dimensions.material_id),
      cost: parseFloat(x.metrics.stat_cost) || 0,
      show: parseInt(x.metrics.show_cnt, 10) || 0,
      click: parseInt(x.metrics.click_cnt, 10) || 0,
      convert: parseInt(x.metrics.convert_cnt, 10) || 0,
      wechatFans: parseInt(x.metrics.attribution_work_wechat_added_count, 10) || 0,
      ctr: parseFloat(x.metrics.ctr) || 0,
      cpm: parseFloat(x.metrics.cpm_platform) || 0,
      cpc: parseFloat(x.metrics.cpc_platform) || 0,
      cvr: parseFloat(x.metrics.conversion_rate) || 0,
      convertCost: parseFloat(x.metrics.conversion_cost) || 0,
    }));

    // 该账户没投放数据，不必拉素材文件
    if (rows.length === 0) return { rows: [], files: {} };

    const neededIds = new Set(rows.map(r => r.materialId));
    const files = {};
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    async function pullPages(path, type) {
      let page = 1;
      while (page <= 15) {  // 最多 15 页 × 100 = 1500 条
        const rr = await ocGet(tok, `${path}?advertiser_id=${accId}&page=${page}&page_size=100`);
        if (!rr.ok || rr.raw?.code !== 0) break;
        const list = rr.raw.data?.list || [];
        for (const f of list) {
          const mid = String(f.material_id || '');
          if (!mid) continue;
          if (type === 'video') {
            files[mid] = {
              type: 'video',
              name: f.filename || f.material_name,
              url: f.url,
              cover: f.poster_url,
              width: f.width, height: f.height,
              duration: f.duration,
              createTime: f.create_time,
            };
          } else {
            files[mid] = {
              type: 'image',
              name: f.filename || f.material_name || f.signature,
              url: f.url || f.image_url,
              cover: f.url || f.image_url,
              width: f.width, height: f.height,
              createTime: f.create_time,
            };
          }
        }
        let allFound = true;
        for (const id of neededIds) if (!files[id]) { allFound = false; break; }
        if (allFound) break;
        const totalPage = rr.raw.data?.page_info?.total_page || 1;
        if (list.length < 100 || page >= totalPage) break;
        page++;
        await sleep(120);
      }
    }
    console.log('[mat] acc', accId, 'rows=', rows.length, 'needed=', neededIds.size);
    await pullPages('/open_api/2/file/video/get/', 'video');
    let stillMissing = false;
    for (const id of neededIds) if (!files[id]) { stillMissing = true; break; }
    if (stillMissing) await pullPages('/open_api/2/file/image/get/', 'image');
    console.log("[mat] acc", accId, "final files=", Object.keys(files).length, "of", neededIds.size);

    return { rows, files };
  }

  app.get('/api/v6/oc/materials', v6AuthRequired, async (req, res) => {
    // 支持两种参数：days=14 (默认) OR startDate=2026-05-20&endDate=2026-06-05
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const parseDate = (s) => {
      if (!s) return null;
      const m = String(s).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (!m) return null;
      const d = new Date(+m[1], +m[2] - 1, +m[3]);
      return isNaN(d) ? null : d;
    };

    let start, end, dateRangeKey;
    const sdParam = parseDate(req.query.startDate);
    const edParam = parseDate(req.query.endDate);
    if (sdParam && edParam) {
      // 自定义区间
      start = sdParam < edParam ? sdParam : edParam;
      end = sdParam < edParam ? edParam : sdParam;
      // 巨量限制：单次最多 30 天
      const diffDays = Math.round((end - start) / 86400000) + 1;
      if (diffDays > 31) {
        return res.json({ ok: false, error: 'date_range_too_long', message: '日期区间不能超过 31 天' });
      }
      // 不允许查未来
      const todayE = new Date(); todayE.setHours(0,0,0,0);
      if (end > todayE) end = todayE;
      dateRangeKey = `${fmt(start)}_${fmt(end)}`;
    } else {
      const days = Math.min(parseInt(req.query.days || '14', 10), 30);
      const today = new Date();
      end = new Date(today.getTime() - 24 * 3600 * 1000);
      start = new Date(today.getTime() - days * 24 * 3600 * 1000);
      dateRangeKey = `days_${days}`;
    }
    const cacheKey = `materials:${dateRangeKey}`;

    const cached = _cache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL) {
      return res.json({ ...cached.data, cached: true, cacheAge: Math.round((Date.now() - cached.at) / 1000) });
    }

    const tok = await ocGetValidToken();
    if (!tok) return res.json({ ok: false, error: 'no_token' });

    const cfg = getConfig() || {};
    const oc = cfg.oceanengine || {};
    const subs = oc.subAccounts || [];
    const accountNameMap = Object.fromEntries(subs.map(s => [String(s.accountId), s.accountName]));

    // 串行拉每个账户（节流 + 重试）
    const allRowsByAcc = []; // [{accId, rows, files}]
    const errors = [];
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    for (const sub of subs) {
      const accId = sub.accountId;
      let attempt = 0;
      while (attempt < 2) {
        const r = await fetchAccountFull(tok, accId, fmt, start, end);
        if (!r.error) {
          if (r.rows.length > 0) {
            allRowsByAcc.push({ accId, accountName: accountNameMap[String(accId)] || String(accId), rows: r.rows, files: r.files });
          }
          break;
        }
        if (r.code === 40110 && attempt === 0) { await sleep(2500); attempt++; continue; }
        errors.push({ accountId: accId, error: r.error, code: r.code });
        break;
      }
      await sleep(300);
    }

    // 跨账户聚合：同一 material_id（在不同账户）合并
    // 但素材文件优先用第一次出现的账户的（因为文件 URL 跨账户 ID 不通）
    const byMid = new Map();
    for (const acc of allRowsByAcc) {
      for (const r of acc.rows) {
        const mid = r.materialId;
        if (!byMid.has(mid)) {
          byMid.set(mid, {
            materialId: mid,
            accounts: new Set(),
            cost: 0, show: 0, click: 0, convert: 0, wechatFans: 0,
            file: acc.files[mid] || null,
            firstAccountId: acc.accId,
            firstAccountName: acc.accountName,
          });
        }
        const m = byMid.get(mid);
        m.accounts.add(acc.accountName);
        m.cost += r.cost;
        m.show += r.show;
        m.click += r.click;
        m.convert += r.convert;
        m.wechatFans += r.wechatFans;
        if (!m.file && acc.files[mid]) {
          m.file = acc.files[mid];
          m.firstAccountId = acc.accId;
          m.firstAccountName = acc.accountName;
        }
      }
    }

    const merged = [...byMid.values()].map(m => ({
      materialId: m.materialId,
      accounts: [...m.accounts],
      accountCount: m.accounts.size,
      cost: +m.cost.toFixed(2),
      show: m.show, click: m.click, convert: m.convert, wechatFans: m.wechatFans,
      ctr: m.show > 0 ? +(m.click / m.show * 100).toFixed(2) : 0,
      cvr: m.click > 0 ? +(m.convert / m.click * 100).toFixed(2) : 0,
      cpm: m.show > 0 ? +(m.cost / m.show * 1000).toFixed(2) : 0,
      cpc: m.click > 0 ? +(m.cost / m.click).toFixed(2) : 0,
      convertCost: m.convert > 0 ? +(m.cost / m.convert).toFixed(2) : 0,
      wechatFanCost: m.wechatFans > 0 ? +(m.cost / m.wechatFans).toFixed(2) : 0,
      file: m.file,
      sourceAccountId: m.firstAccountId,
      sourceAccountName: m.firstAccountName,
    })).sort((a, b) => b.cost - a.cost);

    const totals = {
      cost: +merged.reduce((s, r) => s + r.cost, 0).toFixed(2),
      show: merged.reduce((s, r) => s + r.show, 0),
      click: merged.reduce((s, r) => s + r.click, 0),
      convert: merged.reduce((s, r) => s + r.convert, 0),
      wechatFans: merged.reduce((s, r) => s + r.wechatFans, 0),
      materialCount: merged.length,
      withFileCount: merged.filter(m => m.file).length,
      accountCount: subs.length,
      successAccountCount: subs.length - errors.length,
    };
    totals.ctr = totals.show > 0 ? +(totals.click / totals.show * 100).toFixed(2) : 0;
    totals.cvr = totals.click > 0 ? +(totals.convert / totals.click * 100).toFixed(2) : 0;
    totals.cpm = totals.show > 0 ? +(totals.cost / totals.show * 1000).toFixed(2) : 0;
    totals.cpc = totals.click > 0 ? +(totals.cost / totals.click).toFixed(2) : 0;
    totals.convertCost = totals.convert > 0 ? +(totals.cost / totals.convert).toFixed(2) : 0;
    totals.wechatFanCost = totals.wechatFans > 0 ? +(totals.cost / totals.wechatFans).toFixed(2) : 0;

    const result = {
      ok: true,
      materials: merged.slice(0, 200),
      total: merged.length,
      totals, errors,
      dateRange: `${fmt(start)} ~ ${fmt(end)}`,
    };
    _cache.set(cacheKey, { at: Date.now(), data: result });
    res.json(result);
  });

  // 兼容旧路由
  app.get('/api/v6/oc/deployed-materials', v6AuthRequired, (req, res, next) => {
    req.url = '/api/v6/oc/materials' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');
    app.handle(req, res, next);
  });

  app.post('/api/v6/oc/materials/refresh', v6AuthRequired, (req, res) => {
    _cache.clear();
    res.json({ ok: true });
  });

  // ========== 3. AI 文案生成（DeepSeek）==========
  function callDeepSeek(messages) {
    return new Promise((resolve) => {
      const body = JSON.stringify({
        model: 'deepseek-chat',
        messages,
        temperature: 0.8,
        max_tokens: 1500,
      });
      const req = https.request({
        hostname: 'api.deepseek.com',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 30000,
      }, res => {
        let buf = '';
        res.on('data', d => buf += d);
        res.on('end', () => {
          try {
            const j = JSON.parse(buf);
            if (j.choices?.[0]) resolve({ ok: true, content: j.choices[0].message.content, usage: j.usage });
            else resolve({ ok: false, error: j.error?.message || 'no_choice' });
          } catch (e) { resolve({ ok: false, error: 'parse_error' }); }
        });
      });
      req.on('error', e => resolve({ ok: false, error: e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
      req.write(body);
      req.end();
    });
  }

  // POST /api/v6/oc/material-copy { materialId, fileName?, scene? }
  // 基于素材给出 3 条投放文案变体（标题/口播/卖点）
  app.post('/api/v6/oc/material-copy', v6AuthRequired, async (req, res) => {
    const materialId = String(req.body?.materialId || '').trim();
    const fileName = String(req.body?.fileName || '').trim();
    const scene = String(req.body?.scene || '男士胡须管理').trim();
    if (!materialId) return res.status(400).json({ ok: false, error: 'missing_materialId' });

    const BRAND_RULES = `
【仕净品牌投放文案规则】（必须遵守）
1. 服务：男士胡须管理（不要说"脱毛"），用进口胡须去除仪 + 纳米毛囊休眠技术
2. 体验价：388 元一次（一口价），单次去 70-80%，2-3 次基本不长
3. 当场见效：做完照镜子能看到胡子区域明显改善，皮肤更干净
4. 一次 40 分钟，无副作用，做完正常生活
5. 全国连锁，已服务上万名男士
6. 钩子：今天剩 X 个名额 / 8-10 元红包锁单 / 路费补贴
7. 禁用词：永久去除、保证一辈子不长、比医美强、永不复发
8. 风格：直接、有钩子、痛点 + 利益点 + 紧迫感`;

    const messages = [
      { role: 'system', content: `你是仕净（男士胡须管理）品牌的投放文案策划。任务：基于一条短视频/图片素材，生成 3 条不同卖点角度的投放文案变体。\n\n${BRAND_RULES}\n\n输出格式（严格按此）：\n【文案1·卖点角度】\n标题：xxxxx（10~18 字，强钩子）\n口播/正文：xxxxx（80~150 字）\n落地页 CTA：xxxxx（一句话）\n\n【文案2·卖点角度】\n...\n\n【文案3·卖点角度】\n...\n\n要求：\n- 不要 markdown 加粗\n- 标题要钩，比如疑问/反差/痛点\n- 口播口语化，不要书面语\n- 三条角度差异化（如：痛点对比 / 效果震撼 / 性价比 / 社交场景 / 时间紧迫）` },
      { role: 'user', content: `素材信息：\n- 素材 ID：${materialId}\n${fileName ? `- 文件名：${fileName}\n` : ''}- 投放场景：${scene}\n\n请生成 3 条不同卖点角度的投放文案变体。` },
    ];

    const r = await callDeepSeek(messages);
    if (!r.ok) return res.json({ ok: false, error: r.error || 'ai_failed' });

    const text = r.content || '';
    const blocks = [];
    const re = /【文案\s*\d+[·\.\s]*([^】]*)】\s*\n([\s\S]*?)(?=【文案|\s*$)/g;
    let m;
    while ((m = re.exec(text))) {
      blocks.push({
        angle: m[1].trim(),
        content: m[2].trim(),
      });
    }
    if (!blocks.length) blocks.push({ angle: 'AI 推荐', content: text.trim() });

    res.json({ ok: true, materialId, blocks, tokensUsed: r.usage?.total_tokens || 0 });
  });

  // POST /api/v6/oc/title-rewrite { items: [{id, name}] }
  // 基于素材原文件名批量改写为爆款标题（每条返回 3 个候选）
  app.post('/api/v6/oc/title-rewrite', v6AuthRequired, async (req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 10) : [];
    if (!items.length) return res.status(400).json({ ok: false, error: 'no_items' });

    const namesText = items.map((it, i) => `${i + 1}. [ID:${it.id}] 原文件名：${it.name}`).join('\n');

    const TITLE_RULES = `
【仕净品牌投放素材标题改写规则】（必须遵守）
1. 服务：男士胡须管理（用进口胡须去除仪 + 纳米毛囊休眠技术）
2. 体验价：388 元一次（一口价），单次去 70-80%，2-3 次基本不长，做完当场见效
3. 风格：直接、有钩子、痛点 + 利益点 + 紧迫感（适合短视频/信息流）
4. 字数：8~22 字最佳（信息流标题展示限制）
5. 钩子手法：疑问 / 反差 / 数字冲击 / 痛点直击 / 时间紧迫 / 同辈压力
6. 禁用词：永久去除、保证一辈子不长、比医美强、永不复发、根治
7. 不要"标题党"过头，要符合男士理性受众语气，避免娘炮
`;

    const messages = [
      { role: 'system', content: `你是仕净（男士胡须管理）品牌的爆款投放素材标题改写专家。任务：基于一批已上线素材的原始文件名，每条改写为 3 个不同钩子角度的爆款标题候选。\n\n${TITLE_RULES}\n\n输出格式（严格 JSON，不要 markdown 不要解释）：\n[\n  {"id": "原ID", "original": "原文件名", "titles": ["改写1", "改写2", "改写3"]},\n  ...\n]\n\n要求：\n- 三个标题角度差异化（如：疑问钩 / 痛点反差 / 数字冲击）\n- 不要复制原文件名，要重写为投放标题\n- 8~22 字\n- 输出严格 JSON 数组，可被 JSON.parse 直接解析` },
      { role: 'user', content: `请基于以下素材批量改写标题：\n\n${namesText}` },
    ];

    const r = await callDeepSeek(messages);
    if (!r.ok) return res.json({ ok: false, error: r.error || 'ai_failed' });

    let parsed = [];
    const text = (r.content || '').trim();
    try {
      // 兼容 markdown 包裹
      const match = text.match(/\[[\s\S]*\]/);
      const jsonText = match ? match[0] : text;
      parsed = JSON.parse(jsonText);
    } catch (e) {
      // 解析失败兜底
      return res.json({
        ok: true,
        results: items.map(it => ({ id: it.id, original: it.name, titles: ['(AI 返回格式异常，请重试)'] })),
        rawText: text.slice(0, 500),
        totalTokens: r.usage?.total_tokens || 0,
      });
    }

    // 校验 + 兜底缺失项
    const idMap = new Map(items.map(it => [String(it.id), it.name]));
    const results = items.map(it => {
      const found = parsed.find(p => String(p.id) === String(it.id));
      return {
        id: it.id,
        original: it.name,
        titles: (found && Array.isArray(found.titles)) ? found.titles.slice(0, 3) : ['(无返回)'],
      };
    });

    res.json({ ok: true, results, totalTokens: r.usage?.total_tokens || 0 });
  });

  console.log('[v6-creatives] mounted: accounts, materials, materials/refresh, material-copy, title-rewrite');
};
