const allowedPairs = new Set([
    'Gold / USD',
    'EUR / USD',
    'BTC / USD',
    'GBP / USD',
]);
export const pairToSymbol = {
    'Gold / USD': 'OANDA:XAUUSD',
    'EUR / USD': 'FX_IDC:EURUSD',
    'BTC / USD': 'BITSTAMP:BTCUSD',
    'GBP / USD': 'FX_IDC:GBPUSD',
};

export function getAlertInput(body) {
    const pair = String(body?.pair || '');
    const targetInputValue = String(body?.targetInputValue ?? body?.target ?? '').trim();
    const target = Number(body?.target ?? targetInputValue);
    const note = String(body?.note || '');
    const channel = String(body?.channel || 'Telegram');
    if (!allowedPairs.has(pair) || !Number.isFinite(target) || target <= 0 || note.length > 500) {
        throw new Error('Invalid alert details');
    }
    if (!['Bale', 'Telegram', 'Both'].includes(channel)) {
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

export function truncateToPrecision(value, precision) {
    if (!Number.isFinite(value)) return Number.NaN;
    const decimalIndex = String(value).indexOf('.');
    return decimalIndex === -1 ? value : Number(String(value).slice(0, decimalIndex + precision + 1));
}
