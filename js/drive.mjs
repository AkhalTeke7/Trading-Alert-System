import { createPrivateKey, createSign } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let _diag = { checkedAt: null };

function envGet(env, key){
  if(env && typeof env[key]==='string') return env[key];
  if(env && env[key]!=null) return String(env[key]);
  try{ if(typeof process!=='undefined' && process.env && process.env[key]) return process.env[key]; }catch{}
  return '';
}
function resolveEnv(env){
  // Cloudflare Worker passes `env` bindings; Node server passes undefined -> use process.env
  return env || null;
}

function findEnvFile(){
  try{
    const candidates=[
      resolve(process.cwd(), '.env'),
      resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env'),
      resolve(dirname(fileURLToPath(import.meta.url)), '.env'),
    ];
    for(const p of candidates) if(existsSync(p)) return p;
  }catch{}
  return null;
}
function extractJsonFromEnvText(text, key){
  const idx=text.indexOf(key+'=');
  if(idx===-1) return null;
  let start=idx+key.length+1;
  while(start<text.length && (text[start]===' '||text[start]==='\t')) start++;
  if(start>=text.length) return null;
  const ch=text[start];
  if(ch==='"' || ch==="'"){
    const q=ch;
    let end=start+1;
    while(end<text.length){
      if(text[end]===q && text[end-1]!=='\\') break;
      end++;
    }
    if(end<text.length) return text.slice(start+1, end);
    return text.slice(start+1).trim();
  }
  if(ch==='{'){
    let depth=0, end=start;
    for(; end<text.length; end++){
      if(text[end]==='{') depth++;
      else if(text[end]==='}'){ depth--; if(depth===0){ end++; break; } }
    }
    return text.slice(start, end);
  }
  let end=text.indexOf('\n', start);
  if(end===-1) end=text.length;
  return text.slice(start, end).trim();
}
function tryReadEnvFileDirect(){
  try{
    const fp=findEnvFile();
    if(!fp) return null;
    const txt=readFileSync(fp, 'utf8');
    let v=extractJsonFromEnvText(txt, 'GOOGLE_DRIVE_SERVICE_ACCOUNT');
    if(!v) v=extractJsonFromEnvText(txt, 'GOOGLE_DRIVE_CREDENTIALS');
    if(v && v.length>10) { _diag.envFile=fp; return v.trim(); }
  }catch(e){ _diag.envFileErr=e?.message; }
  return null;
}

function getServiceAccountRaw(env){
  let raw = (envGet(env,'GOOGLE_DRIVE_SERVICE_ACCOUNT') || envGet(env,'GOOGLE_DRIVE_CREDENTIALS') || '').trim();
  const file = (envGet(env,'GOOGLE_DRIVE_KEY_FILE') || '').trim();
  if (!raw && file && existsSync(file)) {
    try { raw = readFileSync(file, 'utf8').trim(); } catch (e) { _diag.fileErr = e.message; }
  }
  if(raw && raw.length<30 && raw.trim().startsWith('{')){
    const direct=tryReadEnvFileDirect();
    if(direct && direct.length>raw.length){ raw=direct; _diag.recoveredFromFile=true; }
  }
  if(!raw){
    const direct=tryReadEnvFileDirect();
    if(direct) { raw=direct; _diag.recoveredFromFile=true; }
  }
  return raw;
}

function stripOuterQuotes(s){
  let r=s.trim();
  if(r.charCodeAt(0)===0xFEFF) r=r.slice(1);
  let guard=0;
  while(guard<4 && r.length>=2 && ((r.startsWith('"')&&r.endsWith('"'))||(r.startsWith("'")&&r.endsWith("'")))){
    r=r.slice(1,-1).trim(); guard++;
  }
  return r;
}

function tryParseVariants(raw){
  const variants=[];
  variants.push(raw);
  if(!raw.trim().startsWith('{')){
    try{
      const dec=Buffer.from(raw.trim(), 'base64').toString('utf8').trim();
      if(dec.startsWith('{')) variants.push(dec);
    }catch{}
  }
  variants.push(raw.replace(/""/g,'"'));
  return variants;
}

