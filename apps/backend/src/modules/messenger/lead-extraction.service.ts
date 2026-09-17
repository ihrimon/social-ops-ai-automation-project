import { aiConfig } from "../../config/env.js";
import { logger } from "../../infra/logger.js";
import { errorMessage } from "../../infra/errors.js";
import { generateStructuredContent } from "../../ai/client.js";
import {
  LEAD_EXTRACTION_SCHEMA,
  buildLeadExtractionPrompt,
  type LeadRequirements,
} from "../../ai/prompts/lead-extraction.prompt.js";
import { getLeadRequirements, upsertLeadRequirements } from "./lead.store.js";
import { syncLeadToSheet } from "./lead-sheet-sync.service.js";

interface ConversationMessage {
  role: string;
  text: string;
}

/** Whether extraction actually found anything worth saving/syncing. */
function hasAnyRequirementValue(extracted: LeadRequirements): boolean {
  return Object.entries(extracted).some(([, value]) =>
    Array.isArray(value) ? value.length > 0 : Boolean(value)
  );
}

/**
 * Best-effort: reads the visitor's project-requirement answers back out of
 * the conversation and saves them, so the admin dashboard shows a filled-in
 * summary without the owner re-reading the whole thread. Called after a
 * Messenger reply has already been delivered — a failure here must never
 * throw into the caller or affect message delivery.
 */
export async function extractAndSaveLeadRequirements(
  userId: string,
  recentMessages: ConversationMessage[]
): Promise<void> {
  try {
    const { status, requirements: existingRequirements } = await getLeadRequirements(userId);
    if (status === "sale") {
      return;
    }

    const prompt = buildLeadExtractionPrompt(recentMessages, existingRequirements);
    const extracted = await generateStructuredContent<LeadRequirements>(
      aiConfig.model,
      prompt,
      LEAD_EXTRACTION_SCHEMA
    );

    if (!hasAnyRequirementValue(extracted)) {
      return;
    }

    await upsertLeadRequirements(userId, extracted);
    // Only sync when extraction actually found something — avoids appending a
    // near-empty row to the Sheet for every casual "hi"/small-talk message.
    await syncLeadToSheet(userId);
  } catch (error) {
    logger.warn(`Lead requirement extraction failed for ${userId}:`, {
      error: errorMessage(error),
    });
  }
}
