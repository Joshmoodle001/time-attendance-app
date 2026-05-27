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
const COVER_SHEET_REMOTE_ENDPOINT = "/api/coversheet";

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function isValidUpload(value: unknown): value is CoversheetUpload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as CoversheetUpload;
  return Boolean(candidate.fileName && candidate.uploadedAt && Array.isArray(candidate.stores));
}

function loadLocalUpload() {
  if (!canUseStorage()) return null;

  try {
    const raw = window.localStorage.getItem(COVER_SHEET_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isValidUpload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function saveLocalUpload(upload: CoversheetUpload) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(COVER_SHEET_STORAGE_KEY, JSON.stringify(upload));
}

export async function getSavedCoversheetUpload(): Promise<CoversheetUpload | null> {
  const localUpload = loadLocalUpload();

  try {
    const response = await fetch(COVER_SHEET_REMOTE_ENDPOINT, { method: "GET", cache: "no-store" });
    if (!response.ok) return localUpload;
    const payload = (await response.json()) as { upload?: CoversheetUpload | null };
    if (!isValidUpload(payload.upload)) return localUpload;
    saveLocalUpload(payload.upload);
    return payload.upload;
  } catch {
    return localUpload;
  }
}

export async function saveCoversheetUpload(upload: CoversheetUpload) {
  saveLocalUpload(upload);

  try {
    await fetch(COVER_SHEET_REMOTE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(upload),
    });
  } catch {
    // Local save is still kept as a fallback.
  }
}
