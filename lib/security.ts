/**
 * Shared low-level security helpers used by every protected route
 * (`/api/cron/check-rain`, `/api/telegram/webhook`).
 */

import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time secret comparison — avoids leaking the secret one byte at a
 * time via response-timing side channels. A naive `===` short-circuits on the
 * first mismatched byte, which is measurable over enough requests.
 */
export function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
