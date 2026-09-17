import mongoose, { type InferSchemaType, type Model } from "mongoose";
import { mongoConfig } from "../../config/env.js";

const { Schema, model, models } = mongoose;

const pendingMessageSchema = new Schema(
  {
    id: { type: String, required: true },
    text: { type: String, required: true },
    receivedAt: { type: Date, required: true },
  },
  { _id: false }
);

const pendingReplySchema = new Schema(
  {
    userId: { type: String, required: true, unique: true },
    /** Which Send API to use for delivery — set once, on first insert, by `queueUserMessage`. */
    platform: { type: String, enum: ["messenger", "whatsapp"], default: "messenger" },
    messages: { type: [pendingMessageSchema], default: [] },
    status: { type: String, required: true, default: "idle" },
    hasPendingMessages: { type: Boolean, default: false },
    replyAt: { type: Date, required: false },
    pausedUntil: { type: Date, required: false },
    claimId: { type: String, required: false },
    claimedAt: { type: Date, required: false },
    leaseUntil: { type: Date, required: false },
    /** Set right after the Send API call succeeds, before conversation-memory
     * writes or claim completion — so a crash-and-reclaim never resends. */
    delivered: { type: Boolean, default: false },
    deliveredAt: { type: Date, required: false },
    lastReplyAt: { type: Date, required: false },
    createdAt: { type: Date, default: () => new Date() },
    updatedAt: { type: Date, default: () => new Date() },
    expiresAt: { type: Date, required: false },
  },
  { versionKey: false }
);

pendingReplySchema.index({ status: 1, hasPendingMessages: 1, replyAt: 1 });
pendingReplySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type PendingReplyDoc = InferSchemaType<typeof pendingReplySchema>;

const modelName = "PendingReply";

export const PendingReply: Model<PendingReplyDoc> =
  (models[modelName] as Model<PendingReplyDoc>) ||
  model<PendingReplyDoc>(modelName, pendingReplySchema, mongoConfig.pendingRepliesCollection);
