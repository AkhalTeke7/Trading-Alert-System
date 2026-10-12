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

export async function dashboardAuth(request, env) {
    if (!env.DASHBOARD_USER || !env.DASHBOARD_PASSWORD) {
        return json({ error: 'Configure the dashboard credentials before using this deployment.' }, 503);
    }
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
