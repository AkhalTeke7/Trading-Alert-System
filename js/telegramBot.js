import { Bot, InlineKeyboard } from 'grammy';

export const botCommands = [
    { command: 'alert', description: '➕ Create alert' },
    { command: 'alerts', description: '📋 My alerts' },
    { command: 'help', description: '❓ Help' },
];

// The menu and conversation are shared by local polling and Cloudflare webhooks.
export function createTelegramBot(token, {
    apiUrl = 'https://internal/api/alerts',
    apiFetch = fetch,
    userStates = new Map(),
} = {}) {
    const bot = new Bot(token);
    const symbols = {
      gold: 'Gold / USD',
      eurusd: 'EUR / USD',
      btc: 'BTC / USD',
      gbpusd: 'GBP / USD',
    };

    const mainMenu = () =>
      new InlineKeyboard()
        .text("➕ Create alert", "menu:alert").style("success")
        .row()
        .text("📋 My alerts", "menu:alerts").style("primary")
        .row()
        .text("❓ Help", "menu:help").style("danger");

    bot.command("start", async (ctx) => {
      await ctx.reply("Welcome to Price Alert!", {
        reply_markup: mainMenu(),
      });
    });

    const assetKeyboard = () =>
        new InlineKeyboard()
            .text('🪙 Gold', 'asset:gold').style("success")
            .row()
            .text('€ EUR/USD', 'asset:eurusd').style("primary")
            .row()
            .text('₿ BTC / USD', 'asset:btc').style("danger")
            .row()
            .text('£ GBP / USD', 'asset:gbpusd');

    const channelKeyboard = () =>
        new InlineKeyboard()
            .text('Bale', 'channel:Bale').style("success")
            .text('Telegram', 'channel:Telegram').style("primary")
            .row()
            .text('Both', 'channel:Both').style("danger");

    const confirmationKeyboard = () =>
        new InlineKeyboard()
            .text('✅ Save alert', 'flow:confirm').style("success")
            .row()
            .text('Cancel', 'flow:cancel').style("danger");

    async function showSavedSelections(ctx) {
        const response = await apiFetch(`${apiUrl}?ownerId=${ctx.from.id}`);
        if (!response.ok) throw new Error('Could not load your saved alerts.');
        const saved = await response.json();
        if (!saved.length) {
            await ctx.reply('You have no pending alerts. Choose Create alert to add one to the website.');
            return;
        }

        const recent = saved.slice(-5).reverse();
        const message = recent.map((selection, index) => {
            const note = selection.note ? `\nNote: ${selection.note.slice(0, 80)}` : '';
            return `${index + 1}. ${selection.pair} at ${selection.target} (${selection.state}) via ${selection.channel}${note}`;
        }).join('\n\n');
        await ctx.reply(`Your pending website alerts (most recent first):\n\n${message}`);
    }

    async function beginAlert(ctx, edit = false) {
        userStates.delete(ctx.from.id);
        const options = { reply_markup: assetKeyboard() };
        if (edit) {
            await ctx.editMessageText('Choose a symbol:', options);
        } else {
            await ctx.reply('Choose a symbol:', options);
        }
    }

    bot.command('alert', async (ctx) => {
        await beginAlert(ctx);
    });

    bot.command('alerts', async (ctx) => {
        await showSavedSelections(ctx);
    });

    bot.command('help', async (ctx) => {
        await ctx.reply('Use /alert to save and send an alert selection, or /alerts to review saved selections.');
    });

    bot.on('callback_query:data', async (ctx) => {
        const data = ctx.callbackQuery.data;
        const userId = ctx.from.id;
        await ctx.answerCallbackQuery();

        if (data === 'menu:alert') {
            await beginAlert(ctx, true);
            return;
        }
        if (data === 'menu:alerts') {
            await showSavedSelections(ctx);
            return;
        }
        if (data === 'menu:help') {
            await ctx.reply('Use Create alert to save and send an alert selection. My alerts shows your saved selections.');
            return;
        }
        if (data.startsWith('asset:')) {
            const pair = symbols[data.slice('asset:'.length)];
            if (!pair) return;
            userStates.set(userId, { pair, step: 'target' });
            await ctx.reply(`Selected ${pair}. Enter the target price:`);
            return;
        }
        if (data === 'note:skip') {
            const state = userStates.get(userId);
            if (!state || state.step !== 'note') return;
            state.note = '';
            state.step = 'channel';
            await ctx.reply('Where should the alert be sent?', { reply_markup: channelKeyboard() });
            return;
        }
        if (data.startsWith('channel:')) {
            const state = userStates.get(userId);
            if (!state || state.step !== 'channel') return;
            state.channel = data.slice('channel:'.length);
            state.step = 'confirm';
            await ctx.reply(
                `Review your website alert:\nSymbol: ${state.pair}\nTarget: ${state.targetInputValue}\nNote: ${state.note || '(none)'}\nNotify via: ${state.channel}`,
                { reply_markup: confirmationKeyboard() },
            );
            return;
        }
        if (data === 'flow:cancel') {
            userStates.delete(userId);
            await ctx.reply('Cancelled. Your saved selections were not changed.');
            return;
        }
        if (data === 'flow:confirm') {
            const state = userStates.get(userId);
            if (!state || state.step !== 'confirm') return;

            const selection = {
                pair: state.pair,
                target: state.target,
                note: state.note,
                channel: state.channel,
            };
            try {
                const response = await apiFetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...selection, targetInputValue: state.targetInputValue, ownerId: userId, source: 'telegram' }),
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(result.error || 'Could not save alert.');
                userStates.delete(userId);
                await ctx.reply('Alert saved to the website. You will be notified through your selected channel if the target is crossed. Use My alerts to review pending alerts.');
            } catch (error) {
                await ctx.reply(`Could not save the website alert: ${error.message}`);
            }
        }
    });

    bot.on('message:text', async (ctx) => {
        const state = userStates.get(ctx.from.id);
        if (!state) return;

        if (state.step === 'target') {
            const target = Number(ctx.message.text.trim());
            if (!Number.isFinite(target) || target <= 0) {
                await ctx.reply('Enter a valid price greater than zero:');
                return;
            }
            state.target = target;
            state.targetInputValue = ctx.message.text.trim();
            state.step = 'note';
            await ctx.reply('Add an optional note, or skip it:', {
                reply_markup: new InlineKeyboard().text('Skip note', 'note:skip'),
            });
            return;
        }

        if (state.step === 'note') {
            if (ctx.message.text.length > 500) {
                await ctx.reply('Keep the note under 500 characters, or skip it.');
                return;
            }
            state.note = ctx.message.text;
            state.step = 'channel';
            await ctx.reply('Where should the alert be sent?', { reply_markup: channelKeyboard() });
        }
    });

    return bot;
}
