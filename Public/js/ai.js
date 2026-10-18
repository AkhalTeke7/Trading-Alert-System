/* ai.js — full-screen AI console client: skills, streamed replies, threads.
   Talks to /api/ai/* (Cloudflare worker or the local Node server). Keys never
   touch this file — chat is proxied server-side; Settings saves keys. */
(function () {
  'use strict';

  const LS_KEY = 'pa.ai.v1';
  const LS_STATE = 'pa.ai.stateCache.v1';
  const LS_DRAFT = 'pa.ai.draft.v1';
  const LS_PROMPT_CACHE = 'pa.ai.promptCache.v1';
  const LS_META = 'pa.ai.meta.v1';
  const LS_BRIDGE = 'pa.ai.bridge.v1';
  const MAX_THREAD = 80;
  const CONTEXT_MESSAGES = 24;
  const STATE_TTL_MS = 2 * 60 * 1000;
  const PROMPT_TTL_MS = 30 * 60 * 1000;

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
    // Safe GFM inline renderer — works on raw text, escapes only plain-text chunks,
    // stores HTML (code/links/images) as placeholders so nothing double-encodes.
    let src = String(text ?? '');
    const htmls = [];
    const ph = i => `\uE000${i}\uE001`;
    const save = html => { const id = htmls.length; htmls.push(html); return ph(id); };

    // inline code `code` — first so inner markdown is not parsed
    src = src.replace(/`([^`]+?)`/g, (_, code) => save(`<code>${esc(code)}</code>`));

    // images ![alt](url "title")
    src = src.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*?)")?\)/g, (_, alt, rawUrl, title) => {
      let url = String(rawUrl || '').trim();
      if (/^\s*javascript:/i.test(url) || /^\s*vbscript:/i.test(url)) return save(esc(alt));
      if (!/^(https?:\/\/|\/|data:image\/)/.test(url)) return save(esc(alt));
      return save(`<img src="${esc(url)}" alt="${esc(alt)}"${title ? ` title="${esc(title)}"` : ''} loading="lazy">`);
    });

    // links [text](url "title") — after images
    src = src.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*?)")?\)/g, (_, label, rawUrl, title) => {
      let url = String(rawUrl || '').trim();
      if (/^\s*javascript:/i.test(url) || /^\s*vbscript:/i.test(url)) return save(esc(label));
      if (/^www\./i.test(url)) url = 'https://' + url;
      if (!/^(https?:\/\/|mailto:|\/|#)/.test(url)) return save(esc(label));
      return save(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer"${title ? ` title="${esc(title)}"` : ''}>${esc(label)}</a>`);
    });

    // autolink <https://example.com>
    src = src.replace(/<(https?:\/\/[^>]+)>/g, (_, url) => {
      url = String(url || '').trim();
      if (/^\s*javascript:/i.test(url)) return save(esc(url));
      return save(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`);
    });

    // bare URLs https://... / www....  — placeholders (\uE000) won't match, so no double-linking
    src = src.replace(/(https?:\/\/[^\s\uE000]+|www\.[^\s\uE000]+)/gi, m => {
      let url = m;
      let suffix = '';
      const trail = url.match(/[.,;:!?]+$/);
      if (trail) { suffix = trail[0]; url = url.slice(0, -suffix.length); }
      if (/[)\]]$/.test(url)) { suffix = url.slice(-1) + suffix; url = url.slice(0, -1); }
      let href = url;
      if (/^www\./i.test(href)) href = 'https://' + href;
      return save(`<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`) + suffix;
    });

    // Escape plain-text chunks only, then run emphasis on the escaped chunks.
    const parts = src.split(/(\uE000\d+\uE001)/g);
    src = parts.map(part => {
      if (/^\uE000\d+\uE001$/.test(part)) return part; // placeholder — already HTML
      let chunk = esc(part);
      // strikethrough ~~text~~ (GFM)
      chunk = chunk.replace(/~~([^~]+)~~/g, '<del>$1</del>');
      // bold+italic ***text*** and ___text___
      chunk = chunk.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
      chunk = chunk.replace(/___([^_]+)___/g, '<strong><em>$1</em></strong>');
      // bold **text** and __text__
      chunk = chunk.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      chunk = chunk.replace(/__([^_]+)__/g, '<strong>$1</strong>');
      // italic *text* and _text_ (avoid catching ** already handled)
      chunk = chunk.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, (_, pre, t) => `${pre}<em>${t}</em>`);
      chunk = chunk.replace(/(^|[^a-zA-Z0-9])_([^_\n]+)_(?![a-zA-Z0-9_])/g, (_, pre, t) => `${pre}<em>${t}</em>`);
      return chunk;
    }).join('');

    // restore placeholders
    src = src.replace(/\uE000(\d+)\uE001/g, (_, n) => htmls[Number(n)] || '');
    return src;
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

  /* ---------------- storage + caching ---------------- */
  // Cache layers:
  //  - LS_KEY          : threads + active skill (durable history, survives reload/offline)
  //  - LS_STATE        : /api/ai/state (stale-while-revalidate, 2m TTL, instant boot)
  //  - LS_DRAFT        : per-skill composer draft (autosaved, restored on switch/reload)
  //  - LS_PROMPT_CACHE : last assistant answer per skill+prompt hash (30m TTL, dedup fast re-asks)
  //  - LS_META         : small meta (lastStateAt etc)
  // All writes handle QuotaExceededError by evicting oldest threads first.

  let drafts = {};
  let promptCache = {};

  function safeParse(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  }
  function byteSize(str) { try { return new Blob([str]).size; } catch { return String(str).length; } }

  function setWithEviction(key, value) {
    const trySet = (v)=>{ try{ localStorage.setItem(key, JSON.stringify(v)); return true; } catch(e){ return e; } };
    let r = trySet(value);
    if (r===true) return true;
    const e = r;
    const isQuota = e && (e.name === 'QuotaExceededError' || /quota/i.test(String(e.message||'')));
    if (!isQuota) return false;
    const ids = Object.keys(state.threads);
    ids.sort((a,b)=>{
      const ta = state.threads[a]; const tb = state.threads[b];
      const la = ta?.length ? (ta[ta.length-1]?.time||'') : '';
      const lb = tb?.length ? (tb[tb.length-1]?.time||'') : '';
      return String(la).localeCompare(String(lb));
    });
    for (const id of ids) {
      if (id === state.skillId && state.threads[id]?.length) {
        if (state.threads[id].length > 12) state.threads[id].splice(0, state.threads[id].length - 12);
        else continue;
      } else {
        delete state.threads[id];
      }
      // recompute after eviction
      const nv = key===LS_KEY ? { skillId: state.skillId, threads: state.threads } : value;
      if (trySet(nv)===true) return true;
      try { localStorage.removeItem(LS_PROMPT_CACHE); promptCache={}; } catch {}
      if (trySet(nv)===true) return true;
    }
    try {
      const keep = {}; if (state.threads[state.skillId]) keep[state.skillId] = state.threads[state.skillId].slice(-12);
      const nv2 = key===LS_KEY ? { skillId: state.skillId, threads: keep } : value;
      if (trySet(nv2)===true) { state.threads=keep; toast('Cache full — trimmed old chats','warn'); return true; }
    } catch {}
    return false;
  }

  function loadLocal() {
    try {
      const data = safeParse(LS_KEY, null);
      if (data && typeof data === 'object') {
        state.threads = data.threads && typeof data.threads === 'object' ? data.threads : {};
        if (data.skillId) state.skillId = data.skillId;
        // cap each thread eagerly so a prior bug can't fill storage
        for (const k of Object.keys(state.threads)) {
          if (Array.isArray(state.threads[k]) && state.threads[k].length > MAX_THREAD) state.threads[k] = state.threads[k].slice(-MAX_THREAD);
          // strip any legacy _apiContent / huge dataUrls that may have been persisted
          state.threads[k] = state.threads[k].map(m=>{ const n={...m}; delete n._apiContent; if(Array.isArray(n.attachments)) n.attachments=n.attachments.map(a=>({name:a.name,kind:a.kind,thumb:a.thumb?String(a.thumb).slice(0,600):null})); return n; });
        }
      }
      drafts = safeParse(LS_DRAFT, {});
      if (!drafts || typeof drafts !== 'object') drafts = {};
      promptCache = safeParse(LS_PROMPT_CACHE, {});
      if (!promptCache || typeof promptCache !== 'object') promptCache = {};
      // prune expired prompt entries on load
      const now = Date.now(); let pruned=false;
      for (const [k,v] of Object.entries(promptCache)) if (!v || (now - (v.ts||0) > PROMPT_TTL_MS)) { delete promptCache[k]; pruned=true; }
      if (pruned) try { localStorage.setItem(LS_PROMPT_CACHE, JSON.stringify(promptCache)); } catch {}
    } catch { /* corrupted local state is non-fatal */ }
  }

  function saveLocal() {
    setWithEviction(LS_KEY, { skillId: state.skillId, threads: state.threads });
  }

  function thread() {
    if (!Array.isArray(state.threads[state.skillId])) state.threads[state.skillId] = [];
    return state.threads[state.skillId];
  }

  // Drafts: autosaved per skill, restored on boot/switch (text only; pendingFiles are ephemeral)
  function saveDraft(skillId, text) {
    const id = skillId || state.skillId;
    if (!text) delete drafts[id]; else drafts[id] = String(text).slice(0, 8000);
    try { localStorage.setItem(LS_DRAFT, JSON.stringify(drafts)); } catch {}
  }
  function getDraft(skillId) { return String(drafts[skillId] || ''); }
  let _draftTimer=null;
  function scheduleDraftSave() {
    clearTimeout(_draftTimer);
    _draftTimer = setTimeout(()=>{ const inp=$('#ai-input'); if(inp) saveDraft(state.skillId, inp.value); }, 450);
  }

  // State cache (stale-while-revalidate): makes the console paint instantly even offline
  function loadStateCache() { const c=safeParse(LS_STATE,null); return c && c.data ? c : null; }
  function saveStateCache(data) {
    try { localStorage.setItem(LS_STATE, JSON.stringify({ ts: Date.now(), data })); } catch {}
    try { localStorage.setItem(LS_META, JSON.stringify({ lastStateAt: Date.now() })); } catch {}
  }
  function applyStateCache(cache, { forceFresh=false }={}) {
    if (!cache?.data) return false;
    const fresh = (Date.now() - (cache.ts||0)) < STATE_TTL_MS;
    if (forceFresh && !fresh) return false;
    const d = cache.data;
    if (Array.isArray(d.skills) && d.skills.length) { state.skills = withMandatorySkills(d.skills); if (!state.skills.some(s=>s.id===state.skillId)) state.skillId = state.skills[0].id; }
    if (Array.isArray(d.providers)) state.providers = d.providers;
    if (d.active) state.active = d.active;
    return true;
  }

  // Prompt cache: dedupe identical asks within 30m (served as instant hint, still re-fetches)
  function promptHash(skillId, text) {
    const s = String(skillId||'') + '\0' + String(text||'').trim().toLowerCase();
    let h=5381; for(let i=0;i<s.length;i++) h=((h<<5)+h) ^ s.charCodeAt(i);
    return (h>>>0).toString(36) + '_' + s.length;
  }
  function getPromptCache(skillId, prompt) {
    const k=promptHash(skillId,prompt); const e=promptCache[k];
    if(!e) return null; if(Date.now()-(e.ts||0) > PROMPT_TTL_MS) { delete promptCache[k]; return null; }
    return e;
  }
  function putPromptCache(skillId, prompt, content) {
    const k=promptHash(skillId,prompt);
    promptCache[k]={ ts:Date.now(), skillId, content: String(content||'').slice(0, 12000) };
    // cap at 60 entries (LRU-ish: drop oldest ts)
    const keys=Object.keys(promptCache); if(keys.length>60){
      keys.sort((a,b)=>(promptCache[a].ts||0)-(promptCache[b].ts||0));
      for(let i=0;i<keys.length-60;i++) delete promptCache[keys[i]];
    }
    try { localStorage.setItem(LS_PROMPT_CACHE, JSON.stringify(promptCache)); } catch {}
  }

  function cacheStats() {
    try {
      let total=0; for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); const v=localStorage.getItem(k)||''; if(k&&k.startsWith('pa.ai.')) total+=byteSize(k+v); }
      const msgCount=Object.values(state.threads).reduce((n,a)=>n+(Array.isArray(a)?a.length:0),0);
      const draftCount=Object.keys(drafts).length;
      const pCount=Object.keys(promptCache).length;
      return { bytes: total, msgCount, draftCount, pCount };
    } catch { return { bytes:0, msgCount:0, draftCount:0, pCount:0 }; }
  }
  function exportHistoryBlob() {
    const payload={ exportedAt: new Date().toISOString(), skillId: state.skillId, threads: state.threads };
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a');
    a.href=url; a.download=`ai-history-${new Date().toISOString().slice(0,10)}.json`; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 2000);
  }
  function clearCaches(opts={}) {
    const keepHistory = !!opts.keepHistory;
    try {
      if(!keepHistory) { localStorage.removeItem(LS_KEY); state.threads={}; }
      localStorage.removeItem(LS_STATE); localStorage.removeItem(LS_DRAFT); localStorage.removeItem(LS_PROMPT_CACHE); localStorage.removeItem(LS_META);
      drafts={}; promptCache={};
      if(!keepHistory) { renderThread(); toast('History + cache cleared','warn'); }
      else toast('Cache cleared — history kept','ok');
    } catch {}
    renderThread(); updateHasText();
  }

  // Browser-direct bridge — always ON except demo (fixes shared-IP 429 via your IP/v2ray)
  function getBridgeMap(){ return {}; }
  function isBridgeEnabled(providerId){ const id=String(providerId||''); return id !== '' && id !== 'demo'; }
  function setBridgeEnabled(){} // compat no-op — toggle removed
  async function fetchBridgeCredentials(providerId){
    const r=await fetch('/api/ai/bridge?provider='+encodeURIComponent(providerId), { headers:{'X-AI-Bridge':'1'}});
    if(!r.ok){ const j=await r.json().catch(()=>({})); throw new Error(j.error||('Bridge failed (HTTP '+r.status+')')); }
    return r.json();
  }
  async function fetchPreparedContext(skillId, messages){
    const r=await fetch('/api/ai/context', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ skillId, messages }) });
    if(!r.ok){ return { messages, skill:null }; }
    return r.json();
  }
  async function callToolRemote(tool, args){
    const r=await fetch('/api/ai/tool', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ tool, args: args||{} }) });
    const j=await r.json().catch(()=>({ error:'tool failed'}));
    return j;
  }
  function parseToolCallBrowser(text){
    const fenced=String(text||'').match(/```(?:tool)?\s*\n?(\{[\s\S]*?\})\s*\n?```/);
    const candidates=[]; if(fenced) candidates.push(fenced[1]);
    for(const line of String(text||'').split('\n')){ const t=line.trim(); if(t.startsWith('{"tool"')||t.startsWith('{ "tool"')) candidates.push(t); }
    const TOOL_NAMES_BROWSER=new Set(['test_notification','read_functions','get_prices','list_alerts','list_triggered','journal_summary','get_events','web_search','get_time']);
    for(const raw of candidates){ try{ const p=JSON.parse(raw); const name=String(p?.tool||''); if(!TOOL_NAMES_BROWSER.has(name)) continue; const args=p.args&&typeof p.args==='object'&&!Array.isArray(p.args)?p.args:{}; return {tool:name, args}; }catch{}}
    return null;
  }
  function buildUpstreamRequestBrowser({ preset, apiKey, model, baseUrl, messages, stream }){
    const base=String(baseUrl||preset.baseUrl||'').replace(/\/+$/,'');
    const splitSystem=(msgs)=>{ const sys=msgs.filter(m=>m.role==='system').map(m=> Array.isArray(m.content)? m.content.filter(p=>p&&p.type==='text').map(p=>String(p.text||'')).join('\n'): String(m.content||'')).join('\n'); const rest=msgs.filter(m=>m.role!=='system'); return {system:sys, rest}; };
    const toOpenAi=(msgs)=>msgs.map(m=>{ const c=m.content; if(Array.isArray(c)) return {role:m.role==='system'?'system':m.role==='assistant'?'assistant':'user', content: c.map(p=>{ if(p&&p.type==='image_url'&&p.image_url?.url) return {type:'image_url', image_url:{url:String(p.image_url.url).slice(0,300000)}}; if(p&&p.type==='text') return {type:'text', text:String(p.text??'').slice(0,30000)}; return {type:'text', text:String(p?.text??p??'').slice(0,30000)}; })}; return {role:m.role==='system'?'system':m.role==='assistant'?'assistant':'user', content:String(c??'')}; });
    const toAnthropic=(c)=>{ if(!Array.isArray(c)) return String(c??''); return c.map(p=>{ if(p&&p.type==='image_url'&&p.image_url?.url){ const url=String(p.image_url.url); const m=url.match(/^data:([^;]+);base64,(.*)$/s); if(m) return {type:'image', source:{type:'base64', media_type:m[1], data:m[2].slice(0,300000)}}; return {type:'image', source:{type:'url', url}};} if(p&&p.type==='text') return {type:'text', text:String(p.text??'')}; return {type:'text', text:String(p?.text??p??'')}; }); };
    if(preset.kind==='anthropic'){ const {system, rest}=splitSystem(messages); return {url: base+'/messages', headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01'}, body: JSON.stringify({model, max_tokens:4096, ...(system?{system}:{}), messages: rest.map(m=>({role:m.role==='assistant'?'assistant':'user', content: Array.isArray(m.content)? toAnthropic(m.content): String(m.content??'')})), ...(stream?{stream:true}:{})})}; }
    if(preset.kind==='google'){ const {system, rest}=splitSystem(messages); const url=base+'/models/'+encodeURIComponent(model)+':'+(stream?'streamGenerateContent?alt=sse':'generateContent'); const toParts=(c)=>{ if(Array.isArray(c)) return c.map(p=>{ if(p&&p.type==='image_url'&&p.image_url?.url){ const u=String(p.image_url.url); const comma=u.indexOf(','); const b64=comma!==-1? u.slice(comma+1): u; return {inlineData:{mimeType:'image/jpeg', data:b64.slice(0,300000)}};} return {text:String(p?.text??'')}; }); return [{text:String(c??'') }]; }; return {url, headers:{'Content-Type':'application/json','x-goog-api-key':apiKey}, body: JSON.stringify({ ...(system?{systemInstruction:{parts:[{text:system}]}}:{}), contents: rest.map(m=>({role:m.role==='assistant'?'model':'user', parts: toParts(m.content)})), generationConfig:{maxOutputTokens:4096}})}; }
    return {url: base+'/chat/completions', headers:{'Content-Type':'application/json', Authorization: 'Bearer '+apiKey}, body: JSON.stringify({model, messages: toOpenAi(messages), ...(stream?{stream:true}:{})})};
  }
  function deltaFromEventBrowser(kind, data){
    if(!data||data==='[DONE]') return null; let p; try{ p=JSON.parse(data);}catch{ return null; }
    if(kind==='anthropic') return p?.type==='content_block_delta'&&p?.delta?.text? String(p.delta.text): null;
    if(kind==='google'){ const parts=p?.candidates?.[0]?.content?.parts; return Array.isArray(parts)? parts.map(x=>x?.text||'').join('')||null: null; }
    const c=p?.choices?.[0]?.delta?.content; return c? String(c): null;
  }
  async function* streamDeltasBrowser(kind, body){
    const reader=body?.getReader? body.getReader(): null; if(!reader) return; const dec=new TextDecoder(); let carry='';
    const sseLines=(chunk, car)=>{ const t=car+chunk; const parts=t.split('\n'); const rest=parts.pop()??''; const evs=[]; for(const r of parts){ const line=r.trim(); if(line.startsWith('data:')) evs.push(line.slice(5).trim()); } return {events:evs, rest}; };
    while(true){ const {done,value}=await reader.read(); if(done) break; const {events, rest}=sseLines(dec.decode(value,{stream:true}), carry); carry=rest; for(const e of events){ const d=deltaFromEventBrowser(kind,e); if(d) yield d; } }
    const tail=sseLines(dec.decode()+'\n', carry); for(const e of tail.events){ const d=deltaFromEventBrowser(kind,e); if(d) yield d; }
  }
  function textFromJsonBrowser(kind, data){
    if(kind==='anthropic') return (data?.content||[]).map(b=>b?.text||'').join('');
    if(kind==='google'){ const parts=data?.candidates?.[0]?.content?.parts; return Array.isArray(parts)? parts.map(p=>p?.text||'').join(''): ''; }
    return data?.choices?.[0]?.message?.content||'';
  }
  async function browserDirectChat({ skillId, baseContext, credentials, onDelta, onTool }){
    const preset={ id: credentials.provider, kind: credentials.kind, baseUrl: credentials.baseUrl };
    const apiKey=credentials.apiKey; const model=credentials.model;
    const ctx=await fetchPreparedContext(skillId, baseContext);
    let convo=Array.isArray(ctx.messages)&&ctx.messages.length? ctx.messages: baseContext;
    const skill=ctx.skill||null; const toolCalls=[];
    for(let round=0; round<3; round++){
      const req=buildUpstreamRequestBrowser({ preset, apiKey, model, baseUrl: credentials.baseUrl, messages: convo, stream: true });
      let upstream;
      try{ upstream=await fetch(req.url, { method:'POST', headers:req.headers, body:req.body }); }catch(e){ throw new Error('Could not reach '+preset.id+' from browser — CORS or network blocked. '+String(e.message||e)); }
      if(!upstream.ok){
        const txt=await upstream.text().catch(()=>'');
        let hint=''; if(upstream.status===429) hint=' Rate limited.'; if(upstream.status===401||upstream.status===403) hint=' Key invalid.';
        throw new Error(preset.id+' rejected the request (HTTP '+upstream.status+').'+hint+' '+(txt.slice(0,300)||''));
      }
      let text='';
      // detect json vs sse — agnes/openai streams sse, google streams sse, fallback json
      const ct=upstream.headers.get('content-type')||'';
      if(ct.includes('application/json') && !ct.includes('text/event-stream')){
        let data; try{ data=await upstream.json(); }catch{ throw new Error('Could not read response'); }
        text=textFromJsonBrowser(preset.kind, data);
        for(const ch of text) { onDelta(ch); }
      } else {
        for await(const d of streamDeltasBrowser(preset.kind, upstream.body)){ text+=d; onDelta(d); }
      }
      const call=parseToolCallBrowser(text);
      if(!call) return { text, toolCalls, skill, provider: credentials.provider, model };
      onDelta(''); // signal tool
      if(onTool) onTool({name:call.tool, args:call.args, status:'running'});
      let result; try{ result=await callToolRemote(call.tool, call.args); }catch(e){ result={error:String(e.message||e)}; }
      const summary=result?.error? String(result.error).slice(0,80): 'ok';
      if(onTool) onTool({name:call.tool, args:call.args, status:'done', ok:!result?.error, summary});
      toolCalls.push({name:call.tool, args:call.args, summary});
      convo=[...convo, {role:'assistant', content:text}, {role:'user', content:'TOOL RESULT ('+call.tool+'):\n'+JSON.stringify(result).slice(0,7000)+'\nUse this data to answer.'}];
      // loop continues for tool result
      // clear text for next round's streaming
      text='';
    }
    return { text:'', toolCalls, skill, provider: credentials.provider, model };
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
    const modelChip = $('#ai-model-chip');
    if (modelChip) {
      modelChip.innerHTML = `<i class="ti ti-cpu"></i> ${esc(name)}${model ? ' · ' + esc(model) : ''} <i class="ti ti-settings" style="margin-left:2px"></i>`;
    }
    // remove legacy toggle if cached DOM still has it
    document.getElementById('ai-bridge-toggle')?.remove();
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

  // In-flight dedup: same skill+prompt within 8s reuses the same fetch
  const _inflight = new Map();
  function inflightKey(skillId, prompt, hasFiles){ return skillId+'\0'+String(prompt).slice(0,400)+'\0'+(hasFiles?1:0); }

  async function send(text) {
    const raw = String(text || '');
    const prompt = raw.trim();
    const hasFiles = state.pendingFiles.length > 0;
    if ((!prompt && !hasFiles) || state.sending) return;
    const skill = activeSkill();
    const messages = thread();
    const sentFiles = hasFiles ? [...state.pendingFiles] : [];
    const cacheHit = !hasFiles ? getPromptCache(skill.id, prompt) : null;
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
    state.threads[state.skillId] = toSave;
    saveLocal();
    state.threads[state.skillId] = messages; // restore for live context
    renderThread();
    $('#ai-hero')?.classList.add('hidden');
    state.pendingFiles = [];
    renderAttachPreviews();
    // clear draft for this skill after send
    saveDraft(skill.id, '');
    const inp=$('#ai-input'); if(inp) inp.value='';
    updateHasText();
    state.sending = true;
    const sendBtn = $('#ai-send');
    sendBtn?.classList.add('busy');
    let _abortCached=false;
    let cachedNotice=null;
    if (cacheHit) {
      const ageMin = Math.round((Date.now()-(cacheHit.ts||0))/60000);
      const inner=$('#ai-thread-inner');
      if(inner){
        cachedNotice=document.createElement('div');
        cachedNotice.className='ai-cache-notice';
        cachedNotice.innerHTML=`<i class="ti ti-history"></i> Cached answer from ${ageMin||0}m ago — streaming fresh answer… <button type="button" data-use-cached>Use cached</button>`;
        inner.appendChild(cachedNotice);
        cachedNotice.querySelector('[data-use-cached]')?.addEventListener('click',()=>{
          cachedNotice.remove(); cachedNotice=null;
          const bubble=startAssistantBubble(); setStreamText(bubble, cacheHit.content); finalizeStream(bubble, cacheHit.content, {provider:'cache', model: cacheHit.skillId});
          messages.push({ id: crypto.randomUUID?crypto.randomUUID():String(Date.now()+1), role:'assistant', content: cacheHit.content, skillName: skill.name+' · cached', time: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) });
          if(messages.length>MAX_THREAD) messages.splice(0,messages.length-MAX_THREAD); saveLocal();
          state.sending=false; sendBtn?.classList.remove('busy'); scrollBottom();
          _abortCached=true;
        });
        scrollBottom(false);
      }
    }
    const thinking = appendThinking();

    // Context: all prior messages as text, last user message as array (if files)
    const baseContext = messages.slice(-CONTEXT_MESSAGES).map((message, idx, arr) => {
      const isLast = idx === arr.length - 1;
      const c = isLast && message._apiContent ? message._apiContent : message.content;
      return { role: message.role, content: c };
    });

    // Browser-direct branch: uses your IP / v2ray so apihub agnes is not rate-limited by Cloudflare shared IP
    const _activePid = String(state.active.provider || 'demo');
    const _useBridge = _activePid !== 'demo' && isBridgeEnabled(_activePid);
    let _bridgeCredentials = null;
    if (_useBridge) {
      try {
        const ik = inflightKey(skill.id, prompt, hasFiles);
        if (_inflight.has(ik)) { thinking?.remove(); cachedNotice?.remove(); toast('Same prompt already sending…','warn'); state.sending=false; sendBtn?.classList.remove('busy'); return; }
        // fake promise for dedup map
        const _bridgePromise = Promise.resolve(true);
        _inflight.set(ik, _bridgePromise);
        if (_abortCached) { _inflight.delete(ik); return; }
        cachedNotice?.remove();
        thinking?.remove();
        const bubble = startAssistantBubble();
        let assistantText = '';
        const toolCallsBridge = [];
        let pendingBridge=false;
        const paintBridge=()=>{ pendingBridge=false; setStreamText(bubble, assistantText); };
        let bridgeMeta={ provider:_activePid, model: state.active.model||'' };
        let credentials;
        try { credentials = await fetchBridgeCredentials(_activePid); _bridgeCredentials = credentials; } catch(e){ throw new Error(e.message || 'Bridge failed — save a key for '+_activePid+' first.'); }
        bridgeMeta.model = credentials.model || bridgeMeta.model;
        const onDeltaBridge=(delta)=>{ if(delta) { assistantText+=delta; if(!pendingBridge){ pendingBridge=true; requestAnimationFrame(paintBridge);} scrollBottom(false); } };
        const onToolBridge=(ev)=>{ if(ev.status==='done'||ev.status===undefined) toolCallsBridge.push({name:ev.name, args:ev.args, summary:ev.summary}); upsertToolChip(bubble, ev); };
        let resultBridge;
        try {
          resultBridge = await browserDirectChat({ skillId: skill.id, baseContext, credentials, onDelta: onDeltaBridge, onTool: onToolBridge });
        } finally { setTimeout(()=>_inflight.delete(ik), 1200); }
        if (_abortCached) return;
        // browserDirectChat already streamed deltas; resultBridge.text is empty when streamed, assistantText holds it
        const finalText = resultBridge.text || assistantText;
        const finalToolCalls = resultBridge.toolCalls && resultBridge.toolCalls.length ? resultBridge.toolCalls : toolCallsBridge;
        bridgeMeta.toolCalls = finalToolCalls;
        bridgeMeta.provider = resultBridge.provider || _activePid;
        bridgeMeta.model = resultBridge.model || bridgeMeta.model;
        finalizeStream(bubble, finalText, bridgeMeta);
        messages.push({ id: crypto.randomUUID?crypto.randomUUID():String(Date.now()+1), role:'assistant', content: finalText, skillName: skill.name + ' · browser', toolCalls: finalToolCalls, time: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) });
        if(messages.length>MAX_THREAD) messages.splice(0,messages.length-MAX_THREAD);
        saveLocal();
        if(!hasFiles && finalText) putPromptCache(skill.id, prompt, finalText);
        toast('Sent via browser — your IP / v2ray', 'ok');
      } catch (error) {
        if (String(error?.message)==='__ABORT_CACHED__') return;
        thinking?.remove(); cachedNotice?.remove();
        const msg=String(error?.message||'Browser request failed');
        const isCors = /CORS|Failed to fetch|NetworkError/i.test(msg);
        const hint = isCors ? ' — This endpoint blocks browser requests (CORS).' : (msg.includes('429') ? ' — Rate limited.' : '');
        appendErrorChip(msg + hint);
        toast(msg.slice(0,120), 'err');
        // fallback suggestion: offer to retry via server once
        try{
          const retryBtn=document.createElement('button'); retryBtn.textContent='Retry via server';
          retryBtn.className='ais-btn'; retryBtn.style.marginTop='8px';
          retryBtn.onclick=async()=>{
            retryBtn.remove();
            // re-send same prompt via server path once
            const inp=document.getElementById('ai-input'); if(inp) inp.value=prompt;
            // remove last user message duplicate guard: we already have it, just call server fetch
            state.sending=false; sendBtn?.classList.remove('busy');
            // direct server fetch for this one message
            try{
              thinking?.remove();
              const bubble2=startAssistantBubble();
              let at2=''; let meta2={provider:_activePid, model:''};
              const r2=await fetch('/api/ai/chat',{method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({skillId: skill.id, provider:_activePid, model: _bridgeCredentials?.model||undefined, stream:true, messages: baseContext})});
              if(!r2.ok){ const j=await r2.json().catch(()=>({})); throw new Error(j.error||('HTTP '+r2.status));}
              const ct2=r2.headers.get('content-type')||'';
              if(ct2.includes('application/json')){ const j=await r2.json(); at2=j.message.content||''; meta2={provider:j.provider, model:j.model}; setStreamText(bubble2, at2);} else {
                const tcs2=[]; let pend=false; const paint2=()=>{pend=false; setStreamText(bubble2, at2);};
                meta2=await parseSse(r2, ev=>{ if(ev.reset){at2=''; if(!pend){pend=true; requestAnimationFrame(paint2);} return;} if(ev.tool){ if(ev.tool.status==='done'||ev.tool.status===undefined) tcs2.push({name:ev.tool.name, args:ev.tool.args, summary:ev.tool.summary}); upsertToolChip(bubble2, ev); return;} at2+=ev.delta; if(!pend){pend=true; requestAnimationFrame(paint2);} scrollBottom(false);});
                if(!Array.isArray(meta2.toolCalls)||!meta2.toolCalls.length) meta2.toolCalls=tcs2;
              }
              finalizeStream(bubble2, at2, meta2);
              messages.push({id: crypto.randomUUID?crypto.randomUUID():String(Date.now()+1), role:'assistant', content: at2, skillName: skill.name, toolCalls: meta2.toolCalls||[], time: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})});
              if(messages.length>MAX_THREAD) messages.splice(0,messages.length-MAX_THREAD); saveLocal();
            }catch(e2){ appendErrorChip(String(e2.message||e2)); }
          };
          document.getElementById('ai-thread-inner')?.appendChild(retryBtn);
        }catch{}
      } finally { state.sending=false; sendBtn?.classList.remove('busy'); scrollBottom(); updateHasText(); }
      return;
    }
    let response;
    try {
      // dedup identical in-flight requests
      const ik = inflightKey(skill.id, prompt, hasFiles);
      if (_inflight.has(ik)) {
        thinking?.remove();
        cachedNotice?.remove();
        toast('Same prompt already sending…', 'warn');
        state.sending=false; sendBtn?.classList.remove('busy'); return;
      }
      const chatPromise = fetch('/api/ai/chat', {
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
      _inflight.set(ik, chatPromise);
      try { response = await chatPromise; } finally { setTimeout(()=>_inflight.delete(ik), 1200); }
      if (_abortCached) return;

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const error = new Error(data.error || `Chat failed (HTTP ${response.status})`);
        error.status = response.status;
        throw error;
      }

      const contentType = response.headers.get('content-type') || '';
      cachedNotice?.remove();
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
          if (_abortCached) throw new Error('__ABORT_CACHED__');
          if (event.reset) {
            assistantText = '';
            if (!pending) { pending = true; requestAnimationFrame(paint); }
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
          if (!pending) { pending = true; requestAnimationFrame(paint); }
          scrollBottom(false);
        });
        if (!Array.isArray(meta.toolCalls) || !meta.toolCalls.length) meta.toolCalls = toolCalls;
      }

      if (_abortCached) return;
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
      if (!hasFiles && assistantText) putPromptCache(skill.id, prompt, assistantText);
      if (meta.provider && meta.provider !== (state.active.provider || 'demo')) {
        state.active.provider = meta.provider;
        renderProviderBadge();
      }
    } catch (error) {
      if (String(error?.message)==='__ABORT_CACHED__') return;
      thinking?.remove();
      cachedNotice?.remove();
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
    // save composer draft of outgoing skill
    const inp0=$('#ai-input'); if(inp0) saveDraft(state.skillId, inp0.value);
    state.skillId = skillId;
    saveLocal();
    renderRail();
    const threadEl = $('#ai-thread');
    const doSwitch=()=>{
      renderThread();
      // restore draft of incoming skill
      const inp=$('#ai-input'); if(inp){ inp.value=getDraft(skillId); autoGrow(); updateHasText(); }
    };
    if (threadEl) {
      threadEl.style.animation = 'ai-thread-out .3s ease forwards';
      setTimeout(() => { threadEl.style.animation = ''; doSwitch(); }, 220);
    } else { doSwitch(); }
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
      scheduleDraftSave();
    });
    // keep draft if user leaves / reloads mid-typing
    window.addEventListener('beforeunload', ()=>{ if(input) saveDraft(state.skillId, input.value); });
    // also save draft on blur/visibility
    input?.addEventListener('blur', ()=> saveDraft(state.skillId, input.value));
    input?.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        const value = input.value;
        input.value = '';
        saveDraft(state.skillId, '');
        autoGrow();
        updateHasText();
        send(value);
      }
    });

    $('#ai-composer')?.addEventListener('submit', event => {
      event.preventDefault();
      const value = input.value;
      input.value = '';
      saveDraft(state.skillId, '');
      autoGrow();
      updateHasText();
      send(value);
    });

    $('#ai-send')?.addEventListener('click', () => {
      const value = input.value;
      input.value = '';
      saveDraft(state.skillId, '');
      autoGrow();
      updateHasText();
      send(value);
    });

    $('#ai-model-chip')?.addEventListener('click', () => window.PriceAlertSettings?.open());
    // History export / cache tools (injected into rail foot so no ai.html diff needed)
    (()=>{ const foot=document.querySelector('.ai-rail-foot'); if(!foot || foot.querySelector('[data-ai-export]')) return;
      const bar=document.createElement('div'); bar.className='ai-cache-bar';
      bar.innerHTML=`<button type="button" class="ai-cache-btn" data-ai-export title="Download all chats as JSON"><i class="ti ti-download"></i> Export</button>
        <button type="button" class="ai-cache-btn ghost" data-ai-clear-cache title="Clear prompt/state cache, keep history"><i class="ti ti-eraser"></i> Clear cache</button>
        <button type="button" class="ai-cache-btn ghost danger" data-ai-clear-all title="Delete all history + cache"><i class="ti ti-trash"></i> Wipe</button>`;
      foot.appendChild(bar);
      foot.querySelector('[data-ai-export]')?.addEventListener('click', exportHistoryBlob);
      foot.querySelector('[data-ai-clear-cache]')?.addEventListener('click', ()=>{ clearCaches({keepHistory:true}); renderRail(); renderProviderBadge(); });
      foot.querySelector('[data-ai-clear-all]')?.addEventListener('click', ()=>{ if(!confirm('Delete all AI history on this device?')) return; clearCaches({keepHistory:false}); });
    })();

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
    // Instant paint from cached state (stale-while-revalidate: no spinner, works offline)
    const cached = loadStateCache();
    if (cached) applyStateCache(cached);
    state.skills = withMandatorySkills(state.skills.length ? state.skills : FALLBACK_SKILLS.map(skill => ({ ...skill })));
    renderRail();
    renderProviderBadge();
    renderThread();
    autoGrow();
    // restore composer draft for current skill
    const _inp0 = document.getElementById('ai-input');
    if (_inp0) { const d=getDraft(state.skillId); if(d) { _inp0.value=d; autoGrow(); updateHasText(); } }

    // Background revalidation (SWR) — updates cache + UI if server is fresher
    try {
      const response = await fetch('/api/ai/state', { headers: { 'X-AI-Cache': 'revalidate' } });
      if (response.ok) {
        const data = await response.json();
        // only overwrite if server actually returned something
        if (Array.isArray(data.skills) && data.skills.length) {
          state.skills = withMandatorySkills(data.skills);
          if (!state.skills.some(skill => skill.id === state.skillId)) state.skillId = state.skills[0].id;
        } else { state.skills = withMandatorySkills(state.skills); }
        if (Array.isArray(data.providers)) state.providers = data.providers;
        if (data.active) state.active = data.active;
        saveStateCache(data);
      } else if (response.status === 401 || response.status === 503) {
        if (!cached) toast('Dashboard login required to reach the AI API.', 'warn');
      } else if (!cached) {
        toast('AI API unreachable — showing cached shell.', 'warn');
      }
    } catch {
      if (!cached) toast('AI API unreachable — showing local shell.', 'warn');
    }

    renderRail();
    renderProviderBadge();
    renderThread();
    if (new URLSearchParams(location.search).get('settings') === '1') window.PriceAlertSettings?.open();
    // re-apply draft after potential skill remap from server
    const _inp1 = document.getElementById('ai-input');
    if (_inp1 && !_inp1.value) { const d=getDraft(state.skillId); if(d) { _inp1.value=d; autoGrow(); updateHasText(); } }
    _inp1?.focus();
  }

  // Expose cache helpers for console / debug
  try { window.PriceAlertAI = Object.assign(window.PriceAlertAI||{}, { cacheStats, exportHistoryBlob, clearCaches, getPromptCache, putPromptCache }); } catch {}

  // pause expensive orb/grid animations when tab hidden
  document.addEventListener('visibilitychange', ()=>{
    document.querySelectorAll('.ai-bg').forEach(el=> el.classList.toggle('is-paused', document.hidden));
  });

  document.addEventListener('DOMContentLoaded', boot);
})();
