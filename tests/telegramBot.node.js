import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTelegramBot } from '../js/telegramBot.js';

// Exercise the actual shared grammY handlers, without polling or network calls.
test('Telegram menu flow still saves and lists alerts with the original precision', async () => {
    const userStates = new Map();
    const saved = [];
    const replies = [];
    const bot = createTelegramBot('123:test-only-token', {
        userStates,
        apiFetch: async (url, options) => {
            if (options?.method === 'POST') {
                const alert = JSON.parse(options.body);
                saved.push(alert);
                return Response.json({ ...alert, id: 'saved' }, { status: 201 });
            }
            assert.equal(new URL(url).searchParams.get('ownerId'), '7');
            return Response.json(saved);
        },
    });
    bot.botInfo = { id: 123, is_bot: true, first_name: 'Test', username: 'test_price_bot' };
    bot.api.config.use(async (prev, method, payload) => {
        if (method === 'sendMessage') replies.push(payload.text);
        return { ok: true, result: true };
    });
    const from = { id: 7, is_bot: false, first_name: 'Owner' };
    const chat = { id: 7, type: 'private' };
    let id = 1;
    const text = value => bot.handleUpdate({ update_id: id++, message: {
        message_id: id, date: 1, from, chat, text: value,
        ...(value.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: value.length }] } : {}),
    } });
    const callback = data => bot.handleUpdate({ update_id: id++, callback_query: {
        id: String(id), from, chat_instance: 'test-chat', data,
        message: { message_id: id, date: 1, chat },
    } });
    await text('/start');
    await callback('menu:alert');
    await callback('asset:eurusd');
    await text('1.2300');
    await text('Watch this price');
    await callback('channel:Telegram');
    await callback('flow:confirm');
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0], {
        pair: 'EUR / USD', target: 1.23, targetInputValue: '1.2300',
        note: 'Watch this price', channel: 'Telegram', ownerId: 7, source: 'telegram',
    });
    assert.equal(userStates.size, 0);
    await text('/alerts');
    assert.match(replies[0], /Welcome to Price Alert/);
    assert.match(replies.at(-1), /EUR \/ USD/);
});
