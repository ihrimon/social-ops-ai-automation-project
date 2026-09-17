import { JWT } from "google-auth-library";
import { GoogleSpreadsheet, type GoogleSpreadsheetWorksheet } from "google-spreadsheet";
import { googleSheetsConfig } from "../../config/env.js";
import { withRetry } from "../../infra/retry.js";
import { ExternalServiceError, errorMessage } from "../../infra/errors.js";

/**
 * Column order for the synced "Leads" sheet — the admin-set status/note plus every
 * AI-extracted requirement field. Shared by the client (header row) and the sync
 * service (row shape) so they can't drift apart.
 */
export const LEAD_SHEET_HEADER = [
  "userId",
  "status",
  "note",
  "contactName",
  "contactPhone",
  "businessType",
  "hasExistingWebsite",
  "pageCount",
  "features",
  "deadline",
  "referenceWebsite",
  "budgetHint",
  "updatedAt",
] as const;

export function isGoogleSheetsConfigured(): boolean {
  return Boolean(
    googleSheetsConfig.spreadsheetId &&
    googleSheetsConfig.serviceAccountEmail &&
    googleSheetsConfig.privateKey
  );
}

let cachedWorksheet: GoogleSpreadsheetWorksheet | null = null;

/**
 * Lazily authenticates and resolves the target worksheet, creating it (with the
 * fixed header row) the first time. Cached at module scope — same reasoning as
 * `reply.service.ts`'s `cachedKnowledgeBase` — so repeat syncs don't re-auth or
 * re-load spreadsheet metadata on every call.
 */
export async function getLeadsWorksheet(): Promise<GoogleSpreadsheetWorksheet> {
  if (cachedWorksheet) {
    return cachedWorksheet;
  }

  try {
    const auth = new JWT({
      email: googleSheetsConfig.serviceAccountEmail,
      key: googleSheetsConfig.privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const doc = new GoogleSpreadsheet(googleSheetsConfig.spreadsheetId!, auth);
    await withRetry(() => doc.loadInfo());

    let sheet = doc.sheetsByTitle[googleSheetsConfig.sheetName];
    if (!sheet) {
      sheet = await withRetry(() =>
        doc.addSheet({ title: googleSheetsConfig.sheetName, headerValues: [...LEAD_SHEET_HEADER] })
      );
    } else {
      try {
        // Populates the worksheet's header cache — required before getRows()/addRow()
        // will work. Throws if the sheet exists but has no header row yet (e.g. a
        // blank sheet the owner created by hand), in which case we set one.
        await withRetry(() => sheet!.loadHeaderRow());
      } catch {
        await withRetry(() => sheet!.setHeaderRow([...LEAD_SHEET_HEADER]));
      }
    }

    cachedWorksheet = sheet;
    return sheet;
  } catch (error) {
    throw new ExternalServiceError("google-sheets", errorMessage(error), error);
  }
}
