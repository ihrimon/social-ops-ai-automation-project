import axios from "axios";
import { whatsappConfig } from "../../config/env.js";
import { logger } from "../../infra/logger.js";
import { errorMessage } from "../../infra/errors.js";
import { withRetry } from "../../infra/retry.js";
import { graphGet } from "../facebook/graph-client.js";
import type { FetchedMedia } from "../facebook/media.js";

/**
 * WhatsApp Cloud API references media by ID, not a direct URL — downloading it
 * is a two-step flow: (1) resolve the ID to a temporary URL via the Graph API,
 * (2) download that URL with the WhatsApp access token as a Bearer header (unlike
 * Messenger/Instagram's pre-signed attachment URLs, this one requires auth).
 * Best-effort: returns `null` (logged) on either step failing.
 */
export async function fetchWhatsAppMediaAsBase64(mediaId: string): Promise<FetchedMedia | null> {
  try {
    const metaResponse = await graphGet<{ url?: string; mime_type?: string }>(
      mediaId,
      {},
      whatsappConfig.accessToken
    );
    const mediaUrl = metaResponse?.data?.url;
    if (!mediaUrl) {
      logger.warn(`WhatsApp media lookup for ${mediaId} returned no URL.`);
      return null;
    }

    const fileResponse = await withRetry(() =>
      axios.get(mediaUrl, {
        responseType: "arraybuffer",
        headers: { Authorization: `Bearer ${whatsappConfig.accessToken}` },
      })
    );

    const mimeType =
      metaResponse.data.mime_type ||
      String(fileResponse.headers["content-type"] || "application/octet-stream");
    return { data: Buffer.from(fileResponse.data).toString("base64"), mimeType };
  } catch (error) {
    logger.error(`Failed to download WhatsApp media ${mediaId}.`, { error: errorMessage(error) });
    return null;
  }
}
