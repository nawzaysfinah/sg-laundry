/**
 * GET /api/push/public-key → { publicKey: string | null }
 *
 * The VAPID *public* key is safe to hand to the browser (it's the whole point
 * — PushManager.subscribe needs it). It's served from an endpoint rather than
 * inlined as a NEXT_PUBLIC_* var so that rotating the keypair only requires
 * changing env vars and restarting, not a rebuild.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const publicKey = process.env.VAPID_PUBLIC_KEY ?? null;
  return NextResponse.json({ publicKey });
}
