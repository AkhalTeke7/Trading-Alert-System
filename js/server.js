import { testNotification } from './notificationTest.js';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { loadEnvFile } from 'node:process';
import { pairToSymbol, getAlertInput, makeAlert, truncateToPrecision } from './alertModel.js';
import { renderMainChartHtml } from './mainChartShot.js';
import { getCachedAlertPng, setCachedAlertPng, renderFallbackAlertPng } from './alertPngFallback.js';
import { fileURLToPath } from 'node:url';
import getPrices from './fetchPrice.js';
import { alertSender, startTelegramBot } from './telegram.mjs';
// local-only journal — images are embedded as compressed JPEG base64 in JSON exports; no Drive
// AI console core — same adapters/rules as the Cloudflare worker (cloudflare/alertStore.js)
import {
    PROVIDERS, listSkills, maskKey,
    upsertProvider, removeProvider, createSkillEntry, updateSkillEntry, deleteSkillEntry,
    runChat, testProvider, createToolExecutors,
} from './aiCore.js';

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

// Main-page chart PNG — screenshot of the chart as it appears on main.html
async function renderAlertPng(pair, target, note) {
    const cached = getCachedAlertPng(pair, target, note);
    if (cached) return cached;
    try {
        const { chromium } = await import('playwright');
        const html = renderMainChartHtml(pair, target, note);
        let browser;
        try {
            browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'chrome' });
        } catch {
            browser = await chromium.launch();
        }
        try {
            const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 });
            await page.setContent(html, { waitUntil: 'domcontentloaded' });
            try { await page.waitForSelector('iframe', { timeout: 10000 }); } catch {}
            await page.waitForTimeout(3500);
            const png = await page.screenshot({ fullPage: false });
            setCachedAlertPng(pair, target, note, png);
            return png;
        } finally {
            await browser.close();
        }
    } catch (error) {
        console.warn('Playwright screenshot unavailable; serving fallback alert PNG card:', error?.message || error);
        return renderFallbackAlertPng(pair, target, note);
    }
}

