import { testNotification } from '../js/notificationTest.js';
import getPrices from '../js/fetchPrice.js';
import { pairToSymbol, getAlertInput, makeAlert, truncateToPrecision } from '../js/alertModel.js';
import { renderMainChartHtml } from '../js/mainChartShot.js';
import { createTelegramBot } from '../js/telegramBot.js';
import {
    PROVIDERS, listSkills, maskKey,
    upsertProvider, removeProvider, createSkillEntry, updateSkillEntry, deleteSkillEntry,
    runChat, testProvider, createToolExecutors,
} from '../js/aiCore.js';
import { sendAlert } from './notifications.js';
import { json, readJson } from './http.js';

// One Durable Object owns the personal dashboard, including Telegram conversation
// state. Serializing operations prevents a price check from deleting an edited
// alert or overlapping cron invocations from sending the same alert concurrently.
export class AlertStore {
    constructor(ctx, env, services = {}) {
        this.storage = ctx.storage;
        this.env = env;
        this.prices = services.getPrices || getPrices;
        this.notify = services.sendAlert || sendAlert;
        this.createBot = services.createTelegramBot || createTelegramBot;
        this.aiFetch = services.aiFetch || fetch;
        this.demoDelayMs = services.demoDelayMs ?? 18;
        this.queue = Promise.resolve();
    }

    async getAlerts() {
        const records = await this.storage.list({ prefix: 'alert:' });
        const order = await this.storage.get('alertOrder') || [];
        return order.map(id => records.get(`alert:${id}`)).filter(Boolean);
    }

    async saveAlerts(alerts, extra = {}) {
        await this.storage.transaction(async storage => {
            const existing = await storage.list({ prefix: 'alert:' });
            const records = Object.fromEntries(alerts.map(alert => [`alert:${alert.id}`, alert]));
            const removed = [...existing.keys()].filter(key => !(key in records));
            if (removed.length) await storage.delete(removed);
            // Separate records avoid the storage value size limit on a large list.
            await storage.put({ ...records, alertOrder: alerts.map(alert => alert.id), ...extra });
        });
    }

    fetch(request) {
        const result = this.queue.then(() => this.handle(request));
        this.queue = result.catch(() => {});
        return result;
    }

    async getTriggered() {
        return await this.storage.get('triggeredEvents') || [];
    }

    async appendTriggered(event) {
        const events = [...(await this.getTriggered()), event].slice(-100);
        await this.storage.put({ triggeredEvents: events });
        return event;
    }

    makeTriggered({ alertId, pair, target, note, channel, source }) {
        return {
            id: crypto.randomUUID(),
            alertId: alertId || null,
            pair: pair || '',
            target: target ?? null,
            note: note || '',
            channel: channel || '',
            source: source || 'crossing',
            triggeredAt: new Date().toISOString(),
        };
    }

