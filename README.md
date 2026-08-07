# 🌧️ SG Laundry — Singapore Rain & Laundry Advisor

A web app to browse rain conditions and laundry-drying advice anywhere in
Singapore, plus a Telegram bot anyone can message to register a location and
get a rain-incoming alert and a daily morning digest for it.

Built to run at **$0/month**: Next.js on Vercel Hobby, Open-Meteo for weather
(no key), CARTO map tiles (no key), a Windy embed for the visual radar, Upstash
Redis free tier for the tiny bit of state, and a Telegram bot for alerts (Web
Push is also in the codebase as a dormant fallback channel — see below).

No accounts, no analytics, no trackers. The web app is a stateless locator —
open it, look up any point, nothing is saved. The Telegram bot is the stateful
part: each chat that messages it gets its own registered location, independent
of everyone else's.

---

## What it does

| Panel | What it shows | Data source |
| --- | --- | --- |
| **Locator** | Leaflet map locked to Singapore, tap/drag pin + place search | CARTO tiles, Open-Meteo geocoding |
| **Laundry advisor** | Great / OK / Poor / Bring-it-in badge, drying-time estimate, best window today, and a full score breakdown | Open-Meteo → `lib/laundryLogic.ts` |
| **Current conditions** | Temp, humidity, wind, cloud, UV in plain language | Open-Meteo `current` + `hourly` |
| **Rain timeline** | Colour-coded rain-probability bars for the next 12 hours | Open-Meteo `hourly` |
| **Live rain radar** | Windy radar loop, centred on the pin (**visual only**) | Windy embed |
| **Telegram — onboarding** | Share a Telegram Location to register it; `/setlocation` any time to change it, `/stop` to delete your data | Webhook → `app/api/telegram/webhook/route.ts` |
| **Telegram — rain alert** | Sent when rain probability crosses 90% within 2h near a chat's location — deliberately high, see the tuning section | Cron checker → `lib/telegram.ts` |
| **Telegram — daily report** | A compact, emoji-led **3-day outlook** per chat, sent at 8am daily and again ~6pm on weekdays | Cron checker → `lib/report.ts` |
| **Telegram — commands** | `/now` `/report` `/window` `/home` `/mute` `/help` — ask on demand instead of waiting | Webhook → `app/api/telegram/webhook/route.ts` |

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
    subscribe/route.ts         POST/DELETE push subscription (Web Push, dormant)
    push/public-key/route.ts   GET  VAPID public key (Web Push, dormant)
    cron/check-rain/route.ts   GET/POST protected checker — loops over every
                                registered Telegram chat, sending each its own
                                rain alert / daily report slots; also touches
                                the dormant Web Push channel, all from one call
    telegram/webhook/route.ts  POST Telegram command + location handler
                                (/setlocation, /now, /report, /window, /home,
                                /mute, /stop, /help) — the only inbound route;
                                open to any Telegram chat, gated by a webhook
                                secret rather than an allowlist
lib/
  laundryLogic.ts   ← the tunable model. All constants live in LAUNDRY_CONFIG.
  forecast.ts          joins Open-Meteo data to the model → the UI view-model
  weather.ts           Open-Meteo client + WMO code descriptions
  geo.ts               Singapore bounding box + coordinate validation
  sgTime.ts            Asia/Singapore time handling (naive-timestamp safe)
  security.ts           shared constant-time secret comparison (cron + webhook)
  store.ts             Upstash Redis persistence — per-Telegram-chat hashes
  telegram.ts          Telegram Bot API client (send only, any chat id)
  report.ts            pure message builders — alerts, morning digest, command replies
  push.ts              web-push sending (server, dormant fallback channel)
  pushClient.ts        browser subscribe/unsubscribe flow (dormant)
components/            map, panels, search — the stateless locator UI
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
keys, and the web app never touches Redis or Telegram. Only the Telegram bot
(onboarding, commands, alerts) needs the env vars below; until they're set the
webhook and cron routes report `"not-configured"` rather than erroring.

---

## Deploy to Vercel + enable notifications

This is a one-time setup: steps 1–4 configure services (Upstash, Telegram,
a cron secret, and optionally Web Push), step 5 sets the env vars and deploys,
step 6 wires up the external scheduler that actually sends alerts and daily
reports, and step 7 turns the bot on and registers its commands. After that,
*you* (and anyone else) register a location by messaging the bot — there's no
separate "set your home" step for the deployer to do.

### 1. Create a free Upstash Redis database

1. Sign up at <https://console.upstash.com/> (free, no card).
2. **Create Database** → any name → pick a region near Singapore
   (`ap-southeast-1` / Singapore is ideal) → Free tier.
