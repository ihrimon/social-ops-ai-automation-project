import { describe, expect, it, vi, beforeEach } from "vitest";

const generateStructuredContentMock = vi.fn();
const getLeadRequirementsMock = vi.fn();
const upsertLeadRequirementsMock = vi.fn();
const syncLeadToSheetMock = vi.fn();

vi.mock("../../src/config/env.js", () => ({
  aiConfig: { model: "gemini-3.6-flash" },
  appConfig: { logLevel: "silent", nodeEnv: "test" },
}));

vi.mock("../../src/ai/client.js", () => ({
  generateStructuredContent: generateStructuredContentMock,
}));

vi.mock("../../src/modules/messenger/lead.store.js", () => ({
  getLeadRequirements: getLeadRequirementsMock,
  upsertLeadRequirements: upsertLeadRequirementsMock,
}));

vi.mock("../../src/modules/messenger/lead-sheet-sync.service.js", () => ({
  syncLeadToSheet: syncLeadToSheetMock,
}));

const { extractAndSaveLeadRequirements } =
  await import("../../src/modules/messenger/lead-extraction.service.js");

describe("extractAndSaveLeadRequirements", () => {
  beforeEach(() => {
    generateStructuredContentMock.mockReset();
    getLeadRequirementsMock.mockReset();
    upsertLeadRequirementsMock.mockReset();
    syncLeadToSheetMock.mockReset();
  });

  it("skips extraction entirely once the lead is already marked as a sale", async () => {
    getLeadRequirementsMock.mockResolvedValue({ status: "sale", requirements: null });

    await extractAndSaveLeadRequirements("user-1", [{ role: "user", text: "hi" }]);

    expect(generateStructuredContentMock).not.toHaveBeenCalled();
    expect(upsertLeadRequirementsMock).not.toHaveBeenCalled();
    expect(syncLeadToSheetMock).not.toHaveBeenCalled();
  });

  it("extracts, saves, and syncs when something was actually found", async () => {
    getLeadRequirementsMock.mockResolvedValue({
      status: "lead",
      requirements: { contactName: "Rahim" },
    });
    generateStructuredContentMock.mockResolvedValue({ deadline: "2 weeks" });

    await extractAndSaveLeadRequirements("user-1", [{ role: "user", text: "deadline 2 weeks" }]);

    expect(generateStructuredContentMock).toHaveBeenCalledOnce();
    expect(upsertLeadRequirementsMock).toHaveBeenCalledWith("user-1", { deadline: "2 weeks" });
    expect(syncLeadToSheetMock).toHaveBeenCalledWith("user-1");
  });

  it("saves nothing and does not sync when extraction found nothing at all", async () => {
    getLeadRequirementsMock.mockResolvedValue({ status: "none", requirements: null });
    generateStructuredContentMock.mockResolvedValue({
      contactName: null,
      features: [],
    });

    await extractAndSaveLeadRequirements("user-1", [{ role: "user", text: "hi" }]);

    expect(upsertLeadRequirementsMock).not.toHaveBeenCalled();
    expect(syncLeadToSheetMock).not.toHaveBeenCalled();
  });

  it("swallows a Gemini failure instead of throwing", async () => {
    getLeadRequirementsMock.mockResolvedValue({ status: "none", requirements: null });
    generateStructuredContentMock.mockRejectedValue(new Error("gemini down"));

    await expect(
      extractAndSaveLeadRequirements("user-1", [{ role: "user", text: "hi" }])
    ).resolves.toBeUndefined();
    expect(upsertLeadRequirementsMock).not.toHaveBeenCalled();
    expect(syncLeadToSheetMock).not.toHaveBeenCalled();
  });
});
