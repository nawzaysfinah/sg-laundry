/**
 * Home location.
 *
 *   GET    /api/home  → { home: HomeLocation | null, configured: boolean }
 *   POST   /api/home  → { lat, lon, label? }  saves it
 *   DELETE /api/home  → forgets it
 *
 * No auth: this is a single-user personal tool with one home pin. The worst a
 * stranger who finds the URL can do is change which point gets rain alerts.
 * If that ever matters, put Vercel's built-in password protection in front of
 * the deployment.
 */

import { NextResponse } from "next/server";
import { parseCoords } from "@/lib/geo";
import { clearHome, getHome, isStoreConfigured, setHome } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isStoreConfigured()) {
    return NextResponse.json({ home: null, configured: false });
  }
  try {
    return NextResponse.json({ home: await getHome(), configured: true });
  } catch (err) {
    console.error("[home] read failed", err);
    return NextResponse.json({ error: "Storage unavailable." }, { status: 502 });
  }
}

export async function POST(request: Request) {
  if (!isStoreConfigured()) {
    return NextResponse.json(
      { error: "Storage is not configured — set the Upstash env vars." },
      { status: 503 }
    );
  }

  let body: { lat?: unknown; lon?: unknown; label?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const coords = parseCoords(body.lat, body.lon);
  if (!coords) {
    return NextResponse.json(
      { error: "lat/lon are required and must fall within Singapore" },
      { status: 400 }
    );
  }

  const label =
    typeof body.label === "string" && body.label.trim()
      ? body.label.trim().slice(0, 60)
      : undefined;

  try {
    return NextResponse.json({ home: await setHome(coords, label), configured: true });
  } catch (err) {
    console.error("[home] write failed", err);
    return NextResponse.json({ error: "Could not save home location." }, { status: 502 });
  }
}

export async function DELETE() {
  if (!isStoreConfigured()) {
    return NextResponse.json({ ok: true, configured: false });
  }
  try {
    await clearHome();
    return NextResponse.json({ ok: true, configured: true });
  } catch (err) {
    console.error("[home] delete failed", err);
    return NextResponse.json({ error: "Could not clear home location." }, { status: 502 });
  }
}
