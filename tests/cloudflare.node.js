import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../cloudflare/worker.js';
import { AlertStore } from '../cloudflare/alertStore.js';
import { renderAlertCard } from '../js/alertCard.js';

class MemoryStorage {
    data = new Map();
    async get(key) { return structuredClone(this.data.get(key)); }
    async put(key, value) {
        if (typeof key === 'string') this.data.set(key, structuredClone(value));
        else for (const [k, v] of Object.entries(key)) this.data.set(k, structuredClone(v));
    }
    async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) this.data.delete(key); }
    async list({ prefix }) { return new Map([...this.data].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v)])); }
    async transaction(callback) { return callback(this); }
}

const input = { pair: 'EUR / USD', target: 1.23, targetInputValue: '1.2300', note: 'Test', channel: 'Telegram' };
const request = (path = '/api/alerts', method = 'GET', body) => new Request(`https://alerts.example${path}`, {
    method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
function setup(services = {}, storage = new MemoryStorage(), env = {}) {
    return new AlertStore({ storage }, env, { getPrices: async () => ({ 'FX_IDC:EURUSD': { price: 1.2 } }), ...services });
}
const credentials = { DASHBOARD_USER: 'tester', DASHBOARD_PASSWORD: 'test-only-password' };
function authenticated(path, { method = 'GET', headers = {}, body } = {}) {
    return new Request(`https://alerts.example${path}`, {
        method, body,
        headers: { Authorization: `Basic ${btoa('tester:test-only-password')}`, ...headers },
    });
}

test('dashboard fails closed without credentials and challenges unauthenticated visitors', async () => {
    assert.equal((await worker.fetch(request('/'), {})).status, 503);
    const response = await worker.fetch(request('/api/alerts'), credentials);
    assert.equal(response.status, 401);
    assert.match(response.headers.get('WWW-Authenticate'), /Basic/);
    assert.equal((await worker.fetch(new Request('https://alerts.example/', {
        headers: { Authorization: 'Basic !!!invalid' },
    }), credentials)).status, 401);
});

test('HTTPS same-origin saves work; cross-origin writes are denied', async () => {
    let calls = 0;
    const env = { ...credentials, ALERT_STORE: {
        idFromName: name => name,
        get: () => ({ fetch: async () => { calls++; return Response.json({ saved: true }); } }),
    } };
    const save = origin => authenticated('/api/alerts', { method: 'POST', headers: { Origin: origin }, body: '{}' });
    assert.equal((await worker.fetch(save('https://alerts.example'), env)).status, 200);
    assert.equal((await worker.fetch(save('https://evil.example'), env)).status, 403);
    assert.equal(calls, 1);
    assert.equal((await worker.fetch(authenticated('/internal/check', { method: 'POST' }), env)).status, 404);
});

test('authenticated root serves the unchanged main page through the asset binding', async () => {
    const env = { ...credentials, ASSETS: { fetch: async req => {
        assert.equal(new URL(req.url).pathname, '/main.html');
        return new Response('<h1>Price-Alert</h1>');
    } } };
    const response = await worker.fetch(authenticated('/'), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.match(await response.text(), /Price-Alert/);
});

test('webhook requires its own secret and does not require dashboard credentials', async () => {
    let forwarded;
    const env = { TELEGRAM_WEBHOOK_SECRET: 'test-secret', TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_ALLOWED_USER_IDS: '7',
        ALERT_STORE: { idFromName: name => name, get: () => ({ fetch: async req => {
            forwarded = req; return Response.json({ ok: true });
        } }) },
    };
    assert.equal((await worker.fetch(request('/api/telegram/webhook', 'POST', {}), env)).status, 403);
    const req = request('/api/telegram/webhook', 'POST', { update_id: 1 });
    req.headers.set('X-Telegram-Bot-Api-Secret-Token', 'test-secret');
    assert.equal((await worker.fetch(req, env)).status, 200);
    assert.equal(new URL(forwarded.url).pathname, '/internal/telegram');
    assert.deepEqual(await forwarded.json(), { update_id: 1 });
});

test('alerts persist across object restarts; modify preserves identity; delete removes them', async () => {
    const storage = new MemoryStorage();
    let store = setup({}, storage);
    const created = await store.fetch(request('/api/alerts', 'POST', input));
    assert.equal(created.status, 201);
    const alert = await created.json();
    assert.equal(alert.targetPrecision, 4);
    assert.equal(alert.state, 'up');
    store = setup({}, storage);
    assert.equal((await (await store.fetch(request())).json()).length, 1);
    const updated = await (await store.fetch(request(`/api/alerts/${alert.id}`, 'PUT', { ...input, target: 1.1, targetInputValue: '1.100' }))).json();
    assert.equal(updated.id, alert.id);
    assert.equal(updated.createdAt, alert.createdAt);
    assert.equal(updated.state, 'down');
    assert.equal(updated.targetPrecision, 3);
    assert.equal((await store.fetch(request(`/api/alerts/${alert.id}`, 'DELETE'))).status, 200);
    assert.deepEqual(await (await store.fetch(request())).json(), []);
    assert.equal((await store.fetch(request(`/api/alerts/${alert.id}`, 'PUT', input))).status, 404);
});

test('validation and body limits reject bad writes without fetching prices', async () => {
    const store = setup({ getPrices: () => { throw new Error('should not run'); } });
    for (const body of [{ ...input, target: -1 }, { ...input, channel: 'Email' }, { ...input, note: 'a'.repeat(501) }]) {
        assert.equal((await store.fetch(request('/api/alerts', 'POST', body))).status, 400);
    }
    const oversized = await store.fetch(request('/api/alerts', 'POST', { note: 'a'.repeat(10_001) }));
    assert.equal(oversized.status, 400);
    assert.match((await oversized.json()).error, /too large/);
    const invalidJson = new Request('https://alerts.example/api/alerts', { method: 'POST', body: '{' });
    assert.equal((await store.fetch(invalidJson)).status, 400);
});

test('concurrent saves and cron invocations are serialized; crossed alert is sent once', async () => {
    let price = 1.2;
    let sent = 0;
    const store = setup({
        getPrices: async () => ({ 'FX_IDC:EURUSD': { price } }),
        sendAlert: async (alert, env, delivered) => { sent++; await delivered('Telegram'); },
    });
    await Promise.all([store.fetch(request('/api/alerts', 'POST', input)), store.fetch(request('/api/alerts', 'POST', input))]);
    assert.equal((await (await store.fetch(request())).json()).length, 2);
    await store.fetch(request('/internal/check', 'POST'));
    assert.equal(sent, 0);
    price = 1.24;
    await Promise.all([store.fetch(request('/internal/check', 'POST')), store.fetch(request('/internal/check', 'POST'))]);
    assert.equal(sent, 2);
    assert.deepEqual(await (await store.fetch(request())).json(), []);
});

test('partial channel failures stay durable and are retried after price reverses', async t => {
    t.mock.method(console, 'error', () => {});
    const storage = new MemoryStorage();
    let price = 1.2;
    const services = { getPrices: async () => ({ 'FX_IDC:EURUSD': { price } }),
        sendAlert: async (alert, env, delivered) => { await delivered('Bale'); throw new Error('Telegram unavailable'); },
    };
    let store = setup(services, storage);
    await store.fetch(request('/api/alerts', 'POST', { ...input, channel: 'Both' }));
    price = 1.24;
    await store.fetch(request('/internal/check', 'POST'));
    const [pending] = await (await store.fetch(request())).json();
    assert.equal(pending.triggered, true);
    assert.deepEqual(pending.deliveredChannels, ['Bale']);
    price = 1.1;
    store = setup({ ...services, sendAlert: async (alert, env, delivered) => {
        assert.deepEqual(alert.deliveredChannels, ['Bale']);
        await delivered('Telegram');
    } }, storage);
    await store.fetch(request('/internal/check', 'POST'));
    assert.deepEqual(await (await store.fetch(request())).json(), []);
});

test('Telegram conversation state survives restarts and duplicate updates are ignored', async () => {
    const storage = new MemoryStorage();
    let handled = 0;
    const services = { createTelegramBot: (token, { userStates }) => ({
        init: async () => {},
        handleUpdate: async update => {
            handled++;
            if (update.update_id === 1) userStates.set(7, { step: 'target', pair: 'EUR / USD' });
            else assert.equal(userStates.get(7).step, 'target');
        },
    }) };
    const env = { TELEGRAM_ALLOWED_USER_IDS: '7' };
    for (const id of [1, 1, 2]) {
        const store = setup(services, storage, env);
        await store.fetch(request('/internal/telegram', 'POST', { update_id: id, message: { from: { id: 7 } } }));
    }
    await setup(services, storage, env).fetch(request('/internal/telegram', 'POST', { update_id: 3, message: { from: { id: 9 } } }));
    assert.equal(handled, 2);
});

test('Telegram save is idempotent if a reply fails and Telegram retries the update', async t => {
    t.mock.method(console, 'error', () => {});
    const storage = new MemoryStorage();
    let attempts = 0;
    const services = { createTelegramBot: (token, { apiFetch }) => ({
        init: async () => {},
        handleUpdate: async () => {
            await apiFetch('https://internal/api/alerts', { method: 'POST', body: JSON.stringify(input) });
            if (++attempts === 1) throw new Error('Reply failed');
        },
    }) };
    const env = { TELEGRAM_ALLOWED_USER_IDS: '7' };
    for (const status of [502, 200]) {
        const response = await setup(services, storage, env).fetch(request('/internal/telegram', 'POST', { update_id: 9, message: { from: { id: 7 } } }));
        assert.equal(response.status, status);
    }
    assert.equal((await setup({}, storage).getAlerts()).length, 1);
});

test('scheduled handler invokes the private check and reports failed runs', async () => {
    let waiting;
    const env = { ALERT_STORE: { idFromName: name => name, get: () => ({ fetch: async (url, options) => {
        assert.equal(new URL(url).pathname, '/internal/check');
        assert.equal(options.method, 'POST');
        return new Response('{}');
    } }) } };
    await worker.scheduled({}, env, { waitUntil: promise => { waiting = promise; } });
    await waiting;
    env.ALERT_STORE.get = () => ({ fetch: async () => new Response('{}', { status: 502 }) });
    await worker.scheduled({}, env, { waitUntil: promise => { waiting = promise; } });
    await assert.rejects(waiting, /Scheduled alert check failed/);
});

test('notification template preserves the card and escapes user-provided HTML', () => {
    const html = renderAlertCard('EUR / USD', '1.2300', '<script>alert(1)</script>');
    assert.match(html, /class="alert-card"/);
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>/);
});
