function esc(s){ return String(s??'').replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

const PAIR_META = {
  "Gold / USD":   { Tv: "OANDA:XAUUSD", fixed: 2 },
  "EUR / USD":    { Tv: "FX:EURUSD", fixed: 5 },
  "BTC / USD":    { Tv: "BITSTAMP:BTCUSD", fixed: 2 },
  "GBP / USD":    { Tv: "FX:GBPUSD", fixed: 5 },
  "NASDAQ / USD": { Tv: "OANDA:NAS100USD", fixed: 2 },
  "S&P 500 / USD":{ Tv: "OANDA:SPX500USD", fixed: 2 },
};

export function renderMainChartHtml(pair, target, note) {
  const tvSymbol = PAIR_META[pair]?.Tv || pair;
  const safeTarget = esc(String(target ?? '').slice(0, 50));
  const safePair = esc(pair);
  const safeNote = esc(String(note || '').slice(0, 80));
  // Mirrors Public/main.html dossier styling + TradingView advanced chart.
  // Viewport 1200x800 @2x. Tailored to look like a screenshot of the main page card.
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=1200, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,soft,wght@0,9..144,400&family=Inter:wght@400;500&family=JetBrains+Mono:wght@400;500&family=Space+Grotesk:wght@500;600&display=swap" rel="stylesheet">
<style>
:root{--bg:#0a0a0a;--panel:#101010;--panel-2:#141414;--bone:#e9e4d6;--muted:#8b877b;--dim:#5b584f;--red:#d13b2f;--up:#3bc47a;--line:rgba(233,228,214,.14);--line-strong:rgba(233,228,214,.30)}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1200px;height:800px;overflow:hidden;background:var(--bg);color:var(--bone);font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{width:1200px;height:800px;padding:18px 18px 14px;display:flex;flex-direction:column;gap:12px;background:var(--bg)}
.header{height:52px;display:flex;align-items:center;justify-content:space-between;padding:0 14px;border-bottom:1px solid var(--line);background:var(--bg);flex-shrink:0}
.brand{display:flex;align-items:center;gap:10px}
.mark{width:28px;height:28px;display:grid;place-items:center;border:1px solid var(--line-strong);color:var(--bone);font-size:12px;position:relative}
.mark::after{content:"";position:absolute;top:-1px;right:-1px;width:6px;height:6px;background:var(--red)}
.brand-name{font-family:"Space Grotesk",Inter,sans-serif;font-weight:600;font-size:15px;letter-spacing:.04em}
.tag{font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.card{flex:1;min-height:0;display:flex;flex-direction:column;padding:14px 14px 12px;background:var(--panel);background-image:radial-gradient(rgba(233,228,214,.07) 1px,transparent 1px);background-size:7px 7px;border:1px solid var(--line);position:relative}
.card::before,.card::after{content:"";position:absolute;width:10px;height:10px;border-color:var(--bone);border-style:solid;opacity:.55}
.card::before{top:-1px;left:-1px;border-width:1px 0 0 1px}
.card::after{right:-1px;bottom:-1px;border-width:0 1px 1px 0}
.card-head{display:flex;align-items:center;justify-content:space-between}
.card-head .left{font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.card-head .kanji{font-size:22px;color:var(--dim);line-height:1}
.chart-wrap{flex:1;min-height:0;margin-top:12px;border:1px solid var(--line);background:var(--bg);display:flex;overflow:hidden;position:relative}
.tradingview-widget-container{flex:1;min-height:0}
.tradingview-widget-container iframe{border:0;display:block}
.badge{position:absolute;left:12px;bottom:12px;z-index:9;background:rgba(10,10,10,.88);border:1px solid rgba(233,228,214,.18);color:var(--bone);font:11px "JetBrains Mono",monospace;letter-spacing:.08em;padding:6px 10px;max-width:88%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar{margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;border:1px solid var(--line);background:rgba(233,228,214,.03);padding:10px 12px}
.pill{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:6px 8px;border:1px solid var(--line);color:var(--muted);background:var(--bg)}
.pill.target{background:var(--bone);color:var(--bg);border-color:var(--bone);font-weight:600}
.pill.note{flex:1;min-width:140px;text-transform:none;letter-spacing:.02em;color:var(--bone);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pill.live{color:var(--bone);border-color:rgba(59,196,122,.25);background:rgba(59,196,122,.08)}
.footer{height:36px;display:flex;align-items:center;justify-content:space-between;padding:0 4px;border-top:1px solid var(--line);font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);flex-shrink:0}
</style></head><body><div class="wrap">
  <div class="header"><div class="brand"><span class="mark">⚡</span><span class="brand-name">Price-Alert</span><span style="width:1px;height:18px;background:var(--line);margin:0 6px"></span><span class="tag">Markets · Alert</span></div><span class="tag">Live · 15m</span></div>
  <div class="card">
    <div class="card-head"><span class="left">01 // ${safePair} · TARGET ${safeTarget}</span><span class="kanji">𐱅</span></div>
    <div class="chart-wrap" id="tv-wrap"><div class="tradingview-widget-container" id="tv-c" style="width:100%;height:100%"><div class="tradingview-widget-container__widget" style="height:calc(100% - 32px);width:100%"></div></div><div class="badge">${safePair} · TARGET ${safeTarget}${safeNote ? ' · ' + safeNote : ''}</div></div>
    <div class="bar"><span class="pill target">TARGET ${safeTarget}</span><span class="pill">${safePair}</span><span class="pill note">${safeNote || '—'}</span></div>
  </div>
  <div class="footer"><span>Market Pulse / Alerts / Live Data</span><span>𐰀 𐰴 𐰚 𐰀 𐰠 . 𐱅 𐰀 𐰚 𐰀</span></div>
</div>
<script>!function(){var s=document.createElement('script');s.type='text/javascript';s.async=true;s.src='https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';s.textContent=JSON.stringify({autosize:true,symbol:"${tvSymbol}",interval:"15",timezone:"Etc/UTC",theme:"dark",style:"1",locale:"en",enable_publishing:false,backgroundColor:"rgba(10, 10, 10, 1)",gridColor:"rgba(233, 228, 214, 0.06)",overrides:{"mainSeriesProperties.candleStyle.upColor":"#16a34a","mainSeriesProperties.candleStyle.downColor":"#0a0a0a","mainSeriesProperties.candleStyle.borderUpColor":"#16a34a","mainSeriesProperties.candleStyle.borderDownColor":"#555555","mainSeriesProperties.candleStyle.wickUpColor":"#16a34a","mainSeriesProperties.candleStyle.wickDownColor":"#555555","mainSeriesProperties.candleStyle.borderColor":"#555555"},hide_top_toolbar:false,hide_side_toolbar:true,allow_symbol_change:false,save_image:false,calendar:false,support_host:"https://www.tradingview.com"});var c=document.getElementById('tv-c');if(c) c.appendChild(s);}();</script>
</body></html>`;
}
