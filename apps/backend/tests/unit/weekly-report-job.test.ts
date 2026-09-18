import { describe, expect, it, vi, beforeEach } from "vitest";

const isTelegramConfiguredMock = vi.fn();
const sendTelegramAlertMock = vi.fn();
const listPostLogsMock = vi.fn();
const extractFacebookPostIdMock = vi.fn();
const getPostEngagementMock = vi.fn();
const getRecentLeadStatsMock = vi.fn();
const getWeeklyMessageStatsMock = vi.fn();

vi.mock("../../src/config/env.js", () => ({
  appConfig: { logLevel: "silent", nodeEnv: "test" },
}));

vi.mock("../../src/integrations/telegram/client.js", () => ({
  isTelegramConfigured: isTelegramConfiguredMock,
  sendTelegramAlert: sendTelegramAlertMock,
}));

vi.mock("../../src/modules/content/post-log.store.js", () => ({
  listPostLogs: listPostLogsMock,
}));

vi.mock("../../src/modules/content/engagement.service.js", () => ({
  extractFacebookPostId: extractFacebookPostIdMock,
  getPostEngagement: getPostEngagementMock,
}));

vi.mock("../../src/modules/messenger/lead.store.js", () => ({
  getRecentLeadStats: getRecentLeadStatsMock,
}));

vi.mock("../../src/modules/messenger/conversation.store.js", () => ({
  getWeeklyMessageStats: getWeeklyMessageStatsMock,
}));

const { runWeeklyReportJob } = await import("../../src/jobs/weekly-report-job.js");

describe("runWeeklyReportJob", () => {
  beforeEach(() => {
    isTelegramConfiguredMock.mockReset();
    sendTelegramAlertMock.mockReset();
    listPostLogsMock.mockReset();
    extractFacebookPostIdMock.mockReset();
    getPostEngagementMock.mockReset();
    getRecentLeadStatsMock.mockReset();
    getWeeklyMessageStatsMock.mockReset();
  });

  it("no-ops without querying anything when Telegram isn't configured", async () => {
    isTelegramConfiguredMock.mockReturnValue(false);

    await runWeeklyReportJob();

    expect(listPostLogsMock).not.toHaveBeenCalled();
    expect(sendTelegramAlertMock).not.toHaveBeenCalled();
  });

  it("aggregates posts/engagement/leads/messages into one report and sends it", async () => {
    isTelegramConfiguredMock.mockReturnValue(true);
    listPostLogsMock.mockResolvedValue([
      { createdAt: new Date(), facebookResponse: { id: "post-1" } },
      { createdAt: new Date(0), facebookResponse: { id: "post-old" } }, // outside the 7-day window
    ]);
    extractFacebookPostIdMock.mockImplementation((response: any) => response?.id ?? null);
    getPostEngagementMock.mockResolvedValue({ likes: 10, comments: 2, shares: 1 });
    getRecentLeadStatsMock.mockResolvedValue({ leads: 3, sales: 1 });
    getWeeklyMessageStatsMock.mockResolvedValue({ messenger: 5, whatsapp: 2 });

    await runWeeklyReportJob();

    expect(getPostEngagementMock).toHaveBeenCalledOnce(); // only the recent post
    expect(getPostEngagementMock).toHaveBeenCalledWith("post-1");
    expect(sendTelegramAlertMock).toHaveBeenCalledOnce();
    const report = sendTelegramAlertMock.mock.calls[0][0];
    expect(report).toContain("Posts published: 1");
    expect(report).toContain("10 likes, 2 comments, 1 shares");
    expect(report).toContain("messenger: 5");
    expect(report).toContain("whatsapp: 2");
    expect(report).toContain("New leads: 3");
    expect(report).toContain("New sales: 1");
  });

  it("swallows a failure from any data source instead of throwing", async () => {
    isTelegramConfiguredMock.mockReturnValue(true);
    listPostLogsMock.mockRejectedValue(new Error("db down"));

    await expect(runWeeklyReportJob()).resolves.toBeUndefined();
    expect(sendTelegramAlertMock).not.toHaveBeenCalled();
  });
});
