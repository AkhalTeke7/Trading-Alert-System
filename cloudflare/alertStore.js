import getPrices from '../js/fetchPrice.js';
import { pairToSymbol, getAlertInput, makeAlert, truncateToPrecision } from '../js/alertModel.js';
import { createTelegramBot } from '../js/telegramBot.js';
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
            return await this.alertsApi(request);
        } catch {
            // Upstream exception messages can include credential-bearing URLs.
            console.error('Alert store operation failed');
            return json({ error: 'Could not complete the alert operation. Check your bindings and upstream services.' }, 502);
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
            try {
                await this.notify(alert, this.env, async channel => {
                    alert.deliveredChannels = [...new Set([...(alert.deliveredChannels || []), channel])];
                    await this.saveAlerts(alerts);
                });
                alerts = alerts.filter(item => item.id !== alert.id);
                await this.saveAlerts(alerts);
            } catch {
                console.error(`Notification failed for alert ${alert.id}; retained for retry`);
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
