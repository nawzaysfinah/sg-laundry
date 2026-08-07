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
import { dayLabel, formatDateLabel } from "./sgTime";
import type { HomeLocation } from "./store";
import { escapeHtml } from "./telegram";

const LEVEL_EMOJI: Record<RecommendationLevel, string> = {
  great: "☀️",
  ok: "⛅",
  poor: "🌥️",
  "bring-in": "🌧️",
};

function homeName(home: HomeLocation): string {
  return escapeHtml(home.label?.trim() || "home");
}

/**
 * The daily digest (sent at each configured report slot — see
 * LAUNDRY_CONFIG.notification.report.slots). One compact line per day: emoji
 * verdict, best window if there is one, peak rain chance. Deliberately terse —
 * this is a glance at a phone lock screen, not something to read line by line;
 * /report and /now still give the fuller single-moment detail on demand.
 */
export function buildDailyReport(view: ForecastView, home: HomeLocation, sgDate: string): string {
  const lines: string[] = [];
  lines.push(`🧺 <b>3-day outlook — ${homeName(home)}</b>`);
  lines.push("");

  for (const day of view.outlook) {
    const emoji = LEVEL_EMOJI[day.verdict];
    const label = dayLabel(day.date, sgDate);
    // "Today (Tue 28 Jul)" / "Tomorrow (Wed 29 Jul)" for the first two days;
    // formatDateLabel(date) === label already for day 3+, so just show it once.
    const heading =
      label === "Today" || label === "Tomorrow"
        ? `${label} (${escapeHtml(formatDateLabel(day.date))})`
        : escapeHtml(label);

    const verdictText = day.verdict === "great" ? "Great" : day.verdict === "ok" ? "OK" : "Poor";
    const windowText = day.bestWindow
      ? `window ${escapeHtml(day.bestWindow.label)}`
      : "no good window";

    lines.push(`${emoji} <b>${heading}</b> — ${verdictText} · ${windowText} · peak rain ${day.peakRainProbPct}%`);
  }

  lines.push("");
  lines.push(
    `📍 ${homeName(home)} · now: ${Math.round(view.current.tempC)}°C, ${Math.round(view.current.rh)}% humidity`
  );

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
    return "📍 You haven't set a location yet. Send /setlocation to get started.";
  }
  return `📍 <b>Location:</b> ${homeName(home)}\n${home.lat.toFixed(4)}, ${home.lon.toFixed(4)}`;
}