    async handle(request) {
        const pathname = new URL(request.url).pathname;
        try {
            if (pathname === '/internal/check' && request.method === 'POST') {
                await this.checkAlerts();
                return json({ checked: true });
            }
            if (pathname === '/internal/telegram' && request.method === 'POST') {
                return await this.telegram(await readJson(request, 64_000));
            }
            if (pathname === '/api/triggered' && request.method === 'GET') {
                const since = new URL(request.url).searchParams.get('since');
                const sinceTime = since ? Date.parse(since) : Number.NaN;
                const events = await this.getTriggered();
                return json((Number.isFinite(sinceTime)
                    ? events.filter(event => Date.parse(event.triggeredAt) > sinceTime)
                    : events).slice(-100));
            }
            if (pathname === '/api/devices' && request.method === 'POST') {
                let body;
                try {
                    body = await readJson(request);
                } catch {
                    return json({ error: 'Invalid JSON' }, 400);
                }
                const pushToken = String(body?.pushToken || '').trim();
                if (!pushToken || pushToken.length > 4096) return json({ error: 'Invalid push token' }, 400);
                const devices = (await this.storage.get('pushDevices') || [])
                    .filter(device => device.pushToken !== pushToken);
                devices.push({ pushToken, platform: String(body?.platform || 'android').slice(0, 32), updatedAt: new Date().toISOString() });
                await this.storage.put({ pushDevices: devices.slice(-500) });
                return json({ registered: true }, 201);
            }
            if (pathname === '/api/test-alert' && request.method === 'POST') {
                const body = await readJson(request).catch(() => ({}));
                const event = await this.appendTriggered(this.makeTriggered({
                    pair: String(body?.pair || 'Gold / USD'),
                    target: Number(body?.target || 0) || 'test',
                    note: String(body?.note || 'Test sound from website'),
                    channel: 'app',
                    source: 'manual-test',
                }));
                await this.pushToDevices(event).catch(() => {});
                return json(event, 201);
            }
            if (pathname === '/api/alert-card' && request.method === 'GET') {
                const params = new URL(request.url).searchParams;
                const pair = (params.get('pair') || 'Gold / USD').slice(0, 50);
                const target = (params.get('target') || 'test').slice(0, 50);
                const note = (params.get('note') || '').slice(0, 500);
                return new Response(renderMainChartHtml(pair, target, note), {
                    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, max-age=86400' },
                });
            }
            if (pathname === '/api/alert-image' && request.method === 'GET') {
                const params = new URL(request.url).searchParams;
                const pair = (params.get('pair') || 'Gold / USD').slice(0, 50);
                const target = (params.get('target') || 'test').slice(0, 50);
                const note = (params.get('note') || '').slice(0, 500);
                try {
                    const { launch } = await import('@cloudflare/playwright');
                    const browser = await launch(this.env.BROWSER);
                    let png;
                    try {
                        const page = await browser.newPage({
                            viewport: { width: 1200, height: 800 },
                            deviceScaleFactor: 2,
                        });
                        await page.setContent(renderMainChartHtml(pair, target, note), { waitUntil: 'domcontentloaded' });
                        try { await page.waitForSelector('iframe', { timeout: 14000 }); } catch {}
                        await page.waitForTimeout(5000);
                        png = await page.screenshot({ fullPage: false });
                    } finally {
                        await browser.close();
                    }
                    return new Response(png, {
                        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=86400' },
                    });
                } catch {
                    console.error('Alert image render failed');
                    return json({ error: 'Could not render alert image' }, 502);
                }
            }
            if (pathname.startsWith('/api/ai/')) {
                return await this.aiApi(request);
            }
            return await this.alertsApi(request);
        } catch {
            // Upstream exception messages can include credential-bearing URLs.
            console.error('Alert store operation failed');
            return json({ error: 'Could not complete the alert operation. Check your bindings and upstream services.' }, 502);
        }
    }

    // --- AI console: provider keys, skills and proxied chat (keys stay server-side) ---

    async getAiSettings() {
        const settings = await this.storage.get('aiSettings') || {};
        return {
            providers: settings.providers || {},
            skills: Array.isArray(settings.skills) ? settings.skills : [],
            activeProvider: settings.activeProvider || 'demo',
            activeModel: settings.activeModel || '',
        };
    }

    async saveAiSettings(patch) {
        const settings = await this.getAiSettings();
        await this.storage.put('aiSettings', { ...settings, ...patch });
    }

