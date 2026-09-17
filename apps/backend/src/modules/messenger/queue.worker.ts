import { randomUUID } from "node:crypto";
import type { Model } from "mongoose";
import { messengerConfig } from "../../config/env.js";
import { logger } from "../../infra/logger.js";
import { PendingReply, type PendingReplyDoc } from "./pending-reply.model.js";

export interface PendingReplyMessage {
  id: string;
  text: string;
  receivedAt: Date;
}

export interface PendingReplyJob {
  _id: unknown;
  userId: string;
  platform: "messenger" | "whatsapp";
  messages: PendingReplyMessage[];
  claimId: string;
  claimedAt: Date;
  delivered?: boolean;
}

const PENDING_REPLY_TTL_MS = 24 * 60 * 60 * 1000;

function expiryDate(now = new Date()): Date {
  return new Date(now.getTime() + PENDING_REPLY_TTL_MS);
}

/**
 * Adds a user message to that user's short-lived reply buffer. There is only
 * one buffer document per user, regardless of how many messages they send.
 *
 * Uses an aggregation-pipeline update (array update expression), which
 * Mongoose's typed query builder doesn't model — so this drops down to the
 * native driver collection Mongoose wraps (`model.collection`) for this one
 * operation, same as the raw MongoDB driver did before.
 */
export async function queueUserMessage(
  userId: string,
  text: string,
  messageId: string,
  platform: "messenger" | "whatsapp" = "messenger",
  model: Model<PendingReplyDoc> = PendingReply
): Promise<void> {
  const now = new Date();
  const replyAt = new Date(now.getTime() + messengerConfig.replyDebounceMs);
  const message: PendingReplyMessage = { id: messageId, text, receivedAt: now };

  await model.collection.updateOne(
    { userId },
    [
      {
        $set: {
          userId: { $ifNull: ["$userId", userId] },
          // Set once on first insert — a userId's platform never changes after that.
          platform: { $ifNull: ["$platform", platform] },
          createdAt: { $ifNull: ["$createdAt", now] },
          messages: {
            $slice: [
              { $concatArrays: [{ $ifNull: ["$messages", []] }, [message]] },
              -messengerConfig.pendingMessageLimit,
            ],
          },
          // Do not interrupt a reply already being generated. The new message
          // stays in the buffer and will be handled by the next job.
          status: {
            $cond: [
              { $eq: [{ $ifNull: ["$status", "pending"] }, "processing"] },
              "processing",
              "pending",
            ],
          },
          hasPendingMessages: true,
          replyAt: {
            $cond: [
              { $gt: [{ $ifNull: ["$pausedUntil", new Date(0)] }, replyAt] },
              "$pausedUntil",
              replyAt,
            ],
          },
          updatedAt: now,
          expiresAt: expiryDate(now),
        },
      },
    ] as any,
    { upsert: true }
  );
}

/** Records the 10-minute human-admin handoff without creating chat history. */
export async function pauseUserReplies(
  userId: string,
  model: Model<PendingReplyDoc> = PendingReply
): Promise<void> {
  const now = new Date();
  const pausedUntil = new Date(now.getTime() + messengerConfig.adminPauseMs);

  await model.updateOne(
    { userId },
    {
      $setOnInsert: {
        userId,
        messages: [],
        status: "idle",
        hasPendingMessages: false,
        createdAt: now,
      },
      $set: {
        pausedUntil,
        updatedAt: now,
        expiresAt: expiryDate(now),
      },
      // A pending reply must not run before the latest human handoff expires.
      $max: { replyAt: pausedUntil },
    },
    { upsert: true }
  );
}

/**
 * Atomically claims one due reply. A separate claim prevents two scheduler
 * runs (or future app instances) from replying to the same user at once.
 *
 * Uses `findOneAndUpdate` with a `$or` filter and touches the pause window,
 * which is simplest expressed directly against the native driver collection.
 */
export async function claimNextDueReply(
  model: Model<PendingReplyDoc> = PendingReply
): Promise<PendingReplyJob | null> {
  const now = new Date();
  const candidate = await model.collection.findOne(
    {
      status: "pending",
      hasPendingMessages: true,
      replyAt: { $lte: now },
    },
    { sort: { replyAt: 1 } }
  );

  if (!candidate) {
    return null;
  }

  if (candidate.pausedUntil && candidate.pausedUntil > now) {
    await model.collection.updateOne(
      { _id: candidate._id, status: "pending" },
      { $set: { replyAt: candidate.pausedUntil, updatedAt: now } }
    );
    return null;
  }

  const claimId = randomUUID();
  const job = await model.collection.findOneAndUpdate(
    {
      _id: candidate._id,
      status: "pending",
      hasPendingMessages: true,
      replyAt: { $lte: now },
      $or: [{ pausedUntil: { $exists: false } }, { pausedUntil: { $lte: now } }],
    },
    {
      $set: {
        status: "processing",
        hasPendingMessages: false,
        delivered: false,
        claimId,
        claimedAt: now,
        leaseUntil: new Date(now.getTime() + messengerConfig.replyLeaseMs),
        updatedAt: now,
      },
    },
    { returnDocument: "after" }
  );

  return (job as unknown as PendingReplyJob) || null;
}

