import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeOrderBlocks, _obInternals } from '../js/aiCore.js';

// ---- deterministic synthetic 15m candles -------------------------------------------------
function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function makeCandles(segments, { seed = 7, base = 4200, start = Date.UTC(2026, 9, 16) } = {}) {
    const r = rng(seed);
    const out = [];
    let price = base, t = start;
    for (const seg of segments) {
        for (let i = 0; i < seg.n; i++) {
            const open = price;
            const close = open + seg.drift + (r() - 0.5) * seg.vol;
            const high = Math.max(open, close) + r() * seg.vol * 0.6;
            const low = Math.min(open, close) - r() * seg.vol * 0.6;
            out.push({ time: new Date(t).toISOString(), open, high, low, close, volume: 100 + Math.round(r() * 100) });
            price = close;
            t += 15 * 60 * 1000;
        }
    }
    return out;
}
const CALM = [
    { n: 30, drift: -0.9, vol: 2.6 }, { n: 14, drift: 0.0, vol: 1.6 }, { n: 22, drift: 2.0, vol: 2.4 },
    { n: 20, drift: -0.3, vol: 2.0 }, { n: 26, drift: -1.6, vol: 2.6 }, { n: 16, drift: 0.1, vol: 1.6 },
    { n: 24, drift: 1.7, vol: 2.4 }, { n: 20, drift: -0.2, vol: 2.0 },
];
const NOISY = [
    { n: 25, drift: -0.7, vol: 3.4 }, { n: 10, drift: 0.9, vol: 3.0 }, { n: 12, drift: -0.8, vol: 3.2 },
    { n: 18, drift: 2.1, vol: 3.2 }, { n: 10, drift: -1.0, vol: 3.0 }, { n: 14, drift: 1.4, vol: 3.4 },
    { n: 28, drift: -1.6, vol: 3.2 }, { n: 16, drift: 0.6, vol: 3.0 }, { n: 20, drift: 1.5, vol: 3.4 },
];
const strip = r => ({ legs: r.legs, order_blocks: r.order_blocks, historical_obs: r.historical_obs, errors: r.errors });
const bar = (o, h, l, c) => ({ time: '2026-10-16T00:00:00.000Z', open: o, high: h, low: l, close: c, volume: 1 });

test('numeric args that arrive as null / strings / garbage fall back to the defaults', () => {
    const candles = makeCandles(CALM, { seed: 3 });
    const baseline = strip(analyzeOrderBlocks({ candles, symbol: 'XAU/USD' }));
    assert.deepEqual(baseline.errors, []);
    assert.ok(baseline.legs.length > 0);
    const nulls = analyzeOrderBlocks({ candles, symbol: 'XAU/USD', swing_length: null, min_leg_atr: null, max_legs: null, atr_period: null, min_displacement_atr: null, strict_side: null, ob_merge_distance_atr: null, premium_discount_buffer_atr: null });
    assert.deepEqual(strip(nulls), baseline);
    const strs = analyzeOrderBlocks({ candles, symbol: 'XAU/USD', swing_length: '5', min_leg_atr: '4', max_legs: '2', atr_period: '14', min_displacement_atr: '1.5', strict_side: 'true', ob_merge_distance_atr: '0.5', premium_discount_buffer_atr: '0.2' });
    assert.deepEqual(strip(strs), baseline);
    const junk = analyzeOrderBlocks({ candles, symbol: 'XAU/USD', swing_length: 'abc', min_leg_atr: NaN, max_legs: -3, atr_period: 0 });
    assert.deepEqual(strip(junk), baseline);
});

test('zigzag legs always alternate direction, whatever max_legs is', () => {
    for (let seed = 1; seed <= 30; seed++) {
        for (const max_legs of [2, 3, 4, 6]) {
            const res = analyzeOrderBlocks({ candles: makeCandles(NOISY, { seed }), max_legs });
            if (res.errors.length) continue;
            for (let i = 1; i < res.legs.length; i++) {
                assert.notEqual(res.legs[i].direction, res.legs[i - 1].direction, `seed ${seed} max_legs ${max_legs}: legs ${i - 1}/${i} both ${res.legs[i].direction}`);
            }
        }
    }
});

