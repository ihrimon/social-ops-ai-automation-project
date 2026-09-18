import { describe, expect, it, vi, beforeEach } from "vitest";

const graphPostMock = vi.fn();

vi.mock("../../src/config/env.js", () => ({
  appConfig: { logLevel: "silent", nodeEnv: "test" },
  instagramConfig: { igUserId: "17841400000000000" },
}));

vi.mock("../../src/integrations/facebook/graph-client.js", () => ({
  graphPost: graphPostMock,
}));

const { isInstagramConfigured, sendInstagramReply } =
  await import("../../src/integrations/instagram/send.js");

describe("isInstagramConfigured", () => {
  it("is true when igUserId is set", () => {
    expect(isInstagramConfigured()).toBe(true);
  });
});

describe("sendInstagramReply", () => {
  beforeEach(() => {
    graphPostMock.mockReset();
  });

  it("posts to {igUserId}/messages with no access-token override and normalizes the response", async () => {
    graphPostMock.mockResolvedValue({ data: { message_id: "mid.ABC123" } });

    const result = await sendInstagramReply("179615...", "hello there");

    expect(graphPostMock).toHaveBeenCalledWith("17841400000000000/messages", {
      recipient: { id: "179615..." },
      message: { text: "hello there" },
    });
    expect(result).toEqual({ message_id: "mid.ABC123" });
  });

  it("returns null (rather than throwing) when the Graph API call fails", async () => {
    graphPostMock.mockRejectedValue(new Error("Instagram Graph API request failed"));

    const result = await sendInstagramReply("179615...", "hello there");

    expect(result).toBeNull();
  });

  it("returns null if the response has no message id", async () => {
    graphPostMock.mockResolvedValue({ data: {} });

    const result = await sendInstagramReply("179615...", "hello there");

    expect(result).toBeNull();
  });
});
