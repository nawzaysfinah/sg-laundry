/**
 * Telegram message composition.
 *
 * Pure string-building from a ForecastView — no I/O, no Redis, no network — so
 * the exact wording can be unit-tested and tweaked without a live bot. The
 * cron route decides *whether* to send; this module decides *what* it says.
 */

import type { ForecastView } from "./forecast";
import type { RecommendationLevel } from "./laundryLogic";
import { formatDryHours } from "./laundryLogic";
import { SG_TIMEZONE, formatHourShort } from "./sgTime";
import type { HomeLocation } from "./store";
import { escapeHtml } from "./telegram";

const LEVEL_EMOJI: Record<RecommendationLevel, string> = {
  great: "☀️",
  ok: "⛅",
  poor: "🌥️",
  "bring-in": "🌧️",
};

/** "Sat 25 Jul" from an SG date string "2026-07-25". */
function formatDateLabel(sgDate: string): string {
  // Anchor at local noon so formatting can never slip to an adjacent day.
  const d = new Date(`${sgDate}T12:00:00+08:00`);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: SG_TIMEZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(d);
}

function homeName(home: HomeLocation): string {
  return escapeHtml(home.label?.trim() || "home");
}

/** Peak rain hour across the forecast timeline (≈ the rest of the laundry day). */
function peakRain(view: ForecastView): { prob: number; when: string } | null {
  if (view.timeline.length === 0) return null;
  let best = view.timeline[0];
  for (const h of view.timeline) if (h.precipProbPct > best.precipProbPct) best = h;
  return { prob: best.precipProbPct, when: formatHourShort(best.time) };
}

/**
 * The once-daily morning digest. Built to be skimmable at a glance on a phone
 * lock screen: verdict first, then the one actionable number (best window),
 * then context.
 */
export function buildMorningReport(view: ForecastView, home: HomeLocation, sgDate: string): string {
  const { current, recommendation, bestWindow, bestWindowIsTomorrow } = view;
  const emoji = LEVEL_EMOJI[recommendation.level];
  const peak = peakRain(view);

  const lines: string[] = [];
  lines.push(`🧺 <b>Laundry outlook — ${escapeHtml(formatDateLabel(sgDate))}</b>`);
  lines.push(`${homeName(home)} · ${Math.round(current.tempC)}°C, ${Math.round(current.rh)}% humidity`);
  lines.push("");
  lines.push(`${emoji} <b>${escapeHtml(recommendation.headline)}</b>`);
  lines.push(escapeHtml(recommendation.detail));
  lines.push("");

  if (bestWindow) {
    const when = bestWindowIsTomorrow ? "tomorrow" : "today";
    lines.push(
      `🕒 <b>Best window ${when}:</b> ${escapeHtml(bestWindow.label)} (${bestWindow.hours}h, avg score ${bestWindow.averageScore})`
    );
  } else {
    lines.push("🕒 <b>No good drying window</b> in today's forecast.");
  }

  lines.push(`💧 <b>Drying time now:</b> ${escapeHtml(formatDryHours(current.dryHours))}`);

  if (peak) {
    lines.push(`🌧️ <b>Peak rain chance:</b> ${peak.prob}% around ${escapeHtml(peak.when)}`);
  }

  return lines.join("\n");
}

/**
 * The event-driven rain alert. Short and urgent — it fires when rain is
 * imminent and the whole message needs to land in a notification preview.
 */
export function buildRainAlert(
  peakProb: number,
  lookaheadHours: number,
  home: HomeLocation
): string {
  return (
    `🌧️ <b>Rain likely near ${homeName(home)}</b>\n` +
    `${peakProb}% chance within the next ${lookaheadHours}h — bring in your laundry.`
  );
}

// ---------------------------------------------------------------------------
// On-demand Telegram command replies (/now, /window, /home)
// ---------------------------------------------------------------------------

/** Reply to /now — current conditions + drying score at home, on demand. */
export function buildNowReply(view: ForecastView, home: HomeLocation): string {
  const { current } = view;
  const emoji = LEVEL_EMOJI[view.recommendation.level];
  const nextHourProb = view.timeline[0]?.precipProbPct ?? 0;

  const lines = [
    `📍 <b>${homeName(home)}</b> — ${Math.round(current.tempC)}°C, ${escapeHtml(current.weatherLabel)}`,
    `💧 Humidity ${Math.round(current.rh)}% · Wind ${Math.round(current.windKmh)} km/h · Cloud ${Math.round(current.cloudCoverPct)}%`,
    "",
    `${emoji} <b>Drying score: ${current.score}/100</b> — ${escapeHtml(view.recommendation.badge)}`,
    `🌧️ Rain in the next hour: ${nextHourProb}%`,
    `⏱️ ${escapeHtml(formatDryHours(current.dryHours))}`,
  ];
  return lines.join("\n");
}

/** Reply to /window — just the best-drying-window part of the forecast. */
export function buildWindowReply(view: ForecastView): string {
  const { bestWindow, bestWindowIsTomorrow } = view;
  if (!bestWindow) {
    return "🕒 No good drying window in the forecast right now — every daylight stretch is either too wet or too humid.";
  }
  const when = bestWindowIsTomorrow ? "tomorrow" : "today";
  return `🕒 <b>Best window ${when}:</b> ${escapeHtml(bestWindow.label)} (${bestWindow.hours}h, avg score ${bestWindow.averageScore})`;
}

/** Reply to /home — show the saved home location, or say there isn't one. */
export function buildHomeReply(home: HomeLocation | null): string {
  if (!home) {
    return "📍 No home location set yet. Open the web app, drop a pin, and tap “Set this pin as my home.”";
  }
  return `📍 <b>Home:</b> ${homeName(home)}\n${home.lat.toFixed(4)}, ${home.lon.toFixed(4)}`;
}
