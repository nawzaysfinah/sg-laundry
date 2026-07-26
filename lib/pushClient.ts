/**
 * Browser-side Web Push helpers.
 *
 * The flow, in order:
 *   1. register the service worker
 *   2. ask for Notification permission (must be inside a user gesture)
 *   3. PushManager.subscribe() with our VAPID public key
 *   4. POST the resulting subscription to /api/subscribe
 */

import type { Coords } from "./geo";

/**
 * VAPID keys are base64url; PushManager wants raw bytes. Some browsers accept
 * the string directly, but Firefox and older Chromium builds don't — converting
 * is the portable option.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export type PushSupport =
  | { supported: true }
  | { supported: false; reason: string };

export function checkPushSupport(): PushSupport {
  if (typeof window === "undefined") return { supported: false, reason: "Not in a browser." };
  if (!("serviceWorker" in navigator))
    return { supported: false, reason: "This browser has no service worker support." };
  if (!("PushManager" in window))
    return { supported: false, reason: "This browser has no push support." };
  if (!("Notification" in window))
    return { supported: false, reason: "This browser has no notification support." };

  // iOS only exposes push to installed (Add to Home Screen) web apps. Detect
  // Safari-on-iOS that isn't running standalone and say so explicitly, because
  // otherwise the permission request just silently fails.
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;

  if (isIOS && !isStandalone) {
    return {
      supported: false,
      reason: "On iOS, add this app to your Home Screen first — Safari only allows push for installed web apps.",
    };
  }

  return { supported: true };
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  // Wait for it to be usable — `register` resolves before activation on a first load.
  await navigator.serviceWorker.ready;
  return registration;
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

async function fetchPublicKey(): Promise<string> {
  const res = await fetch("/api/push/public-key");
  const data = (await res.json()) as { publicKey: string | null };
  if (!data.publicKey) {
    throw new Error("Server has no VAPID public key configured.");
  }
  return data.publicKey;
}

/**
 * Full subscribe flow. Must be called from a user gesture (a click) —
 * `Notification.requestPermission()` is ignored otherwise in most browsers.
 */
export async function subscribeToPush(
  coords: Coords,
  label?: string
): Promise<PushSubscription> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Notifications are blocked. Re-enable them in your browser's site settings."
        : "Notification permission was dismissed."
    );
  }

  const [registration, publicKey] = await Promise.all([
    registerServiceWorker(),
    fetchPublicKey(),
  ]);

  // Reuse an existing subscription if there is one; calling subscribe() twice
  // with the same key is fine, but this avoids a needless round trip.
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    }));

  const res = await fetch("/api/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subscription: subscription.toJSON(),
      lat: coords.lat,
      lon: coords.lon,
      ...(label ? { label } : {}),
    }),
  });

  if (!res.ok) {
    const { error } = (await res.json().catch(() => ({ error: null }))) as { error?: string };
    // Don't leave a live browser subscription pointing at a server that doesn't
    // know about it — it would never fire, and the UI would look enabled.
    await subscription.unsubscribe().catch(() => {});
    throw new Error(error ?? "Could not register for notifications.");
  }

  return subscription;
}

/** Remove the subscription locally and on the server. */
export async function unsubscribeFromPush(): Promise<void> {
  const subscription = await getExistingSubscription();
  if (!subscription) return;

  const { endpoint } = subscription;
  await subscription.unsubscribe().catch(() => {});
  await fetch("/api/subscribe", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {
    // Best effort — a stale server-side record will be pruned on the next push
    // attempt when the push service returns 410 Gone.
  });
}
