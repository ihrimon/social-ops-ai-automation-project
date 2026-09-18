import { describe, expect, it, vi, beforeEach } from "vitest";

const generateStructuredContentMock = vi.fn();
const isTelegramConfiguredMock = vi.fn();
const sendTelegramAlertMock = vi.fn();

vi.mock("../../src/config/env.js", () => ({
  aiConfig: { model: "gemini-3.6-flash" },
  appConfig: { logLevel: "silent", nodeEnv: "test" },
}));

vi.mock("../../src/ai/client.js", () => ({
  generateStructuredContent: generateStructuredContentMock,
}));

vi.mock("../../src/integrations/telegram/client.js", () => ({
  isTelegramConfigured: isTelegramConfiguredMock,
  sendTelegramAlert: sendTelegramAlertMock,
}));

const { checkAndAlertUrgency } =
  await import("../../src/modules/messenger/urgency-alert.service.js");

describe("checkAndAlertUrgency", () => {
  beforeEach(() => {
    generateStructuredContentMock.mockReset();
    isTelegramConfiguredMock.mockReset();
    sendTelegramAlertMock.mockReset();
  });

  it("no-ops without classifying when Telegram isn't configured", async () => {
    isTelegramConfiguredMock.mockReturnValue(false);

    await checkAndAlertUrgency("user-1", "messenger", "hi");

    expect(generateStructuredContentMock).not.toHaveBeenCalled();
    expect(sendTelegramAlertMock).not.toHaveBeenCalled();
  });

  it("alerts on negative sentiment even when urgency is low", async () => {
    isTelegramConfiguredMock.mockReturnValue(true);
    generateStructuredContentMock.mockResolvedValue({
      sentiment: "negative",
      urgency: "low",
      reason: "Visitor seems annoyed.",
    });

    await checkAndAlertUrgency("user-1", "messenger", "this is so annoying");

    expect(sendTelegramAlertMock).toHaveBeenCalledOnce();
    expect(sendTelegramAlertMock.mock.calls[0][0]).toContain("negative/low");
    expect(sendTelegramAlertMock.mock.calls[0][0]).toContain("Visitor seems annoyed.");
  });

  it("alerts on high urgency even when sentiment is neutral", async () => {
    isTelegramConfiguredMock.mockReturnValue(true);
    generateStructuredContentMock.mockResolvedValue({
      sentiment: "neutral",
      urgency: "high",
      reason: "Site is down.",
    });

    await checkAndAlertUrgency("user-2", "whatsapp", "my site has been down for 3 days");

    expect(sendTelegramAlertMock).toHaveBeenCalledOnce();
    expect(sendTelegramAlertMock.mock.calls[0][0]).toContain("whatsapp user user-2");
  });

  it("does not alert for neutral sentiment and low urgency", async () => {
    isTelegramConfiguredMock.mockReturnValue(true);
    generateStructuredContentMock.mockResolvedValue({
      sentiment: "neutral",
      urgency: "low",
      reason: "Ordinary question.",
    });

    await checkAndAlertUrgency("user-3", "messenger", "what are your prices?");

    expect(sendTelegramAlertMock).not.toHaveBeenCalled();
  });

  it("swallows a Gemini failure instead of throwing", async () => {
    isTelegramConfiguredMock.mockReturnValue(true);
    generateStructuredContentMock.mockRejectedValue(new Error("gemini down"));

    await expect(checkAndAlertUrgency("user-1", "messenger", "hi")).resolves.toBeUndefined();
    expect(sendTelegramAlertMock).not.toHaveBeenCalled();
  });

  it("swallows a Telegram send failure instead of throwing", async () => {
    isTelegramConfiguredMock.mockReturnValue(true);
    generateStructuredContentMock.mockResolvedValue({
      sentiment: "negative",
      urgency: "high",
      reason: "Angry customer.",
    });
    sendTelegramAlertMock.mockRejectedValue(new Error("telegram down"));

    await expect(checkAndAlertUrgency("user-1", "messenger", "hi")).resolves.toBeUndefined();
  });
});
