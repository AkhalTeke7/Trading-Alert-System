// Run locally after deployment. Values come from your environment, never arguments
// containing credentials. This script does not write secrets to disk or stdout.
import { botCommands } from '../js/telegramBot.js';

const { WORKER_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET } = process.env;
if (!WORKER_URL || !TELEGRAM_BOT_TOKEN || !TELEGRAM_WEBHOOK_SECRET) {
    console.error('Set WORKER_URL, TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in your local .env first.');
    process.exitCode = 1;
} else {
    try {
        const url = new URL('/api/telegram/webhook', WORKER_URL);
        if (url.protocol !== 'https:') throw new Error('HTTPS required');
        if (!/^[A-Za-z0-9_-]{1,256}$/.test(TELEGRAM_WEBHOOK_SECRET)) throw new Error('Invalid webhook secret');
        for (const [method, body] of [
            ['setWebhook', { url: url.href, secret_token: TELEGRAM_WEBHOOK_SECRET, allowed_updates: ['message', 'callback_query'], max_connections: 1 }],
            ['setMyCommands', { commands: botCommands }],
        ]) {
            const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
            });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error('Telegram rejected configuration');
        }
        console.log('Telegram webhook and commands registered. Stop any local polling instance of this bot.');
    } catch {
        console.error('Webhook setup failed. Check the HTTPS URL, token, webhook secret format, and network access.');
        process.exitCode = 1;
    }
}
