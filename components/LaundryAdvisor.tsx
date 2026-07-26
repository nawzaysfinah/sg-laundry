"use client";

import { useState } from "react";
import type { ForecastView } from "@/lib/forecast";
import {
  LAUNDRY_CONFIG,
  formatDryHours,
  type RecommendationLevel,
} from "@/lib/laundryLogic";
import { Card, Skeleton } from "./ui";

const LEVEL_STYLES: Record<
  RecommendationLevel,
  { badge: string; ring: string; text: string; bar: string }
> = {
  great: {
    badge: "bg-emerald-400/15 text-emerald-300 border-emerald-400/30",
    ring: "stroke-emerald-400",
    text: "text-emerald-300",
    bar: "bg-emerald-400",
  },
  ok: {
    badge: "bg-amber-400/15 text-amber-300 border-amber-400/30",
    ring: "stroke-amber-400",
    text: "text-amber-300",
    bar: "bg-amber-400",
  },
  poor: {
    badge: "bg-orange-500/15 text-orange-300 border-orange-500/30",
    ring: "stroke-orange-400",
    text: "text-orange-300",
    bar: "bg-orange-400",
  },
  "bring-in": {
    badge: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    ring: "stroke-rose-400",
    text: "text-rose-300",
    bar: "bg-rose-400",
  },
};

/** Circular score gauge. */
function ScoreRing({ score, className }: { score: number; className: string }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const dash = (score / 100) * circumference;

  return (
    <div className="relative h-24 w-24 shrink-0">
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
        <circle cx="40" cy="40" r={radius} className="stroke-white/10" strokeWidth="6" fill="none" />
        <circle
          cx="40"
          cy="40"
          r={radius}
          className={`${className} transition-all duration-500`}
          strokeWidth="6"
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${dash} ${circumference}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold tabular-nums text-white">{score}</span>
        <span className="text-[9px] uppercase tracking-wider text-slate-500">score</span>
      </div>
    </div>
  );
}

/**
 * Score breakdown.
 *
 * The whole point of a hand-tuned heuristic is that you can see why it said
 * what it said — otherwise you can't tell a bad forecast from a bad constant.
 * These recompute each term from the same config the model uses, so they can't
 * drift out of sync with the score above.
 */
function Breakdown({ forecast }: { forecast: ForecastView }) {
  const c = LAUNDRY_CONFIG.scoring;
  const { current, timeline } = forecast;
  const precipProb = timeline[0]?.precipProbPct ?? 0;

  const rows: Array<{ label: string; delta: number; detail: string }> = [
    {
      label: "Humidity",
      delta: -Math.max(0, current.rh - c.humidity.comfortableRh) * c.humidity.penaltyPerPoint,
      detail: `${Math.round(current.rh)}% RH`,
    },
    {
      label: "Rain chance",
      delta: -precipProb * c.precipProb.penaltyPerPercent,
      detail: `${precipProb}% this hour`,
    },
    {
      label: "Cloud cover",
      delta: -current.cloudCoverPct * c.cloud.penaltyPerPercent,
      detail: `${Math.round(current.cloudCoverPct)}% covered`,
    },
    {
      label: "Wind",
      delta: Math.min(current.windKmh, c.wind.capKmh) * c.wind.bonusPerKmh,
      detail: `${Math.round(current.windKmh)} km/h`,
    },
    {
      label: "Temperature",
      delta:
        -Math.max(0, c.temperature.idealTempC - current.tempC) *
        c.temperature.penaltyPerDegreeBelow,
      detail: `${Math.round(current.tempC)}°C`,
    },
  ];

  return (
    <dl className="mt-3 space-y-1.5 border-t border-white/10 pt-3">
      <div className="flex items-baseline justify-between text-xs text-slate-500">
        <dt>Starting score</dt>
        <dd className="tabular-nums">100</dd>
      </div>
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline justify-between gap-3 text-xs">
          <dt className="text-slate-400">
            {row.label} <span className="text-slate-600">· {row.detail}</span>
          </dt>
          <dd
            className={`shrink-0 tabular-nums ${
              row.delta > 0.05
                ? "text-emerald-400"
                : row.delta < -0.05
                  ? "text-rose-400"
                  : "text-slate-600"
            }`}
          >
            {row.delta > 0 ? "+" : ""}
            {row.delta.toFixed(1)}
          </dd>
        </div>
      ))}
      <p className="pt-1 text-[11px] leading-relaxed text-slate-600">
        Tune these weights in <code className="text-slate-500">lib/laundryLogic.ts</code> →{" "}
        <code className="text-slate-500">LAUNDRY_CONFIG.scoring</code>.
      </p>
    </dl>
  );
}

export function LaundryAdvisor({ forecast }: { forecast: ForecastView | null }) {
  const [showWhy, setShowWhy] = useState(false);

  if (!forecast) {
    return (
      <Card title="Laundry advisor">
        <Skeleton className="h-28 w-full" />
      </Card>
    );
  }

  const { recommendation, current, bestWindow, bestWindowIsTomorrow } = forecast;
  const style = LEVEL_STYLES[recommendation.level];

  return (
    <Card
      title="Laundry advisor"
      action={
        <span
          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${style.badge}`}
        >
          {recommendation.badge}
        </span>
      }
    >
      <div className="flex items-center gap-4">
        <ScoreRing score={current.score} className={style.ring} />

        <div className="min-w-0 flex-1">
          <p className={`text-base font-semibold leading-snug ${style.text}`}>
            {recommendation.headline}
          </p>
          <p className="mt-1 text-sm leading-snug text-slate-400">{recommendation.detail}</p>
          <p className="mt-2 text-sm text-slate-300">
            <span className="text-slate-500">Drying time:</span>{" "}
            <span className="font-medium">{formatDryHours(current.dryHours)}</span>
          </p>
        </div>
      </div>

      {/* ---- Best window ---- */}
      <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3">
        {bestWindow ? (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Best window {bestWindowIsTomorrow ? "tomorrow" : "today"}
              </span>
              <span className="text-[11px] tabular-nums text-slate-500">
                avg score {bestWindow.averageScore}
              </span>
            </div>
            <p className="mt-1 text-xl font-medium tabular-nums text-white">
              {bestWindow.label}
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full ${style.bar}`}
                style={{ width: `${bestWindow.averageScore}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">
              {bestWindow.hours}-hour stretch with the best average drying conditions
              {bestWindowIsTomorrow ? " — nothing usable left today." : "."}
            </p>
          </>
        ) : (
          <p className="text-sm text-slate-400">
            No good drying window in the forecast — every daylight stretch is either too
            wet or too humid.
          </p>
        )}
      </div>

      {/* ---- Transparency toggle ---- */}
      <button
        type="button"
        onClick={() => setShowWhy((v) => !v)}
        aria-expanded={showWhy}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs text-slate-500 transition hover:text-slate-300"
      >
        {showWhy ? "Hide" : "Why this score?"}
        <svg
          className={`h-3 w-3 transition-transform ${showWhy ? "rotate-180" : ""}`}
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden
        >
          <path d="m2 4 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      {showWhy && <Breakdown forecast={forecast} />}
    </Card>
  );
}
