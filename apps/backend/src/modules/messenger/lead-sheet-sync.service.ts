import { logger } from "../../infra/logger.js";
import { errorMessage } from "../../infra/errors.js";
import {
  isGoogleSheetsConfigured,
  getLeadsWorksheet,
} from "../../integrations/google-sheets/client.js";
import { getLeadStatus } from "./lead.store.js";

/**
 * Best-effort: mirrors one lead's full record (admin status/note + AI-extracted
 * requirements) to a single row in the configured Google Sheet, so the business
 * owner gets a free, familiar "CRM" view without opening the admin dashboard.
 * No-ops silently if Google Sheets isn't configured, and never throws into its
 * caller — a sync failure must never affect the Messenger reply or admin action
 * that triggered it.
 */
export async function syncLeadToSheet(userId: string): Promise<void> {
  if (!isGoogleSheetsConfigured()) {
    return;
  }

  try {
    const lead = await getLeadStatus(userId);
    const requirements = lead?.requirements;

    const rowData = {
      userId,
      status: lead?.status ?? "none",
      note: lead?.note ?? "",
      contactName: requirements?.contactName ?? "",
      contactPhone: requirements?.contactPhone ?? "",
      businessType: requirements?.businessType ?? "",
      hasExistingWebsite: requirements?.hasExistingWebsite ?? "",
      pageCount: requirements?.pageCount ?? "",
      features: (requirements?.features ?? []).join(", "),
      deadline: requirements?.deadline ?? "",
      referenceWebsite: requirements?.referenceWebsite ?? "",
      budgetHint: requirements?.budgetHint ?? "",
      updatedAt: new Date().toISOString(),
    };

    const sheet = await getLeadsWorksheet();
    const rows = await sheet.getRows();
    const existingRow = rows.find((row) => row.get("userId") === userId);

    if (existingRow) {
      for (const [key, value] of Object.entries(rowData)) {
        existingRow.set(key, value);
      }
      await existingRow.save();
    } else {
      await sheet.addRow(rowData);
    }
  } catch (error) {
    logger.warn(`Google Sheets sync failed for ${userId}:`, { error: errorMessage(error) });
  }
}
