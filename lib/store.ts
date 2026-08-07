/**
 * Persistence layer (Upstash Redis over REST).
 *
 * Multi-user Telegram bot: every Telegram chat that registers a location gets
 * its own entry, keyed by chat id (as a string), in one hash per concern —
 * mirroring the pattern already used for Web Push subscriptions below.
 *
 *   laundry:tg:homes       hash   chatId → JSON HomeLocation
 *                           (this hash IS the registry of active users —
 *                           "registered" means "has a home entry")
 *   laundry:tg:rainAlerts  hash   chatId → ISO timestamp (per-chat cooldown)
 *   laundry:tg:reportDates hash   "chatId:slot" → "YYYY-MM-DD" (per report
 *                           slot — e.g. "morning"/"evening" — so one slot
 *                           firing doesn't block another the same day)
 *   laundry:tg:muted       hash   chatId → ISO timestamp (per-chat /mute)
 *   laundry:subs           hash   subKey → JSON StoredSubscription
 *                           (Web Push — dormant, browser-based, no chat id)
 *
 * Upstash's REST client is used (rather than a TCP Redis client) specifically
 * because serverless functions have no stable connection lifecycle — each
 * command is an independent HTTPS request, so there's no pool to exhaust and
 * nothing to clean up when a function freezes mid-invocation.
 */

import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";
import type { Coords } from "./geo";
import { LAUNDRY_CONFIG } from "./laundryLogic";

const SUBS_KEY = "laundry:subs";
const TG_HOMES_KEY = "laundry:tg:homes";
// Renamed (rainAlerts/reportDates/muted, not the old singular-era names) to
// avoid colliding with the old single-user schema's plain STRING keys of
// almost the same name (laundry:tg:lastRainAlertAt etc.) — HSET/HGET/HDEL on
// a key that already holds a string throws WRONGTYPE, so these must be new
// key names, not just a type change under the old ones.
const TG_RAIN_ALERT_KEY = "laundry:tg:rainAlerts";
const TG_REPORT_DATE_KEY = "laundry:tg:reportDates";
const TG_MUTED_UNTIL_KEY = "laundry:tg:muted";

export type HomeLocation = Coords & {
  label?: string;
  updatedAt: string;
};

export type PushSubscriptionJSON = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export type StoredSubscription = {
  subscription: PushSubscriptionJSON;
  createdAt: string;
  /** ISO timestamp of the last push we sent, used for the cooldown. */
  lastNotifiedAt?: string;
};

let client: Redis | null = null;

/** Returns null when Upstash isn't configured, so callers can degrade cleanly. */
export function getRedis(): Redis | null {
  if (client) return client;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  client = new Redis({ url, token });
  return client;
}

export function isStoreConfigured(): boolean {
  return getRedis() !== null;
}

/**
 * Stable short key for a Web Push subscription, derived from its endpoint URL.
 * Hashing rather than storing the raw endpoint as a field name keeps the key
 * space bounded and avoids putting a long push-service URL in log output.
 */
export function subscriptionKey(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex").slice(0, 24);
}

