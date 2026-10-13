import assert from 'node:assert/strict';
import { test } from 'node:test';
import { access, readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

// There is no build step: Cloudflare uploads the Public/ folder as-is
// (see "assets.directory" in wrangler.jsonc). So this test only guards the
// folder itself — the pages must be there, and no private file may sneak in.
test('Public folder is uploaded as-is, with no private files in it', async () => {
    async function files(path) {
        const entries = await readdir(`${root}/${path}`, { withFileTypes: true });
        return (await Promise.all(entries.map(async entry => entry.isDirectory()
            ? files(`${path}/${entry.name}`) : `${path}/${entry.name}`))).flat();
    }
    const output = await files('Public');
    for (const file of ['main.html', 'news.html', 'Alert/alert.html', 'js/alert.js', 'js/news.js', 'js/error.js']) {
        assert.ok(output.includes(`Public/${file}`), file);
    }
    // js/alert.js imports ./error.js — if it is missing, the page 404s on it.
    await access(`${root}/Public/js/error.js`);
    for (const file of output) {
        assert.ok(!/(^|\/)(\.env|\.dev\.vars|alerts\.json|server\.js|telegram|package\.json)/.test(file), file);
    }
    // Wrangler must point at Public/, with no build command in between.
    const wrangler = JSON.parse(await readFile(`${root}/wrangler.jsonc`, 'utf8'));
    assert.equal(wrangler.assets.directory, './Public');
    assert.equal(wrangler.build, undefined);
});
