/**
 * GET|POST /api/cron/check-rain
 * Header: Authorization: Bearer <CRON_SECRET>   (or  x-cron-secret: <CRON_SECRET>)
 *
 * WHY THIS ISN'T A VERCEL CRON: Vercel's Hobby (free) plan only permits cron
 * jobs at a once-per-day cadence, and even those aren't time-precise. A
 * `vercel.json` entry with a sub-daily schedule is rejected at deploy time.
 * Rain warnings are useless at daily granularity, so this is a plain protected
 * route driven by an external free scheduler (cron-job.org / GitHub Actions)
 * every 15-30 minutes. See the README for that setup.
 *
 * One scheduler drives THREE things each run:
 *   1. Morning report — a once-daily Telegram digest at/after `report.reportHour`.
 *   2. Rain alert     — a Telegram alert when rain is imminent near home.
 *   3. Web Push       — the original browser-push channel, now DORMANT: it only
 *                       fires if browser subscriptions exist (with Telegram as
 *                       the primary channel there usually are none, so it no-ops).
 *
 * Query params:
 *   ?dry=1            run everything and report what WOULD send, sending nothing
 *                     and touching no cooldown/date state.
 *   ?test=telegram    send a one-off test message to verify the bot is wired up.
 */

import { NextResponse } from "next/server";
import { buildForecastView, type ForecastView } from "@/lib/forecast";
import { LAUNDRY_CONFIG } from "@/lib/laundryLogic";
import { isPushConfigured, sendNotification, type SendResult } from "@/lib/push";
import { buildMorningReport, buildRainAlert } from "@/lib/report";
import { secretMatches } from "@/lib/security";
import { sgNow, type SgNow } from "@/lib/sgTime";
import {
  getHome,
  getLastRainAlertAt,
  getLastReportDate,
  getMutedUntil,
  getSubscriptions,
  isStoreConfigured,
  markNotified,
  setLastRainAlertAt,
  setLastReportDate,
  type HomeLocation,
} from "@/lib/store";
import { isTelegramConfigured, sendTelegram } from "@/lib/telegram";
import { fetchForecast } from "@/lib/weather";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorize(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const header = request.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  // Some schedulers make custom headers easier than Authorization; accept both.
  const alt = request.headers.get("x-cron-secret") ?? "";

  return (
    (bearer !== "" && secretMatches(bearer, expected)) ||
    (alt !== "" && secretMatches(alt, expected))
  );
}

function withinQuietHours(hour: number): boolean {
  const q = LAUNDRY_CONFIG.notification.quietHours;
  if (!q.enabled) return true;
  // Handles both normal (7→21) and wrapped (22→6) ranges.
  return q.startHour <= q.endHour
    ? hour >= q.startHour && hour < q.endHour
    : hour >= q.startHour || hour < q.endHour;
}

/** Peak rain probability over the next `lookaheadHours` of the timeline. */
function peakLookaheadProb(view: ForecastView, lookaheadHours: number): number {
  const window = view.timeline.slice(0, lookaheadHours).map((h) => h.precipProbPct);
  return window.length ? Math.max(...window) : 0;
}

// ---------------------------------------------------------------------------
// 1. Morning report — once per day, its own time window, ignores quiet hours.
// ---------------------------------------------------------------------------
async function maybeSendReport(
  view: ForecastView,
  home: HomeLocation,
  now: SgNow,
  dryRun: boolean
): Promise<unknown> {
  const r = LAUNDRY_CONFIG.notification.report;
  if (!r.enabled) return "disabled";
  if (!isTelegramConfigured()) return "telegram-not-configured";

  // Only inside the morning catch-up window, so a scheduler that was down all
  // morning doesn't fire a "good morning" digest in the afternoon.
  if (now.hour < r.reportHour || now.hour >= r.reportHour + r.reportWindowHours) {
    return { status: "outside-window", reportHour: r.reportHour, windowHours: r.reportWindowHours };
  }

  if ((await getLastReportDate()) === now.date) return "already-sent-today";
  if (dryRun) return "would-send";

  const res = await sendTelegram(buildMorningReport(view, home, now.date));
  if (res.ok) {
    await setLastReportDate(now.date);
    return "sent";
  }
  return { status: "failed", error: res.error };
}

