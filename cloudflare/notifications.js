
import { renderMainChartHtml } from '../js/mainChartShot.js';

export async function sendAlert(alert, env, onDelivered) {
    if (alert.channel === 'Phone' || alert.channel === 'App') return;
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
    const html = renderMainChartHtml(alert.pair, alert.target, alert.note);
    const { launch } = await import('@cloudflare/playwright');
    const browser = await launch(env.BROWSER);
    let screenshot;
    try {
        const page = await browser.newPage({
            viewport: { width: 1200, height: 800 },
            deviceScaleFactor: 2,
        });
        await page.setContent(html, { waitUntil: 'domcontentloaded' });
        try { await page.waitForSelector('iframe', { timeout: 14000 }); } catch {}
        await page.waitForTimeout(5000);
        screenshot = await page.screenshot({ fullPage: false });
    } finally {
        await browser.close();
    }
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
