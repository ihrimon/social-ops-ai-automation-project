import { describe, expect, it, vi } from "vitest";
import type { Model } from "mongoose";
import {
  claimNextDueReply,
  completeClaim,
  getPauseStatus,
  markClaimDelivered,
  pauseUserReplies,
  queueUserMessage,
  reclaimExpiredLeases,
  releaseClaim,
  resumeUserReplies,
  wasPausedAfterClaim,
  type PendingReplyJob,
} from "../../src/modules/messenger/queue.worker.js";
import type { PendingReplyDoc } from "../../src/modules/messenger/pending-reply.model.js";

vi.mock("../../src/config/env.js", () => ({
  messengerConfig: {
    replyDebounceMs: 20_000,
    adminPauseMs: 10 * 60 * 1000,
    replyPollMs: 10_000,
    replyConcurrency: 3,
    replyLeaseMs: 5 * 60 * 1000,
    replyRetryMs: 60_000,
    pendingMessageLimit: 20,
  },
  mongoConfig: {
    pendingRepliesCollection: "pending_replies",
  },
  appConfig: {
    nodeEnv: "test",
    logLevel: "silent",
  },
}));

/** Chainable mock for the Mongoose query-builder style (`.findOne(...).select(...).lean()` / `.find(...).lean()`). */
function chainable(resolvedValue: unknown) {
  const node: { select: ReturnType<typeof vi.fn>; lean: ReturnType<typeof vi.fn> } = {
    select: vi.fn(() => node),
    lean: vi.fn().mockResolvedValue(resolvedValue),
  };
  return node;
}

function fakeModel(overrides: Record<string, unknown>) {
  return overrides as unknown as Model<PendingReplyDoc>;
}

function fakeJob(overrides: Partial<PendingReplyJob> = {}): PendingReplyJob {
  return {
    _id: "job-1",
    userId: "user-1",
    platform: "messenger",
    messages: [{ id: "m1", text: "hi", receivedAt: new Date() }],
    claimId: "claim-1",
    claimedAt: new Date(),
    ...overrides,
  };
}

describe("queueUserMessage", () => {
  it("upserts via the native collection with the new message appended", async () => {
    const updateOne = vi.fn().mockResolvedValue({});
    const model = fakeModel({ collection: { updateOne } });

    await queueUserMessage("user-1", "hello", "msg-1", "messenger", model);

    expect(updateOne).toHaveBeenCalledOnce();
    const [filter, pipeline, options] = updateOne.mock.calls[0];
    expect(filter).toEqual({ userId: "user-1" });
    expect(options).toEqual({ upsert: true });
    expect(JSON.stringify(pipeline)).toContain('"id":"msg-1"');
  });

  it("defaults platform to messenger when not given", async () => {
    const updateOne = vi.fn().mockResolvedValue({});
    const model = fakeModel({ collection: { updateOne } });

    await queueUserMessage("user-1", "hello", "msg-1", undefined, model);

    const [, pipeline] = updateOne.mock.calls[0];
    expect(pipeline[0].$set.platform).toEqual({ $ifNull: ["$platform", "messenger"] });
  });

  it("sets platform via $ifNull (only applied on first insert) when whatsapp is passed", async () => {
    const updateOne = vi.fn().mockResolvedValue({});
    const model = fakeModel({ collection: { updateOne } });

    await queueUserMessage("user-2", "hello", "msg-2", "whatsapp", model);

    const [, pipeline] = updateOne.mock.calls[0];
    expect(pipeline[0].$set.platform).toEqual({ $ifNull: ["$platform", "whatsapp"] });
  });
});

describe("pauseUserReplies / resumeUserReplies", () => {
  it("pauseUserReplies upserts a pausedUntil in the future", async () => {
    const updateOne = vi.fn().mockResolvedValue({});
    const model = fakeModel({ updateOne });

    await pauseUserReplies("user-1", model);

    expect(updateOne).toHaveBeenCalledOnce();
    const [filter, update, options] = updateOne.mock.calls[0];
    expect(filter).toEqual({ userId: "user-1" });
    expect(update.$set.pausedUntil.getTime()).toBeGreaterThan(Date.now());
    expect(options).toEqual({ upsert: true });
  });

  it("resumeUserReplies unsets pausedUntil", async () => {
    const updateOne = vi.fn().mockResolvedValue({});
    const model = fakeModel({ updateOne });

    await resumeUserReplies("user-1", model);

    expect(updateOne).toHaveBeenCalledWith(
      { userId: "user-1" },
      expect.objectContaining({ $unset: { pausedUntil: "" } })
    );
  });
});

