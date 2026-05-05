import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { Employee } from "@/services/database";
import type { StoreInfo } from "@/services/storeAssignments";
import { getEmployeeScopeInfo, getTeamScopeInfo, normalizeScopeCompare, normalizeScopeText } from "@/services/teamScope";

export type DeviceRegionTruthEntry = {
  deviceLabel: string;
  region: string;
  storeCode: string;
  storeName: string;
  teamKey: string;
  teamLabel: string;
  brand: string;
};

export type DeviceRegionTruthData = {
  fileName: string;
  uploadedAt: string;
  entries: DeviceRegionTruthEntry[];
};

type DeviceRegionResolvable = {
  team?: unknown;
  store?: unknown;
  store_code?: unknown;
  storeCode?: unknown;
  storeName?: unknown;
  name?: unknown;
};

type DeviceRegionResolvedInfo = {
  region: string;
  brand: string;
  storeCode: string;
  storeName: string;
  teamKey: string;
  teamLabel: string;
};

const STORAGE_KEY = "device-region-truth-v1";
const DB_NAME = "time-attendance-device-region-db";
const DB_VERSION = 1;
const DB_STORE = "device_region_truth";
const DB_RECORD_ID = "latest";
const REMOTE_ROW_ID = "device_region_truth";

function stripLeadingCode(value: string) {
  return value.replace(/^[A-Za-z0-9]+\s*-\s*/, "").trim();
}

function stripTrailingBracketCode(value: string) {
  return value.replace(/\s*\(([^)]+)\)\s*$/, "").trim();
}

// Extract ONLY numeric store codes (e.g., "07468"). Brand names like "SHOPRITE" are NOT codes.
function collectNumericCodes(...values: unknown[]) {
  const codes = new Set<string>();

  values.forEach((value) => {
    const text = normalizeScopeText(value);
    if (!text) return;

    // Leading numeric code: "07468 - ..."
    const leading = text.match(/^(\d+)\s*-\s*/);
    if (leading?.[1]) codes.add(leading[1]);

    // Trailing numeric code in parentheses: "... (07468)"
    const trailing = text.match(/\((\d+)\)\s*$/);
    if (trailing?.[1]) codes.add(trailing[1]);

    // Entire value is a numeric code
    if (/^\d+$/.test(text)) codes.add(text);
  });

  return codes;
}

// Extract all code candidates (numeric + alphabetic) for fallback matching
function collectCodeCandidates(...values: unknown[]) {
  const codes = new Set<string>();

  values.forEach((value) => {
    const text = normalizeScopeText(value);
    if (!text) return;

    const leading = text.match(/^([A-Za-z0-9]+)\s*-\s*/);
    if (leading?.[1]) codes.add(leading[1].toLowerCase());

    const trailing = text.match(/\(([^)]+)\)\s*$/);
    if (trailing?.[1]) codes.add(trailing[1].trim().toLowerCase());

    if (/^[A-Za-z0-9]+$/.test(text)) {
      codes.add(text.toLowerCase());
    }
  });

  return codes;
}

// Normalize a value for name matching: strip codes, lowercase, collapse separators
function normalizeNameForMatch(value: unknown) {
  const text = normalizeScopeText(value);
  if (!text) return "";
  // Strip trailing bracket code first
  const stripped = stripTrailingBracketCode(text);
  // Strip leading code (numeric or alphabetic)
  const cleaned = stripLeadingCode(stripped);
  // Lowercase and normalize separators to spaces
  return normalizeScopeCompare(cleaned).replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
}

