/**
 * POST /api/telegram/webhook
 * Header: X-Telegram-Bot-Api-Secret-Token: <TELEGRAM_WEBHOOK_SECRET>
 *
 * Receives every message sent to the bot and replies to slash commands.
 * Outbound-only otherwise — see lib/telegram.ts. This is the one place the app
 * accepts inbound traffic from Telegram, so two checks gate everything below:
 *
 *   1. The secret-token header must match TELEGRAM_WEBHOOK_SECRET. Telegram
 *      attaches this automatically once it's registered via `setWebhook`
 *      (see README) — anyone else calling this URL won't have it.
 *   2. The message's chat id must equal TELEGRAM_CHAT_ID. This is a
 *      single-user app; bot usernames are publicly discoverable on Telegram,
 *      so a stranger *can* find and message the bot — they're silently
 *      ignored rather than answered.
 *
 * Always returns 200 once the update itself was validly received, even if a
 * reply failed to send — a non-2xx response makes Telegram retry the same
 * update, which would risk sending some replies twice.
 */

import { NextResponse } from "next/server";
import { getForecastView } from "@/lib/forecast";
import { LAUNDRY_CONFIG } from "@/lib/laundryLogic";
import { buildHomeReply, buildMorningReport, buildNowReply, buildWindowReply } from "@/lib/report";
import { secretMatches } from "@/lib/security";
import { formatClock, sgNow } from "@/lib/sgTime";
import { getHome, isStoreConfigured, setMutedUntil } from "@/lib/store";
import { isTelegramConfigured, sendTelegram } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Minimal typing for the slice of Telegram's Update object this route reads.
// Not a full SDK — just enough to route a text command from a known chat.
// ---------------------------------------------------------------------------
type TelegramUpdate = {
  message?: {
    text?: string;
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

const COMMAND_LIST = [
  "/now — current rain &amp; drying conditions at home",
  "/report — get today's laundry report on demand",
  "/window — best remaining drying window today",
  "/home — show your saved home location",
  "/mute — pause rain alerts for 2 hours",
  "/help — this message",
].join("\n");

const HELP_TEXT = ["🧺 <b>SG Laundry</b> — commands", "", COMMAND_LIST, "",
  "Rain alerts and the daily morning report arrive automatically once a home location is set in the web app.",
].join("\n");

const START_TEXT = [
  "👋 Hi! I'm your Singapore rain &amp; laundry assistant.",
  "",
  "I'll message you automatically when rain's heading for home, and send a daily morning laundry report. You can also ask me anytime:",
  "",
  COMMAND_LIST,
].join("\n");

async function handleCommand(command: string): Promise<string> {
  switch (command) {
    case "start":
      return START_TEXT;

    case "help":
      return HELP_TEXT;

    case "home": {
      const home = await getHome();
      return buildHomeReply(home);
    }

    case "now":
    case "report":
    case "window": {
      const home = await getHome();
      if (!home) {
        return "📍 No home location set yet. Open the web app, drop a pin, and tap “Set this pin as my home.”";
      }
      const view = await getForecastView(home);
      if (command === "now") return buildNowReply(view, home);
      if (command === "window") return buildWindowReply(view);
      // /report reuses the exact same builder the daily cron job uses, called
      // on demand — it deliberately does NOT touch the "already sent today"
      // state, so this can't cancel or duplicate the scheduled 8am report.
      return buildMorningReport(view, home, sgNow().date);
    }

    case "mute": {
      const minutes = LAUNDRY_CONFIG.notification.muteDurationMinutes;
      const until = new Date(Date.now() + minutes * 60_000);
      await setMutedUntil(until);
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

  const text = update.message?.text;
  const chatId = update.message?.chat?.id;

  if (!text || chatId === undefined) {
    return NextResponse.json({ ok: true }); // not a text message (photo, sticker, etc.) — ignore
  }

  const expectedChatId = process.env.TELEGRAM_CHAT_ID;
  if (!expectedChatId || String(chatId) !== expectedChatId) {
    console.warn(`[telegram webhook] ignored message from unrecognised chat ${chatId}`);
    return NextResponse.json({ ok: true });
  }

  const command = parseCommand(text);
  if (!command) {
    return NextResponse.json({ ok: true }); // plain text, not a command — stay silent
  }

  if (!isStoreConfigured() || !isTelegramConfigured()) {
    // Can't look anything up or reply — still 200 so Telegram doesn't retry.
    return NextResponse.json({ ok: true, note: "not-configured" });
  }

  const reply = await handleCommand(command);
  const result = await sendTelegram(reply);
  if (!result.ok) {
    console.error(`[telegram webhook] reply to /${command} failed: ${result.error}`);
  }

  return NextResponse.json({ ok: true, command });
}
