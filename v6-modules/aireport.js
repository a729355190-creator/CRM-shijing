/* ============================================================
 * V6 模块：AI 数据日报（仅总部 hq 可见）
 * 调用后端 /api/ai-report/{list,run,preview,get}
 * 处理函数名遵循约定：render_hq_aireport(page)
 * ============================================================ */

// —— 极简 markdown → HTML（够日报用：标题/加粗/引用/分隔线/换行）——
window.aiReportMd2html = function (md) {
  if (!md) return '';
  const esc = window.esc || (s => String(s));
  const lines = String(md).split('\n');
  let html = '', inQuote = false;
  const flushQuote = () => { if (inQuote) { html += '</div>'; inQuote = false; } };
  for (let raw of lines) {
    let line = raw.replace(/\r$/, '');
    if (/^\s*---\s*$/.test(line)) { flushQuote(); html += '<hr class="air-hr">'; continue; }
    if (/^####\s+/.test(line)) { flushQuote(); html += '<h4 class="air-h4">' + inline(line.replace(/^####\s+/, '')) + '</h4>'; continue; }
    if (/^###\s+/.test(line)) { flushQuote(); html += '<h3 class="air-h3">' + inline(line.replace(/^###\s+/, '')) + '</h3>'; continue; }
    if (/^##\s+/.test(line)) { flushQuote(); html += '<h2 class="air-h2">' + inline(line.replace(/^##\s+/, '')) + '</h2>'; continue; }
    if (/^>\s?/.test(line)) {
      if (!inQuote) { html += '<div class="air-quote">'; inQuote = true; }
      html += '<div class="air-quote-line">' + inline(line.replace(/^>\s?/, '')) + '</div>';
      continue;
    }
    flushQuote();
    if (line.trim() === '') { html += '<div class="air-gap"></div>'; continue; }
    if (/^[-*]\s+/.test(line)) { html += '<div class="air-li">• ' + inline(line.replace(/^[-*]\s+/, '')) + '</div>'; continue; }
    html += '<div class="air-p">' + inline(line) + '</div>';
  }
  flushQuote();
  return html;

  function inline(s) {
    s = esc(s);
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // 企微 <font color="xxx">..</font> → span（已被 esc 转义，这里还原已知安全标签）
    s = s.replace(/&lt;font color=&quot;(warning|info|comment)&quot;&gt;(.*?)&lt;\/font&gt;/g,
      (m, c, t) => '<span class="air-c-' + c + '">' + t + '</span>');
    return s;
  }
};

window.render_hq_aireport = async function (page) {
  page.innerHTML = `
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
        <div>
          <h3 style="margin:0;">🤖 AI 数据日报</h3>
          <div class="muted" style="margin-top:4px;font-size:13px;">
            每天 09:30 自动分析门店 / 客服 / 投放城市，对比近 7 日均值，偏离 ≥10% 即预警，并推送决策群。
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <input type="date" id="airDate" class="air-input" />
          <button class="btn" id="airPreviewBtn">仅预览异常</button>
          <button class="btn btn-primary" id="airRunBtn">立即生成并推送</button>
        </div>
      </div>
      <div id="airConfigTip" style="margin-top:10px;"></div>
    </div>

    <div id="airResult" style="margin-top:14px;"></div>

    <div class="card" style="margin-top:14px;">
      <h3 style="margin-top:0;">📚 历史报告</h3>
      <div id="airHistory"><div class="loading">加载中…</div></div>
    </div>

    <style>
      .air-input{padding:8px 10px;border:1px solid var(--border,#d9dde3);border-radius:8px;font-size:15px;}
      .air-report-card{border:1px solid var(--border,#e5e8ee);border-radius:12px;padding:16px 18px;margin-bottom:12px;background:#fff;}
      .air-h2{font-size:17px;font-weight:700;margin:2px 0 8px;}
      .air-h3{font-size:15px;font-weight:700;margin:14px 0 6px;color:#1f2329;}
      .air-h4{font-size:14px;font-weight:600;margin:12px 0 4px;color:#646a73;}
      .air-quote{background:#f7f8fa;border-left:3px solid #3370ff;border-radius:0 8px 8px 0;padding:8px 12px;margin:6px 0;}
      .air-quote-line{font-size:14px;line-height:1.7;color:#1f2329;}
      .air-p{font-size:14px;line-height:1.7;margin:3px 0;color:#1f2329;}
      .air-li{font-size:14px;line-height:1.7;margin:2px 0 2px 6px;color:#1f2329;}
      .air-gap{height:6px;}
      .air-hr{border:none;border-top:1px dashed #dfe2e8;margin:12px 0;}
      .air-c-warning{color:#d83931;font-weight:600;}
      .air-c-info{color:#2ba471;font-weight:600;}
      .air-c-comment{color:#8a9099;}
      .air-meta{font-size:12px;color:#8a9099;margin-bottom:8px;display:flex;gap:12px;flex-wrap:wrap;align-items:center;}
      .air-badge{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;}
      .air-badge-ai{background:#e8f3ff;color:#3370ff;}
      .air-badge-rule{background:#f2f3f5;color:#8a9099;}
      .air-badge-ok{background:#e8f8f0;color:#2ba471;}
      .air-badge-fail{background:#fdecee;color:#d83931;}
    </style>
  `;

  const $ = id => document.getElementById(id);
  // 默认日期=昨天
  const y = new Date(Date.now() - 86400000);
  $('airDate').value = (window.fmtDate ? fmtDate(y) : y.toISOString().slice(0, 10));

  // 配置提示：检查 webhook / AI key 是否就绪
  checkConfigTip();

  $('airPreviewBtn').onclick = () => runReport(true);
  $('airRunBtn').onclick = () => runReport(false);

  loadHistory();

  async function checkConfigTip() {
    try {
      const cfg = await api.get('/api/config');
      const ar = (cfg && cfg.config && cfg.config.aiReport) || (cfg && cfg.aiReport) || {};
      const hasHook = !!ar.webhook;
      const hasAI = !!(ar.ai && ar.ai.apiKey && ar.ai.baseUrl);
      let tips = [];
      if (!hasHook) tips.push('⚠️ 尚未配置「决策群机器人 webhook」，报告只会落库不会推送');
      if (!hasAI) tips.push('⚠️ 尚未配置「AI 接口 key」，当前为规则版（无 AI 文字分析）');
      const tipEl = $('airConfigTip');
      if (tips.length) {
        tipEl.innerHTML = '<div style="background:#fff7e6;border:1px solid #ffd591;border-radius:8px;padding:8px 12px;font-size:13px;color:#874d00;">'
          + tips.map(esc).join('<br>') + '<br><span style="color:#8a9099;">（在「系统设置 → AI 日报」中填写后即可启用）</span></div>';
      } else {
        tipEl.innerHTML = '<div style="background:#e8f8f0;border:1px solid #95de64;border-radius:8px;padding:8px 12px;font-size:13px;color:#135200;">✅ 决策群推送与 AI 分析均已配置就绪。</div>';
      }
    } catch (e) { /* 静默 */ }
  }

  async function runReport(previewOnly) {
    const date = $('airDate').value;
    if (!date) { alert('请选择日期'); return; }
    const resEl = $('airResult');
    resEl.innerHTML = '<div class="card"><div class="loading">' + (previewOnly ? '正在分析异常…' : '正在生成并推送…') + '</div></div>';
    try {
      let data;
      if (previewOnly) {
        data = await api.post('/api/ai-report/preview', { date });
        if (!data.ok) throw new Error(data.error || '生成失败');
        resEl.innerHTML = '<div class="card air-report-card"><div class="air-meta"><span class="air-badge air-badge-rule">仅预览·未推送</span><span>' + esc(date) + '</span></div>'
          + aiReportMd2html('## 异常预览\n' + data.ruleText) + '</div>';
      } else {
        data = await api.post('/api/ai-report/run', { date });
        if (!data.ok) throw new Error(data.error || '生成失败');
        resEl.innerHTML = '<div class="card air-report-card"><div class="air-meta">'
          + '<span class="air-badge ' + (data.aiUsed ? 'air-badge-ai">AI 分析' : 'air-badge-rule">规则版') + '</span>'
          + '<span class="air-badge ' + (data.pushOk ? 'air-badge-ok">已推送决策群' : 'air-badge-fail">未推送') + '</span>'
          + '<span>异常对象 ' + (data.anomalyCount || 0) + ' 个</span></div>'
          + aiReportMd2html(data.content) + '</div>';
        loadHistory();
        checkConfigTip();
      }
    } catch (e) {
      resEl.innerHTML = '<div class="card"><div style="color:#d83931;">生成失败：' + esc(e.message) + '</div></div>';
    }
  }

  async function loadHistory() {
    const el = $('airHistory');
    try {
      const data = await api.get('/api/ai-report/list?limit=30');
      if (!data.ok || !data.reports || !data.reports.length) {
        el.innerHTML = '<div class="muted" style="color:#8a9099;font-size:13px;">暂无历史报告。每天 09:30 自动生成，或点上方「立即生成」。</div>';
        return;
      }
      el.innerHTML = data.reports.map(r => {
        const pushed = r.pushOk ? '<span class="air-badge air-badge-ok">已推送</span>' : '<span class="air-badge air-badge-fail">未推送</span>';
        const aiB = r.aiUsed ? '<span class="air-badge air-badge-ai">AI</span>' : '<span class="air-badge air-badge-rule">规则版</span>';
        return '<div class="air-report-card">'
          + '<div class="air-meta"><strong style="font-size:14px;color:#1f2329;">' + esc(r.date) + '</strong>' + aiB + pushed + '</div>'
          + aiReportMd2html(r.rawText) + '</div>';
      }).join('');
    } catch (e) {
      el.innerHTML = '<div style="color:#d83931;">加载失败：' + esc(e.message) + '</div>';
    }
  }
};
