import { aiConfig } from "../../config/env.js";
import { logger } from "../../infra/logger.js";
import { errorMessage } from "../../infra/errors.js";
import { generateStructuredContent } from "../../ai/client.js";
import {
  URGENCY_SCHEMA,
  buildUrgencyClassifyPrompt,
  type UrgencyClassification,
} from "../../ai/prompts/urgency-classify.prompt.js";
import { isTelegramConfigured, sendTelegramAlert } from "../../integrations/telegram/client.js";

const MESSAGE_SNIPPET_LENGTH = 300;

/**
 * Best-effort: classifies one consolidated reply cycle's message for
 * sentiment/urgency and pushes a Telegram alert when it crosses the
 * threshold, so the owner finds out immediately instead of next time they
 * open the admin dashboard. Runs regardless of lead status — unlike lead
 * extraction, a post-sale support complaint can still be urgent. Never
 * throws into its caller; a classification/alert failure must not affect
 * message delivery.
 */
export async function checkAndAlertUrgency(
  userId: string,
  platform: "messenger" | "whatsapp" | "instagram",
  messageText: string
): Promise<void> {
  if (!isTelegramConfigured()) {
    return;
  }

  try {
    const prompt = buildUrgencyClassifyPrompt(messageText);
    const classification = await generateStructuredContent<UrgencyClassification>(
      aiConfig.model,
      prompt,
      URGENCY_SCHEMA
    );

    if (classification.sentiment !== "negative" && classification.urgency !== "high") {
      return;
    }

    const snippet =
      messageText.length > MESSAGE_SNIPPET_LENGTH
        ? `${messageText.slice(0, MESSAGE_SNIPPET_LENGTH)}...`
        : messageText;

    await sendTelegramAlert(
      `🚨 ${classification.sentiment}/${classification.urgency} message from ${platform} user ${userId}\n"${snippet}"\nReason: ${classification.reason}`
    );
  } catch (error) {
    logger.warn(`Urgency alert failed for ${userId}:`, { error: errorMessage(error) });
  }
}
