"use client";

import type { ForecastView } from "@/lib/forecast";
import { formatHour } from "@/lib/sgTime";
import { MetricIcon, WeatherIcon } from "./WeatherIcon";
import { Card, Skeleton } from "./ui";

/** Turn the raw numbers into the sentence you'd actually say out loud. */
function plainLanguage(current: ForecastView["current"], nextHourProb: number): string {
  if (current.raining) {
    return `It's raining right now — ${current.precipMm.toFixed(1)}mm in the last hour.`;
  }
  if (nextHourProb >= 60) return `Dry for now, but rain looks likely within the hour.`;
  if (nextHourProb >= 30) return `Dry now, with a fair chance of a passing shower soon.`;
  if (current.rh >= 85) return `Dry but very humid — anything hung out will take its time.`;
  if (current.cloudCoverPct <= 25) return `Bright and dry. Good air for drying.`;
  return `Dry at the moment, with no rain signalled in the next hour.`;
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: "humidity" | "wind" | "cloud" | "uv";
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-white/[0.04] px-3 py-2.5">
      <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
        <MetricIcon name={icon} className="h-3.5 w-3.5" />
        {label}
      </span>
      <span className="text-lg font-semibold tabular-nums text-slate-100">{value}</span>
    </div>
  );
}

export function ConditionsPanel({
  forecast,
  loading,
  placeLabel,
}: {
  forecast: ForecastView | null;
  loading: boolean;
  placeLabel: string;
}) {
  if (!forecast) {
    return (
      <Card title="Current conditions">
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <div className="grid grid-cols-4 gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        </div>
      </Card>
    );
  }

  const { current, timeline } = forecast;
  const nextHourProb = timeline[0]?.precipProbPct ?? 0;
  const uvNow = timeline[0]?.uvIndex ?? 0;

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          Current conditions
          {loading && (
            <span
              className="h-2.5 w-2.5 animate-pulse rounded-full bg-sky-400"
              aria-label="Refreshing"
            />
          )}
        </span>
      }
      action={
        <span className="text-[11px] tabular-nums text-slate-500">
          {formatHour(current.time)} SGT
        </span>
      }
    >
      <div className="flex items-start gap-4">
        <WeatherIcon kind={current.weatherKind} className="h-14 w-14 shrink-0" />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-light tabular-nums tracking-tight text-white">
              {Math.round(current.tempC)}°
            </span>
            <span className="truncate text-sm font-medium text-slate-300">
              {current.weatherLabel}
            </span>
          </div>
          <p className="mt-1 text-sm leading-snug text-slate-400">
            {plainLanguage(current, nextHourProb)}
          </p>
          <p className="mt-1.5 truncate text-xs text-slate-500">{placeLabel}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric icon="humidity" label="Humidity" value={`${Math.round(current.rh)}%`} />
        <Metric icon="wind" label="Wind" value={`${Math.round(current.windKmh)} km/h`} />
        <Metric icon="cloud" label="Cloud" value={`${Math.round(current.cloudCoverPct)}%`} />
        <Metric icon="uv" label="UV index" value={uvNow.toFixed(1)} />
      </div>
    </Card>
  );
}
