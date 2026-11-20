# Stock Watcher

A home-screen web app that watches US stocks and sends a push notification to your phone when one drops.

- **Rule:** alert when a stock is at least its drop % below yesterday's close (default 3%). At most one alert per stock per trading day.
- **Schedule:** checks every 5 minutes, 9:30–16:00 New York time, Monday to Friday.
- **Default watchlist:** AAPL, NVDA, TSLA at 3%. Add or remove stocks in the app.
- **Cost:** free. Runs on Cloudflare Workers' free plan, and prices come from Finnhub's free tier.

- **Charts:** each stock shows a 1-day trend line. Tap a stock for a full chart (1D, 5D, 1M, 6M, 1Y) with yesterday's close and your alert level marked. Price history comes from Yahoo Finance's public chart data, which is unofficial and can change. If it's unavailable, the 1-day chart falls back to prices this app records every 5 minutes.

It's a price watcher, not financial advice.

## How it's hosted

The code lives on GitHub. Cloudflare is connected to the repository, so **every push to `main` deploys automatically**. GitHub Actions runs the tests on each push.

| Part | What it does |
|---|---|
| `src/worker.js` | Cloudflare Worker: serves the app, provides the API, and runs the 5-minute cron |
| `src/watcher.js` / `src/alerts.js` | Fetch quotes and decide which alerts to send |
| `src/webpush.js` | Standard Web Push (RFC 8291 aes128gcm + VAPID), using only Web Crypto |
| `public/` | The installable web app (PWA) and its service worker |
| KV storage | Your watchlist, push subscriptions, push keys, and which alerts were already sent. Created automatically on the first deploy. |

## One-time setup: connect GitHub to Cloudflare

1. In the [Cloudflare dashboard](https://dash.cloudflare.com), go to **Workers & Pages → Create → Import a repository**.
2. Connect your GitHub account and pick this repository.
3. Keep the defaults. The project name must be **`stock-watcher`** (it matches `wrangler.toml`), the build command is empty, and the deploy command is `npx wrangler deploy`. Click **Deploy**.
   The first deploy creates the KV storage and the 5-minute schedule automatically.
4. Open the new Worker, go to **Settings → Variables and Secrets**, and add two values of type **Secret**:
   - `FINNHUB_API_KEY`: your Finnhub API key
   - `APP_TOKEN`: a long password you choose. You'll type it into the app once, and it stops other people from using your app.
5. Your app's address is shown on the Worker's page, for example `https://stock-watcher.<your-subdomain>.workers.dev`.

Secrets you add in the dashboard are kept across deploys. Never commit keys to this repository.

## On your phone

- **iPhone (iOS 16.4 or later):** open the address in Safari, tap Share, then **Add to Home Screen**. Open Stock Watcher from the home screen, enter your `APP_TOKEN`, and tap **Turn on**.
- **Android:** open the address in Chrome, enter your `APP_TOKEN`, and tap **Turn on**.
- Tap **Send test alert** to confirm notifications arrive.

## Develop locally (optional)

```bash
npm install
npm test          # unit tests: alert rules, market hours, push encryption checked against the reference implementation
npm run dev       # local server; put FINNHUB_API_KEY=... and APP_TOKEN=... lines in .dev.vars
```
