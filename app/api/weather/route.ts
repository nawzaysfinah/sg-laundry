/**
 * GET /api/weather?lat=1.35&lon=103.82
 *
 * Proxies Open-Meteo rather than letting the browser call it directly. Two
 * reasons: (1) your device's IP is never paired with your home coordinates at a
 * third party, and (2) responses get cached at the edge, so dragging the pin
 * around doesn't hammer the upstream free tier.
 */

import { NextResponse } from "next/server";
import { getForecastView } from "@/lib/forecast";
import { parseCoords } from "@/lib/geo";
import { OpenMeteoError } from "@/lib/weather";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const coords = parseCoords(searchParams.get("lat"), searchParams.get("lon"));

  if (!coords) {
    return NextResponse.json(
      { error: "lat/lon are required and must fall within Singapore" },
      { status: 400 }
    );
  }

  try {
    const view = await getForecastView(coords);
    return NextResponse.json(view, {
      headers: {
        // Serve from cache for 5 min, then allow a stale response for another
        // 10 while revalidating — a slightly old forecast beats a spinner.
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (err) {
    if (err instanceof OpenMeteoError) {
      return NextResponse.json(
        { error: "Weather service is unavailable right now." },
        { status: 502 }
      );
    }
    console.error("[weather] unexpected failure", err);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
