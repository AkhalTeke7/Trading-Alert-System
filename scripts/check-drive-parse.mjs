import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

const envFile = resolve('.env');
if (existsSync(envFile)) loadEnvFile(envFile);
console.log('process.env GOOGLE len', (process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT||'').length, JSON.stringify((process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT||'').slice(0,80)));
console.log('process.env FCM len', (process.env.FCM_SERVICE_ACCOUNT||'').length);

// now import drive.mjs (which has its own recovery)
const m = await import('../js/drive.mjs');
const diag = m.getDriveDiagnostics();
console.log('diag', JSON.stringify(diag,null,2));
console.log('isConfigured', m.isDriveConfigured());

// also raw extract test
const txt = readFileSync('.env','utf8');
function extractNaive(text,key){
  const idx=text.indexOf(key+'=');
  let s=idx+key.length+1;
  while(s<text.length && (text[s]===' '||text[s]==='\t')) s++;
  if(text[s]==='{'){
    let d=0,e=s; for(;e<text.length;e++){ if(text[e]==='{') d++; else if(text[e]==='}'){d--; if(d===0){e++;break;}} }
    return text.slice(s,e);
  }
  return null;
}
const ex = extractNaive(txt,'GOOGLE_DRIVE_SERVICE_ACCOUNT');
console.log('naive extract len', ex?.length, 'parse', (()=>{try{JSON.parse(ex);return'OK'}catch(e){return 'FAIL '+e.message+ ' at '+e.message.match(/\d+/)}} )());
if(ex){
  const pos=1020;
  console.log('around 1020', JSON.stringify(ex.slice(pos-80,pos+80)));
  // dump char codes around 1015-1030
  for(let i=1005;i<1040;i++) console.log(i, JSON.stringify(ex[i]), ex.charCodeAt(i));
}
