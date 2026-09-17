import { SchemaType, type ResponseSchema } from "@google/generative-ai";
import { formatMessages } from "./reply.prompt.js";

interface ConversationMessage {
  role: string;
  text: string;
}

export interface LeadRequirements {
  contactName?: string | null;
  contactPhone?: string | null;
  businessType?: string | null;
  hasExistingWebsite?: string | null;
  pageCount?: string | null;
  features?: string[] | null;
  deadline?: string | null;
  referenceWebsite?: string | null;
  budgetHint?: string | null;
}

const stringField = (description: string): ResponseSchema => ({
  type: SchemaType.STRING,
  nullable: true,
  description,
});

export const LEAD_EXTRACTION_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  nullable: false,
  properties: {
    contactName: stringField("The user's name, if they gave one."),
    contactPhone: stringField("A phone number the user shared."),
    businessType: stringField("What kind of business/site the user runs or wants."),
    hasExistingWebsite: stringField(
      "Free-text summary of whether they already have a website (e.g. 'yes', 'no', 'yes but outdated')."
    ),
    pageCount: stringField("How many pages they need, as they described it."),
    features: {
      type: SchemaType.ARRAY,
      nullable: true,
      description:
        "Specific features requested (e.g. contact form, booking, ecommerce, payment, dashboard).",
      items: { type: SchemaType.STRING },
    },
    deadline: stringField("Any deadline or timeline the user mentioned."),
    referenceWebsite: stringField("A reference website/URL the user mentioned liking."),
    budgetHint: stringField("Any budget/price range the user mentioned, as they phrased it."),
  },
  required: [],
};

function formatExistingRequirements(existing: LeadRequirements | null): string {
  const entries = Object.entries(existing ?? {}).filter(([, value]) =>
    Array.isArray(value) ? value.length > 0 : Boolean(value)
  );
  if (entries.length === 0) {
    return "None known yet.";
  }
  return entries
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
    .join("\n");
}

export function buildLeadExtractionPrompt(
  recentMessages: ConversationMessage[],
  existingRequirements: LeadRequirements | null
): string {
  return `You extract project-requirement facts from a Messenger conversation between a visitor and a web-development business's AI assistant.

Conversation so far:
${formatMessages(recentMessages)}

Already known about this visitor (do not repeat unless they gave new/corrected info):
${formatExistingRequirements(existingRequirements)}

Instructions:
- Only fill a field if the visitor (the "user" role) explicitly stated it somewhere in the conversation.
- Leave a field null if it was never mentioned by the user. Never guess or invent a value.
- If the user corrected or updated something they said earlier, use the newest value.
- Do not fill a field just because the assistant asked about it — only the user's own words count as an answer.
- Respond with JSON matching the given schema only.`;
}
