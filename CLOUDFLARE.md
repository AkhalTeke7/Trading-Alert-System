# Deploy Price Alert on Cloudflare Workers

This deploys the **whole app** on Cloudflare, not just a static Pages site. No VPS or running local computer is needed. The existing HTML, CSS, navigation, alert form, symbols, Telegram menus, and notification-card design are preserved.

## What changed

| Area | Cloudflare adaptation |
| --- | --- |
| Web server | `cloudflare/worker.js` handles the same `/api/prices` and `/api/alerts` routes and serves the existing pages over HTTPS. |
| Saved alerts | A SQLite-backed Durable Object (`AlertStore`) replaces the local JSON file on Cloudflare. Pending alerts and Telegram conversation state survive restarts and normal redeploys. |
| Background checks | A cron trigger checks alerts approximately every minute instead of `setInterval`. |
| Notification images | Cloudflare Browser Rendering / Browser Run replaces locally installed Chrome. The original card HTML was moved, unchanged, to `js/alertCard.js` and is shared with the Node sender. |
| Telegram conversations | A secret-protected webhook replaces long polling. The existing menu/conversation logic is shared in `js/telegramBot.js`. Only explicitly allowed Telegram user IDs can use the hosted bot. |
| Security | Browser-native username/password prompt, HTTPS-compatible same-origin write checks, escaped alert-history text, and a simple rule: only the `Public/` folder is uploaded. `.env`, saved alerts, backend source, dependencies, and repository files are **not** public assets. |
| Reliability | Serialized alert operations, durable per-channel delivery progress, bounded upstream timeouts, and duplicate Telegram update/save protection. |
| Local use | `npm start`, `npm run prices`, and `npm run telegram` still exist. The Node server still uses `data/alerts.json`. Importing the notification sender no longer starts a bot before environment variables load. |

The earlier `getDecimalPlaces` fix is retained. **No page HTML or CSS was redesigned.** The only visible deployment addition is the browser login prompt.

## 1. Prerequisites

- Node.js 22 or newer and npm on your computer.
- A Cloudflare account with Workers, SQLite Durable Objects, and Browser Run available/enabled. Check your account's current quotas and billing, especially browser time and concurrent browser limits. This setup is not a promise of free hosting at every usage level.
- Your existing Telegram and/or Bale bot token and destination chat ID. Open/start the bot first; for groups/channels, give it permission to post.
- For the interactive Telegram bot, your **numeric Telegram user ID**. A group/channel chat ID is not a user ID.

## 2. Install, validate, and create the Worker

Run in the repository root:

```sh
npm ci
npm test
npm run check:cloudflare
npx wrangler login
npm run deploy:cloudflare
```

Wrangler uploads the Worker and everything in the `Public/` folder (no build step — to publish a new file, just put it in `Public/`), creates the Durable Object namespace, and configures the every-minute cron. The first deployment intentionally returns **503 until dashboard secrets are set**; it does not expose your dashboard without authentication.

Use the HTTPS `workers.dev` URL printed by Wrangler. You may add a custom domain later in the Worker settings. This is a **Worker**, not a Pages project; do not use `npm start` as a Cloudflare build command.

Keep the Worker name, `AlertStore` class, migration history, and the `personal-dashboard` object name stable. Renaming them can point the app at different storage. Never delete the Durable Object namespace to perform a routine update.

## 3. Add secrets securely

These commands prompt for values locally; do not put secrets in source files or chat:

```sh
npx wrangler secret put DASHBOARD_USER
npx wrangler secret put DASHBOARD_PASSWORD
```

Choose your own username (no colon) and a long, unique password. All visitors share this **personal dashboard**; this is not a multi-tenant service with separate website accounts. The browser remembers HTTP Basic credentials for the session; there is no application logout button. Use HTTPS in production.

For Telegram notifications:

```sh
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
```

For Bale notifications:

```sh
npx wrangler secret put BALE_BOT_TOKEN
npx wrangler secret put BALE_CHAT_ID
```

You only need the destination(s) you use. Selecting **Both** requires both sets. Alerts still go to the configured destination chat IDs, as before; `ownerId` only filters the bot's “My alerts” list. It does not choose a private message recipient.

Worker secrets are separate from your local `.env` and `.dev.vars`; those files are never uploaded automatically. After configuring secrets, run `npm run deploy:cloudflare` again and open the deployed URL. Enter your dashboard credentials in the browser prompt.

## 4. Enable the interactive Telegram bot (optional)

