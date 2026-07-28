/**
 * Telegram Bot API client (server side only).
 *
 * Multi-user: this sends to *any* chat id the caller supplies — there's no
 * single "the" configured recipient anymore, since any Telegram user who
 * registers a location becomes a valid target. The one env var this module
 * needs is the bot's own token; everything else is per-call.
 *
 * Inbound handling (commands, location shares) lives in
 * app/api/telegram/webhook/route.ts — this file only ever calls `sendMessage`.
 */

export function isTelegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

export type TelegramResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Send a message to a specific chat.
 *
 * Uses HTML parse mode (simpler and safer to escape than MarkdownV2, which
 * requires escaping a long list of punctuation). Callers that include dynamic
 * text — place names, etc. — must run it through `escapeHtml` first.
 *
 * `disableNotification` sends silently (no sound/vibration) — used for the
 * morning report so the daily digest doesn't buzz like an urgent alert.
 */
export async function sendTelegram(
  chatId: string,
  text: string,
  { disableNotification = false }: { disableNotification?: boolean } = {}
): Promise<TelegramResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return { ok: false, error: "Telegram is not configured" };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        // Rain alerts often reference the radar; keep link previews off so the
        // message stays compact.
        disable_web_page_preview: true,
        disable_notification: disableNotification,
      }),
    });

    if (!res.ok) {
      // Telegram returns a JSON body with `description` explaining the failure
      // (bad token, chat not found, bot blocked by that user, etc.).
      const body = (await res.json().catch(() => null)) as
        | { description?: string }
        | null;
      return {
        ok: false,
        error: body?.description ?? `Telegram API returned ${res.status}`,
      };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Escape the five characters Telegram's HTML parse mode treats as markup. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
