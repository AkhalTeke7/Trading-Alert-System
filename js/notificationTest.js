// Fixed test content and configured destinations only: never accept tokens,
// recipient overrides, provider URLs, or arbitrary messages from the model.
//
// App is NOT FCM: the Android app (AlertMonitorService) polls
// GET /api/triggered automatically, so an App test only has to append a
// fixed event to triggered history. No device registration, no push
// credentials, no /api/devices entry is required for it to ring.
export async function testNotification({ channel, env = {}, recordTriggered, fetchImpl = fetch }) {
    if (!['Telegram', 'Bale', 'App'].includes(channel)) return { error: 'Choose Telegram, Bale, or App.' };
    const text = 'Trading Alert System — AI notification delivery test. No price alert was triggered.';
    if (channel === 'App') {
        if (typeof recordTriggered !== 'function') {
            return { error: 'App test alerts are not available in this runtime.' };
        }
        try {
            const event = await recordTriggered({
                alertId: null,
                pair: 'Test',
                target: 'test',
                note: text,
                channel: 'App',
                source: 'ai-test',
            });
            return {
                channel,
                status: 'queued',
                eventId: event?.id || null,
                detail: 'Test alert added to triggered history (/api/triggered). The Android app pulls it automatically on its next poll — no device registration needed. The phone has not sounded until it polls.',
            };
        } catch {
            return { error: 'Could not queue the App test alert. Check server triggered-history storage.' };
        }
    }
    const prefix = channel === 'Telegram' ? 'TELEGRAM' : 'BALE';
    const token = env[`${prefix}_BOT_TOKEN`];
    const chatId = env[`${prefix}_CHAT_ID`];
    if (!token || !chatId) return { error: `${channel} notification credentials are not configured.` };
    const root = channel === 'Telegram' ? 'https://api.telegram.org' : 'https://tapi.bale.ai';
    try {
        const response = await fetchImpl(`${root}/bot${token}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text }), signal: AbortSignal.timeout(20_000),
        });
        const result = await response.json();
        if (!response.ok || result.ok !== true) return { error: `${channel} rejected the test message.` };
        return { channel, status: 'accepted', detail: 'Provider accepted the test message. Recipient reading is not confirmed.' };
    } catch {
        // Fetch errors can contain the secret-bearing URL. Never return them to AI.
        return { error: `${channel} test failed. Check server notification configuration.` };
    }
}
