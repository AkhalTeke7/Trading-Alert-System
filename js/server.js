import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import getPrices from './fetchPrice.js';
import { alertSender } from './telegram.mjs';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const envFile = resolve(projectRoot, '.env');
if (existsSync(envFile)) loadEnvFile(envFile);

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const allowedPairs = new Set([
    'Gold / USD',
    'EUR / USD',
    'BTC / USD',
    'GBP / USD',
]);
const pairToSymbol = {
    'Gold / USD': 'OANDA:XAUUSD',
    'EUR / USD': 'FX_IDC:EURUSD',
    'BTC / USD': 'BITSTAMP:BTCUSD',
    'GBP / USD': 'FX_IDC:GBPUSD',
};
const alertsFile = resolve(projectRoot, 'data', 'alerts.json');
const contentTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
};

async function loadStoredAlerts() {
    try {
        const alerts = JSON.parse(await readFile(alertsFile, 'utf8'));
        return Array.isArray(alerts) ? alerts : [];
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
}

let storedAlerts = await loadStoredAlerts();
let alertWriteQueue = Promise.resolve();

function persistAlerts() {
    const contents = JSON.stringify(storedAlerts, null, 2);
    alertWriteQueue = alertWriteQueue.then(async () => {
        await mkdir(resolve(projectRoot, 'data'), { recursive: true });
        await writeFile(alertsFile, contents);
    });
    return alertWriteQueue;
}

function getAlertInput(body) {
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

function makeAlert(input, currentPrice, metadata = {}) {
    return {
        id: metadata.id || randomUUID(),
        ...input,
        symbol: pairToSymbol[input.pair],
        currentPrice,
        state: currentPrice < input.target ? 'up' : 'down',
        source: metadata.source || 'website',
        ...(metadata.ownerId ? { ownerId: String(metadata.ownerId) } : {}),
        createdAt: metadata.createdAt || new Date().toISOString(),
    };
}

function truncateToPrecision(value, precision) {
    if (!Number.isFinite(value)) return Number.NaN;
    const decimalIndex = String(value).indexOf('.');
    return decimalIndex === -1 ? value : Number(String(value).slice(0, decimalIndex + precision + 1));
}

let isCheckingStoredAlerts = false;
async function checkStoredAlerts() {
    if (isCheckingStoredAlerts || storedAlerts.length === 0) return;
    isCheckingStoredAlerts = true;
    try {
        const prices = await getPrices();
        for (const alert of [...storedAlerts]) {
            const current = Number(prices[alert.symbol || pairToSymbol[alert.pair]]?.price);
            const comparedCurrent = truncateToPrecision(current, alert.targetPrecision || 0);
            const crossed = alert.state === 'up'
                ? comparedCurrent >= alert.target
                : alert.state === 'down' && comparedCurrent <= alert.target;
            if (!Number.isFinite(comparedCurrent) || !crossed) continue;

            try {
                await alertSender(alert.pair, alert.target, alert.note, alert.channel);
                storedAlerts = storedAlerts.filter(item => item.id !== alert.id);
                await persistAlerts();
            } catch (error) {
                console.error(`Could not send alert ${alert.id}:`, error);
            }
        }
    } catch (error) {
        console.error('Could not check stored alerts:', error);
    } finally {
        isCheckingStoredAlerts = false;
    }
}

function sendJson(response, status, value) {
    response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify(value));
}

async function readJson(request) {
    const chunks = [];
    let size = 0;

    for await (const chunk of request) {
        size += chunk.length;
        if (size > 10_000) throw new Error('Request body is too large');
        chunks.push(chunk);
    }

    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function serveStatic(pathname, response) {
    const relativePath = pathname === '/' ? 'main.html' : pathname.replace(/^\/+/, '');
    const filePath = resolve(projectRoot, relativePath);
    if (!filePath.startsWith(`${projectRoot}${sep}`)) {
        sendJson(response, 403, { error: 'Forbidden' });
        return;
    }

    const pathParts = relativePath.split(/[\\/]/);
    if (pathParts.some(part => part.startsWith('.') || part === 'node_modules')) {
        sendJson(response, 404, { error: 'Not found' });
        return;
    }

    try {
        const fileInfo = await stat(filePath);
        if (!fileInfo.isFile()) {
            sendJson(response, 404, { error: 'Not found' });
            return;
        }

        response.writeHead(200, {
            'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream',
            'Content-Length': fileInfo.size,
            'X-Content-Type-Options': 'nosniff',
        });
        createReadStream(filePath).pipe(response);
    } catch {
        sendJson(response, 404, { error: 'Not found' });
    }
}

const server = createServer(async (request, response) => {
    let pathname;
    let requestUrl;
    try {
        requestUrl = new URL(request.url, `http://${request.headers.host}`);
        pathname = decodeURIComponent(requestUrl.pathname);
    } catch {
        sendJson(response, 400, { error: 'Invalid URL' });
        return;
    }

    if (request.method === 'GET' && pathname === '/api/prices') {
        try {
            sendJson(response, 200, await getPrices());
        } catch (error) {
            console.error('Could not fetch prices:', error);
            sendJson(response, 502, { error: 'Could not fetch current prices' });
        }
        return;
        }


    if (pathname === '/api/alerts' && request.method === 'GET') {
        const ownerId = requestUrl.searchParams.get('ownerId');
        const alerts = ownerId
            ? storedAlerts.filter(alert => alert.ownerId === ownerId)
            : storedAlerts;
        sendJson(response, 200, alerts);
        return;
    }

    if (pathname === '/api/alerts' && request.method === 'POST') {
        if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) {
            sendJson(response, 403, { error: 'Cross-origin requests are not allowed' });
            return;
        }

        try {
            const body = await readJson(request);
            const input = getAlertInput(body);
            const prices = await getPrices();
            const currentPrice = Number(prices[pairToSymbol[input.pair]]?.price);
            if (!Number.isFinite(currentPrice)) throw new Error('Could not read the current price');
            const alert = makeAlert(input, currentPrice, {
                ownerId: body?.ownerId,
                source: body?.source === 'telegram' ? 'telegram' : 'website',
            });
            storedAlerts.push(alert);
            await persistAlerts();
            sendJson(response, 201, alert);
        } catch (error) {
            const status = error.message === 'Invalid alert details' || error.message === 'Invalid alert channel' ? 400 : 502;
            sendJson(response, status, { error: error.message || 'Could not save alert' });
        }
        return;
    }

    const alertMatch = pathname.match(/^\/api\/alerts\/([^/]+)$/);
    if (alertMatch && ['PUT', 'DELETE'].includes(request.method)) {
        if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) {
            sendJson(response, 403, { error: 'Cross-origin requests are not allowed' });
            return;
        }
        const alertIndex = storedAlerts.findIndex(alert => alert.id === alertMatch[1]);
        if (alertIndex === -1) {
            sendJson(response, 404, { error: 'Alert not found' });
            return;
        }
        try {
            if (request.method === 'DELETE') {
                storedAlerts.splice(alertIndex, 1);
                await persistAlerts();
                sendJson(response, 200, { deleted: true });
                return;
            }
            const input = getAlertInput(await readJson(request));
            const prices = await getPrices();
            const currentPrice = Number(prices[pairToSymbol[input.pair]]?.price);
            if (!Number.isFinite(currentPrice)) throw new Error('Could not read the current price');
            storedAlerts[alertIndex] = makeAlert(input, currentPrice, storedAlerts[alertIndex]);
            await persistAlerts();
            sendJson(response, 200, storedAlerts[alertIndex]);
        } catch (error) {
            const status = error.message === 'Invalid alert details' || error.message === 'Invalid alert channel' ? 400 : 502;
            sendJson(response, status, { error: error.message || 'Could not update alert' });
        }
        return;
    }

    if (request.method !== 'GET') {
        sendJson(response, 405, { error: 'Method not allowed' });
        return;
    }

    await serveStatic(pathname, response);
});

server.listen(port, host, () => {
    console.log(`Price Alert is available at http://${host}:${port}`);
});

setInterval(() => void checkStoredAlerts(), 60_000);
void checkStoredAlerts();