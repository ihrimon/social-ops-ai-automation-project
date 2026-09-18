import { describe, expect, it, vi, beforeEach } from "vitest";

const axiosPostMock = vi.fn();

vi.mock("axios", () => ({
  default: { post: axiosPostMock },
}));

vi.mock("../../src/config/env.js", () => ({
  telegramConfig: { botToken: "test-bot-token", chatId: "12345" },
  appConfig: { logLevel: "silent", nodeEnv: "test" },
}));

const { isTelegramConfigured, sendTelegramAlert } =
  await import("../../src/integrations/telegram/client.js");

describe("isTelegramConfigured", () => {
  it("is true when both botToken and chatId are set", () => {
    expect(isTelegramConfigured()).toBe(true);
  });
});

describe("sendTelegramAlert", () => {
  beforeEach(() => {
    axiosPostMock.mockReset();
  });

  it("posts to the bot's sendMessage endpoint with chat_id and text", async () => {
    axiosPostMock.mockResolvedValue({ data: { ok: true } });

    await sendTelegramAlert("something urgent happened");

    expect(axiosPostMock).toHaveBeenCalledWith(
      "https://api.telegram.org/bottest-bot-token/sendMessage",
      { chat_id: "12345", text: "something urgent happened" }
    );
  });

  it("throws an ExternalServiceError (rather than swallowing) on failure", async () => {
    axiosPostMock.mockRejectedValue(new Error("network down"));

    await expect(sendTelegramAlert("hi")).rejects.toThrow(/network down/);
  });
});