function toTitleCase(value: string) {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function inferRetailBrand(value: unknown) {
  const text = normalizeScopeCompare(value);
  if (!text) return "";
  // Check more specific patterns first
  if (text.includes("checkers hyper")) return "Checkers";
  if (text.includes("shoprite hyper")) return "Shoprite";
  if (text.includes("checkers")) return "Checkers";
  if (text.includes("shoprite")) return "Shoprite";

  const cleaned = stripTrailingBracketCode(stripLeadingCode(normalizeScopeText(value)));
  const parts = cleaned.split(/\s*-\s*/).map((part) => part.trim()).filter(Boolean);
  return parts[0] ? toTitleCase(parts[0]) : "";
}

function normalizeDeviceRegionTruthEntry(
  entry:
    | Partial<DeviceRegionTruthEntry>
    | { deviceLabel?: unknown; region?: unknown; storeCode?: unknown; storeName?: unknown; brand?: unknown }
    | null
    | undefined
): DeviceRegionTruthEntry | null {
  if (!entry) return null;
  const deviceLabel = normalizeScopeText(entry.deviceLabel);
  const region = normalizeScopeText(entry.region).toUpperCase();
  if (!deviceLabel || !region) return null;

  const numericCandidates = collectNumericCodes(deviceLabel);
  const allCandidates = collectCodeCandidates(deviceLabel);
  // Prefer numeric store codes over alphabetic ones (brand names)
  const storeCode = normalizeScopeText(entry.storeCode)
    || Array.from(numericCandidates)[0]
    || Array.from(allCandidates)[0]
    || "";
  const storeName = normalizeScopeText(entry.storeName) || stripTrailingBracketCode(stripLeadingCode(deviceLabel)) || deviceLabel;
  const scope = getTeamScopeInfo(deviceLabel, storeName, storeCode);
  const brand = normalizeScopeText(entry.brand) || inferRetailBrand(storeName || scope.label);

  return {
    deviceLabel,
    region,
    storeCode,
    storeName,
    teamKey: scope.key,
    teamLabel: scope.label,
    brand,
  };
}

function normalizeDeviceRegionTruthData(value: unknown): DeviceRegionTruthData | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<DeviceRegionTruthData>;
  if (!Array.isArray(raw.entries)) return null;
  return {
    fileName: typeof raw.fileName === "string" ? raw.fileName : "",
    uploadedAt: typeof raw.uploadedAt === "string" ? raw.uploadedAt : "",
    entries: raw.entries
      .map((entry) => normalizeDeviceRegionTruthEntry(entry as Partial<DeviceRegionTruthEntry>))
      .filter((entry): entry is DeviceRegionTruthEntry => Boolean(entry)),
  };
}

