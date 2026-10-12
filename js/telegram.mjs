import { renderAlertCard } from './alertCard.js';
import { createTelegramBot, botCommands } from './telegramBot.js';
import { pathToFileURL } from 'node:url';
import { Bot, InputFile } from 'grammy';
import { chromium } from "playwright";
import { writeFile } from 'node:fs/promises';

export async function alertSender(pair, targetPrice, note, channel = 'Bale', previewPath) {
    const destinations = {
        Bale: {
            token: process.env.BALE_BOT_TOKEN,
            chatId: process.env.BALE_CHAT_ID,
            apiRoot: 'https://tapi.bale.ai',
            requiredVariables: ['BALE_BOT_TOKEN', 'BALE_CHAT_ID'],
        },
        Telegram: {
            token: process.env.TELEGRAM_BOT_TOKEN,
            chatId: process.env.TELEGRAM_CHAT_ID,
            requiredVariables: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'],
        },
    };
    const selectedChannels = channel === 'Both' ? ['Bale', 'Telegram'] : [channel];
    const selectedDestinations = selectedChannels.map(name => {
        const destination = destinations[name];
        if (!destination) throw new Error(`Unsupported alert channel: ${name}`);
        const missingVariables = destination.requiredVariables.filter(variable => !process.env[variable]);
        if (missingVariables.length) {
            throw new Error(`Missing ${missingVariables.join(' and ')}; configure them in .env and restart the server`);
        }
        return destination;
    });

    const html = renderAlertCard(pair, targetPrice, note);

    const browser = await chromium.launch({
        channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'chrome',
    });
    let screenshot;

    try {
        const page = await browser.newPage({
            viewport: { width: 1200, height: 800 },
            deviceScaleFactor: 2,
        });
        await page.setContent(html);
        await page.waitForTimeout(800);
        screenshot = await page.screenshot({ fullPage: true });
        if (previewPath) await writeFile(previewPath, screenshot);
    } finally {
        await browser.close();
    }

    const caption = `${pair} crossed the target ${targetPrice}. ${note}`;
    for (const destination of selectedDestinations) {
        if (destination.apiRoot) {
            const form = new FormData();
            form.append('chat_id', destination.chatId);
            form.append('photo', new Blob([screenshot], { type: 'image/png' }), 'price-alert.png');
            form.append('caption', caption);

            const response = await fetch(
                `${destination.apiRoot}/bot${destination.token}/sendPhoto`,
                { method: 'POST', body: form },
            );
            const result = await response.json();
            if (!response.ok || !result.ok) {
                throw new Error(result.description || 'Bale photo upload failed');
            }
            continue;
        }

        const bot = new Bot(destination.token);
        await bot.api.sendPhoto(destination.chatId, new InputFile(screenshot, 'price-alert.png'), { caption });
    }
};
// Local Node entry point. Importing the sender no longer starts polling.
export async function startTelegramBot() {
    if (!process.env.TELEGRAM_BOT_TOKEN) return;
    const bot = createTelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
        apiUrl: process.env.ALERTS_API_URL || 'http://127.0.0.1:3000/api/alerts',
    });
    bot.catch(error => console.error('Bot error:', error));
    await bot.api.setMyCommands(botCommands);
    void bot.start().catch(error => console.error('Bot stopped:', error));
    return bot;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await startTelegramBot();
}