function getServiceAccount(env){
  let raw = getServiceAccountRaw(env);
  _diag.hasEnv = !!raw;
  _diag.rawLen = raw ? raw.length : 0;
  if (!raw) { _diag.error = 'empty — no GOOGLE_DRIVE_SERVICE_ACCOUNT / KEY_FILE found. Set it in .env and restart server (or set GOOGLE_DRIVE_KEY_FILE=/abs/path/to/key.json)'; _diag.rawHead=null; return null; }
  raw = stripOuterQuotes(raw);
  if(raw.length<30 && raw.startsWith('{') && !raw.includes('client_email')){
    const direct=tryReadEnvFileDirect();
    if(direct && direct.length>raw.length){ raw=stripOuterQuotes(direct); _diag.recoveredFromFile=true; _diag.rawLen=raw.length; }
  }
  const candidates = tryParseVariants(raw);
  let lastErr='';
  for(const cand of candidates){
    try{
      const parsed=JSON.parse(cand);
      _diag.hasClientEmail = !!parsed.client_email;
      _diag.hasPrivateKey = !!parsed.private_key;
      _diag.clientEmail = parsed.client_email ? parsed.client_email.slice(0, 6) + '***' : null;
      _diag.error = null; _diag.rawHead = null;
      if (!parsed.client_email || !parsed.private_key) {
        _diag.error = `missing ${!parsed.client_email ? 'client_email' : ''} ${!parsed.private_key ? 'private_key' : ''}`.trim();
        return null;
      }
      if(cand!==raw) _diag.recoveredVariant=true;
      return parsed;
    }catch(e){ lastErr=e.message; }
  }
  _diag.error = 'JSON parse: ' + lastErr.slice(0, 220);
  _diag.rawHead = JSON.stringify(raw.slice(0, 200));
  _diag.rawHeadLen = raw.slice(0,200).length;
  _diag.hint = raw.length<50
    ? 'Value looks truncated (len '+raw.length+'). If you pasted pretty-printed JSON with line breaks, minify to ONE line in .env: GOOGLE_DRIVE_SERVICE_ACCOUNT={...} . Or use GOOGLE_DRIVE_KEY_FILE=C:\\path\\to\\key.json (more reliable).'
    : 'Paste the service-account JSON as ONE line, or base64-encode it, or point GOOGLE_DRIVE_KEY_FILE to the downloaded .json file. Then restart npm start.';
  try{ console.warn('[drive] bad GOOGLE_DRIVE_SERVICE_ACCOUNT json', lastErr, 'rawLen', raw.length, 'head', raw.slice(0,80)); }catch{}
  return null;
}

export function getDriveDiagnostics(env){
  getServiceAccount(resolveEnv(env));
  return { ..._diag, at: new Date().toISOString() };
}

let cachedToken = null;
let tokenExp = 0;
let cachedEmail = null;

function pemToArrayBuffer(pem){
  const b64 = pem.replace(/-----BEGIN[^-----]*-----/g,'').replace(/-----END[^-----]*-----/g,'').replace(/\s+/g,'');
  const bin = Buffer.from(b64, 'base64');
  return bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
}

async function signJwt(header, payload, privateKey){
  const h = Buffer.from(JSON.stringify(header)).toString('base64url');
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const data = `${h}.${p}`;
  // Try Node crypto first (fast, sync); fallback to WebCrypto for Workers
  try{
    const key = privateKey.includes('\\n') ? privateKey.replace(/\\n/g, '\n') : privateKey;
    const signer = createSign('RSA-SHA256');
    signer.update(data);
    signer.end();
    const sig = signer.sign({ key: createPrivateKey({ key, format: 'pem' }) }, 'base64url');
    return `${data}.${sig}`;
  }catch(_e){
    // WebCrypto path (Cloudflare Workers / edge)
    const subtle = (globalThis.crypto && globalThis.crypto.subtle) ? globalThis.crypto.subtle : null;
    if(!subtle) throw _e;
    const keyData = pemToArrayBuffer(privateKey.includes('\\n') ? privateKey.replace(/\\n/g,'\n') : privateKey);
    const cryptoKey = await subtle.importKey('pkcs8', keyData, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['sign']);
    const sigBuf = await subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(data));
    const sigB64url = Buffer.from(sigBuf).toString('base64url');
    return `${data}.${sigB64url}`;
  }
}

export async function getAccessToken(env){
  const e = resolveEnv(env);
  const sa = getServiceAccount(e);
  if (!sa?.client_email || !sa?.private_key) return null;
  if (cachedToken && cachedEmail===sa.client_email && Date.now() < tokenExp - 60_000) return cachedToken;
  const now = Math.floor(Date.now() / 1000);
  const jwt = await signJwt(
    { alg: 'RS256', typ: 'JWT' },
    { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/drive', aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now },
    sa.private_key
  );
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  if (!res.ok) throw new Error(`drive token ${res.status}: ${(await res.text()).slice(0, 600)}`);
  const j = await res.json();
  cachedToken = j.access_token;
  cachedEmail = sa.client_email;
  tokenExp = Date.now() + (j.expires_in || 3600) * 1000;
  return cachedToken;
}

export function isDriveConfigured(env){
  const sa = getServiceAccount(resolveEnv(env));
  return !!(sa?.client_email && sa?.private_key);
}

function sharedDriveId(env){
  const e = resolveEnv(env);
  return (envGet(e,'GOOGLE_DRIVE_SHARED_DRIVE_ID') || envGet(e,'GOOGLE_DRIVE_FOLDER_ID') || '').trim() || null;
}

export async function uploadToDrive(args, env){
  // Back-compat: uploadToDrive({buffer,filename,mimeType}, env) or uploadToDrive({buffer,filename,mimeType,env})
  let e = resolveEnv(env) || resolveEnv(args?.env);
  const { buffer, filename, mimeType } = args || {};
  if(!buffer) throw new Error('Missing buffer');
  const token = await getAccessToken(e);
  if (!token) throw new Error('Drive not configured — ' + (_diag.error || 'set GOOGLE_DRIVE_SERVICE_ACCOUNT'));
  const sid=sharedDriveId(e);
  const meta = sid ? { name: filename, parents: [sid] } : { name: filename };
  const boundary = 'pa_' + Math.random().toString(36).slice(2);
  const metaJson = JSON.stringify(meta);
  const head = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaJson}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`);
  const foot = Buffer.from(`\r\n--${boundary}--`);
  const body = Buffer.concat([head, buffer, foot]);
  const qs = `?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink,webContentLink`;
  const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files${qs}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}`, 'Content-Length': String(body.length) },
    body,
  });
  if (!res.ok) throw new Error(`drive upload ${res.status}: ${(await res.text()).slice(0, 900)}`);
  const file = await res.json();
  try {
    await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/permissions?supportsAllDrives=true`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });
  } catch {}
  return {
    id: file.id,
    name: file.name,
    webViewLink: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
    webContentLink: file.webContentLink || `https://drive.google.com/uc?export=view&id=${file.id}`,
    thumbnailLink: `https://drive.google.com/thumbnail?id=${file.id}&sz=w1200`,
    directLink: `https://drive.google.com/uc?export=view&id=${file.id}`,
  };
}