async function openIndexedDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return null;
  }

  return new Promise((resolve) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DB_STORE)) {
        database.createObjectStore(DB_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function readIndexedDbData(): Promise<DeviceRegionTruthData | null> {
  const database = await openIndexedDb();
  if (!database) return null;

  return new Promise((resolve) => {
    const transaction = database.transaction(DB_STORE, "readonly");
    const request = transaction.objectStore(DB_STORE).get(DB_RECORD_ID);

    request.onsuccess = () => {
      const record = request.result as { id: string; payload: DeviceRegionTruthData } | undefined;
      database.close();
      resolve(normalizeDeviceRegionTruthData(record?.payload));
    };
    request.onerror = () => {
      database.close();
      resolve(null);
    };
  });
}

async function writeIndexedDbData(data: DeviceRegionTruthData): Promise<boolean> {
  const database = await openIndexedDb();
  if (!database) return false;

  return new Promise((resolve) => {
    const transaction = database.transaction(DB_STORE, "readwrite");
    transaction.objectStore(DB_STORE).put({ id: DB_RECORD_ID, payload: data });
    transaction.oncomplete = () => {
      database.close();
      resolve(true);
    };
    transaction.onerror = () => {
      database.close();
      resolve(false);
    };
  });
}

function readLocalData() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeDeviceRegionTruthData(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeLocalData(data: DeviceRegionTruthData) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function clearLocalData() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

async function loadRemoteData() {
  if (!isSupabaseConfigured) {
    console.warn("Device region truth: Supabase not configured, skipping remote load");
    return null;
  }
  try {
    const { data, error } = await supabase
      .from("shift_sync_settings")
      .select("payload")
      .eq("id", REMOTE_ROW_ID)
      .maybeSingle();

    if (error) {
      console.error("Device region truth: Failed to load from Supabase", { error });
      return null;
    }
    return normalizeDeviceRegionTruthData(data?.payload);
  } catch (err) {
    console.error("Device region truth: Exception loading from Supabase", err);
    return null;
  }
}

async function saveRemoteData(data: DeviceRegionTruthData) {
  if (!isSupabaseConfigured) {
    console.warn("Device region truth: Supabase not configured, skipping remote save");
    return false;
  }
  try {
    const { error } = await supabase.from("shift_sync_settings").upsert(
      {
        id: REMOTE_ROW_ID,
        auto_sync_enabled: false,
        last_universal_synced_at: null,
        last_universal_status: "device_region_truth",
        payload: data,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );

    if (error) {
      console.error("Device region truth: Failed to save to Supabase", { error });
      return false;
    }
    return true;
  } catch (err) {
    console.error("Device region truth: Exception saving to Supabase", err);
    return false;
  }
}

export async function loadStoredDeviceRegionTruth(): Promise<DeviceRegionTruthData | null> {
  const remote = await loadRemoteData();
  if (remote) {
    await writeIndexedDbData(remote);
    clearLocalData();
    return remote;
  }

  const indexed = await readIndexedDbData();
  if (indexed) {
    void saveRemoteData(indexed);
    return indexed;
  }

  const local = readLocalData();
  if (!local) return null;

  await writeIndexedDbData(local);
  clearLocalData();
  void saveRemoteData(local);
  return local;
}

export async function saveStoredDeviceRegionTruth(data: DeviceRegionTruthData) {
  const normalized = normalizeDeviceRegionTruthData(data);
  if (!normalized) {
    throw new Error("Invalid device region data.");
  }

  const remoteSaved = await saveRemoteData(normalized);
  const indexedSaved = await writeIndexedDbData(normalized);

  if (indexedSaved) {
    clearLocalData();
  } else {
    writeLocalData(normalized);
  }

  if (!remoteSaved && !indexedSaved) {
    throw new Error("Device region truth could not be stored remotely or locally.");
  }
}

function resolveFromEntries(entries: DeviceRegionTruthEntry[], input: DeviceRegionResolvable): DeviceRegionResolvedInfo | null {
  if (!entries.length) return null;

  const scope = getTeamScopeInfo(
    input.team ?? input.storeName ?? input.store,
    input.storeName ?? input.store,
    input.storeCode ?? input.store_code
  );

  // Numeric codes only (real store codes like "07468")
  const numericCodes = collectNumericCodes(
    input.team,
    input.store,
    input.storeName,
    input.store_code,
    input.storeCode,
    input.name
  );

  // Normalized names for matching
  const candidateNames = [
    normalizeNameForMatch(input.team),
    normalizeNameForMatch(input.store),
    normalizeNameForMatch(input.storeName),
    normalizeNameForMatch(input.name),
    normalizeNameForMatch(scope.label),
    normalizeNameForMatch(scope.name),
  ].filter(Boolean);

  // Pass 1: Match by numeric store code (highest priority - avoids brand name collisions)
  let matchedEntry: DeviceRegionTruthEntry | null = null;

  if (numericCodes.size > 0) {
    matchedEntry = entries.find((entry) => {
      const entryNumericCodes = collectNumericCodes(entry.storeCode, entry.deviceLabel, entry.storeName);
      for (const code of numericCodes) {
        if (entryNumericCodes.has(code)) return true;
      }
      return false;
    }) || null;
  }

  // Pass 2: Match by name containment (flexible - handles partial matches)
  if (!matchedEntry && candidateNames.length > 0) {
    matchedEntry = entries.find((entry) => {
      const entryDeviceName = normalizeNameForMatch(entry.deviceLabel);
      const entryStoreName = normalizeNameForMatch(entry.storeName);
      const entryTeamName = normalizeNameForMatch(entry.teamLabel);

      for (const name of candidateNames) {
        // Check containment in both directions
        if (entryDeviceName.includes(name) || name.includes(entryDeviceName)) return true;
        if (entryStoreName.includes(name) || name.includes(entryStoreName)) return true;
        if (entryTeamName.includes(name) || name.includes(entryTeamName)) return true;
      }
      return false;
    }) || null;
  }

  // Pass 3 removed — brand-name-only matches caused false assignments.
  // If a store/device is not in the region truth document by numeric code or name,
  // it should remain unassigned rather than getting a wrong region from a brand collision.
  // Example: "PNP CORP - WATERFALL MALL (NC17)" was matching "Far North West" because
  // "PNP" was extracted as a code and matched any entry containing "PNP".

  if (!matchedEntry) return null;

  return {
    region: matchedEntry.region,
    brand: matchedEntry.brand || inferRetailBrand(matchedEntry.storeName || matchedEntry.teamLabel),
    storeCode: matchedEntry.storeCode,
    storeName: matchedEntry.storeName,
    teamKey: matchedEntry.teamKey,
    teamLabel: matchedEntry.teamLabel,
  };
}

export function resolveDeviceRegionForInput(data: DeviceRegionTruthData | null | undefined, input: DeviceRegionResolvable) {
  return resolveFromEntries(data?.entries || [], input);
}

export function applyDeviceRegionsToEmployees(employees: Employee[], data: DeviceRegionTruthData | null | undefined) {
  if (!data?.entries?.length) return employees;

  return employees.map((employee) => {
    const resolved = resolveFromEntries(data.entries, employee);
    // If matched in truth data → assign the correct region
    // If NOT matched → clear the region (don't keep stale values from old uploads)
    return {
      ...employee,
      region: resolved?.region || "",
    };
  });
}

export function applyDeviceRegionsToStores(stores: StoreInfo[], data: DeviceRegionTruthData | null | undefined) {
  if (!data?.entries?.length) return stores;

  return stores.map((store) => {
    const resolved = resolveFromEntries(data.entries, {
      team: store.storeKey,
      store: store.storeName,
      storeName: store.storeName,
      storeCode: store.storeCode,
    });

    // If matched in truth data → assign the correct region
    // If NOT matched → clear the region (don't keep stale values)
    return {
      ...store,
      region: resolved?.region || "",
    };
  });
}

export function applyDeviceRegionsToDeviceRecords<T extends { storeCode?: string; storeName?: string; name?: string; region?: string }>(
  records: T[],
  data: DeviceRegionTruthData | null | undefined
) {
  if (!data?.entries?.length) return records;

  return records.map((record) => {
    const resolved = resolveFromEntries(data.entries, {
      storeCode: record.storeCode,
      storeName: record.storeName,
      name: record.name,
    });

    // If matched in truth data → assign the correct region
    // If NOT matched → clear the region (don't keep stale values)
    return {
      ...record,
      region: resolved?.region || "",
    };
  });
}

export function getRegionBrandGroupInfo(data: DeviceRegionTruthData | null | undefined, input: DeviceRegionResolvable) {
  const resolved = resolveDeviceRegionForInput(data, input);
  const region = normalizeScopeText(resolved?.region);
  const brand = normalizeScopeText(resolved?.brand || inferRetailBrand(input.team ?? input.storeName ?? input.store));
  if (!region || !brand) return null;
  const label = `${toTitleCase(region)} ${brand}`;
  return {
    key: normalizeScopeCompare(label),
    label,
    region,
    brand,
  };
}

export function buildDeviceRegionTruthEntriesFromRows(rows: Array<{ deviceLabel: unknown; region: unknown }>) {
  const entries = new Map<string, DeviceRegionTruthEntry>();

  rows.forEach((row) => {
    const entry = normalizeDeviceRegionTruthEntry({
      deviceLabel: row.deviceLabel,
      region: row.region,
    });
    if (!entry) return;

    // Use numeric store code + normalized device label as key to avoid brand name collisions
    const numericCode = Array.from(collectNumericCodes(entry.deviceLabel))[0] || entry.storeCode;
    const normalizedName = normalizeNameForMatch(entry.deviceLabel);
    const mapKey = `${numericCode}__${normalizedName}`;

    if (!entries.has(mapKey)) {
      entries.set(mapKey, entry);
    }
  });

  return Array.from(entries.values()).sort((a, b) => {
    return a.region.localeCompare(b.region) || a.storeName.localeCompare(b.storeName) || a.storeCode.localeCompare(b.storeCode);
  });
}
