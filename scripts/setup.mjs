#!/usr/bin/env node
/**
 * Price-Alert — automated builder / setup
 * Usage:
 *   node scripts/setup.mjs              # interactive — asks what to do
 *   node scripts/setup.mjs --yes        # non-interactive — installs, tests, dry-run
 *   node scripts/setup.mjs --deploy     # also runs wrangler deploy
 *   node scripts/setup.mjs --local      # local Node only (no Cloudflare)
 *   node scripts/setup.mjs --help
 *
 * npm:  npm run setup  /  npm run setup:deploy  /  npm run setup:local
 *
 * Does:
 *  1) banner + prereqs (Node >=22, npm, wrangler)
 *  2) npm ci (unless --skip-install)
 *  3) create .env / .dev.vars from examples if missing
 *  4) journal is local-only (no Drive validation — export JSON embeds compressed base64)
 *  5) npm test / npm run check:cloudflare
 *  6) optional wrangler deploy
 *  No secrets are printed or committed.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── cli ──
const args = new Set(process.argv.slice(2));
const opt = {
  help: args.has('--help') || args.has('-h'),
  yes: args.has('--yes') || args.has('-y') || args.has('--non-interactive'),
  deploy: args.has('--deploy'),
  local: args.has('--local'),
  skipInstall: args.has('--skip-install'),
  skipTests: args.has('--skip-tests'),
  skipDrive: args.has('--skip-drive'),
};
if (opt.deploy) opt.yes = true; // deploy implies yes

// ── colors (no deps) ──
const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  bone: '\x1b[38;2;233;228;214m', muted: '\x1b[38;2;139;135;123m', red: '\x1b[38;2;209;59;47m',
  up: '\x1b[38;2;59;196;122m', cyan: '\x1b[38;2;88;192;200m', amber: '\x1b[38;2;232;180;80m',
};
const paint = (c, s) => `${c}${s}${C.reset}`;
const line = paint(C.muted, '─'.repeat(62));

// ── helpers ──
function log(...a){ console.log(...a); }
function hr(){ log(paint(C.muted, '─'.repeat(62))); }
function banner(){
  log('');
  log(paint(C.bone, '  ██████  ██████  ██  ██████ ███████       █████  ██      ███████ ██████  ████████'));
  log(paint(C.bone, '  ██   ██ ██   ██ ██ ██      ██            ██   ██ ██      ██      ██   ██    ██   '));
  log(paint(C.bone, '  ██████  ██████  ██ ██      █████   █████ ███████ ██      █████   ██████     ██   '));
  log(paint(C.bone, '  ██      ██   ██ ██ ██      ██            ██   ██ ██      ██      ██   ██    ██   '));
  log(paint(C.bone, '  ██      ██   ██ ██  ██████ ███████       ██   ██ ███████ ███████ ██   ██    ██   '));
  log(paint(C.muted, '  · DOSSIER  ·  MARKETS  ·  JOURNAL  ·  ALERTS  ·  LOCAL JOURNAL  ·  CLOUDFLARE ·'));
  log(paint(C.dim, '  automated setup  •  node 22+  •  local journal  •  compressed export'));
  log('');
}
function usage(){
  log(paint(C.bone, 'Usage:') + ' node scripts/setup.mjs [flags]');
  log('  --yes, -y            non-interactive (no prompts)');
  log('  --deploy             run wrangler deploy at the end (implies --yes)');
  log('  --local              local Node only — skip Cloudflare checks');
  log('  --skip-install       skip npm ci');
  log('  --skip-tests         skip npm test');
  log('  --skip-drive         (no-op — journal is local only)');
  log('  --help, -h           this help');
  log('');
  log(paint(C.muted, 'npm shortcuts:') + '  npm run setup  •  npm run setup:deploy  •  npm run setup:local');
}
async function ask(q, def=''){
  if(opt.yes) return def;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ans = await new Promise(res => rl.question(paint(C.muted, q + (def ? ` [${def}] ` : ' ')), v => { rl.close(); res(v.trim() || def); }));
  return ans;
}
function spawnOpts(extra={}){
  // win32 needs shell for .cmd shims; but passing array + shell triggers DEP0190 — use shell string instead
  const useShell = process.platform === 'win32';
  return { cwd: ROOT, ...extra, ...(useShell ? { shell: true } : {}) };
}
function toShellCmd(cmd, args){
  // when shell:true the command must be a single string so args are escaped by the shell
  if(process.platform !== 'win32') return null;
  const esc = s => /[\s"']/.test(s) ? `"${s.replace(/"/g,'\\"')}"` : s;
  return [cmd, ...args].map(esc).join(' ');
}
function run(cmd, shellArgs, opts={}){
  return new Promise((resolve)=>{
    const o = spawnOpts({ stdio:'inherit', ...opts });
    const shellCmd = toShellCmd(cmd, shellArgs);
    const child = shellCmd ? spawn(shellCmd, [], o) : spawn(cmd, shellArgs, o);
    child.on('close', code => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}
function runCapture(cmd, shellArgs){
  return new Promise((resolve)=>{
    const o = spawnOpts({});
    const shellCmd = toShellCmd(cmd, shellArgs);
    const child = shellCmd ? spawn(shellCmd, [], o) : spawn(cmd, shellArgs, o);
    let out='', err='';
    child.stdout?.on('data', d=> out+=d);
    child.stderr?.on('data', d=> err+=d);
    child.on('close', code => resolve({ code: code ?? 1, out: out.trim(), err: err.trim() }));
    child.on('error', e => resolve({ code:1, out:'', err:String(e) }));
  });
}
function fileExists(p){ try{ return existsSync(p); }catch{ return false; } }
function readText(p){ try{ return readFileSync(p,'utf8'); }catch{ return ''; } }

// ── prereqs ──
function checkNode(){
  const major = Number(process.versions.node.split('.')[0]);
  const ok = major >= 22;
  log(`${ok?paint(C.up,'✓'):paint(C.red,'✗')} Node ${process.versions.node} ${ok?paint(C.muted,'(≥22 required)') : paint(C.red,'(need Node 22+ — https://nodejs.org)')} `);
  if(!ok) log(paint(C.amber,'  → update Node before continuing.'));
  return ok;
}
async function checkCmd(cmd, args, label){
  const r = await runCapture(cmd, args);
  const ok = r.code===0;
  const ver = (r.out || r.err).split('\n')[0]?.slice(0,90) || '';
  log(`${ok?paint(C.up,'✓'):paint(C.muted,'·')} ${label} ${ok?paint(C.muted,ver):paint(C.muted,'(not found — optional)')} `);
  return { ok, ver };
}

// ── .env / .dev.vars ──
function ensureEnvFile(example, target){
  const ex = resolve(ROOT, example);
  const tg = resolve(ROOT, target);
  if(fileExists(tg)){
    log(paint(C.up,'✓')+` ${target} exists`);
    return false;
  }
  if(!fileExists(ex)){
    log(paint(C.amber,'·')+` ${example} missing — skipping ${target}`);
    return false;
  }
  writeFileSync(tg, readFileSync(ex,'utf8'), 'utf8');
  log(paint(C.up,'✓')+` created ${target} from ${example} ${paint(C.muted,'(edit it next)')}`);
  return true;
}

// ── (no Drive validation — journal is local only; kept as no-ops for --help compat) ──
function stripQuotes(s){
  let r=s.trim();
  if(r.charCodeAt(0)===0xFEFF) r=r.slice(1);
  let g=0; while(g<4 && r.length>=2 && ((r.startsWith('"')&&r.endsWith('"'))||(r.startsWith("'")&&r.endsWith("'")))){ r=r.slice(1,-1).trim(); g++; }
  return r;
}
function extractFromEnvText(text, key){
  const idx=text.indexOf(key+'=');
  if(idx===-1) return null;
  let s=idx+key.length+1;
  while(s<text.length && (text[s]===' '||text[s]==='\t')) s++;
  if(s>=text.length) return null;
  const ch=text[s];
  if(ch==='"'||ch==="'"){
    const q=ch; let e=s+1, esc=false;
    while(e<text.length){
      const c=text[e];
      if(esc){ esc=false; e++; continue; }
      if(c==='\\'){ esc=true; e++; continue; }
      if(c===q) break;
      e++;
    }
    if(e<text.length) return text.slice(s+1,e);
    return text.slice(s+1).trim();
  }
  if(ch==='{'){
    let depth=0, e=s, inStr=false, esc=false, strChar='';
    for(; e<text.length; e++){
      const c=text[e];
      if(inStr){
        if(esc){ esc=false; continue; }
        if(c==='\\'){ esc=true; continue; }
        if(c===strChar) inStr=false;
        continue;
      } else {
        if(c==='"' || c==="'"){ inStr=true; strChar=c; continue; }
        if(c==='{') depth++;
        else if(c==='}'){ depth--; if(depth===0){ e++; break; } }
      }
    }
    return text.slice(s,e);
  }
  let e=text.indexOf('\n',s);
  if(e===-1) e=text.length;
  return text.slice(s,e).trim();
}
function validateDrive(){
  log(paint(C.muted,'· Journal is local-only — no Drive (export JSON embeds compressed base64)'));
  return { ok:true, via:'local' };
}

// ── main ──
async function main(){
  banner();
  if(opt.help){ usage(); process.exit(0); }

  hr();
  log(paint(C.bone,'Prereqs'));
  const nodeOk = checkNode();
  await checkCmd('npm',['--version'],'npm');
  const wrangler = await checkCmd('npx',['wrangler','--version'],'wrangler');
  if(!nodeOk){
    log(''); log(paint(C.red,'✗ Node 22+ required — aborting.')); process.exit(1);
  }

  hr();
  log(paint(C.bone,'Env files'));
  const createdEnv = ensureEnvFile('.env.example','.env');
  const createdDevVars = ensureEnvFile('.dev.vars.example','.dev.vars');
  if(createdEnv || createdDevVars){
    log(paint(C.amber,'  → open .env / .dev.vars and fill secrets (Telegram/Bale tokens). Journal needs no cloud.'));
    if(!opt.yes){
      const go = await ask('Continue anyway? (Y/n)', 'Y');
      if(go.toLowerCase()==='n'){ log(paint(C.muted,'Aborted — edit env files then rerun.')); process.exit(0); }
    }
  }

  hr();
  log(paint(C.bone,'Install'));
  if(opt.skipInstall){
    log(paint(C.muted,'· skipped (--skip-install)'));
  }else{
    const hasLock = fileExists(resolve(ROOT,'package-lock.json'));
    log(paint(C.muted, hasLock ? 'npm ci …' : 'npm install …') + paint(C.dim,' (may take a minute)'));
    const code = await run('npm',[hasLock?'ci':'install']);
    if(code!==0){ log(paint(C.red,'✗ install failed')); process.exit(code); }
    log(paint(C.up,'✓ installed'));
  }

  validateDrive();

  if(!opt.local){
    hr();
    log(paint(C.bone,'Checks'));
    if(!opt.skipTests){
      log(paint(C.muted,'npm test …'));
      const t = await run('npm',['test']);
      if(t!==0) log(paint(C.amber,'· tests failed — check output above (continuing)'));
      else log(paint(C.up,'✓ tests passed'));
    }else log(paint(C.muted,'· tests skipped (--skip-tests)'));

    if(wrangler.ok){
      log(paint(C.muted,'wrangler deploy --dry-run …'));
      const c = await run('npx',['wrangler','deploy','--dry-run']);
      if(c!==0) log(paint(C.amber,'· dry-run failed — check wrangler.jsonc / bindings'));
      else log(paint(C.up,'✓ cloudflare dry-run ok'));
    }else{
      log(paint(C.muted,'· wrangler not found — skip cloudflare check (npm i -g wrangler)'));
    }
  }else{
    log(''); log(paint(C.muted,'· --local — skipped cloudflare checks'));
    if(!opt.skipTests){
      log(paint(C.muted,'npm test …')); const t=await run('npm',['test']); log(t===0?paint(C.up,'✓ tests passed'):paint(C.amber,'· tests failed'));
    }
  }

  hr();
  if(opt.deploy){
    if(!wrangler.ok){ log(paint(C.red,'✗ wrangler not found — cannot deploy')); process.exit(1); }
    log(paint(C.bone,'Deploy — wrangler deploy …'));
    const code = await run('npx',['wrangler','deploy']);
    if(code!==0){ log(paint(C.red,'✗ deploy failed — see above / run npx wrangler tail')); process.exit(code); }
    log(paint(C.up,'✓ deployed'));
  }

  // ── summary ──
  hr();
  log(paint(C.bone,'Done — next steps'));
  log(`  ${paint(C.cyan,'Local:')}   npm start  ${paint(C.dim,'→ http://localhost:3000  (main.html · journal.html)')} `);
  log(`  ${paint(C.cyan,'Preview:')} npx wrangler dev --ip 0.0.0.0  ${paint(C.dim,'→ http://localhost:8787')} `);
  if(!opt.deploy) log(`  ${paint(C.cyan,'Deploy:')}  npm run deploy:cloudflare  ${paint(C.dim,'or node scripts/setup.mjs --deploy')} `);
  log('');
  log(paint(C.muted,'  Journal: local only — Export JSON embeds images as data:image/jpeg;base64 (compressed).'));
  log(paint(C.muted,'  Secrets: npx wrangler secret put DASHBOARD_USER / DASHBOARD_PASSWORD / TELEGRAM_* / BALE_*'));
  log('');
  log(paint(C.bone,'  Add GIFs:') + paint(C.muted,' Pictures/markets-draw-to-alert.gif etc. — see README Preview → How to add GIFs'));
  hr();
  log(paint(C.dim,'  Re-run: node scripts/setup.mjs --help'));
  log('');
}

main().catch(e=>{ console.error(e); process.exit(1); });
