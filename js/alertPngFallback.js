import { deflateSync } from 'node:zlib';

const alertPngCache = new Map();
const MAX_CACHE_ENTRIES = 25;

export function alertPngCacheKey(pair, target, note) {
    return `main|${String(pair || 'Gold / USD').slice(0, 50)}|${String(target ?? 'test').slice(0, 50)}|${String(note || '').slice(0, 500)}`;
}

export function getCachedAlertPng(pair, target, note) {
    return alertPngCache.get(alertPngCacheKey(pair, target, note)) || null;
}

export function setCachedAlertPng(pair, target, note, pngBytes) {
    if (!pngBytes || !pngBytes.length) return;
    const key = alertPngCacheKey(pair, target, note);
    if (alertPngCache.size >= MAX_CACHE_ENTRIES && !alertPngCache.has(key)) {
        alertPngCache.delete(alertPngCache.keys().next().value);
    }
    alertPngCache.set(key, Buffer.from(pngBytes));
}

// 5x7 bitmap font (each entry is 7 rows of 5-bit integers, MSB on left)
const FONT_5X7 = {
    ' ': [0, 0, 0, 0, 0, 0, 0],
    '!': [4, 4, 4, 4, 4, 0, 4],
    '"': [10, 10, 10, 0, 0, 0, 0],
    '#': [10, 10, 31, 10, 31, 10, 10],
    '$': [4, 15, 20, 14, 5, 30, 4],
    '%': [24, 25, 2, 4, 8, 19, 3],
    '&': [12, 18, 20, 8, 21, 18, 13],
    "'": [4, 4, 8, 0, 0, 0, 0],
    '(': [2, 4, 8, 8, 8, 4, 2],
    ')': [8, 4, 2, 2, 2, 4, 8],
    '*': [0, 4, 21, 14, 21, 4, 0],
    '+': [0, 4, 4, 31, 4, 4, 0],
    ',': [0, 0, 0, 0, 4, 4, 8],
    '-': [0, 0, 0, 31, 0, 0, 0],
    '.': [0, 0, 0, 0, 0, 12, 12],
    '/': [1, 1, 2, 4, 8, 16, 16],
    '0': [14, 17, 19, 21, 25, 17, 14],
    '1': [4, 12, 4, 4, 4, 4, 14],
    '2': [14, 17, 1, 2, 4, 8, 31],
    '3': [31, 2, 4, 2, 1, 17, 14],
    '4': [2, 6, 10, 18, 31, 2, 2],
    '5': [31, 16, 30, 1, 1, 17, 14],
    '6': [6, 8, 16, 30, 17, 17, 14],
    '7': [31, 1, 2, 4, 8, 8, 8],
    '8': [14, 17, 17, 14, 17, 17, 14],
    '9': [14, 17, 17, 15, 1, 2, 12],
    ':': [0, 12, 12, 0, 12, 12, 0],
    ';': [0, 12, 12, 0, 12, 4, 8],
    '<': [2, 4, 8, 16, 8, 4, 2],
    '=': [0, 0, 31, 0, 31, 0, 0],
    '>': [8, 4, 2, 1, 2, 4, 8],
    '?': [14, 17, 1, 2, 4, 0, 4],
    '@': [14, 17, 1, 13, 21, 21, 14],
    'A': [14, 17, 17, 31, 17, 17, 17],
    'B': [30, 17, 17, 30, 17, 17, 30],
    'C': [14, 17, 16, 16, 16, 17, 14],
    'D': [28, 18, 17, 17, 17, 18, 28],
    'E': [31, 16, 16, 30, 16, 16, 31],
    'F': [31, 16, 16, 30, 16, 16, 16],
    'G': [14, 17, 16, 23, 17, 17, 15],
    'H': [17, 17, 17, 31, 17, 17, 17],
    'I': [14, 4, 4, 4, 4, 4, 14],
    'J': [7, 2, 2, 2, 2, 18, 12],
    'K': [17, 18, 20, 24, 20, 18, 17],
    'L': [16, 16, 16, 16, 16, 16, 31],
    'M': [17, 27, 21, 21, 17, 17, 17],
    'N': [17, 17, 25, 21, 19, 17, 17],
    'O': [14, 17, 17, 17, 17, 17, 14],
    'P': [30, 17, 17, 30, 16, 16, 16],
    'Q': [14, 17, 17, 17, 21, 18, 13],
    'R': [30, 17, 17, 30, 20, 18, 17],
    'S': [15, 16, 16, 14, 1, 1, 30],
    'T': [31, 4, 4, 4, 4, 4, 4],
    'U': [17, 17, 17, 17, 17, 17, 14],
    'V': [17, 17, 17, 17, 17, 10, 4],
    'W': [17, 17, 17, 21, 21, 21, 10],
    'X': [17, 17, 10, 4, 10, 17, 17],
    'Y': [17, 17, 17, 10, 4, 4, 4],
    'Z': [31, 1, 2, 4, 8, 16, 31],
    '[': [14, 8, 8, 8, 8, 8, 14],
    ']': [14, 2, 2, 2, 2, 2, 14],
    '_': [0, 0, 0, 0, 0, 0, 31],
};

