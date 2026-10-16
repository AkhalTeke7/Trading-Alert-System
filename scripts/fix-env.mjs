#!/usr/bin/env node
/**
 * Minifies pretty-printed JSON values in .env so Node's loadEnvFile doesn't truncate them.
 * Fixes GOOGLE_DRIVE_SERVICE_ACCOUNT / FCM_SERVICE_ACCOUNT that were pasted multi-line.
 * Safe: only touches keys that look like JSON (value starts with { spanning multiple lines).
 * Run: node scripts/fix-env.mjs  [--dry-run]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname ? import.meta.dirname : '.', '..');
const envPath = resolve(ROOT, '.env');
const dry = process.argv.includes('--dry-run') || process.argv.includes('--check');

function extractJsonValue(text, key){
  const idx=text.indexOf(key+'=');
  if(idx===-1) return null;
  let s=idx+key.length+1;
  while(s<text.length && (text[s]===' '||text[s]==='\t')) s++;
  if(text[s]!=='{') return null;
  let depth=0, end=s, inStr=false, esc=false, sc='';
  for(; end<text.length; end++){
    const c=text[end];
    if(inStr){
      if(esc){ esc=false; continue; }
      if(c==='\\'){ esc=true; continue; }
      if(c===sc) inStr=false;
      continue;
    } else {
      if(c==='"' || c==="'"){ inStr=true; sc=c; continue; }
      if(c==='{') depth++;
      else if(c==='}'){ depth--; if(depth===0){ end++; break; } }
    }
  }
  if(depth!==0) return null;
  return { start: s, end, raw: text.slice(s,end), idx, keyLen: key.length };
}

let txt;
try{ txt=readFileSync(envPath,'utf8'); }catch{ console.error('.env not found at',envPath); process.exit(1); }

const keys=['GOOGLE_DRIVE_SERVICE_ACCOUNT','GOOGLE_DRIVE_CREDENTIALS','FCM_SERVICE_ACCOUNT'];
let changed=false;
for(const k of keys){
  const hit=extractJsonValue(txt,k);
  if(!hit) continue;
  // pretty-printed if raw contains \n or \r
  if(!hit.raw.includes('\n') && !hit.raw.includes('\r')) continue;
  try{ JSON.parse(hit.raw); }catch(e){
    console.warn(`skip ${k}: not valid JSON — ${e.message.slice(0,120)}`);
    continue;
  }
  // minify: parse then re-stringify (preserves \n inside private_key as \n literals)
  const obj=JSON.parse(hit.raw);
  const minified=JSON.stringify(obj);
  // replace in text
  txt = txt.slice(0, hit.start) + minified + txt.slice(hit.end);
  console.log(`minified ${k}: ${hit.raw.length} → ${minified.length} chars`);
  changed=true;
}

if(!changed){
  console.log('No pretty-printed JSON env values to fix.');
  process.exit(0);
}
if(dry){
  console.log('dry-run — not writing. Remove --dry-run to apply.');
  process.exit(0);
}
writeFileSync(envPath, txt, 'utf8');
console.log('wrote', envPath);
console.log('Restart the server: npm start  (or kill and rerun)');
