"use client";

import type { ForecastView } from "@/lib/forecast";
import { formatHourShort } from "@/lib/sgTime";
import { Card, Skeleton } from "./ui";

/**
 * Bar colour encodes severity, so the shape of the next 12 hours reads at a
 * glance without consulting the axis. Thresholds line up with the advisor's
 * bands (50% = bring it in) so the chart and the recommendation never appear to
 * disagree.
 */
function barColor(prob: number): string {
  if (prob >= 60) return "bg-rose-400";
  if (prob >= 40) return "bg-amber-400";
  if (prob >= 20) return "bg-sky-400";
  return "bg-sky-400/35";
}

export function RainTimeline({ forecast }: { forecast: ForecastView | null }) {
  if (!forecast) {
    return (
      <Card title="Rain chance — next 12 hours">
        <Skeleton className="h-32 w-full" />
      </Card>
    );
  }

  const { timeline } = forecast;
  const peak = Math.max(...timeline.map((h) => h.precipProbPct), 0);

  return (
    <Card
      title="Rain chance — next 12 hours"
      action={
        <span className="text-[11px] tabular-nums text-slate-500">peak {peak}%</span>
      }
    >
      {/* A visually-hidden table carries the same data for screen readers,
          since a row of coloured divs conveys nothing to them. */}
      <table className="sr-only">
        <caption>Hourly chance of rain for the next 12 hours</caption>
        <thead>
          <tr>
            <th scope="col">Hour</th>
            <th scope="col">Chance of rain</th>
            <th scope="col">Drying score</th>
          </tr>
        </thead>
        <tbody>
          {timeline.map((hour) => (
            <tr key={hour.time}>
              <th scope="row">{formatHourShort(hour.time)}</th>
              <td>{hour.precipProbPct}%</td>
              <td>{hour.score}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* items-stretch (default) + h-full columns give the inner flex-1 bar
          area a real height, so the bar's percentage height resolves. */}
      <div aria-hidden className="flex h-32 gap-[3px]">
        {timeline.map((hour, i) => {
          // Floor the rendered height so a 0% hour still shows a baseline tick
          // — an empty gap looks like missing data rather than "no rain".
          const height = Math.max(4, hour.precipProbPct);
          return (
            <div key={hour.time} className="flex h-full flex-1 flex-col items-center gap-1.5">
              <span
                className={`w-full text-center text-[10px] font-medium tabular-nums transition-opacity ${
                  hour.precipProbPct >= 20 ? "text-slate-300" : "text-transparent"
                }`}
              >
                {hour.precipProbPct}
              </span>
              <div className="flex w-full flex-1 items-end">
                <div
                  className={`w-full rounded-t-[3px] transition-all ${barColor(hour.precipProbPct)}`}
                  style={{ height: `${height}%` }}
                  title={`${formatHourShort(hour.time)} — ${hour.precipProbPct}% chance of rain`}
                />
              </div>
              <span className="text-[10px] tabular-nums text-slate-500">
                {i === 0 ? "now" : formatHourShort(hour.time)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-500">
        {[
          ["bg-sky-400/35", "under 20%"],
          ["bg-sky-400", "20–39%"],
          ["bg-amber-400", "40–59%"],
          ["bg-rose-400", "60%+"],
        ].map(([cls, label]) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-sm ${cls}`} />
            {label}
          </span>
        ))}
      </div>
    </Card>
  );
}
