
import { renderMainChartHtml } from '../js/mainChartShot.js';
import { getCachedAlertPng, setCachedAlertPng, renderFallbackAlertPng } from '../js/alertPngFallback.js';

export async function renderCloudflareAlertPng(pair, target, note, env) {
    const cached = getCachedAlertPng(pair, target, note);
    if (cached) return cached;
    if (env?.BROWSER) {
        try {
            const { launch } = await import('@cloudflare/playwright');
            const browser = await launch(env.BROWSER);
            try {
                const page = await browser.newPage({
                    viewport: { width: 1200, height: 800 },
                    deviceScaleFactor: 2,
                });
                await page.setContent(renderMainChartHtml(pair, target, note), { waitUntil: 'domcontentloaded' });
                try { await page.waitForSelector('iframe', { timeout: 10000 }); } catch {}
                await page.waitForTimeout(3500);
                const png = await page.screenshot({ fullPage: false });
                setCachedAlertPng(pair, target, note, png);
                return png;
            } finally {
                await browser.close();
            }
        } catch {
            console.error('Browser Rendering unavailable or failed; using fallback PNG card');
        }
    }
    return renderFallbackAlertPng(pair, target, note);
}

export async function sendAlert(alert, env, onDelivered) {
    if (alert.channel === 'App') return;
    const names = alert.channel === 'Both' ? ['Bale', 'Telegram'] : [alert.channel];
    const pending = names.filter(name => !alert.deliveredChannels?.includes(name));
    if (!pending.length) return;
    const destinations = pending.map(name => {
        const prefix = name === 'Bale' ? 'BALE' : 'TELEGRAM';
        const token = env[`${prefix}_BOT_TOKEN`];
        const chatId = env[`${prefix}_CHAT_ID`];
        if (!token || !chatId) throw new Error(`Missing ${prefix} notification secrets`);
        return { name, token, chatId, root: name === 'Bale' ? 'https://tapi.bale.ai' : 'https://api.telegram.org' };
    });
    const screenshot = await renderCloudflareAlertPng(alert.pair, alert.target, alert.note, env);
    for (const destination of destinations) {
        const form = new FormData();
        form.append('chat_id', destination.chatId);
        form.append('photo', new Blob([screenshot], { type: 'image/png' }), 'price-alert.png');
        form.append('caption', `${alert.pair} crossed the target ${alert.target}. ${alert.note}`);
        const response = await fetch(`${destination.root}/bot${destination.token}/sendPhoto`, {
            method: 'POST', body: form, signal: AbortSignal.timeout(20_000),
        });
        const result = await response.json();
        // Do not log URLs/errors containing bot tokens.
        if (!response.ok || !result.ok) throw new Error(`${destination.name} photo upload failed`);
        await onDelivered(destination.name);
    }
}
