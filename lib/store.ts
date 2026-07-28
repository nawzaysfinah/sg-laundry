/**
 * Persistence layer (Upstash Redis over REST).
 *
 * Single-user app, so the data model is deliberately tiny — two keys, no
 * per-user namespacing:
 *
 *   laundry:home  → JSON string   { lat, lon, label, updatedAt }
 *   laundry:subs  → Redis hash    subKey → JSON StoredSubscription
 *
 * Upstash's REST client is used (rather than a TCP Redis client) specifically
 * because serverless functions have no stable connection lifecycle — each
 * command is an independent HTTPS request, so there's no pool to exhaust and
 * nothing to clean up when a function freezes mid-invocation.
 */

import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";
import type { Coords } from "./geo";

const HOME_KEY = "laundry:home";
const SUBS_KEY = "laundry:subs";
// Telegram delivery bookkeeping (single recipient, so plain string keys — no
// per-subscription hash needed like Web Push has).
const TG_RAIN_ALERT_KEY = "laundry:tg:lastRainAlertAt"; // ISO timestamp
const TG_REPORT_DATE_KEY = "laundry:tg:lastReportDate"; // "YYYY-MM-DD" (SG date)
const TG_MUTED_UNTIL_KEY = "laundry:tg:mutedUntil"; // ISO timestamp, set by /mute

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
 * Stable short key for a subscription, derived from its endpoint URL.
 * Hashing rather than storing the raw endpoint as a field name keeps the key
 * space bounded and avoids putting a long push-service URL in log output.
 */
export function subscriptionKey(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex").slice(0, 24);
}

// ---------------------------------------------------------------------------
// Home location
// ---------------------------------------------------------------------------

export async function getHome(): Promise<HomeLocation | null> {
  const redis = getRedis();
  if (!redis) return null;
  // Upstash auto-deserialises JSON values, so this may already be an object.
  const raw = await redis.get<HomeLocation | string>(HOME_KEY);
  if (!raw) return null;
  return typeof raw === "string" ? (JSON.parse(raw) as HomeLocation) : raw;
}

export async function setHome(coords: Coords, label?: string): Promise<HomeLocation> {
  const redis = getRedis();
  if (!redis) throw new Error("Redis is not configured");

  const home: HomeLocation = {
    ...coords,
    ...(label ? { label } : {}),
    updatedAt: new Date().toISOString(),
  };
  await redis.set(HOME_KEY, JSON.stringify(home));
  return home;
}

export async function clearHome(): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.del(HOME_KEY);
}

// ---------------------------------------------------------------------------
// Push subscriptions
// ---------------------------------------------------------------------------

export async function getSubscriptions(): Promise<Record<string, StoredSubscription>> {
  const redis = getRedis();
  if (!redis) return {};

  const all = await redis.hgetall<Record<string, StoredSubscription | string>>(SUBS_KEY);
  if (!all) return {};

  const out: Record<string, StoredSubscription> = {};
  for (const [key, value] of Object.entries(all)) {
    try {
      out[key] = typeof value === "string" ? (JSON.parse(value) as StoredSubscription) : value;
    } catch {
      // A corrupt entry shouldn't take down the whole checker — drop it.
    }
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
  if (!raw) return null;
  try {
    return typeof raw === "string" ? (JSON.parse(raw) as StoredSubscription) : raw;
  } catch {
    return null;
  }
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
// Telegram delivery state
// ---------------------------------------------------------------------------

/** ISO timestamp of the last Telegram rain alert, for the cooldown. */
export async function getLastRainAlertAt(): Promise<Date | null> {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.get<string>(TG_RAIN_ALERT_KEY);
  return raw ? new Date(raw) : null;
}

export async function setLastRainAlertAt(at: Date = new Date()): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.set(TG_RAIN_ALERT_KEY, at.toISOString());
}

/** SG calendar date ("YYYY-MM-DD") the morning report last went out. */
export async function getLastReportDate(): Promise<string | null> {
  const redis = getRedis();
  if (!redis) return null;
  return (await redis.get<string>(TG_REPORT_DATE_KEY)) ?? null;
}

export async function setLastReportDate(date: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.set(TG_REPORT_DATE_KEY, date);
}

/** Set by the /mute command; rain alerts stay quiet until this time passes. */
export async function getMutedUntil(): Promise<Date | null> {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.get<string>(TG_MUTED_UNTIL_KEY);
  return raw ? new Date(raw) : null;
}

export async function setMutedUntil(until: Date): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  // TTL the key to the mute duration (+ a small buffer) so a stale timestamp
  // can never linger in Redis after it's no longer relevant.
  const ttlSeconds = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 1000) + 60);
  await redis.set(TG_MUTED_UNTIL_KEY, until.toISOString(), { ex: ttlSeconds });
}