/** Small helper: parse a hash field that Upstash may already have deserialised. */
function parseJsonField<T>(raw: unknown): T | null {
  if (raw === null || raw === undefined) return null;
  try {
    return typeof raw === "string" ? (JSON.parse(raw) as T) : (raw as T);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-user home locations (Telegram)
// ---------------------------------------------------------------------------

export async function getUserHome(chatId: string): Promise<HomeLocation | null> {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.hget<HomeLocation | string>(TG_HOMES_KEY, chatId);
  return parseJsonField<HomeLocation>(raw);
}

export async function setUserHome(
  chatId: string,
  coords: Coords,
  label?: string
): Promise<HomeLocation> {
  const redis = getRedis();
  if (!redis) throw new Error("Redis is not configured");

  const home: HomeLocation = {
    ...coords,
    ...(label ? { label } : {}),
    updatedAt: new Date().toISOString(),
  };
  await redis.hset(TG_HOMES_KEY, { [chatId]: JSON.stringify(home) });
  return home;
}

/** Every registered user's home, keyed by chat id — used by the cron checker. */
export async function getAllUserHomes(): Promise<Record<string, HomeLocation>> {
  const redis = getRedis();
  if (!redis) return {};

  const all = await redis.hgetall<Record<string, HomeLocation | string>>(TG_HOMES_KEY);
  if (!all) return {};

  const out: Record<string, HomeLocation> = {};
  for (const [chatId, raw] of Object.entries(all)) {
    const home = parseJsonField<HomeLocation>(raw);
    if (home) out[chatId] = home; // a corrupt entry shouldn't take down the loop
  }
  return out;
}

/** Wipes every trace of a chat — used by /stop. */
export async function deleteUserData(chatId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  // Report dates are keyed "chatId:slot", not plain chatId — delete each
  // configured slot's field explicitly so /stop doesn't leave orphaned state
  // behind if slots were ever added or renamed.
  const reportFields = LAUNDRY_CONFIG.notification.report.slots.map(
    (slot) => `${chatId}:${slot.name}`
  );
  await Promise.all([
    redis.hdel(TG_HOMES_KEY, chatId),
    redis.hdel(TG_RAIN_ALERT_KEY, chatId),
    redis.hdel(TG_REPORT_DATE_KEY, ...reportFields),
    redis.hdel(TG_MUTED_UNTIL_KEY, chatId),
  ]);
}

// ---------------------------------------------------------------------------
// Push subscriptions (Web Push — dormant, unrelated to Telegram chat ids)
// ---------------------------------------------------------------------------

export async function getSubscriptions(): Promise<Record<string, StoredSubscription>> {
  const redis = getRedis();
  if (!redis) return {};

  const all = await redis.hgetall<Record<string, StoredSubscription | string>>(SUBS_KEY);
  if (!all) return {};

  const out: Record<string, StoredSubscription> = {};
  for (const [key, value] of Object.entries(all)) {
    const parsed = parseJsonField<StoredSubscription>(value);
    if (parsed) out[key] = parsed;
  }
  return out;
}

export async function saveSubscription(
  subscription: PushSubscriptionJSON
): Promise<string> {
  const redis = getRedis();
  if (!redis) throw new Error("Redis is not configured");

  const key = subscriptionKey(subscription.endpoint);
  const existing = await getSubscription(key);

  const record: StoredSubscription = {
    subscription,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    // Preserve the cooldown across a re-subscribe so refreshing the page can't
    // be used (accidentally) to bypass it.
    ...(existing?.lastNotifiedAt ? { lastNotifiedAt: existing.lastNotifiedAt } : {}),
  };

  await redis.hset(SUBS_KEY, { [key]: JSON.stringify(record) });
  return key;
}

export async function getSubscription(key: string): Promise<StoredSubscription | null> {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.hget<StoredSubscription | string>(SUBS_KEY, key);
  return parseJsonField<StoredSubscription>(raw);
}

export async function deleteSubscription(key: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.hdel(SUBS_KEY, key);
}

export async function markNotified(key: string, at: Date = new Date()): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const existing = await getSubscription(key);
  if (!existing) return;
  await redis.hset(SUBS_KEY, {
    [key]: JSON.stringify({ ...existing, lastNotifiedAt: at.toISOString() }),
  });
}

// ---------------------------------------------------------------------------
// Per-user Telegram delivery state
// ---------------------------------------------------------------------------

/** ISO timestamp of this chat's last Telegram rain alert, for its cooldown. */
export async function getUserLastRainAlertAt(chatId: string): Promise<Date | null> {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.hget<string>(TG_RAIN_ALERT_KEY, chatId);
  return raw ? new Date(raw) : null;
}

export async function setUserLastRainAlertAt(
  chatId: string,
  at: Date = new Date()
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.hset(TG_RAIN_ALERT_KEY, { [chatId]: at.toISOString() });
}

/**
 * SG calendar date ("YYYY-MM-DD") this chat last received a given report slot
 * (e.g. "morning", "evening" — see LAUNDRY_CONFIG.notification.report.slots).
 * Tracked per slot, not just per chat, so sending the morning report doesn't
 * block the evening one on the same day, or vice versa.
 */
export async function getUserLastReportDate(
  chatId: string,
  slot: string
): Promise<string | null> {
  const redis = getRedis();
  if (!redis) return null;
  return (await redis.hget<string>(TG_REPORT_DATE_KEY, `${chatId}:${slot}`)) ?? null;
}

export async function setUserLastReportDate(
  chatId: string,
  slot: string,
  date: string
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.hset(TG_REPORT_DATE_KEY, { [`${chatId}:${slot}`]: date });
}

/** Set by /mute; this chat's rain alerts stay quiet until this time passes. */
export async function getUserMutedUntil(chatId: string): Promise<Date | null> {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.hget<string>(TG_MUTED_UNTIL_KEY, chatId);
  return raw ? new Date(raw) : null;
}

export async function setUserMutedUntil(chatId: string, until: Date): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  // Hash fields can't carry a per-field TTL, unlike a top-level key — a stale
  // past timestamp is harmless though, since callers just compare it to "now".
  await redis.hset(TG_MUTED_UNTIL_KEY, { [chatId]: until.toISOString() });
}