    maskedProviders(settings) {
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

    // Tool executors bound to this dashboard's real data — the chat can read
    // prices, alerts, triggered events and the journal through these.
    aiExecutors(settings) {
        return createToolExecutors({
            // App test = queue a triggered event; the Android app polls /api/triggered
            // and pulls it automatically — no device registration / FCM needed.
            testNotification: args => testNotification({ ...args, env: this.env, recordTriggered: event => this.appendTriggered(this.makeTriggered(event)), fetchImpl: this.aiFetch }),
            getPrices: this.prices,
            getAlerts: () => this.getAlerts(),
            getTriggered: () => this.getTriggered(),
            getJournal: async () => {
                const journal = getProvider(null, this.env);
                if (!journal.isConfigured(this.env)) return null;
                const data = await journal.getJson(this.env);
                return data?.json ? JSON.parse(data.json) : null;
            },
            fetchImpl: this.aiFetch,
            searchApiKey: String(settings.providers?.tavily?.apiKey || ''),
        });
    }

    aiStatePayload(settings) {
        return {
            providers: this.maskedProviders(settings),
            active: { provider: settings.activeProvider, model: settings.activeModel },
            skills: listSkills(settings.skills),
        };
    }

    async aiApi(request) {
        const url = new URL(request.url);
        const path = url.pathname;
        try {
            if (path === '/api/ai/state' && request.method === 'GET') {
                return json(this.aiStatePayload(await this.getAiSettings()));
            }

            if (path === '/api/ai/providers' && request.method === 'PUT') {
                let body;
                try {
                    body = await readJson(request, 8_000);
                } catch {
                    return json({ error: 'Invalid JSON' }, 400);
                }
                const settings = await this.getAiSettings();
                const result = upsertProvider(settings, body);
                if (result.error) return json({ error: result.error }, result.status || 400);
                await this.saveAiSettings(result.settings);
                return json(this.aiStatePayload(await this.getAiSettings()));
            }

            const providerMatch = path.match(/^\/api\/ai\/providers\/([^/]+)$/);
            if (providerMatch && request.method === 'DELETE') {
                const id = decodeURIComponent(providerMatch[1]);
                const settings = await this.getAiSettings();
                const result = removeProvider(settings, id);
                if (result.error) return json({ error: result.error }, result.status || 400);
                await this.saveAiSettings(result.settings);
                return json(this.aiStatePayload(await this.getAiSettings()));
            }

            if (path === '/api/ai/providers/test' && request.method === 'POST') {
                let body;
                try {
                    body = await readJson(request, 8_000);
                } catch {
                    return json({ error: 'Invalid JSON' }, 400);
                }
                const settings = await this.getAiSettings();
                try {
                    const result = await testProvider({
                        provider: String(body?.provider || 'demo'),
                        apiKey: body?.apiKey,
                        model: body?.model,
                        baseUrl: body?.baseUrl,
                    }, { providers: settings.providers, fetchImpl: this.aiFetch });
                    return json(result);
                } catch (error) {
                    return json({ error: error.publicMessage || error.message || 'Key test failed' }, error.status || 502);
                }
            }

            if (path === '/api/ai/skills' && request.method === 'GET') {
                const settings = await this.getAiSettings();
                return json({ skills: listSkills(settings.skills) });
            }

            if (path === '/api/ai/skills' && request.method === 'POST') {
                let body;
                try {
                    body = await readJson(request, 12_000);
                } catch {
                    return json({ error: 'Invalid JSON' }, 400);
                }
                const settings = await this.getAiSettings();
                const result = createSkillEntry(settings, body);
                if (result.error) return json({ error: result.error }, result.status || 400);
                await this.saveAiSettings(result.settings);
                return json({ skills: listSkills(result.settings.skills), created: result.skill }, 201);
            }

            const skillMatch = path.match(/^\/api\/ai\/skills\/([^/]+)$/);
            if (skillMatch && ['PUT', 'DELETE'].includes(request.method)) {
                const id = decodeURIComponent(skillMatch[1]);
                const settings = await this.getAiSettings();
                if (request.method === 'DELETE') {
                    const result = deleteSkillEntry(settings, id);
                    if (result.error) return json({ error: result.error }, result.status || 400);
                    await this.saveAiSettings(result.settings);
                    return json({ skills: listSkills(result.settings.skills), deleted: true });
                }
                let body;
                try {
                    body = await readJson(request, 12_000);
                } catch {
                    return json({ error: 'Invalid JSON' }, 400);
                }
                const result = updateSkillEntry(settings, id, body);
                if (result.error) return json({ error: result.error }, result.status || 400);
                await this.saveAiSettings(result.settings);
                return json({ skills: listSkills(result.settings.skills), updated: result.skill });
            }

            if (path === '/api/ai/chat' && request.method === 'POST') {
                let body;
                try {
                    body = await readJson(request, 200_000);
                } catch {
                    return json({ error: 'Invalid JSON' }, 400);
                }
                const settings = await this.getAiSettings();
                if (!body.provider) body.provider = settings.activeProvider || 'demo';
                if (!body.model && settings.activeModel) body.model = settings.activeModel;
                let result;
                try {
                    result = await runChat(body, {
                        providers: settings.providers,
                        skills: settings.skills,
                        fetchImpl: this.aiFetch,
                        demoDelayMs: this.demoDelayMs,
                        executors: this.aiExecutors(settings),
                    });
                } catch (error) {
                    return json({ error: error.publicMessage || error.message || 'Chat failed' }, error.status || 502);
                }
                if (result.kind === 'json') {
                    return json({
                        message: { role: 'assistant', content: result.content },
                        provider: result.provider,
                        model: result.model,
                        skill: result.skill?.id || null,
                        toolCalls: result.toolCalls || [],
                    });
                }
                const encoder = new TextEncoder();
                const { readable, writable } = new TransformStream();
                const writer = writable.getWriter();
                (async () => {
                    try {
                        // { delta } | { reset } | { tool } | { done } | { error }
                        for await (const event of result.events) {
                            await writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                        }
                    } catch {
                        await writer.write(encoder.encode(`data: ${JSON.stringify({ error: 'The response stream ended unexpectedly.' })}\n\n`)).catch(() => {});
                    } finally {
                        await writer.close().catch(() => {});
                    }
                })();
                return new Response(readable, {
                    headers: {
                        'Content-Type': 'text/event-stream; charset=utf-8',
                        'Cache-Control': 'no-store',
                        'X-Content-Type-Options': 'nosniff',
                        'X-Accel-Buffering': 'no',
                    },
                });
            }

            return json({ error: 'Not found' }, 404);
        } catch (error) {
            console.error('AI operation failed');
            return json({ error: error?.publicMessage || 'Could not complete the AI operation.' }, error?.status || 502);
        }
    }

    async alertsApi(request, telegramUpdateId) {
        const url = new URL(request.url);
        const collection = url.pathname === '/api/alerts';
        const match = url.pathname.match(/^\/api\/alerts\/([^/]+)$/);
        if (!collection && !match) return json({ error: 'Not found' }, 404);
        const alerts = await this.getAlerts();
        if (collection && request.method === 'GET') {
            const ownerId = url.searchParams.get('ownerId');
            return json(ownerId ? alerts.filter(alert => alert.ownerId === ownerId) : alerts);
        }
        const creating = collection && request.method === 'POST';
        if (!creating && !(match && ['PUT', 'DELETE'].includes(request.method))) {
            return json({ error: 'Method not allowed' }, 405);
        }
        const index = match ? alerts.findIndex(alert => alert.id === decodeURIComponent(match[1])) : -1;
        if (match && index === -1) return json({ error: 'Alert not found' }, 404);
        if (request.method === 'DELETE') {
            alerts.splice(index, 1);
            await this.saveAlerts(alerts);
            return json({ deleted: true });
        }
        const savedUpdates = creating && telegramUpdateId !== undefined
            ? await this.storage.get('telegramSavedAlerts') || [] : [];
        const previous = savedUpdates.find(entry => entry.updateId === telegramUpdateId);
        if (previous) return json(alerts.find(alert => alert.id === previous.alertId) || { id: previous.alertId, alreadySaved: true }, 201);
        let body, input;
        try {
            body = await readJson(request);
            input = getAlertInput(body);
        } catch (error) {
            return json({ error: error.message }, 400);
        }
        // A single-owner dashboard is deliberately bounded, rather than storing
        // an unbounded array or spending unlimited browser time in one cron run.
        if (creating && alerts.length >= 100) return json({ error: 'Maximum of 100 pending alerts reached' }, 409);
        const prices = await this.prices();
        const currentPrice = Number(prices[pairToSymbol[input.pair]]?.price);
        if (!Number.isFinite(currentPrice)) return json({ error: 'Could not read the current price' }, 502);
        const metadata = creating ? {
            ownerId: body?.ownerId,
            source: body?.source === 'telegram' ? 'telegram' : 'website',
        } : alerts[index];
        const alert = makeAlert(input, currentPrice, metadata);
        if (creating) alerts.push(alert);
        else alerts[index] = alert;
        const extra = creating && telegramUpdateId !== undefined ? {
            telegramSavedAlerts: [...savedUpdates.slice(-99), { updateId: telegramUpdateId, alertId: alert.id }],
        } : {};
        await this.saveAlerts(alerts, extra);
        return json(alert, creating ? 201 : 200);
    }

    async pushToDevices(event) {
        const devices = await this.storage.get('pushDevices') || [];
        if (!devices.length) return;
        const title = `Price Alert: ${event.pair}`;
        const body = `${event.pair} ${event.target} — ${event.note || 'triggered'}`;
        const data = { eventId: event.id, pair: String(event.pair), target: String(event.target), note: String(event.note || ''), channel: String(event.channel || '') };
        // FCM HTTP v1 (service account) first; legacy server key as fallback.
        try {
            const { getServiceAccount, sendFcmV1 } = await import('../js/fcmV1.js');
            const serviceAccount = getServiceAccount(this.env);
            if (serviceAccount) {
                const tokens = devices.slice(-50).map(device => device.pushToken);
                if (await sendFcmV1(serviceAccount, tokens, { title, body, data })) return;
            }
        } catch {
            console.error('FCM v1 push failed');
        }
        await this.pushToDevicesLegacy(devices, title, body, data);
    }

    async pushToDevicesLegacy(devices, title, body, data) {
        const serverKey = this.env.FCM_SERVER_KEY;
        if (!serverKey || !devices.length) return;
        await Promise.all(devices.slice(-50).map(async device => {
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
                if (!res.ok) throw new Error('FCM push failed');
            } catch {
                console.error('FCM push failed for a device');
            }
        }));
    }

