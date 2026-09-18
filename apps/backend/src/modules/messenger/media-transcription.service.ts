import { aiConfig } from "../../config/env.js";
import { logger } from "../../infra/logger.js";
import { errorMessage } from "../../infra/errors.js";
import { generateContentFromParts } from "../../ai/client.js";

const IMAGE_DESCRIBE_PROMPT = `A customer sent this image in a Messenger/WhatsApp/Instagram chat to a web-development business. Describe what's in the image in one or two sentences, focused on anything relevant to a web-development inquiry (e.g. a screenshot of a website/design/error, a payment receipt, a business logo/reference, a handwritten note). If there is readable text in the image, include the key parts. Write the description in Bangla unless the image's content is clearly English-context. Respond with only the description, nothing else.`;

const AUDIO_TRANSCRIBE_PROMPT = `Transcribe exactly what the speaker says in this voice message, in whichever language they spoke (likely Bangla or English). Respond with only the transcription, nothing else — no translation, no commentary.`;

/**
 * Describes an image so it can be fed through the existing text-only reply
 * pipeline as if the customer had typed it. Prefixed so it's clearly
 * distinguishable from something actually typed, in conversation history and the
 * admin dashboard. Best-effort — returns `null` (logged) on failure rather than
 * throwing, consistent with every other AI call in the ingestion path.
 */
export async function describeImageMessage(
  base64Data: string,
  mimeType: string
): Promise<string | null> {
  try {
    const description = await generateContentFromParts(aiConfig.model, [
      { text: IMAGE_DESCRIBE_PROMPT },
      { inlineData: { mimeType, data: base64Data } },
    ]);
    return description ? `[Customer sent an image] ${description}` : null;
  } catch (error) {
    logger.warn("Image description failed:", { error: errorMessage(error) });
    return null;
  }
}

/**
 * Transcribes a voice note so it can be fed through the existing text-only reply
 * pipeline. No prefix — a transcript *is* what the customer said, so it should
 * read exactly like a typed message.
 */
export async function transcribeAudioMessage(
  base64Data: string,
  mimeType: string
): Promise<string | null> {
  try {
    const transcription = await generateContentFromParts(aiConfig.model, [
      { text: AUDIO_TRANSCRIBE_PROMPT },
      { inlineData: { mimeType, data: base64Data } },
    ]);
    return transcription || null;
  } catch (error) {
    logger.warn("Audio transcription failed:", { error: errorMessage(error) });
    return null;
  }
}
