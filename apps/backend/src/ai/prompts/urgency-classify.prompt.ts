import { SchemaType, type ResponseSchema } from "@google/generative-ai";

export type Sentiment = "positive" | "neutral" | "negative";
export type Urgency = "low" | "medium" | "high";

export interface UrgencyClassification {
  sentiment: Sentiment;
  urgency: Urgency;
  reason: string;
}

export const URGENCY_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    sentiment: {
      type: SchemaType.STRING,
      format: "enum",
      enum: ["positive", "neutral", "negative"],
      description: "The visitor's tone in this message.",
    },
    urgency: {
      type: SchemaType.STRING,
      format: "enum",
      enum: ["low", "medium", "high"],
      description: "How urgently this message needs a human's attention.",
    },
    reason: {
      type: SchemaType.STRING,
      description: "One short sentence explaining the classification, for a human alert.",
    },
  },
  required: ["sentiment", "urgency", "reason"],
};

export function buildUrgencyClassifyPrompt(messageText: string): string {
  return `You classify the tone and urgency of one Messenger/WhatsApp message from a visitor to a web-development business, so a human can be alerted only when it actually matters.

Visitor message:
"${messageText}"

Instructions:
- "sentiment" is the visitor's tone in this message alone: positive, neutral, or negative.
- "urgency" is how urgently a human should look at this: "high" only for things like anger, a threat to leave a bad review, a broken/down site, a payment problem, or an explicit urgent request. "low" for ordinary questions or small talk.
- When in doubt, prefer "neutral" sentiment and "low" urgency — this alert should only fire for messages that genuinely need attention, not every slightly terse message.
- "reason" is one short sentence a business owner can read in a push notification to understand why.
- Respond with JSON matching the given schema only.`;
}
