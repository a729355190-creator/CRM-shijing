/**
 * V6 AI 数据日报模块（零侵入插件式）
 * ------------------------------------------------------------
 * 设计目标：
 *   - 每天自动分析「门店 / 客服 / 投放城市」三类对象的关键指标
 *   - 基准 = 近 7 天均值；偏离 ≥10% 即判定异常（成本类反向）
 *   - 规则引擎挑出异常项 → 交给 AI 生成管理者口吻的总结分析建议
 *   - 推送到「决策群」企微机器人 + 落库供 V6 前端回看
 *
 * 安全/隔离原则：
 *   - 独立文件，server.js 仅需一行：require('./v6-ai-report')(app, db, deps)
 *   - 只读业务数据，结果写独立表 shijing_ai_report，不动任何业务表
 *   - cron 独立 try/catch，任何失败都不影响主简报/业务
 *   - webhook 与 AI key 全部走 config.aiReport，未配置时安全降级
 *
 * 依赖（由 server.js 注入，复用现有实现，避免重复造轮子）：
 *   deps.getConfig()      读取主配置（含 teams / aiReport 占位）
 *   deps.setConfig(cfg)   写主配置（可选，用于 dedupe 日志）
 *   deps.pushWecom(url,c) 企微 markdown 推送
 *   deps.fmtLocalDate(d)  本地时区 YYYY-MM-DD（禁止 toISOString）
 *   deps.v6Required       登录鉴权中间件
 *   deps.v6HQRequired     总部鉴权中间件
 * ------------------------------------------------------------
 */
'use strict';
const https = require('https');

