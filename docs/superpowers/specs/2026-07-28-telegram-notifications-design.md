# Telegram notifications — design

**Status:** implemented and verified · 2026-07-28

## Goal

Two automated deliveries via Telegram, replacing browser Web Push as the
primary notification channel:

1. **Rain alert** — push-style message when rain is imminent near home.
2. **Morning report** — one daily digest (~8:00 AM SGT) on whether it's a good
   day to hang laundry.

## Decisions

- **Telegram becomes the primary channel; Web Push code stays but goes
  dormant.** No cleanup needed, no functional overlap — Web Push only fires if
  browser subscriptions exist, and Telegram doesn't require any. Revisit if a
  need for browser-native alerts (not just Telegram) shows up later.
- **One scheduler drives both new deliveries, not two.** The existing 15–30 min
  external cron hitting `/api/cron/check-rain` already runs on the right
  cadence for rain alerts; the morning report piggybacks on the same route by
  checking whether it's inside a report time window and hasn't fired yet
  today. Avoids asking the user to configure a second scheduled job.
- **Report window, not exact-minute trigger.** Because the scheduler isn't
  time-precise, the report fires on the *first* run at/after `reportHour`
  (default 8am), within a `reportWindowHours` catch-up window (default 4h) —
  and is skipped for the day if the scheduler was down through the whole
  window, rather than firing a stale "good morning" hours late.
- **Idempotency via Redis, not in-memory state.** Serverless functions have no
  persistent memory between invocations, so "already sent today" and the rain
  alert cooldown are both stored in Upstash (`laundry:tg:lastReportDate`,
  `laundry:tg:lastRainAlertAt`) — same pattern already used for Web Push's
  per-subscription cooldown.
- **Outbound-only bot.** `lib/telegram.ts` only ever calls Telegram's
  `sendMessage`. No webhook, no polling, no command handling — nothing for the
  bot to receive, which keeps the attack surface at zero beyond "knows your
  chat ID and bot token."
- **Message building is pure.** `lib/report.ts` takes a `ForecastView` and
  returns a string — no I/O. Keeps the exact wording testable/tweakable
  without a live bot, mirroring how `lib/laundryLogic.ts` is kept pure.

## Components

| File | Role |
|---|---|
| `lib/telegram.ts` | `sendTelegram(text)` — one HTTPS POST to the Bot API. Degrades to a clean error when unconfigured. |
| `lib/report.ts` | `buildMorningReport(view, home, date)`, `buildRainAlert(peakProb, hours, home)` — pure string builders, HTML-escaped. |
| `lib/store.ts` | + `get/setLastRainAlertAt`, `get/setLastReportDate`. |
| `lib/laundryLogic.ts` | + `LAUNDRY_CONFIG.notification.report` (`reportHour`, `reportWindowHours`, `enabled`). |
| `app/api/cron/check-rain/route.ts` | Rewritten to fetch one forecast and fan it out to three independent, parallel channel checks: `maybeSendReport`, `maybeSendRainAlert` (Telegram), `maybeSendWebPush` (dormant). Added `?test=telegram` diagnostic. |

## Verified

- Full TypeScript build green.
- Live dry-run against real Upstash + `CRON_SECRET` (secret never logged):
  correct gating through quiet hours, report window, threshold, and
  no-subscriptions paths.
- `?test=telegram` with a syntactically-valid-but-fake token round-trips to
  Telegram's real API and surfaces `401 Unauthorized: invalid token specified`
  cleanly as a `502` — proving the send path and error handling both work
  without needing real credentials yet.
- Message text rendered via `buildMorningReport` / `buildRainAlert` against a
  live forecast: correct formatting, correct fallback to "home" when no label
  is set, correct HTML-escaping of `<`, `>`, `&` in a place label.

## Explicitly out of scope (YAGNI)

Multi-recipient support, inbound Telegram commands/interactivity, inline
buttons, changes to the web UI's push toggle (still Web Push only, as
designed).
