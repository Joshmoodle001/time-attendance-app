import { supabase, isSupabaseConfigured } from "@/lib/supabase";

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
const COVER_SHEET_BUCKET = "attendance-files";
const COVER_SHEET_STORAGE_PREFIX = "coversheet";
const COVER_SHEET_SHARED_ROW_ID = "coversheet-upload";

type CoversheetSharedRecord = {
  payload?: {
    path?: string;
    fileName?: string;
    uploadedAt?: string;
  } | null;
};

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

function extractSharedPointer(value: unknown) {
  if (!value || typeof value !== "object") return null;

  const record = value as CoversheetSharedRecord;
  const path = String(record.payload?.path || "").trim();
  const fileName = String(record.payload?.fileName || "").trim();
  const uploadedAt = String(record.payload?.uploadedAt || "").trim();
  if (!path || !fileName || !uploadedAt) return null;
  return { path, fileName, uploadedAt };
}

async function loadStorageUpload(path: string) {
  try {
    const { data, error } = await supabase.storage.from(COVER_SHEET_BUCKET).download(path);
    if (error || !data) return null;

    const parsed = JSON.parse(await data.text()) as unknown;
    if (!isValidUpload(parsed)) return null;

    saveLocalUpload(parsed);
    return parsed;
  } catch {
    return null;
  }
}

async function getSharedCoversheetUpload() {
  if (!isSupabaseConfigured) return null;

  try {
    const { data, error } = await supabase
      .from("shift_sync_settings")
      .select("payload")
      .eq("id", COVER_SHEET_SHARED_ROW_ID)
      .maybeSingle();

    if (error) return null;
    const pointer = extractSharedPointer(data);
    if (!pointer) return null;
    return await loadStorageUpload(pointer.path);
  } catch {
    return null;
  }
}

async function saveSharedCoversheetUpload(upload: CoversheetUpload) {
  if (!isSupabaseConfigured) return false;

  try {
    const fileStamp = new Date(upload.uploadedAt || new Date().toISOString()).getTime();
    const safeFileName = upload.fileName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "coversheet";
    const path = `${COVER_SHEET_STORAGE_PREFIX}/${fileStamp}-${Math.random().toString(36).slice(2, 8)}-${safeFileName}.json`;

    const { error: storageError } = await supabase.storage.from(COVER_SHEET_BUCKET).upload(
      path,
      new Blob([JSON.stringify(upload)], { type: "application/json" }),
      {
        cacheControl: "3600",
        upsert: false,
        contentType: "application/json",
      }
    );

    if (storageError) return false;

    const { error } = await supabase.from("shift_sync_settings").upsert(
      {
        id: COVER_SHEET_SHARED_ROW_ID,
        auto_sync_enabled: false,
        last_universal_synced_at: null,
        last_universal_status: "Shared coversheet upload",
        payload: {
          path,
          fileName: upload.fileName,
          uploadedAt: upload.uploadedAt,
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );

    return !error;
  } catch {
    return false;
  }
}

export async function getSharedCoversheetPointer(): Promise<{ path: string; fileName: string; uploadedAt: string } | null> {
  if (!isSupabaseConfigured) return null;

  try {
    const { data, error } = await supabase
      .from("shift_sync_settings")
      .select("payload")
      .eq("id", COVER_SHEET_SHARED_ROW_ID)
      .maybeSingle();

    if (error) return null;
    return extractSharedPointer(data);
  } catch {
    return null;
  }
}

export async function getSavedCoversheetUpload(): Promise<CoversheetUpload | null> {
  const localUpload = loadLocalUpload();
  const sharedUpload = await getSharedCoversheetUpload();
  if (sharedUpload) return sharedUpload;
  return localUpload;
}

export async function saveCoversheetUpload(upload: CoversheetUpload) {
  saveLocalUpload(upload);
  await saveSharedCoversheetUpload(upload);
}
