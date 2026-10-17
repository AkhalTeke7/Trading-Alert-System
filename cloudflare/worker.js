import getPrices from '../js/fetchPrice.js';
import { dashboardAuth, json, sameSecret } from './http.js';
import * as drive from '../js/drive.mjs';
import { getProvider } from '../js/journalProviders.mjs';
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
        // --- Journal — Drive-only (same as Node server, provider via JOURNAL_PROVIDER) ---
        if (url.pathname === '/api/drive/status' && request.method === 'GET'){
            const diag = drive.getDriveDiagnostics(env);
            const conf = drive.isDriveConfigured(env);
            let journal=null;
            if(conf){ try{ journal=await drive.journalFileInfo(env); }catch(e){ diag.journalErr=e?.message; } }
            return json({ configured: conf, diag, journal: journal? { id:journal.id, name:journal.name, modifiedTime:journal.modifiedTime, size:journal.size }: null, journalName: drive.getJournalName(env) });
        }
        if (url.pathname === '/api/drive/diag' && request.method === 'GET'){
            return json(drive.getDriveDiagnostics(env));
        }
        if (url.pathname === '/api/journal/backup'){
            const journal = getProvider(null, env);
            if(!journal.isConfigured(env)) return json({ error:'Drive not configured', help: journal.configHelp(env).hint }, 503);
            if(request.method === 'GET'){
                try{
                    const data=await journal.getJson(env);
                    if(!data) return json({ error:'No backup in Drive yet' }, 404);
                    return new Response(data.json, { headers:{ 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' }});
                }catch(e){ return json({ error:String(e?.message||e) }, 502); }
            }
            if(request.method === 'POST'){
                const ct=request.headers.get('content-type')||'';
                if(!ct.includes('application/json')) return json({ error:'Expected application/json' }, 400);
                let body; try{ body=await request.json(); }catch{ return json({ error:'Invalid JSON' },400); }
                const jsonStr=JSON.stringify(body,null,2);
                if(jsonStr.length>18*1024*1024) return json({ error:'Backup too large (max 18MB)' },413);
                try{
                    const file=await journal.putJson(jsonStr, env);
                    return json({ ok:true, ...file, provider:journal.id }, 201);
                }catch(e){
                    const msg=String(e?.message||'');
                    if(journal.isQuotaError?.(msg)) return json({ error:'Drive quota', driveError:msg.slice(0,600), help: journal.configHelp(env).hint }, 507);
                    return json({ error:msg||'Backup failed' }, 500);
                }
            }
        }
        if (url.pathname === '/api/journal/upload' && request.method === 'POST'){
            const journal = getProvider(null, env);
            if(!journal.isConfigured(env)) return json({ error:'Drive not configured', help: journal.configHelp(env).hint }, 503);
            try{
                const ct=request.headers.get('content-type')||'';
                let buffer, filename='journal.jpg', mimeType='image/jpeg';
                if(ct.includes('application/json')){
                    const body=await request.json();
                    filename=String(body.filename||filename).slice(0,120).replace(/[\\/]/g,'_');
                    mimeType=String(body.mimeType||mimeType).slice(0,120);
                    const data=String(body.data||body.dataUrl||'');
                    const b64=data.includes(',')? data.split(',').pop(): data;
                    if(!b64) throw new Error('Missing image data');
                    const bin=Uint8Array.from(atob(b64), c=>c.charCodeAt(0));
                    buffer=Buffer.from(bin);
                }else{
                    const ab=await request.arrayBuffer();
                    buffer=Buffer.from(ab);
                    filename=String(url.searchParams.get('filename')||filename).slice(0,120);
                    mimeType=(ct.split(';')[0]||mimeType).trim();
                }
                if(!buffer || buffer.length<100) throw new Error('Empty image');
                if(buffer.length>10*1024*1024) throw new Error('Image too large (max 10MB)');
                if(!mimeType.startsWith('image/')) mimeType='image/jpeg';
                const safe=`${Date.now()}_${filename}`;
                const file=await journal.upload({ buffer, filename:safe, mimeType }, env);
                return json({ ...file, provider:journal.id }, 201);
            }catch(e){
                const msg=String(e?.message||'');
                if(drive.isQuotaError(msg)) return json({ error:'Drive quota — add Shared Drive', driveError:msg.slice(0,600), help: drive.getDriveConfigHelp(env).hint }, 507);
                return json({ error:msg||'Upload failed' }, 500);
            }
        }
        if (url.pathname.startsWith('/api/drive/thumb/') && request.method === 'GET'){
            const id=url.pathname.slice('/api/drive/thumb/'.length).trim();
            if(!id || !/^[a-zA-Z0-9_-]{10,}$/.test(id)) return json({ error:'Bad id' },400);
            try{
                const token=await drive.getAccessToken(env);
                if(!token) return json({ error:'Drive not configured' },503);
                const upstream=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, { headers:{ Authorization:`Bearer ${token}` }});
                if(!upstream.ok) return json({ error:`Drive ${upstream.status}` }, upstream.status);
                const ct=upstream.headers.get('content-type')||'image/jpeg';
                return new Response(upstream.body, { headers:{ 'Content-Type':ct, 'Cache-Control':'public, max-age=86400', 'Access-Control-Allow-Origin':'*' }});
            }catch(e){ return json({ error:String(e?.message||e) },502); }
        }
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