    async checkAlerts() {
        let alerts = await this.getAlerts();
        if (!alerts.length) return;
        const prices = await this.prices();
        let attempts = 0;
        for (const alert of [...alerts]) {
            const current = Number(prices[alert.symbol || pairToSymbol[alert.pair]]?.price);
            const compared = truncateToPrecision(current, alert.targetPrecision || 0);
            const crossed = alert.state === 'up' ? compared >= alert.target :
                alert.state === 'down' && compared <= alert.target;
            // Once delivery starts, retry failed channels even if the price reverses.
            if (!alert.triggered && (!Number.isFinite(compared) || !crossed)) continue;
            if (++attempts > 5) break; // Remaining crossed alerts are checked on the next cron tick.
            alert.triggered = true;
            await this.saveAlerts(alerts);
            const isPhone = alert.channel === 'Phone' || alert.channel === 'App';
            try {
                if (!isPhone) {
                    await this.notify(alert, this.env, async channel => {
                        alert.deliveredChannels = [...new Set([...(alert.deliveredChannels || []), channel])];
                        await this.saveAlerts(alerts);
                    });
                }
                const event = await this.appendTriggered(this.makeTriggered({
                    alertId: alert.id, pair: alert.pair, target: alert.target, note: alert.note, channel: alert.channel, source: 'crossing',
                }));
                if (isPhone) await this.pushToDevices(event).catch(() => {});
                alerts = alerts.filter(item => item.id !== alert.id);
                await this.saveAlerts(alerts);
            } catch {
                console.error(`Notification failed for alert ${alert.id}; retained for retry`);
                // No phone fallback — channels are distinct (Phone only rings for Phone)
                // Rotate failed alerts so they do not starve other pending alerts.
                alerts = [...alerts.filter(item => item.id !== alert.id), alert];
                await this.saveAlerts(alerts);
            }
        }
    }

    async telegram(update) {
        if (!Number.isSafeInteger(update?.update_id)) return json({ error: 'Invalid update' }, 400);
        const allowed = String(this.env.TELEGRAM_ALLOWED_USER_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
        const userId = String(update.message?.from?.id ?? update.callback_query?.from?.id ?? '');
        if (!allowed.includes(userId)) return json({ ok: true });
        const completed = await this.storage.get('telegramUpdates') || [];
        if (completed.includes(update.update_id)) return json({ ok: true });
        const userStates = new Map(await this.storage.get('telegramStates') || []);
        const bot = this.createBot(this.env.TELEGRAM_BOT_TOKEN, {
            userStates,
            // Internal call: never fetch the public, password-protected dashboard.
            apiFetch: (url, options) => this.alertsApi(new Request(url, options), update.update_id),
        });
        await bot.init();
        await bot.handleUpdate(update);
        await this.storage.put({
            telegramStates: [...userStates],
            telegramUpdates: [...completed.slice(-99), update.update_id],
        });
        return json({ ok: true });
    }
}
