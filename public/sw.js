/* eslint-disable no-restricted-globals */
/**
 * Service worker — push delivery only.
 *
 * Deliberately does NOT cache app assets. Offline caching for a live weather
 * app is actively harmful: a cached "Great time to hang laundry" served during
 * a downpour is worse than an error message. The only job here is receiving
 * push events and opening the app when one is tapped.
 */

const DEFAULT_NOTIFICATION = {
  title: "SG Laundry",
  body: "Rain may be on the way near home.",
  tag: "rain-incoming",
  url: "/",
};

// Take over immediately on install/update rather than waiting for every tab to
// close — otherwise a deploy can leave an old worker handling pushes for days.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = DEFAULT_NOTIFICATION;

  if (event.data) {
    try {
      payload = { ...DEFAULT_NOTIFICATION, ...event.data.json() };
    } catch {
      // Non-JSON payload — fall back to the raw text as the body.
      payload = { ...DEFAULT_NOTIFICATION, body: event.data.text() };
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      // `tag` makes a new alert replace the previous one instead of stacking.
      tag: payload.tag,
      renotify: true,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      vibrate: [120, 60, 120],
      data: { url: payload.url || "/" },
      requireInteraction: false,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/", self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Focus an existing tab if the app is already open, rather than
        // spawning a duplicate every time a notification is tapped.
        for (const client of clientList) {
          if (client.url.startsWith(self.location.origin) && "focus" in client) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
        return self.clients.openWindow(targetUrl);
      })
  );
});

/**
 * Push services can rotate a subscription's endpoint. When that happens the old
 * one silently stops working, so re-subscribe and tell the server the new one.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const res = await fetch("/api/push/public-key");
        const { publicKey } = await res.json();
        if (!publicKey) return;

        const subscription = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: publicKey,
        });

        await fetch("/api/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscription: subscription.toJSON() }),
        });
      } catch (err) {
        // Nothing useful to do here; the UI toggle will re-subscribe on next open.
        console.error("[sw] resubscribe failed", err);
      }
    })()
  );
});
