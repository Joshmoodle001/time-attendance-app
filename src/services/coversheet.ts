export type CoversheetEmployee = {
  id: string;
  employeeCode: string;
  employeeName: string;
  phone: string;
  email: string;
  repLabel: string;
  statuses: string[];
};

export type CoversheetStore = {
  id: string;
  storeCode: string;
  storeName: string;
  employees: CoversheetEmployee[];
};

export type CoversheetUpload = {
  fileName: string;
  uploadedAt: string;
  stores: CoversheetStore[];
};

const COVER_SHEET_STORAGE_KEY = "coversheet-upload-v1";

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export async function getSavedCoversheetUpload(): Promise<CoversheetUpload | null> {
  if (!canUseStorage()) return null;

  try {
    const raw = window.localStorage.getItem(COVER_SHEET_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CoversheetUpload;
    if (!parsed || !parsed.fileName || !parsed.uploadedAt || !Array.isArray(parsed.stores)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function saveCoversheetUpload(upload: CoversheetUpload) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(COVER_SHEET_STORAGE_KEY, JSON.stringify(upload));
}
