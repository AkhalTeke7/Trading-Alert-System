import { renderMainChartHtml } from './mainChartShot.js';
import { getCachedAlertPng, setCachedAlertPng, renderFallbackAlertPng } from './alertPngFallback.js';
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
    if (channel === 'Phone' || channel === 'App') {
        // Phone only — no Bale/Telegram delivery, phone rings via /api/triggered polling + FCM
        return;
    }
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

    // Screenshot of the main page chart as it appears in main.html
    let screenshot = getCachedAlertPng(pair, targetPrice, note);
    if (!screenshot) {
        try {
            const html = renderMainChartHtml(pair, targetPrice, note);
            let browser;
            try {
                browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'chrome' });
            } catch {
                browser = await chromium.launch();
            }
            try {
                const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 });
                await page.setContent(html, { waitUntil: 'domcontentloaded' });
                try { await page.waitForSelector('iframe', { timeout: 10000 }); } catch {}
                await page.waitForTimeout(3500);
                screenshot = await page.screenshot({ fullPage: false });
                setCachedAlertPng(pair, targetPrice, note, screenshot);
            } finally {
                await browser.close();
            }
        } catch (error) {
            console.warn('Playwright screenshot failed; using fallback alert PNG card:', error?.message || error);
            screenshot = renderFallbackAlertPng(pair, targetPrice, note);
        }
    }
    if (previewPath) await writeFile(previewPath, screenshot);

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