test('a merged zone keeps invalidation_level in step with the zone and lists each source once', () => {
    let checked = 0;
    for (let seed = 1; seed <= 60; seed++) {
        for (const set of [CALM, NOISY]) {
            const res = analyzeOrderBlocks({ candles: makeCandles(set, { seed }), ob_merge_distance_atr: 1.5 });
            for (const ob of [...res.order_blocks, ...res.historical_obs]) {
                checked++;
                const edge = ob.type === 'bullish' ? ob.zone.bottom : ob.zone.top;
                assert.equal(ob.invalidation_level, edge, `${ob.id} invalidation ${ob.invalidation_level} != zone edge ${edge}`);
                assert.equal(new Set(ob.merged_from).size, ob.merged_from.length, `${ob.id} merged_from has duplicates: ${ob.merged_from}`);
            }
        }
    }
    assert.ok(checked > 0, 'expected the synthetic data to produce order blocks');
});

test('every reported order block carries a real structure break after it, with its FVG inside the move', () => {
    let checked = 0;
    for (let seed = 1; seed <= 60; seed++) {
        const candles = makeCandles(CALM, { seed });
        const res = analyzeOrderBlocks({ candles });
        const idxOf = t => candles.findIndex(c => c.time === t);
        for (const ob of [...res.order_blocks, ...res.historical_obs]) {
            checked++;
            const i = idxOf(ob.created_at);
            const b = idxOf(ob.bos_time);
            assert.ok(i >= 0 && b > i && b <= i + 20, `${ob.id}: BOS must come 1-20 candles after the OB (created ${i}, bos ${b})`);
            // checked against the OB candle itself: a merged zone is a union and can reach past this candle
            if (ob.type === 'bullish') assert.ok(candles[b].close > candles[i].high, `${ob.id}: bullish BOS must close above the OB candle`);
            else assert.ok(candles[b].close < candles[i].low, `${ob.id}: bearish BOS must close below the OB candle`);
            assert.ok(_obInternals.hasFVGBetween(candles, i, Math.min(candles.length - 1, b + 1), ob.type), `${ob.id}: no FVG between OB and BOS`);
        }
    }
    assert.ok(checked > 0, 'expected the synthetic data to produce order blocks');
});

test('hasFVGBetween only looks inside the window, not at the rest of the data', () => {
    const { hasFVGBetween } = _obInternals;
    // indices 0-4: overlapping candles (no gap). indices 5-7: bullish gap (candle5.high < candle7.low).
    const cs = [
        bar(100, 101, 99, 100.5), bar(100.5, 101.5, 99.5, 101), bar(101, 102, 100, 101.5), bar(101.5, 102.5, 100.5, 102), bar(102, 103, 101, 102.5),
        bar(102.5, 103, 102, 102.8), bar(102.8, 108, 102.7, 107.5), bar(107.5, 109, 106, 108.5),
    ];
    assert.equal(hasFVGBetween(cs, 0, 4, 'bullish'), false, 'gap exists later in the data but not inside the window');
    assert.equal(hasFVGBetween(cs, 0, 7, 'bullish'), true);
    assert.equal(hasFVGBetween(cs, 5, 7, 'bullish'), true);
    assert.equal(hasFVGBetween(cs, 5, 7, 'bearish'), false, 'a bullish gap must not validate a bearish OB');
});

test('a liquidity sweep needs the close back inside the prior range, not just a lower low', () => {
    const { detectSweep } = _obInternals;
    const prior = Array.from({ length: 10 }, () => bar(101, 102, 100, 101));
    // wick under 100 but the OB candle and the confirming candle both stay below it -> breakdown, not a sweep
    const noReclaim = [...prior, bar(100, 100.2, 98, 98.4), bar(98.4, 99.5, 98.2, 99.2)];
    assert.equal(detectSweep(noReclaim, 10, 'bullish'), false);
    // wick under 100 and it closes back above -> real sweep
    const reclaim = [...prior, bar(100, 100.2, 98, 100.4), bar(100.4, 102, 100.3, 101.8)];
    assert.equal(detectSweep(reclaim, 10, 'bullish'), true);
    // mirror for the bearish side
    const bearNo = [...prior, bar(102, 104, 101.8, 103.6), bar(103.6, 103.8, 102.8, 103.0)];
    assert.equal(detectSweep(bearNo, 10, 'bearish'), false);
    const bearYes = [...prior, bar(102, 104, 101.8, 101.6), bar(101.6, 101.7, 100.2, 100.5)];
    assert.equal(detectSweep(bearYes, 10, 'bearish'), true);
});