describe("claimNextDueReply", () => {
  it("returns null when there is no due candidate", async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    const model = fakeModel({ collection: { findOne } });

    const result = await claimNextDueReply(model);

    expect(result).toBeNull();
  });

  it("reschedules and returns null when the candidate is still admin-paused", async () => {
    const pausedUntil = new Date(Date.now() + 60_000);
    const findOne = vi.fn().mockResolvedValue({ _id: "job-1", pausedUntil });
    const updateOne = vi.fn().mockResolvedValue({});
    const findOneAndUpdate = vi.fn();
    const model = fakeModel({ collection: { findOne, updateOne, findOneAndUpdate } });

    const result = await claimNextDueReply(model);

    expect(result).toBeNull();
    expect(updateOne).toHaveBeenCalledWith(
      { _id: "job-1", status: "pending" },
      expect.objectContaining({ $set: expect.objectContaining({ replyAt: pausedUntil }) })
    );
    // Must not attempt to claim a still-paused conversation.
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("atomically claims and returns the job when unpaused and due", async () => {
    const claimedDoc = { _id: "job-1", userId: "user-1", messages: [], status: "processing" };
    const findOne = vi.fn().mockResolvedValue({ _id: "job-1", pausedUntil: null });
    const findOneAndUpdate = vi.fn().mockResolvedValue(claimedDoc);
    const model = fakeModel({ collection: { findOne, findOneAndUpdate } });

    const result = await claimNextDueReply(model);

    expect(result).toBe(claimedDoc);
    const [filter, update, options] = findOneAndUpdate.mock.calls[0];
    expect(filter._id).toBe("job-1");
    expect(filter.status).toBe("pending");
    expect(update.$set.status).toBe("processing");
    expect(options).toEqual({ returnDocument: "after" });
  });

  it("returns null when another worker wins the claim race (findOneAndUpdate finds nothing)", async () => {
    const findOne = vi.fn().mockResolvedValue({ _id: "job-1", pausedUntil: null });
    const findOneAndUpdate = vi.fn().mockResolvedValue(null);
    const model = fakeModel({ collection: { findOne, findOneAndUpdate } });

    const result = await claimNextDueReply(model);

    expect(result).toBeNull();
  });
});

describe("getPauseStatus", () => {
  it("reports not-paused when no pending-reply document exists", async () => {
    const findOne = vi.fn(() => chainable(null));
    const model = fakeModel({ findOne });

    const result = await getPauseStatus("user-1", model);

    expect(result).toEqual({ paused: false, pausedUntil: null });
  });

  it("reports paused when pausedUntil is in the future", async () => {
    const pausedUntil = new Date(Date.now() + 60_000);
    const findOne = vi.fn(() => chainable({ pausedUntil }));
    const model = fakeModel({ findOne });

    const result = await getPauseStatus("user-1", model);

    expect(result).toEqual({ paused: true, pausedUntil });
  });

  it("reports not-paused once pausedUntil has already elapsed", async () => {
    const pausedUntil = new Date(Date.now() - 60_000);
    const findOne = vi.fn(() => chainable({ pausedUntil }));
    const model = fakeModel({ findOne });

    const result = await getPauseStatus("user-1", model);

    expect(result.paused).toBe(false);
  });
});

describe("wasPausedAfterClaim", () => {
  const claimedAt = new Date("2026-01-01T00:00:00Z");

  it("returns false when the user was never paused", async () => {
    const findOne = vi.fn(() => chainable(null));
    const model = fakeModel({ findOne });

    expect(await wasPausedAfterClaim("user-1", claimedAt, model)).toBe(false);
  });

  it("returns false for a stale pause that predates the claim", async () => {
    const findOne = vi.fn(() => chainable({ pausedUntil: new Date(claimedAt.getTime() - 60_000) }));
    const model = fakeModel({ findOne });

    expect(await wasPausedAfterClaim("user-1", claimedAt, model)).toBe(false);
  });

  it("returns true when a human admin paused the conversation after this claim was taken", async () => {
    const findOne = vi.fn(() => chainable({ pausedUntil: new Date(claimedAt.getTime() + 60_000) }));
    const model = fakeModel({ findOne });

    expect(await wasPausedAfterClaim("user-1", claimedAt, model)).toBe(true);
  });
});

describe("releaseClaim / markClaimDelivered / completeClaim", () => {
  it("releaseClaim puts the job back to pending and clears claim fields", async () => {
    const updateOne = vi.fn().mockResolvedValue({});
    const model = fakeModel({ updateOne });

    await releaseClaim(fakeJob(), 5000, model);

    expect(updateOne).toHaveBeenCalledWith(
      { _id: "job-1", status: "processing", claimId: "claim-1" },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "pending", hasPendingMessages: true }),
        $unset: { claimId: "", claimedAt: "", leaseUntil: "", delivered: "" },
      })
    );
  });

  it("markClaimDelivered flags the claim as delivered before any resend can happen", async () => {
    const updateOne = vi.fn().mockResolvedValue({});
    const model = fakeModel({ updateOne });

    await markClaimDelivered(fakeJob(), model);

    expect(updateOne).toHaveBeenCalledWith(
      { _id: "job-1", status: "processing", claimId: "claim-1" },
      expect.objectContaining({ $set: expect.objectContaining({ delivered: true }) })
    );
  });

  it("completeClaim removes only the claimed messages via the native collection", async () => {
    const updateOne = vi.fn().mockResolvedValue({});
    const model = fakeModel({ collection: { updateOne } });

    await completeClaim(
      fakeJob({ messages: [{ id: "m1", text: "hi", receivedAt: new Date() }] }),
      model
    );

    expect(updateOne).toHaveBeenCalledOnce();
    const [filter] = updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: "job-1", status: "processing", claimId: "claim-1" });
  });
});

