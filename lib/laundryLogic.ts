/**
 * Laundry drying model.
 *
 * This is intentionally a transparent, hand-tuned heuristic rather than
 * anything learned or hidden. Every constant lives in LAUNDRY_CONFIG below with
 * a note on what it does and why it's set where it is, so you can adjust it as
 * you learn how your own balcony/corridor actually behaves.
 *
 * The model is pure: it takes numbers in, gives numbers out, does no I/O and
 * knows nothing about React or Open-Meteo. That means you can tweak a constant
 * and reason about the effect without running the app.
 */

import { dateOf, formatHour, hourOf } from "./sgTime";

// ---------------------------------------------------------------------------
// Tunable configuration — this is the part you'll want to edit.
// ---------------------------------------------------------------------------

export const LAUNDRY_CONFIG = {
  scoring: {
    /**
     * Relative humidity is the dominant drag on drying in Singapore. RH below
     * `comfortableRh` costs nothing; above it, each percentage point costs
     * `penaltyPerPoint`. SG typically sits at 70-90% RH, so this term alone
     * usually removes 18-36 points — which is realistic.
     */
    humidity: { comfortableRh: 50, penaltyPerPoint: 0.9 },

    /**
     * Warmth accelerates evaporation. SG rarely drops below 28°C during the
     * day, and when it does it's usually *because* it's raining or overcast —
     * so this doubles as a weak proxy for "something's wrong".
     */
    temperature: { idealTempC: 28, penaltyPerDegreeBelow: 2 },

    /**
     * Airflow carries saturated air away from the fabric. Capped, because past
     * ~20 km/h the marginal benefit flattens out (and your clothes start
     * leaving the rack). Worth raising the cap if you're in a high floor unit
     * with strong corridor wind.
     */
    wind: { capKmh: 20, bonusPerKmh: 1.2 },

    /** Cloud cover blocks the sun. Full overcast costs 15 points. */
    cloud: { penaltyPerPercent: 0.15 },

    /**
     * Rain probability dominates: a 60% chance of rain removes 90 points on its
     * own, which is what makes the score collapse ahead of a storm rather than
     * after it starts.
     */
    precipProb: { penaltyPerPercent: 1.5 },
  },

  /**
   * Score → estimated hours to dry a normal load hung outdoors.
   * Evaluated top-down; the first band whose `minScore` is met wins.
   * A null `hours` means "won't realistically dry outdoors".
   */
  dryTimeBands: [
    { minScore: 80, hours: 2.5 },
    { minScore: 60, hours: 3.5 },
    { minScore: 40, hours: 5 },
    { minScore: 20, hours: 7 },
    { minScore: 0, hours: null },
  ] as ReadonlyArray<{ minScore: number; hours: number | null }>,

  recommendation: {
    /** Next-hour rain probability at/above this → "bring it in now" (red). */
    bringInNextHourPrecipProbPct: 50,
    /** Score at/above this, plus a calm next 3h, earns a green light. */
    greatMinScore: 70,
    /** Max next-3h rain probability still considered "clear ahead". */
    greatMaxNext3hPrecipProbPct: 20,
    /** Score at/above this is amber ("OK, watch the afternoon"). */
    okMinScore: 40,
    /** How many hours ahead the "clear ahead" check looks. */
    lookaheadHours: 3,
  },

  bestWindow: {
    /** Only consider daylight hanging hours, inclusive start, exclusive end. */
    startHour: 6,
    endHour: 19,
    /** Shortest block we'd bother calling a "window". */
    minBlockHours: 2,
    /** Longest block to consider — beyond this you'd bring it in anyway. */
    maxBlockHours: 8,
    /**
     * A window is disqualified outright if any hour in it exceeds this rain
     * probability, even when the block's average score looks good. Prevents
     * recommending 10:00-14:00 when 12:00 is a 70% thunderstorm.
     */
    maxHourlyPrecipProbPct: 45,
    /**
     * Ranking bonus per extra hour of window length.
     *
     * WHY THIS IS NEEDED: ranking purely by average score is structurally
     * biased toward the *shortest* legal block, because every hour you add
     * drags the average back toward the mean. Without a length bonus the
     * answer is almost always exactly `minBlockHours`. That's the wrong
     * advice — a 5-hour window averaging 68 beats a 2-hour window averaging
     * 71, since a load needs ~3.5 hours to dry in the first place.
     *
     * 1.5 means an extra hour is worth 1.5 points of average score. Set to 0
     * for pure highest-average behaviour; raise it if you want the app to
     * favour long, lazy windows even more strongly.
     */
    lengthBonusPerHour: 1.5,
  },

  notification: {
    /** Rain probability that triggers a push. */
    precipProbThresholdPct: 40,
    /** How many hours ahead the checker looks (1 = next hour only). */
    lookaheadHours: 2,
    /** Don't push again within this many minutes, even if it still qualifies. */
    cooldownMinutes: 90,
    /**
     * Quiet hours: only notify between these SG hours (inclusive start,
     * exclusive end). Set `enabled: false` to be woken at 3am.
     */
    quietHours: { enabled: true, startHour: 7, endHour: 21 },
  },
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DryingInputs = {
  tempC: number;
  rh: number;
  windKmh: number;
  cloudCoverPct: number;
  precipProbPct: number;
};

export type RecommendationLevel = "bring-in" | "great" | "ok" | "poor";

export type Recommendation = {
  level: RecommendationLevel;
  /** Short badge text, e.g. "Great" */
  badge: string;
  /** Full sentence for the panel. */
  headline: string;
  /** One line of supporting detail. */
  detail: string;
};

export type BestWindow = {
  /** Naive local timestamp of the first hour in the block. */
  start: string;
  /** Naive local timestamp of the hour *after* the last hour in the block. */
  end: string;
  /** "10:00 – 14:00" */
  label: string;
  hours: number;
  averageScore: number;
};

// ---------------------------------------------------------------------------
// Core model
// ---------------------------------------------------------------------------

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 0-100 drying score for a single hour. Higher is better.
 * See LAUNDRY_CONFIG.scoring for what each term is doing.
 */
export function computeDryingScore({
  tempC,
  rh,
  windKmh,
  cloudCoverPct,
  precipProbPct,
}: DryingInputs): number {
  const c = LAUNDRY_CONFIG.scoring;
  let score = 100;

  score -= Math.max(0, rh - c.humidity.comfortableRh) * c.humidity.penaltyPerPoint;
  score -=
    Math.max(0, c.temperature.idealTempC - tempC) *
    c.temperature.penaltyPerDegreeBelow;
  score += Math.min(windKmh, c.wind.capKmh) * c.wind.bonusPerKmh;
  score -= cloudCoverPct * c.cloud.penaltyPerPercent;
  score -= precipProbPct * c.precipProb.penaltyPerPercent;

  return clamp(Math.round(score), 0, 100);
}

/** Estimated hours for a load to dry outdoors, or null if it won't. */
export function estimateDryHours(score: number): number | null {
  for (const band of LAUNDRY_CONFIG.dryTimeBands) {
    if (score >= band.minScore) return band.hours;
  }
  return null;
}

/**
 * Turn a current score plus the immediate rain outlook into an actionable
 * recommendation. `upcomingPrecipProb` is the next N hours of probability,
 * ordered soonest-first, starting with the current hour.
 */
export function getRecommendation(
  score: number,
  upcomingPrecipProb: number[]
): Recommendation {
  const r = LAUNDRY_CONFIG.recommendation;
  const nextHour = upcomingPrecipProb[0] ?? 0;
  const lookahead = upcomingPrecipProb.slice(0, r.lookaheadHours);
  const maxSoon = lookahead.length ? Math.max(...lookahead) : 0;

  if (nextHour >= r.bringInNextHourPrecipProbPct) {
    return {
      level: "bring-in",
      badge: "Bring it in",
      headline: "Bring your laundry in now",
      detail: `${Math.round(nextHour)}% chance of rain within the hour.`,
    };
  }

  if (score >= r.greatMinScore && maxSoon < r.greatMaxNext3hPrecipProbPct) {
    return {
      level: "great",
      badge: "Great",
      headline: "Great time to hang laundry",
      detail: `Clear for the next ${r.lookaheadHours}h — peak rain chance is only ${Math.round(maxSoon)}%.`,
    };
  }

  if (score >= r.okMinScore) {
    return {
      level: "ok",
      badge: "OK",
      headline: "OK, but keep an eye on the afternoon",
      detail:
        maxSoon >= r.greatMaxNext3hPrecipProbPct
          ? `Rain chance climbs to ${Math.round(maxSoon)}% within ${r.lookaheadHours}h — SG storms usually build 1–4pm.`
          : "Drying will be slow. SG storms usually build 1–4pm.",
    };
  }

  return {
    level: "poor",
    badge: "Poor",
    headline: "Poor drying conditions",
    detail: "Humid and/or unsettled — consider indoors or the dryer.",
  };
}

/**
 * Find today's best contiguous stretch for hanging laundry.
 *
 * Scans daylight hours only, tries every block length from `minBlockHours` up
 * to `maxBlockHours`, discards any block containing a high-rain-probability
 * hour, and ranks what's left by average score plus a length bonus (see
 * `lengthBonusPerHour` for why the bonus is necessary). Ties go to the earlier
 * start, since the first `>` comparison wins.
 *
 * `hours` must be same-day, ordered, and already filtered to the target date.
 */
export function findBestWindow(
  hours: Array<{ time: string; score: number; precipProbPct: number }>
): BestWindow | null {
  const cfg = LAUNDRY_CONFIG.bestWindow;

  const candidates = hours.filter((h) => {
    const hour = hourOf(h.time);
    return hour >= cfg.startHour && hour < cfg.endHour;
  });

  if (candidates.length < cfg.minBlockHours) return null;

  let best: BestWindow | null = null;
  let bestRank = -Infinity;

  for (let start = 0; start < candidates.length; start++) {
    const maxLen = Math.min(cfg.maxBlockHours, candidates.length - start);

    for (let len = cfg.minBlockHours; len <= maxLen; len++) {
      const block = candidates.slice(start, start + len);

      // Reject the whole block if any single hour is too wet.
      if (block.some((h) => h.precipProbPct > cfg.maxHourlyPrecipProbPct)) {
        break; // longer blocks from this start will also contain that hour
      }

      // Reject blocks that aren't contiguous in wall-clock terms (e.g. the
      // forecast window ended mid-day and resumed tomorrow).
      const contiguous = block.every(
        (h, i) => i === 0 || hourOf(h.time) === hourOf(block[i - 1].time) + 1
      );
      if (!contiguous) break;

      const averageScore =
        block.reduce((sum, h) => sum + h.score, 0) / block.length;

      // Rank on average score plus a length bonus, so a long good window can
      // beat a short slightly-better one. Displayed score stays the true average.
      const rank =
        averageScore + (block.length - cfg.minBlockHours) * cfg.lengthBonusPerHour;

      if (rank > bestRank) {
        bestRank = rank;
        const last = block[block.length - 1];
        const endHour = hourOf(last.time) + 1;
        const endLabel = `${String(endHour).padStart(2, "0")}:00`;
        best = {
          start: block[0].time,
          end: `${dateOf(last.time)}T${endLabel}`,
          label: `${formatHour(block[0].time)} – ${endLabel}`,
          hours: block.length,
          averageScore: Math.round(averageScore),
        };
      }
    }
  }

  return best;
}

/** Human-readable dry-time, e.g. "about 3½ hours". */
export function formatDryHours(hours: number | null): string {
  if (hours === null) return "unlikely to dry outdoors";
  const whole = Math.floor(hours);
  const half = hours - whole >= 0.5;
  if (whole === 0) return "under an hour";
  return `about ${whole}${half ? "½" : ""} hour${whole > 1 || half ? "s" : ""}`;
}
