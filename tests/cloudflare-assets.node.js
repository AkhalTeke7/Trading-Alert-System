import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

test('Cloudflare asset build copies existing pages without publishing private files', async () => {
    execFileSync(process.execPath, ['scripts/build-cloudflare.mjs'], { cwd: root });
    async function files(path) {
        const entries = await readdir(`${root}/${path}`, { withFileTypes: true });
        return (await Promise.all(entries.map(async entry => entry.isDirectory()
            ? files(`${path}/${entry.name}`) : `${path}/${entry.name}`))).flat();
    }
    const output = await files('dist/cloudflare');
    assert.ok(output.includes('dist/cloudflare/main.html'));
    assert.ok(output.includes('dist/cloudflare/Public/Alert/alert.html'));
    assert.ok(output.includes('dist/cloudflare/js/alert.js'));
    assert.ok(output.includes('dist/cloudflare/Public/news.html'));
    assert.ok(output.includes('dist/cloudflare/js/news.js'));
    for (const file of output) {
        const relative = file.replace('dist/cloudflare/', '');
        assert.ok(['main.html', 'Public/news.html', 'Public/Alert/alert.html', 'js/alert.js', 'js/news.js'].includes(relative)
            || relative.startsWith('css/') || relative.startsWith('asset/'), relative);
        assert.deepEqual(await readFile(`${root}/${file}`), await readFile(`${root}/${relative}`));
    }
    for (const path of ['.env', '.dev.vars', 'data/alerts.json', 'js/server.js', 'js/telegram.mjs', 'package.json']) {
        assert.ok(!output.includes(`dist/cloudflare/${path}`));
    }
});
