import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import getPrices from './fetchPrice.js';
import { alertSender } from './telegram.mjs';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const allowedPairs = new Set([
    'Gold / USD',
    'EUR / USD',
    'BTC / USD',
    'GBP / USD',
]);
const contentTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
};

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
    const filePath = resolve(projectRoot, relativePath);
    if (!filePath.startsWith(`${projectRoot}${sep}`)) {
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
    try {
        pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
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

    if (request.method === 'POST' && pathname === '/api/alerts/send') {
        if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) {
            sendJson(response, 403, { error: 'Cross-origin requests are not allowed' });
            return;
        }

        try {
            const body = await readJson(request);
            const pair = String(body?.pair || '');
            const target = Number(body?.target);
            const note = String(body?.note || '');
            const channel = String(body?.channel || 'Bale');

            if (!allowedPairs.has(pair) || !Number.isFinite(target) || target <= 0 || note.length > 500) {
                sendJson(response, 400, { error: 'Invalid alert details' });
                return;
            }
            if (!['Bale', 'Telegram', 'Both'].includes(channel)) {
                sendJson(response, 400, { error: 'Invalid alert channel' });
                return;
            }

            await alertSender(pair, target, note, channel);
            sendJson(response, 200, { sent: true });
        } catch (error) {
            console.error('Could not send alert:', error);
            sendJson(response, 500, { error: error.message || 'Could not send alert' });
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