Skip this section if you only create alerts on the website and receive Telegram notifications.

1. Stop any local instance polling with the **same bot token** (`npm start` with that token, or `npm run telegram`). Polling and webhooks must not run for the same bot at the same time.
2. Generate a random webhook secret on your computer:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

3. Set the Worker secrets:

   ```sh
   npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
   npx wrangler secret put TELEGRAM_ALLOWED_USER_IDS
   ```

   For the allowlist, enter your numeric user ID, or comma-separated trusted user IDs. An empty allowlist disables the webhook. Unknown users are ignored.

4. In your local, ignored `.env`, set `WORKER_URL` to the deployed HTTPS origin and `TELEGRAM_WEBHOOK_SECRET` to the **same** secret. Keep `TELEGRAM_BOT_TOKEN` there too. `.env.example` documents the names.
5. Register the webhook and commands:

   ```sh
   npm run telegram:webhook
   ```

The script registers `/api/telegram/webhook`, sets the secret header Telegram will send, requests only message/callback updates, and sets the bot commands. The webhook is exempt from dashboard login but requires its own secret. It stores conversation steps in the Durable Object instead of process memory.

After changing the bot token, webhook secret, or hostname, rerun webhook registration. If you want to return to local polling, first remove the webhook using Telegram's `deleteWebhook` API.

## 5. Verify your deployment

1. Open the home page and click **Alert**. The existing layout should look the same.
2. Save an alert, reload, modify it, and delete it. Reloading must preserve pending alerts.
3. If using Telegram, send `/start`, complete the existing alert flow, then use `/alerts`. Confirm the saved alert also appears on the website.
4. Create a target that can realistically be crossed, and wait for a scheduled check. Confirm the selected channel receives the original-style image and the completed alert disappears **after reloading** the website (the UI still does not auto-refresh history).
5. Inspect logs if necessary:

   ```sh
   npx wrangler tail
   ```

The scheduled job samples prices; it is not an exchange tick stream and cannot guarantee detecting a price that crosses and reverses between samples. External TradingView/TGJU/Bale/Telegram availability or provider restrictions can affect price retrieval and delivery. Live access must be tested from your Cloudflare account.

## Data, retries, and limits

- Cloudflare starts with its own empty database. Existing `data/alerts.json` and localhost `localStorage` are **not** silently uploaded. Back them up and recreate pending alerts on the deployed site. Recreating an alert determines its up/down direction from the current price, so review it when migrating.
- Normal deployments with unchanged bindings preserve data. Redeploying is not a backup; export pending alerts periodically from the authenticated `/api/alerts` endpoint if needed.
- This personal deployment permits 100 pending alerts. A check attempts at most five triggered alerts to limit browser usage; the rest wait for later ticks. Failed sends are retained and rotated to avoid starving other alerts.
- Successful delivery to one channel is checkpointed before retrying the other. A triggered alert stays triggered even if prices reverse while delivery is failing. Editing an alert resets its trigger/delivery progress.
- Delivery is **at least once**, not exactly once. A crash/network failure after a provider accepts a message but before confirmation is stored can cause a duplicate. Telegram update/save deduplication covers the latest 100 processed updates; much older replays are outside that window.
- Missing channel secrets, exhausted browser quotas, or upstream failures retain pending alerts rather than silently discarding them. Check logs and billing limits.

## Local development and tests

```sh
cp .dev.vars.example .dev.vars
# Fill in your own development values; never commit .dev.vars.
npm run dev:cloudflare
```

Wrangler uses local persistent Durable Object data under `.wrangler/`, separate from production. It binds to `0.0.0.0` for preview support. Use `http://localhost:8787` on your computer. Cloudflare cron is not automatically run locally; manually test an empty queue with:

```sh
curl http://localhost:8787/cdn-cgi/local/scheduled
```

Real price/notification tests require outbound network access and working secrets. Browser-backed local rendering may also require the browser setup supported by your Wrangler environment; the production Worker uses the Browser Run binding, not your local Chrome installation.

```sh
npm test                    # Node regression tests; no real notifications sent
npm run check:cloudflare    # Actual Wrangler bundle/config dry run; no deployment
npm audit
```

The tests cover precision, saving, authentication, same-origin HTTPS requests, webhooks, persistence/restarts, validation/body limits, serialization, partial-delivery retries, Telegram state/deduplication, scheduled dispatch, and HTML escaping. Live provider delivery and a real Cloudflare deployment are separate checks requiring your account.
