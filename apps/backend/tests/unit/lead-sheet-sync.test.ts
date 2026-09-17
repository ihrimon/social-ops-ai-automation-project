import { describe, expect, it, vi, beforeEach } from "vitest";

const isGoogleSheetsConfiguredMock = vi.fn();
const getLeadsWorksheetMock = vi.fn();
const getLeadStatusMock = vi.fn();

vi.mock("../../src/config/env.js", () => ({
  appConfig: { logLevel: "silent", nodeEnv: "test" },
}));

vi.mock("../../src/integrations/google-sheets/client.js", () => ({
  isGoogleSheetsConfigured: isGoogleSheetsConfiguredMock,
  getLeadsWorksheet: getLeadsWorksheetMock,
}));

vi.mock("../../src/modules/messenger/lead.store.js", () => ({
  getLeadStatus: getLeadStatusMock,
}));

const { syncLeadToSheet } = await import("../../src/modules/messenger/lead-sheet-sync.service.js");

function fakeRow(data: Record<string, string>) {
  return {
    get: (key: string) => data[key],
    set: vi.fn(),
    save: vi.fn().mockResolvedValue(undefined),
  };
}

describe("syncLeadToSheet", () => {
  beforeEach(() => {
    isGoogleSheetsConfiguredMock.mockReset();
    getLeadsWorksheetMock.mockReset();
    getLeadStatusMock.mockReset();
  });

  it("no-ops without touching the worksheet when Google Sheets isn't configured", async () => {
    isGoogleSheetsConfiguredMock.mockReturnValue(false);

    await syncLeadToSheet("user-1");

    expect(getLeadsWorksheetMock).not.toHaveBeenCalled();
    expect(getLeadStatusMock).not.toHaveBeenCalled();
  });

  it("updates an existing row in place when one is found for this userId", async () => {
    isGoogleSheetsConfiguredMock.mockReturnValue(true);
    getLeadStatusMock.mockResolvedValue({
      status: "lead",
      note: "wants ecommerce site",
      requirements: { contactName: "Rahim", features: ["booking", "payment"] },
    });
    const existingRow = fakeRow({ userId: "user-1" });
    const otherRow = fakeRow({ userId: "user-2" });
    const addRow = vi.fn();
    getLeadsWorksheetMock.mockResolvedValue({
      getRows: vi.fn().mockResolvedValue([otherRow, existingRow]),
      addRow,
    });

    await syncLeadToSheet("user-1");

    expect(existingRow.set).toHaveBeenCalledWith("status", "lead");
    expect(existingRow.set).toHaveBeenCalledWith("contactName", "Rahim");
    expect(existingRow.set).toHaveBeenCalledWith("features", "booking, payment");
    expect(existingRow.save).toHaveBeenCalledOnce();
    expect(addRow).not.toHaveBeenCalled();
  });

  it("appends a new row when no existing row matches this userId", async () => {
    isGoogleSheetsConfiguredMock.mockReturnValue(true);
    getLeadStatusMock.mockResolvedValue({ status: "none", requirements: null });
    const addRow = vi.fn().mockResolvedValue(undefined);
    getLeadsWorksheetMock.mockResolvedValue({
      getRows: vi.fn().mockResolvedValue([]),
      addRow,
    });

    await syncLeadToSheet("user-2");

    expect(addRow).toHaveBeenCalledOnce();
    expect(addRow.mock.calls[0][0]).toMatchObject({ userId: "user-2", status: "none" });
  });

  it("swallows a worksheet failure instead of throwing", async () => {
    isGoogleSheetsConfiguredMock.mockReturnValue(true);
    getLeadStatusMock.mockResolvedValue({ status: "none", requirements: null });
    getLeadsWorksheetMock.mockRejectedValue(new Error("google down"));

    await expect(syncLeadToSheet("user-1")).resolves.toBeUndefined();
  });
});
