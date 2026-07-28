/**
 * Push subscription management (Web Push — dormant fallback channel; Telegram
 * is the primary way this app delivers alerts, see app/api/telegram/).
 *
 *   POST   /api/subscribe  { subscription }
 *          Stores the PushSubscription.
 *
 *   DELETE /api/subscribe  { endpoint }
 *          Forgets the subscription (the UI toggle calls this).
 *
 * There's no UI left that calls this route — the home-setting panel it lived
 * behind was removed when the app went multi-user via Telegram, since
 * "home" is now per Telegram chat, not a single value the web app can own.
 * The route (and the rest of the Web Push machinery) is kept working in case
 * it's ever revived.
 */

import { NextResponse } from "next/server";
import { isPushConfigured, isValidSubscription } from "@/lib/push";
import { deleteSubscription, isStoreConfigured, saveSubscription, subscriptionKey } from "@/lib/store";

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

  let body: { subscription?: unknown };
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
