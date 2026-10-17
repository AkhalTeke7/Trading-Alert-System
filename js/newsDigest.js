// newsDigest.js — AI news digests for Telegram buttons + screenshot card
// kind: 'daily'  = TradingView economic calendar (today's news)  -> AI analyzes -> screenshot
// kind: 'global' = International news (excluding Forex Factory) -> AI impact analysis -> screenshot
import { runChat, createToolExecutors } from './aiCore.js';
import { getCachedAlertPng, setCachedAlertPng, renderFallbackAlertPng } from './alertPngFallback.js';

function esc(s){ return String(s??'').replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// --- HTML template: dossier card for news digest (mirrors mainChartShot styling) ---
export function renderNewsDigestHtml({ kind, title, subtitle, dateLabel, aiHtml, eventsHtml, footerNote }) {
  const kindLabel = kind === 'daily' ? "DAILY BRIEF · ECONOMIC CALENDAR" : "GLOBAL MACRO · WORLD NEWS";
  const kindIcon = kind === 'daily' ? "◈" : "🌍";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=1200, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,soft,wght@0,9..144,400&family=Inter:wght@400;500&family=JetBrains+Mono:wght@400;500&family=Space+Grotesk:wght@500;600&display=swap" rel="stylesheet">
<style>
:root{--bg:#0a0a0a;--panel:#101010;--panel-2:#141414;--bone:#e9e4d6;--muted:#8b877b;--dim:#5b584f;--red:#d13b2f;--up:#3bc47a;--line:rgba(233,228,214,.14);--line-strong:rgba(233,228,214,.30)}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1200px;background:var(--bg);color:var(--bone);font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{width:1200px;padding:18px 18px 14px;display:flex;flex-direction:column;gap:12px;background:var(--bg)}
.header{height:52px;display:flex;align-items:center;justify-content:space-between;padding:0 14px;border-bottom:1px solid var(--line);background:var(--bg);flex-shrink:0}
.brand{display:flex;align-items:center;gap:10px}
.mark{width:28px;height:28px;display:grid;place-items:center;border:1px solid var(--line-strong);color:var(--bone);font-size:12px;position:relative}
.mark::after{content:"";position:absolute;top:-1px;right:-1px;width:6px;height:6px;background:var(--red)}
.brand-name{font-family:"Space Grotesk",Inter,sans-serif;font-weight:600;font-size:15px;letter-spacing:.04em}
.tag{font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.card{display:flex;flex-direction:column;padding:16px;background:var(--panel);background-image:radial-gradient(rgba(233,228,214,.07) 1px,transparent 1px);background-size:7px 7px;border:1px solid var(--line);position:relative}
.card::before,.card::after{content:"";position:absolute;width:10px;height:10px;border-color:var(--bone);border-style:solid;opacity:.55}
.card::before{top:-1px;left:-1px;border-width:1px 0 0 1px}
.card::after{right:-1px;bottom:-1px;border-width:0 1px 1px 0}
.card-head{display:flex;align-items:center;justify-content:space-between}
.card-head .left{font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.card-head .kanji{font-size:22px;color:var(--dim);line-height:1}
.hero{margin-top:12px;border:1px solid var(--line-strong);background:var(--bg);padding:14px 16px;display:flex;flex-direction:column;gap:6px}
.hero h1{font-family:"Fraunces",serif;font-weight:400;font-size:30px;letter-spacing:-.02em;color:var(--bone);line-height:1.1}
.hero p{font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--muted);letter-spacing:.04em}
.ai-body{margin-top:14px;border:1px solid var(--line);background:rgba(233,228,214,.03);padding:16px}
.ai-body h2{font-family:"Space Grotesk",sans-serif;font-size:14px;letter-spacing:.06em;text-transform:uppercase;color:var(--bone);margin:12px 0 6px}
.ai-body h3{font-family:"Space Grotesk",sans-serif;font-size:13px;color:var(--bone);margin:10px 0 6px}
.ai-body p{font-family:Inter,sans-serif;font-size:13px;line-height:1.6;color:var(--bone);margin:6px 0}
.ai-body ul, .ai-body ol{margin:6px 0 6px 18px;font-size:13px;line-height:1.6;color:var(--bone)}
.ai-body table{width:100%;border-collapse:collapse;margin:10px 0;font-family:"JetBrains Mono",monospace;font-size:11px}
.ai-body th{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);text-align:left;padding:7px 8px;border-bottom:1px solid var(--line-strong);background:rgba(233,228,214,.04)}
.ai-body td{padding:7px 8px;border-bottom:1px solid rgba(233,228,214,.08);color:var(--bone)}
.ai-body blockquote{border-left:2px solid var(--red);padding:8px 12px;margin:10px 0;background:rgba(209,59,47,.06);font-size:13px;color:var(--bone)}
.ai-body code{font-family:"JetBrains Mono",monospace;font-size:11px;background:rgba(233,228,214,.08);padding:1px 4px;border:1px solid var(--line)}
.ai-body pre{margin:10px 0;padding:12px;background:#0f0f0f;border:1px solid var(--line);overflow:auto}
.ai-body pre code{background:none;border:0;padding:0}
.ai-body a{color:var(--up);text-decoration:underline;text-underline-offset:2px}
.ai-body hr{border:0;height:1px;background:var(--line);margin:12px 0}
.events{margin-top:12px;border:1px solid var(--line);background:var(--bg);padding:12px}
.events h3{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
.ev{font-family:"JetBrains Mono",monospace;font-size:11px;display:flex;gap:8px;padding:6px 0;border-bottom:1px solid rgba(233,228,214,.07)}
.ev:last-child{border-bottom:0}
.ev b{color:var(--bone);font-weight:600}
.ev span{color:var(--muted)}
.footer{height:36px;display:flex;align-items:center;justify-content:space-between;padding:0 4px;border-top:1px solid var(--line);font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);flex-shrink:0}
.badge{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.08em;padding:4px 8px;border:1px solid var(--line);background:rgba(233,228,214,.06);color:var(--bone)}
</style></head><body><div class="wrap">
  <div class="header"><div class="brand"><span class="mark">⚡</span><span class="brand-name">Price-Alert</span><span style="width:1px;height:18px;background:var(--line);margin:0 6px"></span><span class="tag">${esc(kindLabel)}</span></div><span class="tag">${esc(dateLabel)}</span></div>
  <div class="card">
    <div class="card-head"><span class="left">${esc(kindIcon)} // ${esc(title)}</span><span class="kanji">𐱅</span></div>
    <div class="hero"><h1>${esc(title)}</h1><p>${esc(subtitle)}</p><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px"><span class="badge">${esc(kindLabel)}</span><span class="badge">${esc(dateLabel)}</span></div></div>
    ${eventsHtml ? `<div class="events">${eventsHtml}</div>` : ''}
    <div class="ai-body">${aiHtml}</div>
    ${footerNote ? `<p style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--dim);margin-top:10px;letter-spacing:.04em">${esc(footerNote)}</p>` : ''}
  </div>
  <div class="footer"><span>Market Pulse / Alerts / Live Data</span><span>𐰀 𐰴 𐰚 𐰀 𐰠 . 𐱅 𐰀 𐰚 𐰀</span></div>
</div></body></html>`;
}

function mdInlineToHtml(text){
  let out = esc(text);
  out = out.replace(/`([^`]+?)`/g, (_,c)=>`<code>${c}</code>`);
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*?)&quot;)?\)/g, (_,alt,url)=> {
    const u=url.trim(); if(!/^(https?:\/\/|\/|data:image\/)/.test(u)) return esc(alt);
    return `<img src="${esc(u)}" alt="${esc(alt)}" loading="lazy" style="max-width:100%">`;
  });
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]*?)&quot;)?\)/g, (_,label,url)=>{
    const u=url.trim(); if(!/^(https?:\/\/|mailto:|\/|#)/.test(u)) return label;
    return `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  out = out.replace(/&lt;(https?:\/\/[^&]+)&gt;/g, (_,url)=>`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`);
  out = out.replace(/~~([^~]+)~~/g,'<del>$1</del>');
  out = out.replace(/\*\*\*([^*]+)\*\*\*/g,'<strong><em>$1</em></strong>');
  out = out.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
  out = out.replace(/__([^_]+)__/g,'<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g,(_,pre,t)=>`${pre}<em>${t}</em>`);
  return out;
}
function mdToHtml(src){
  const lines = String(src??'').replace(/\r\n/g,'\n').split('\n');
  let html='', inCode=false, codeBuf=[], codeLang='', list=null;
  const closeList=()=>{ if(list){ html+=`</${list}>`; list=null; } };
  const isSep=s=> /^\s*\|?[\s|:\-]+\|?[\s|:]*\s*$/.test(s) && s.includes('-') && s.includes('|');
  for(let i=0;i<lines.length;i++){
    let line=lines[i];
    if(/^```/.test(line)){
      if(inCode){ html+=`<pre><code${codeLang?` class="lang-${esc(codeLang)}"`:''}>${esc(codeBuf.join('\n'))}</code></pre>`; codeBuf=[]; inCode=false; codeLang=''; }
      else{ closeList(); inCode=true; codeLang=line.replace(/^```\s*/,'').trim().slice(0,20); }
      continue;
    }
    if(inCode){ codeBuf.push(line); continue; }
    if(/^\s*$/.test(line)){ closeList(); continue; }
    if(line.includes('|') && i+1<lines.length && isSep(lines[i+1])){
      closeList();
      const heads=line.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim());
      const aligns=lines[i+1].trim().replace(/^\||\|$/g,'').split('|').map(c=>{ const l=c.trim().startsWith(':'), r=c.trim().endsWith(':'); if(l&&r) return 'center'; if(r) return 'right'; if(l) return 'left'; return ''});
      html+='<table><thead><tr>'; heads.forEach((c,idx)=> html+=`<th${aligns[idx]?` style="text-align:${aligns[idx]}"`:''}>${mdInlineToHtml(c)}</th>`); html+='</tr></thead><tbody>'; i+=1;
      while(i+1<lines.length && lines[i+1].includes('|') && lines[i+1].trim()!==''){ i+=1; const cells=lines[i].trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim()); html+='<tr>'; for(let k=0;k<heads.length;k++) html+=`<td${aligns[k]?` style="text-align:${aligns[k]}"`:''}>${mdInlineToHtml(cells[k]||'')}</td>`; html+='</tr>'; }
      html+='</tbody></table>'; continue;
    }
    if(/^\s*>\s?/.test(line)){
      closeList();
      const bq=[]; while(i<lines.length && /^\s*>\s?/.test(lines[i])){ bq.push(lines[i].replace(/^\s*>\s?/,'')); i++; } i--;
      html+=`<blockquote>${bq.join('<br>')}</blockquote>`; continue;
    }
    const h=line.match(/^(#{1,6})\s+(.*)/);
    if(h){ closeList(); html+=`<h${h[1].length}>${mdInlineToHtml(h[2].replace(/\s+#+\s*$/,'').trim())}</h${h[1].length}>`; continue; }
    if(/^\s*([-*_])\s*(\1\s*){2,}\s*$/.test(line)){ closeList(); html+='<hr>'; continue; }
    const task=line.match(/^\s*[-*+]\s+\[(x| )\]\s+(.*)/i);
    if(task){ if(list!=='ul'){ closeList(); html+='<ul>'; list='ul'; } html+=`<li><input type="checkbox" disabled${task[1].toLowerCase()==='x'?' checked':''}> ${mdInlineToHtml(task[2])}</li>`; continue; }
    const ul=line.match(/^\s*[-*+]\s+(.*)/);
    if(ul){ if(list!=='ul'){ closeList(); html+='<ul>'; list='ul'; } html+=`<li>${mdInlineToHtml(ul[1])}</li>`; continue; }
    const ol=line.match(/^\s*\d+[.)]\s+(.*)/);
    if(ol){ if(list!=='ol'){ closeList(); html+='<ol>'; list='ol'; } html+=`<li>${mdInlineToHtml(ol[1])}</li>`; continue; }
    closeList();
    html+=`<p>${mdInlineToHtml(line)}</p>`;
  }
  if(inCode && codeBuf.length) html+=`<pre><code>${esc(codeBuf.join('\n'))}</code></pre>`;
  closeList();
  return html || '<p>—</p>';
}

// cache key for news digests (short-lived, 30 min)
function newsCacheKey(kind, dateStr){ return `news:${kind}|${dateStr}`; }

export async function renderNewsPng(html, cacheKey, env){
  const cached = cacheKey ? getCachedAlertPng(cacheKey, '', '') : null;
  if(cached) return cached;
  // Try Browser Rendering first (Cloudflare or Playwright)
  if(env?.BROWSER){
    try{
      const { launch } = await import('@cloudflare/playwright');
      const browser = await launch(env.BROWSER);
      try{
        const page = await browser.newPage({ viewport:{ width:1200, height:900 }, deviceScaleFactor:2 });
        await page.setContent(html, { waitUntil:'domcontentloaded' });
        await page.waitForTimeout(1500);
        const png = await page.screenshot({ fullPage:true });
        if(cacheKey) setCachedAlertPng(cacheKey,'','',png);
        return png;
      } finally { await browser.close(); }
    } catch(e){ console.error('news cloudflare browser failed, fallback', e?.message); }
  }
  try{
    const { chromium } = await import('playwright');
    const h = String(html);
    let browser; try{ browser=await chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'chrome' }); }catch{ browser=await chromium.launch(); }
    try{
      const page = await browser.newPage({ viewport:{ width:1200, height:900 }, deviceScaleFactor:2 });
      await page.setContent(h, { waitUntil:'domcontentloaded' });
      await page.waitForTimeout(1200);
      const png = await page.screenshot({ fullPage:true });
      if(cacheKey) setCachedAlertPng(cacheKey,'','',png);
      return png;
    } finally{ await browser.close(); }
  } catch(e){
    console.warn('news playwright unavailable, fallback PNG', e?.message);
  }
  // fallback: pure-JS card with title only
  return renderFallbackAlertPng('News Digest','AI', 'analysis');
}

// High-level: fetch data -> call AI -> build html -> png -> { caption, html, png }
export async function buildNewsDigest({ kind, env, fetchImpl = fetch, providers = {}, skills = [], overrides = {} }){
  const now = new Date();
  const dateLabel = now.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const dateStr = now.toISOString().slice(0,10);
  let aiContent = '';
  let eventsForCard = '';

  // Try AI path
  try{
    const skillId = kind === 'daily' ? 'daily-brief' : 'global-macro';
    const userPrompt = kind === 'daily'
      ? `Analyze today's economic calendar news for ${dateLabel}. Steps: 1) call get_events to fetch this week's events, filter to TODAY only (${dateStr}). 2) Summarize in a tight dossier: Top 3 drivers, bias per USD/Gold/EUR/GBP/BTC, key levels to watch, and what would invalidate. If no events today, say so and preview the next high-impact event. End with one-line risk note. Keep it under 900 words and use Markdown tables.`
      : `Cover today's international / world news EXCLUDING any Forex Factory or TradingView economic calendar sources. Steps: 1) call web_search with query "international world news today geopolitics markets" and max_results 6 — never use Forex Factory domains. 2) Summarize top 4-5 headlines and analyze potential impact on Gold / USD, EUR / USD, GBP / USD, BTC / USD, NASDAQ / USD, S&P 500 / USD — include direction, magnitude (low/med/high), and timeframe. Use Markdown with a table: Headline | Impact | Assets | Risk. Keep under 900 words.`;

    const messages = [{ role:'user', content: userPrompt }];
    // providers is the map {openai:{apiKey,...}, tavily:{apiKey}} — active provider lives in aiSettings.activeProvider
    const providersMap = providers && !providers.tavily && providers.providers ? providers.providers : providers;
    const activeProvider = overrides.provider || overrides.activeProvider || providers?.activeProvider || (providersMap?.activeProvider) || 'demo';
    const activeModel = overrides.model || overrides.activeModel || providers?.activeModel || '';
    const executors = createToolExecutors({
      getPrices: overrides.getPrices || (async()=>({})),
      getAlerts: overrides.getAlerts || (async()=>[]),
      getTriggered: overrides.getTriggered || (async()=>[]),
      getJournal: overrides.getJournal || (async()=>null),
      fetchImpl,
      searchApiKey: String((providersMap?.tavily?.apiKey) || providers?.tavily?.apiKey || ''),
      testNotification: overrides.testNotification,
    });
    // inject get_events result into eventsForCard by also calling it directly for card chrome
    try{
      const exec = executors;
      const evRes = await exec.exec('get_events', {});
      if(evRes?.events?.length){
        // filter to today for daily header, else first 6
        const all = evRes.events;
        const todayOnly = all.filter(e=> String(e.time||'').slice(0,10) === dateStr);
        const todayEvents = (todayOnly.length ? todayOnly : all).slice(0, 6);
        eventsForCard = `<h3>Today's calendar snapshot</h3>` + todayEvents.map(e=>`<div class="ev"><b>${esc(e.title||'Event')}</b> <span>${esc(e.country||'') } ${esc(e.time||'')} · imp ${esc(e.importance)}</span></div>`).join('');
      }
    }catch{}

    const result = await runChat({ skillId, provider: activeProvider, model: activeModel, stream:false, messages }, {
      providers: providersMap, skills, fetchImpl, executors, demoDelayMs: 0,
    });
    aiContent = result?.content || result?.message?.content || '';
    if(!aiContent) throw new Error('empty ai content');

  } catch(e){
    // fallback without AI: static digest
    console.warn('news AI failed, using fallback', e?.message);
    if(kind==='daily'){
      aiContent = `## Daily Brief — ${esc(dateLabel)}\n\n> AI unavailable — configure an API key in **AI Console → Settings** to get a live brief.\n\n| Focus | Bias | Watch |\n|---|---:|---|\n| Gold / USD | Neutral | 4160 / 4185 |\n| EUR / USD | Neutral | 1.0850 / 1.0920 |\n| **Risk** | — | Use tight invalidation on calendar spikes |\n`;
    } else {
      aiContent = `## Global Macro — ${esc(dateLabel)}\n\n> AI unavailable — add a key in **Settings → AI providers** to analyze real world headlines.\n\n| Headline | Impact | Assets |\n|---|---|---|\n| Geopolitics headlines pending | Med | Gold, BTC |\n| Central bank watch | Med | EUR, GBP |\n`;
    }
  }

  const aiHtml = mdToHtml(aiContent);
  const title = kind==='daily' ? `Daily Brief — ${dateLabel}` : `Global Macro — ${dateLabel}`;
  const subtitle = kind==='daily'
    ? "Today's economic calendar distilled by AI — bias, levels, and what would invalidate."
    : "World news beyond Forex Factory — headlines, cross-asset impact, and risk map.";

  const html = renderNewsDigestHtml({
    kind,
    title,
    subtitle,
    dateLabel,
    aiHtml,
    eventsHtml: kind==='daily' ? eventsForCard : '',
    footerNote: 'Generated by Price-Alert AI · Not financial advice · Verify levels before trading.',
  });

  const cacheKey = newsCacheKey(kind, dateStr + '|' + aiContent.slice(0,80));
  let png = null;
  try{ png = await renderNewsPng(html, cacheKey, env); } catch{}
  const caption = (kind==='daily' ? '📰 Daily Brief — ' : '🌍 Global Macro — ') + dateLabel + '\n\n' + aiContent.slice(0, 800) + (aiContent.length>800 ? '…' : '');
  return { caption, html, png, aiContent };
}
