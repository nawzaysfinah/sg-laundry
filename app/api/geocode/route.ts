/**
 * GET /api/geocode?q=tampines
 *
 * Thin proxy over Open-Meteo's geocoding API, filtered to Singapore and to
 * results actually inside our bounding box.
 */

import { NextResponse } from "next/server";
import { isInSingapore } from "@/lib/geo";
import { geocode } from "@/lib/weather";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") ?? "").slice(0, 80);

  if (query.trim().length < 2) {
    return NextResponse.json({ results: [] });
  }

  try {
    const results = (await geocode(query)).filter(isInSingapore);
    return NextResponse.json(
      { results },
      { headers: { "Cache-Control": "public, s-maxage=86400" } }
    );
  } catch (err) {
    console.error("[geocode] failed", err);
    return NextResponse.json({ error: "Search is unavailable." }, { status: 502 });
  }
}
