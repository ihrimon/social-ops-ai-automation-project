import { describe, expect, it, vi } from "vitest";
import type { Model } from "mongoose";
import {
  getLeadRequirements,
  getLeadStats,
  getLeadStatus,
  getLeadStatusesForUsers,
  listLeads,
  setLeadStatus,
  upsertLeadRequirements,
} from "../../src/modules/messenger/lead.store.js";
import type { LeadDoc } from "../../src/modules/messenger/lead.model.js";

vi.mock("../../src/config/env.js", () => ({
  mongoConfig: {
    leadsCollection: "leads",
    conversationsCollection: "conversation_messages",
  },
}));

function chainable(resolvedValue: unknown) {
  const node: {
    sort: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
    lean: ReturnType<typeof vi.fn>;
  } = {
    sort: vi.fn(() => node),
    limit: vi.fn(() => node),
    select: vi.fn(() => node),
    lean: vi.fn().mockResolvedValue(resolvedValue),
  };
  return node;
}

function fakeModel(overrides: Record<string, unknown>) {
  return overrides as unknown as Model<LeadDoc>;
}

describe("setLeadStatus", () => {
  it("upserts the status, note, and a fresh markedAt", async () => {
    const updateOne = vi.fn().mockResolvedValue({});
    const model = fakeModel({ updateOne });

    await setLeadStatus("user-1", "lead", "interested in ecommerce site", model);

    expect(updateOne).toHaveBeenCalledOnce();
    const [filter, update, options] = updateOne.mock.calls[0];
    expect(filter).toEqual({ userId: "user-1" });
    expect(update.$set.status).toBe("lead");
    expect(update.$set.note).toBe("interested in ecommerce site");
    expect(update.$set.markedAt).toBeInstanceOf(Date);
    expect(options).toEqual({ upsert: true });
  });
});

describe("getLeadStatus", () => {
  it("returns null when the user has never been marked", async () => {
    const findOne = vi.fn(() => chainable(null));
    const model = fakeModel({ findOne });

    expect(await getLeadStatus("user-1", model)).toBeNull();
  });

  it("returns the stored status/note/markedAt", async () => {
    const markedAt = new Date("2026-01-01T00:00:00Z");
    const findOne = vi.fn(() => chainable({ status: "sale", note: "closed", markedAt }));
    const model = fakeModel({ findOne });

    expect(await getLeadStatus("user-1", model)).toEqual({
      status: "sale",
      note: "closed",
      markedAt,
      requirements: null,
    });
  });

  it("passes through a stored requirements subdocument", async () => {
    const findOne = vi.fn(() =>
      chainable({ status: "lead", requirements: { contactName: "Rahim" } })
    );
    const model = fakeModel({ findOne });

    expect((await getLeadStatus("user-1", model))?.requirements).toEqual({
      contactName: "Rahim",
    });
  });
});

describe("getLeadStatusesForUsers", () => {
  it("returns an empty map without querying for an empty user list", async () => {
    const find = vi.fn();
    const model = fakeModel({ find });

    const result = await getLeadStatusesForUsers([], model);

    expect(result.size).toBe(0);
    expect(find).not.toHaveBeenCalled();
  });

  it("builds a userId -> status map from the batch query", async () => {
    const find = vi.fn(() =>
      chainable([
        { userId: "user-1", status: "lead" },
        { userId: "user-2", status: "sale" },
      ])
    );
    const model = fakeModel({ find });

    const result = await getLeadStatusesForUsers(["user-1", "user-2", "user-3"], model);

    expect(result.get("user-1")).toBe("lead");
    expect(result.get("user-2")).toBe("sale");
    expect(result.has("user-3")).toBe(false);
  });
});

describe("listLeads", () => {
  it("defaults to excluding status none", async () => {
    const find = vi.fn(() => chainable([]));
    const model = fakeModel({ find });

    await listLeads({}, model);

    expect(find).toHaveBeenCalledWith({ status: { $ne: "none" } });
  });

  it("filters by an explicit status when given", async () => {
    const find = vi.fn(() => chainable([]));
    const model = fakeModel({ find });

    await listLeads({ status: "sale" }, model);

    expect(find).toHaveBeenCalledWith({ status: "sale" });
  });
});

describe("getLeadStats", () => {
  it("combines distinct conversation count with lead/sale counts", async () => {
    const leadModel = fakeModel({
      countDocuments: vi
        .fn()
        .mockResolvedValueOnce(5) // status: "lead"
        .mockResolvedValueOnce(2), // status: "sale"
    });
    const conversationModel = {
      distinct: vi.fn().mockResolvedValue(["u1", "u2", "u3", "u4", "u5", "u6", "u7"]),
    };

    const stats = await getLeadStats(leadModel, conversationModel as any);

    expect(stats).toEqual({ totalConversations: 7, totalLeads: 5, totalSales: 2 });
  });
});

describe("getLeadRequirements", () => {
  it("defaults to status none and null requirements when never marked", async () => {
    const findOne = vi.fn(() => chainable(null));
    const model = fakeModel({ findOne });

    expect(await getLeadRequirements("user-1", model)).toEqual({
      status: "none",
      requirements: null,
    });
  });

  it("returns the stored status and requirements", async () => {
    const findOne = vi.fn(() =>
      chainable({ status: "lead", requirements: { contactName: "Karim" } })
    );
    const model = fakeModel({ findOne });

    expect(await getLeadRequirements("user-1", model)).toEqual({
      status: "lead",
      requirements: { contactName: "Karim" },
    });
  });
});

describe("upsertLeadRequirements", () => {
  it("only $sets non-empty scalar fields, trimmed, plus requirementsUpdatedAt", async () => {
    const updateOne = vi.fn().mockResolvedValue({});
    const model = fakeModel({ updateOne });

    await upsertLeadRequirements(
      "user-1",
      {
        contactName: "  Rahim  ",
        contactPhone: null,
        businessType: "",
        deadline: "2 weeks",
      },
      model
    );

    expect(updateOne).toHaveBeenCalledOnce();
    const [filter, update, options] = updateOne.mock.calls[0];
    expect(filter).toEqual({ userId: "user-1" });
    expect(update.$set["requirements.contactName"]).toBe("Rahim");
    expect(update.$set["requirements.deadline"]).toBe("2 weeks");
    expect(update.$set["requirements.contactPhone"]).toBeUndefined();
    expect(update.$set["requirements.businessType"]).toBeUndefined();
    expect(update.$set.requirementsUpdatedAt).toBeInstanceOf(Date);
    expect(options).toEqual({ upsert: true, setDefaultsOnInsert: true });
  });

  it("unions non-empty features via $addToSet instead of replacing", async () => {
    const updateOne = vi.fn().mockResolvedValue({});
    const model = fakeModel({ updateOne });

    await upsertLeadRequirements("user-1", { features: ["booking", "  ", "payment"] }, model);

    const [, update] = updateOne.mock.calls[0];
    expect(update.$addToSet).toEqual({
      "requirements.features": { $each: ["booking", "payment"] },
    });
  });

  it("omits $addToSet entirely when no features are given", async () => {
    const updateOne = vi.fn().mockResolvedValue({});
    const model = fakeModel({ updateOne });

    await upsertLeadRequirements("user-1", { contactName: "Rahim" }, model);

    expect(updateOne.mock.calls[0][1].$addToSet).toBeUndefined();
  });
});
