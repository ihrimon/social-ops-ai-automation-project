import axios from "axios";
import { logger } from "../../infra/logger.js";
import { errorMessage } from "../../infra/errors.js";
import { withRetry } from "../../infra/retry.js";

export interface FetchedMedia {
  data: string;
  mimeType: string;
}

/**
 * Downloads a Messenger/Instagram attachment (identical shape/CDN on both
 * platforms). The `payload.url` in these webhook events is a pre-signed URL —
 * unlike WhatsApp's media IDs, no access token/auth header is needed to fetch it.
 * Best-effort: returns `null` (logged) rather than throwing, since a failed
 * download should just fall back to the message being treated as unsupported.
 */
export async function fetchMetaAttachmentAsBase64(url: string): Promise<FetchedMedia | null> {
  try {
    const response = await withRetry(() => axios.get(url, { responseType: "arraybuffer" }));
    const mimeType = String(response.headers["content-type"] || "application/octet-stream");
    return { data: Buffer.from(response.data).toString("base64"), mimeType };
  } catch (error) {
    logger.error("Failed to download Messenger/Instagram attachment.", {
      error: errorMessage(error),
    });
    return null;
  }
}
