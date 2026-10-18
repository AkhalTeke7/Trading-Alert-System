export function json(value, status = 200, headers = {}) {
    return Response.json(value, {
        status,
        headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
    });
}

export async function readJson(request, limit = 10_000) {
    const reader = request.body?.getReader();
    if (!reader) throw new Error('Invalid JSON');
    const chunks = [];
    let size = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
            await reader.cancel();
            throw new Error('Request body is too large');
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    try {
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
        throw new Error('Invalid JSON');
    }
}

// Compare hashes to avoid exposing credential lengths/content through an early return.
export async function sameSecret(a, b) {
    const hash = value => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    const [left, right] = await Promise.all([hash(a), hash(b)]);
    const x = new Uint8Array(left);
    const y = new Uint8Array(right);
    let difference = 0;
    for (let i = 0; i < x.length; i++) difference |= x[i] ^ y[i];
    return difference === 0;
}

const SESSION_COOKIE = 'pa_session';
const SESSION_SECONDS = 365 * 24 * 60 * 60; // 1 year — one-time login (was 12 hours)
const REMEMBER_SECONDS = 365 * 24 * 60 * 60; // 1 year — keep "Remember this device" also 1 year (was 30 days)
const base64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

async function sessionMac(encoded, password) {
    const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(password), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    return base64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encoded)));
}

async function signSession(payload, password) {
    const encoded = base64url(new TextEncoder().encode(JSON.stringify(payload)));
    return `${encoded}.${await sessionMac(encoded, password)}`;
}

async function validSession(request, env) {
    const cookie = (request.headers.get('Cookie') || '').split(';').map(value => value.trim())
        .find(value => value.startsWith(`${SESSION_COOKIE}=`));
    if (!cookie) return false;
    const token = cookie.slice(SESSION_COOKIE.length + 1);
    const separator = token.lastIndexOf('.');
    if (separator < 1 || !env.DASHBOARD_USER || !env.DASHBOARD_PASSWORD) return false;
    const encoded = token.slice(0, separator);
    const supplied = token.slice(separator + 1);
    const signature = await sessionMac(encoded, env.DASHBOARD_PASSWORD).catch(() => '');
    if (!await sameSecret(supplied, signature)) return false;
    try {
        const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - encoded.length % 4) % 4);
        const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(normalized), char => char.charCodeAt(0))));
        return payload.username === env.DASHBOARD_USER && Number.isFinite(payload.expiresAt) && payload.expiresAt > Date.now();
    } catch {
        return false;
    }
}

export async function createDashboardSession(request, env, remember = false) {
    const maxAge = remember ? REMEMBER_SECONDS : SESSION_SECONDS;
    const token = await signSession({ username: env.DASHBOARD_USER, expiresAt: Date.now() + maxAge }, env.DASHBOARD_PASSWORD);
    const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
    return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearDashboardSession(request) {
    const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
    return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export async function dashboardAuth(request, env) {
    if (!env.DASHBOARD_USER || !env.DASHBOARD_PASSWORD) {
        return json({ error: 'Configure the dashboard credentials before using this deployment.' }, 503);
    }
    if (await validSession(request, env)) return null;

    let credentials = '';
    const authorization = request.headers.get('Authorization') || '';
    if (authorization.startsWith('Basic ')) {
        try {
            credentials = new TextDecoder().decode(Uint8Array.from(atob(authorization.slice(6)), c => c.charCodeAt(0)));
        } catch { /* Malformed credentials are unauthorized. */ }
    }
    if (!await sameSecret(credentials, `${env.DASHBOARD_USER}:${env.DASHBOARD_PASSWORD}`)) {
        return json({ error: 'Authentication required' }, 401, {
            'WWW-Authenticate': 'Basic realm="Price Alert", charset="UTF-8"',
        });
    }
    return null;
}

export function crossOriginWrite(request, url) {
    const origin = request.headers.get('Origin');
    if (origin) {
        try {
            if (new URL(origin).host !== url.host) return true;
        } catch {
            return true;
        }
    }
    return request.headers.get('Sec-Fetch-Site') === 'cross-site';
}
