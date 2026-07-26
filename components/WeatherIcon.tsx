import type { WeatherKind } from "@/lib/weather";

/**
 * Weather glyphs, drawn inline rather than pulled from an icon font or CDN
 * sprite — keeps the "no third-party scripts" rule intact and means the icons
 * inherit currentColor for free.
 */
export function WeatherIcon({
  kind,
  className = "h-12 w-12",
}: {
  kind: WeatherKind;
  className?: string;
}) {
  const common = {
    className,
    viewBox: "0 0 48 48",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    "aria-hidden": true as const,
  };

  const cloud = (
    <path
      d="M14 34a7 7 0 0 1-.6-13.97A11 11 0 0 1 34.6 21.2 6.4 6.4 0 0 1 34 34H14Z"
      fill="currentColor"
      opacity="0.85"
    />
  );

  switch (kind) {
    case "clear":
      return (
        <svg {...common}>
          <circle cx="24" cy="24" r="9" fill="#fbbf24" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
            <rect
              key={deg}
              x="23"
              y="4"
              width="2"
              height="6"
              rx="1"
              fill="#fbbf24"
              transform={`rotate(${deg} 24 24)`}
            />
          ))}
        </svg>
      );

    case "partly":
      return (
        <svg {...common}>
          <circle cx="31" cy="17" r="7" fill="#fbbf24" />
          <g className="text-slate-300">{cloud}</g>
        </svg>
      );

    case "cloudy":
      return (
        <svg {...common}>
          <g className="text-slate-400">{cloud}</g>
        </svg>
      );

    case "fog":
      return (
        <svg {...common}>
          <g className="text-slate-400">{cloud}</g>
          {[38, 42].map((y) => (
            <rect key={y} x="11" y={y} width="26" height="2.5" rx="1.25" fill="#94a3b8" />
          ))}
        </svg>
      );

    case "drizzle":
      return (
        <svg {...common}>
          <g className="text-slate-400">{cloud}</g>
          {[16, 24, 32].map((x) => (
            <circle key={x} cx={x} cy="40" r="1.8" fill="#7dd3fc" />
          ))}
        </svg>
      );

    case "rain":
      return (
        <svg {...common}>
          <g className="text-slate-400">{cloud}</g>
          {[15, 23, 31].map((x, i) => (
            <rect
              key={x}
              x={x}
              y={37 + (i === 1 ? 2 : 0)}
              width="2.5"
              height="8"
              rx="1.25"
              fill="#38bdf8"
              transform={`rotate(12 ${x} 40)`}
            />
          ))}
        </svg>
      );

    case "storm":
      return (
        <svg {...common}>
          <g className="text-slate-500">{cloud}</g>
          <path d="M25 35l-8 8h6l-2 6 9-9h-6l3-5z" fill="#facc15" />
          {[16, 33].map((x) => (
            <rect
              key={x}
              x={x}
              y="37"
              width="2.5"
              height="7"
              rx="1.25"
              fill="#38bdf8"
              transform={`rotate(12 ${x} 40)`}
            />
          ))}
        </svg>
      );
  }
}

/** Small inline glyphs used in the metric strip. */
export function MetricIcon({ name, className = "h-4 w-4" }: { name: "humidity" | "wind" | "cloud" | "uv"; className?: string }) {
  const common = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    "aria-hidden": true as const,
  };

  switch (name) {
    case "humidity":
      return (
        <svg {...common}>
          <path
            d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "wind":
      return (
        <svg {...common}>
          <path
            d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h8"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "cloud":
      return (
        <svg {...common}>
          <path
            d="M7 18a4 4 0 0 1-.3-7.98A6 6 0 0 1 17.7 11.1 3.6 3.6 0 0 1 17 18H7Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "uv":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      );
  }
}