// Push: FCM HTTP v1 (service account) first, legacy server key as fallback.
// Polling works without either.
async function pushToFcmDevices(event) {
    if (pushDevices.length === 0) return;
    const title = `Price Alert: ${event.pair}`;
    const body = `${event.pair} ${event.target} — ${event.note || 'triggered'}`;
    const data = { eventId: event.id, pair: String(event.pair), target: String(event.target), note: String(event.note || ''), channel: String(event.channel || '') };
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
    if (isCheckingStoredAlerts) return;
    if (storedAlerts.length === 0) {
        // still log occasionally so user knows checker is alive
        // console.log('[check] no stored alerts');
        return;
    }
    isCheckingStoredAlerts = true;
    try {
        const prices = await getPrices();
        // migrate old symbols (e.g. NASDAQ:NDX -> OANDA:NAS100USD) without breaking old alerts
        for (const a of storedAlerts) {
            const correct = pairToSymbol[a.pair];
            if (correct && a.symbol !== correct) {
                console.log(`[migrate] ${a.id} ${a.pair}: ${a.symbol} -> ${correct}`);
                a.symbol = correct;
            }
        }
        for (const alert of [...storedAlerts]) {
            const sym = pairToSymbol[alert.pair] || alert.symbol;
            const raw = prices[sym]?.price ?? prices[alert.symbol]?.price;
            const current = Number(raw);
            const comparedCurrent = truncateToPrecision(current, alert.targetPrecision || 0);
            let crossed = false;
            if (alert.state === 'up') crossed = Number.isFinite(comparedCurrent) && comparedCurrent >= alert.target;
            else if (alert.state === 'down') crossed = Number.isFinite(comparedCurrent) && comparedCurrent <= alert.target;
            else crossed = Number.isFinite(comparedCurrent) && comparedCurrent === alert.target;
            console.log(`[check] ${alert.pair} target=${alert.target} state=${alert.state} prec=${alert.targetPrecision} symbol=${sym} current=${current} trunc=${comparedCurrent} crossed=${crossed}`);
            if (!Number.isFinite(comparedCurrent) || !crossed) continue;

            const isPhone = alert.channel === 'Phone' || alert.channel === 'App';
            try {
                if (!isPhone) await alertSender(alert.pair, alert.target, alert.note, alert.channel);
                const event = recordTriggered({ alertId: alert.id, pair: alert.pair, target: alert.target, note: alert.note, channel: alert.channel, source: 'crossing' });
                if (isPhone) void pushToFcmDevices(event).catch(() => {});
                storedAlerts = storedAlerts.filter(item => item.id !== alert.id);
                await persistAlerts();
                console.log(`[triggered] ${alert.id} ${alert.pair} ${alert.target} sent -> ${alert.channel}${isPhone ? ' (phone only)' : ''}`);
            } catch (error) {
                console.error(`Could not send alert ${alert.id}:`, error);
                recordTriggered({ alertId: alert.id, pair: alert.pair, target: alert.target, note: alert.note, channel: alert.channel, source: 'crossing-delivery-failed' });
                // No phone fallback — channels are distinct (Phone only rings for Phone)
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

// --- AI console settings (mirrors the Durable Object's aiSettings record) ---
const aiSettingsFile = resolve(projectRoot, 'data', 'ai-settings.json');

async function loadAiSettings() {
    try {
        const value = JSON.parse(await readFile(aiSettingsFile, 'utf8'));
        return {
            providers: value.providers && typeof value.providers === 'object' ? value.providers : {},
            skills: Array.isArray(value.skills) ? value.skills : [],
            activeProvider: String(value.activeProvider || 'demo'),
            activeModel: String(value.activeModel || ''),
        };
    } catch (error) {
        if (error.code === 'ENOENT') return { providers: {}, skills: [], activeProvider: 'demo', activeModel: '' };
        throw error;
    }
}

let aiSettings = await loadAiSettings();
let aiWriteQueue = Promise.resolve();

function persistAiSettings() {
    const contents = JSON.stringify(aiSettings, null, 2);
    aiWriteQueue = aiWriteQueue.then(async () => {
        await mkdir(resolve(projectRoot, 'data'), { recursive: true });
        await writeFile(aiSettingsFile, contents);
    });
    return aiWriteQueue;
}

function aiMaskedProviders(settings) {
    return PROVIDERS.map(preset => {
        const saved = settings.providers[preset.id] || null;
        return {
            id: preset.id,
            name: preset.name,
            hint: preset.hint,
            kind: preset.kind,
            keyless: !!preset.keyless,
            requiresBaseUrl: !!preset.requiresBaseUrl,
            models: preset.models,
            defaultModel: preset.defaultModel,
            configured: !!preset.keyless || Boolean(saved?.apiKey),
            keyMask: saved?.apiKey ? maskKey(saved.apiKey) : null,
            model: saved?.model || '',
            baseUrl: saved?.baseUrl || '',
            savedAt: saved?.savedAt || null,
        };
    });
}

// Tool executors bound to this server's real data (prices, alerts, journal…).
function aiExecutors(settings) {
    return createToolExecutors({
            // App test = queue a triggered event; the Android app polls /api/triggered
            // and pulls it automatically — no device registration / FCM needed.
            testNotification: args => testNotification({ ...args, env: process.env, recordTriggered: async event => recordTriggered(event) }),
        getPrices,
        getAlerts: async () => storedAlerts,
        getTriggered: async () => triggeredEvents,
        // journal is local-only (browser localStorage) — no server copy without Drive
        getJournal: async () => null,
        searchApiKey: String(settings.providers?.tavily?.apiKey || ''),
    });
}

function aiStatePayload(settings) {
    return {
        providers: aiMaskedProviders(settings),
        active: { provider: settings.activeProvider, model: settings.activeModel },
        skills: listSkills(settings.skills),
    };
}

// Writes are same-site only, but host comparison survives TLS-terminating proxies.
function sameSiteWriteAllowed(request, url) {
    const origin = request.headers.origin;
    if (!origin) return request.headers['sec-fetch-site'] !== 'cross-site';
    try {
        return new URL(origin).host === url.host;
    } catch {
        return false;
    }
}

async function handleAiApi(request, response, url) {
    const path = url.pathname;
    if (!path.startsWith('/api/ai/')) return false;
    const method = request.method;
    if (!sameSiteWriteAllowed(request, url) && !['GET', 'HEAD'].includes(method)) {
        sendJson(response, 403, { error: 'Cross-origin requests are not allowed' });
        return true;
    }
    try {
        if (path === '/api/ai/state' && method === 'GET') {
            sendJson(response, 200, aiStatePayload(aiSettings));
            return true;
        }

        if (path === '/api/ai/providers' && method === 'PUT') {
            const body = await readJson(request, 8_000).catch(() => null);
            if (!body) {
                sendJson(response, 400, { error: 'Invalid JSON' });
                return true;
            }
            const result = upsertProvider(aiSettings, body);
            if (result.error) {
                sendJson(response, result.status || 400, { error: result.error });
                return true;
            }
            aiSettings = result.settings;
            await persistAiSettings();
            sendJson(response, 200, aiStatePayload(aiSettings));
            return true;
        }

        const providerMatch = path.match(/^\/api\/ai\/providers\/([^/]+)$/);
        if (providerMatch && method === 'DELETE') {
            const result = removeProvider(aiSettings, decodeURIComponent(providerMatch[1]));
            if (result.error) {
                sendJson(response, result.status || 400, { error: result.error });
                return true;
            }
            aiSettings = result.settings;
            await persistAiSettings();
            sendJson(response, 200, aiStatePayload(aiSettings));
            return true;
        }

        if (path === '/api/ai/providers/test' && method === 'POST') {
            const body = await readJson(request, 8_000).catch(() => null);
            if (!body) {
                sendJson(response, 400, { error: 'Invalid JSON' });
                return true;
            }
            try {
                const result = await testProvider({
                    provider: String(body?.provider || 'demo'),
                    apiKey: body?.apiKey,
                    model: body?.model,
                    baseUrl: body?.baseUrl,
                }, { providers: aiSettings.providers });
                sendJson(response, 200, result);
            } catch (error) {
                sendJson(response, error.status || 502, { error: error.publicMessage || error.message || 'Key test failed' });
            }
            return true;
        }

        if (path === '/api/ai/skills' && method === 'GET') {
            sendJson(response, 200, { skills: listSkills(aiSettings.skills) });
            return true;
        }

        if (path === '/api/ai/skills' && method === 'POST') {
            const body = await readJson(request, 12_000).catch(() => null);
            if (!body) {
                sendJson(response, 400, { error: 'Invalid JSON' });
                return true;
            }
            const result = createSkillEntry(aiSettings, body);
            if (result.error) {
                sendJson(response, result.status || 400, { error: result.error });
                return true;
            }
            aiSettings = result.settings;
            await persistAiSettings();
            sendJson(response, 201, { skills: listSkills(aiSettings.skills), created: result.skill });
            return true;
        }

        const skillMatch = path.match(/^\/api\/ai\/skills\/([^/]+)$/);
        if (skillMatch && ['PUT', 'DELETE'].includes(method)) {
            const id = decodeURIComponent(skillMatch[1]);
            if (method === 'DELETE') {
                const result = deleteSkillEntry(aiSettings, id);
                if (result.error) {
                    sendJson(response, result.status || 400, { error: result.error });
                    return true;
                }
                aiSettings = result.settings;
                await persistAiSettings();
                sendJson(response, 200, { skills: listSkills(aiSettings.skills), deleted: true });
                return true;
            }
            const body = await readJson(request, 12_000).catch(() => null);
            if (!body) {
                sendJson(response, 400, { error: 'Invalid JSON' });
                return true;
            }
            const result = updateSkillEntry(aiSettings, id, body);
            if (result.error) {
                sendJson(response, result.status || 400, { error: result.error });
                return true;
            }
            aiSettings = result.settings;
            await persistAiSettings();
            sendJson(response, 200, { skills: listSkills(aiSettings.skills), updated: result.skill });
            return true;
        }

        if (path === '/api/ai/chat' && method === 'POST') {
            // vision JSON+charts can be 180KB+ base64; keep limit generous but below memory DOS
            const body = await readJson(request, 350_000).catch(() => null);
            if (!body) {
                sendJson(response, 400, { error: 'Invalid JSON' });
                return true;
            }
            if (!body.provider) body.provider = aiSettings.activeProvider || 'demo';
            if (!body.model && aiSettings.activeModel) body.model = aiSettings.activeModel;
            let result;
            try {
                result = await runChat(body, {
                    providers: aiSettings.providers,
                    skills: aiSettings.skills,
                    demoDelayMs: 18,
                    executors: aiExecutors(aiSettings),
                });
            } catch (error) {
                sendJson(response, error.status || 502, { error: error.publicMessage || error.message || 'Chat failed' });
                return true;
            }
            if (result.kind === 'json') {
                sendJson(response, 200, {
                    message: { role: 'assistant', content: result.content },
                    provider: result.provider,
                    model: result.model,
                    skill: result.skill?.id || null,
                    toolCalls: result.toolCalls || [],
                });
                return true;
            }
            response.writeHead(200, {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-store',
                'X-Content-Type-Options': 'nosniff',
                'X-Accel-Buffering': 'no',
                Connection: 'keep-alive',
            });
            try {
                // { delta } | { reset } | { tool } | { done } | { error }
                for await (const event of result.events) {
                    response.write(`data: ${JSON.stringify(event)}\n\n`);
                }
            } catch {
                response.write(`data: ${JSON.stringify({ error: 'The response stream ended unexpectedly.' })}\n\n`);
            }
            response.end();
            return true;
        }

        sendJson(response, 404, { error: 'Not found' });
        return true;
    } catch (error) {
        sendJson(response, error?.status || 500, { error: error?.publicMessage || error?.message || 'AI operation failed' });
        return true;
    }
}

async function readJson(request, maxBytes = 10_000) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > maxBytes) throw new Error('Request body is too large');
        chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function readBodyBuffer(request, maxBytes = 12 * 1024 * 1024) {
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > maxBytes) throw new Error('Request body is too large'); chunks.push(chunk); }
    return Buffer.concat(chunks);
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

    // Proxy TradingView calendar events — fixes CORS (browser blocks direct fetch to chartevents-reuters)
    if (request.method === 'GET' && pathname === '/api/events') {
        try {
            const from = requestUrl.searchParams.get('from') || new Date().toISOString();
            const to = requestUrl.searchParams.get('to') || new Date(Date.now() + 7*24*3600*1000).toISOString();
            const countries = requestUrl.searchParams.get('countries') || 'AR,AU,BR,CA,CN,FR,DE,IN,ID,IT,JP,KR,MX,RU,SA,ZA,TR,GB,US,ERL';
            const minImportance = requestUrl.searchParams.get('minImportance') || '0';
            const upstream = `https://chartevents-reuters.tradingview.com/events?minImportance=${encodeURIComponent(minImportance)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&countries=${encodeURIComponent(countries)}`;
            const r = await fetch(upstream, { headers: { 'Accept': 'application/json', 'User-Agent': 'Price-Alert/1.0' }, signal: AbortSignal.timeout(15_000) });
            if (!r.ok) throw new Error(`upstream ${r.status}`);
            const data = await r.json();
            response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
            response.end(JSON.stringify(data));
        } catch (error) {
            console.error('Could not fetch events:', error.message || error);
            sendJson(response, 502, { error: 'Could not fetch events' });
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
            const pair = String(body?.pair || 'Gold / USD').slice(0, 50);
            const target = String(body?.target ?? 'test').slice(0, 50);
            const note = String(body?.note || 'Test chart alert').slice(0, 500);
            const channel = String(body?.channel || 'Telegram').slice(0, 20);
            const testSend = String(body?.testSend || '') === '1' || body?.testSend === true;
            let sendError = null;
            let sent = false;
            if (testSend && channel !== 'App') {
                try { await alertSender(pair, target, note, channel); sent = true; console.log(`test-alert sent: ${pair} ${target} -> ${channel}`); } catch (e) { sendError = e.message||String(e); console.error('test-alert send failed:', sendError); }
            }
            const event = recordTriggered({
                alertId: null,
                pair,
                target,
                note,
                channel,
                source: 'manual-test',
            });
            try { await pushToFcmDevices(event).catch(() => {}); } catch { /* polling fallback covers this */ }
            sendJson(response, 201, { ...event, sent, sendError });
        } catch (error) {
            sendJson(response, 500, { error: 'Could not create test event' });
        }
        return;
    }

    if (request.method === 'GET' && pathname === '/api/check-now') {
        await checkStoredAlerts();
        sendJson(response, 200, { checked: true, remaining: storedAlerts.length, triggered: triggeredEvents.slice(-3) });
        return;
    }

    // Journal is local-only (browser localStorage + JSON export with compressed base64). No server Drive routes.

    if (pathname === '/api/alert-card' && request.method === 'GET') {
        const pair = (requestUrl.searchParams.get('pair') || 'Gold / USD').slice(0, 50);
        const target = (requestUrl.searchParams.get('target') || 'test').slice(0, 50);
        const note = (requestUrl.searchParams.get('note') || '').slice(0, 500);
        response.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'private, max-age=86400',
        });
        response.end(renderMainChartHtml(pair, target, note));
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

    // AI news digests: screenshot card for Telegram buttons and direct preview on the site
    if ((pathname === '/api/news-digest' || pathname === '/api/news-digest.png') && request.method === 'GET') {
        const kind = (requestUrl.searchParams.get('kind') || 'daily').toLowerCase();
        const wantPng = pathname.endsWith('.png') || requestUrl.searchParams.get('format') === 'png';
        try {
            const { buildNewsDigest } = await import('./newsDigest.js');
            const { default: getPricesLocal } = await import('./fetchPrice.js');
            const res = await buildNewsDigest({
                kind: kind === 'global' ? 'global' : 'daily',
                env: process.env,
                fetchImpl: fetch,
                providers: aiSettings,
                skills: aiSettings.skills,
                overrides: { getPrices: getPricesLocal, getAlerts: async()=> storedAlerts, getTriggered: async()=> triggeredEvents, fetchImpl: fetch },
            });
            if (wantPng && res.png) {
                response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': res.png.length, 'Cache-Control': 'no-store' });
                response.end(res.png);
                return;
            }
            if (wantPng) { sendJson(response, 502, { error: 'PNG not rendered, try HTML preview' }); return; }
            const fmt = requestUrl.searchParams.get('html') === '1' ? 'html' : 'json';
            if (fmt === 'html') {
                response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
                response.end(res.html);
                return;
            }
            sendJson(response, 200, { kind, caption: res.caption, aiContent: res.aiContent, htmlLen: res.html?.length || 0 });
            return;
        } catch (e) {
            console.error('news-digest failed', e?.message);
            sendJson(response, 502, { error: 'Could not build news digest' });
            return;
        }
    }

    if (await handleAiApi(request, response, requestUrl)) return;

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

setInterval(() => void checkStoredAlerts(), 10_000);
void checkStoredAlerts();
// Also expose manual trigger for debugging: GET /api/check-now

