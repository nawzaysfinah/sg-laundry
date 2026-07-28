# 🌧️ SG Laundry — Singapore Rain & Laundry Advisor

Drop a pin anywhere in Singapore to see current & upcoming rain, a transparent
laundry-drying recommendation, and — via Telegram — a rain-incoming alert and a
daily morning digest telling you whether it's a good day to hang laundry.

Built to run at **$0/month**: Next.js on Vercel Hobby, Open-Meteo for weather
(no key), CARTO map tiles (no key), a Windy embed for the visual radar, Upstash
Redis free tier for the tiny bit of state, and a Telegram bot for alerts (Web
Push is also in the codebase as a dormant fallback channel — see below).

No accounts. No analytics. No trackers. One user — you.

---

## What it does

| Panel | What it shows | Data source |
| --- | --- | --- |
| **Locator** | Leaflet map locked to Singapore, tap/drag pin + place search | CARTO tiles, Open-Meteo geocoding |
| **Laundry advisor** | Great / OK / Poor / Bring-it-in badge, drying-time estimate, best window today, and a full score breakdown | Open-Meteo → `lib/laundryLogic.ts` |
| **Current conditions** | Temp, humidity, wind, cloud, UV in plain language | Open-Meteo `current` + `hourly` |
| **Rain timeline** | Colour-coded rain-probability bars for the next 12 hours | Open-Meteo `hourly` |
| **Live rain radar** | Windy radar loop, centred on the pin (**visual only**) | Windy embed |
| **Home & notifications** | Save a home pin, toggle browser rain alerts (Telegram runs automatically once configured — no in-app toggle needed) | Upstash Redis + Web Push |
| **Telegram — rain alert** | Sent automatically when rain is imminent near home | Cron checker → `lib/telegram.ts` |
| **Telegram — morning report** | One digest per day (~8am SGT by default): verdict, best window, peak rain | Cron checker → `lib/report.ts` |

> The Windy iframe is a **picture**, not a data source. Every number, threshold
> and recommendation comes from Open-Meteo. See `components/WindyRadar.tsx`.

---

## Project layout

```
app/
  page.tsx                     one-screen app
  layout.tsx, manifest.ts      PWA shell
  globals.css                  dark night-sky theme + Leaflet overrides
  api/
    weather/route.ts           GET  proxy → Open-Meteo forecast (built view-model)
    geocode/route.ts           GET  proxy → Open-Meteo geocoding (SG only)
    home/route.ts              GET/POST/DELETE home location
    subscribe/route.ts         POST/DELETE push subscription (Web Push, dormant)
    push/public-key/route.ts   GET  VAPID public key (Web Push, dormant)
    cron/check-rain/route.ts   GET/POST protected checker — drives Telegram
                                rain alerts, the daily Telegram report, AND the
                                dormant Web Push channel, all from one call
lib/
  laundryLogic.ts   ← the tunable model. All constants live in LAUNDRY_CONFIG.
  forecast.ts          joins Open-Meteo data to the model → the UI view-model
  weather.ts           Open-Meteo client + WMO code descriptions
  geo.ts               Singapore bounding box + coordinate validation
  sgTime.ts            Asia/Singapore time handling (naive-timestamp safe)
  store.ts             Upstash Redis persistence
  telegram.ts          Telegram Bot API client (primary notification channel)
  report.ts            pure message builders — rain alert + morning digest text
  push.ts              web-push sending (server, dormant fallback channel)
  pushClient.ts        browser subscribe/unsubscribe flow (dormant)
components/            map, panels, search, settings, icons
public/
  sw.js                service worker (push delivery only — no offline caching)
  icons/               generated PWA icons
scripts/
  generate-icons.mjs   zero-dependency PNG icon generator (npm run icons)
```

**Where to tune things:** everything you'll want to adjust — scoring weights,
drying-time bands, recommendation thresholds, best-window rules, and
notification behaviour — is in **`lib/laundryLogic.ts`** under the exported
`LAUNDRY_CONFIG` object, each field commented.

---

## Run it locally

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. The map, forecast, laundry advisor, timeline and
radar all work **with no configuration at all** — Open-Meteo and CARTO need no
keys. Only the *home location* and *notifications* (Telegram or Web Push) need
the env vars below; until you set them the settings panel shows a friendly "not
configured" note, and the cron route reports each gate it's blocked on.

---

## Deploy to Vercel + enable notifications

This is a one-time setup: steps 1–4 configure services (Upstash, Telegram,
a cron secret, and optionally Web Push), step 5 sets the env vars and deploys,
step 6 wires up the external scheduler that actually sends alerts and the
daily report, and step 7 sets your home location.

