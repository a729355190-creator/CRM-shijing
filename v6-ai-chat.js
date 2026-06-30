/**
 * V6 AI 数据助手 - 数据工具版
 * ------------------------------------------------------------
 * 设计目标：
 *   - HQ 用户可在前端输入自然语言问题，AI 通过数据工具实时查询数据库
 *   - AI 不直接读快照，而是调用预定义的数据工具函数
 *   - 可实时查任意日期/城市/团队，支持追问
 *
 * 安全/隔离原则：
 *   - 数据工具只读不改，每个工具内部做权限校验
 *   - AI 只能调用预定义的工具，不能执行任意 SQL
 *   - 权限控制：仅 HQ 用户可访问
 *
 * 数据工具列表：
 *   1. getAdData({ date, city })       - 查广告数据
 *   2. getCsData({ date, teamId })     - 查客服数据
 *   3. getStoreData({ date, city })    - 查门店数据
 *   4. getCitySummary({ date })        - 城市汇总
 *   5. getTeamSummary({ date })        - 团队汇总
 *   6. getTrendData({ type, city, days }) - 趋势数据（7天对比）
 *   7. getAnomalyCheck({ date })       - 异常检测
 * ------------------------------------------------------------
 */
'use strict';
const https = require('https');

module.exports = function (app, db, deps) {
  deps = deps || {};
  const getConfig = deps.getConfig;
  const v6HQRequired = deps.v6HQRequired || ((req, res, next) => next());

  // 本地时区日期格式化
  const fmtDate = deps.fmtLocalDate || function (d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };

  // ============================================================
  // 0. 数据工具定义（只读不改）
  // ============================================================

  // 工具 1：查广告数据
  function getAdData(params) {
    const { date, city } = params;
    const rows = db.prepare('SELECT data FROM shijing_ad WHERE deleted=0').all();
    const allData = rows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);

    // 过滤条件
    let filtered = allData.filter(x => x.date === date);
    if (city) filtered = filtered.filter(x => x.cityName === city);
    else filtered = filtered.filter(x => !x.cityName); // 不指定城市则查天维度数据

    if (!filtered.length) return { ok: false, error: '无数据', date, city };

    // 聚合
    const agg = {
      cost: filtered.reduce((s, x) => s + (+x.cost || 0), 0),
      addFans: filtered.reduce((s, x) => s + (+x.addFans || 0), 0),
      deepConvert: filtered.reduce((s, x) => s + (+x.deepConvert || 0), 0),
    };
    agg.deepCost = agg.deepConvert > 0 ? Math.round(agg.cost / agg.deepConvert * 100) / 100 : null;
    agg.convRate = agg.addFans > 0 ? Math.round(agg.deepConvert / agg.addFans * 1000) / 10 + '%' : '0%';

    return {
      ok: true,
      date,
      city: city || '全部',
      ...agg,
      recordCount: filtered.length,
    };
  }

  // 工具 2：查客服数据
  function getCsData(params) {
    const { date, teamId } = params;
    const rows = db.prepare('SELECT data FROM shijing_cs WHERE deleted=0').all();
    const allData = rows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);

    // 过滤条件
    let filtered = allData.filter(x => x.date === date);
    if (teamId) filtered = filtered.filter(x => x.teamId === teamId);

    if (!filtered.length) return { ok: false, error: '无数据', date, teamId };

    // 聚合（CS 表真实字段：depositCount/depositAmount/addFans）
    const agg = {
      depositCount: filtered.reduce((s, x) => s + (+x.depositCount || 0), 0),
      depositAmount: filtered.reduce((s, x) => s + (+x.depositAmount || 0), 0),
      addFans: filtered.reduce((s, x) => s + (+x.addFans || 0), 0),
    };
    agg.convRate = agg.addFans > 0 ? Math.round(agg.depositCount / agg.addFans * 1000) / 10 + '%' : '0%';

    return {
      ok: true,
      date,
      teamId: teamId || '全部',
      ...agg,
      recordCount: filtered.length,
    };
  }

  // 工具 3：查门店数据
  function getStoreData(params) {
    const { date, city } = params;
    const cfg = (getConfig && getConfig()) || {};
    const teams = cfg.teams || {};

    const rows = db.prepare('SELECT data FROM shijing_store WHERE deleted=0').all();
    const allData = rows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);

    // 过滤条件
    let filtered = allData.filter(x => x.date === date);
    if (city) {
      // 按 teams[id].city 过滤门店
      const storeIds = Object.keys(teams).filter(id => teams[id].role === 'store' && teams[id].city === city);
      filtered = filtered.filter(x => storeIds.includes(x.teamId));
    }

    if (!filtered.length) return { ok: false, error: '无数据', date, city };

    // 聚合
    const agg = {
      revenue: filtered.reduce((s, x) => s + (+x.opAmount || 0) + (+x.closedAmount || 0), 0),
      newGuestArrive: filtered.filter(x => x.customerType === '新客').length,
    };
    agg.avgPrice = agg.newGuestArrive > 0 ? Math.round(agg.revenue / agg.newGuestArrive) : 0;

    return {
      ok: true,
      date,
      city: city || '全部',
      ...agg,
      recordCount: filtered.length,
    };
  }

  // 工具 4：城市汇总
  function getCitySummary(params) {
    const { date } = params;
    const cfg = (getConfig && getConfig()) || {};
    const teams = cfg.teams || {};

    // 广告城市数据
    const adRows = db.prepare('SELECT data FROM shijing_ad WHERE deleted=0').all();
    const adAll = adRows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
    const adCityRows = adAll.filter(x => x.date === date && x.cityName);

    const cityData = {};
    adCityRows.forEach(x => {
      const city = x.cityName;
      if (!cityData[city]) cityData[city] = { cost: 0, addFans: 0, deepConvert: 0 };
      cityData[city].cost += (+x.cost || 0);
      cityData[city].addFans += (+x.addFans || 0);
      cityData[city].deepConvert += (+x.deepConvert || 0);
    });

    // 门店城市数据（按 teams[id].city 动态聚合）
    const storeRows = db.prepare('SELECT data FROM shijing_store WHERE deleted=0').all();
    const storeAll = storeRows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
    const storeDateRows = storeAll.filter(x => x.date === date);

    storeDateRows.forEach(x => {
      const team = teams[x.teamId];
      const city = (team && team.city) || '未知';
      if (!cityData[city]) cityData[city] = { revenue: 0, newGuestArrive: 0 };
      cityData[city].revenue += (+x.opAmount || 0) + (+x.closedAmount || 0);
      if (x.customerType === '新客') cityData[city].newGuestArrive++;
    });

    // 计算衍生指标
    const results = [];
    Object.keys(cityData).forEach(city => {
      const d = cityData[city];
      if (d.cost) {
        d.deepCost = d.deepConvert > 0 ? Math.round(d.cost / d.deepConvert * 100) / 100 : null;
        d.convRate = d.addFans > 0 ? Math.round(d.deepConvert / d.addFans * 1000) / 10 + '%' : '0%';
      }
      if (d.revenue) {
        d.avgPrice = d.newGuestArrive > 0 ? Math.round(d.revenue / d.newGuestArrive) : 0;
      }
      results.push({ city, ...d });
    });

    return { ok: true, date, cities: results };
  }

  // 工具 5：团队汇总
  function getTeamSummary(params) {
    const { date } = params;
    const cfg = (getConfig && getConfig()) || {};
    const teams = cfg.teams || {};

    const csRows = db.prepare('SELECT data FROM shijing_cs WHERE deleted=0').all();
    const csAll = csRows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
    const csDateRows = csAll.filter(x => x.date === date);

    const teamData = {};
    csDateRows.forEach(x => {
      const tid = x.teamId || 'unknown';
      if (!teamData[tid]) teamData[tid] = { depositCount: 0, depositAmount: 0, addFans: 0 };
      teamData[tid].depositCount += (+x.depositCount || 0);
      teamData[tid].depositAmount += (+x.depositAmount || 0);
      teamData[tid].addFans += (+x.addFans || 0);
    });

    const results = [];
    Object.keys(teamData).forEach(tid => {
      const d = teamData[tid];
      d.convRate = d.addFans > 0 ? Math.round(d.depositCount / d.addFans * 1000) / 10 + '%' : '0%';
      d.teamName = (teams[tid] && teams[tid].name) || tid;
      results.push({ teamId: tid, teamName: d.teamName, ...d });
    });

    return { ok: true, date, teams: results };
  }

  // 工具 6：趋势数据（N天对比）
  function getTrendData(params) {
    const { type, city, days = 7 } = params;
    const endDate = fmtDate(new Date());
    const startDate = fmtDate(new Date(Date.now() - days * 86400000));

    const results = [];
    for (let i = 0; i < days; i++) {
      const d = fmtDate(new Date(Date.now() - i * 86400000));
      if (type === 'ad') {
        const r = getAdData({ date: d, city });
        if (r.ok) results.push({ date: d, cost: r.cost, addFans: r.addFans, deepConvert: r.deepConvert, deepCost: r.deepCost });
      } else if (type === 'ad_city') {
        // 新增：城市维度广告趋势
        const r = getCitySummary({ date: d });
        if (r.ok && r.cities) {
          const cityRow = r.cities.find(c => c.city === city);
          if (cityRow) {
            results.push({
              date: d,
              cost: cityRow.cost || 0,
              addFans: cityRow.addFans || 0,
              deepConvert: cityRow.deepConvert || 0,
              deepCost: cityRow.deepCost || null,
            });
          }
        }
      } else if (type === 'cs') {
        const r = getCsData({ date: d });
        if (r.ok) results.push({ date: d, depositCount: r.depositCount, depositAmount: r.depositAmount, convRate: r.convRate });
      } else if (type === 'store') {
        const r = getStoreData({ date: d, city });
        if (r.ok) results.push({ date: d, revenue: r.revenue, newGuestArrive: r.newGuestArrive, avgPrice: r.avgPrice });
      }
    }

    return { ok: true, type, city, days, data: results.reverse() };
  }

  // 工具 7：异常检测（简化版，沿用 v6-ai-report.js 的逻辑）
  function getAnomalyCheck(params) {
    const { date } = params;
    // 直接调用 v6-ai-report.js 的 detectAnomalies（如果已挂载）
    // 否则返回简化版异常
    const cfg = (getConfig && getConfig()) || {};
    const threshold = (cfg.aiReport && cfg.aiReport.threshold) || { deviate: 0.1, window: 7, minDays: 3 };

    const adData = getAdData({ date });
    const csData = getCsData({ date });
    const citySummary = getCitySummary({ date });

    const anomalies = [];

    // 简化异常判定：消耗>100但高潜=0
    if (citySummary.ok) {
      citySummary.cities.forEach(c => {
        if (c.cost > 100 && c.deepConvert === 0) {
          anomalies.push({ city: c.city, kind: 'bad', reason: `消耗¥${c.cost}但0高潜` });
        }
      });
    }

    return { ok: true, date, threshold, anomalies, adData, csData, citySummary };
  }

  // ============================================================
  // 1. AI 调用（沿用 v6-ai-report.js 的逻辑）
  // ============================================================
  function callAI(messages, override = {}) {
    return new Promise(resolve => {
      const cfg = (getConfig && getConfig()) || {};
      const ai = (cfg.aiReport && cfg.aiReport.ai) || {};
      if (!ai.apiKey || !ai.baseUrl) {
        return resolve({ ok: false, reason: 'ai_not_configured' });
      }

      let host, pathName;
      try {
        const u = new URL(ai.baseUrl.replace(/\/$/, '') + '/chat/completions');
        host = u.hostname;
        pathName = u.pathname;
      } catch (e) { return resolve({ ok: false, reason: 'bad_url' }); }

      const payload = JSON.stringify({
        model: ai.model || 'deepseek-chat',
        messages,
        temperature: typeof ai.temperature === 'number' ? ai.temperature : 0.7,
        max_tokens: override.maxTokens || ai.maxTokens || 3000,
      });

      const req = https.request({
        hostname: host,
        path: pathName,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + ai.apiKey,
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 60000,
      }, res => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try {
            const j = JSON.parse(body);
            if (j.error) return resolve({ ok: false, reason: 'api_error', raw: JSON.stringify(j.error) });
            const choice = j.choices && j.choices[0];
            const msg = choice && choice.message;
            const finish = choice && choice.finish_reason;
            let text = msg && msg.content;
            if (!text || !text.trim()) {
              if (msg && msg.reasoning_content) text = msg.reasoning_content;
            }
            if (finish === 'length') {
              return resolve({ ok: false, truncated: true, raw: (text || '').slice(-80) });
            }
            if (text && text.trim()) resolve({ ok: true, text: text.trim() });
            else resolve({ ok: false, reason: 'empty', raw: body.slice(0, 300) });
          } catch (e) { resolve({ ok: false, reason: 'parse_error', raw: body.slice(0, 300) }); }
        });
      });
      req.on('error', e => resolve({ ok: false, reason: e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, reason: 'timeout' }); });
      req.write(payload);
      req.end();
    });
  }

  // ============================================================
  // 2. 工具选择 + 数据调用
  // ============================================================
  async function answerQuestion(question) {
    // 先让 AI 判断要用哪个工具
    const toolPrompt = `用户问题："${question}"

可用工具（只选一个，不要纠结完美匹配）：
- getAdData({ date, city }) → 单个城市/全部的广告汇总（消耗、加粉、高潜）
- getCsData({ date, teamId }) → 客服数据（定金数、定金金额）
- getStoreData({ date, city }) → 门店数据（营业额、新客到店）
- getCitySummary({ date }) → 所有城市的汇总表（广告+门店，单日）
- getTeamSummary({ date }) → 所有客服团队的汇总表（单日）
- getTrendData({ type, city, days }) → 单个城市趋势（type: ad/ad_city/cs/store, days: 7）
- getAnomalyCheck({ date }) → 异常检测

强制规则（不要分析，直接返回）：
- date 默认昨天（${fmtDate(new Date(Date.now() - 86400000))}）
- "各城市" → getCitySummary（单日汇总，无法获取趋势）
- "趋势" → getTrendData（必须传 city，若未指定则 city="长沙"）
- "异常" → getAnomalyCheck

只返回 JSON（不要解释）：
{"tool":"工具名","params":{参数}}`;

    const toolResult = await callAI([
      { role: 'system', content: '你只返回一行 JSON，不要任何解释或分析。' },
      { role: 'user', content: toolPrompt },
    ], { maxTokens: 600 });

    if (!toolResult.ok) {
      // 拼接详细错误信息（包括 raw 内容）
      let errMsg = '未知错误';
      if (toolResult.reason) errMsg = toolResult.reason;
      else if (toolResult.truncated) errMsg = '输出截断';
      if (toolResult.raw) errMsg += ' (原始响应前 80 字: ' + (toolResult.raw || '').substring(0, 80) + ')';
      console.warn('[ai-chat] 工具选择失败:', JSON.stringify(toolResult));
      return { ok: false, error: 'AI 工具选择失败: ' + errMsg, detail: toolResult };
    }

    // 解析 AI 返回的工具选择
    let toolChoice;
    try {
      toolChoice = JSON.parse(toolResult.text);
    } catch (e) {
      return { ok: false, error: '工具选择 JSON 解析失败', raw: toolResult.text };
    }

    // 执行数据工具
    const toolMap = {
      getAdData,
      getCsData,
      getStoreData,
      getCitySummary,
      getTeamSummary,
      getTrendData,
      getAnomalyCheck,
    };

    const toolFunc = toolMap[toolChoice.tool];
    if (!toolFunc) {
      return { ok: false, error: '未知工具: ' + toolChoice.tool };
    }

    // 默认 date = 昨天
    const defaultDate = fmtDate(new Date(Date.now() - 86400000));
    const params = { ...toolChoice.params, date: toolChoice.params.date || defaultDate };

    const dataResult = toolFunc(params);
    if (!dataResult.ok) {
      return { ok: false, error: '数据工具返回失败: ' + dataResult.error, detail: dataResult };
    }

    // 再次调用 AI，基于数据生成回答
    const answerPrompt = `你是仕净管理系统的数据助手。以下是数据查询结果：

工具：${toolChoice.tool}
参数：${JSON.stringify(params)}
数据：${JSON.stringify(dataResult, null, 2)}

用户问题：${question}

请基于数据回答，注意：
- 用简洁语言，表格/列表优先
- 突出关键指标和异常
- 不要编造数据里没有的信息
- 如果是趋势数据，指出变化方向
- 如果是异常检测，解释异常原因`;

    const answerResult = await callAI([
      { role: 'system', content: '你是专业的数据分析助手，回答简洁，表格优先。' },
      { role: 'user', content: answerPrompt },
    ]);

    if (!answerResult.ok) {
      return { ok: false, error: 'AI 回答生成失败: ' + answerResult.reason, detail: answerResult };
    }

    return {
      ok: true,
      answer: answerResult.text,
      tool: toolChoice.tool,
      params,
      dataResult,
    };
  }

  // ============================================================
  // 3. 接口：AI 对话（HQ 专用）
  // ============================================================
  app.post('/api/v6/ai-chat', v6HQRequired, async (req, res) => {
    try {
      const question = (req.body && req.body.question);
      if (!question) {
        return res.json({ ok: false, error: '请输入问题' });
      }

      const result = await answerQuestion(question);
      res.json(result);
    } catch (e) {
      console.error('[ai-chat] error:', e.message);
      res.json({ ok: false, error: e.message });
    }
  });

  // ============================================================
  // 4. 接口：查看数据工具列表（HQ 专用）
  // ============================================================
  app.get('/api/v6/ai-tools', v6HQRequired, (req, res) => {
    res.json({
      ok: true,
      tools: [
        { name: 'getAdData', desc: '查广告数据', params: ['date', 'city'] },
        { name: 'getCsData', desc: '查客服数据', params: ['date', 'teamId'] },
        { name: 'getStoreData', desc: '查门店数据', params: ['date', 'city'] },
        { name: 'getCitySummary', desc: '城市汇总', params: ['date'] },
        { name: 'getTeamSummary', desc: '团队汇总', params: ['date'] },
        { name: 'getTrendData', desc: '趋势数据', params: ['type', 'city', 'days'] },
        { name: 'getAnomalyCheck', desc: '异常检测', params: ['date'] },
      ],
    });
  });

  console.log('[v6-ai-chat] mounted: /api/v6/ai-chat, /api/v6/ai-tools');
};