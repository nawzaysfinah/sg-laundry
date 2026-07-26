/**
 * Singapore-time helpers.
 *
 * WHY THIS EXISTS: Open-Meteo, when called with `timezone=Asia/Singapore`,
 * returns timestamps as *naive local* strings — "2026-07-24T13:00", with no
 * offset suffix. Passing those to `new Date()` makes the JS engine interpret
 * them in whatever timezone the runtime happens to be in. On Vercel that's UTC,
 * which would silently shift every hour by 8. So we never round-trip forecast
 * timestamps through `Date`. Instead we compare the raw strings, and derive
 * "what time is it in Singapore right now" as a matching string via Intl.
 */

export const SG_TIMEZONE = "Asia/Singapore";

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SG_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export type SgNow = {
  /** "2026-07-24" */
  date: string;
  /** 0-23 */
  hour: number;
  /** 0-59 */
  minute: number;
  /** "2026-07-24T13:00" — directly comparable to Open-Meteo hourly.time entries */
  hourKey: string;
};

/** Current wall-clock time in Singapore, as comparable string parts. */
export function sgNow(at: Date = new Date()): SgNow {
  const parts = partsFormatter.formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";

  const date = `${get("year")}-${get("month")}-${get("day")}`;
  // Intl can emit "24" for midnight in some ICU versions; normalise it.
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));

  return {
    date,
    hour,
    minute,
    hourKey: `${date}T${String(hour).padStart(2, "0")}:00`,
  };
}

/** Extract the hour-of-day (0-23) from a naive "YYYY-MM-DDTHH:mm" string. */
export function hourOf(isoLocal: string): number {
  return Number(isoLocal.slice(11, 13));
}

/** Extract the date part ("YYYY-MM-DD") from a naive local timestamp. */
export function dateOf(isoLocal: string): string {
  return isoLocal.slice(0, 10);
}

/** Format a naive local timestamp as "14:00" for display. */
export function formatHour(isoLocal: string): string {
  return isoLocal.slice(11, 16);
}

/** Format a naive local timestamp as "2pm" — compact, for tight mobile labels. */
export function formatHourShort(isoLocal: string): string {
  const h = hourOf(isoLocal);
  if (h === 0) return "12am";
  if (h === 12) return "12pm";
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

/**
 * Index of the current (or next upcoming) hour within an Open-Meteo
 * `hourly.time` array. Returns 0 if the array starts in the future and -1 if it
 * has already ended.
 */
export function currentHourIndex(times: string[], now: SgNow = sgNow()): number {
  const idx = times.indexOf(now.hourKey);
  if (idx !== -1) return idx;
  // Fall back to the first entry at or after "now" (handles a forecast window
  // that starts later today, or a DST-free but otherwise odd boundary).
  const next = times.findIndex((t) => t >= now.hourKey);
  return next;
}
