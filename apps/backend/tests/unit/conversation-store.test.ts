import { describe, expect, it, vi } from "vitest";
import type { Model } from "mongoose";
import { getWeeklyMessageStats } from "../../src/modules/messenger/conversation.store.js";
import type { ConversationMessageDoc } from "../../src/modules/messenger/conversation.model.js";

vi.mock("../../src/config/env.js", () => ({
  mongoConfig: { uri: "mongodb://localhost/test" },
  appConfig: { logLevel: "silent", nodeEnv: "test" },
  aiConfig: { embeddingModel: "gemini-embedding-001" },
}));

vi.mock("../../src/modules/knowledge/embedding.service.js", () => ({
  createEmbedding: vi.fn(),
}));

function fakeModel(overrides: Record<string, unknown>) {
  return overrides as unknown as Model<ConversationMessageDoc>;
}

describe("getWeeklyMessageStats", () => {
  it("matches user messages since the given date, grouped by platform", async () => {
    const aggregate = vi.fn().mockResolvedValue([
      { _id: "messenger", count: 5 },
      { _id: "whatsapp", count: 2 },
    ]);
    const model = fakeModel({ aggregate });
    const since = new Date("2026-09-01T00:00:00Z");

    const stats = await getWeeklyMessageStats(since, model);

    expect(stats).toEqual({ messenger: 5, whatsapp: 2 });
    const [pipeline] = aggregate.mock.calls[0];
    expect(pipeline[0]).toEqual({ $match: { role: "user", createdAt: { $gte: since } } });
    expect(pipeline[1]).toEqual({
      $group: { _id: { $ifNull: ["$platform", "unknown"] }, count: { $sum: 1 } },
    });
  });

  it("returns an empty object when there are no matching messages", async () => {
    const aggregate = vi.fn().mockResolvedValue([]);
    const model = fakeModel({ aggregate });

    const stats = await getWeeklyMessageStats(new Date(), model);

    expect(stats).toEqual({});
  });
});
