import { whatsappConfig } from "../../config/env.js";
import { logger } from "../../infra/logger.js";
import { errorMessage } from "../../infra/errors.js";
import { graphPost } from "../facebook/graph-client.js";

export function isWhatsAppConfigured(): boolean {
  return Boolean(whatsappConfig.accessToken && whatsappConfig.phoneNumberId);
}

/**
 * Sends a WhatsApp Cloud API text reply. Return shape is normalized to
 * `{ message_id }` — the same shape `sendMessengerReply` returns — so the
 * pending-reply worker's delivery check doesn't need platform-specific
 * branching beyond picking which send function to call.
 */
export async function sendWhatsAppReply(to: string, text: string) {
  try {
    const response = await graphPost(
      `${whatsappConfig.phoneNumberId}/messages`,
      { messaging_product: "whatsapp", to, type: "text", text: { body: text } },
      {},
      whatsappConfig.accessToken
    );

    const messageId = response?.data?.messages?.[0]?.id;
    logger.info("WhatsApp reply sent:", { data: response?.data });
    return messageId ? { message_id: messageId } : null;
  } catch (error) {
    logger.error("Failed to send WhatsApp reply.", { error: errorMessage(error) });
    return null;
  }
}
