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
            // Compare hosts, not full origins: reverse proxies terminate TLS, so the
            // worker may see http while the browser origin is https — same site still.
            const crossOrigin = origin && (() => {
                try {
                    return new URL(origin).host !== url.host;
                } catch {
                    return true;
                }
            })();
            if (crossOrigin || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
                return json({ error: 'Cross-origin requests are not allowed' }, 403);
            }
        }
        if (url.pathname === '/api/alerts' || url.pathname.startsWith('/api/alerts/') ||
            url.pathname === '/api/triggered' || url.pathname === '/api/devices' || url.pathname === '/api/test-alert' ||
            url.pathname === '/api/alert-card' || url.pathname === '/api/alert-image' ||
            url.pathname.startsWith('/api/ai/')) {
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
        // Proxy TradingView calendar events — same as Node server, avoids CORS and lets news show NEXT week
        if (url.pathname === '/api/events') {
            if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
            try {
                const from = url.searchParams.get('from') || new Date().toISOString();
                const to = url.searchParams.get('to') || new Date(Date.now() + 7*24*3600*1000).toISOString();
                const countries = url.searchParams.get('countries') || 'AR,AU,BR,CA,CN,FR,DE,IN,ID,IT,JP,KR,MX,RU,SA,ZA,TR,GB,US,ERL';
                const minImportance = url.searchParams.get('minImportance') || '0';
                const upstream = `https://chartevents-reuters.tradingview.com/events?minImportance=${encodeURIComponent(minImportance)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&countries=${encodeURIComponent(countries)}`;
                const r = await fetch(upstream, { headers: { Accept: 'application/json', 'User-Agent': 'Price-Alert/1.0' }, signal: AbortSignal.timeout(15_000) });
                if (!r.ok) throw new Error(`upstream ${r.status}`);
                const data = await r.json();
                return json(data);
            } catch (e) {
                return json({ error: 'Could not fetch events', detail: String(e?.message || e).slice(0, 300) }, 502);
            }
        }
        // Journal is local-only (browser localStorage + compressed base64 JSON). No Drive endpoints.
        if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/internal/')) {
            return json({ error: 'Not found' }, 404);
        }
        if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);
        // Only the Public/ folder is uploaded as assets, so .env, data, and backend code stay private.
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
