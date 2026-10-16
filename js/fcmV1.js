// FCM HTTP v1 sender using a Firebase service-account key. No npm dependencies:
// only WebCrypto (crypto.subtle) + fetch, so this runs on Node 22 AND Cloudflare Workers.
//
// Env needed:
//   FCM_SERVICE_ACCOUNT = full service-account JSON (Firebase Console → Project
//     settings → Service accounts → Generate new private key). Never commit it.
//   FCM_PROJECT_ID    = optional; defaults to the JSON's project_id.

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let cachedToken = null;

function base64url(input) {
    const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function readEnv(env, name) {
    if (env && env[name]) return env[name];
    try {
        if (typeof process !== 'undefined' && process.env) return process.env[name] || '';
    } catch { /* Workers have no process */ }
    return '';
}

function extractJsonFromEnvText(text, key){
    const idx=text.indexOf(key+'=');
    if(idx===-1) return null;
    let s=idx+key.length+1;
    while(s<text.length && (text[s]===' '||text[s]==='\t')) s++;
    if(s>=text.length) return null;
    const ch=text[s];
    if(ch==='"' || ch==="'"){
        const q=ch; let e=s+1, esc=false;
        while(e<text.length){ const c=text[e]; if(esc){esc=false;e++;continue;} if(c==='\\'){esc=true;e++;continue;} if(c===q) break; e++; }
        if(e<text.length) return text.slice(s+1,e);
        return text.slice(s+1).trim();
    }
    if(ch==='{'){
        let d=0,e=s,inStr=false,esc=false,sc='';
        for(;e<text.length;e++){
            const c=text[e];
            if(inStr){ if(esc){esc=false;continue;} if(c==='\\'){esc=true;continue;} if(c===sc) inStr=false; continue; }
            else { if(c==='"'||c==="'"){inStr=true;sc=c;continue;} if(c==='{') d++; else if(c==='}'){d--; if(d===0){e++;break;}} }
        }
        return text.slice(s,e);
    }
    let e=text.indexOf('\n',s); if(e===-1) e=text.length;
    return text.slice(s,e).trim();
}
function tryReadFcmDirect(){
    try{
        const cands=[];
        try{ cands.push(resolve(process.cwd(), '.env')); }catch{}
        try{ cands.push(resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env')); }catch{}
        try{ cands.push(resolve(dirname(fileURLToPath(import.meta.url)), '.env')); }catch{}
        for(const p of cands){
            try{
                if(!existsSync(p)) continue;
                const txt=readFileSync(p,'utf8');
                const v=extractJsonFromEnvText(txt,'FCM_SERVICE_ACCOUNT');
                if(v && v.length>30) return v.trim();
            }catch{}
        }
    }catch{}
    return null;
}

export function getServiceAccount(env) {
    let raw = readEnv(env, 'FCM_SERVICE_ACCOUNT');
    // loadEnvFile truncates pretty-printed multi-line JSON (Unterminated string at 1020) → raw is incomplete
    const looksTruncated = raw && raw.trim().startsWith('{') && !raw.includes('client_email');
    if(!raw || looksTruncated){
        const direct=tryReadFcmDirect();
        if(direct && direct.length>(raw||'').length) raw=direct;
    }
    if (!raw) return null;
    // one more fallback if JSON still won't parse (e.g. Unterminated string mid-key)
    try {
        const parsed = JSON.parse(raw);
        if (!parsed.client_email || !parsed.private_key) return null;
        return {
            clientEmail: parsed.client_email,
            privateKey: parsed.private_key,
            projectId: readEnv(env, 'FCM_PROJECT_ID') || parsed.project_id || '',
        };
    } catch {
        const direct=tryReadFcmDirect();
        if(direct && direct!==raw){
            try{
                const parsed=JSON.parse(direct);
                if(parsed.client_email && parsed.private_key) return { clientEmail: parsed.client_email, privateKey: parsed.private_key, projectId: readEnv(env,'FCM_PROJECT_ID')||parsed.project_id||'' };
            }catch{}
        }
        return null;
    }
}

async function getAccessToken(serviceAccount) {
    const now = Math.floor(Date.now() / 1000);
    if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.token;
    const unsigned = [
        base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })),
        base64url(JSON.stringify({
            iss: serviceAccount.clientEmail,
            scope: 'https://www.googleapis.com/auth/firebase.messaging',
            aud: 'https://oauth2.googleapis.com/token',
            iat: now,
            exp: now + 3600,
        })),
    ].join('.');
    const pem = serviceAccount.privateKey.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    const keyBytes = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey(
        'pkcs8', keyBytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
    );
    const signature = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned),
    );
    const jwt = `${unsigned}.${base64url(new Uint8Array(signature))}`;
    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(jwt)}`,
        signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error('FCM auth failed');
    const { access_token: accessToken } = await response.json();
    if (!accessToken) throw new Error('FCM auth returned no token');
    cachedToken = { token: accessToken, exp: now + 3500 };
    return accessToken;
}

export async function sendFcmV1(serviceAccount, tokens, { title, body, data = {} }) {
    if (!serviceAccount?.projectId) throw new Error('FCM project ID is missing');
    const accessToken = await getAccessToken(serviceAccount);
    const stringData = Object.fromEntries(
        Object.entries(data).map(([key, value]) => [key, String(value ?? '')]),
    );
    const results = await Promise.all(tokens.map(async pushToken => {
        try {
            // Data-only message: guarantees onMessageReceived() fires (and the
            // alarm sounds) even when the app is in the background. A
            // notification payload would be swallowed by the system tray.
            const response = await fetch(
                `https://fcm.googleapis.com/v1/projects/${serviceAccount.projectId}/messages:send`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
                    body: JSON.stringify({
                        message: {
                            token: pushToken,
                            data: { title, body, ...stringData },
                            android: { priority: 'HIGH', direct_boot_ok: true },
                        },
                    }),
                    signal: AbortSignal.timeout(15_000),
                },
            );
            if (!response.ok) throw new Error(`FCM v1 ${response.status}`);
            return true;
        } catch (error) {
            console.error('FCM v1 push failed for a device');
            return false;
        }
    }));
    return results.some(Boolean);
}
