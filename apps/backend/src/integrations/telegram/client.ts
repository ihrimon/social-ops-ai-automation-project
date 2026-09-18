import axios from "axios";
import { telegramConfig } from "../../config/env.js";
import { withRetry } from "../../infra/retry.js";
import { ExternalServiceError, errorMessage } from "../../infra/errors.js";

export function isTelegramConfigured(): boolean {
  return Boolean(telegramConfig.botToken && telegramConfig.chatId);
}

/** Sends a plain-text push via the Telegram Bot API — a free, instant alert channel. */
export async function sendTelegramAlert(text: string): Promise<void> {
  try {
    await withRetry(() =>
      axios.post(`https://api.telegram.org/bot${telegramConfig.botToken}/sendMessage`, {
        chat_id: telegramConfig.chatId,
        text,
      })
    );
  } catch (error) {
    throw new ExternalServiceError("telegram", errorMessage(error), error);
  }
}
