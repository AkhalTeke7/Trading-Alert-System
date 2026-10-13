import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(root, 'dist/cloudflare');
await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, 'js'), { recursive: true });
await mkdir(resolve(output, 'Public/Alert'), { recursive: true });
// Explicitly allowlist public files. Never copy the repository root or all of js/.
for (const path of ['main.html', 'Public/news.html', 'Public/Alert/alert.html', 'js/alert.js', 'js/news.js', 'css', 'asset']) {
    await cp(resolve(root, path), resolve(output, path), { recursive: true });
}
console.log('Cloudflare public assets built in dist/cloudflare (no secrets or saved alerts).');
