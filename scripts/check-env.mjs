import { readFileSync } from 'node:fs';
const txt = readFileSync('.env','utf8');
const key='GOOGLE_DRIVE_SERVICE_ACCOUNT';
const idx=txt.indexOf(key+'=');
let start=idx+key.length+1;
while(start<txt.length && (txt[start]===' '||txt[start]==='\t')) start++;
console.log('start char', JSON.stringify(txt.slice(start,start+30)), 'code', txt.charCodeAt(start));
if(txt[start]==='{'){
  let depth=0, inStr=false, esc=false, end=start;
  for(; end<txt.length; end++){
    const ch=txt[end];
    if(inStr){
      if(esc){ esc=false; continue; }
      if(ch==='\\'){ esc=true; continue; }
      if(ch==='"'){ inStr=false; }
      continue;
    } else {
      if(ch==='"'){ inStr=true; continue; }
      if(ch==='{') depth++;
      else if(ch==='}'){ depth--; if(depth===0){ end++; break; } }
    }
  }
  const ex=txt.slice(start,end);
  console.log('naive end len',ex.length);
  console.log('depth ended',depth);
  try{ JSON.parse(ex); console.log('JSON.parse OK naive'); }catch(e){ console.log('JSON.parse FAIL naive',e.message); const m=e.message.match(/position (\d+)/); if(m){ const pos=Number(m[1]); console.log('context around fail:', JSON.stringify(ex.slice(Math.max(0,pos-120), pos+120))); console.log('char at pos', JSON.stringify(ex[pos]), 'code', ex.charCodeAt(pos), 'prev', JSON.stringify(ex.slice(pos-5,pos+5))); }}
  // Also try with inStr-aware extraction
  // Show raw slice around 900-1100
  console.log('raw 900-1150', JSON.stringify(ex.slice(900,1150)));
  console.log('raw contains literal newline inside string?', ex.includes('\n') ? 'YES has newline char' : 'NO');
  // Check if private_key contains actual newline not escaped
  const pkStart=ex.indexOf('private_key');
  const snippet=ex.slice(pkStart, pkStart+1500);
  console.log('pk snippet', JSON.stringify(snippet.slice(0,800)));
  // Check for unescaped newline inside quoted value: look for \n literal vs real \n
  let realNewlineInString=false;
  let q=false, es=false;
  for(let i=0;i<ex.length;i++){
    const c=ex[i];
    if(q){
      if(es){ es=false; continue; }
      if(c==='\\'){ es=true; continue; }
      if(c==='\n'){ realNewlineInString=true; console.log('FOUND real newline inside string at',i, JSON.stringify(ex.slice(i-30,i+30))); break; }
      if(c==='"') q=false;
    } else {
      if(c==='"') q=true;
    }
  }
  console.log('realNewlineInString',realNewlineInString);
}
