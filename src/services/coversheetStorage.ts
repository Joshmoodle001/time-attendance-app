import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export type CoversheetStorageEmployee = {
  repLabel?: unknown;
};

export type CoversheetStorageStore = {
  storeCode?: unknown;
  storeName?: unknown;
  employees?: CoversheetStorageEmployee[];
};

export type CoversheetStorageData = {
  fileName?: string;
  uploadedAt?: string;
  stores: CoversheetStorageStore[];
};

const COVERSHEET_STORAGE_KEY = "coversheet-data-v1";
const COVERSHEET_DB_NAME = "time-attendance-coversheet-db";
const COVERSHEET_DB_VERSION = 1;
const COVERSHEET_DB_STORE = "coversheet_data";
const COVERSHEET_DB_RECORD_ID = "latest";
const COVERSHEET_REMOTE_ROW_ID = "coversheet_data";

function isValidCoversheetStorageData(value: unknown): value is CoversheetStorageData {
  if (!value || typeof value !== "object") return false;
  const data = value as CoversheetStorageData;
  return Array.isArray(data.stores);
}

function normalizeCoversheetStorageData(value: unknown): CoversheetStorageData | null {
  return isValidCoversheetStorageData(value) ? value : null;
}

async function openIndexedDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return null;
  }

  return new Promise((resolve) => {
    const request = window.indexedDB.open(COVERSHEET_DB_NAME, COVERSHEET_DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(COVERSHEET_DB_STORE)) {
        database.createObjectStore(COVERSHEET_DB_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function readIndexedDbCoversheetData(): Promise<CoversheetStorageData | null> {
  const database = await openIndexedDb();
  if (!database) return null;

  return new Promise((resolve) => {
    if (!database.objectStoreNames.contains(COVERSHEET_DB_STORE)) {
      resolve(null);
      return;
    }

    const transaction = database.transaction(COVERSHEET_DB_STORE, "readonly");
    const store = transaction.objectStore(COVERSHEET_DB_STORE);
    const request = store.get(COVERSHEET_DB_RECORD_ID);

    request.onsuccess = () => {
      const record = request.result as { id: string; payload: CoversheetStorageData } | undefined;
      resolve(normalizeCoversheetStorageData(record?.payload));
    };
    request.onerror = () => resolve(null);
  });
}

async function writeIndexedDbCoversheetData(data: CoversheetStorageData): Promise<boolean> {
  const database = await openIndexedDb();
  if (!database) return false;

  return new Promise((resolve) => {
    const transaction = database.transaction(COVERSHEET_DB_STORE, "readwrite");
    transaction.objectStore(COVERSHEET_DB_STORE).put({
      id: COVERSHEET_DB_RECORD_ID,
      payload: data,
    });
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => resolve(false);
  });
}

function readLocalStorageCoversheetData(): CoversheetStorageData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(COVERSHEET_STORAGE_KEY);
    if (!raw) return null;
    return normalizeCoversheetStorageData(JSON.parse(raw));
  } catch {
    return null;
  }
}

function clearLocalStorageCoversheetData() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(COVERSHEET_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function saveLocalStorageCoversheetData(data: CoversheetStorageData) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(COVERSHEET_STORAGE_KEY, JSON.stringify(data));
}

async function loadRemoteCoversheetData(): Promise<CoversheetStorageData | null> {
  if (!isSupabaseConfigured) return null;

  try {
    const { data, error } = await supabase
      .from("shift_sync_settings")
      .select("payload")
      .eq("id", COVERSHEET_REMOTE_ROW_ID)
      .maybeSingle();

    if (error) {
      console.warn("Load remote coversheet warning:", error.message);
      return null;
    }

    return normalizeCoversheetStorageData(data?.payload);
  } catch (error) {
    console.warn("Load remote coversheet warning:", error);
    return null;
  }
}

async function saveRemoteCoversheetData(data: CoversheetStorageData): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  try {
    const { error } = await supabase.from("shift_sync_settings").upsert(
      {
        id: COVERSHEET_REMOTE_ROW_ID,
        auto_sync_enabled: false,
        last_universal_synced_at: null,
        last_universal_status: "coversheet_data",
        payload: data,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );

    if (error) {
      console.warn("Save remote coversheet warning:", error.message);
      return false;
    }

    return true;
  } catch (error) {
    console.warn("Save remote coversheet warning:", error);
    return false;
  }
}

export async function loadStoredCoversheetData(): Promise<CoversheetStorageData | null> {
  const remoteData = await loadRemoteCoversheetData();
  if (remoteData) {
    await writeIndexedDbCoversheetData(remoteData);
    clearLocalStorageCoversheetData();
    return remoteData;
  }

  const indexedData = await readIndexedDbCoversheetData();
  if (indexedData) {
    void saveRemoteCoversheetData(indexedData);
    return indexedData;
  }

  const localData = readLocalStorageCoversheetData();
  if (!localData) return null;

  await writeIndexedDbCoversheetData(localData);
  clearLocalStorageCoversheetData();
  void saveRemoteCoversheetData(localData);
  return localData;
}

export async function saveStoredCoversheetData(data: CoversheetStorageData) {
  const remoteSaved = await saveRemoteCoversheetData(data);
  const indexedSaved = await writeIndexedDbCoversheetData(data);

  if (indexedSaved) {
    clearLocalStorageCoversheetData();
  } else {
    saveLocalStorageCoversheetData(data);
  }

  if (!remoteSaved && !indexedSaved) {
    throw new Error("Coversheet data could not be stored remotely or locally.");
  }
}
