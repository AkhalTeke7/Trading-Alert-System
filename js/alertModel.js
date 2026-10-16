const allowedPairs = new Set([
    'Gold / USD',
    'EUR / USD',
    'BTC / USD',
    'GBP / USD',
    'NASDAQ / USD',
    'S&P 500 / USD',
]);
export const pairToSymbol = {
    'Gold / USD': 'OANDA:XAUUSD',
    'EUR / USD': 'FX_IDC:EURUSD',
    'BTC / USD': 'BITSTAMP:BTCUSD',
    'GBP / USD': 'FX_IDC:GBPUSD',
    'NASDAQ / USD': 'OANDA:NAS100USD',
    'S&P 500 / USD': 'OANDA:SPX500USD',
};

// "1.5e-7" -> "0.00000015": String() switches to exponent notation for very small
// or very large numbers, which would break any code that slices at the decimal point.
function toPlainString(value) {
    const text = String(value);
    if (!/e/i.test(text)) return text;
    const number = Number(value);
    if (!Number.isFinite(number) || Math.abs(number) >= 1e21) return text;
    return number.toFixed(20).replace(/\.?0+$/, '');
}

// Turns "۴۲۳۱", "1,234.50" or " 4168 " into a plain "1234.50" string.
export function normalizeNumberString(raw) {
    return String(raw ?? '')
        .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06F0))
        .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))
        .replace(/٫/g, '.')
        .replace(/[,٬\s]/g, '');
}

export function getAlertInput(body) {
    const pair = String(body?.pair || '');
    // One source of truth: the target text. Both the number and the precision come from it,
    // so a target can have any number of digits and decimals without the two disagreeing.
    const rawTarget = body?.targetInputValue ?? (typeof body?.target === 'number' ? toPlainString(body.target) : body?.target) ?? '';
    const targetInputValue = normalizeNumberString(rawTarget);
    const target = /^\d+(\.\d+)?$/.test(targetInputValue) ? Number(targetInputValue) : Number.NaN;
    const note = String(body?.note || '');
    let channel = String(body?.channel || 'Telegram');
    if (channel === 'All') channel = 'Both';
    if (!allowedPairs.has(pair) || !Number.isFinite(target) || target <= 0 || note.length > 500) {
        throw new Error('Invalid alert details');
    }
    if (!['Bale', 'Telegram', 'Both', 'App'].includes(channel)) {
        throw new Error('Invalid alert channel');
    }
    return { pair, target, targetInputValue, targetPrecision: (targetInputValue.split('.')[1] || '').length, note, channel };
}

export function makeAlert(input, currentPrice, metadata = {}) {
    return {
        id: metadata.id || crypto.randomUUID(),
        ...input,
        symbol: pairToSymbol[input.pair],
        currentPrice,
        state: currentPrice < input.target ? 'up' : 'down',
        source: metadata.source || 'website',
        ...(metadata.ownerId ? { ownerId: String(metadata.ownerId) } : {}),
        createdAt: metadata.createdAt || new Date().toISOString(),
    };
}

// Cuts the fetched price down to the same number of decimals as the target (no rounding),
// so 4168.559 compared against a target typed as "4168.55" becomes 4168.55.
export function truncateToPrecision(value, precision) {
    if (!Number.isFinite(value)) return Number.NaN;
    const digits = Number.isInteger(precision) && precision > 0 ? precision : 0;
    const text = toPlainString(value);
    const decimalIndex = text.indexOf('.');
    return decimalIndex === -1 ? value : Number(text.slice(0, decimalIndex + digits + 1));
}