"use client";

import { useEffect, useState } from "react";
import type { Coords } from "@/lib/geo";
import { Card } from "./ui";

/**
 * Windy rain-radar embed.
 *
 * VISUAL ONLY. Nothing in this app reads data out of this iframe — every
 * number, threshold and recommendation comes from Open-Meteo. This is here so
 * you can eyeball where the cell actually is and which way it's moving, which
 * a probability figure can't tell you.
 */
function buildEmbedUrl({ lat, lon }: Coords): string {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    detailLat: String(lat),
    detailLon: String(lon),
    zoom: "10",
    level: "surface",
    overlay: "rain",
    product: "radar",
    menu: "",
    message: "",
    marker: "true",
    calendar: "now",
    pressure: "",
    type: "map",
    location: "coordinates",
    detail: "",
    metricWind: "km/h",
    metricTemp: "°C",
    radarRange: "-1",
  });
  return `https://embed.windy.com/embed2.html?${params.toString()}`;
}

export function WindyRadar({ coords }: { coords: Coords }) {
  // Debounce the coordinates feeding the iframe. Without this, dragging the pin
  // reloads a third-party embed on every animation frame — slow, and it hammers
  // Windy for no benefit at map-pixel granularity.
  const [embedCoords, setEmbedCoords] = useState(coords);

  useEffect(() => {
    const timer = setTimeout(() => setEmbedCoords(coords), 800);
    return () => clearTimeout(timer);
  }, [coords]);

  return (
    <Card
      title="Live rain radar"
      action={<span className="text-[11px] text-slate-500">Windy · visual only</span>}
      bodyClassName="px-4 pb-4"
    >
      <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0d1526]">
        <iframe
          // Keying on the coordinates forces a clean remount rather than
          // relying on the embed to react to a src swap.
          key={`${embedCoords.lat},${embedCoords.lon}`}
          src={buildEmbedUrl(embedCoords)}
          title="Windy rain radar"
          className="h-[300px] w-full border-0 sm:h-[360px]"
          loading="lazy"
          // The embed needs no device access; deny everything it might ask for.
          allow=""
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-popups"
        />
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
        Radar loop for context only. All forecasts and laundry advice on this page come
        from Open-Meteo.
      </p>
    </Card>
  );
}
