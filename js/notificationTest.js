import { getServiceAccount, sendFcmV1 } from './fcmV1.js';

// Fixed test content and configured destinations only: never accept tokens,
// recipient overrides, provider URLs, or arbitrary messages from the model.
export async function testNotification({ channel, env = {}, getDevices, fetchImpl = fetch }) {
    if (!['Telegram', 'Bale', 'App'].includes(channel)) return { error: 'Choose Telegram, Bale, or App.' };
    const text = 'Trading Alert System — AI notification delivery test. No price alert was triggered.';
    if (channel === 'App') {
        const devices = await getDevices?.() || [];
        if (!devices.length) return { error: 'No registered phone devices. Register the Android app first.' };
        const tokens = devices.slice(-50).map(device => device.pushToken);
        const serviceAccount = getServiceAccount(env);
        if (!serviceAccount && !env.FCM_SERVER_KEY) return { error: 'Phone push credentials are not configured.' };
        try {
            const payload = { title: 'Notification test', body: text, data: {
                eventId: `ai-test-${crypto.randomUUID()}`, pair: 'Test', target: 'test', note: text,
            } };
            let accepted;
            if (serviceAccount) {
                accepted = await sendFcmV1(serviceAccount, tokens, payload);
            } else {
                const results = await Promise.all(tokens.map(async token => {
                    const response = await fetchImpl('https://fcm.googleapis.com/fcm/send', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: `key=${env.FCM_SERVER_KEY}` },
                        body: JSON.stringify({ to: token, priority: 'high', data: { ...payload.data, title: payload.title, body: text } }),
                        signal: AbortSignal.timeout(20_000),
                    });
                    const result = await response.json();
                    return response.ok && result.success > 0;
                }));
                accepted = results.some(Boolean);
            }
            return accepted ? { channel, status: 'accepted', detail: 'Push provider accepted at least one test. Phone receipt or sound is not confirmed.' }
                : { error: 'Push provider did not accept any test notifications.' };
        } catch {
            return { error: 'Phone push test failed. Check server push configuration.' };
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
