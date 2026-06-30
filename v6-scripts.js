/**
 * v6 话术系统 - 智能搜索 + DeepSeek AI 兜底
 *
 * 设计理念：
 * - 客服日常使用：搜一下 → 直接出最相关的话术卡 → 一键复制
 * - 不再按章节硬罗列大段文本
 * - SOP / 培训 / 流程 → 移到「学习专区」，仅新人入职用
 * - 考核 / 提成 → 不放进来（管理性内容，不是客服日常工具）
 * - 库内搜不到 → 调用 DeepSeek AI 基于品牌口径 + 现有话术库做"语义生成"
 *
 * 数据：基于 scripts-handbook.md 解析，但拆成离散的「话术卡片」
 */
const path = require('path');
const fs = require('fs');
const https = require('https');

// DeepSeek API key（仅 dev 环境，生产应改用 env var）
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'sk-f43d89b238ad4d71a6abccee8b038fcd';

module.exports = function(app, db) {
  const ROOT = __dirname;
  let _cache = null;

  // 把整个手册解析成离散卡片
  function parseHandbook() {
    const f = path.join(ROOT, 'scripts-handbook.md');
    if (!fs.existsSync(f)) return { cards: [], learning: [] };
    const md = fs.readFileSync(f, 'utf8');

    const cards = []; // 客服直接用的话术卡
    const learning = []; // 学习专区（SOP/原则/流程）

    // 切大章节
    const lines = md.split('\n');
    let chapter = null;
    let buf = [];
    const chapters = [];
    for (const line of lines) {
      const m = line.match(/^##\s+(.+)$/);
      if (m) {
        if (chapter) chapters.push({ title: chapter, content: buf.join('\n') });
        chapter = m[1].trim();
        buf = [];
      } else {
        buf.push(line);
      }
    }
    if (chapter) chapters.push({ title: chapter, content: buf.join('\n') });

    let cardId = 1;

    for (const ch of chapters) {
      const t = ch.title;

      // ========== 客服日常话术（卡片化）==========

      // 章节五 Q&A → 每个 Q 一张卡
      if (/客户高频问答|Q&A|^五、/.test(t)) {
        // Q 块以 #### Q[N]·"..." 开头
        const blocks = ch.content.split(/(?=^####\s+Q\d+)/m);
        for (const block of blocks) {
          const headMatch = block.match(/^####\s+(Q\d+[·\.]\s*)?[""]?(.+?)[""]?(?:\s*[（(].*?[)）])?\s*$/m);
          if (!headMatch) continue;
          const question = headMatch[2].replace(/[""]/g, '').trim();
          // 提取引用块（> 开头的内容才是话术本体）
          const lines = block.split('\n').slice(1);
          const quote = [];
          let inQuote = false;
          for (const ln of lines) {
            if (ln.startsWith('####') || ln.startsWith('---')) break;
            if (ln.startsWith('> ⚠️')) continue; // 跳过运营注释
            if (ln.startsWith('>')) {
              inQuote = true;
              quote.push(ln.replace(/^>\s?/, '').replace(/\*\*/g, '').replace(/\\\s*$/, ''));
            } else if (inQuote && ln.trim() === '') {
              quote.push('');
            }
          }
          const content = quote.join('\n').trim();
          if (!content || !question) continue;
          cards.push({
            id: 'qa_' + (cardId++),
            category: '常见问答',
            categoryColor: '#0050ff',
            scene: '客户问问题',
            title: question,
            content: content,
            keywords: extractKeywords(question + ' ' + content),
            chapter: t,
          });
        }
      }

      // 章节七 跟进激活 → 每条 # 编号一张卡
      else if (/跟进激活|^七、/.test(t)) {
        const blocks = ch.content.split(/(?=^####\s+#\d+)/m);
        for (const block of blocks) {
          const idMatch = block.match(/^####\s+#(\d+)\s*(?:[（(](.+?)[)）])?/m);
          if (!idMatch) continue;
          const num = idMatch[1];
          const titleNote = (idMatch[2] || '').replace(/\*\*/g, '');
          const lines = block.split('\n').slice(1);
          const quote = [];
          let scene = '';
          for (const ln of lines) {
            if (ln.startsWith('####') || ln.startsWith('---') || ln.startsWith('### ')) break;
            if (ln.startsWith('> （场景：') || ln.startsWith('>（场景：')) {
              scene = ln.replace(/^>\s*[（(]场景[:：]/, '').replace(/[)）]\s*$/, '').trim();
              continue;
            }
            if (ln.startsWith('>')) {
              quote.push(ln.replace(/^>\s?/, '').replace(/\*\*/g, '').replace(/\\\s*$/, ''));
            } else if (quote.length && ln.trim() === '') {
              quote.push('');
            }
          }
          const content = quote.join('\n').trim();
          if (!content) continue;
          // 第一行做标题
          const firstLine = content.split('\n')[0].slice(0, 30);
          cards.push({
            id: 'gz_' + (cardId++),
            category: '跟进激活',
            categoryColor: '#e67700',
            scene: scene || titleNote || '群发跟进',
            title: titleNote || firstLine,
            content: content,
            keywords: extractKeywords(scene + ' ' + content + ' ' + titleNote),
            number: num,
            chapter: t,
          });
        }
      }

      // 章节八 节假日活动 → 每个节日一张卡
      else if (/节假日|^八、/.test(t)) {
        const blocks = ch.content.split(/(?=^###\s+8\.\d+)/m);
        for (const block of blocks) {
          const headMatch = block.match(/^###\s+8\.\d+\s+(.+?)(?:\s*[（(].*?[)）])?\s*$/m);
          if (!headMatch) continue;
          const holiday = headMatch[1].replace(/\*\*/g, '').trim();
          const lines = block.split('\n').slice(1);
          const quote = [];
          for (const ln of lines) {
            if (ln.startsWith('### ') || ln.startsWith('---')) break;
            if (ln.startsWith('>')) {
              quote.push(ln.replace(/^>\s?/, '').replace(/\*\*/g, ''));
            } else if (quote.length && ln.trim() === '') {
              quote.push('');
            }
          }
          const content = quote.join('\n').trim();
          if (!content) continue;
          cards.push({
            id: 'jr_' + (cardId++),
            category: '节假日活动',
            categoryColor: '#c92a2a',
            scene: holiday,
            title: holiday + ' 活动话术',
            content: content,
            keywords: extractKeywords(holiday + ' ' + content),
            chapter: t,
          });
        }
      }

      // 章节六 朋友圈/视频号文案 → 每条一张卡
      else if (/宣传利益点话术变体|朋友圈|视频号|^六、/.test(t)) {
        // 按 ### 切
        const blocks = ch.content.split(/(?=^###\s+)/m);
        for (const block of blocks) {
          const headMatch = block.match(/^###\s+(.+)$/m);
          if (!headMatch) continue;
          const title = headMatch[1].replace(/\*\*/g, '').trim();
          // 拿引用块
          const lines = block.split('\n').slice(1);
          const items = [];
          let cur = [];
          for (const ln of lines) {
            if (ln.startsWith('### ')) break;
            if (ln.startsWith('>')) {
              cur.push(ln.replace(/^>\s?/, '').replace(/\*\*/g, ''));
            } else if (cur.length && ln.trim() === '') {
              if (cur.length) items.push(cur.join('\n').trim());
              cur = [];
            }
          }
          if (cur.length) items.push(cur.join('\n').trim());
          items.filter(x=>x).forEach((content, i) => {
            cards.push({
              id: 'ad_' + (cardId++),
              category: '朋友圈/文案',
              categoryColor: '#5f3dc4',
              scene: title,
              title: title + ' #' + (i+1),
              content: content,
              keywords: extractKeywords(title + ' ' + content),
              chapter: t,
            });
          });
        }
      }

      // ========== 学习专区（新人/原则/流程）==========
      else if (/品牌定位|禁用词|^一、/.test(t)) {
        learning.push({ id: 'l1', title: '品牌定位与禁用词（必读）', icon: '⚠️', content: ch.content.trim() });
      }
      else if (/价格体系|^二、/.test(t)) {
        learning.push({ id: 'l2', title: '价格体系（背熟）', icon: '💰', content: ch.content.trim() });
      }
      else if (/宣传利益点|6 大|6大|^三、/.test(t)) {
        learning.push({ id: 'l3', title: '6 大宣传利益点', icon: '✨', content: ch.content.trim() });
      }
      else if (/常规咨询接待|接待 SOP|^四、/.test(t)) {
        learning.push({ id: 'l4', title: '常规咨询接待 SOP', icon: '📋', content: ch.content.trim() });
      }
      else if (/一日工作|^九、/.test(t)) {
        learning.push({ id: 'l9', title: '客服一日工作 SOP', icon: '⏰', content: ch.content.trim() });
      }
      else if (/新人.*培训|3 天上岗|^十、/.test(t)) {
        learning.push({ id: 'l10', title: '新人 3 天上岗培训', icon: '🎓', content: ch.content.trim() });
      }
      else if (/最后说五句话|^十三、/.test(t)) {
        learning.push({ id: 'l13', title: 'V5 关键铁律（5 句话）', icon: '🔑', content: ch.content.trim() });
      }
      // 章节十一 考核 → 不放
      // 章节十二 附录 → 不放
      // 章节 整体工作流 → 不放（一图看懂，无文本可用）
    }

    return { cards, learning };
  }

  function extractKeywords(text) {
    if (!text) return [];
    // 简单提取中文 2~6 字片段做关键词种子
    const stop = new Set(['一下', '我们', '可以', '什么', '怎么', '一个', '这个', '那个', '不会', '不是', '就是']);
    const words = [];
    const text2 = text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ');
    for (const seg of text2.split(/\s+/)) {
      if (!seg) continue;
      if (seg.length >= 2 && seg.length <= 8 && !stop.has(seg)) {
        words.push(seg.toLowerCase());
      }
    }
    return [...new Set(words)];
  }

  function loadCache() {
    if (!_cache) _cache = parseHandbook();
    return _cache;
  }

  function v6CsAuth(req, res, next) {
    if (!req.v6User) return res.status(401).json({ ok: false, error: 'unauthorized' });
    if (req.v6User.role !== 'cs' && req.v6User.role !== 'hq' && req.v6User.role !== 'store') {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    next();
  }

  // 全部话术卡 + 学习专区
  app.get('/api/v6/scripts/all', v6CsAuth, (req, res) => {
    const c = loadCache();
    res.json({
      ok: true,
      cards: c.cards,
      learning: c.learning,
      stats: {
        total: c.cards.length,
        byCategory: c.cards.reduce((m, x) => { m[x.category] = (m[x.category]||0) + 1; return m; }, {}),
      },
    });
  });

  // 同义词映射（让客服用大白话搜也能命中）
  const SYNONYMS = {
    '价格': ['388', '1280', '体验', '套餐', '多少钱', '便宜', '贵', '划算'],
    '多少钱': ['388', '1280', '体验', '价格', '套餐'],
    '贵': ['388', '1280', '价格', '便宜'],
    '便宜': ['388', '1280', '划算', '价格'],
    '效果': ['效果', '看到', '当场', '保持', '不长', '维持'],
    '安全': ['副作用', '皮肤', '损伤', '留疤', '色素', '过敏'],
    '副作用': ['安全', '皮肤', '损伤', '留疤'],
    '疼': ['疼痛', '感觉', '冷感', '痛'],
    '时间': ['多久', '40 分钟', '40分钟', '一次', '小时'],
    '多久': ['时间', '40 分钟', '40分钟', '一次', '小时'],
    '会不会再长': ['再长', '不长', '永久', '维持', '保持'],
    '再长': ['不长', '会不会再长', '维持', '保持'],
    '一次': ['388', '体验', '次数', '几次'],
    '几次': ['2-3 次', '次数', '一次', '388'],
    '次数': ['2-3 次', '一次', '几次'],
    '回访': ['跟进', '群发', '激活', '锁单', '路费'],
    '跟进': ['回访', '群发', '激活', '锁单', '路费'],
    '群发': ['跟进', '回访', '激活', '锁单'],
    '锁单': ['路费', '红包', '名额', '今天', '紧迫'],
    '红包': ['锁单', '路费', '8 块', '10 块'],
    '路费': ['锁单', '红包', '补贴'],
    '到店': ['约访', '面诊', '档期', '预约'],
    '设备': ['进口', '纳米', '技术', '原理'],
    '技术': ['设备', '进口', '纳米', '原理'],
    '区别': ['不一样', '设备', '品牌', '连锁', '正规'],
    '皮肤病': ['敏感肌', '痤疮', '可以做'],
    '敏感肌': ['皮肤病', '可以做'],
    '复购': ['老客户', '回头', '巩固'],
    '老客户': ['复购', '回头'],
    '元旦': ['新年', '春节'],
    '春节': ['新年', '元旦', '过年'],
    '过年': ['春节', '新年'],
  };

  function expandQuery(q) {
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    const expanded = new Set(tokens);
    for (const tok of tokens) {
      if (SYNONYMS[tok]) {
        SYNONYMS[tok].forEach(s => expanded.add(s.toLowerCase()));
      }
      // 部分匹配
      for (const key of Object.keys(SYNONYMS)) {
        if (tok.includes(key) || key.includes(tok)) {
          SYNONYMS[key].forEach(s => expanded.add(s.toLowerCase()));
        }
      }
    }
    return [...expanded];
  }

  // 搜索话术
  app.get('/api/v6/scripts/search', v6CsAuth, (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const cat = String(req.query.category || '').trim();
    const c = loadCache();
    let results = c.cards;
    if (cat) results = results.filter(x => x.category === cat);
    if (q) {
      const tokens = expandQuery(q);
      const originalTokens = q.split(/\s+/).filter(Boolean);
      results = results.map(card => {
        const haystack = (card.title + ' ' + card.content + ' ' + card.scene + ' ' + card.keywords.join(' ')).toLowerCase();
        let score = 0;
        // 原始 token 高分
        for (const tok of originalTokens) {
          if (!tok) continue;
          if (card.title.toLowerCase().includes(tok)) score += 20;
          if (card.scene && card.scene.toLowerCase().includes(tok)) score += 10;
          if (haystack.includes(tok)) score += 6;
        }
        // 同义词扩展低分（防止"扩展词"喧宾夺主）
        for (const tok of tokens) {
          if (!tok) continue;
          if (originalTokens.includes(tok)) continue;
          if (haystack.includes(tok)) score += 2;
        }
        return { card, score };
      }).filter(r => r.score > 0).sort((a, b) => b.score - a.score).map(r => r.card);
    }
    res.json({
      ok: true,
      query: q,
      category: cat,
      total: results.length,
      cards: results.slice(0, 30),
    });
  });

  // 学习专区单条
  app.get('/api/v6/scripts/learning/:id', v6CsAuth, (req, res) => {
    const c = loadCache();
    const item = c.learning.find(x => x.id === req.params.id);
    if (!item) return res.status(404).json({ ok: false, error: 'not_found' });
    res.json({ ok: true, item });
  });

  // ========== AI 兜底生成（DeepSeek）==========
  // POST /api/v6/scripts/ai-generate { customerSay: '客户原话', context: '可选场景' }
  // 返回：3 条候选话术（基于品牌口径 + 现有话术库 few-shot）
  function callDeepSeek(messages) {
    return new Promise((resolve) => {
      const body = JSON.stringify({
        model: 'deepseek-chat',
        messages,
        temperature: 0.7,
        max_tokens: 1200,
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
            if (j.choices && j.choices[0]) {
              resolve({ ok: true, content: j.choices[0].message.content, usage: j.usage });
            } else {
              resolve({ ok: false, error: j.error?.message || 'no_choice', raw: j });
            }
          } catch (e) { resolve({ ok: false, error: 'parse_error', body: buf.slice(0, 500) }); }
        });
      });
      req.on('error', e => resolve({ ok: false, error: e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
      req.write(body);
      req.end();
    });
  }

  app.post('/api/v6/scripts/ai-generate', v6CsAuth, async (req, res) => {
    const customerSay = String(req.body?.customerSay || req.body?.q || '').trim();
    const context = String(req.body?.context || '').trim();
    if (!customerSay) return res.status(400).json({ ok: false, error: 'missing_customerSay' });

    const c = loadCache();
    // 取库内最相关的 5 条作为 few-shot 参考（让 AI 学品牌口径）
    const lower = customerSay.toLowerCase();
    const ranked = c.cards.map(card => {
      let s = 0;
      const hay = (card.title + ' ' + card.content + ' ' + card.scene).toLowerCase();
      for (const tok of lower.split(/\s+/)) {
        if (tok && hay.includes(tok)) s += 5;
      }
      return { card, s };
    }).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 5).map(x => x.card);

    const fewShot = ranked.length
      ? `下面是品牌话术库里几条相关参考（学习语气、口径、结构）：\n${ranked.map((r, i) => `【参考${i+1}】场景：${r.scene}\n${r.content}`).join('\n\n---\n\n')}`
      : '';

    // 关键品牌口径（V5 铁律）
    const BRAND_RULES = `
品牌口径（V5 关键铁律，必须遵守）：
1. 我们做"男士胡须管理"，进口胡须去除仪 + 纳米毛囊休眠技术（不要说"脱毛"）
2. 体验价 388 / 单次（一口价），不要主动报巩固价 200/次或总价
3. 单次去 70-80% 胡子，2-3 次基本不长
4. 当场就能看到效果，做完皮肤更干净
5. 做一次约 40 分钟，无副作用，做完正常生活不需特别注意
6. 全国连锁品牌，已服务上万名男士
7. 路费补贴第二天才发，首日不主动提
8. 锁单用 8 元/10 元红包 + "名额今天剩 X 个"紧迫感
9. 禁用词："永久去除""保证一辈子不长""比医美强"——只能说"基本不长/做完很少回来补"
10. 语气：哥/兄弟，直接、不绕弯，emoji ≤ 3 个`;

    const messages = [
      { role: 'system', content: `你是仕净（男士胡须管理）品牌客服话术专家。任务：根据客户原话，生成 3 条不同风格的回复话术（直接发给客户用）。\n\n${BRAND_RULES}\n\n输出格式（严格按此格式）：\n【话术1·风格名】\n（话术内容，可换行）\n\n【话术2·风格名】\n（话术内容）\n\n【话术3·风格名】\n（话术内容）\n\n要求：\n- 每条 50~150 字\n- 不要 markdown 加粗符号\n- 直接是发给客户的口语，不要解释` },
      ...(fewShot ? [{ role: 'user', content: fewShot }, { role: 'assistant', content: '已学习品牌话术口径。' }] : []),
      { role: 'user', content: `客户原话："${customerSay}"${context ? `\n场景：${context}` : ''}\n\n请生成 3 条不同风格的回复话术。` },
    ];

    const r = await callDeepSeek(messages);
    if (!r.ok) {
      return res.json({ ok: false, error: r.error || 'ai_failed', message: 'AI 调用失败：' + (r.error || '') });
    }

    // 解析 3 条话术（兼容多种格式）
    const text = r.content || '';
    const cards = [];
    const blockRegex = /【话术\s*\d+[·\.\s]*([^】]*)】\s*\n([\s\S]*?)(?=【话术|\s*$)/g;
    let m;
    while ((m = blockRegex.exec(text))) {
      const style = m[1].trim() || `候选 ${cards.length + 1}`;
      const content = m[2].trim().replace(/^\(\(|\)\)$/g, '').replace(/^\(|\)$/g, '');
      if (content) cards.push({
        id: 'ai_' + Date.now() + '_' + cards.length,
        category: 'AI 生成',
        categoryColor: '#7c3aed',
        scene: '基于客户原话生成',
        title: style,
        content,
        keywords: [],
        aiGenerated: true,
      });
    }
    if (!cards.length) {
      // 兜底：整段返回
      cards.push({
        id: 'ai_' + Date.now(),
        category: 'AI 生成',
        categoryColor: '#7c3aed',
        scene: '基于客户原话生成',
        title: 'AI 推荐回复',
        content: text.trim(),
        keywords: [],
        aiGenerated: true,
      });
    }

    res.json({
      ok: true,
      customerSay,
      cards,
      tokensUsed: r.usage?.total_tokens || 0,
      referenceCount: ranked.length,
    });
  });

  console.log('[v6-scripts] mounted: /api/v6/scripts/{all,search,learning/:id,ai-generate,coach/chat,coach/summary}');

  // ========== AI 销售教练 LILI（门店面销训练 + 自我进化）==========
  // 业务前提：顾客线上 388 体验价到店 → LILI 在门店现场升单到套餐（2680~6680）
  // 训练受众：所有员工（新手能用、老手能进阶）
  // 进化机制：训练沉淀金句到 shijing_coach_moves 表，下次同类型顾客自动注入

  // 建招式库表（金句沉淀）
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS shijing_coach_moves (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      createdAt INTEGER DEFAULT (strftime('%s','now')*1000)
    )`);
  } catch (e) { console.warn('[coach] create table failed:', e.message); }

  // 套餐价表（写死 system prompt 里）
  const PACKAGES = `
门店套餐价表（必须熟记）：
- 唇周：单次 680，5 次总价 3400，会员包干套餐价 2680（立省 720）
- 下巴：单次 880，5 次总价 4400，会员包干套餐价 3280（立省 1120）
- 造型胡子：单次 1280，5 次总价 6400，会员包干套餐价 4880（立省 1520）
- 络腮胡：单次 1680，6 次总价 10080，会员包干套餐价 6680（立省 3400）
- 组合升单常用：唇周+下巴 = 5960、全脸（造型胡子）= 4880、全部（络腮胡）= 6680
- 顾客起点：已付 388 体验价到店，388 是钩子不是目的
- 升单目标：让顾客现场办任意一档套餐 = 标准胜利；办全脸/络腮胡 = 完美胜利`;

  // 高级感塑造话术库（让顾客觉得值钱）
  const PREMIUM_NARRATIVE = `
仕净技术差异化叙事（讲原理 + 解释价格时一定要说出来的高级感支撑）：

【一、和普通脱毛/激光的本质区别——制造高级感】
不要直接说"我们更好"，要让顾客自己得出结论：
- 普通脱毛膏 / 刮胡刀：只切表层，2-3 天就回潮，越刮越粗
- 商场激光（冰点/半导体）：那个针对女性细毛设计的，男士胡须毛囊比女性体毛粗 3 倍、深 2 倍，激光打不透根部
- 美容院光子嫩肤："那个是处理皮肤色斑，跟胡子毛囊根本两回事"
- 仕净【纳米靶向毛囊休眠技术】：进口胡须专用仪，针对男士粗硬黑胡的能量频谱定制，直接作用到毛囊深层让它"睡着"，不是切表面
关键句式："哥您之前可能也试过激光对吧？那个本来就不是给男士胡子设计的，所以做了没什么变化是正常的"

【二、为什么不同部位价格不一样——成本透明话术】
不要回避价格问题，把【耗材成本】讲透，顾客才觉得贵得有道理：
- 关键概念：【靶条/能量贴片/导能介质】是核心耗材，单次操作要消耗 1-2 片（具体数量根据部位面积决定）
- 唇周（680/次）：面积小、毛囊密，1 片靶条 + 标准能量
- 下巴（880/次）：面积稍大，1.5 片靶条
- 造型胡子（1280/次）：全脸造型，2 片靶条 + 双倍能量
- 络腮胡（1680/次）：面积最大、毛囊最深，2-3 片靶条 + 最高能量等级
关键句式：
- "哥您不知道我们这个靶条多贵——它是进口的，做一片就要换，能量打透了它就废了"
- "您觉得贵其实是因为咱们【消耗大】——消耗大才有效果，不消耗哪来的效果"
- "络腮胡这一片下来要消耗 3 片靶条，单成本就要 XX，再加上仪器折旧、技师工时、店租"
- "市面上那种几十块的，您仔细想——他用什么成本给您做？"

【三、塑造稀缺感和高级感的话术参考】
- "咱们不是天天做的，仪器一天就操作 X 个号，您今天能预约上是赶上时间了"
- "我们这个仪器全国总共就 XX 台，进货还排队"
- "您看咱们这个不像隔壁美容院那种流水线——一对一专人服务"
- "您身边做过激光的朋友，让他来我们这看看效果，他立马知道差别"
- "388 是给新客交个朋友，咱们家其实正常一次都是 880-1680 起的"

【四、价值类比（让顾客觉得"这是投资不是消费"）】
- "您一年理发多少钱？2000 都打不住吧？理发是修外观，咱们这个是改根本"
- "这个钱跟买个名牌外套差不多，但形象的提升不止穿那一次"
- "护肤品您一年也得花几千吧？那个是养皮肤表面，咱们这个是直接解决您下颌这一块"

⚠️ 表达原则：
- 高级感 = 让顾客感觉【这是稀缺的、专业的、贵得有道理】
- 不要直接说"我们最好""我们最专业"——要用【对比 + 成本 + 稀缺 + 类比】让顾客自己得出结论
- 不要诋毁同行，但要把"普通脱毛/激光不适合男胡"这一点讲透
- 涉及效果数字别打死："基本不长""很少回来补"，避免"永久去除""保证一辈子"`;

  // 销售十步法（LILI 默念的剧本，覆盖：咨询 → 操作 → 升单 完整流程）
  const EIGHT_STEPS = `
LILI 销售十步法（在心里默念，按节奏推进，不是机械复述）：

【一、咨询阶段（顾客刚到店还没操作）】
1. 赞美开场：第一眼夸顾客（下颌线/精神面貌/穿搭）→ 解防御
2. 找共同点：闲聊套老乡/职业/年龄/家庭，找一个连接点 → 建情绪同盟
3. 原理 + 效果讲解【咨询核心】：顾客落座后用通俗话讲清楚仕净是怎么做的、为什么有效、单次能去多少、几次基本不长。让顾客【对效果有预期】，不要堆专业名词
   - 关键：让顾客【自己开口问"那我可以试试看吗"】再往下走
   - 不要急着推套餐，先让顾客认可技术
4. 询问顾客需求 + 套出身份：哥您主要想处理哪一块（唇周/下巴/全脸/络腮）？为什么想做？什么时候用？
   - 套出身份信息（做什么工作、单身/已婚、为什么要做）→ 为后续价值锚定弹药
   - 听到关键信息要复述确认，让顾客感受到"被听见"

【二、操作阶段（388 体验进行中）】
5. 操作中闲聊深化：手上做着事嘴上不停，深化关系，顾客在放松状态下话最多
6. 中场效果展示 ★ 关键转折（合规说法）：
   操作进行到一半时（左侧已做完、右侧还没做），先暂停拿镜子让顾客自己看
   ——左边干净清爽 vs 右边胡茬还在的【中场对比】，制造差距感冲击
   引导顾客自己说出"全部做完会更精神"
   重要：388 包含全脸完整操作，绝对不能只做一半就停（强迫交易违法）。"中场展示"只是【操作流程中的一个心理触发瞬间】，展示完继续完成全部操作

【三、升单阶段（388 全部做完之后）】
7. 人生价值锚定 ★【核心】：基于第4步套出的身份，对症下药算"价值账"，不是"价格账"：
   - 销售/服务业：客户第一眼信任三分，多签多少单？
   - 单身相亲：异性看下颌干净的男人加分最高，找对象成功率
   - 已婚：老婆喜欢、孩子说"爸爸帅"
   - 35+ 油腻焦虑：显年轻 5 岁、控制衰老感
   - 找工作/换工作：面试官第一印象、客户拜访的形象资产
8. 套餐组合推荐：根据顾客需求精准推荐，不要乱推
   - 只关注唇周 → 唇周 2680
   - 唇周 + 下巴都重 → 组合 5960 或推造型胡子 4880（"全脸更划算"）
   - 络腮胡浓密 → 直接推 6680（"省 3400 是这里最大优惠"）
9. 临门一脚：
   - 强势型用紧迫感（"今天下单送下次预约/今天活动名额还有X个"）
   - 温柔型用反向松绑（"今天不办没关系，但您先看看这价格能省多少"）
   - 有路费的钩第二天才发
10. 锁价小定兜底 ★【最后一道闸】：顾客实在不下决心，让他付 100/300/500 锁活动价
    - 重度抗拒：100 元（"哥就当请我喝咖啡，今天活动价给您留 7 天"）
    - 中度犹豫：300 元（"今天活动名额有限，您 300 先把名额占了"）
    - 轻度纠结：500 元（"先付 500 抵 1000，5 倍抵扣"）
    - 关键句："您先小定，回去想清楚不来我无息退"打消最后防御

⚠️ 节奏铁律：必须从咨询开始（步骤 1-4），不要跳过咨询直接拿镜子做对比。
顾客刚到店还没操作时，你的第一句话应该是【迎客赞美 + 引导落座咨询】，而不是【拿镜子看效果】。
开场示例（顾客刚到店）：
"哥您来了，请这边坐~（递水）我看您下颌线挺利落的，主要是想处理哪一块？我先跟您讲讲咱们家的原理，您看看能不能解决您的问题。"

⚠️ 合规红线（必须遵守）：
- 388 是全脸完整体验，必须做完整流程，绝不允许"只做一半就停"
- "中场对比"是操作流程内的展示瞬间，不是要挟手段
- 锁价小定必须是顾客自愿，且明确告知"无息可退"`;

  // 加载累积的金句库（按顾客类型筛选 top 6）
  function loadCoachMoves(customerProfile, limit = 6) {
    try {
      const rows = db.prepare("SELECT data FROM shijing_coach_moves ORDER BY createdAt DESC LIMIT 200").all();
      const moves = rows.map(r => JSON.parse(r.data));
      const lower = (customerProfile || '').toLowerCase();
      // 按相似度打分：profile 关键词重合 + 高胜率 + 较新
      const scored = moves.map(m => {
        let s = 0;
        if (m.profile && lower) {
          const pl = m.profile.toLowerCase();
          for (const tok of lower.split(/[\s\/、，,]+/)) {
            if (tok && pl.includes(tok)) s += 5;
          }
        }
        if (m.outcome === '完美胜利') s += 4;
        else if (m.outcome === '标准胜利') s += 2;
        else if (m.outcome === '兜底胜利') s += 1;
        return { m, s };
      }).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit).map(x => x.m);
      return scored;
    } catch (e) { return []; }
  }

  function buildCoachSystemPrompt(stage, customerProfile, mode) {
    const c = loadCache();
    // 只取「常见问答」前 8 张做产品知识参考（不再喂跟进激活、不再硬塞品牌口径）
    const refCards = (c.cards || []).filter(x => x.category === '常见问答').slice(0, 8);
    const refText = refCards.length
      ? `产品知识参考（顾客问到时心里有数，不要硬背给员工）：\n${refCards.map((r, i) => `- ${r.title}：${r.content.slice(0, 120)}`).join('\n')}`
      : '';

    // 招式库注入（自我进化）
    const moves = loadCoachMoves(customerProfile);
    const movesText = moves.length
      ? `\n\n【过往金句库】（同类顾客训练沉淀的高胜率金句，可化用）：\n${moves.map((m, i) => `★ ${m.move || m.keyLine || ''}（${m.style || ''}）`).filter(x => x.replace(/[★（）\s]/g, '')).slice(0, 6).join('\n')}`
      : '';

    if (mode === 'reverse') {
      // 反训：员工演销售，LILI 演顾客
      return `你是【顾客】，刚刚被仕净的 388 体验价吸引到店，但还没开始操作，正坐在店里听销售（员工扮演）介绍。

# 你的顾客身份
${customerProfile || '一位犹豫纠结、对价格敏感、担心效果的男士到店顾客'}

# 你的目标
像真实顾客一样**步步设防**：你只是好奇 388 想试试，本来就没打算办套餐。员工要做销售把你拿下，你要：
- 咨询阶段：质疑原理（"真的有用吗""会不会反弹""跟刮胡刀有什么区别"）、试探效果（"几次能去干净"）、装作有所保留
- 听原理时偶尔点头但不轻易表态
- 同意操作前：要确认没附加费、不被强推
- 操作中：偶尔提疑问（"这个不疼吧""会不会过敏"）、闲聊但保持戒心
- 看到中场效果后：可以表现出有点动心但嘴硬（"还行吧""一边干净也挺奇怪的"）
- 升单环节：找各种理由不办套餐（贵 / 改天 / 问老婆 / 再考虑 / 我朋友说不要冲动消费）
- 但如果员工话术真的打动你，可以慢慢被说服（不要太快，也别死扛）
- 如果员工卡壳超过 2 轮明显接不上，你跳出顾客身份用【LILI 提示】开头给一句具体话术建议（50 字内），然后回到顾客身份

# 训练起点（重要）
你刚到店，还没开始操作。你的第一句话应该是【刚进门或刚坐下时的状态】，比如：
- "你好，我是看朋友圈来的，388 这个具体怎么做？"
- "（坐下）就是想看看，还没决定做不做"
- "你们这个真的有用吗？我胡子挺重的"
不要一上来就说"做完了"或"我先走了"——那是操作完之后的事。

# 顾客回话风格
- 一次回复 ≤ 60 字，像真实门店对话
- 不要主动报手机号、不要主动配合
- 偶尔沉默不语 / 玩手机 / 看价格表皱眉

# 求建议触发
员工说"LILI 给我建议 / 我卡住了 / 这种情况怎么办"时，立刻跳出顾客身份用【LILI 提示】给具体话术。

${refText}

记住：你只是顾客，刚到店还没开始操作。先开场说一句类似"你好，我看朋友圈来的，388 这个怎么做？"试探员工怎么接。`;
    }

    // 正训：LILI 演销售，员工演顾客
    return `你是【LILI】，仕净门店的金牌销售姐姐。
- 5 年门店经验，月成交 50+ 单，平均客单价 5800
- 销售哲学：「不卖产品，卖差距感。让顾客自己看见自己缺了什么」
- 性格：温柔不油，专业不装，能聊能扛能逼单
- 员工正在扮演一位刚通过 388 体验价【到店还没开始操作】的【男顾客】，目标是把他升单到套餐（2680~6680）
- 你要在对话中**示范金牌销售从咨询 → 操作 → 升单的完整流程**，让员工通过观察学到一手成交技巧

# 当前顾客画像（员工扮演）
${customerProfile || '一位犹豫纠结、对价格敏感、担心效果的男士到店顾客'}

# 当前训练焦点
${stage || '完整销售流程：咨询 → 原理讲解 → 操作 → 中场对比 → 升单 / 锁价'}

# 训练起点（重要）
顾客刚到店，还没开始任何操作。你要从【咨询阶段】开始：
- 第一句先迎客 + 赞美 + 引导落座
- 然后讲解原理 + 效果（让顾客对效果有预期）
- 询问需求 + 套出身份信息
- 顾客同意做了再进入操作阶段
- 不要一上来就拿镜子看效果（那是操作中场才发生的事）

${PACKAGES}

${PREMIUM_NARRATIVE}

${EIGHT_STEPS}

# 回复格式约定
- 你说销售本人的话，自然口吻，不加前缀（前端会自动识别为 LILI 气泡）
- 一次回复 ≤ 100 字，让员工（顾客）有空间应对
- 不用 markdown 加粗，不用 emoji 超过 2 个
- 称呼顾客：哥 / 帅哥 / 您
- 必要时换行（短句更像真实聊天）
- 员工（顾客）说"LILI 给我建议 / 我卡住了"时，跳出销售身份用【LILI 提示】开头讲一句你的销售心法（50 字内），再回到销售身份继续

# 节奏掌控（重要）
按十步法节奏推进，前期不要急：
- 前 1-3 轮（咨询）：迎客 + 赞美 + 找共同点 + 讲原理 + 问需求 + 套身份
- 中期 4-6 轮（操作）：操作中闲聊深化 + 中场对比展示
- 后期 7+ 轮（升单）：价值锚定 + 套餐推荐 + 临门一脚 + 锁价兜底

${refText}${movesText}

记住：你是 LILI，从【咨询阶段】把顾客一步步带到现场拿下。
开场你先以销售身份说第一句迎客的话（顾客刚进店那一刻），让员工（顾客）接话开始训练。`;
  }

  // POST /api/v6/scripts/coach/chat
  // body: { messages, customerProfile, stage, mode: 'practice'|'reverse' }
  app.post('/api/v6/scripts/coach/chat', v6CsAuth, async (req, res) => {
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const customerProfile = String(req.body?.customerProfile || '').trim();
    const stage = String(req.body?.stage || '').trim();
    const mode = String(req.body?.mode || 'practice').trim();

    const sys = buildCoachSystemPrompt(stage, customerProfile, mode);
    const fullMessages = [
      { role: 'system', content: sys },
      ...messages,
    ];

    const r = await callDeepSeek(fullMessages);
    if (!r.ok) {
      return res.json({ ok: false, error: r.error || 'ai_failed' });
    }
    res.json({
      ok: true,
      reply: r.content,
      isCoachMode: /【LILI 提示】|【教练点评】/.test(r.content || ''),
      tokensUsed: r.usage?.total_tokens || 0,
    });
  });

  // POST /api/v6/scripts/coach/summary
  // 复盘 + 自动抽取金句入库（自我进化关键）
  app.post('/api/v6/scripts/coach/summary', v6CsAuth, async (req, res) => {
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const customerProfile = String(req.body?.customerProfile || '该顾客类型').trim();
    const mode = String(req.body?.mode || 'practice').trim();
    if (messages.length < 4) return res.json({ ok: false, error: 'too_short' });

    const dialog = messages.map(m => {
      // 正训：assistant 是 LILI 销售；user 是员工（顾客）
      // 反训：assistant 是 LILI 顾客；user 是员工（销售）
      const aLabel = mode === 'reverse' ? '【顾客 LILI】' : '【销售 LILI】';
      const uLabel = mode === 'reverse' ? '【员工(销售)】' : '【员工(顾客)】';
      return `${m.role === 'assistant' ? aLabel : uLabel}${m.content}`;
    }).join('\n');

    const sysPrompt = `你是 LILI 销售教练，刚刚完成了一段「${mode === 'reverse' ? '员工做销售 / LILI 演顾客' : '员工演顾客 / LILI 做销售示范'}」的训练对话（顾客画像：${customerProfile}）。请基于完整对话，做一次专业复盘。

输出格式（严格遵守小标题，不要 markdown 加粗符号）：

【一、本次顾客画像】
（一句话提炼：性格、关注点、决策模式、转折点）

【二、训练结果（重要）】
- 是否成交：完美胜利（办全脸/络腮胡）/ 标准胜利（任意基础套餐）/ 兜底胜利（100-500 锁价小定）/ 完全失败（只做 388 走了）
- 升到的档位 + 金额：
- 关键转折点：（哪一句让顾客松动）

【三、用了哪些招式（八步法对照）】
列出本次对话用到的步骤（赞美 / 找共同点 / 套身份 / 单边对比 / 价值锚定 / 套餐推荐 / 紧迫感 / 锁价小定），每个标注 ✓ 用了 / ✗ 没用
特别评估「价值锚定」用得对不对（是否基于顾客身份算了人生价值账）

【四、${mode === 'reverse' ? '员工销售表现评估' : '员工顾客扮演 + 观察笔记'}】
${mode === 'reverse'
  ? '- 做得好的地方：（2-3 条具体引用对话）\n- 需要改进的地方：（2-3 条具体引用对话）\n- 综合得分（0-100）：'
  : '- 顾客扮演真实度：\n- 从 LILI 身上学到的关键招式：（3 条最值得记的金句）'}

【五、本次最值得沉淀的金句】（重要，用于全员金句库）
最多 3 条，格式严格：
1. 招式类型：（赞美/共同点/价值锚定/套餐推荐/紧迫感/锁价小定/其他）
   原句："..."（不超过 60 字）
   适用场景：（描述什么情况下用）
2. ...
3. ...

【六、下次再遇这类顾客的 3 步打法】
（1 / 2 / 3 简洁，每条 30 字内）`;

    const r = await callDeepSeek([
      { role: 'system', content: sysPrompt },
      { role: 'user', content: '以下是本次训练完整记录：\n\n' + dialog },
    ]);
    if (!r.ok) return res.json({ ok: false, error: r.error });

    // 自动从复盘里抽金句入库
    const summary = r.content || '';
    let outcomeMatch = summary.match(/是否成交[：:]\s*([^\n]+)/);
    let outcome = outcomeMatch ? outcomeMatch[1].trim() : '';
    if (/完美胜利/.test(outcome)) outcome = '完美胜利';
    else if (/标准胜利/.test(outcome)) outcome = '标准胜利';
    else if (/兜底胜利/.test(outcome)) outcome = '兜底胜利';
    else outcome = '完全失败';

    // 抽金句段
    const movesSection = summary.match(/【五、本次最值得沉淀的金句】([\s\S]*?)(?=【六|$)/);
    const movesAdded = [];
    if (movesSection && outcome !== '完全失败') {
      const block = movesSection[1];
      const items = block.split(/\n\s*\d+\.\s+/).filter(x => x.trim());
      for (const item of items) {
        const styleM = item.match(/招式类型[：:]\s*([^\n]+)/);
        const lineM = item.match(/原句[：:]\s*["""'']?([^"""''\n]+)["""'']?/);
        const sceneM = item.match(/适用场景[：:]\s*([^\n]+)/);
        if (styleM && lineM) {
          const rec = {
            id: 'mv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            style: styleM[1].trim(),
            move: lineM[1].trim(),
            keyLine: lineM[1].trim(),
            scene: sceneM ? sceneM[1].trim() : '',
            profile: customerProfile,
            outcome,
            mode,
            uploaderId: req.v6User?.id,
            uploaderName: req.v6User?.realName,
            createdAt: Date.now(),
          };
          try {
            db.prepare("INSERT INTO shijing_coach_moves(id, data) VALUES(?, ?)").run(rec.id, JSON.stringify(rec));
            movesAdded.push(rec);
          } catch (e) {}
        }
      }
    }

    res.json({
      ok: true,
      summary,
      outcome,
      movesAdded: movesAdded.length,
      tokensUsed: r.usage?.total_tokens || 0,
    });
  });

  // GET /api/v6/scripts/coach/moves - 全员可见的金句库
  app.get('/api/v6/scripts/coach/moves', v6CsAuth, (req, res) => {
    try {
      const rows = db.prepare("SELECT data FROM shijing_coach_moves ORDER BY createdAt DESC LIMIT 500").all();
      const moves = rows.map(r => JSON.parse(r.data));
      res.json({ ok: true, moves, isHQ: req.v6User.role === 'hq' });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  // DELETE /api/v6/scripts/coach/moves/:id - 删除金句（仅 HQ）
  app.delete('/api/v6/scripts/coach/moves/:id', v6CsAuth, (req, res) => {
    if (req.v6User.role !== 'hq') return res.status(403).json({ ok: false, error: 'hq only' });
    try {
      const r = db.prepare("DELETE FROM shijing_coach_moves WHERE id=?").run(req.params.id);
      res.json({ ok: r.changes > 0, removed: r.changes });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });
};