module.exports = function (app, db, deps) {
  deps = deps || {};
  const getConfig = deps.getConfig;
  const setConfig = deps.setConfig;
  const pushWecom = deps.pushWecom;
  const v6Required = deps.v6Required || ((req, res, next) => next());
  const v6HQRequired = deps.v6HQRequired || ((req, res, next) => next());

  // —— 本地时区日期，禁止 toISOString().slice ——
  const fmtLocalDate = deps.fmtLocalDate || function (d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };

  // ============================================================
  // 0. 建结果表（独立，绝不碰业务表）
  // ============================================================
  db.exec(`CREATE TABLE IF NOT EXISTS shijing_ai_report (
    date TEXT PRIMARY KEY,          -- 报告对应的业务数据日期 YYYY-MM-DD
    summary TEXT,                   -- AI 生成的总结分析（markdown）
    anomalies TEXT,                 -- 异常项 JSON（规则引擎原始结果）
    rawText TEXT,                   -- 最终推送的完整 markdown
    aiUsed INTEGER DEFAULT 0,       -- 是否真的调用了 AI（0=降级纯规则）
    createdAt INTEGER,
    pushedAt INTEGER,
    pushOk INTEGER DEFAULT 0
  )`);

  // ============================================================
  // 1. 工具函数
  // ============================================================
  const round = (n, p = 2) => { const m = Math.pow(10, p); return Math.round((n || 0) * m) / m; };
  const safeDiv = (a, b) => (!b ? 0 : a / b);
  const pct = n => round(n, 1) + '%';
  const money = n => '¥' + round(n, 2).toLocaleString('zh-CN');

  // 阈值（默认值，后续可在 config.aiReport.threshold 覆盖）
  function getThreshold() {
    const cfg = (getConfig && getConfig()) || {};
    const t = (cfg.aiReport && cfg.aiReport.threshold) || {};
    return {
      deviate: typeof t.deviate === 'number' ? t.deviate : 0.10, // 偏离 ≥10% 判异常
      window: typeof t.window === 'number' ? t.window : 7,       // 近 7 天均值
      minDays: typeof t.minDays === 'number' ? t.minDays : 3,    // 样本 <3 天不判定
    };
  }

  // 读全部某 collection 的有效记录
  function loadColl(c) {
    const rows = db.prepare(`SELECT data FROM shijing_${c} WHERE deleted = 0`).all();
    return rows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
  }

  // 近 N 天日期数组（不含目标日），用于算基准
  function prevDates(date, n) {
    const out = [];
    const base = new Date(date + 'T00:00:00');
    for (let i = 1; i <= n; i++) {
      const d = new Date(base.getTime() - i * 86400000);
      out.push(fmtLocalDate(d));
    }
    return out;
  }

  /**
   * 通用异常判定
   * @param label    指标名
   * @param today    今日值
   * @param baseArr  历史值数组（用于算均值）
   * @param opt.lowerBetter 成本类=true（越低越好，高于均值才是退步）
   * @param opt.fmt  数值格式化函数
   * @param th       阈值
   * @returns null | {label, today, base, deltaPct, level, dir}
   */
  function judge(label, today, baseArr, opt, th) {
    opt = opt || {};
    const valid = baseArr.filter(v => typeof v === 'number' && !isNaN(v));
    if (valid.length < th.minDays) return null; // 样本不足，不判定
    const base = valid.reduce((s, v) => s + v, 0) / valid.length;
    if (base === 0 && today === 0) return null;
    if (base === 0) return null; // 基准为 0 无法算环比
    const deltaPct = (today - base) / base; // 正=高于均值，负=低于均值
    const abs = Math.abs(deltaPct);
    if (abs < th.deviate) return null; // ±阈值内，正常波动

    // 判定方向：是退步还是进步
    const lowerBetter = !!opt.lowerBetter;
    // 高于均值：lowerBetter→退步(bad)，否则→进步(good)
    // 低于均值：lowerBetter→进步(good)，否则→退步(bad)
    let kind;
    if (deltaPct > 0) kind = lowerBetter ? 'bad' : 'good';
    else kind = lowerBetter ? 'good' : 'bad';

    const level = abs >= th.deviate * 3 ? 'high' : (abs >= th.deviate * 1.5 ? 'mid' : 'low'); // 30%/15%/10%
    const fmt = opt.fmt || (v => round(v, 2));
    return {
      label, kind, level,
      today: fmt(today), base: fmt(round(base, 2)),
      deltaPct: (deltaPct > 0 ? '+' : '') + pct(deltaPct * 100),
    };
  }

  // ============================================================
  // 2. 规则引擎：门店 / 客服 / 城市三类异常
  // ============================================================
  function detectAnomalies(date, th) {
    th = th || getThreshold();
    const cfg = (getConfig && getConfig()) || {};
    const teams = cfg.teams || {};
    const win = prevDates(date, th.window);

    const adAll = loadColl('ad');
    const csAll = loadColl('cs');
    const storeAll = loadColl('store');

    const teamName = id => (teams[id] && teams[id].name) || id;

    // ---------- 2.1 门店 ----------
    const storeResults = [];
    const storeIds = [...new Set(storeAll.map(x => x.teamId).filter(Boolean))];
    for (const sid of storeIds) {
      if (teams[sid] && teams[sid].role !== 'store') continue;
      const dayRows = storeAll.filter(x => x.teamId === sid && x.date === date);
      if (!dayRows.length) continue; // 今日无数据，跳过（不误报）

      // 今日聚合
      const newC = dayRows.filter(x => x.customerType === '新客');
      const tArrive = newC.length;
      const tRev = dayRows.reduce((s, x) => s + (+x.opAmount || 0) + (+x.closedAmount || 0), 0);

      // 历史每日聚合
      const arriveHist = [], revHist = [];
      for (const d of win) {
        const rows = storeAll.filter(x => x.teamId === sid && x.date === d);
        if (!rows.length) continue;
        arriveHist.push(rows.filter(x => x.customerType === '新客').length);
        revHist.push(rows.reduce((s, x) => s + (+x.opAmount || 0) + (+x.closedAmount || 0), 0));
      }

      const items = [];
      let r;
      r = judge('新客到店数', tArrive, arriveHist, { fmt: v => round(v, 0) + '人' }, th); if (r) items.push(r);
      r = judge('营业额', tRev, revHist, { fmt: money }, th); if (r) items.push(r);
      if (items.length) storeResults.push({ id: sid, name: teamName(sid), items });
    }

    // ---------- 2.2 客服 ----------
    const csResults = [];
    const csIds = [...new Set(csAll.map(x => x.teamId).filter(Boolean))];
    for (const cid of csIds) {
      if (teams[cid] && teams[cid].role !== 'cs') continue;
      const dayRows = csAll.filter(x => x.teamId === cid && x.date === date);
      if (!dayRows.length) continue;

      // CS 表真实字段：depositCount(定金数) / depositAmount(定金金额) / addFans(加粉) / depositRate(定转率%)
      const tDeposit = dayRows.reduce((s, x) => s + (+x.depositCount || 0), 0);
      const tDepAmt = dayRows.reduce((s, x) => s + (+x.depositAmount || 0), 0); // 定金金额
      const tFans = dayRows.reduce((s, x) => s + (+x.addFans || 0), 0);
      const tConvRate = safeDiv(tDeposit, tFans) * 100; // 定转率% = 定金数/加粉

      const depHist = [], amtHist = [], convHist = [];
      for (const d of win) {
        const rows = csAll.filter(x => x.teamId === cid && x.date === d);
        if (!rows.length) continue;
        const dep = rows.reduce((s, x) => s + (+x.depositCount || 0), 0);
        const amt = rows.reduce((s, x) => s + (+x.depositAmount || 0), 0);
        const f = rows.reduce((s, x) => s + (+x.addFans || 0), 0);
        depHist.push(dep);
        amtHist.push(amt);
        convHist.push(safeDiv(dep, f) * 100);
      }

      const items = [];
      let r;
      r = judge('定金数', tDeposit, depHist, { fmt: v => round(v, 0) + '单' }, th); if (r) items.push(r);
      r = judge('定金金额', tDepAmt, amtHist, { fmt: money }, th); if (r) items.push(r);
      r = judge('定转率', tConvRate, convHist, { fmt: v => round(v, 1) + '%' }, th); if (r) items.push(r);
      if (items.length) csResults.push({ id: cid, name: teamName(cid), items });
    }

    // ---------- 2.3 投放城市 ----------
    // ad 表城市维度：cityName != null。天维度(cityName=null)不参与城市分析。
    const cityResults = [];
    const cityRows = adAll.filter(x => x.cityName);
    const cities = [...new Set(cityRows.map(x => x.cityName).filter(Boolean))];
    const MIN_CITY_COST = 100; // 今日消耗 <100 元的城市样本太小，不参与好坏判定（避免 ¥0 误报）
    for (const city of cities) {
      if (city === '其他') continue; // "其他"是兜底归集，无分析价值
      const dayRows = cityRows.filter(x => x.cityName === city && x.date === date);
      if (!dayRows.length) continue;

      const tCost = dayRows.reduce((s, x) => s + (+x.cost || 0), 0);
      if (tCost < MIN_CITY_COST) continue; // 花费太少不分析
      const tDeep = dayRows.reduce((s, x) => s + (+x.deepConvert || 0), 0);
      const tFans = dayRows.reduce((s, x) => s + (+x.addFans || 0), 0);
      const tDeepCost = tDeep > 0 ? safeDiv(tCost, tDeep) : null; // 高潜成本（越低越好）；今日0高潜则单独提示
      const tConvRate = safeDiv(tDeep, tFans) * 100;              // 深转率%

      const deepCostHist = [], convHist = [];
      for (const d of win) {
        const rows = cityRows.filter(x => x.cityName === city && x.date === d);
        if (!rows.length) continue;
        const cost = rows.reduce((s, x) => s + (+x.cost || 0), 0);
        if (cost < MIN_CITY_COST) continue; // 历史里花费太少的天也不纳入基准
        const deep = rows.reduce((s, x) => s + (+x.deepConvert || 0), 0);
        const fans = rows.reduce((s, x) => s + (+x.addFans || 0), 0);
        if (deep > 0) deepCostHist.push(safeDiv(cost, deep));
        convHist.push(safeDiv(deep, fans) * 100);
      }

      const items = [];
      let r;
      // 今日花了钱却 0 高潜 → 直接预警（无法算成本环比，单独提示）
      if (tDeep === 0 && tCost >= MIN_CITY_COST) {
        items.push({ label: '高潜成交', kind: 'bad', level: 'high',
          today: '0个', base: '—', deltaPct: '消耗' + money(tCost) + '但0高潜' });
      } else if (tDeepCost !== null) {
        r = judge('高潜成本', tDeepCost, deepCostHist, { lowerBetter: true, fmt: money }, th); if (r) items.push(r);
      }
      r = judge('深转率', tConvRate, convHist, { fmt: v => round(v, 1) + '%' }, th); if (r) items.push(r);
      if (items.length) cityResults.push({ id: city, name: city, items });
    }

    return { date, threshold: th, store: storeResults, cs: csResults, city: cityResults };
  }

  // ============================================================
  // 3. 把异常项渲染成纯规则文本（AI 不可用时的降级输出）
  // ============================================================
  function renderRuleText(an) {
    const th = an.threshold;
    const tag = it => {
      const arrow = it.kind === 'good' ? '🟢' : (it.level === 'high' ? '🔴' : '🟡');
      // 按真实涨跌方向描述（用 deltaPct 符号判断，避免"低于均值 +231%"这种矛盾）
      const up = (it.deltaPct || '').startsWith('+');
      const word = up ? '高于' : '低于';
      const judge = it.kind === 'good' ? '✓ 表现更好' : '退步';
      return `${arrow} ${it.label}：**${it.today}**（${word}近${th.window}日均值 ${it.base}，${it.deltaPct}，${judge}）`;
    };
    const block = (title, arr) => {
      if (!arr.length) return '';
      let s = `\n### ${title}\n`;
      for (const o of arr) {
        s += `**${o.name}**\n`;
        for (const it of o.items) s += `> ${tag(it)}\n`;
        s += '\n';
      }
      return s;
    };
    let body = block('🏪 门店', an.store) + block('📞 客服', an.cs) + block('🌆 投放城市', an.city);
    if (!body.trim()) body = '\n> 今日各项指标均在近' + th.window + '日均值 ±' + (th.deviate * 100) + '% 区间内，无明显异常。\n';
    return body;
  }

  // ============================================================
  // 4. AI 总结（key 占位；未配置则降级）
  //    config.aiReport = {
  //      ai: { provider, baseUrl, apiKey, model },  // 你之后填
  //      webhook: 'https://qyapi.weixin.qq.com/...', // 决策群
  //      threshold: {...}
  //    }
  // ============================================================
  function callAI(messages, override) {
    override = override || {};
    return new Promise(resolve => {
      const cfg = (getConfig && getConfig()) || {};
      const ai = (cfg.aiReport && cfg.aiReport.ai) || {};
      if (!ai.apiKey || !ai.baseUrl) {
        return resolve({ ok: false, reason: 'ai_not_configured' });
      }
      let host, pathName;
      try {
        const u = new URL(ai.baseUrl.replace(/\/$/, '') + '/chat/completions');
        host = u.hostname; pathName = u.pathname + u.search;
      } catch (e) { return resolve({ ok: false, reason: 'bad_baseUrl' }); }

      // max_tokens 给足：deepseek-v4-pro 等思考模型会先消耗大量 reasoning token，
      // 留太小会导致正式回答被截断（finish_reason=length）。默认 6000，可配置/可重试覆盖。
      const payload = JSON.stringify({
        model: ai.model || 'deepseek-chat',
        messages,
        temperature: typeof ai.temperature === 'number' ? ai.temperature : 0.4,
        max_tokens: override.maxTokens || ai.maxTokens || 6000,
      });
      const req = https.request({
        hostname: host, path: pathName, method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + ai.apiKey,
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 90000, // 思考模型较慢，放宽到 90s
      }, res => {
        let body = ''; res.on('data', c => body += c);
        res.on('end', () => {
          try {
            const j = JSON.parse(body);
            if (j.error) return resolve({ ok: false, reason: 'api_error', raw: JSON.stringify(j.error).slice(0, 300) });
            const choice = j.choices && j.choices[0];
            const msg = choice && choice.message;
            const finish = choice && choice.finish_reason;
            // 兼容思考模型：优先 content，content 为空时退而用 reasoning_content
            let text = msg && msg.content;
            if ((!text || !text.trim()) && msg && msg.reasoning_content) text = msg.reasoning_content;
            // 被 token 上限截断（finish=length）→ 视为失败，避免推半截内容到群里
            if (finish === 'length') {
              return resolve({ ok: false, reason: 'truncated_length', raw: (text || '').slice(-80) });
            }
            if (text && text.trim()) resolve({ ok: true, text: text.trim() });
            else resolve({ ok: false, reason: 'empty', raw: body.slice(0, 300) });
          } catch (e) { resolve({ ok: false, reason: 'parse_error', raw: body.slice(0, 300) }); }
        });
      });
      req.on('error', e => resolve({ ok: false, reason: e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, reason: 'timeout' }); });
      req.write(payload); req.end();
    });
  }

  async function aiSummarize(an) {
    // 构造给 AI 的结构化事实（只喂事实，禁止编造）
    const facts = JSON.stringify({
      date: an.date,
      门店异常: an.store,
      客服异常: an.cs,
      投放城市异常: an.city,
    }, null, 0);

    const sys =
'你是仕净（医美脱毛连锁，主营激光脱毛/技术脱毛与脱毛后护理升单）的资深运营总监。下面是某天经规则引擎算好的异常数据：基准=近7天均值，偏离≥10%才列出。kind=bad=退步，kind=good=亮点；成本/高潜成本类越低越好。\n' +
'\n' +
'【建议方向参考】门店营业额/客单价低→主推技术脱毛年卡套餐+店长升单话术+老客复购；门店到店少→跟进未到店+确认预约提醒；客服定转率低→练成交话术+把控加粉质量；客服定金金额低→定金期铺垫高价套餐；城市高潜成本高/0高潜→关停低效计划+查加粉到客服承接链路。\n' +
'\n' +
'【输出格式：给微信群看，简洁但有判断依据，严格照抄下面结构】\n' +
'用中文 markdown。不要写"门店/客服/投放城市"这种分组小标题。\n' +
'\n' +
'第1行：`综合表现：{好/一般/差} ｜ 异常 {N} 项`\n' +
'第2行：`> ⚠️ 核心：{一句话点出今天最关键的问题，≤30字}`\n' +
'然后每个异常对象输出一个**三行小块**（块之间空一行）：\n' +
'  行1：`{emoji} **对象名**  关键指标+变化`（退步变化值用 <font color="warning">包裹，亮点用 <font color="info">；emoji：门店🏪 客服📞 城市🌆；同一对象的多个指标写在这一行，用空格分隔）\n' +
'  行2：`> 原因：{一句话推测，≤25字}`（亮点则写 `> 亮点：xxx`）\n' +
'  行3：`> 对策：{一句话可执行动作，动词开头，≤25字}`（亮点则写 `> 经验：xxx`）\n' +
'最多输出最重要的 5 个对象；同一对象的多指标必须合并进同一个块，不要拆成两块；同类城市可合并（如"深圳/湛江"）。\n' +
'最后空一行后：`📌 **明日重点**：{一句话，≤30字}`\n' +
'\n' +
'【硬约束】原因/对策各只给1句，禁止分点罗列1/2/3。只能用我给的数字，禁止编造数据/人名/金额。全文控制在300字内。';
    const usr = '数据日期：' + an.date + '\n异常明细(JSON)：\n' + facts;
    const msgs = [
      { role: 'system', content: sys },
      { role: 'user', content: usr },
    ];

    let r = await callAI(msgs);
    // 被截断时自动重试一次（思考模型偶发把 token 烧在推理上）
    if (!r.ok && r.reason === 'truncated_length') {
      console.log('[ai-report] truncated, retrying once with larger budget');
      r = await callAI(msgs, { maxTokens: 8000 });
    }
    return r;
  }

  // ============================================================
  // 5. 生成 + 推送 + 落库
  // ============================================================
  async function generate(date, opt) {
    opt = opt || {};
    const th = getThreshold();
    const an = detectAnomalies(date, th);
    const ruleText = renderRuleText(an);

    // 统计异常数量（用于标题）
    const cnt = an.store.length + an.cs.length + an.city.length;

    // 尝试 AI 总结
    let aiText = '', aiUsed = 0;
    const aiR = await aiSummarize(an);
    if (aiR.ok) { aiText = aiR.text; aiUsed = 1; }

    // 组装内容
    // —— pushContent：推送给企微群的精简版（只要 AI 精华，不带规则明细附录）——
    // —— content：存库+后台回看的完整版（AI + 规则明细，方便深究）——
    const mmdd = (date || '').slice(5); // MM-DD
    const pushHead = `🤖 **仕净 AI 日报 · ${mmdd}**\n\n`;
    let pushContent, content;
    if (aiUsed) {
      pushContent = pushHead + aiText;
      content = `## 🤖 仕净 AI 数据日报\n> 数据日期：**${date}** ｜ 基准近${th.window}日均值，偏离≥${th.deviate * 100}%预警 ｜ 异常 **${cnt}** 项\n\n`
        + aiText + '\n\n---\n#### 📋 异常明细（规则引擎）\n' + ruleText;
    } else {
      const fallback = pushHead + ruleText + '\n> *（未配置 AI key，当前为规则版）*';
      pushContent = fallback;
      content = fallback;
    }

    // 落库
    db.prepare(`INSERT INTO shijing_ai_report(date, summary, anomalies, rawText, aiUsed, createdAt)
      VALUES(?,?,?,?,?,?)
      ON CONFLICT(date) DO UPDATE SET summary=excluded.summary, anomalies=excluded.anomalies,
        rawText=excluded.rawText, aiUsed=excluded.aiUsed, createdAt=excluded.createdAt`)
      .run(date, aiText, JSON.stringify(an), content, aiUsed, Date.now());

    // 推送：优先 aiReport.webhook（专用决策群）；未配置时回退到总部群 hqWebhook
    let pushOk = 0;
    if (!opt.noPush) {
      const cfg = (getConfig && getConfig()) || {};
      const webhook = (cfg.aiReport && cfg.aiReport.webhook)
        || (cfg.wecomConfig && cfg.wecomConfig.hqWebhook)
        || '';
      if (webhook && pushWecom) {
        const pr = await pushWecom(webhook, pushContent); // 推送精简版
        pushOk = pr && pr.errcode === 0 ? 1 : 0;
        db.prepare(`UPDATE shijing_ai_report SET pushedAt=?, pushOk=? WHERE date=?`)
          .run(Date.now(), pushOk, date);
        console.log('[ai-report]', date, 'pushed:', JSON.stringify(pr));
      } else {
        console.log('[ai-report]', date, 'no decision-group webhook configured, skip push (saved to DB)');
      }
    }

    return { ok: true, date, aiUsed, anomalyCount: cnt, pushOk, content };
  }

  // ============================================================
  // 6. cron：每天 9:30（北京时间），独立 try/catch
  // ============================================================
  let cron;
  try { cron = require('node-cron'); } catch (e) { cron = null; }
  if (cron) {
    cron.schedule('30 9 * * *', async () => {
      const date = fmtLocalDate(new Date(Date.now() - 86400000)); // 昨天
      console.log('[cron] ai-report for', date);
      try {
        await generate(date);
      } catch (e) {
        console.error('[ai-report] cron failed:', e && e.message);
      }
    }, { timezone: 'Asia/Shanghai' });
    console.log('[v6-ai-report] cron scheduled at 09:30 Asia/Shanghai');
  }

  // ============================================================
  // 7. 接口
  // ============================================================
  // 手动触发（hq）：可指定 date，可 noPush 仅生成
  app.post('/api/ai-report/run', v6HQRequired, async (req, res) => {
    try {
      const date = (req.body && req.body.date) || fmtLocalDate(new Date(Date.now() - 86400000));
      const noPush = !!(req.body && req.body.noPush);
      const r = await generate(date, { noPush });
      res.json(r);
    } catch (e) {
      res.json({ ok: false, error: e && e.message });
    }
  });

  // 仅预览异常（不落库不推送，调阈值用）
  app.post('/api/ai-report/preview', v6HQRequired, (req, res) => {
    try {
      const date = (req.body && req.body.date) || fmtLocalDate(new Date(Date.now() - 86400000));
      const an = detectAnomalies(date);
      res.json({ ok: true, anomalies: an, ruleText: renderRuleText(an) });
    } catch (e) {
      res.json({ ok: false, error: e && e.message });
    }
  });

  // 回看历史报告（登录可见）
  app.get('/api/ai-report/list', v6Required, (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 30, 90);
    const rows = db.prepare(`SELECT date, summary, rawText, aiUsed, createdAt, pushedAt, pushOk
      FROM shijing_ai_report ORDER BY date DESC LIMIT ?`).all(limit);
    res.json({ ok: true, reports: rows });
  });

  // 读单日
  app.get('/api/ai-report/get', v6Required, (req, res) => {
    const date = req.query.date;
    if (!date) return res.json({ ok: false, error: 'no date' });
    const row = db.prepare(`SELECT * FROM shijing_ai_report WHERE date=?`).get(date);
    res.json({ ok: true, report: row || null });
  });

  console.log('[v6-ai-report] mounted: /api/ai-report/{run,preview,list,get}');
};
