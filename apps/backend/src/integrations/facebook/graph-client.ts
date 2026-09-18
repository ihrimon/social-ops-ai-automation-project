import axios from "axios";
import { facebookConfig } from "../../config/env.js";
import { withRetry } from "../../infra/retry.js";
import { ExternalServiceError } from "../../infra/errors.js";

/** Base URL for the configured Facebook Graph API version. */
export function graphUrl(path: string): string {
  return `https://graph.facebook.com/${facebookConfig.graphApiVersion}/${path}`;
}

/**
 * Converts any Graph API failure into one typed error carrying the API's own
 * error detail in the message, so every caller (poster, messenger, comment
 * service) can just log/rethrow without re-parsing `error.response.data`.
 */
function wrapGraphError(error: unknown): never {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    throw new ExternalServiceError(
      "facebook",
      `Facebook Graph API request failed: ${detail}`,
      error
    );
  }
  throw error;
}

/**
 * GET a Graph API path, retrying transient failures. Defaults to the Page access
 * token, but takes the same override `graphPost` does (e.g. for a WhatsApp media
 * metadata lookup, which authenticates with its own token).
 */
export async function graphGet<T = any>(
  path: string,
  params: Record<string, unknown> = {},
  accessToken: string | undefined = facebookConfig.pageAccessToken
) {
  try {
    return await withRetry(() =>
      axios.get<T>(graphUrl(path), {
        params: { access_token: accessToken, ...params },
      })
    );
  } catch (error) {
    wrapGraphError(error);
  }
}

/**
 * POST to a Graph API path, retrying transient failures. Defaults to the Page
 * access token, but takes an override so other Graph API products under the
 * same app (e.g. WhatsApp Cloud API, which authenticates with its own token)
 * can reuse this instead of duplicating the retry/error-wrap logic.
 */
export async function graphPost<T = any>(
  path: string,
  body: unknown,
  params: Record<string, unknown> = {},
  accessToken: string | undefined = facebookConfig.pageAccessToken
) {
  try {
    return await withRetry(() =>
      axios.post<T>(graphUrl(path), body, {
        params: { access_token: accessToken, ...params },
        headers: { "Content-Type": "application/json" },
      })
    );
  } catch (error) {
    wrapGraphError(error);
  }
}