/** Clears an admin pause early (dashboard "resume AI" action) rather than waiting out `pausedUntil`. */
export async function resumeUserReplies(
  userId: string,
  model: Model<PendingReplyDoc> = PendingReply
): Promise<void> {
  await model.updateOne(
    { userId },
    { $unset: { pausedUntil: "" }, $set: { updatedAt: new Date() } }
  );
}

/** Whether a user's AI replies are currently paused (admin handoff), for the dashboard's conversation list. */
export async function getPauseStatus(
  userId: string,
  model: Model<PendingReplyDoc> = PendingReply
): Promise<{ paused: boolean; pausedUntil: Date | null }> {
  const state = await model.findOne({ userId }).select({ pausedUntil: 1 }).lean();
  const pausedUntil = state?.pausedUntil ?? null;
  return { paused: Boolean(pausedUntil && pausedUntil > new Date()), pausedUntil };
}

export async function wasPausedAfterClaim(
  userId: string,
  claimedAt: Date,
  model: Model<PendingReplyDoc> = PendingReply
): Promise<boolean> {
  const state = await model.findOne({ userId }).select({ pausedUntil: 1 }).lean();
  return Boolean(state?.pausedUntil && state.pausedUntil > claimedAt);
}

export async function releaseClaim(
  job: PendingReplyJob,
  retryDelayMs = messengerConfig.replyRetryMs,
  model: Model<PendingReplyDoc> = PendingReply
): Promise<void> {
  const now = new Date();
  await model.updateOne(
    { _id: job._id, status: "processing", claimId: job.claimId },
    {
      $set: {
        status: "pending",
        hasPendingMessages: true,
        replyAt: new Date(now.getTime() + retryDelayMs),
        updatedAt: now,
      },
      $unset: { claimId: "", claimedAt: "", leaseUntil: "", delivered: "" },
    }
  );
}

/**
 * Marks that the Messenger Send API call for this claim already succeeded.
 * Called immediately after a successful send — before conversation-memory
 * writes or `completeClaim` — so that if the process crashes before the claim
 * is finalized, lease reclaim knows not to resend the same reply.
 */
export async function markClaimDelivered(
  job: PendingReplyJob,
  model: Model<PendingReplyDoc> = PendingReply
): Promise<void> {
  await model.updateOne(
    { _id: job._id, status: "processing", claimId: job.claimId },
    { $set: { delivered: true, deliveredAt: new Date(), updatedAt: new Date() } }
  );
}

/**
 * Removes only the messages included in this claim, preserving newer ones.
 *
 * Uses an aggregation-pipeline update (array `$filter`/`$cond`), so this
 * drops down to the native driver collection for the same reason as
 * `queueUserMessage`.
 */
export async function completeClaim(
  job: PendingReplyJob,
  model: Model<PendingReplyDoc> = PendingReply
): Promise<void> {
  const claimedMessageIds = job.messages.map((message) => message.id);
  const now = new Date();

  await model.collection.updateOne({ _id: job._id, status: "processing", claimId: job.claimId }, [
    {
      $set: {
        messages: {
          $filter: {
            input: "$messages",
            as: "message",
            cond: { $not: [{ $in: ["$$message.id", claimedMessageIds] }] },
          },
        },
      },
    },
    {
      $set: {
        hasPendingMessages: { $gt: [{ $size: "$messages" }, 0] },
        status: {
          $cond: [{ $gt: [{ $size: "$messages" }, 0] }, "pending", "idle"],
        },
        replyAt: {
          $cond: [{ $gt: [{ $size: "$messages" }, 0] }, "$replyAt", null],
        },
        updatedAt: now,
        lastReplyAt: now,
        expiresAt: expiryDate(now),
      },
    },
    { $unset: ["claimId", "claimedAt", "leaseUntil", "delivered", "deliveredAt"] },
  ] as any);
}

/**
 * Reclaims claims whose processing lease expired (e.g. the worker crashed
 * mid-job). If the Send API call was already marked `delivered`, the claim is
 * finalized without resending; otherwise it's released back to `pending` so
 * it gets retried. This closes the gap where a crash between "message sent"
 * and "claim completed" could otherwise cause a duplicate Messenger reply.
 */
export async function reclaimExpiredLeases(
  model: Model<PendingReplyDoc> = PendingReply
): Promise<void> {
  const now = new Date();
  const expiredJobs = await model.find({ status: "processing", leaseUntil: { $lt: now } }).lean();

  for (const job of expiredJobs) {
    const typedJob = job as unknown as PendingReplyJob;

    if (typedJob.delivered) {
      logger.warn(
        `Reclaiming expired lease for ${typedJob.userId}: reply was already delivered, finalizing without resend.`
      );
      await completeClaim(typedJob, model);
    } else {
      logger.warn(
        `Reclaiming expired lease for ${typedJob.userId}: no delivery recorded, releasing for retry.`
      );
      await releaseClaim(typedJob, 0, model);
    }
  }
}
