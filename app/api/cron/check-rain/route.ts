/**
 * GET|POST /api/cron/check-rain
 * Header: Authorization: Bearer <CRON_SECRET>
 *
 * WHY THIS ISN'T A VERCEL CRON: Vercel's Hobby (free) plan only permits cron
 * jobs at a once-per-day cadence, and even those aren't time-precise. A
 * `vercel.json` entry with a sub-daily schedule is rejected at deploy time.
 * Rain warnings are useless at daily granularity, so this is a plain protected
 * route driven by an external free scheduler (cron-job.org / GitHub Actions)
 * every 15-30 minutes. See the README for that setup.
 *
 * Supports `?dry=1` to run every check and report what *would* be sent, without
 * actually sending or touching the cooldown. Useful for verifying setup.
 */

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { LAUNDRY_CONFIG } from "@/lib/laundryLogic";
import { isPushConfigured, sendNotification, type SendResult } from "@/lib/push";
import { currentHourIndex, sgNow } from "@/lib/sgTime";
import { getHome, getSubscriptions, isStoreConfigured, markNotified } from "@/lib/store";
import { fetchForecast } from "@/lib/weather";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Constant-time secret comparison — avoids leaking the secret via timing. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

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

async function handle(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isStoreConfigured()) {
    return NextResponse.json({ error: "Storage not configured" }, { status: 503 });
  }

  const dryRun = new URL(request.url).searchParams.get("dry") === "1";
  const cfg = LAUNDRY_CONFIG.notification;
  const now = sgNow();

  // ---- Quiet hours --------------------------------------------------------
  if (!withinQuietHours(now.hour)) {
    return NextResponse.json({
      checked: false,
      reason: "quiet-hours",
      sgHour: now.hour,
      activeWindow: `${cfg.quietHours.startHour}:00–${cfg.quietHours.endHour}:00`,
    });
  }

  // ---- What are we watching, and who wants to know? -----------------------
  const [home, subscriptions] = await Promise.all([getHome(), getSubscriptions()]);

  if (!home) {
    return NextResponse.json({ checked: false, reason: "no-home-location" });
  }
  const entries = Object.entries(subscriptions);
  if (entries.length === 0) {
    return NextResponse.json({ checked: false, reason: "no-subscriptions" });
  }
  if (!isPushConfigured()) {
    return NextResponse.json({ error: "Push not configured" }, { status: 503 });
  }

  // ---- Is rain coming? ----------------------------------------------------
  // Bypass the shared forecast cache here: the checker runs every 15-30 min and
  // must see fresh data, whereas the UI is happy with a 5-minute-old response.
  const raw = await fetchForecast(home, { revalidate: 0 });
  const startIdx = Math.max(0, currentHourIndex(raw.hourly.time, now));

  const lookahead = raw.hourly.precipitation_probability
    .slice(startIdx, startIdx + cfg.lookaheadHours)
    .map((v, i) =>
      v ?? Math.round((raw.hourly.cloud_cover[startIdx + i] ?? 0) * 0.3)
    );

  const peakProb = lookahead.length ? Math.max(...lookahead) : 0;
  const willRain = peakProb >= cfg.precipProbThresholdPct;

  if (!willRain) {
    return NextResponse.json({
      checked: true,
      notified: false,
      reason: "below-threshold",
      peakProb,
      threshold: cfg.precipProbThresholdPct,
      lookaheadHours: cfg.lookaheadHours,
    });
  }

  // ---- Notify, respecting the per-subscription cooldown -------------------
  const cooldownMs = cfg.cooldownMinutes * 60_000;
  const nowMs = Date.now();

  const payload = {
    title: "🌧️ Rain likely near home",
    body: `${peakProb}% chance within the next ${cfg.lookaheadHours}h — bring in your laundry.`,
    tag: "rain-incoming",
    url: "/",
  };

  const results: Array<SendResult | { key: string; status: "cooldown"; minutesLeft: number }> = [];

  for (const [key, record] of entries) {
    if (record.lastNotifiedAt) {
      const elapsed = nowMs - new Date(record.lastNotifiedAt).getTime();
      if (elapsed < cooldownMs) {
        results.push({
          key,
          status: "cooldown",
          minutesLeft: Math.ceil((cooldownMs - elapsed) / 60_000),
        });
        continue;
      }
    }

    if (dryRun) {
      results.push({ key, status: "sent" });
      continue;
    }

    const result = await sendNotification(key, record, payload);
    if (result.status === "sent") await markNotified(key, new Date(nowMs));
    results.push(result);
  }

  const sent = results.filter((r) => r.status === "sent").length;

  return NextResponse.json({
    checked: true,
    dryRun,
    notified: sent > 0,
    sent,
    peakProb,
    threshold: cfg.precipProbThresholdPct,
    home: { lat: home.lat, lon: home.lon },
    results,
  });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
