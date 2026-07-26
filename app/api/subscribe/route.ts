/**
 * Push subscription management.
 *
 *   POST   /api/subscribe  { subscription, lat?, lon?, label? }
 *          Stores the PushSubscription. If lat/lon are included and no home is
 *          set yet, they're adopted as the home location — so enabling
 *          notifications from a fresh install "just works".
 *
 *   DELETE /api/subscribe  { endpoint }
 *          Forgets the subscription (the UI toggle calls this).
 */

import { NextResponse } from "next/server";
import { parseCoords } from "@/lib/geo";
import { isPushConfigured, isValidSubscription } from "@/lib/push";
import {
  deleteSubscription,
  getHome,
  isStoreConfigured,
  saveSubscription,
  setHome,
  subscriptionKey,
} from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isStoreConfigured()) {
    return NextResponse.json(
      { error: "Storage is not configured — set the Upstash env vars." },
      { status: 503 }
    );
  }
  if (!isPushConfigured()) {
    return NextResponse.json(
      { error: "Push is not configured — set the VAPID env vars." },
      { status: 503 }
    );
  }

  let body: { subscription?: unknown; lat?: unknown; lon?: unknown; label?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!isValidSubscription(body.subscription)) {
    return NextResponse.json({ error: "Invalid push subscription." }, { status: 400 });
  }

  try {
    const key = await saveSubscription(body.subscription);

    // Adopt the current pin as home if we don't have one yet.
    const coords = parseCoords(body.lat, body.lon);
    if (coords && !(await getHome())) {
      const label =
        typeof body.label === "string" && body.label.trim()
          ? body.label.trim().slice(0, 60)
          : undefined;
      await setHome(coords, label);
    }

    return NextResponse.json({ ok: true, key });
  } catch (err) {
    console.error("[subscribe] save failed", err);
    return NextResponse.json({ error: "Could not save subscription." }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  let body: { endpoint?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body.endpoint !== "string" || !body.endpoint) {
    return NextResponse.json({ error: "endpoint is required." }, { status: 400 });
  }

  try {
    await deleteSubscription(subscriptionKey(body.endpoint));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[subscribe] delete failed", err);
    return NextResponse.json({ error: "Could not remove subscription." }, { status: 502 });
  }
}
