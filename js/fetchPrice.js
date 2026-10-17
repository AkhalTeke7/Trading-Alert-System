'use strict';
const num = v => Number(String(v).replace(/,/g, ''));      // "2,346,150" -> 2346150

// 5s in-memory cache + coalesce — every concurrent caller reuses one upstream fetch
let _cache = null; // { at: ms, data }
let _inflight = null;
const CACHE_MS = 5000;

export default async function getPrices() {
  const now = Date.now();
  if (_cache && (now - _cache.at) < CACHE_MS) return _cache.data;
  if (_inflight) return _inflight;
  _inflight = (async () => {
  const [tv, { current }] = await Promise.all([
    fetch('https://scanner.tradingview.com/global/scan', {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json' },
      body: '{"symbols":{"tickers":["OANDA:XAUUSD","FX_IDC:EURUSD","FX_IDC:GBPUSD","BITSTAMP:BTCUSD","OANDA:NAS100USD","OANDA:SPX500USD"]},"columns":["close","change"]}',
    }).then(r => { if (!r.ok) throw new Error('Price provider unavailable'); return r.json(); }),
    fetch('https://call3.tgju.org/ajax.json', { signal: AbortSignal.timeout(15_000) }).then(r => { if (!r.ok) throw new Error('Price provider unavailable'); return r.json(); }),
  ]);

  const tgju = k => {
    const x = current[k];
    return { rial: num(x.p), toman: num(x.p) / 10, high: num(x.h), low: num(x.l), time: x.t_en };
  };

  const data = {
    ...Object.fromEntries(tv.data.map(({ s, d }) => [s, { price: d[0], change: d[1] }])),
    dollar: tgju('price_dollar_rl'),
    gold18: tgju('tgju_gold_irg18_buy'),
  };
  _cache = { at: Date.now(), data };
  return data;
  })();
  try { return await _inflight; } finally { _inflight = null; }
}


