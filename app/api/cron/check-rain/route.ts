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
 * Multi-user: every run loops over every chat that has registered a location
 * (via /setlocation in Telegram) and, for each one independently:
 *   1. Morning report — a once-daily Telegram digest at/after `report.reportHour`.
 *   2. Rain alert     — a Telegram alert when rain is imminent near that chat's home.
 * Web Push (the dormant fallback channel) is checked once, separately — it has
 * no per-chat location concept, and in practice has zero subscribers.
 *
 * Query params:
 *   ?dry=1                run everything and report what WOULD send, sending
 *                         nothing and touching no cooldown/date state.
 *   ?test=telegram&chatId=123   send a one-off test message to a specific chat,
 *                         to verify the bot can actually reach it.
 */

import { NextResponse } from "next/server";
import { buildForecastView, type ForecastView } from "@/lib/forecast";
import { LAUNDRY_CONFIG } from "@/lib/laundryLogic";
import { isPushConfigured } from "@/lib/push";
import { buildMorningReport, buildRainAlert } from "@/lib/report";
import { secretMatches } from "@/lib/security";
import { sgNow, type SgNow } from "@/lib/sgTime";
import {
  getAllUserHomes,
  getSubscriptions,
  getUserLastRainAlertAt,
  getUserLastReportDate,
  getUserMutedUntil,
  isStoreConfigured,
  setUserLastRainAlertAt,
  setUserLastReportDate,
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
// 1. Morning report — once per day per chat, its own time window, ignores
//    quiet hours (a digest arriving at 8am isn't the kind of thing quiet
//    hours exist to prevent).
// ---------------------------------------------------------------------------
async function maybeSendReport(
  view: ForecastView,
  home: HomeLocation,
  chatId: string,
  now: SgNow,
  dryRun: boolean
): Promise<unknown> {
  const r = LAUNDRY_CONFIG.notification.report;
  if (!r.enabled) return "disabled";

  // Only inside the morning catch-up window, so a scheduler that was down all
  // morning doesn't fire a "good morning" digest in the afternoon.
  if (now.hour < r.reportHour || now.hour >= r.reportHour + r.reportWindowHours) {
    return { status: "outside-window", reportHour: r.reportHour, windowHours: r.reportWindowHours };
  }

  if ((await getUserLastReportDate(chatId)) === now.date) return "already-sent-today";
  if (dryRun) return "would-send";

  const res = await sendTelegram(chatId, buildMorningReport(view, home, now.date));
  if (res.ok) {
    await setUserLastReportDate(chatId, now.date);
    return "sent";
  }
  return { status: "failed", error: res.error };
}

// ---------------------------------------------------------------------------
// 2. Rain alert — mute, then quiet hours, then threshold, then per-chat cooldown.
// ---------------------------------------------------------------------------
async function maybeSendRainAlert(
  view: ForecastView,
  home: HomeLocation,
  chatId: string,
  now: SgNow,
  dryRun: boolean
): Promise<unknown> {
  const cfg = LAUNDRY_CONFIG.notification;

  // /mute in Telegram takes precedence over everything else — an explicit
  // "leave me alone" beats even a genuine rain warning until it expires.
  const mutedUntil = await getUserMutedUntil(chatId);
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

  const last = await getUserLastRainAlertAt(chatId);
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

  const res = await sendTelegram(chatId, buildRainAlert(peakProb, cfg.lookaheadHours, home));
  if (res.ok) {
    await setUserLastRainAlertAt(chatId);
    return { status: "sent", peakProb };
  }
  return { status: "failed", peakProb, error: res.error };
}

/** Runs both checks for one chat's home and packages the result for the response. */
async function checkUser(chatId: string, home: HomeLocation, now: SgNow, dryRun: boolean) {
  const raw = await fetchForecast(home, { revalidate: 0 });
  const view = buildForecastView(home, raw);

  const [report, rainAlert] = await Promise.all([
    maybeSendReport(view, home, chatId, now, dryRun),
    maybeSendRainAlert(view, home, chatId, now, dryRun),
  ]);

  return { chatId, home: { lat: home.lat, lon: home.lon }, report, rainAlert };
}

// ---------------------------------------------------------------------------
// 3. Web Push — dormant fallback, no per-chat location. No-ops unless browser
//    subscriptions exist, which in practice they never do.
// ---------------------------------------------------------------------------
async function maybeSendWebPush(now: SgNow, dryRun: boolean): Promise<unknown> {
  const entries = Object.entries(await getSubscriptions());
  if (entries.length === 0) return "no-subscriptions";
  if (!isPushConfigured()) return "push-not-configured";
  if (!withinQuietHours(now.hour)) return "quiet-hours";

  // Web Push subscriptions have never carried their own location — this
  // channel predates the multi-user Telegram redesign and has no coherent
  // "home" to check rain against anymore. If it ever gets real subscribers
  // again, it needs its own location model; until then this is a no-op.
  return { status: "no-location-model", subscriberCount: entries.length };
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

  // ---- Diagnostic: verify the bot can reach a specific chat ---------------
  if (url.searchParams.get("test") === "telegram") {
    const chatId = url.searchParams.get("chatId");
    if (!chatId) {
      return NextResponse.json({ error: "?chatId= is required for this test" }, { status: 400 });
    }
    if (!isTelegramConfigured()) {
      return NextResponse.json({ error: "Telegram not configured" }, { status: 503 });
    }
    const res = await sendTelegram(
      chatId,
      "✅ <b>SG Laundry</b> test message — your bot is wired up correctly."
    );
    return NextResponse.json({ test: "telegram", chatId, ...res }, { status: res.ok ? 200 : 502 });
  }

  const homes = await getAllUserHomes();
  const entries = Object.entries(homes);

  if (entries.length === 0) {
    return NextResponse.json({ checked: false, reason: "no-registered-users" });
  }

  const [users, push] = await Promise.all([
    Promise.all(entries.map(([chatId, home]) => checkUser(chatId, home, now, dryRun))),
    maybeSendWebPush(now, dryRun),
  ]);

  return NextResponse.json({
    checked: true,
    dryRun,
    sgTime: now.hourKey,
    userCount: users.length,
    users,
    push,
  });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
