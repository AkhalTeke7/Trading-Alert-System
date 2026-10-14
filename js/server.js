import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { loadEnvFile } from 'node:process';
import { pairToSymbol, getAlertInput, makeAlert, truncateToPrecision } from './alertModel.js';
import { renderAlertCard } from './alertCard.js';
import { fileURLToPath } from 'node:url';
import getPrices from './fetchPrice.js';
import { alertSender, startTelegramBot } from './telegram.mjs';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
// Only the Public/ folder is served — everything else (js/, data/, .env) stays private.
const publicRoot = resolve(projectRoot, 'Public');
const envFile = resolve(projectRoot, '.env');
if (existsSync(envFile)) loadEnvFile(envFile);

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
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

const triggeredFile = resolve(projectRoot, 'data', 'triggered.json');
const devicesFile = resolve(projectRoot, 'data', 'devices.json');

async function loadJsonArray(file) {
    try {
        const value = JSON.parse(await readFile(file, 'utf8'));
        return Array.isArray(value) ? value : [];
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
}

let triggeredEvents = await loadJsonArray(triggeredFile);
let pushDevices = await loadJsonArray(devicesFile);
let triggeredWriteQueue = Promise.resolve();
let devicesWriteQueue = Promise.resolve();

function persistTriggered() {
    const contents = JSON.stringify(triggeredEvents.slice(-100), null, 2);
    triggeredWriteQueue = triggeredWriteQueue.then(async () => {
        await mkdir(resolve(projectRoot, 'data'), { recursive: true });
        await writeFile(triggeredFile, contents);
    });
    return triggeredWriteQueue;
}

function persistDevices() {
    const contents = JSON.stringify(pushDevices, null, 2);
    devicesWriteQueue = devicesWriteQueue.then(async () => {
        await mkdir(resolve(projectRoot, 'data'), { recursive: true });
        await writeFile(devicesFile, contents);
    });
    return devicesWriteQueue;
}

// In-memory PNG cache so the phone fetching the same card twice costs one render.
const alertImageCache = new Map();
async function renderAlertPng(pair, target, note) {
    const key = `${pair}|${target}|${note}`;
    const cached = alertImageCache.get(key);
    if (cached) return cached;
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({
        channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'chrome',
    });
    try {
        const page = await browser.newPage({
            viewport: { width: 1200, height: 800 },
            // Scale 1 keeps the phone PNG small (~4x smaller than the
            // Telegram print); same content, faster over mobile data.
            deviceScaleFactor: 1,
        });
        await page.setContent(renderAlertCard(pair, target, note));
        await page.waitForTimeout(800);
        const png = await page.screenshot({ fullPage: true });
        alertImageCache.set(key, png);
        if (alertImageCache.size > 20) alertImageCache.delete(alertImageCache.keys().next().value);
        return png;
    } finally {
        await browser.close();
    }
}

// Push: FCM HTTP v1 (service account) first, legacy server key as fallback.
// Polling works without either.
async function pushToFcmDevices(event) {
    if (pushDevices.length === 0) return;
    const title = `Price Alert: ${event.pair}`;
    const body = `${event.pair} ${event.target} — ${event.note || 'triggered'}`;
    const data = { eventId: event.id, pair: String(event.pair), target: String(event.target), note: String(event.note || '') };
    try {
        const { getServiceAccount, sendFcmV1 } = await import('./fcmV1.js');
        const serviceAccount = getServiceAccount();
        if (serviceAccount) {
            const tokens = pushDevices.slice(-50).map(device => device.pushToken);
            if (await sendFcmV1(serviceAccount, tokens, { title, body, data })) return;
        }
    } catch (error) {
        console.error('FCM v1 push failed:', error.message || error);
    }
    await pushToFcmLegacy(title, body, data);
}

async function pushToFcmLegacy(title, body, data) {
    const serverKey = process.env.FCM_SERVER_KEY;
    if (!serverKey || pushDevices.length === 0) return;
    await Promise.all(pushDevices.slice(-50).map(async device => {
        try {
            const res = await fetch('https://fcm.googleapis.com/fcm/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `key=${serverKey}` },
                body: JSON.stringify({
                    to: device.pushToken,
                    priority: 'high',
                    content_available: true,
                    // Data-only: the app sounds the alarm itself in onMessageReceived.
                    data: { title, body, ...data },
                }),
            });
            if (!res.ok) throw new Error(`FCM ${res.status}`);
        } catch (error) {
            console.error('FCM push failed:', error.message || error);
        }
    }));
}
// It is recorded for real crossings AND for manual website test buttons,
// so the phone rings even if Telegram/Bale delivery fails.
function recordTriggered({ alertId, pair, target, note, channel, source }) {
    const event = {
        id: crypto.randomUUID(),
        alertId: alertId || null,
        pair: pair || '',
        target: target ?? null,
        note: note || '',
        channel: channel || '',
        source: source || 'crossing',
        triggeredAt: new Date().toISOString(),
    };
    triggeredEvents.push(event);
    triggeredEvents = triggeredEvents.slice(-100);
    void persistTriggered();
    return event;
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
                const event = recordTriggered({ alertId: alert.id, pair: alert.pair, target: alert.target, note: alert.note, channel: alert.channel, source: 'crossing' });
                void pushToFcmDevices(event).catch(() => {});
                storedAlerts = storedAlerts.filter(item => item.id !== alert.id);
                await persistAlerts();
            } catch (error) {
                console.error(`Could not send alert ${alert.id}:`, error);
                // Still ring the phone so a Telegram/Bale outage is audible.
                recordTriggered({ alertId: alert.id, pair: alert.pair, target: alert.target, note: alert.note, channel: alert.channel, source: 'crossing-delivery-failed' });
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
    const filePath = resolve(publicRoot, relativePath);
    if (!filePath.startsWith(`${publicRoot}${sep}`)) {
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

    if (pathname === '/api/triggered' && request.method === 'GET') {
        const since = requestUrl.searchParams.get('since');
        const sinceTime = since ? Date.parse(since) : Number.NaN;
        const events = Number.isFinite(sinceTime)
            ? triggeredEvents.filter(event => Date.parse(event.triggeredAt) > sinceTime)
            : triggeredEvents;
        sendJson(response, 200, events.slice(-100));
        return;
    }

    if (pathname === '/api/devices' && request.method === 'POST') {
        try {
            const body = await readJson(request);
            const pushToken = String(body?.pushToken || '').trim();
            if (!pushToken || pushToken.length > 4096) {
                sendJson(response, 400, { error: 'Invalid push token' });
                return;
            }
            const platform = String(body?.platform || 'android').slice(0, 32);
            pushDevices = pushDevices.filter(device => device.pushToken !== pushToken);
            pushDevices.push({ pushToken, platform, updatedAt: new Date().toISOString() });
            pushDevices = pushDevices.slice(-500);
            await persistDevices();
            sendJson(response, 201, { registered: true });
        } catch {
            sendJson(response, 400, { error: 'Invalid JSON' });
        }
        return;
    }

    if (pathname === '/api/test-alert' && request.method === 'POST') {
        if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) {
            sendJson(response, 403, { error: 'Cross-origin requests are not allowed' });
            return;
        }
        try {
            const body = await readJson(request).catch(() => ({}));
            const event = recordTriggered({
                alertId: null,
                pair: String(body?.pair || 'Gold / USD'),
                target: Number(body?.target || 0) || 'test',
                note: String(body?.note || 'Test sound from website'),
                channel: String(body?.channel || 'app'),
                source: 'manual-test',
            });
            try {
                await pushToFcmDevices(event).catch(() => {});
            } catch { /* polling fallback covers this */ }
            sendJson(response, 201, event);
        } catch (error) {
            sendJson(response, 500, { error: 'Could not create test event' });
        }
        return;
    }

    if (pathname === '/api/alert-card' && request.method === 'GET') {
        const pair = (requestUrl.searchParams.get('pair') || 'Gold / USD').slice(0, 50);
        const target = (requestUrl.searchParams.get('target') || 'test').slice(0, 50);
        const note = (requestUrl.searchParams.get('note') || '').slice(0, 500);
        response.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'private, max-age=86400',
        });
        response.end(renderAlertCard(pair, target, note));
        return;
    }

    if (pathname === '/api/alert-image' && request.method === 'GET') {
        const pair = (requestUrl.searchParams.get('pair') || 'Gold / USD').slice(0, 50);
        const target = (requestUrl.searchParams.get('target') || 'test').slice(0, 50);
        const note = (requestUrl.searchParams.get('note') || '').slice(0, 500);
        try {
            const png = await renderAlertPng(pair, target, note);
            response.writeHead(200, {
                'Content-Type': 'image/png',
                'Content-Length': png.length,
                'Cache-Control': 'private, max-age=86400',
            });
            response.end(png);
        } catch (error) {
            console.error('Could not render alert image:', error);
            sendJson(response, 502, { error: 'Could not render alert image' });
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

void startTelegramBot().catch(error => console.error('Could not start Telegram bot:', error));

setInterval(() => void checkStoredAlerts(), 60_000);
void checkStoredAlerts();
