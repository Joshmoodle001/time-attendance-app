import { buildShiftDownloadUrl, type ShiftSyncSection } from "@/services/shiftSync";
import {
  mergeShiftRosters,
  parseShiftWorkbook,
  upsertShiftRoster,
  type ShiftRoster,
} from "@/services/shifts";

function normalizeText(value: unknown) {
  return value === null || value === undefined ? "" : String(value).replace(/\s+/g, " ").trim();
}

async function downloadShiftWorkbook(sourceUrl: string) {
  const response = await fetch(`/api/download-shift?url=${encodeURIComponent(sourceUrl)}`);
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(errorBody || `Google download failed with status ${response.status}.`);
  }
  return response.arrayBuffer();
}

export type ShiftSyncRunResult = {
  successCount: number;
  failureCount: number;
  totalRows: number;
  importedSheetCount: number;
  nextRosters: ShiftRoster[];
  updatedSections: ShiftSyncSection[];
  message: string;
};

export async function runShiftSyncSections(
  sections: ShiftSyncSection[],
  existingRosters: ShiftRoster[],
  options?: {
    onProgress?: (message: string) => void;
    triggerLabel?: string;
  }
): Promise<ShiftSyncRunResult> {
  const onProgress = options?.onProgress;
  const triggerLabel = normalizeText(options?.triggerLabel) || "Shift sync";
  const currentMap = new Map(existingRosters.map((roster) => [roster.sheet_name, roster]));
  const mergedRostersMap = new Map<string, ShiftRoster>();
  const updatedSections: ShiftSyncSection[] = [];
  let successCount = 0;
  let failureCount = 0;
  let totalRows = 0;
  let importedSheetCount = 0;

  for (const section of sections) {
    const sourceUrl = normalizeText(section.url);
    if (!sourceUrl) {
      updatedSections.push({
        ...section,
        lastStatus: "Add a Google Sheet link before syncing.",
      });
      continue;
    }

    try {
      const downloadUrl = buildShiftDownloadUrl(sourceUrl);
      if (!downloadUrl) {
        throw new Error("Could not build a Google Sheets download URL.");
      }

      onProgress?.(`[${section.label}] Downloading sheet...`);
      const buffer = await downloadShiftWorkbook(sourceUrl);
      if (!buffer || buffer.byteLength === 0) {
        throw new Error("No data was downloaded from that Google Sheet.");
      }

      onProgress?.(`[${section.label}] Parsing workbook...`);
      const imported = parseShiftWorkbook(buffer, `${section.label}.xlsx`);
      if (imported.length === 0) {
        throw new Error("No valid shift sheets were found in that workbook.");
      }

      importedSheetCount += imported.length;
      const mergedForSection = imported.map((incoming) => {
        const existing =
          mergedRostersMap.get(incoming.sheet_name) || currentMap.get(incoming.sheet_name);
        const merged = mergeShiftRosters(existing, incoming);
        currentMap.set(merged.sheet_name, merged);
        mergedRostersMap.set(merged.sheet_name, merged);
        return merged;
      });

      const sectionRows = mergedForSection.reduce((sum, roster) => sum + roster.rows.length, 0);
      totalRows += sectionRows;
      successCount += 1;

      const syncedAt = new Date().toISOString();
      updatedSections.push({
        ...section,
        lastSyncedAt: syncedAt,
        lastStatus: `${triggerLabel} complete: ${mergedForSection.length} sheet(s), ${sectionRows} employee rows synced.`,
      });
    } catch (error) {
      failureCount += 1;
      const message = error instanceof Error ? error.message : "Unknown shift sync error.";
      updatedSections.push({
        ...section,
        lastStatus: `Sync failed: ${message}`,
      });
      onProgress?.(`[${section.label}] ${message}`);
    }
  }

  const changedSheetNames = new Set(mergedRostersMap.keys());
  const unchangedRosters = existingRosters.filter((roster) => !changedSheetNames.has(roster.sheet_name));
  const nextRosters = [...unchangedRosters, ...Array.from(mergedRostersMap.values())].sort((a, b) =>
    a.sheet_name.localeCompare(b.sheet_name)
  );

  if (mergedRostersMap.size > 0) {
    onProgress?.("Saving synced sheets...");
    await Promise.all(Array.from(mergedRostersMap.values()).map((roster) => upsertShiftRoster(roster)));
  }

  const message =
    failureCount > 0 && successCount > 0
      ? `${triggerLabel}: ${successCount} section(s) synced, ${failureCount} failed.`
      : failureCount > 0
        ? `${triggerLabel} failed for ${failureCount} section(s).`
        : importedSheetCount > 0
          ? `${triggerLabel} complete: ${importedSheetCount} sheet(s), ${totalRows} employee rows synced.`
          : `${triggerLabel} finished with no shift rows found.`;

  return {
    successCount,
    failureCount,
    totalRows,
    importedSheetCount,
    nextRosters,
    updatedSections,
    message,
  };
}
