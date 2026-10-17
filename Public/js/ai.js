/* ai.js — full-screen AI console client: skills, streamed replies, threads.
   Talks to /api/ai/* (Cloudflare worker or the local Node server). Keys never
   touch this file — chat is proxied server-side; Settings saves keys. */
(function () {
  'use strict';

  const LS_KEY = 'pa.ai.v1';
  const MAX_THREAD = 80;
  const CONTEXT_MESSAGES = 24;

  const state = {
    skills: [],
    providers: [],
    active: { provider: 'demo', model: '' },
    skillId: 'market-analyst',
    threads: {},
    sending: false,
    pendingFiles: [], // {id,name,kind,mime,dataUrl,text}
  };

  const SUGGESTIONS = {
    'daily-brief': [
      { num: '01', title: 'Brief today’s calendar — top drivers + bias', hint: 'one-tap dossier · card' },
      { num: '02', title: 'Which events matter for Gold today?', hint: 'filter to today · levels' },
      { num: '03', title: 'What would invalidate today’s bias?', hint: 'levels · risk' },
    ],
    'global-macro': [
      { num: '01', title: 'World headlines today — impact on Gold & BTC', hint: 'ex Forex Factory' },
      { num: '02', title: 'Geopolitics vs Dollar — who wins this week?', hint: 'cross-asset map' },
      { num: '03', title: 'Which world news is high-risk for my pairs?', hint: 'magnitude · timeframe' },
    ],
    'market-analyst': [
      { num: '01', title: 'Gold / USD — read the current structure', hint: 'bias · levels · invalidation' },
      { num: '02', title: 'Where is momentum shifting on NASDAQ / USD?', hint: 'divergence · session flow' },
      { num: '03', title: 'Map the key levels on BTC / USD for the week', hint: 'weekly roadmap' },
    ],
    'alert-architect': [
      { num: '01', title: 'Build a confirmation + stop ladder for Gold / USD', hint: 'entry · invalidation · TPs' },
      { num: '02', title: 'Turn "break above resistance" into concrete alerts', hint: 'ready-to-enter list' },
      { num: '03', title: 'Which channel should trigger overnight alerts?', hint: 'telegram · bale · app' },
    ],
    'journal-coach': [
      { num: '01', title: 'Review my discipline from this week', hint: 'process over outcome' },
      { num: '02', title: 'I cut winners early — give me one rule', hint: 'exit management' },
      { num: '03', title: 'How should I grade a break-even trade?', hint: 'journal scoring' },
    ],
    _default: [
      { num: '01', title: 'What can you do in this console?', hint: 'skill overview' },
      { num: '02', title: 'Give me a sample output in your style', hint: 'show format' },
      { num: '03', title: 'Help me with my current task', hint: 'freeform' },
    ],
  };

  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  /* ---------------- markdown-lite (safe) ---------------- */

  // full GFM-lite renderer — covers https://github.com/adam-p/markdown-here/wiki/markdown-cheatsheet
  // headers, emphasis, links, images, tables, blockquotes, code, lists, task lists, HR
  function inlineMd(text) {
    // escape first, then re-introduce markdown tags as HTML
    let out = esc(text);
    // inline code `code` — must run first so inner markdown is not parsed
    out = out.replace(/`([^`]+?)`/g, (_, code) => `<code>${code}</code>`);
    // images ![alt](url "title")
    out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*?)&quot;)?\)/g, (_, alt, rawUrl, title) => {
      const url = rawUrl.trim();
      if (!/^(https?:\/\/|\/|data:image\/)/.test(url)) return esc(alt);
      return `<img src="${esc(url)}" alt="${esc(alt)}"${title ? ` title="${esc(title)}"` : ''} loading="lazy">`;
    });
    // links [text](url "title") — after images
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]*?)&quot;)?\)/g, (_, label, rawUrl, title) => {
      const url = rawUrl.trim();
      if (!/^(https?:\/\/|mailto:|\/|#)/.test(url)) return label;
      return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer"${title ? ` title="${esc(title)}"` : ''}>${label}</a>`;
    });
    // autolink <https://example.com>
    out = out.replace(/&lt;(https?:\/\/[^&]+)&gt;/g, (_, url) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`);
    // bare URLs https://... (not already inside href="")
    out = out.replace(/(?<!href=&quot;)(https?:\/\/[^\s<]+)/g, (m) => {
      // avoid double-linking inside an already-created <a>
      if (m.includes('</a>') || m.includes('<a')) return m;
      return `<a href="${esc(m)}" target="_blank" rel="noopener noreferrer">${esc(m)}</a>`;
    });
    // strikethrough ~~text~~ (GFM)
    out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    // bold+italic ***text*** and ___text___
    out = out.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    out = out.replace(/___([^_]+)___/g, '<strong><em>$1</em></strong>');
    // bold **text** and __text__
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    // italic *text* and _text_ (avoid catching ** already handled)
    out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, (_, pre, t) => `${pre}<em>${t}</em>`);
    out = out.replace(/(^|[^a-zA-Z0-9])_([^_\n]+)_(?![a-zA-Z0-9_])/g, (_, pre, t) => `${pre}<em>${t}</em>`);
    // hard line break: two spaces at end -> <br>
    // handled at block level, but also convert 2 trailing spaces here
    return out;
  }

  function renderMarkdown(src) {
    const lines = String(src ?? '').replace(/\r\n/g, '\n').split('\n');
    let html = '';
    let inCode = false;
    let codeLang = '';
    let codeBuf = [];
    let listType = null;
    const closeList = () => {
      if (listType) { html += `</${listType}>`; listType = null; }
    };
    const isTableSep = s => /^\s*\|?[\s|:\-]+\|?[\s|:]*\s*$/.test(s) && s.includes('-') && s.includes('|');

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];

      // fenced code block ```lang
      if (/^```/.test(line)) {
        if (inCode) {
          html += `<pre><code${codeLang ? ` class="lang-${esc(codeLang)}"` : ''}>${esc(codeBuf.join('\n'))}</code></pre>`;
          codeBuf = []; inCode = false; codeLang = '';
        } else {
          closeList();
          inCode = true;
          codeLang = line.replace(/^```\s*/, '').trim().slice(0, 20);
        }
        continue;
      }
      if (inCode) { codeBuf.push(line); continue; }

      if (/^\s*$/.test(line)) { closeList(); continue; }

      // GFM table: header | sep | rows
      if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        closeList();
        const headerCells = line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        const alignRow = lines[i + 1].trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        const aligns = alignRow.map(c => {
          const left = c.startsWith(':'), right = c.endsWith(':');
          if (left && right) return 'center';
          if (right) return 'right';
          if (left) return 'left';
          return '';
        });
        html += '<table><thead><tr>';
        headerCells.forEach((c, idx) => {
          html += `<th${aligns[idx] ? ` style="text-align:${aligns[idx]}"` : ''}>${inlineMd(c)}</th>`;
        });
        html += '</tr></thead><tbody>';
        i += 1; // skip sep
        // consume rows
        while (i + 1 < lines.length && lines[i + 1].includes('|') && lines[i + 1].trim() !== '') {
          i += 1;
          const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
          html += '<tr>';
          for (let k = 0; k < headerCells.length; k++) {
            html += `<td${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${inlineMd(cells[k] || '')}</td>`;
          }
          html += '</tr>';
        }
        html += '</tbody></table>';
        continue;
      }

      // blockquote > text (collect consecutive)
      if (/^\s*>\s?/.test(line)) {
        closeList();
        const bqLines = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          bqLines.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        i--; // compensate outer increment
        // blockquotes can contain markdown — render inner as paragraphs
        const inner = bqLines.join('\n').trim();
        // simple: each non-empty line as paragraph
        const bqHtml = inner.split(/\n{2,}/).map(block => `<p>${inlineMd(block.replace(/\n/g, '<br>'))}</p>`).join('');
        html += `<blockquote>${bqHtml}</blockquote>`;
        continue;
      }

      // ATX headings # .. ######
      const heading = line.match(/^(#{1,6})\s+(.*)/);
      if (heading) {
        closeList();
        const level = heading[1].length;
        const text = heading[2].replace(/\s+#+\s*$/, '').trim();
        html += `<h${level}>${inlineMd(text)}</h${level}>`;
        continue;
      }

      // horizontal rule --- *** ___
      if (/^\s*([-*_])\s*(\1\s*){2,}\s*$/.test(line)) {
        closeList();
        html += '<hr>';
        continue;
      }

      // task list - [x] / - [ ]
      const task = line.match(/^\s*[-*+]\s+\[(x| )\]\s+(.*)/i);
      if (task) {
        if (listType !== 'ul') { closeList(); html += '<ul class="task-list">'; listType = 'ul'; }
        const checked = task[1].toLowerCase() === 'x';
        html += `<li class="task"><label><input type="checkbox" disabled${checked ? ' checked' : ''}> ${inlineMd(task[2])}</label></li>`;
        continue;
      }

      // unordered list
      const ul = line.match(/^\s*[-*+]\s+(.*)/);
      if (ul) {
        if (listType !== 'ul') { closeList(); html += '<ul>'; listType = 'ul'; }
        html += `<li>${inlineMd(ul[1])}</li>`;
        continue;
      }

      // ordered list 1.  1)
      const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
      if (ol) {
        if (listType !== 'ol') { closeList(); html += '<ol>'; listType = 'ol'; }
        html += `<li>${inlineMd(ol[1])}</li>`;
        continue;
      }

      // hard break: line ends with two spaces
      const hardBreak = / {2}$/.test(line);
      closeList();
      html += `<p>${inlineMd(line)}${hardBreak ? '<br>' : ''}</p>`;
    }
    if (inCode && codeBuf.length) html += `<pre><code${codeLang ? ` class="lang-${esc(codeLang)}"` : ''}>${esc(codeBuf.join('\n'))}</code></pre>`;
    closeList();
    return html;
  }

  /* ---------------- storage ---------------- */

  function loadLocal() {
    try {
      const data = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      if (data && typeof data === 'object') {
        state.threads = data.threads && typeof data.threads === 'object' ? data.threads : {};
        if (data.skillId) state.skillId = data.skillId;
      }
    } catch { /* corrupted local state is non-fatal */ }
  }

  function saveLocal() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        skillId: state.skillId,
        threads: state.threads,
      }));
    } catch { /* storage full — threads just won't persist */ }
  }

  function thread() {
    if (!Array.isArray(state.threads[state.skillId])) state.threads[state.skillId] = [];
    return state.threads[state.skillId];
  }

  /* ---------------- helpers ---------------- */

  function toast(message, kind = 'ok') {
    const host = $('#ai-toast');
    if (!host) return;
    const item = document.createElement('div');
    item.className = `ai-toast-item ${kind === 'err' ? 'err' : kind === 'warn' ? 'warn' : ''}`;
    item.innerHTML = `<span class="t-dot"></span><span>${esc(message)}</span>`;
    host.appendChild(item);
    setTimeout(() => {
      item.classList.add('leaving');
      setTimeout(() => item.remove(), 400);
    }, 3600);
  }

  function scrollBottom(smooth = true) {
    const threadEl = $('#ai-thread');
    if (!threadEl) return;
    threadEl.scrollTo({ top: threadEl.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }

  function activeSkill() {
    return state.skills.find(skill => skill.id === state.skillId) || state.skills[0] || {
      id: 'market-analyst', name: 'Console', rune: '𐰀', icon: 'ti-cpu', tagline: '',
    };
  }

  function suggestionsFor(skillId) {
    return SUGGESTIONS[skillId] || SUGGESTIONS._default;
  }

  /* ---------------- skill rail ---------------- */

  function renderRail() {
    const list = $('#ai-skill-list');
    if (!list) return;
    list.innerHTML = state.skills.map((skill, index) => `
      <button type="button" class="ai-skill ${skill.id === state.skillId ? 'active' : ''}" data-skill="${esc(skill.id)}" style="--d:${(0.08 + index * 0.07).toFixed(2)}s" title="${esc(skill.tagline || skill.name)}">
        <span class="ai-skill-glyph">${esc(skill.rune || '𐰀')}</span>
        <span class="ai-skill-copy">
          <span class="ai-skill-name"><i class="ti ${esc(skill.icon || 'ti-sparkles')}"></i>${esc(skill.name)}</span>
          <span class="ai-skill-tag" title="${esc(skill.tagline || '')}">${esc(skill.tagline || '')}</span>
        </span>
        ${skill.builtin ? '<span class="ai-skill-builtin">core</span>' : ''}
      </button>`).join('');
    const count = $('#ai-rail-count');
    if (count) count.textContent = String(state.skills.length).padStart(2, '0');
    const skill = activeSkill();
    const chip = $('#ai-skill-chip');
    if (chip) chip.innerHTML = `<span class="rune">${esc(skill.rune || '𐰀')}</span> ${esc(skill.name)}`;
  }

  function renderProviderBadge() {
    const preset = state.providers.find(p => p.id === state.active.provider);
    const name = preset ? preset.name : (state.active.provider || 'demo');
    const model = state.active.model || preset?.defaultModel || '';
    const live = state.active.provider !== 'demo';
    // single provider display: the chip above the composer input (keep only this one)
    const modelChip = $('#ai-model-chip');
    if (modelChip) {
      modelChip.innerHTML = `<i class="ti ti-cpu"></i> ${esc(name)}${model ? ' · ' + esc(model) : ''} <i class="ti ti-settings" style="margin-left:2px"></i>`;
    }
    const foot = $('#ai-foot-model');
    if (foot) {
      foot.textContent = live
        ? `streamed via ${esc(name)}`
        : 'demo channel · add a key in settings';
    }
  }

  /* ---------------- hero ---------------- */

  const HERO_LINES = {
    'market-analyst': 'Where is the *market* leaning?',
    'alert-architect': 'What should we *alert* on?',
    'journal-coach': 'How did the *process* go?',
    _default: 'Ask *anything*.',
  };

  function renderHero() {
    const hero = $('#ai-hero');
    if (!hero) return;
    const skill = activeSkill();
    const raw = HERO_LINES[skill.id] || HERO_LINES._default.replace('*', `*${skill.name}*`);
    let delayIndex = 0;
    const headline = raw.split(' ').map(word => {
      const emphasized = word.startsWith('*') && word.endsWith('*');
      const clean = word.replace(/\*/g, '');
      const node = `<span class="hero-word" style="--d:${(0.25 + delayIndex * 0.09).toFixed(2)}s">${emphasized ? `<em>${esc(clean)}</em>` : esc(clean)}</span>`;
      delayIndex += 1;
      return node;
    }).join(' ');
    hero.innerHTML = `
      <div class="ai-hero-rune" aria-hidden="true">${esc(skill.rune || '𐰀')}</div>
      <div class="ai-hero-top">
        <div class="ai-hero-eyebrow"><span class="tick"></span>${esc(skill.name)} · ${esc(skill.tagline || 'dossier console')}</div>
        <h1>${headline}</h1>
        <p class="ai-hero-sub">Full-screen AI console — pick a skill, ask, watch the answer stream in. Keys stay server-side, never in the browser.</p>
      </div>
      <div class="ai-suggestions">
        ${suggestionsFor(skill.id).map((item, index) => `
          <button type="button" class="ai-sugg" data-suggest="${esc(item.title)}" style="--d:${(0.85 + index * 0.12).toFixed(2)}s">
            <span class="num">${esc(item.num)} //</span>
            <span class="title">${esc(item.title)}</span>
            <span class="hint">${esc(item.hint)}</span>
          </button>`).join('')}
      </div>`;
  }

  /* ---------------- thread rendering ---------------- */

  function messageHtml(message, index) {
    const user = message.role === 'user';
    const toolChips = !user && Array.isArray(message.toolCalls) && message.toolCalls.length
      ? `<div class="ai-tools">${message.toolCalls.map(call => `
          <div class="ai-tool-chip done">
            <span class="t-ico"><i class="ti ti-check"></i></span>
            <span class="t-name">${esc(call.name || 'tool')}${call.args && Object.keys(call.args).length ? ' · ' + esc(Object.values(call.args).join(' ').slice(0, 42)) : ''}</span>
            ${call.summary ? `<span class="t-sum">${esc(call.summary)}</span>` : ''}
          </div>`).join('')}</div>`
      : '';
    const attachHtml = user && Array.isArray(message.attachments) && message.attachments.length
      ? `<div class="ai-attach-previews" style="margin-top:8px">${message.attachments.map(a => `
          <span class="ai-attach-chip">${a.kind==='image' && a.thumb ? `<img src="${esc(a.thumb)}" alt="">` : `<i class="ti ti-file" style="font-size:16px;color:var(--muted)"></i>`}<span class="name">${esc(a.name)}</span></span>`).join('')}</div>`
      : '';
    return `
      <div class="msg ${user ? 'msg-user' : 'msg-assistant'}" data-msg="${esc(message.id || String(index))}">
        <div class="msg-avatar">${user ? '<i class="ti ti-user"></i>' : esc(activeSkill().rune || '𐰀')}</div>
        <div class="msg-body">
          <div class="msg-meta">
            <span class="who">${user ? 'You' : esc(message.skillName || activeSkill().name)}</span>
            <span>${esc(message.time || '')}</span>
            ${user ? '' : `<button type="button" class="msg-copy" data-copy="${esc(message.id || String(index))}">Copy</button>`}
          </div>
          ${toolChips}
          <div class="msg-text">${user ? renderMarkdown(message.content) : renderMarkdown(message.content)}</div>
          ${attachHtml}
        </div>
      </div>`;
  }

  function renderThread() {
    const threadEl = $('#ai-thread');
    const hero = $('#ai-hero');
    if (!threadEl) return;
    const messages = thread();
    if (!messages.length) {
      threadEl.innerHTML = '<div class="ai-thread-inner" id="ai-thread-inner"></div>';
      hero?.classList.remove('hidden');
      renderHero();
      return;
    }
    hero?.classList.add('hidden');
    const stamp = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    threadEl.innerHTML = `
      <div class="ai-thread-inner" id="ai-thread-inner">
        <div class="ai-daystamp">${esc(stamp)}</div>
        ${messages.map(messageHtml).join('')}
      </div>`;
    scrollBottom(false);
  }

  /* ---------------- streaming send ---------------- */

  function appendThinking() {
    const inner = $('#ai-thread-inner');
    if (!inner) return null;
    const chip = document.createElement('div');
    chip.className = 'ai-thinking';
    chip.id = 'ai-thinking';
    chip.innerHTML = '<span class="dots"><i></i><i></i><i></i></span><span>Analyzing</span>';
    inner.appendChild(chip);
    scrollBottom();
    return chip;
  }

  function appendErrorChip(message) {
    const inner = $('#ai-thread-inner');
    if (!inner) return;
    const chip = document.createElement('div');
    chip.className = 'ai-error-chip';
    chip.innerHTML = `
      <i class="ti ti-alert-triangle"></i>
      <span>${esc(message)}</span>
      <button type="button" data-open-settings>Settings</button>`;
    inner.appendChild(chip);
    scrollBottom();
  }

  function startAssistantBubble() {
    const inner = $('#ai-thread-inner');
    if (!inner) return null;
    const wrapper = document.createElement('div');
    wrapper.className = 'msg msg-assistant';
    wrapper.innerHTML = `
      <div class="msg-avatar">${esc(activeSkill().rune || '𐰀')}</div>
      <div class="msg-body streaming">
        <div class="msg-meta">
          <span class="who">${esc(activeSkill().name)}</span>
          <span data-stream-model>${esc(state.active.model || state.active.provider || '')}</span>
          <button type="button" class="msg-copy" data-copy-stream>Copy</button>
        </div>
        <div class="ai-tools" data-stream-tools></div>
        <div class="msg-text" data-stream-text><span class="ai-caret"></span></div>
      </div>`;
    inner.appendChild(wrapper);
    scrollBottom();
    return wrapper;
  }

  function upsertToolChip(container, toolEvent) {
    const host = container.querySelector('[data-stream-tools]');
    if (!host || !toolEvent) return;
    const name = toolEvent.name || 'tool';
    let chip = host.querySelector(`[data-tool-chip="${CSS.escape(name)}"]`);
    if (!chip) {
      chip = document.createElement('div');
      chip.className = 'ai-tool-chip running';
      chip.setAttribute('data-tool-chip', name);
      host.appendChild(chip);
    }
    const args = toolEvent.args && Object.keys(toolEvent.args).length
      ? ` · ${Object.values(toolEvent.args).join(' ').slice(0, 42)}`
      : '';
    const status = toolEvent.status === 'done'
      ? (toolEvent.ok === false ? 'err' : 'done')
      : 'running';
    chip.className = `ai-tool-chip ${status}`;
    chip.innerHTML = `
      <span class="t-ico"><i class="ti ${status === 'running' ? 'ti-loader-2' : status === 'err' ? 'ti-alert-triangle' : 'ti-check'}"></i></span>
      <span class="t-name">${esc(name)}${esc(args)}</span>
      ${toolEvent.summary ? `<span class="t-sum">${esc(toolEvent.summary)}</span>` : ''}`;
    scrollBottom(false);
  }

  function setStreamText(container, text) {
    if (container.dataset.done === '1') return;
    const target = container.querySelector('[data-stream-text]');
    if (!target) return;
    target.innerHTML = renderMarkdown(text) + '<span class="ai-caret"></span>';
  }

  function finalizeStream(container, text, meta = {}) {
    container.dataset.done = '1';
    const body = container.querySelector('.msg-body');
    const target = container.querySelector('[data-stream-text]');
    if (target) target.innerHTML = renderMarkdown(text);
    body?.classList.remove('streaming');
    const modelEl = container.querySelector('[data-stream-model]');
    if (modelEl && meta.model) modelEl.textContent = `${meta.provider || ''} · ${meta.model}`;
    const copy = container.querySelector('[data-copy-stream]');
    if (copy) copy.setAttribute('data-copy', 'stream-final');
    if (copy) copy.onclick = () => {
      navigator.clipboard?.writeText(text).then(() => {
        copy.textContent = 'Copied';
        copy.classList.add('done');
        setTimeout(() => {
          copy.textContent = 'Copy';
          copy.classList.remove('done');
        }, 1400);
      });
    };
  }

  async function parseSse(response, onEvent) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalMeta = {};
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n');
      buffer = parts.pop() ?? '';
      for (const raw of parts) {
        const line = raw.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        let event;
        try {
          event = JSON.parse(payload);
        } catch {
          continue;
        }
        if (event.error) throw new Error(event.error);
        if (event.delta) onEvent({ delta: event.delta });
        if (event.reset) onEvent({ reset: true });
        if (event.tool) onEvent({ tool: event.tool });
        if (event.done) finalMeta = event;
      }
    }
    return finalMeta;
  }

  // Build API content for vision models: [{type:'text'}, {type:'image_url'}]
  // JSON / text files are inlined as text; images as true image_url parts so vision keys see them.
  function buildApiParts(prompt, files) {
    if (!files.length) return String(prompt || '');
    const parts = [];
    if (prompt) parts.push({ type: 'text', text: String(prompt) });
    else parts.push({ type: 'text', text: 'Analyze the attached file(s) in detail.' });
    for (const f of files) {
      if (f.kind === 'image' && f.dataUrl) {
        parts.push({ type: 'image_url', image_url: { url: f.dataUrl } });
        parts.push({ type: 'text', text: `[Image: ${f.name}] — analyze the chart / screenshot above.` });
      } else if (f.text) {
        const preview = String(f.text).slice(0, 18000);
        const truncated = f.text.length > 18000 ? '\n…[file truncated to 18000 chars — ask if you need the rest]' : '';
        parts.push({ type: 'text', text: `File: ${f.name} (${f.mime})\n\`\`\`\n${preview}${truncated}\n\`\`\`` });
      } else {
        parts.push({ type: 'text', text: `File: ${f.name} (${f.mime}) — [no extractable text]` });
      }
    }
    return parts;
  }

  function messageHtmlWithAttachments(message) {
    return messageHtml(message, 0);
  }

  async function send(text) {
    const raw = String(text || '');
    const prompt = raw.trim();
    const hasFiles = state.pendingFiles.length > 0;
    if ((!prompt && !hasFiles) || state.sending) return;
    const skill = activeSkill();
    const messages = thread();
    const sentFiles = hasFiles ? [...state.pendingFiles] : [];
    // API payload: array with image_url for vision, text blocks for JSON
    const apiParts = hasFiles ? buildApiParts(prompt, sentFiles) : String(prompt);
    // What we store locally: text only (never persist full base64 to localStorage — quota)
    const displayText = hasFiles
      ? (prompt ? prompt + '\n\n' : '') + sentFiles.map(f => `[Attached: ${f.name} — ${f.kind === 'image' ? 'image sent as vision input' : f.text ? `${f.text.length} chars inlined` : 'no text'}]`).join('\n')
      : String(prompt);
    const previewText = displayText.slice(0, 3000);
    messages.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      role: 'user',
      content: previewText || '(attached files)',
      _apiContent: apiParts, // kept for this turn's request only; stripped before save
      attachments: sentFiles.map(f => ({ name: f.name, kind: f.kind, thumb: f.kind === 'image' ? f.dataUrl : null })),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });
    if (messages.length > MAX_THREAD) messages.splice(0, messages.length - MAX_THREAD);
    // Strip _apiContent before persisting (base64 would blow localStorage)
    const toSave = messages.map(m => ({ ...m, _apiContent: undefined }));
    const prevThreads = state.threads[state.skillId];
    state.threads[state.skillId] = toSave;
    saveLocal();
    state.threads[state.skillId] = messages; // restore for live context
    renderThread();
    $('#ai-hero')?.classList.add('hidden');
    state.pendingFiles = [];
    renderAttachPreviews();
    updateHasText();
    state.sending = true;
    const sendBtn = $('#ai-send');
    sendBtn?.classList.add('busy');
    const thinking = appendThinking();

    // Context: all prior messages as text, last user message as array (if files)
    const baseContext = messages.slice(-CONTEXT_MESSAGES).map((message, idx, arr) => {
      const isLast = idx === arr.length - 1;
      const c = isLast && message._apiContent ? message._apiContent : message.content;
      return { role: message.role, content: c };
    });

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skillId: skill.id,
          provider: state.active.provider || undefined,
          model: state.active.model || undefined,
          stream: true,
          messages: baseContext,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const error = new Error(data.error || `Chat failed (HTTP ${response.status})`);
        error.status = response.status;
        throw error;
      }

      const contentType = response.headers.get('content-type') || '';
      thinking?.remove();

      let assistantText = '';
      let meta = { provider: state.active.provider, model: state.active.model };
      const bubble = startAssistantBubble();

      if (contentType.includes('application/json')) {
        const data = await response.json();
        assistantText = data?.message?.content || '';
        meta = { provider: data.provider, model: data.model };
        setStreamText(bubble, assistantText);
        await new Promise(resolve => setTimeout(resolve, 180));
      } else {
        const toolCalls = [];
        let pending = false;
        const paint = () => {
          pending = false;
          setStreamText(bubble, assistantText);
        };
        meta = await parseSse(response, event => {
          if (event.reset) {
            // the streamed text was a tool-call block — replaced by tool chips
            assistantText = '';
            if (!pending) {
              pending = true;
              requestAnimationFrame(paint);
            }
            return;
          }
          if (event.tool) {
            if (event.tool.status === 'done' || event.tool.status === undefined) {
              toolCalls.push({ name: event.tool.name, args: event.tool.args, summary: event.tool.summary });
            }
            upsertToolChip(bubble, event.tool);
            return;
          }
          assistantText += event.delta;
          if (!pending) {
            pending = true;
            requestAnimationFrame(paint);
          }
          scrollBottom(false);
        });
        if (!Array.isArray(meta.toolCalls) || !meta.toolCalls.length) {
          meta.toolCalls = toolCalls;
        }
      }

      finalizeStream(bubble, assistantText, meta);
      messages.push({
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + 1),
        role: 'assistant',
        content: assistantText,
        skillName: skill.name,
        toolCalls: meta.toolCalls || [],
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
      if (messages.length > MAX_THREAD) messages.splice(0, messages.length - MAX_THREAD);
      saveLocal();
      if (meta.provider && meta.provider !== (state.active.provider || 'demo')) {
        // server fell back (e.g. demo) — keep the badge truthful
        state.active.provider = meta.provider;
        renderProviderBadge();
      }
    } catch (error) {
      thinking?.remove();
      const raw = error?.message || 'Chat failed';
      appendErrorChip(raw);
      toast(raw, 'err');
    } finally {
      state.sending = false;
      sendBtn?.classList.remove('busy');
      scrollBottom();
      updateHasText();
    }
  }

  /* ---------------- composer ---------------- */

  function updateHasText() {
    const input = $('#ai-input');
    const form = $('#ai-composer');
    if (!input || !form) return;
    const has = Boolean(input.value.trim()) || state.pendingFiles.length > 0;
    form.classList.toggle('has-text', has);
    const attachBtn = $('#ai-attach-btn');
    if (attachBtn) attachBtn.classList.toggle('has-file', state.pendingFiles.length > 0);
    const hint = $('#ai-attach-hint');
    if (hint) hint.style.display = state.pendingFiles.length ? 'block' : 'none';
  }

  function autoGrow() {
    const input = $('#ai-input');
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 200) + 'px';
  }

  function renderAttachPreviews() {
    const host = $('#ai-attach-previews');
    if (!host) return;
    if (!state.pendingFiles.length) { host.innerHTML = ''; return; }
    host.innerHTML = state.pendingFiles.map(f => `
      <span class="ai-attach-chip">
        ${f.kind==='image' && f.dataUrl ? `<img src="${esc(f.dataUrl)}" alt="">` : `<i class="ti ${f.kind==='image'?'ti-photo':'ti-file'}" style="font-size:16px;color:var(--muted)"></i>`}
        <span class="name" title="${esc(f.name)}">${esc(f.name)}</span>
        <button type="button" class="rm" data-rm-file="${esc(f.id)}" title="Remove"><i class="ti ti-x"></i></button>
      </span>`).join('');
  }

  function compressImageToDataUrl(file, maxSide=1280, quality=0.72) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth, h = img.naturalHeight;
        const scale = Math.min(1, maxSide / Math.max(w, h));
        w = Math.round(w * scale); h = Math.round(h * scale);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        try { resolve(c.toDataURL('image/jpeg', quality)); } catch(e){ reject(e); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image load failed')); };
      img.src = url;
    });
  }

  async function handlePickedFiles(fileList) {
    const files = Array.from(fileList || []).slice(0, 4 - state.pendingFiles.length);
    if (!files.length) { toast('Max 4 files per message', 'warn'); return; }
    for (const file of files) {
      const id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()+Math.random())).slice(0,8);
      const isImage = file.type.startsWith('image/');
      const isTextLike = /^(text\/|application\/(json|csv))/.test(file.type) || /\.(txt|md|csv|json)$/i.test(file.name);
      if (isImage) {
        if (file.size > 12 * 1024 * 1024) { toast(`${file.name} too large (max 12MB)`, 'err'); continue; }
        try {
          const dataUrl = await compressImageToDataUrl(file);
          state.pendingFiles.push({ id, name: file.name, kind: 'image', mime: 'image/jpeg', dataUrl, text: '' });
        } catch { toast(`Could not read ${file.name}`, 'err'); }
      } else if (isTextLike || file.type === 'application/pdf') {
        if (file.size > 2 * 1024 * 1024) { toast(`${file.name} too large (max 2MB for text/pdf)`, 'err'); continue; }
        try {
          const text = await file.text();
          state.pendingFiles.push({ id, name: file.name, kind: 'text', mime: file.type || 'text/plain', dataUrl: '', text: text.slice(0, 12000) });
        } catch { toast(`Could not read ${file.name}`, 'err'); }
      } else {
        toast(`${file.name}: only images / txt / md / csv / json / pdf`, 'warn');
      }
    }
    renderAttachPreviews();
    updateHasText();
  }

  /* ---------------- events ---------------- */

  function setSkill(skillId) {
    if (skillId === state.skillId) return;
    state.skillId = skillId;
    saveLocal();
    renderRail();
    const threadEl = $('#ai-thread');
    if (threadEl) {
      threadEl.style.animation = 'ai-thread-out .3s ease forwards';
      setTimeout(() => {
        threadEl.style.animation = '';
        renderThread();
      }, 220);
    } else {
      renderThread();
    }
  }

  function wire() {
    document.querySelector('.ai-rail')?.addEventListener('click', event => {
      const skillBtn = event.target.closest('[data-skill]');
      if (skillBtn) {
        setSkill(skillBtn.dataset.skill);
        return;
      }
      if (event.target.closest('[data-add-skill]')) {
        window.PriceAlertSettings?.open({ section: 'skills' });
      }
      if (event.target.closest('[data-new-chat]')) {
        const threadEl = $('#ai-thread');
        if (thread().length && !window.confirm('Clear this skill\'s conversation?')) return;
        state.threads[state.skillId] = [];
        saveLocal();
        if (threadEl) {
          threadEl.style.animation = 'ai-thread-out .3s ease forwards';
          setTimeout(() => {
            threadEl.style.animation = '';
            renderThread();
            $('#ai-input')?.focus();
          }, 220);
        }
      }
    });

    $('#ai-provider-badge')?.addEventListener('click', () => window.PriceAlertSettings?.open());

    $('#ai-hero')?.addEventListener('click', event => {
      const suggestion = event.target.closest('[data-suggest]');
      if (suggestion) {
        send(suggestion.dataset.suggest);
      }
    });

    $('#ai-thread')?.addEventListener('click', event => {
      const copyBtn = event.target.closest('.msg-copy[data-copy]');
      if (copyBtn && copyBtn.dataset.copy !== 'stream-final') {
        const message = thread().find(item => item.id === copyBtn.dataset.copy);
        const text = message?.content || copyBtn.closest('.msg-body')?.querySelector('.msg-text')?.innerText || '';
        navigator.clipboard?.writeText(text).then(() => {
          copyBtn.textContent = 'Copied';
          copyBtn.classList.add('done');
          setTimeout(() => {
            copyBtn.textContent = 'Copy';
            copyBtn.classList.remove('done');
          }, 1400);
        });
      }
      if (event.target.closest('[data-open-settings]')) {
        window.PriceAlertSettings?.open();
      }
    });

    const input = $('#ai-input');
    const fileInput = $('#ai-file');
    const attachBtn = $('#ai-attach-btn');
    attachBtn?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', () => {
      if (fileInput.files?.length) { handlePickedFiles(fileInput.files); fileInput.value = ''; }
    });
    // click X on a chip
    $('#ai-attach-previews')?.addEventListener('click', event => {
      const btn = event.target.closest('[data-rm-file]');
      if (!btn) return;
      const id = btn.dataset.rmFile;
      state.pendingFiles = state.pendingFiles.filter(f => f.id !== id);
      renderAttachPreviews();
      updateHasText();
    });
    // paste image directly (Ctrl+V)
    input?.addEventListener('paste', event => {
      const items = event.clipboardData?.items;
      if (!items) return;
      const files = [];
      for (const it of items) if (it.kind === 'file') { const f = it.getAsFile(); if (f) files.push(f); }
      if (files.length) { event.preventDefault(); handlePickedFiles(files); }
    });
    // drag & drop onto composer
    const composer = $('#ai-composer');
    composer?.addEventListener('dragover', e => { e.preventDefault(); composer.classList.add('drag-over'); });
    composer?.addEventListener('dragleave', () => composer.classList.remove('drag-over'));
    composer?.addEventListener('drop', e => {
      e.preventDefault(); composer.classList.remove('drag-over');
      const files = e.dataTransfer?.files;
      if (files?.length) handlePickedFiles(files);
    });
    input?.addEventListener('input', () => {
      autoGrow();
      updateHasText();
    });
    input?.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        const value = input.value;
        input.value = '';
        autoGrow();
        updateHasText();
        send(value);
      }
    });

    $('#ai-composer')?.addEventListener('submit', event => {
      event.preventDefault();
      const value = input.value;
      input.value = '';
      autoGrow();
      updateHasText();
      send(value);
    });

    $('#ai-send')?.addEventListener('click', () => {
      const value = input.value;
      input.value = '';
      autoGrow();
      updateHasText();
      send(value);
    });

    $('#ai-model-chip')?.addEventListener('click', () => window.PriceAlertSettings?.open());

    const threadEl = $('#ai-thread');
    threadEl?.addEventListener('scroll', () => {
      const btn = $('#ai-scroll-btn');
      if (!btn) return;
      const distance = threadEl.scrollHeight - threadEl.scrollTop - threadEl.clientHeight;
      btn.classList.toggle('show', distance > 240);
    });
    $('#ai-scroll-btn')?.addEventListener('click', () => scrollBottom());

    document.addEventListener('ai-state-changed', event => {
      const detail = event.detail || {};
      if (Array.isArray(detail.providers)) state.providers = detail.providers;
      if (Array.isArray(detail.skills)) {
        state.skills = withMandatorySkills(detail.skills);
        if (!state.skills.some(skill => skill.id === state.skillId)) {
          state.skillId = state.skills[0]?.id || 'market-analyst';
        }
      }
      if (detail.active) state.active = detail.active;
      renderRail();
      renderProviderBadge();
      if (!thread().length) renderHero();
    });

    document.addEventListener('keydown', event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        input?.focus();
      }
    });

    document.querySelector('[data-open-settings]')?.addEventListener('click', () => window.PriceAlertSettings?.open());
  }

  /* ---------------- boot ---------------- */

  // Shell fallback so the page always looks complete (e.g. static preview)
  // even when /api/ai/state is unreachable. Must mirror aiCore DEFAULT_SKILLS.
  const FALLBACK_SKILLS = [
    { id: 'daily-brief', name: 'Daily Brief', icon: 'ti-news', rune: '𐱅', tagline: 'Today\u2019s calendar \u2014 AI brief', builtin: true },
    { id: 'global-macro', name: 'Global Macro', icon: 'ti-world', rune: '𐰇', tagline: 'World news \u2014 pair impact', builtin: true },
    { id: 'market-analyst', name: 'Market Analyst', icon: 'ti-chart-candle', rune: '𐰴', tagline: 'Structure, momentum & setups', builtin: true },
    { id: 'alert-architect', name: 'Alert Architect', icon: 'ti-bell-ringing', rune: '𐰛', tagline: 'Design precise alert levels', builtin: true },
    { id: 'journal-coach', name: 'Journal Coach', icon: 'ti-notebook', rune: '𐰸', tagline: 'Discipline & performance review', builtin: true },
  ];

  // Guarantee the two new briefs appear in the LEFT RAIL even if the server
  // is still on an old bundle (before deploy/restart). The server is source of
  // truth long-term; this is a forward-compat shim so you see them immediately.
  function withMandatorySkills(skills) {
    const list = Array.isArray(skills) ? [...skills] : [];
    const have = new Set(list.map(s => s.id));
    for (const must of FALLBACK_SKILLS) {
      if ((must.id === 'daily-brief' || must.id === 'global-macro') && !have.has(must.id)) {
        // keep order: daily, global first
        if (must.id === 'daily-brief') list.unshift(must);
        else {
          const idx = list.findIndex(s => s.id === 'daily-brief');
          list.splice(idx === -1 ? 0 : idx + 1, 0, must);
        }
      }
    }
    // de-dupe just in case
    const seen = new Set();
    return list.filter(s => (seen.has(s.id) ? false : (seen.add(s.id), true)));
  }

  async function boot() {
    loadLocal();
    wire();
    state.skills = withMandatorySkills(state.skills.length ? state.skills : FALLBACK_SKILLS.map(skill => ({ ...skill })));
    renderRail();
    renderProviderBadge();
    renderThread();
    autoGrow();

    try {
      const response = await fetch('/api/ai/state');
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data.skills) && data.skills.length) {
          state.skills = withMandatorySkills(data.skills);
          if (!state.skills.some(skill => skill.id === state.skillId)) {
            state.skillId = state.skills[0].id;
          }
        } else {
          state.skills = withMandatorySkills(state.skills);
        }
        if (Array.isArray(data.providers)) state.providers = data.providers;
        if (data.active) state.active = data.active;
      } else if (response.status === 401 || response.status === 503) {
        toast('Dashboard login required to reach the AI API.', 'warn');
      }
    } catch {
      toast('AI API unreachable — showing local shell.', 'warn');
    }

    renderRail();
    renderProviderBadge();
    renderThread();
    // query ?settings=1 opens the drawer immediately (header Settings button)
    if (new URLSearchParams(location.search).get('settings') === '1') {
      window.PriceAlertSettings?.open();
    }
    $('#ai-input')?.focus();
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
