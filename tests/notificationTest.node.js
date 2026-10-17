import test from 'node:test';
import assert from 'node:assert/strict';
import { testNotification } from '../js/notificationTest.js';
import { createToolExecutors, toolsSystemPrompt } from '../js/aiCore.js';

test('AI notification tool validates channels and rejects recipient/content overrides', async () => {
    const calls = [];
    const executor = createToolExecutors({ testNotification: async args => { calls.push(args); return { status: 'accepted' }; } });
    for (const args of [{}, { channel: 'SMS' }, { channel: 'Telegram', chatId: 'other' }, { channel: 'App', message: 'other' }]) {
        assert.ok((await executor.exec('test_notification', args)).error);
    }
    assert.equal(calls.length, 0);
    assert.equal((await executor.exec('test_notification', { channel: 'Telegram' })).status, 'accepted');
    assert.deepEqual(calls, [{ channel: 'Telegram' }]);
    assert.ok((await createToolExecutors().exec('test_notification', { channel: 'App' })).error);
    assert.match(toolsSystemPrompt(), /explicit user request/);
});

test('Telegram and Bale tests use configured destinations and fixed test content', async () => {
    for (const channel of ['Telegram', 'Bale']) {
        const prefix = channel.toUpperCase();
        const result = await testNotification({ channel, env: { [`${prefix}_BOT_TOKEN`]: 'secret', [`${prefix}_CHAT_ID`]: 'configured' }, fetchImpl: async (url, init) => {
            assert.match(url, /\/botsecret\/sendMessage$/);
            const body = JSON.parse(init.body);
            assert.equal(body.chat_id, 'configured');
            assert.match(body.text, /delivery test/);
            return { ok: true, json: async () => ({ ok: true }) };
        } });
        assert.equal(result.status, 'accepted');
    }
});

test('test failures are truthful and redact provider secrets', async () => {
    assert.ok((await testNotification({ channel: 'Telegram' })).error);
    const args = { channel: 'Telegram', env: { TELEGRAM_BOT_TOKEN: 'secret', TELEGRAM_CHAT_ID: 'private' } };
    const failed = await testNotification({ ...args, fetchImpl: async () => { throw new Error('https://host/botsecret'); } });
    assert.ok(failed.error);
    assert.doesNotMatch(JSON.stringify(failed), /botsecret|private/);
    const rejected = await testNotification({ ...args, fetchImpl: async () => ({ ok: true, json: async () => ({ ok: false }) }) });
    assert.ok(rejected.error);
    assert.ok((await testNotification({ channel: 'App', getDevices: async () => [] })).error);
    assert.ok((await testNotification({ channel: 'App', getDevices: async () => [{ pushToken: 'private' }] })).error);
});