describe("reclaimExpiredLeases", () => {
  it("finalizes an already-delivered expired claim without resending (via completeClaim's native updateOne)", async () => {
    const job = {
      _id: "job-1",
      userId: "user-1",
      claimId: "claim-1",
      messages: [],
      delivered: true,
    };
    const find = vi.fn(() => chainable([job]));
    const collectionUpdateOne = vi.fn().mockResolvedValue({});
    const topLevelUpdateOne = vi.fn().mockResolvedValue({});
    const model = fakeModel({
      find,
      collection: { updateOne: collectionUpdateOne },
      updateOne: topLevelUpdateOne,
    });

    await reclaimExpiredLeases(model);

    // delivered=true -> completeClaim path -> native collection.updateOne
    expect(collectionUpdateOne).toHaveBeenCalledOnce();
    expect(topLevelUpdateOne).not.toHaveBeenCalled();
  });

  it("releases an expired claim with no recorded delivery for retry (via releaseClaim's top-level updateOne)", async () => {
    const job = {
      _id: "job-1",
      userId: "user-1",
      claimId: "claim-1",
      messages: [],
      delivered: false,
    };
    const find = vi.fn(() => chainable([job]));
    const collectionUpdateOne = vi.fn().mockResolvedValue({});
    const topLevelUpdateOne = vi.fn().mockResolvedValue({});
    const model = fakeModel({
      find,
      collection: { updateOne: collectionUpdateOne },
      updateOne: topLevelUpdateOne,
    });

    await reclaimExpiredLeases(model);

    // delivered=false -> releaseClaim path -> top-level updateOne, retryDelayMs=0
    expect(topLevelUpdateOne).toHaveBeenCalledOnce();
    const [, update] = topLevelUpdateOne.mock.calls[0];
    expect(update.$set.replyAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(collectionUpdateOne).not.toHaveBeenCalled();
  });

  it("does nothing when there are no expired leases", async () => {
    const find = vi.fn(() => chainable([]));
    const collectionUpdateOne = vi.fn();
    const topLevelUpdateOne = vi.fn();
    const model = fakeModel({
      find,
      collection: { updateOne: collectionUpdateOne },
      updateOne: topLevelUpdateOne,
    });

    await reclaimExpiredLeases(model);

    expect(collectionUpdateOne).not.toHaveBeenCalled();
    expect(topLevelUpdateOne).not.toHaveBeenCalled();
  });
});