export function getJournalName(env){ return (envGet(resolveEnv(env),'JOURNAL_DRIVE_FILENAME') || '').trim() || 'price-alert-journal.json'; }
export const JOURNAL_NAME = getJournalName();
export function isQuotaError(msg){ return /storage quota|Service Accounts do not have storage/i.test(String(msg||'')); }
export function getDriveConfigHelp(env){
  return {
    sharedDriveId: sharedDriveId(env),
    hint: 'Service accounts have NO My Drive quota. Create a Shared Drive (drive.google.com → Shared drives → New), add the service account email as Manager, copy its ID from URL (/drive/folders/ID), set GOOGLE_DRIVE_SHARED_DRIVE_ID=ID (wrangler secret put GOOGLE_DRIVE_SHARED_DRIVE_ID). Or keep using Drive-only — quota fix is the Shared Drive.'
  };
}

async function findFileByName(name, env){
  const e = resolveEnv(env);
  const token = await getAccessToken(e);
  if (!token) return null;
  const q = encodeURIComponent(`name='${name.replace(/'/g, "\\'")}' and trashed=false`);
  const sid=sharedDriveId(e);
  const qs = sid
    ? `q=${q}&fields=files(id,name,modifiedTime,size)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=drive&driveId=${sid}`
    : `q=${q}&fields=files(id,name,modifiedTime,size)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const j = await res.json();
  return j.files?.[0] || null;
}

export async function upsertJournalJson(jsonString, env){
  const e = resolveEnv(env);
  const token = await getAccessToken(e);
  if (!token) throw new Error('Drive not configured — ' + (_diag.error || ''));
  const sid=sharedDriveId(e);
  const jname=getJournalName(e);
  const existing = await findFileByName(jname, e);
  if (existing) {
    const qs = `?uploadType=media&supportsAllDrives=true`;
    const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${existing.id}${qs}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: jsonString,
    });
    if (!res.ok) throw new Error(`drive update ${res.status}: ${(await res.text()).slice(0, 700)}`);
    return { id: existing.id, name: jname, updated: true };
  }
  const buf = Buffer.from(jsonString, 'utf8');
  const meta = sid ? { name: jname, mimeType: 'application/json', parents: [sid] } : { name: jname, mimeType: 'application/json' };
  const boundary = 'pa_' + Math.random().toString(36).slice(2);
  const head = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n`);
  const foot = Buffer.from(`\r\n--${boundary}--`);
  const body = Buffer.concat([head, buf, foot]);
  const createQs = `?uploadType=multipart&supportsAllDrives=true&fields=id,name`;
  const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files${createQs}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}`, 'Content-Length': String(body.length) },
    body,
  });
  if (!res.ok) throw new Error(`drive create ${res.status}: ${(await res.text()).slice(0, 1000)}`);
  const file = await res.json();
  try {
    await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/permissions?supportsAllDrives=true`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });
  } catch {}
  return { id: file.id, name: jname, updated: false };
}

export async function getJournalJson(env){
  const e = resolveEnv(env);
  const token = await getAccessToken(e);
  if (!token) throw new Error('Drive not configured — ' + (_diag.error || ''));
  const jname=getJournalName(e);
  const existing = await findFileByName(jname, e);
  if (!existing) return null;
  const qs = `?alt=media&supportsAllDrives=true`;
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${existing.id}${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`drive read ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const text = await res.text();
  return { id: existing.id, name: jname, modifiedTime: existing.modifiedTime, json: text };
}

export async function journalFileInfo(env){
  const e = resolveEnv(env);
  const jname=getJournalName(e);
  const f = await findFileByName(jname, e);
  if (!f) return null;
  return f;
}
