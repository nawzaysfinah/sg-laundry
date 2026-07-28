/**
 * POST /api/telegram/webhook
 * Header: X-Telegram-Bot-Api-Secret-Token: <TELEGRAM_WEBHOOK_SECRET>
 *
 * Receives every message sent to the bot and replies to slash commands and
 * shared locations. Outbound sending otherwise lives in lib/telegram.ts.
 *
 * Multi-user: anyone who finds the bot on Telegram can use it — there's no
 * allowlist. The only thing gating this route is the webhook secret, which
 * proves a request genuinely came from Telegram (it's attached automatically
 * once registered via `setWebhook`, see README) — it says nothing about which
 * *chat* is messaging, because any chat is a legitimate potential user.
 *
 * Location handling is stateless by design: receiving a shared Location from
 * any chat id (re)sets *that chat's* home, whether it's their first-ever
 * share or their tenth. There's no separate "waiting for your location"
 * conversation state to track — /setlocation just prompts for a share, and
 * the save itself is identical whichever way the flow got there.
 *
 * Always returns 200 once the update itself was validly received, even if a
 * reply failed to send — a non-2xx response makes Telegram retry the same
 * update, which would risk sending some replies twice.
 */

import { NextResponse } from "next/server";
import { getForecastView } from "@/lib/forecast";
import { clampToSingapore, isInSingapore, roundCoords } from "@/lib/geo";
import { LAUNDRY_CONFIG } from "@/lib/laundryLogic";
import { buildHomeReply, buildMorningReport, buildNowReply, buildWindowReply } from "@/lib/report";
import { secretMatches } from "@/lib/security";
import { formatClock, sgNow } from "@/lib/sgTime";
import {
  deleteUserData,
  getUserHome,
  isStoreConfigured,
  setUserHome,
  setUserMutedUntil,
} from "@/lib/store";
import { isTelegramConfigured, sendTelegram } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Minimal typing for the slice of Telegram's Update object this route reads.
// Not a full SDK — just enough to route commands and location shares.
// ---------------------------------------------------------------------------
type TelegramUpdate = {
  message?: {
    text?: string;
    location?: { latitude: number; longitude: number };
    chat?: { id?: number | string };
  };
};

function authorize(request: Request): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) return false;
  const provided = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  return provided !== "" && secretMatches(provided, expected);
}

/** "/now@sg_laundry_bot arg1" → "now". Telegram appends @botname in some clients. */
function parseCommand(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const firstToken = trimmed.split(/\s+/)[0].slice(1);
  return firstToken.split("@")[0].toLowerCase();
}

const NEEDS_LOCATION_TEXT =
  "📍 You haven't set a location yet. Send /setlocation to get started.";

const SETLOCATION_PROMPT =
  "📍 Tap the 📎 (attach) button, choose <b>Location</b>, and share where you'd like me to watch. Must be within Singapore.";

const COMMAND_LIST = [
  "/now — current rain &amp; drying conditions",
  "/report — get today's laundry report on demand",
  "/window — best remaining drying window today",
  "/home — show your saved location",
  "/setlocation — set or change the location I watch",
  "/mute — pause rain alerts for 2 hours",
  "/stop — delete your data and stop all alerts",
  "/help — this message",
].join("\n");

const HELP_TEXT = ["🧺 <b>SG Laundry</b> — commands", "", COMMAND_LIST].join("\n");

function startText(hasHome: boolean): string {
  if (hasHome) {
    return ["👋 Welcome back! Here's what I can do:", "", COMMAND_LIST].join("\n");
  }
  return [
    "👋 Hi! I'm your Singapore rain &amp; laundry assistant.",
    "",
    "Once you share a location, I'll message you automatically when rain's heading your way, and send a daily morning laundry report.",
    "",
    SETLOCATION_PROMPT,
  ].join("\n");
}

/** Handles a shared Telegram Location — the one path that writes a home. */
async function handleLocation(
  chatId: string,
  location: { latitude: number; longitude: number }
): Promise<string> {
  const coords = { lat: location.latitude, lon: location.longitude };

  if (!isInSingapore(coords)) {
    return "🌏 That's outside Singapore — this bot only covers the Singapore area. Please share a location within Singapore.";
  }

  const home = await setUserHome(chatId, roundCoords(clampToSingapore(coords)));
  return `✅ Location saved. I'll watch this spot for rain and send you a daily morning report.\n\n${buildHomeReply(home)}`;
}

async function handleCommand(chatId: string, command: string): Promise<string> {
  switch (command) {
    case "start": {
      const home = await getUserHome(chatId);
      return startText(home !== null);
    }

    case "help":
      return HELP_TEXT;

    case "setlocation":
      return SETLOCATION_PROMPT;

    case "stop": {
      await deleteUserData(chatId);
      return "🗑️ Your location and alert settings have been removed. Send /setlocation anytime to start again.";
    }

    case "home": {
      const home = await getUserHome(chatId);
      return buildHomeReply(home);
    }

    case "now":
    case "report":
    case "window": {
      const home = await getUserHome(chatId);
      if (!home) return NEEDS_LOCATION_TEXT;

      const view = await getForecastView(home);
      if (command === "now") return buildNowReply(view, home);
      if (command === "window") return buildWindowReply(view);
      // /report reuses the exact same builder the daily cron job uses, called
      // on demand — it deliberately does NOT touch this chat's "already sent
      // today" state, so it can't cancel or duplicate the scheduled 8am send.
      return buildMorningReport(view, home, sgNow().date);
    }

    case "mute": {
      const home = await getUserHome(chatId);
      if (!home) return NEEDS_LOCATION_TEXT;

      const minutes = LAUNDRY_CONFIG.notification.muteDurationMinutes;
      const until = new Date(Date.now() + minutes * 60_000);
      await setUserMutedUntil(chatId, until);
      return `🔇 Rain alerts paused until ${formatClock(until)} SGT. The morning report is unaffected.`;
    }

    default:
      return "🤔 I don't know that command. Send /help to see what I can do.";
  }
}

export async function POST(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = await request.json();
  } catch {
    // Malformed body from something claiming to be Telegram — nothing to
    // retry productively, just accept and drop.
    return NextResponse.json({ ok: true });
  }

  const message = update.message;
  const chatId = message?.chat?.id;
  if (!message || chatId === undefined) {
    return NextResponse.json({ ok: true }); // no message (e.g. edited_message) — ignore
  }
  const chatIdStr = String(chatId);

  if (!isStoreConfigured() || !isTelegramConfigured()) {
    // Can't look anything up or reply — still 200 so Telegram doesn't retry.
    return NextResponse.json({ ok: true, note: "not-configured" });
  }

  let reply: string | null = null;
  let label = "unrecognised";

  if (message.location) {
    reply = await handleLocation(chatIdStr, message.location);
    label = "location";
  } else if (message.text) {
    const command = parseCommand(message.text);
    if (command) {
      reply = await handleCommand(chatIdStr, command);
      label = `/${command}`;
    }
  }

  if (reply === null) {
    return NextResponse.json({ ok: true }); // plain text / unsupported content — stay silent
  }

  const result = await sendTelegram(chatIdStr, reply);
  if (!result.ok) {
    console.error(`[telegram webhook] reply to ${label} (chat ${chatIdStr}) failed: ${result.error}`);
  }

  return NextResponse.json({ ok: true, handled: label });
}
