import type { Model } from "mongoose";
import { Lead, type LeadDoc } from "./lead.model.js";
import { ConversationMessage } from "./conversation.model.js";
import type { LeadRequirements } from "../../ai/prompts/lead-extraction.prompt.js";

export const LEAD_STATUSES = ["none", "lead", "sale"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Upserts the lead/sale outcome for a conversation — an admin-dashboard action, not inferred. */
export async function setLeadStatus(
  userId: string,
  status: LeadStatus,
  note?: string,
  model: Model<LeadDoc> = Lead
): Promise<void> {
  await model.updateOne(
    { userId },
    { $set: { status, note, markedAt: new Date() } },
    { upsert: true }
  );
}

export async function getLeadStatus(
  userId: string,
  model: Model<LeadDoc> = Lead
): Promise<{
  status: LeadStatus;
  note?: string;
  markedAt?: Date;
  requirements: LeadRequirements | null;
} | null> {
  const doc = await model.findOne({ userId }).lean();
  if (!doc) return null;
  return {
    status: doc.status as LeadStatus,
    note: doc.note,
    markedAt: doc.markedAt,
    requirements: (doc.requirements as LeadRequirements) ?? null,
  };
}

/**
 * Lightweight read for the extraction service — just enough to decide
 * whether to skip (status already "sale") and to seed the prompt with what's
 * already known, without pulling the admin-only note/markedAt fields.
 */
export async function getLeadRequirements(
  userId: string,
  model: Model<LeadDoc> = Lead
): Promise<{ status: LeadStatus; requirements: LeadRequirements | null }> {
  const doc = await model.findOne({ userId }).select({ status: 1, requirements: 1 }).lean();
  return {
    status: (doc?.status as LeadStatus) ?? "none",
    requirements: (doc?.requirements as LeadRequirements) ?? null,
  };
}

const REQUIREMENT_SCALAR_FIELDS = [
  "contactName",
  "contactPhone",
  "businessType",
  "hasExistingWebsite",
  "pageCount",
  "deadline",
  "referenceWebsite",
  "budgetHint",
] as const satisfies readonly (keyof LeadRequirements)[];

/**
 * Merges freshly-extracted requirement fields into the stored record. Only
 * non-empty scalar fields overwrite their previous value (so a partial
 * extraction never blanks out something learned earlier), and `features` is
 * unioned rather than replaced. Never touches `status`/`note`/`markedAt` —
 * those stay admin-only (`setLeadStatus`).
 */
export async function upsertLeadRequirements(
  userId: string,
  extracted: LeadRequirements,
  model: Model<LeadDoc> = Lead
): Promise<void> {
  const setFields: Record<string, unknown> = { requirementsUpdatedAt: new Date() };

  for (const field of REQUIREMENT_SCALAR_FIELDS) {
    const value = extracted[field];
    if (typeof value === "string" && value.trim()) {
      setFields[`requirements.${field}`] = value.trim();
    }
  }

  const update: Record<string, unknown> = { $set: setFields };
  const features = extracted.features?.filter((feature) => feature?.trim());
  if (features && features.length > 0) {
    update.$addToSet = { "requirements.features": { $each: features } };
  }

  await model.updateOne({ userId }, update, { upsert: true, setDefaultsOnInsert: true });
}

/** Batch lookup for the conversation list view — one query instead of one per row. */
export async function getLeadStatusesForUsers(
  userIds: string[],
  model: Model<LeadDoc> = Lead
): Promise<Map<string, LeadStatus>> {
  if (userIds.length === 0) return new Map();

  const docs = await model
    .find({ userId: { $in: userIds } })
    .select({ userId: 1, status: 1 })
    .lean();

  return new Map(docs.map((doc) => [doc.userId, doc.status as LeadStatus]));
}

export async function listLeads(
  { status, limit = 20 }: { status?: LeadStatus; limit?: number } = {},
  model: Model<LeadDoc> = Lead
) {
  const filter: Record<string, unknown> = status ? { status } : { status: { $ne: "none" } };
  return model.find(filter).sort({ markedAt: -1 }).limit(limit).lean();
}

/**
 * Total distinct Messenger conversations (from ConversationMessage, the
 * source of truth for "a conversation happened") vs. how many were marked as
 * a lead or a sale — the dashboard's conversion-rate numerator/denominator.
 */
export async function getLeadStats(
  leadModel: Model<LeadDoc> = Lead,
  conversationModel = ConversationMessage
): Promise<{ totalConversations: number; totalLeads: number; totalSales: number }> {
  const [userIds, totalLeads, totalSales] = await Promise.all([
    conversationModel.distinct("userId"),
    leadModel.countDocuments({ status: "lead" }),
    leadModel.countDocuments({ status: "sale" }),
  ]);

  return { totalConversations: userIds.length, totalLeads, totalSales };
}