### 1. Create a free Upstash Redis database

1. Sign up at <https://console.upstash.com/> (free, no card).
2. **Create Database** → any name → pick a region near Singapore
   (`ap-southeast-1` / Singapore is ideal) → Free tier.
3. Open the database, scroll to **REST API**, and copy:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

### 2. Create a Telegram bot and get your chat ID

This is the primary notification channel — no APNs/VAPID complexity, no
PWA-install requirement, works identically on phone/desktop.

1. In Telegram, message **[@BotFather](https://t.me/BotFather)** → `/newbot` →
   follow the prompts (any name/username). It replies with a token that looks
   like `123456789:AAH...xyz` — that's `TELEGRAM_BOT_TOKEN`.
2. Message **your new bot** anything (e.g. "hi") — Telegram bots can't message
   you until you've messaged them first.
3. Get your numeric chat ID. Easiest way: message **[@userinfobot](https://t.me/userinfobot)**
   — it replies with your `Id`. That's `TELEGRAM_CHAT_ID`.
   (Alternative: open `https://api.telegram.org/bot<TOKEN>/getUpdates` in a
   browser after step 2 and read `message.chat.id` from the JSON.)

### 3. Generate a cron secret

```bash
openssl rand -hex 32
```

Use the output as `CRON_SECRET`. This is a password you invent, not something
to look up — it's how the scheduler proves it's allowed to trigger the checker.

### 4. (Optional) Generate VAPID keys for the dormant Web Push channel

Skip this if you're happy with Telegram-only — the app works fully without it.
Only do this if you also want browser push notifications:

```bash
npx web-push generate-vapid-keys
```

Prints a **Public Key** and **Private Key** → `VAPID_PUBLIC_KEY` /
`VAPID_PRIVATE_KEY`. `VAPID_SUBJECT` is just a contact URL, e.g.
`mailto:you@example.com`.

### 5. Set the environment variables and deploy

Copy `.env.example` to `.env.local` for local testing, and add the same keys in
Vercel under **Project → Settings → Environment Variables** (Production +
Preview):

```
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
CRON_SECRET
# Optional — only if you did step 4:
VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
VAPID_SUBJECT
```

Then deploy:

```bash
npm i -g vercel      # if you don't have the CLI
vercel               # first run: link/create the project (preview deploy)
vercel --prod        # promote to production
```

(Or push to GitHub and "Import Project" in the Vercel dashboard — either way,
set the env vars before the first production build.)

### 6. Register the external scheduler (this is what actually sends things)

**Why this is needed:** Vercel Hobby (free) cron jobs only run **once per day**
and aren't time-precise — a sub-daily entry in `vercel.json` is rejected at
deploy time. Rain warnings and a timely morning report are useless at that
cadence, so the checker is a normal protected route driven by a free external
scheduler every 15–30 minutes. Every run does three things in one call: sends
a Telegram rain alert if warranted, sends the once-daily Telegram morning
report if it's the right time and not sent yet, and checks the (empty, unless
you set up VAPID) Web Push channel.

#### Option A — cron-job.org (easiest)

1. Sign up at <https://cron-job.org/> (free).
2. **Create cronjob**:
   - **URL:** `https://YOUR-APP.vercel.app/api/cron/check-rain`
   - **Schedule:** every 15 minutes (or 30).
   - **Advanced → Headers**, add:
     `Authorization: Bearer YOUR_CRON_SECRET`
     *(or use the header `x-cron-secret: YOUR_CRON_SECRET` — the route accepts
     either.)*
   - Request method GET is fine (POST also works).
3. Save and enable.

#### Option B — GitHub Actions (already scaffolded)

This repo includes `.github/workflows/check-rain.yml`, which pings the route on
a 15-minute schedule. To use it:

1. Push the repo to GitHub.
2. In the repo, **Settings → Secrets and variables → Actions**, add:
   - Secret `CRON_SECRET` = your secret
   - Variable `APP_URL` = `https://YOUR-APP.vercel.app`
3. The workflow runs automatically. (GitHub's scheduler is best-effort and can
   lag a few minutes under load — fine for this; cron-job.org is more punctual
   if you care.)

#### Verify it's wired up

Two quick checks, both secret-protected:

```bash
# 1. Confirm the bot itself works — sends a real "✅ wired up correctly" message.
curl -s "https://YOUR-APP.vercel.app/api/cron/check-rain?test=telegram" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"

# 2. Dry-run the full checker — reports what WOULD send, sends nothing.
curl -s "https://YOUR-APP.vercel.app/api/cron/check-rain?dry=1" \
  -H "Authorization: Bearer YOUR_CRON_SECRET" | jq
```

The dry-run gives you a breakdown per channel, e.g.:

```json
{
  "checked": true,
  "sgTime": "2026-07-28T08:05",
  "report": "would-send",
  "rainAlert": { "status": "below-threshold", "peakProb": 12, "threshold": 40 },
  "push": "no-subscriptions"
}
```

`report`/`rainAlert` will read `"telegram-not-configured"` until step 2 is done,
and everything reads `{"checked":false,"reason":"no-home-location"}` until you've
saved a home (step 7 below). A `401` overall means the `CRON_SECRET` doesn't
match.

### 7. Set your home location

Open the deployed site, drop the pin on your home, and tap **"Set this pin as
my home"** in the Home & Notifications panel. That's the point the checker
watches — no browser permission prompt needed, since Telegram doesn't require
one. (The **Rain alerts** toggle in that panel is for the dormant Web Push
channel only; leave it off if you're running Telegram-only.)

> **If you also enabled Web Push (step 4):** on iOS, Safari only allows push
> for **installed** web apps — Share → **Add to Home Screen**, launch from the
> icon, then enable the toggle. The app detects and explains this if you try
> from a normal Safari tab. Not needed for Telegram, which has no such
> restriction.

---

## Tuning the laundry model

Open `lib/laundryLogic.ts`. Everything lives in `LAUNDRY_CONFIG`:

- **`scoring`** — the weights behind the 0–100 drying score. Humidity and rain
  probability dominate by design (that's how SG weather behaves). The
  **"Why this score?"** panel in the app shows each term's live contribution, so
  you can see exactly what a change does.
- **`dryTimeBands`** — score → estimated hours to dry.
- **`recommendation`** — the thresholds for Great / OK / Poor / Bring-it-in.
- **`bestWindow`** — daylight hours scanned, minimum block length, the rain
  cut-off that disqualifies a window, and `lengthBonusPerHour` (which stops the
  search from always picking the shortest possible block — see the comment).
- **`notification`** — alert threshold (default 40%), look-ahead hours, cooldown
  (default 90 min), and quiet hours (default 7am–9pm, applies to rain alerts
  only). **`notification.report`** — the morning digest: `reportHour` (default
  8am SGT) and `reportWindowHours` (default 4h catch-up window before it gives
  up on today and waits for tomorrow).

No rebuild is needed for the constants to take effect beyond the normal
Next.js hot reload in dev / redeploy in prod.

---

## Notes, limits & privacy

- **Place search coverage.** The search box uses Open-Meteo's free geocoder.
  Most major SG estates resolve (Tampines, Bedok, Jurong, Woodlands, Yishun,
  Punggol, Sentosa…), but its gazetteer is incomplete — a few names (e.g.
  *Clementi*, *Queenstown*) simply aren't in it. When search finds nothing, just
  tap the map: the pin is the primary control, search is a convenience.
- **Privacy.** Your coordinates only ever go to your own Vercel functions, which
  proxy Open-Meteo — your device's IP is never handed to the weather API
  alongside your home location. Coordinates are rounded to ~11m before storage.
  No analytics or third-party scripts run, beyond the map tiles, the Windy
  radar iframe (sandboxed, `no-referrer`), and the outbound-only Telegram Bot
  API call the cron route makes to deliver alerts.
- **Telegram bot scope.** The bot never reads messages or handles commands —
  `lib/telegram.ts` only ever calls `sendMessage`. There's no webhook and no
  polling loop, so it has no way to receive anything from you or anyone else.
- **No auth.** This is a single-user tool with one home pin. If you want to lock
  it down, enable Vercel's built-in **Deployment Protection / password** on the
  project — the app needs no code changes for that.
- **Timezone.** All forecast logic runs in `Asia/Singapore` using naive local
  timestamps (see `lib/sgTime.ts` for why that matters on a UTC serverless
  host).
- **`npm audit`.** You may see high-severity advisories from transitive
  `postcss`/`sharp` inside Next.js. npm's auto-"fix" downgrades Next.js to v9
  (a breaking change) and shouldn't be applied — wait for an upstream Next.js
  bump instead.

## Handy scripts

```bash
npm run dev         # local dev server
npm run build       # production build
npm run typecheck   # tsc --noEmit
npm run vapid       # generate VAPID keys
npm run icons       # regenerate PWA icons
```

---

Weather by [Open-Meteo](https://open-meteo.com/) · radar by Windy · tiles ©
OpenStreetMap contributors, © CARTO.
