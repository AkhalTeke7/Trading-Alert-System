'use strict';
const num = v => Number(String(v).replace(/,/g, ''));      // "2,346,150" -> 2346150

async function getPrices() {
  const [tv, { current }] = await Promise.all([
    fetch('https://scanner.tradingview.com/global/scan', {
      method: 'POST',
      body: '{"symbols":{"tickers":["OANDA:XAUUSD","FX_IDC:EURUSD","FX_IDC:GBPUSD","BITSTAMP:BTCUSD"]},"columns":["close","change"]}',
    }).then(r => r.json()),
    fetch('https://call3.tgju.org/ajax.json').then(r => r.json()),
  ]);

  const tgju = k => {
    const x = current[k];
    return { rial: num(x.p), toman: num(x.p) / 10, high: num(x.h), low: num(x.l), time: x.t_en };
  };

  return {
    ...Object.fromEntries(tv.data.map(({ s, d }) => [s, { price: d[0], change: d[1] }])),
    dollar: tgju('price_dollar_rl'),
    gold18: tgju('tgju_gold_irg18_buy'),
  };
}

getPrices().then(console.log);

