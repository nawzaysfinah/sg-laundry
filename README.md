# 🌧️ SG Laundry — Singapore Rain & Laundry Advisor

Drop a pin anywhere in Singapore to see current & upcoming rain, a transparent
laundry-drying recommendation, and (optionally) get a push notification when
rain is heading for your home.

Built to run at **$0/month**: Next.js on Vercel Hobby, Open-Meteo for weather
(no key), CARTO map tiles (no key), a Windy embed for the visual radar, Upstash
Redis free tier for the tiny bit of state, and Web Push for alerts.

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
| **Home & notifications** | Save a home pin, toggle rain alerts | Upstash Redis + Web Push |

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
    subscribe/route.ts         POST/DELETE push subscription
    push/public-key/route.ts   GET  VAPID public key
    cron/check-rain/route.ts   GET/POST protected rain checker (external cron)
lib/
  laundryLogic.ts   ← the tunable model. All constants live in LAUNDRY_CONFIG.
  forecast.ts          joins Open-Meteo data to the model → the UI view-model
  weather.ts           Open-Meteo client + WMO code descriptions
  geo.ts               Singapore bounding box + coordinate validation
  sgTime.ts            Asia/Singapore time handling (naive-timestamp safe)
  store.ts             Upstash Redis persistence
  push.ts              web-push sending (server)
  pushClient.ts        browser subscribe/unsubscribe flow
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
keys. Only the *home location* and *push notifications* need the env vars below;
until you set them the settings panel shows a friendly "not configured" note.

---

## Deploy to Vercel + enable notifications

This is a one-time setup. Steps 1–4 configure services; step 5 deploys; step 6
wires up the external scheduler that actually sends the alerts.

### 1. Create a free Upstash Redis database

1. Sign up at <https://console.upstash.com/> (free, no card).
2. **Create Database** → any name → pick a region near Singapore
   (`ap-southeast-1` / Singapore is ideal) → Free tier.
3. Open the database, scroll to **REST API**, and copy:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

### 2. Generate VAPID keys (for Web Push)

```bash
npx web-push generate-vapid-keys
```

This prints a **Public Key** and **Private Key**. You'll set them as
`VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`. `VAPID_SUBJECT` is just a contact
URL — your own email as `mailto:you@example.com` is fine.

### 3. Generate a cron secret

```bash
openssl rand -hex 32
```

Use the output as `CRON_SECRET`.

### 4. Set the environment variables

Copy `.env.example` to `.env.local` for local testing, and add the **same** keys
in Vercel under **Project → Settings → Environment Variables** (Production +
Preview). Full list:

```
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
VAPID_SUBJECT           # e.g. mailto:you@example.com
CRON_SECRET
```

### 5. Deploy

```bash
npm i -g vercel      # if you don't have the CLI
vercel               # first run: link/create the project (preview deploy)
vercel --prod        # promote to production
```

(Or push the repo to GitHub and "Import Project" in the Vercel dashboard —
either way, make sure the six env vars are set before the first production
build.)

After deploying, open the site on your phone, drop a pin on your home, tap
**"Set this pin as my home"**, then flip on **Rain alerts** and accept the
browser permission prompt.

> **iOS note:** Safari only allows Web Push for **installed** web apps. On your
> iPhone, open the site in Safari → Share → **Add to Home Screen**, launch it
> from the new icon, *then* enable alerts. The app detects this and tells you if
> you try to enable alerts from a normal Safari tab. Android/desktop Chrome work
> without installing.

### 6. Register the external scheduler (this is what sends the alerts)

**Why this is needed:** Vercel Hobby (free) cron jobs only run **once per day**
and aren't time-precise — a sub-daily entry in `vercel.json` is rejected at
deploy time. Rain warnings are useless at that cadence, so the checker is a
normal protected route driven by a free external scheduler every 15–30 minutes.

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

`?dry=1` runs the whole check and reports what *would* be sent, without sending
anything or touching the cooldown:

```bash
curl -s "https://YOUR-APP.vercel.app/api/cron/check-rain?dry=1" \
  -H "Authorization: Bearer YOUR_CRON_SECRET" | jq
```

You should get JSON like `{"checked":true,"notified":false,"peakProb":18,...}`
(or `{"checked":false,"reason":"no-home-location"}` until you've saved a home
and subscribed). A `401` means the secret/header don't match.

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
  (default 90 min), and quiet hours (default 7am–9pm).

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
  No analytics or third-party scripts run, beyond the map tiles and the Windy
  radar iframe (sandboxed, `no-referrer`).
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
