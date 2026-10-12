# Trading Alert System

Price alerts for Gold/USD, EUR/USD, BTC/USD, and GBP/USD, with Telegram and Bale image notifications.

## Cloudflare hosting

See **[CLOUDFLARE.md](CLOUDFLARE.md)** for the deployment steps, required secrets, webhook setup, costs/limits to check, and a summary of the changes. The Workers deployment preserves the existing pages and styling and runs the backend, storage, scheduled checks, and image generation on Cloudflare.

```sh
npm ci
npm test
npm run check:cloudflare
```

## Existing local Node server

Use Node.js 22+, copy `.env.example` to `.env`, and configure the bot/channel credentials you use. The local sender uses Playwright with Chrome by default (`PLAYWRIGHT_BROWSER_CHANNEL` can select another installed channel).

```sh
npm start
```

Open `http://localhost:3000`. Local alerts remain in `data/alerts.json`. If a Telegram token is configured, the server also starts its polling bot; do not run another polling process or an active Cloudflare webhook for that same token simultaneously.

`npm run telegram` runs the bot separately and expects an alerts API at `http://127.0.0.1:3000/api/alerts` (overridable with `ALERTS_API_URL`). `npm run prices` prints the current provider response.
