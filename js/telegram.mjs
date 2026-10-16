import { renderAlertCard } from './alertCard.js';
import { createTelegramBot, botCommands } from './telegramBot.js';
import { pathToFileURL } from 'node:url';
import { Bot, InputFile } from 'grammy';
import { chromium } from "playwright";
import { writeFile } from 'node:fs/promises';
import { pairToSymbol } from './alertModel.js';

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
    if (channel === 'App') {
        // Mobile app only — no Bale/Telegram delivery, phone rings via /api/triggered polling + FCM
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

    // --- Try live TradingView chart screenshot at trigger moment ---
    let screenshot;
    let usedLiveChart = false;
    async function tryLiveChart() {
        const tvSymbol = pairToSymbol[pair] || pair;
        const liveHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=1200, initial-scale=1"><style>html,body{margin:0;padding:0;background:#0a0a0a;overflow:hidden} #wrap{width:1200px;height:675px;display:flex;position:relative} .tradingview-widget-container{flex:1} .tradingview-widget-container iframe{border:0} .tag{position:absolute;left:12px;bottom:12px;background:rgba(10,10,10,.88);border:1px solid rgba(233,228,214,.18);color:#e9e4d6;font:11px 'JetBrains Mono',monospace;letter-spacing:.08em;padding:6px 10px;z-index:9}</style></head><body><div id="wrap"><div class="tradingview-widget-container" id="tv"><div class="tradingview-widget-container__widget" style="height:100%;width:100%"></div></div><div class="tag">${pair}  ·  TARGET ${targetPrice}  ·  ${String(note||'').slice(0,60).replace(/</g,'')}</div></div><script>const s=document.createElement('script');s.type='text/javascript';s.async=true;s.src='https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';s.textContent=JSON.stringify({autosize:true,symbol:"${tvSymbol}",interval:"15",timezone:"Etc/UTC",theme:"dark",style:"1",locale:"en",enable_publishing:false,backgroundColor:"rgba(10, 10, 10, 1)",gridColor:"rgba(233, 228, 214, 0.06)",overrides:{"mainSeriesProperties.candleStyle.upColor":"#16a34a","mainSeriesProperties.candleStyle.downColor":"#0a0a0a","mainSeriesProperties.candleStyle.borderUpColor":"#16a34a","mainSeriesProperties.candleStyle.borderDownColor":"#555555","mainSeriesProperties.candleStyle.wickUpColor":"#16a34a","mainSeriesProperties.candleStyle.wickDownColor":"#555555","mainSeriesProperties.candleStyle.borderColor":"#555555"},hide_top_toolbar:false,hide_side_toolbar:true,allow_symbol_change:false,save_image:false,calendar:false,support_host:"https://www.tradingview.com"});document.getElementById('tv').appendChild(s);<\/script></body></html>`;
        const browser2 = await chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'chrome' });
        try {
            const page = await browser2.newPage({ viewport: { width: 1200, height: 675 }, deviceScaleFactor: 2 });
            await page.setContent(liveHtml, { waitUntil: 'domcontentloaded' });
            // wait for TradingView iframe to appear and paint
            try { await page.waitForSelector('iframe', { timeout: 12000 }); } catch {}
            await page.waitForTimeout(4500);
            const buf = await page.screenshot({ fullPage: false });
            return buf;
        } finally { await browser2.close(); }
    }
    try {
        screenshot = await tryLiveChart();
        usedLiveChart = true;
        if (screenshot) console.log(`Live chart snapshot ok for ${pair} ${targetPrice}`);
        else throw new Error('empty live screenshot');
    } catch (e) {
        console.warn('Live chart screenshot failed, falling back to static card:', e.message || e);
        const html = renderAlertCard(pair, targetPrice, note);
        const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'chrome' });
        try {
            const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 });
            await page.setContent(html);
            await page.waitForTimeout(800);
            screenshot = await page.screenshot({ fullPage: true });
        } finally { await browser.close(); }
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
