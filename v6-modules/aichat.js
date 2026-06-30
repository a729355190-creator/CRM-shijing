/* ============================================================
 * V6 模块：AI 数据助手（仅总部 hq 可见）
 * 处理函数名遵循约定：render_hq_aichat(page)
 * ============================================================ */

// 极简 markdown → HTML（沿用 AI 日报样式）
window.aiChatMd2html = window.aiReportMd2html || function (md) {
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
    return s;
  }
};

window.render_hq_aichat = async function (page) {
  page.innerHTML = `
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
        <div>
          <h3 style="margin:0;">🤖 AI 数据助手</h3>
          <div class="muted" style="margin-top:4px;font-size:13px;">
            输入自然语言问题，AI 基于系统数据快照回答。无需联网，只看系统内部数据。
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <input type="text" id="aiChatQuestion" class="ai-input" style="width:300px;" 
            placeholder="比如：最近投放效果如何？哪些城市定金下滑？" />
          <button class="btn btn-primary" id="aiChatSendBtn">发送</button>
        </div>
      </div>
      <div id="aiChatSnapshotTip" style="margin-top:10px;"></div>
    </div>

    <div id="aiChatResult" style="margin-top:14px;"></div>

    <style>
      .ai-input{padding:8px 10px;border:1px solid var(--border,#d9dde3);border-radius:8px;font-size:15px;}
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
      .air-meta{font-size:12px;color:#8a9099;margin-bottom:8px;display:flex;gap:12px;flex-wrap:wrap;align-items:center;}
    </style>
  `;

  const $ = id => document.getElementById(id);

  // 检查快照状态
  checkSnapshotStatus();

  // 绑定发送按钮
  $('aiChatSendBtn').onclick = () => sendQuestion();
  $('aiChatQuestion').onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendQuestion();
    }
  };

  async function checkSnapshotStatus() {
    try {
      const data = await api.get('/api/v6/ai-snapshot/status');
      const tipEl = $('aiChatSnapshotTip');
      if (!data.ok) {
        tipEl.innerHTML = '<div style="color:#d83931;">快照状态检查失败</div>';
        return;
      }
      if (!data.hasSnapshot) {
        tipEl.innerHTML = '<div style="background:#fff7e6;border:1px solid #ffd591;border-radius:8px;padding:8px 12px;font-size:13px;color:#874d00;">'
          + '⚠️ 无数据快照，请先在「系统设置 → AI 日报」生成快照，或联系管理员配置定时生成。'
          + '<button class="btn btn-sm" id="aiSnapshotGenBtn" style="margin-left:12px;">立即生成快照</button></div>';
        $('aiSnapshotGenBtn').onclick = generateSnapshot;
      } else {
        const date = data.date || '未知';
        tipEl.innerHTML = '<div style="background:#e8f8f0;border:1px solid #95de64;border-radius:8px;padding:8px 12px;font-size:13px;color:#135200;">'
          + `✅ 数据快照就绪（${date}），可以直接提问。</div>`;
      }
    } catch (e) {
      $('aiChatSnapshotTip').innerHTML = '<div style="color:#8a9099;">快照状态检查异常</div>';
    }
  }

  async function generateSnapshot() {
    const tipEl = $('aiChatSnapshotTip');
    tipEl.innerHTML = '<div class="loading">正在生成快照…</div>';
    try {
      const data = await api.post('/api/v6/ai-snapshot/generate');
      if (!data.ok) throw new Error(data.error || '生成失败');
      checkSnapshotStatus();
    } catch (e) {
      tipEl.innerHTML = '<div style="color:#d83931;">快照生成失败：' + esc(e.message) + '</div>';
    }
  }

  async function sendQuestion() {
    const question = $('aiChatQuestion').value.trim();
    if (!question) {
      alert('请输入问题');
      return;
    }

    const resEl = $('aiChatResult');
    resEl.innerHTML = '<div class="card"><div class="loading">AI 正在分析数据…</div></div>';

    try {
      const data = await api.post('/api/v6/ai-chat', { question });
      if (!data.ok) {
        throw new Error(data.error || 'AI 调用失败');
      }

      resEl.innerHTML = '<div class="card air-report-card">'
        + '<div class="air-meta">数据快照：' + esc(data.date || '未知') + '</div>'
        + aiChatMd2html(data.answer) + '</div>';
      
      // 清空输入框
      $('aiChatQuestion').value = '';
    } catch (e) {
      resEl.innerHTML = '<div class="card"><div style="color:#d83931;">回答失败：' + esc(e.message) + '</div></div>';
    }
  }
};