// Precomputed CRC32 table for PNG chunk checksums
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
    const typeBuf = Buffer.from(type, 'ascii');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcInput = Buffer.concat([typeBuf, data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(crcInput), 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/**
 * Pure-JS fallback PNG renderer for `/api/alert-image`.
 * Used automatically whenever Playwright / Cloudflare Browser Rendering is
 * unavailable, rate-limited, or fails, so `/api/alert-image` always returns
 * a valid `image/png` card instead of HTTP 502.
 */
export function renderFallbackAlertPng(pair = 'Gold / USD', target = 'test', note = '') {
    const W = 900;
    const H = 600;
    const stride = 1 + W * 3;
    const raw = Buffer.alloc(H * stride, 0);

    const setPixel = (x, y, r, g, b) => {
        if (x < 0 || x >= W || y < 0 || y >= H) return;
        const idx = y * stride + 1 + x * 3;
        raw[idx] = r;
        raw[idx + 1] = g;
        raw[idx + 2] = b;
    };

    const fillRect = (x0, y0, w, h, [r, g, b]) => {
        const xStart = Math.max(0, x0 | 0);
        const yStart = Math.max(0, y0 | 0);
        const xEnd = Math.min(W, (x0 + w) | 0);
        const yEnd = Math.min(H, (y0 + h) | 0);
        for (let y = yStart; y < yEnd; y++) {
            const rowBase = y * stride + 1;
            for (let x = xStart; x < xEnd; x++) {
                const idx = rowBase + x * 3;
                raw[idx] = r;
                raw[idx + 1] = g;
                raw[idx + 2] = b;
            }
        }
    };

    const strokeRect = (x0, y0, w, h, color, t = 1) => {
        fillRect(x0, y0, w, t, color);
        fillRect(x0, y0 + h - t, w, t, color);
        fillRect(x0, y0, t, h, color);
        fillRect(x0 + w - t, y0, t, h, color);
    };

    const drawText = (text, x0, y0, scale, color, maxWidth = W - x0 - 20) => {
        const str = String(text ?? '')
            .replace(/[\u2013\u2014]/g, '-')
            .replace(/\u00b7/g, '.')
            .toUpperCase();
        const charAdvance = 6 * scale;
        let cx = x0 | 0;
        const [r, g, b] = color;
        for (let i = 0; i < str.length; i++) {
            if (cx + 5 * scale > x0 + maxWidth) break;
            const glyph = FONT_5X7[str[i]] || FONT_5X7[' '];
            for (let row = 0; row < 7; row++) {
                const bits = glyph[row];
                if (!bits) continue;
                for (let col = 0; col < 5; col++) {
                    if (bits & (1 << (4 - col))) {
                        fillRect(cx + col * scale, y0 + row * scale, scale, scale, [r, g, b]);
                    }
                }
            }
            cx += charAdvance;
        }
        return cx - x0;
    };

    // Palette matching renderMainChartHtml
    const BG = [10, 10, 10];
    const PANEL = [16, 16, 16];
    const PANEL_BAR = [22, 22, 20];
    const BONE = [233, 228, 214];
    const MUTED = [139, 135, 123];
    const DIM = [75, 72, 65];
    const LINE = [46, 45, 42];
    const GRID = [24, 24, 22];
    const RED = [209, 59, 47];
    const GREEN = [59, 196, 122];

    // 1. Background
    fillRect(0, 0, W, H, BG);

    // 2. Top header bar
    strokeRect(18, 14, 26, 26, BONE, 1);
    fillRect(39, 13, 6, 6, RED);
    drawText('!', 28, 20, 2, BONE);
    drawText('PRICE-ALERT', 56, 20, 2, BONE);
    fillRect(202, 18, 1, 18, LINE);
    drawText('MARKETS . ALERT', 216, 22, 2, MUTED);
    drawText('LIVE . 15M', W - 140, 22, 2, MUTED);
    fillRect(18, 50, W - 36, 1, LINE);

    // 3. Main dossier card
    const cardX = 18, cardY = 64, cardW = W - 36, cardH = H - 110;
    fillRect(cardX, cardY, cardW, cardH, PANEL);
    strokeRect(cardX, cardY, cardW, cardH, LINE, 1);
    // Corner brackets
    fillRect(cardX, cardY, 12, 2, BONE);
    fillRect(cardX, cardY, 2, 12, BONE);
    fillRect(cardX + cardW - 12, cardY + cardH - 2, 12, 2, BONE);
    fillRect(cardX + cardW - 2, cardY + cardH - 12, 2, 12, BONE);

    const safePair = String(pair || 'Gold / USD').slice(0, 32);
    const safeTarget = String(target ?? 'test').slice(0, 24);
    const safeNote = String(note || 'Triggered').slice(0, 60);

    // Card header
    drawText(`01 // ${safePair} . TARGET ${safeTarget}`, cardX + 16, cardY + 16, 2, MUTED, cardW - 40);

    // 4. Chart viewport area
    const chartX = cardX + 16;
    const chartY = cardY + 44;
    const chartW = cardW - 32;
    const chartH = cardH - 116;
    fillRect(chartX, chartY, chartW, chartH, BG);
    strokeRect(chartX, chartY, chartW, chartH, LINE, 1);

    // Subtle grid lines inside chart
    for (let gx = chartX + 70; gx < chartX + chartW - 20; gx += 70) {
        fillRect(gx, chartY + 1, 1, chartH - 2, GRID);
    }
    for (let gy = chartY + 55; gy < chartY + chartH - 20; gy += 55) {
        fillRect(chartX + 1, gy, chartW - 2, 1, GRID);
    }

    // Target price horizontal dashed line
    const targetY = chartY + Math.floor(chartH * 0.36);
    for (let dx = chartX + 12; dx < chartX + chartW - 12; dx += 12) {
        fillRect(dx, targetY, 7, 2, RED);
    }
    fillRect(chartX + chartW - 170, targetY - 11, 158, 22, RED);
    drawText(`TARGET ${safeTarget}`, chartX + chartW - 162, targetY - 7, 2, BONE, 148);

    // Stylized candlestick series leading up to target crossing
    const candles = [
        [0.72, 0.64, 0.76, 0.60, true],
        [0.64, 0.68, 0.71, 0.61, false],
        [0.68, 0.58, 0.70, 0.54, true],
        [0.58, 0.62, 0.65, 0.55, false],
        [0.62, 0.52, 0.64, 0.48, true],
        [0.52, 0.55, 0.58, 0.49, false],
        [0.55, 0.45, 0.57, 0.41, true],
        [0.45, 0.48, 0.51, 0.43, false],
        [0.48, 0.39, 0.50, 0.35, true],
        [0.39, 0.42, 0.44, 0.37, false],
        [0.42, 0.32, 0.44, 0.28, true],
    ];
    const startCx = chartX + 60;
    const stepCx = 56;
    for (let i = 0; i < candles.length; i++) {
        const [openP, closeP, lowP, highP, up] = candles[i];
        const cx = startCx + i * stepCx;
        const yOpen = chartY + Math.floor(chartH * openP);
        const yClose = chartY + Math.floor(chartH * closeP);
        const yLow = chartY + Math.floor(chartH * lowP);
        const yHigh = chartY + Math.floor(chartH * highP);
        const col = up ? GREEN : DIM;
        // Wick
        fillRect(cx + 9, yHigh, 2, Math.max(2, yLow - yHigh), col);
        // Body
        const bodyTop = Math.min(yOpen, yClose);
        const bodyH = Math.max(6, Math.abs(yClose - yOpen));
        if (up) {
            fillRect(cx, bodyTop, 20, bodyH, GREEN);
        } else {
            fillRect(cx, bodyTop, 20, bodyH, BG);
            strokeRect(cx, bodyTop, 20, bodyH, DIM, 2);
        }
    }

    // Center hero callout overlay in chart
    const heroW = Math.min(chartW - 48, 640);
    const heroH = 110;
    const heroX = chartX + 24;
    const heroY = chartY + 24;
    fillRect(heroX, heroY, heroW, heroH, [14, 14, 14]);
    strokeRect(heroX, heroY, heroW, heroH, LINE, 1);
    fillRect(heroX, heroY, 4, heroH, RED);
    drawText(safePair, heroX + 20, heroY + 18, 4, BONE, heroW - 36);
    drawText(`TARGET ${safeTarget}`, heroX + 20, heroY + 64, 3, GREEN, heroW - 36);

    // Bottom-left badge inside chart
    const badgeText = `${safePair} . TARGET ${safeTarget}${safeNote ? ' . ' + safeNote : ''}`;
    const badgeW = Math.min(chartW - 28, Math.max(220, badgeText.length * 12 + 24));
    const badgeX = chartX + 14;
    const badgeY = chartY + chartH - 42;
    fillRect(badgeX, badgeY, badgeW, 28, [12, 12, 12]);
    strokeRect(badgeX, badgeY, badgeW, 28, LINE, 1);
    drawText(badgeText, badgeX + 10, badgeY + 7, 2, BONE, badgeW - 20);

    // 5. Bottom pill bar inside card
    const barX = cardX + 16;
    const barY = chartY + chartH + 12;
    const barW = cardW - 32;
    const barH = 46;
    fillRect(barX, barY, barW, barH, PANEL_BAR);
    strokeRect(barX, barY, barW, barH, LINE, 1);

    // Target pill (bone background, dark text)
    const targetLabel = `TARGET ${safeTarget}`;
    const targetPillW = Math.min(260, targetLabel.length * 12 + 24);
    fillRect(barX + 10, barY + 9, targetPillW, 28, BONE);
    drawText(targetLabel, barX + 22, barY + 16, 2, BG, targetPillW - 20);

    // Pair pill
    const pairPillX = barX + 18 + targetPillW;
    const pairPillW = Math.min(220, safePair.length * 12 + 24);
    fillRect(pairPillX, barY + 9, pairPillW, 28, BG);
    strokeRect(pairPillX, barY + 9, pairPillW, 28, LINE, 1);
    drawText(safePair, pairPillX + 12, barY + 16, 2, MUTED, pairPillW - 20);

    // Note pill
    const notePillX = pairPillX + pairPillW + 8;
    const notePillW = Math.max(100, barX + barW - 10 - notePillX);
    if (notePillW > 60) {
        fillRect(notePillX, barY + 9, notePillW, 28, BG);
        strokeRect(notePillX, barY + 9, notePillW, 28, LINE, 1);
        drawText(safeNote || '-', notePillX + 12, barY + 16, 2, BONE, notePillW - 20);
    }

    // 6. Footer
    fillRect(18, H - 36, W - 36, 1, LINE);
    drawText('MARKET PULSE / ALERTS / LIVE DATA', 22, H - 24, 2, MUTED);

    // Encode PNG
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(W, 0);
    ihdr.writeUInt32BE(H, 4);
    ihdr[8] = 8;  // 8-bit depth
    ihdr[9] = 2;  // RGB color type
    ihdr[10] = 0; // compression
    ihdr[11] = 0; // filter
    ihdr[12] = 0; // interlace

    const idat = deflateSync(raw, { level: 1 });
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    return Buffer.concat([
        signature,
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', idat),
        pngChunk('IEND', Buffer.alloc(0)),
    ]);
}
