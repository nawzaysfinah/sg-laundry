/**
 * Builds the single view-model the UI consumes.
 *
 * This is the seam between "raw Open-Meteo arrays" and "things the screen shows".
 * Doing the join here (rather than in components) means the drying score for a
 * given hour is computed exactly once, in one place, and the timeline chart and
 * the best-window search are guaranteed to agree with each other.
 */

import type { Coords } from "./geo";
import {
  computeDryingScore,
  estimateDryHours,
  findBestWindow,
  getRecommendation,
  type BestWindow,
  type Recommendation,
} from "./laundryLogic";
import { currentHourIndex, dateOf, sgNow } from "./sgTime";
import {
  describeWeather,
  fetchForecast,
  isRainingNow,
  type OpenMeteoForecast,
  type WeatherKind,
} from "./weather";

/** How many hours of timeline the UI renders. */
export const TIMELINE_HOURS = 12;

export type HourPoint = {
  /** Naive local timestamp, "2026-07-24T13:00" */
  time: string;
  tempC: number;
  rh: number;
  windKmh: number;
  cloudCoverPct: number;
  precipProbPct: number;
  precipMm: number;
  uvIndex: number;
  score: number;
};

export type ForecastView = {
  coords: Coords;
  generatedAt: string;
  current: {
    time: string;
    tempC: number;
    rh: number;
    windKmh: number;
    cloudCoverPct: number;
    precipMm: number;
    raining: boolean;
    weatherLabel: string;
    weatherKind: WeatherKind;
    /** Drying score for right now, using the current hour's rain probability. */
    score: number;
    dryHours: number | null;
  };
  /** Next TIMELINE_HOURS hours starting from the current hour. */
  timeline: HourPoint[];
  recommendation: Recommendation;
  bestWindow: BestWindow | null;
  /** True when "today" is already too late for a full window (past ~7pm). */
  bestWindowIsTomorrow: boolean;
};

/**
 * Open-Meteo returns `precipitation_probability: null` for hours outside the
 * probabilistic model's range. Treating null as 0 would be dangerously
 * optimistic for a laundry app, so we fall back to a neutral-ish value derived
 * from cloud cover instead.
 */
function resolvePrecipProb(value: number | null, cloudCoverPct: number): number {
  if (value !== null && Number.isFinite(value)) return value;
  return Math.round(cloudCoverPct * 0.3);
}

function toHourPoints(raw: OpenMeteoForecast, from: number, count: number): HourPoint[] {
  const h = raw.hourly;
  const points: HourPoint[] = [];
  const end = Math.min(from + count, h.time.length);

  for (let i = from; i < end; i++) {
    const cloudCoverPct = h.cloud_cover[i];
    const precipProbPct = resolvePrecipProb(h.precipitation_probability[i], cloudCoverPct);
    const point: Omit<HourPoint, "score"> = {
      time: h.time[i],
      tempC: h.temperature_2m[i],
      rh: h.relative_humidity_2m[i],
      windKmh: h.wind_speed_10m[i],
      cloudCoverPct,
      precipProbPct,
      precipMm: h.precipitation[i] ?? 0,
      uvIndex: h.uv_index[i] ?? 0,
    };
    points.push({
      ...point,
      score: computeDryingScore({
        tempC: point.tempC,
        rh: point.rh,
        windKmh: point.windKmh,
        cloudCoverPct: point.cloudCoverPct,
        precipProbPct: point.precipProbPct,
      }),
    });
  }

  return points;
}

export function buildForecastView(coords: Coords, raw: OpenMeteoForecast): ForecastView {
  const now = sgNow();
  const startIdx = Math.max(0, currentHourIndex(raw.hourly.time, now));

  const timeline = toHourPoints(raw, startIdx, TIMELINE_HOURS);

  // ---- Current conditions -------------------------------------------------
  // Temp/humidity/wind come from Open-Meteo's `current` block (freshest
  // observation-adjusted values). Rain *probability* only exists hourly, so the
  // current score borrows it from the current hour of the timeline.
  const currentPrecipProb = timeline[0]?.precipProbPct ?? 0;
  const c = raw.current;
  const currentScore = computeDryingScore({
    tempC: c.temperature_2m,
    rh: c.relative_humidity_2m,
    windKmh: c.wind_speed_10m,
    cloudCoverPct: c.cloud_cover,
    precipProbPct: currentPrecipProb,
  });
  const weather = describeWeather(c.weather_code);

  // ---- Recommendation -----------------------------------------------------
  const recommendation = getRecommendation(
    currentScore,
    timeline.map((p) => p.precipProbPct)
  );

  // ---- Best window --------------------------------------------------------
  // Search the whole of today first. If today's remaining daylight can't fit a
  // window (it's evening, or the rest of the day is washed out), fall back to
  // tomorrow so the panel still tells you something useful.
  const allHours = toHourPoints(raw, 0, raw.hourly.time.length);
  const today = now.date;
  const remainingToday = allHours.filter((p) => dateOf(p.time) === today && p.time >= now.hourKey);

  let bestWindow = findBestWindow(remainingToday);
  let bestWindowIsTomorrow = false;

  if (!bestWindow) {
    const tomorrow = allHours.filter((p) => dateOf(p.time) > today);
    bestWindow = findBestWindow(tomorrow);
    bestWindowIsTomorrow = bestWindow !== null;
  }

  return {
    coords,
    generatedAt: now.hourKey,
    current: {
      time: c.time,
      tempC: c.temperature_2m,
      rh: c.relative_humidity_2m,
      windKmh: c.wind_speed_10m,
      cloudCoverPct: c.cloud_cover,
      precipMm: c.precipitation,
      raining: isRainingNow(c),
      weatherLabel: weather.label,
      weatherKind: weather.kind,
      score: currentScore,
      dryHours: estimateDryHours(currentScore),
    },
    timeline,
    recommendation,
    bestWindow,
    bestWindowIsTomorrow,
  };
}

/** Convenience: fetch + build in one call. */
export async function getForecastView(coords: Coords): Promise<ForecastView> {
  const raw = await fetchForecast(coords);
  return buildForecastView(coords, raw);
}
