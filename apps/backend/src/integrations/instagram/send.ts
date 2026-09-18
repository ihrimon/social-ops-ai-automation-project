import { instagramConfig } from "../../config/env.js";
import { logger } from "../../infra/logger.js";
import { errorMessage } from "../../infra/errors.js";
import { graphPost } from "../facebook/graph-client.js";

export function isInstagramConfigured(): boolean {
  return Boolean(instagramConfig.igUserId);
}

/**
 * Sends an Instagram DM reply. No access-token override needed — an Instagram
 * professional account linked to the Page authenticates with the same Page
 * access token `graphPost` already defaults to.
 */
export async function sendInstagramReply(to: string, text: string) {
  try {
    const response = await graphPost(`${instagramConfig.igUserId}/messages`, {
      recipient: { id: to },
      message: { text },
    });

    const messageId = response?.data?.message_id;
    logger.info("Instagram DM reply sent:", { data: response?.data });
    return messageId ? { message_id: messageId } : null;
  } catch (error) {
    logger.error("Failed to send Instagram DM reply.", { error: errorMessage(error) });
    return null;
  }
}
