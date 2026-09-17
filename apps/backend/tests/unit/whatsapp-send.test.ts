import { describe, expect, it, vi, beforeEach } from "vitest";

const graphPostMock = vi.fn();

vi.mock("../../src/config/env.js", () => ({
  appConfig: { logLevel: "silent", nodeEnv: "test" },
  whatsappConfig: { accessToken: "test-token", phoneNumberId: "123456" },
}));

vi.mock("../../src/integrations/facebook/graph-client.js", () => ({
  graphPost: graphPostMock,
}));

const { isWhatsAppConfigured, sendWhatsAppReply } =
  await import("../../src/integrations/whatsapp/send.js");

describe("isWhatsAppConfigured", () => {
  it("is true when both accessToken and phoneNumberId are set", () => {
    expect(isWhatsAppConfigured()).toBe(true);
  });
});

describe("sendWhatsAppReply", () => {
  beforeEach(() => {
    graphPostMock.mockReset();
  });

  it("posts to {phoneNumberId}/messages with the access-token override and normalizes the response", async () => {
    graphPostMock.mockResolvedValue({ data: { messages: [{ id: "wamid.ABC123" }] } });

    const result = await sendWhatsAppReply("8801xxxxxxxxx", "hello there");

    expect(graphPostMock).toHaveBeenCalledWith(
      "123456/messages",
      {
        messaging_product: "whatsapp",
        to: "8801xxxxxxxxx",
        type: "text",
        text: { body: "hello there" },
      },
      {},
      "test-token"
    );
    expect(result).toEqual({ message_id: "wamid.ABC123" });
  });

  it("returns null (rather than throwing) when the Graph API call fails", async () => {
    graphPostMock.mockRejectedValue(new Error("WhatsApp Graph API request failed"));

    const result = await sendWhatsAppReply("8801xxxxxxxxx", "hello there");

    expect(result).toBeNull();
  });

  it("returns null if the response has no message id", async () => {
    graphPostMock.mockResolvedValue({ data: {} });

    const result = await sendWhatsAppReply("8801xxxxxxxxx", "hello there");

    expect(result).toBeNull();
  });
});
