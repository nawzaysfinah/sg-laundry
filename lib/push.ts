/**
 * Web Push sending (server side only — requires the Node.js runtime, not Edge,
 * because `web-push` uses node:crypto for the VAPID signing and payload
 * encryption).
 */

import webpush from "web-push";
import {
  deleteSubscription,
  type PushSubscriptionJSON,
  type StoredSubscription,
} from "./store";

let configured = false;

export function isPushConfigured(): boolean {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.VAPID_SUBJECT
  );
}

function ensureConfigured(): void {
  if (configured) return;
  if (!isPushConfigured()) {
    throw new Error(
      "Push is not configured — set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT"
    );
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );
  configured = true;
}

export type NotificationPayload = {
  title: string;
  body: string;
  /** Notifications sharing a tag replace each other instead of stacking up. */
  tag?: string;
  url?: string;
};

export type SendResult =
  | { key: string; status: "sent" }
  | { key: string; status: "expired" }
  | { key: string; status: "failed"; error: string };

/**
 * Send one notification.
 *
 * 404/410 from a push service means the browser dropped the subscription (app
 * uninstalled, permission revoked, or the endpoint rotated). Those are not
 * errors to retry — the correct response is to forget the subscription, which
 * we do here so the store doesn't accumulate dead endpoints.
 */
export async function sendNotification(
  key: string,
  record: StoredSubscription,
  payload: NotificationPayload
): Promise<SendResult> {
  ensureConfigured();

  try {
    await webpush.sendNotification(
      record.subscription as webpush.PushSubscription,
      JSON.stringify(payload),
      { TTL: 900 } // 15 min — a stale "rain incoming" alert is worse than none
    );
    return { key, status: "sent" };
  } catch (err) {
    const statusCode = (err as { statusCode?: number })?.statusCode;
    if (statusCode === 404 || statusCode === 410) {
      await deleteSubscription(key);
      return { key, status: "expired" };
    }
    return {
      key,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Validate the shape of a subscription posted from the browser. */
export function isValidSubscription(value: unknown): value is PushSubscriptionJSON {
  if (!value || typeof value !== "object") return false;
  const sub = value as PushSubscriptionJSON;
  return (
    typeof sub.endpoint === "string" &&
    sub.endpoint.startsWith("https://") &&
    typeof sub.keys?.p256dh === "string" &&
    typeof sub.keys?.auth === "string"
  );
}
