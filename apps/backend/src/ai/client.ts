import { GoogleGenerativeAI, type Part, type ResponseSchema } from "@google/generative-ai";
import { aiConfig } from "../config/env.js";
import { withRetry } from "../infra/retry.js";
import { ExternalServiceError, errorMessage } from "../infra/errors.js";

export const genAI = new GoogleGenerativeAI(aiConfig.geminiApiKey);

export { withRetry } from "../infra/retry.js";

/**
 * Runs a text prompt through the given Gemini model with retry, and wraps any
 * failure in one typed error so every call site handles Gemini failures the
 * same way instead of re-deriving `error.message` shape checks individually.
 *
 * `client` defaults to the shared singleton but can be overridden (e.g. with
 * a mock `GoogleGenerativeAI` in unit tests) instead of importing `genAI`
 * directly, so callers don't need to reach into a module-level singleton.
 */
export async function generateContent(
  modelName: string,
  prompt: string,
  client: GoogleGenerativeAI = genAI
): Promise<string> {
  try {
    const model = client.getGenerativeModel({ model: modelName });
    const result = await withRetry(() => model.generateContent(prompt));
    const response = await result.response;
    return response.text().trim();
  } catch (error) {
    throw new ExternalServiceError("gemini", errorMessage(error), error);
  }
}

/**
 * Runs a multimodal prompt (text mixed with an `inlineData` image/audio blob)
 * through Gemini. Same retry/error-wrapping contract as `generateContent` — used
 * for describing images and transcribing voice notes (`media-transcription.service.ts`)
 * so a webhook event without a `text` field can still be turned into text and fed
 * through the existing text-only reply pipeline.
 */
export async function generateContentFromParts(
  modelName: string,
  parts: Part[],
  client: GoogleGenerativeAI = genAI
): Promise<string> {
  try {
    const model = client.getGenerativeModel({ model: modelName });
    const result = await withRetry(() =>
      model.generateContent({ contents: [{ role: "user", parts }] })
    );
    const response = await result.response;
    return response.text().trim();
  } catch (error) {
    throw new ExternalServiceError("gemini", errorMessage(error), error);
  }
}

/**
 * Runs a prompt with Gemini's JSON mode (`responseSchema`) and parses the
 * result, so callers get a typed object back instead of free text they'd
 * have to parse themselves. Same retry/error-wrapping contract as
 * `generateContent` — a request failure *or* an unparsable response both
 * surface as one `ExternalServiceError("gemini", ...)`.
 */
export async function generateStructuredContent<T>(
  modelName: string,
  prompt: string,
  responseSchema: ResponseSchema,
  client: GoogleGenerativeAI = genAI
): Promise<T> {
  try {
    const model = client.getGenerativeModel({
      model: modelName,
      generationConfig: { responseMimeType: "application/json", responseSchema },
    });
    const result = await withRetry(() =>
      model.generateContent({ contents: [{ role: "user", parts: [{ text: prompt }] }] })
    );
    const response = await result.response;
    return JSON.parse(response.text().trim()) as T;
  } catch (error) {
    throw new ExternalServiceError("gemini", errorMessage(error), error);
  }
}
