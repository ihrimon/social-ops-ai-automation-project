import type { Model } from "mongoose";
import { mongoConfig } from "../../config/env.js";
import { logger } from "../../infra/logger.js";
import { errorMessage } from "../../infra/errors.js";
import { createEmbedding } from "../knowledge/embedding.service.js";
import { ConversationMessage, type ConversationMessageDoc } from "./conversation.model.js";

const MAX_MESSAGES_PER_USER = 60;
const RECENT_MESSAGES_PER_REPLY = 6;
const RELEVANT_MESSAGES_PER_REPLY = 4;

let vectorSearchUnavailable = false;

function normalizeMessage(message: any) {
  return {
    role: message.role,
    text: message.text,
    createdAt: message.createdAt?.toISOString?.() || message.createdAt,
  };
}

async function getRecentMessages(model: Model<ConversationMessageDoc>, userId: string) {
  const messages = await model
    .find({ userId })
    .sort({ createdAt: -1 })
    .limit(RECENT_MESSAGES_PER_REPLY)
    .select({ _id: 0, role: 1, text: 1, createdAt: 1 })
    .lean();

  return messages.reverse().map(normalizeMessage);
}

async function getRelevantMessages(
  model: Model<ConversationMessageDoc>,
  userId: string,
  userMessage: string
) {
  if (vectorSearchUnavailable || !userMessage) {
    return [];
  }

  try {
    const safeQuery = String(userMessage).slice(0, 1000);
    const queryVector = await createEmbedding(safeQuery);
    const messages = await model.aggregate([
      {
        $vectorSearch: {
          index: mongoConfig.conversationVectorIndex,
          path: "embedding",
          queryVector,
          numCandidates: 50,
          limit: RELEVANT_MESSAGES_PER_REPLY,
          filter: { userId, hasEmbedding: true },
        },
      },
      {
        $project: {
          _id: 0,
          role: 1,
          text: 1,
          createdAt: 1,
          score: { $meta: "vectorSearchScore" },
        },
      },
    ]);

    return messages.map(normalizeMessage);
  } catch (error) {
    vectorSearchUnavailable = true;
    logger.warn("MongoDB vector search unavailable. Falling back to recent messages only:", {
      error: errorMessage(error),
    });
    return [];
  }
}

async function trimOldMessages(model: Model<ConversationMessageDoc>, userId: string) {
  const oldMessages = await model
    .find({ userId })
    .sort({ createdAt: -1 })
    .skip(MAX_MESSAGES_PER_USER)
    .select({ _id: 1 })
    .lean();

  if (oldMessages.length) {
    await model.deleteMany({
      _id: { $in: oldMessages.map((message) => message._id) },
    });
  }
}

export async function getConversationContext(
  userId: string,
  userMessage = "",
  model: Model<ConversationMessageDoc> = ConversationMessage
) {
  if (!mongoConfig.uri) {
    logger.warn("MONGODB_URI is not set. Skipping conversation memory retrieval.");
    return { recentMessages: [], relevantMemories: [] };
  }

  const [recentMessages, relevantMemories] = await Promise.all([
    getRecentMessages(model, userId),
    getRelevantMessages(model, userId, userMessage),
  ]);

  const recentKeys = new Set(recentMessages.map((message) => `${message.role}:${message.text}`));

  return {
    recentMessages,
    relevantMemories: relevantMemories.filter(
      (message) => !recentKeys.has(`${message.role}:${message.text}`)
    ),
  };
}

export async function addConversationMessage(
  userId: string,
  role: string,
  text: string,
  metadata: Record<string, unknown> = {},
  model: Model<ConversationMessageDoc> = ConversationMessage
): Promise<void> {
  if (!mongoConfig.uri) {
    logger.warn("MONGODB_URI is not set. Skipping saving conversation message.");
    return;
  }
  const createdAt = new Date();

  const safeText = String(text || "").trim();
  const truncatedText = safeText.length > 1000 ? safeText.slice(0, 1000) + "..." : safeText;
  const shouldEmbed = role === "user" && truncatedText.length >= 12;
  const embedding = shouldEmbed ? await createEmbedding(truncatedText) : null;

  await model.create({
    userId,
    role,
    text: truncatedText,
    hasEmbedding: Boolean(embedding),
    ...(embedding ? { embedding } : {}),
    createdAt,
    ...metadata,
  });

  await trimOldMessages(model, userId);
}

/**
 * Lists distinct conversations (one row per userId) for the admin dashboard,
 * newest last-message first. No equivalent query existed before this.
 */
export async function listConversations(
  { limit = 20, before }: { limit?: number; before?: Date } = {},
  model: Model<ConversationMessageDoc> = ConversationMessage
) {
  return model.aggregate([
    ...(before ? [{ $match: { createdAt: { $lt: before } } }] : []),
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: "$userId",
        lastMessageText: { $first: "$text" },
        lastMessageRole: { $first: "$role" },
        lastMessageAt: { $first: "$createdAt" },
        messageCount: { $sum: 1 },
        // Sorted desc above, so this is the most recent message's platform —
        // absent on conversations entirely predating the multi-channel rollout.
        platform: { $first: "$platform" },
      },
    },
    { $sort: { lastMessageAt: -1 } },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        userId: "$_id",
        lastMessageText: 1,
        lastMessageRole: 1,
        lastMessageAt: 1,
        messageCount: 1,
        platform: 1,
      },
    },
  ]);
}

/** Full (oldest-first) message history for one user, for the conversation detail view. */
export async function getConversationHistory(
  userId: string,
  { limit = 100 }: { limit?: number } = {},
  model: Model<ConversationMessageDoc> = ConversationMessage
) {
  const messages = await model
    .find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select({ _id: 0, role: 1, text: 1, createdAt: 1, isHumanAdmin: 1, platform: 1 })
    .lean();

  return messages.reverse();
}

export async function getLastHumanInteractionTime(
  userId: string,
  model: Model<ConversationMessageDoc> = ConversationMessage
): Promise<Date | null> {
  if (!mongoConfig.uri) {
    return null;
  }
  try {
    const lastMessage = await model
      .findOne({ userId, isHumanAdmin: true })
      .sort({ createdAt: -1 })
      .lean();
    return lastMessage ? new Date((lastMessage as any).createdAt) : null;
  } catch (error) {
    logger.error("Failed to fetch last human interaction time:", { error: errorMessage(error) });
    return null;
  }
}
