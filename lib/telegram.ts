/**
 * Telegram Bot API client (server side only).
 *
 * Outbound-only: this app sends messages to one chat (yours). It never reads
 * updates or handles commands — there's no webhook, no polling, nothing
 * inbound. That keeps it a pure notification sink with no attack surface.
 *
 * Configuration is two env vars, mirroring how store.ts / push.ts degrade when
 * unset so the rest of the app keeps working without Telegram:
 *   TELEGRAM_BOT_TOKEN  — from @BotFather
 *   TELEGRAM_CHAT_ID    — your personal chat id (see README)
 */

export function isTelegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

export type TelegramResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Send a message to the configured chat.
 *
 * Uses HTML parse mode (simpler and safer to escape than MarkdownV2, which
 * requires escaping a long list of punctuation). Callers that include dynamic
 * text — place names, etc. — must run it through `escapeHtml` first.
 *
 * `disableNotification` sends silently (no sound/vibration) — used for the
 * morning report so the daily digest doesn't buzz like an urgent alert.
 */
export async function sendTelegram(
  text: string,
  { disableNotification = false }: { disableNotification?: boolean } = {}
): Promise<TelegramResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
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
      // (bad token, wrong chat_id, bot blocked, etc.) — surface it for the
      // ?test=telegram diagnostic.
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
