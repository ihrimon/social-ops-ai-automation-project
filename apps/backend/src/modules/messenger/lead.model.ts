import mongoose, { type InferSchemaType, type Model } from "mongoose";
import { mongoConfig } from "../../config/env.js";

const { Schema, model, models } = mongoose;

/**
 * One permanent record per userId tracking whether a Messenger conversation
 * turned into a real lead/sale — admin-marked, not inferred. Deliberately
 * has no TTL (unlike ConversationMessage/PendingReply, which prune/expire),
 * since this is the durable outcome record the analytics dashboard reports on.
 */
/**
 * AI-extracted project-requirement facts (name/phone/features/deadline/...),
 * kept separate from the admin-only `status`/`note`/`markedAt` fields above —
 * this subdocument is written by `lead-extraction.service.ts`, never by the
 * admin dashboard.
 */
const leadRequirementsSchema = new Schema(
  {
    contactName: { type: String, required: false },
    contactPhone: { type: String, required: false },
    businessType: { type: String, required: false },
    hasExistingWebsite: { type: String, required: false },
    pageCount: { type: String, required: false },
    features: { type: [String], required: false, default: undefined },
    deadline: { type: String, required: false },
    referenceWebsite: { type: String, required: false },
    budgetHint: { type: String, required: false },
  },
  { _id: false }
);

const leadSchema = new Schema(
  {
    userId: { type: String, required: true, unique: true },
    status: { type: String, required: true, default: "none" }, // "none" | "lead" | "sale"
    note: { type: String, required: false },
    markedAt: { type: Date, default: () => new Date() },
    requirements: { type: leadRequirementsSchema, required: false },
    requirementsUpdatedAt: { type: Date, required: false },
  },
  { versionKey: false }
);

leadSchema.index({ status: 1, markedAt: -1 });

export type LeadDoc = InferSchemaType<typeof leadSchema>;

const modelName = "Lead";

export const Lead: Model<LeadDoc> =
  (models[modelName] as Model<LeadDoc>) ||
  model<LeadDoc>(modelName, leadSchema, mongoConfig.leadsCollection);