// ---------------------------------------------------------------------------
// 2. Rain alert — quiet hours + threshold + single-chat cooldown.
// ---------------------------------------------------------------------------
async function maybeSendRainAlert(
  view: ForecastView,
  home: HomeLocation,
  now: SgNow,
  dryRun: boolean
): Promise<unknown> {
  const cfg = LAUNDRY_CONFIG.notification;

  // /mute in Telegram takes precedence over everything else — an explicit
  // "leave me alone" beats even a genuine rain warning until it expires.
  const mutedUntil = await getMutedUntil();
  if (mutedUntil && mutedUntil.getTime() > Date.now()) {
    return { status: "muted", until: mutedUntil.toISOString() };
  }

  if (!withinQuietHours(now.hour)) {
    return {
      status: "quiet-hours",
      activeWindow: `${cfg.quietHours.startHour}:00–${cfg.quietHours.endHour}:00`,
    };
  }

  const peakProb = peakLookaheadProb(view, cfg.lookaheadHours);
  if (peakProb < cfg.precipProbThresholdPct) {
    return { status: "below-threshold", peakProb, threshold: cfg.precipProbThresholdPct };
  }
  if (!isTelegramConfigured()) {
    return { status: "would-alert", peakProb, note: "telegram-not-configured" };
  }

  const last = await getLastRainAlertAt();
  if (last) {
    const elapsed = Date.now() - last.getTime();
    const cooldownMs = cfg.cooldownMinutes * 60_000;
    if (elapsed < cooldownMs) {
      return {
        status: "cooldown",
        peakProb,
        minutesLeft: Math.ceil((cooldownMs - elapsed) / 60_000),
      };
    }
  }

  if (dryRun) return { status: "would-send", peakProb };

  const res = await sendTelegram(buildRainAlert(peakProb, cfg.lookaheadHours, home));
  if (res.ok) {
    await setLastRainAlertAt();
    return { status: "sent", peakProb };
  }
  return { status: "failed", peakProb, error: res.error };
}

// ---------------------------------------------------------------------------
// 3. Web Push — dormant fallback. No-ops unless browser subscriptions exist.
// ---------------------------------------------------------------------------
async function maybeSendWebPush(
  view: ForecastView,
  now: SgNow,
  dryRun: boolean
): Promise<unknown> {
  if (!withinQuietHours(now.hour)) return "quiet-hours";

  const entries = Object.entries(await getSubscriptions());
  if (entries.length === 0) return "no-subscriptions";
  if (!isPushConfigured()) return "push-not-configured";

  const cfg = LAUNDRY_CONFIG.notification;
  const peakProb = peakLookaheadProb(view, cfg.lookaheadHours);
  if (peakProb < cfg.precipProbThresholdPct) {
    return { status: "below-threshold", peakProb };
  }

  const cooldownMs = cfg.cooldownMinutes * 60_000;
  const nowMs = Date.now();
  const payload = {
    title: "🌧️ Rain likely near home",
    body: `${peakProb}% chance within the next ${cfg.lookaheadHours}h — bring in your laundry.`,
    tag: "rain-incoming",
    url: "/",
  };

  const results: Array<SendResult | { key: string; status: "cooldown" | "would-send" }> = [];
  for (const [key, record] of entries) {
    if (record.lastNotifiedAt) {
      const elapsed = nowMs - new Date(record.lastNotifiedAt).getTime();
      if (elapsed < cooldownMs) {
        results.push({ key, status: "cooldown" });
        continue;
      }
    }
    if (dryRun) {
      results.push({ key, status: "would-send" });
      continue;
    }
    const result = await sendNotification(key, record, payload);
    if (result.status === "sent") await markNotified(key, new Date(nowMs));
    results.push(result);
  }
  return { peakProb, results };
}

// ---------------------------------------------------------------------------

async function handle(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isStoreConfigured()) {
    return NextResponse.json({ error: "Storage not configured" }, { status: 503 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dry") === "1";
  const now = sgNow();

  // ---- Diagnostic: verify the Telegram bot is wired up --------------------
  if (url.searchParams.get("test") === "telegram") {
    if (!isTelegramConfigured()) {
      return NextResponse.json({ error: "Telegram not configured" }, { status: 503 });
    }
    const res = await sendTelegram(
      "✅ <b>SG Laundry</b> test message — your bot is wired up correctly."
    );
    return NextResponse.json({ test: "telegram", ...res }, { status: res.ok ? 200 : 502 });
  }

  const home = await getHome();
  if (!home) {
    return NextResponse.json({ checked: false, reason: "no-home-location" });
  }

  // One fresh forecast (cache bypassed) feeds all three channels. The UI is
  // happy with a 5-minute-old response; the checker must see current data.
  const raw = await fetchForecast(home, { revalidate: 0 });
  const view = buildForecastView(home, raw);

  const [report, rainAlert, push] = await Promise.all([
    maybeSendReport(view, home, now, dryRun),
    maybeSendRainAlert(view, home, now, dryRun),
    maybeSendWebPush(view, now, dryRun),
  ]);

  return NextResponse.json({
    checked: true,
    dryRun,
    sgTime: now.hourKey,
    home: { lat: home.lat, lon: home.lon },
    report,
    rainAlert,
    push,
  });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
