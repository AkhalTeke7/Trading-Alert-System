import getPrices from '../js/fetchPrice.js';
import { clearDashboardSession, createDashboardSession, crossOriginWrite, dashboardAuth, json, readJson, sameSecret } from './http.js';
export { AlertStore } from './alertStore.js';

function store(env) {
    return env.ALERT_STORE.get(env.ALERT_STORE.idFromName('personal-dashboard'));
}

function loginAsset(pathname) {
    return pathname === '/login.html' || pathname === '/css/login.css' || pathname === '/js/login.js' || pathname === '/asset/bullish-cow.jpg';
}

function safeNextUrl(requested, currentUrl) {
    try {
        const candidate = new URL(requested || '/', currentUrl);
        return candidate.origin === currentUrl.origin && candidate.pathname !== '/login.html'
            ? candidate
            : new URL('/', currentUrl);
    } catch {
        return new URL('/', currentUrl);
    }
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

        if (url.pathname === '/api/login') {
            if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
            if (!env.DASHBOARD_USER || !env.DASHBOARD_PASSWORD) {
                return json({ error: 'Configure dashboard credentials before signing in.' }, 503);
            }
            if (crossOriginWrite(request, url)) return json({ error: 'Cross-origin requests are not allowed' }, 403);
            let body;
            try { body = await readJson(request, 4096); } catch { return json({ error: 'Invalid login request' }, 400); }
            const username = typeof body?.username === 'string' ? body.username.trim() : '';
            const password = typeof body?.password === 'string' ? body.password : '';
            if (username.length > 256 || password.length > 1024 ||
                !await sameSecret(`${username}:${password}`, `${env.DASHBOARD_USER}:${env.DASHBOARD_PASSWORD}`)) {
                return json({ error: 'Invalid username or password' }, 401);
            }
            const remember = body?.remember === true;
            const cookie = await createDashboardSession(request, env, remember);
            return json({ authenticated: true }, 200, { 'Set-Cookie': cookie });
        }

        if (url.pathname === '/api/logout') {
            if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
            if (crossOriginWrite(request, url)) return json({ error: 'Cross-origin requests are not allowed' }, 403);
            return json({ authenticated: false }, 200, { 'Set-Cookie': clearDashboardSession(request) });
        }

        // Serve only the sign-in surface before authentication; the dashboard and API remain protected.
        if (loginAsset(url.pathname)) {
            if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);
            if (!env.DASHBOARD_USER || !env.DASHBOARD_PASSWORD) {
                return json({ error: 'Configure the dashboard credentials before using this deployment.' }, 503);
            }
            if (url.pathname === '/login.html' && !await dashboardAuth(request, env)) {
                return Response.redirect(safeNextUrl(url.searchParams.get('next'), url), 302);
            }
            return assetResponse(url, request, env);
        }

        // Fail closed; authentication protects assets as well as the shared API.
        const unauthorized = await dashboardAuth(request, env);
        if (unauthorized) {
            if (unauthorized.status === 503) return unauthorized;
            if (['GET', 'HEAD'].includes(request.method) && !url.pathname.startsWith('/api/')) {
                const next = `${url.pathname}${url.search}`;
                return Response.redirect(new URL(`/login.html?next=${encodeURIComponent(next)}`, url), 302);
            }
            return unauthorized;
        }
        if (!['GET', 'HEAD'].includes(request.method) && crossOriginWrite(request, url)) {
            return json({ error: 'Cross-origin requests are not allowed' }, 403);
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
        // Journal is local-only (browser localStorage + compressed base64 JSON). No Worker secrets needed.
        if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/internal/')) {
            return json({ error: 'Not found' }, 404);
        }
        if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);
        // Only the Public/ folder is uploaded as assets, so .env, data, and backend code stay private.
        return assetResponse(url, request, env);
    },

    async scheduled(controller, env, ctx) {
        ctx.waitUntil((async () => {
            const response = await store(env).fetch('https://internal/internal/check', { method: 'POST' });
            if (!response.ok) throw new Error('Scheduled alert check failed');
        })());
    },
};

async function assetResponse(url, request, env) {
    const assetUrl = new URL(url);
    if (assetUrl.pathname === '/') assetUrl.pathname = '/main.html';
    const response = await env.ASSETS.fetch(new Request(assetUrl, request));
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'private, no-store');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'same-origin');
    return new Response(response.body, { status: response.status, headers });
}
