import getPrices from '../js/fetchPrice.js';
import { dashboardAuth, json, sameSecret } from './http.js';
export { AlertStore } from './alertStore.js';

function store(env) {
    return env.ALERT_STORE.get(env.ALERT_STORE.idFromName('personal-dashboard'));
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname === '/api/telegram/webhook') {
            if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
            if (!env.TELEGRAM_WEBHOOK_SECRET || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_ALLOWED_USER_IDS) {
                return json({ error: 'Telegram webhook is not configured' }, 503);
            }
            if (!await sameSecret(request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '', env.TELEGRAM_WEBHOOK_SECRET)) {
                return json({ error: 'Forbidden' }, 403);
            }
            return store(env).fetch(new Request('https://internal/internal/telegram', request));
        }

        // Fail closed; authentication protects assets as well as the shared API.
        const unauthorized = await dashboardAuth(request, env);
        if (unauthorized) return unauthorized;
        if (!['GET', 'HEAD'].includes(request.method)) {
            const origin = request.headers.get('Origin');
            if ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
                return json({ error: 'Cross-origin requests are not allowed' }, 403);
            }
        }
        if (url.pathname === '/api/alerts' || url.pathname.startsWith('/api/alerts/')) {
            return store(env).fetch(request);
        }
        if (url.pathname === '/api/prices') {
            if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
            try {
                return json(await getPrices());
            } catch {
                return json({ error: 'Could not fetch current prices' }, 502);
            }
        }
        if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/internal/')) {
            return json({ error: 'Not found' }, 404);
        }
        if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);
        // A dedicated allowlisted asset build excludes .env, data, and backend code.
        if (url.pathname === '/') url.pathname = '/main.html';
        const response = await env.ASSETS.fetch(new Request(url, request));
        const headers = new Headers(response.headers);
        headers.set('Cache-Control', 'private, no-store');
        headers.set('X-Content-Type-Options', 'nosniff');
        headers.set('Referrer-Policy', 'same-origin');
        return new Response(response.body, { status: response.status, headers });
    },

    async scheduled(controller, env, ctx) {
        ctx.waitUntil((async () => {
            const response = await store(env).fetch('https://internal/internal/check', { method: 'POST' });
            if (!response.ok) throw new Error('Scheduled alert check failed');
        })());
    },
};