3. Open the database, scroll to **REST API**, and copy:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

### 2. Create a Telegram bot

This is the primary notification channel — no APNs/VAPID complexity, no
PWA-install requirement, works identically on phone/desktop.

1. In Telegram, message **[@BotFather](https://t.me/BotFather)** → `/newbot` →
   follow the prompts (any name/username). It replies with a token that looks
   like `123456789:AAH...xyz` — that's `TELEGRAM_BOT_TOKEN`.

That's the only credential this step produces. The bot is multi-user — anyone
who finds it can register their own location — so there's no "your chat ID"
to look up as part of deployment; you'll register yourself the same way
everyone else does, in step 7.

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
TELEGRAM_WEBHOOK_SECRET
CRON_SECRET
# Optional — only if you did step 4:
VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
VAPID_SUBJECT
```

`TELEGRAM_WEBHOOK_SECRET` is generated the same way as `CRON_SECRET`
(`openssl rand -hex 32`) — it's what lets `/api/telegram/webhook` tell real
Telegram traffic apart from anyone else who finds the URL. See step 8 to
finish wiring it up after deploying.

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
deploy time. Rain warnings and a timely daily report are useless at that
cadence, so the checker is a normal protected route driven by a free external
scheduler every 15–30 minutes. Every run loops over every chat that has
registered a location and, for each one independently: sends a rain alert if
warranted, and sends any report slot that's due and not yet sent today (see
`LAUNDRY_CONFIG.notification.report.slots` — 8am daily, ~6pm on weekdays, by
default); it also checks the (empty, unless you set up VAPID) Web Push channel
once.

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

#### Option B — GitHub Actions (alternative to Option A, not both)

This repo includes `.github/workflows/check-rain.yml`, which pings the route on
a 15-minute schedule. **Only set this up if you're using it instead of
cron-job.org** — running both just means two schedulers hitting the same
endpoint.

> **Important:** GitHub activates a `schedule:`-triggered workflow the moment
> it's on your default branch — there's no separate "enable" step. If you
> don't configure the two settings below, it runs on schedule anyway and fails
> every time (harmlessly — it exits before making any network call — but it'll
> fill your Actions tab with red ✗). If you're using Option A, leave this
> workflow **disabled**: `gh workflow disable check-rain.yml`, or via
> **Actions → Check rain near home → ⋯ → Disable workflow** in the GitHub UI.

To use it instead of cron-job.org:

1. Push the repo to GitHub.
2. In the repo, **Settings → Secrets and variables → Actions**, add:
   - Secret `CRON_SECRET` = your secret
   - Variable `APP_URL` = `https://YOUR-APP.vercel.app`
3. Re-enable it if it was disabled: `gh workflow enable check-rain.yml`.
4. The workflow runs automatically. (GitHub's scheduler is best-effort and can
   lag well beyond 15 minutes, especially on a low-activity repo — cron-job.org
   is far more punctual; that's why it's the default recommendation.)

#### Verify it's wired up

Two quick checks, both secret-protected. Message your own bot once first (any
text) so Telegram knows your chat exists, then find your numeric chat id via
**[@userinfobot](https://t.me/userinfobot)** — you only need this for the test
below, not for anything the app stores.

```bash
# 1. Confirm the bot can actually reach a chat — sends a real test message.
curl -s "https://YOUR-APP.vercel.app/api/cron/check-rain?test=telegram&chatId=YOUR_CHAT_ID" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"

# 2. Dry-run the full checker — reports what WOULD send, sends nothing.
curl -s "https://YOUR-APP.vercel.app/api/cron/check-rain?dry=1" \
  -H "Authorization: Bearer YOUR_CRON_SECRET" | jq
```

Before anyone has registered a location, the dry-run reads
`{"checked":false,"reason":"no-registered-users"}` — that's expected; it fills
in once at least one chat has sent `/setlocation` (step 7). Once it does, you
get a breakdown per registered chat, e.g.:

```json
{
  "checked": true,
  "sgTime": "2026-07-28T08:05",
  "userCount": 1,
  "users": [
    {
      "chatId": "987654321",
      "home": { "lat": 1.3521, "lon": 103.8198 },
      "report": { "morning": "would-send", "evening": "outside-window" },
      "rainAlert": { "status": "below-threshold", "peakProb": 55, "threshold": 90 }
    }
  ],
  "push": "no-subscriptions"
}
```

A `401` overall means the `CRON_SECRET` doesn't match.

### 7. Turn the bot on

Two separate registrations — one tells Telegram where to deliver messages
(the webhook), the other tells Telegram what to show in the "/" menu
(cosmetic, but nice to have) — then you (and anyone else) register by talking
to the bot directly.

**a. Point Telegram at your webhook.** One-time API call, using the bot
token and the `TELEGRAM_WEBHOOK_SECRET` you just deployed:

```bash
curl -s "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://YOUR-APP.vercel.app/api/telegram/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

A `{"ok":true,...}` response confirms it. Telegram will now POST every message
sent to your bot to that URL. The bot is open to anyone who finds it — the
webhook secret proves a request genuinely came from Telegram, not that it came
from any particular person. You can check the current registration any time
with `https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo`, and
remove it with `.../deleteWebhook`.

**b. Register the command menu with [@BotFather](https://t.me/BotFather).**
Message it `/setcommands`, pick your bot, then paste:

```
now - Current rain & drying conditions
report - Get today's laundry report on demand
window - Best remaining drying window today
home - Show your saved location
setlocation - Set or change the location I watch
mute - Pause rain alerts for 2 hours
stop - Delete your data and stop all alerts
help - What this bot does and how it works
```

**c. Register a location.** Open your bot in Telegram and send `/start`, then
tap 📎 → **Location** and share where you want it to watch (must be within
Singapore). You'll get a confirmation, and from then on that chat gets its own
rain alerts and daily report. Try `/now` too — a real reply should come back
within a second or two. Anyone else who finds the bot does the exact same
thing to register their own, independent location.

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
- **`notification`** — alert threshold (default **90%** — deliberately high;
  see the comment in the config for why a lower bar just trains you to ignore
  the alert in SG's climate), look-ahead hours, cooldown (default 90 min), and
  quiet hours (default 7am–9pm, applies to rain alerts only).
  **`notification.report.slots`** — an array of named report times, each with
  an `hour`, a `windowHours` catch-up window, and `weekdaysOnly`. Defaults to
  `morning` (8am, every day) and `evening` (6pm, weekdays only). Add, remove,
  or retime slots freely — the cron checker loops over whatever's here with no
  other code changes needed, and tracks each slot's "already sent today" state
  independently per chat. **`notification.muteDurationMinutes`** (default 120)
  — how long `/mute` in Telegram pauses rain alerts for; report slots are
  unaffected by mute.

No rebuild is needed for the constants to take effect beyond the normal
Next.js hot reload in dev / redeploy in prod.

---

## Notes, limits & privacy

- **Place search coverage.** The search box uses Open-Meteo's free geocoder.
  Most major SG estates resolve (Tampines, Bedok, Jurong, Woodlands, Yishun,
  Punggol, Sentosa…), but its gazetteer is incomplete — a few names (e.g.
  *Clementi*, *Queenstown*) simply aren't in it. When search finds nothing, just
  tap the map: the pin is the primary control, search is a convenience.
- **Privacy.** Coordinates only ever go to your own Vercel functions, which
  proxy Open-Meteo — a browser's or bot user's IP is never handed to the
  weather API alongside a location. Coordinates are rounded to ~11m before
  storage. No analytics or third-party scripts run, beyond the map tiles, the
  Windy radar iframe (sandboxed, `no-referrer`), and the outbound-only
  Telegram Bot API calls the app makes to deliver alerts.
- **The bot is open to anyone on Telegram, by design.** Bot usernames are
  publicly discoverable, and there's no allowlist — the webhook (see
  `app/api/telegram/webhook/route.ts`) is gated only by a secret Telegram
  itself attaches to every genuine call, which proves the *request* is really
  from Telegram, not that any particular *person* is messaging it. Anyone who
  finds the bot can register a Singapore location and start getting alerts for
  it, independent of everyone else's. Each chat only ever gets its own data
  (its location, its cooldowns, its mute state) — there's no way for one chat
  to see or affect another's, and `/stop` deletes a chat's data completely.
  This is a deliberate, low-risk trade-off: registering just gets someone
  one-way weather alerts for a place they chose, on infrastructure that costs
  nothing either way. If you'd rather restrict it to people you approve, you'd
  need to add an allowlist check to the webhook route yourself (compare the
  incoming chat id against a list, similar to how `CRON_SECRET` gates the
  cron route today).
- **The web app has no accounts and saves nothing server-side.** It's a
  stateless locator — anyone with the URL can browse any point in Singapore,
  but there's no login, no per-visitor data, and no link between a browser
  session and any Telegram chat. If you want to keep the whole site private,
  enable Vercel's built-in **Deployment Protection / password** on the
  project — no code changes needed for that.
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
