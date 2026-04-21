import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { normalizeEmployeeCode, parseRegionStore, type Employee, type EmployeeInput } from "@/services/database";

const CLOCK_CACHE_KEY = 'clock-events-cache'
const CLOCK_CACHE_DURATION = 30 * 60 * 1000
let clockCache: { data: BiometricClockEvent[] | null; timestamp: number } = { data: null, timestamp: 0 }

function getCachedClockEvents(): BiometricClockEvent[] | null {
  if (clockCache.data && Date.now() - clockCache.timestamp < CLOCK_CACHE_DURATION) {
    return clockCache.data
  }
  
  try {
    const stored = localStorage.getItem(CLOCK_CACHE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (parsed.timestamp && Date.now() - parsed.timestamp < CLOCK_CACHE_DURATION) {
        clockCache = parsed
        return parsed.data
      }
    }
  } catch {}
  return null
}

function setCachedClockEvents(data: BiometricClockEvent[]) {
  clockCache = { data, timestamp: Date.now() }
  try {
    localStorage.setItem(CLOCK_CACHE_KEY, JSON.stringify(clockCache))
  } catch {}
}

export type BiometricClockEventInput = {
  employee_code: string;
  employee_number: string;
  first_name: string;
  last_name: string;
  alias: string;
  id_number: string;
  device_name: string;
  clockiq_device_name: string;
  direction: string;
  method: string;
  company: string;
  branch: string;
  person_type: string;
  business_unit: string;
  department: string;
  team: string;
  job_title: string;
  cost_center: string;
  custom_1: string;
  custom_2: string;
  access_granted: boolean | null;
  access_verified: boolean | null;
  region: string;
  store: string;
  store_code: string;
  clocked_at: string;
  clock_date: string;
  clock_time: string;
  source_file_name: string;
};

export type BiometricClockEvent = BiometricClockEventInput & {
  id: string;
  event_key: string;
  created_at: string;
};

export type ClockEmployeeSummary = {
  employee_code: string;
  employee_name: string;
  alias: string;
  id_number: string;
  store: string;
  store_code: string;
  last_clocked_at: string;
  total_events: number;
  verified_events: number;
  devices: string[];
  methods: string[];
};

export type ProcessedClockDay = {
  key: string;
  employee_code: string;
  employee_name: string;
  id_number: string;
  store: string;
  clock_date: string;
  clock_count: number;
  first_clock: string;
  last_clock: string;
  status: "No In/Out" | "In/Out";
  verified_count: number;
  granted_count: number;
  devices: string[];
  methods: string[];
  source_files: string[];
};

export type GetClockEventsFilters = {
  search?: string;
  store?: string;
  employeeCodes?: string[];
  startDate?: string;
  endDate?: string;
};

export type ClockPageFilters = GetClockEventsFilters & {
  offset?: number;
  limit?: number;
};

export type ClockPageResult<T> = {
  items: T[];
  total: number;
};

export type ClockOverview = {
  totalEvents: number;
  totalProcessedDays: number;
  employeesWithClocks: number;
  verifiedEvents: number;
  stores: string[];
  summaries: ClockEmployeeSummary[];
};

export type ClockImportComparison = {
   incomingCount: number;
   existingCount: number;
   newCount: number;
   duplicateIncomingCount: number;
   incomingEmployees: number;
   matchingEmployees: number;
 };

export type ParsedClockWorkbookRow = BiometricClockEventInput & {
   raw_row_number: number;
   raw_employee_code: string;
   raw_employee_number: string;
   raw_id_number: string;
};

export type ClockImportAllocationRow = {
   row_number: number;
   source_file_name: string;
   employee_code: string;
   id_number: string;
   employee_name: string;
   clocked_at: string;
   clock_date: string;
   clock_time: string;
   device_name: string;
   method: string;
   direction: string;
   matched_by: "employee_code" | "id_number" | "alias" | "name" | "";
   employee_profile_status: string;
   status: "allocated" | "unallocated";
   reason: string;
};

export type ClockWorkbookImportReport = {
   totalRows: number;
   allocatedCount: number;
   unallocatedCount: number;
   allocatedRows: ClockImportAllocationRow[];
   unallocatedRows: ClockImportAllocationRow[];
};

export type ClockWorkbookParseResult = {
   events: BiometricClockEvent[];
   report: ClockWorkbookImportReport;
 };

export type ClockUpsertProgress = {
  phase: "local" | "remote";
  completed: number;
  total: number;
  percent: number;
};

const CLOCK_STORAGE_KEY = "biometric-clock-events-cache-v1";
const CLOCK_INDEXED_DB_NAME = "time-attendance-clock-db";
const CLOCK_INDEXED_DB_VERSION = 1;
const CLOCK_INDEXED_DB_STORE = "biometric_clock_events";
const CLOCK_WRITE_CHUNK_SIZE = 1000;
const CLOCK_REMOTE_TIMEOUT_MS = 4000;

export const CLOCK_DATA_SETUP_SQL = `
CREATE TABLE IF NOT EXISTS biometric_clock_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key TEXT NOT NULL UNIQUE,
  employee_code TEXT NOT NULL,
  employee_number TEXT DEFAULT '',
  first_name TEXT DEFAULT '',
  last_name TEXT DEFAULT '',
  alias TEXT DEFAULT '',
  id_number TEXT DEFAULT '',
  device_name TEXT DEFAULT '',
  clockiq_device_name TEXT DEFAULT '',
  direction TEXT DEFAULT '',
  method TEXT DEFAULT '',
  company TEXT DEFAULT '',
  branch TEXT DEFAULT '',
  person_type TEXT DEFAULT '',
  business_unit TEXT DEFAULT '',
  department TEXT DEFAULT '',
  team TEXT DEFAULT '',
  job_title TEXT DEFAULT '',
  cost_center TEXT DEFAULT '',
  custom_1 TEXT DEFAULT '',
  custom_2 TEXT DEFAULT '',
  access_granted BOOLEAN,
  access_verified BOOLEAN,
  region TEXT DEFAULT '',
  store TEXT DEFAULT '',
  store_code TEXT DEFAULT '',
  clocked_at TIMESTAMPTZ NOT NULL,
  clock_date DATE NOT NULL,
  clock_time TEXT DEFAULT '',
  source_file_name TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_biometric_clock_events_employee_code ON biometric_clock_events(employee_code);
CREATE INDEX IF NOT EXISTS idx_biometric_clock_events_clock_date ON biometric_clock_events(clock_date DESC);
CREATE INDEX IF NOT EXISTS idx_biometric_clock_events_clocked_at ON biometric_clock_events(clocked_at DESC);
CREATE INDEX IF NOT EXISTS idx_biometric_clock_events_id_number ON biometric_clock_events(id_number);
CREATE INDEX IF NOT EXISTS idx_biometric_clock_events_store ON biometric_clock_events(store);

DROP POLICY IF EXISTS "Allow public read biometric clock events" ON biometric_clock_events;
DROP POLICY IF EXISTS "Allow public insert biometric clock events" ON biometric_clock_events;
DROP POLICY IF EXISTS "Allow public update biometric clock events" ON biometric_clock_events;

CREATE POLICY "Allow public read biometric clock events" ON biometric_clock_events FOR SELECT USING (true);
CREATE POLICY "Allow public insert biometric clock events" ON biometric_clock_events FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update biometric clock events" ON biometric_clock_events FOR UPDATE USING (true);
`;

const CLOCK_TABLE_SETUP_HINT =
  "Remote clock table is not set up yet. Run setup-database.ps1 or the SQL in supabase-clock-setup.sql to create biometric_clock_events. Clock data is still being stored locally in this browser.";

let clockRemoteSetupAvailable: boolean | null = null;
let clockRemoteSetupCheck: Promise<boolean> | null = null;

function randomId() {
  return globalThis.crypto?.randomUUID?.() ?? `clock_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

function chunkArray<T>(items: T[], size = CLOCK_WRITE_CHUNK_SIZE) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function waitForTick() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

async function checkRemoteClockTableAvailability() {
  if (clockRemoteSetupAvailable !== null) {
    return clockRemoteSetupAvailable;
  }

  if (clockRemoteSetupCheck) {
    return clockRemoteSetupCheck;
  }

  clockRemoteSetupCheck = (async () => {
    try {
      const { error } = await withClockTimeout(supabase.from("biometric_clock_events").select("id").limit(1));
      clockRemoteSetupAvailable = !error;
      return clockRemoteSetupAvailable;
    } catch {
      clockRemoteSetupAvailable = false;
      return false;
    } finally {
      clockRemoteSetupCheck = null;
    }
  })();

  return clockRemoteSetupCheck;
}

function normalizeText(value: unknown) {
   return value === null || value === undefined ? "" : String(value).replace(/\s+/g, " ").trim();
 }

function normalizeMatchToken(value: unknown) {
   return normalizeText(value).replace(/\s+/g, "").toUpperCase();
}

function isUsableMatchToken(value: unknown) {
   const normalized = normalizeMatchToken(value);
   return !!normalized && ![".", "-", "NA", "N/A", "NONE", "NULL"].includes(normalized);
}

function parseExcelDate(value: unknown): string {
  if (!value) return "";
  const strValue = String(value).trim();
  // Keep as-is - store raw Excel numeric date as text
  return strValue;
}

function normalizeHeaderKey(value: unknown) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizeBool(value: unknown) {
  if (typeof value === "boolean") return value;
  const clean = normalizeText(value).toLowerCase();
  if (["true", "yes", "1"].includes(clean)) return true;
  if (["false", "no", "0"].includes(clean)) return false;
  return null;
}

function withClockTimeout<T>(promise: PromiseLike<T>, timeoutMs = CLOCK_REMOTE_TIMEOUT_MS) {
  let timer: number | undefined;

  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>((_, reject) => {
      timer = window.setTimeout(() => {
        reject(new Error(`Clock request timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
    }
  });
}

function formatClockDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatClockTime(date: Date) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function parseExcelSerialDate(value: number) {
  const parsed = XLSX.SSF.parse_date_code(value);
  if (!parsed) return null;
  return new Date(parsed.y, parsed.m - 1, parsed.d, parsed.H || 0, parsed.M || 0, parsed.S || 0);
}

function coerceDateValue(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate(), value.getHours(), value.getMinutes(), value.getSeconds());
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return parseExcelSerialDate(value);
  }

  const text = normalizeText(value);
  if (!text) return null;

  const normalized = text.replace(/\./g, "/").replace(/-/g, " ").replace(/\s+/g, " ").trim();
  const directParse = new Date(text);
  if (!Number.isNaN(directParse.getTime())) {
    return directParse;
  }

  const fallbackParse = new Date(normalized);
  if (!Number.isNaN(fallbackParse.getTime())) {
    return fallbackParse;
  }

  const dayMonthYear = normalized.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
  if (dayMonthYear) {
    const manualParse = new Date(`${dayMonthYear[1]} ${dayMonthYear[2]} ${dayMonthYear[3]}`);
    return Number.isNaN(manualParse.getTime()) ? null : manualParse;
  }

  return null;
}

function coerceTimeValue(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return {
      hours: value.getHours(),
      minutes: value.getMinutes(),
      seconds: value.getSeconds(),
    };
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = parseExcelSerialDate(value);
    if (!parsed) return null;
    return {
      hours: parsed.getHours(),
      minutes: parsed.getMinutes(),
      seconds: parsed.getSeconds(),
    };
  }

  const text = normalizeText(value);
  if (!text) return null;

  const timeMatch = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (timeMatch) {
    return {
      hours: Number(timeMatch[1]),
      minutes: Number(timeMatch[2]),
      seconds: Number(timeMatch[3] || 0),
    };
  }

  const parsed = new Date(`1970-01-01T${text}`);
  if (!Number.isNaN(parsed.getTime())) {
    return {
      hours: parsed.getHours(),
      minutes: parsed.getMinutes(),
      seconds: parsed.getSeconds(),
    };
  }

  return null;
}

function getClockTimeValue(event: BiometricClockEvent) {
  if (event.clock_time) return event.clock_time;
  return new Date(event.clocked_at).toLocaleTimeString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function combineDateTime(dateValue: unknown, timeValue: unknown) {
  const datePart = coerceDateValue(dateValue) || coerceDateValue(timeValue);
  const timePart = coerceTimeValue(timeValue) || coerceTimeValue(dateValue);

  if (!datePart) {
    return {
      clockedAt: "",
      clockDate: "",
      clockTime: "",
    };
  }

  const combined = new Date(
    datePart.getFullYear(),
    datePart.getMonth(),
    datePart.getDate(),
    timePart?.hours ?? datePart.getHours(),
    timePart?.minutes ?? datePart.getMinutes(),
    timePart?.seconds ?? datePart.getSeconds()
  );

  return {
    clockedAt: combined.toISOString(),
    clockDate: formatClockDateKey(combined),
    clockTime: formatClockTime(combined),
  };
}

function buildEventKey(input: BiometricClockEventInput) {
  return [
    normalizeEmployeeCode(input.employee_code).toLowerCase(),
    normalizeText(input.clocked_at).toLowerCase(),
    normalizeText(input.device_name).toLowerCase(),
    normalizeText(input.method).toLowerCase(),
    normalizeText(input.direction).toLowerCase(),
  ].join("__");
}

function normalizeClockEvent(input: BiometricClockEventInput | BiometricClockEvent): BiometricClockEvent {
  const eventKey = "event_key" in input && input.event_key ? input.event_key : buildEventKey(input);
  return {
    id: "id" in input && input.id ? input.id : randomId(),
    event_key: eventKey,
    employee_code: normalizeEmployeeCode(input.employee_code),
    employee_number: normalizeText(input.employee_number),
    first_name: normalizeText(input.first_name),
    last_name: normalizeText(input.last_name),
    alias: normalizeText(input.alias),
    id_number: normalizeText(input.id_number),
    device_name: normalizeText(input.device_name),
    clockiq_device_name: normalizeText(input.clockiq_device_name),
    direction: normalizeText(input.direction),
    method: normalizeText(input.method),
    company: normalizeText(input.company),
    branch: normalizeText(input.branch),
    person_type: normalizeText(input.person_type),
    business_unit: normalizeText(input.business_unit),
    department: normalizeText(input.department),
    team: normalizeText(input.team),
    job_title: normalizeText(input.job_title),
    cost_center: normalizeText(input.cost_center),
    custom_1: normalizeText(input.custom_1),
    custom_2: normalizeText(input.custom_2),
    access_granted: input.access_granted ?? null,
    access_verified: input.access_verified ?? null,
    region: normalizeText(input.region),
    store: normalizeText(input.store),
    store_code: normalizeText(input.store_code),
    clocked_at: parseExcelDate(input.clocked_at),
    clock_date: parseExcelDate(input.clock_date),
    clock_time: normalizeText(input.clock_time),
    source_file_name: normalizeText(input.source_file_name),
    created_at: "created_at" in input && input.created_at ? input.created_at : new Date().toISOString(),
  };
}

function mergeClockEvents(...collections: BiometricClockEvent[][]) {
  const map = new Map<string, BiometricClockEvent>();
  collections
    .flat()
    .forEach((event) => {
      const normalized = normalizeClockEvent(event);
      map.set(normalized.event_key, normalized);
    });

  return Array.from(map.values()).sort((a, b) => b.clocked_at.localeCompare(a.clocked_at));
}

function dedupeClockEvents(events: BiometricClockEvent[]) {
  const normalized = events.map(normalizeClockEvent);
  const deduped = mergeClockEvents(normalized);
  return {
    items: deduped,
    duplicatesRemoved: Math.max(0, normalized.length - deduped.length),
  };
}

export function compareClockEventsAgainstExisting(
  incomingEvents: BiometricClockEvent[],
  existingEvents: BiometricClockEvent[]
): ClockImportComparison {
  const { items: uniqueIncoming, duplicatesRemoved } = dedupeClockEvents(incomingEvents);
  const existingKeys = new Set(existingEvents.map((event) => normalizeClockEvent(event).event_key));
  const existingEmployeeCodes = new Set(existingEvents.map((event) => normalizeEmployeeCode(event.employee_code)).filter(Boolean));

  const existingCount = uniqueIncoming.filter((event) => existingKeys.has(event.event_key)).length;
  const incomingEmployeeCodes = new Set(uniqueIncoming.map((event) => normalizeEmployeeCode(event.employee_code)).filter(Boolean));
  const matchingEmployees = Array.from(incomingEmployeeCodes).filter((code) => existingEmployeeCodes.has(code)).length;

  return {
    incomingCount: uniqueIncoming.length,
    existingCount,
    newCount: Math.max(0, uniqueIncoming.length - existingCount),
    duplicateIncomingCount: duplicatesRemoved,
    incomingEmployees: incomingEmployeeCodes.size,
    matchingEmployees,
  };
}

export async function compareClockEventsOptimized(
  incomingEvents: BiometricClockEvent[]
): Promise<ClockImportComparison> {
  const { items: uniqueIncoming, duplicatesRemoved } = dedupeClockEvents(incomingEvents);
  const incomingKeys = new Set(uniqueIncoming.map((event) => normalizeClockEvent(event).event_key));
  const existingKeys = await getExistingEventKeys();
  
  let existingCount = 0;
  incomingKeys.forEach((key) => {
    if (existingKeys.has(key)) existingCount++;
  });

  const incomingEmployeeCodes = new Set(
    uniqueIncoming
      .map((event) => normalizeEmployeeCode(event.employee_code))
      .filter(Boolean)
  );
  
  const existingEmployeeCodes = await getExistingEmployeeCodes();
  const matchingEmployees = Array.from(incomingEmployeeCodes).filter((code) => existingEmployeeCodes.has(code)).length;

  return {
    incomingCount: uniqueIncoming.length,
    existingCount,
    newCount: Math.max(0, uniqueIncoming.length - existingCount),
    duplicateIncomingCount: duplicatesRemoved,
    incomingEmployees: incomingEmployeeCodes.size,
    matchingEmployees,
  };
}

function loadLegacyLocalClockEvents(): BiometricClockEvent[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(CLOCK_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as BiometricClockEvent[];
    return Array.isArray(parsed) ? parsed.map(normalizeClockEvent) : [];
  } catch (error) {
    console.error("Load legacy local clock events error:", error);
    return [];
  }
}

function saveLegacyLocalClockEvents(events: BiometricClockEvent[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CLOCK_STORAGE_KEY, JSON.stringify(events.map(normalizeClockEvent)));
  } catch (error) {
    console.error("Save legacy local clock events error:", error);
  }
}

function clearLegacyLocalClockEvents() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CLOCK_STORAGE_KEY);
  } catch (error) {
    console.error("Clear legacy local clock events error:", error);
  }
}

function openClockIndexedDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const request = window.indexedDB.open(CLOCK_INDEXED_DB_NAME, CLOCK_INDEXED_DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(CLOCK_INDEXED_DB_STORE)) {
        const store = database.createObjectStore(CLOCK_INDEXED_DB_STORE, { keyPath: "event_key" });
        store.createIndex("employee_code", "employee_code", { unique: false });
        store.createIndex("clock_date", "clock_date", { unique: false });
        store.createIndex("clocked_at", "clocked_at", { unique: false });
        store.createIndex("store", "store", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      console.error("Open clock IndexedDB error:", request.error);
      resolve(null);
    };
  });
}

async function readIndexedDbClockEvents(): Promise<BiometricClockEvent[]> {
  const database = await openClockIndexedDb();
  if (!database) return [];

  return new Promise((resolve) => {
    const transaction = database.transaction(CLOCK_INDEXED_DB_STORE, "readonly");
    const store = transaction.objectStore(CLOCK_INDEXED_DB_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      resolve(Array.isArray(request.result) ? request.result.map((event) => normalizeClockEvent(event as BiometricClockEvent)) : []);
    };
    request.onerror = () => {
      console.error("Read IndexedDB clock events error:", request.error);
      resolve([]);
    };
  });
}

async function getExistingEventKeys(): Promise<Set<string>> {
  const database = await openClockIndexedDb();
  if (!database) return new Set();

  return new Promise((resolve) => {
    const transaction = database.transaction(CLOCK_INDEXED_DB_STORE, "readonly");
    const store = transaction.objectStore(CLOCK_INDEXED_DB_STORE);
    const request = store.getAllKeys();

    request.onsuccess = () => {
      const keys = new Set<string>();
      if (Array.isArray(request.result)) {
        request.result.forEach((key) => {
          if (typeof key === "string") keys.add(key);
        });
      }
      resolve(keys);
    };
    request.onerror = () => {
      console.error("Get existing event keys error:", request.error);
      resolve(new Set());
    };
  });
}

async function getExistingEmployeeCodes(): Promise<Set<string>> {
  const database = await openClockIndexedDb();
  if (!database) return new Set();

  return new Promise((resolve) => {
    const transaction = database.transaction(CLOCK_INDEXED_DB_STORE, "readonly");
    const store = transaction.objectStore(CLOCK_INDEXED_DB_STORE);
    const index = store.index("employee_code");
    const request = index.getAllKeys();

    request.onsuccess = () => {
      const codes = new Set<string>();
      if (Array.isArray(request.result)) {
        request.result.forEach((code) => {
          const normalized = normalizeEmployeeCode(code as string);
          if (normalized) codes.add(normalized);
        });
      }
      resolve(codes);
    };
    request.onerror = () => {
      console.error("Get existing employee codes error:", request.error);
      resolve(new Set());
    };
  });
}

async function writeIndexedDbClockEvents(events: BiometricClockEvent[]) {
  const database = await openClockIndexedDb();
  if (!database) return false;

  return new Promise<boolean>((resolve) => {
    const transaction = database.transaction(CLOCK_INDEXED_DB_STORE, "readwrite");
    const store = transaction.objectStore(CLOCK_INDEXED_DB_STORE);
    const normalizedEvents = events.map(normalizeClockEvent);

    store.clear();
    normalizedEvents.forEach((event) => store.put(event));

    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => {
      console.error("Write IndexedDB clock events error:", transaction.error);
      resolve(false);
    };
  });
}

async function writeNewClockEventsOnly(newEvents: BiometricClockEvent[]): Promise<{ success: boolean; writtenCount: number }> {
  const database = await openClockIndexedDb();
  if (!database) return { success: false, writtenCount: 0 };

  const normalizedNewEvents = newEvents.map(normalizeClockEvent);
  const existingKeys = await getExistingEventKeys();
  const eventsToWrite = normalizedNewEvents.filter((event) => !existingKeys.has(event.event_key));

  let writtenCount = 0;

  for (const chunk of chunkArray(eventsToWrite)) {
    const result = await new Promise<boolean>((resolve) => {
      const transaction = database.transaction(CLOCK_INDEXED_DB_STORE, "readwrite");
      const store = transaction.objectStore(CLOCK_INDEXED_DB_STORE);

      chunk.forEach((event) => {
        store.put(event);
      });

      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => {
        console.error("Incremental write clock events error:", transaction.error);
        resolve(false);
      };
    });

    if (!result) {
      return { success: false, writtenCount };
    }

    writtenCount += chunk.length;
    await waitForTick();
  }

  return { success: true, writtenCount };
}

async function loadLocalClockEvents(): Promise<BiometricClockEvent[]> {
  if (typeof window === "undefined") return [];

  const indexedDbEvents = await readIndexedDbClockEvents();
  const legacyEvents = loadLegacyLocalClockEvents();
  const merged = mergeClockEvents(indexedDbEvents, legacyEvents);

  if (merged.length > 0) {
    const saved = await writeIndexedDbClockEvents(merged);
    if (saved && legacyEvents.length > 0) clearLegacyLocalClockEvents();
    return merged;
  }

  return [];
}

async function saveLocalClockEvents(events: BiometricClockEvent[]) {
  if (typeof window === "undefined") return;
  const normalizedEvents = events.map(normalizeClockEvent);
  const saved = await writeIndexedDbClockEvents(normalizedEvents);
  if (!saved) saveLegacyLocalClockEvents(normalizedEvents);
}

function getClockStorageErrorMessage(error: unknown) {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message || "")
      : error instanceof Error
        ? error.message
        : String(error || "");

  if (message.includes("Could not find the table 'public.biometric_clock_events' in the schema cache")) {
    return CLOCK_TABLE_SETUP_HINT;
  }
  if (message.includes('relation "public.biometric_clock_events" does not exist') || message.includes('relation "biometric_clock_events" does not exist')) {
    return CLOCK_TABLE_SETUP_HINT;
  }
  if (message.includes("Could not find the function public.exec")) {
    return CLOCK_TABLE_SETUP_HINT;
  }
  return message;
}

function matchesEmployeeClockProfile(event: BiometricClockEvent, employee: Pick<Employee, "employee_code" | "id_number" | "first_name" | "last_name">) {
  const primaryCode = normalizeEmployeeCode(employee.employee_code);
  const fallbackIdNumber = normalizeText(employee.id_number);
  const fallbackName = `${normalizeText(employee.first_name)} ${normalizeText(employee.last_name)}`.trim().toLowerCase();
  const eventName = `${normalizeText(event.first_name)} ${normalizeText(event.last_name)}`.trim().toLowerCase();

  return (
    normalizeEmployeeCode(event.employee_code) === primaryCode ||
    (fallbackIdNumber && normalizeText(event.id_number) === fallbackIdNumber) ||
    (fallbackName && eventName === fallbackName)
  );
}

function findClockHeaderRow(rows: unknown[][]) {
  return rows.findIndex((row) => {
    const keys = row.map((cell) => normalizeHeaderKey(cell));
    const hasPrimaryColumns = keys.includes("date") && keys.includes("time");
    const hasIdentityColumns =
      keys.includes("employee") ||
      keys.includes("employee_1") ||
      keys.includes("emp") ||
      keys.includes("first_name") ||
      keys.includes("last_name") ||
      keys.includes("lastname") ||
      keys.includes("alias");

    return hasPrimaryColumns && hasIdentityColumns;
  });
}

function toNormalizedEntries(row: Record<string, unknown>) {
  return Object.entries(row).reduce<Record<string, unknown>>((acc, [key, value]) => {
    acc[normalizeHeaderKey(key)] = value;
    return acc;
  }, {});
}

function parseClockWorkbookRows(buffer: ArrayBuffer, sourceFileName: string): ParsedClockWorkbookRow[] {
   const workbook = XLSX.read(buffer, { type: "array", cellDates: true, raw: true });
   if (workbook.SheetNames.length === 0) return [];

   const rows = workbook.SheetNames.flatMap((sheetName) => {
     const sheet = workbook.Sheets[sheetName];
     const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true });
     const headerRowIndex = findClockHeaderRow(rawRows);
     if (headerRowIndex < 0) return [];

     const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
       defval: "",
       range: headerRowIndex,
       raw: true,
     });

     return rows
       .map((row, index) => {
         const entries = toNormalizedEntries(row);
         const rawEmployeeCode = isUsableMatchToken(entries.employee || entries.employee_number || entries.employee_1)
           ? normalizeEmployeeCode(entries.employee || entries.employee_number || entries.employee_1)
           : isUsableMatchToken(entries.emp)
             ? normalizeEmployeeCode(entries.emp)
             : "";
         const rawEmployeeNumber = normalizeText(entries.employee || entries.employee_number || entries.employee_1 || entries.emp || rawEmployeeCode);
         const rawIdNumber = isUsableMatchToken(entries.national_id || entries.id_number) ? normalizeMatchToken(entries.national_id || entries.id_number) : "";

         const { clockedAt, clockDate, clockTime } = combineDateTime(entries.date, entries.time);
         const deviceName = normalizeText(entries.device_name || entries.device);
         const parsedStore = parseRegionStore(deviceName);

         if (!clockedAt) return null;

         return {
           raw_row_number: headerRowIndex + index + 2,
           raw_employee_code: rawEmployeeCode,
           raw_employee_number: rawEmployeeNumber,
           raw_id_number: rawIdNumber,
           employee_code: rawEmployeeCode,
           employee_number: rawEmployeeNumber,
           first_name: normalizeText(entries.first_name),
           last_name: normalizeText(entries.lastname || entries.last_name),
           alias: normalizeText(entries.alias),
           id_number: rawIdNumber,
           device_name: deviceName,
           clockiq_device_name: normalizeText(entries.clockiq_deviceevice_name || entries.clockiq_device_name),
           direction: normalizeText(entries.direction),
           method: normalizeText(entries.method),
           company: normalizeText(entries.company),
           branch: normalizeText(entries.branch),
           person_type: normalizeText(entries.person_type),
           business_unit: normalizeText(entries.business_unit),
           department: normalizeText(entries.department),
           team: normalizeText(entries.team),
           job_title: normalizeText(entries.job_title),
           cost_center: normalizeText(entries.cost_center),
           custom_1: normalizeText(entries.custom1 || entries.custom_1),
           custom_2: normalizeText(entries.custom_2),
           access_granted: normalizeBool(entries.access_granted),
           access_verified: normalizeBool(entries.access_verified),
           region: parsedStore.region,
           store: parsedStore.store,
           store_code: parsedStore.storeCode,
           clocked_at: clockedAt,
           clock_date: clockDate,
           clock_time: clockTime,
           source_file_name: sourceFileName,
         } satisfies ParsedClockWorkbookRow;
       })
       .filter(Boolean) as ParsedClockWorkbookRow[];
   });

   return rows;
 }

function buildClockWorkbookImportResult(parsedRows: ParsedClockWorkbookRow[], employees: Employee[]): ClockWorkbookParseResult {
   const employeesByCode = new Map<string, Employee>();
   const employeesById = new Map<string, Employee>();
   const employeesByAlias = new Map<string, Employee>();
   const employeesByName = new Map<string, Employee>();

   employees.forEach((employee) => {
     const code = normalizeEmployeeCode(employee.employee_code);
     const idNumber = normalizeMatchToken(employee.id_number);
     const alias = normalizeMatchToken(employee.alias);
     const fullName = normalizeMatchToken(`${employee.first_name} ${employee.last_name}`);
     if (code) employeesByCode.set(code, employee);
     if (idNumber) employeesById.set(idNumber, employee);
     if (alias) employeesByAlias.set(alias, employee);
     if (fullName) employeesByName.set(fullName, employee);
   });

   const allocatedRows: ClockImportAllocationRow[] = [];
   const unallocatedRows: ClockImportAllocationRow[] = [];
   const events: BiometricClockEvent[] = [];

   parsedRows.forEach((row) => {
     const workbookEmployeeCode = normalizeEmployeeCode(row.raw_employee_code || row.employee_code || row.employee_number);
     const workbookIdNumber = normalizeMatchToken(row.raw_id_number || row.id_number);
     const workbookAlias = normalizeMatchToken(row.alias);
     const workbookName = normalizeMatchToken(`${row.first_name} ${row.last_name}`);

     const matchedByCode = workbookEmployeeCode ? employeesByCode.get(workbookEmployeeCode) : undefined;
     const matchedById = !matchedByCode && workbookIdNumber ? employeesById.get(workbookIdNumber) : undefined;
     const matchedByAlias = !matchedByCode && !matchedById && workbookAlias ? employeesByAlias.get(workbookAlias) : undefined;
     const matchedByName = !matchedByCode && !matchedById && !matchedByAlias && workbookName ? employeesByName.get(workbookName) : undefined;
     const matchedEmployee = matchedByCode || matchedById || matchedByAlias || matchedByName;

     const resolvedEmployeeCode = matchedEmployee
       ? normalizeEmployeeCode(matchedEmployee.employee_code)
       : workbookEmployeeCode;

     const matchedBy: "employee_code" | "id_number" | "alias" | "name" | "" = matchedByCode
       ? "employee_code"
       : matchedById
         ? "id_number"
         : matchedByAlias
           ? "alias"
           : matchedByName
             ? "name"
         : workbookEmployeeCode
           ? "employee_code"
           : "";

     const employeeName =
       `${row.first_name} ${row.last_name}`.trim() ||
       row.alias ||
       `${matchedEmployee?.first_name || ""} ${matchedEmployee?.last_name || ""}`.trim() ||
       resolvedEmployeeCode ||
       "Unknown employee";

     if (!resolvedEmployeeCode) {
       unallocatedRows.push({
         row_number: row.raw_row_number,
         source_file_name: row.source_file_name,
         employee_code: "",
         id_number: workbookIdNumber,
         employee_name: employeeName,
         clocked_at: row.clocked_at,
         clock_date: row.clock_date,
         clock_time: row.clock_time,
         device_name: row.device_name,
         method: row.method,
         direction: row.direction,
         matched_by: "",
         employee_profile_status: "",
         status: "unallocated",
         reason: "No usable employee code was found in the workbook row and no employee profile matched by ID number.",
       });
       return;
     }

     const event = normalizeClockEvent({
       ...row,
       employee_code: resolvedEmployeeCode,
       employee_number: row.raw_employee_number || resolvedEmployeeCode,
       first_name: row.first_name || matchedEmployee?.first_name || "",
       last_name: row.last_name || matchedEmployee?.last_name || "",
       alias: row.alias || matchedEmployee?.alias || "",
       id_number: workbookIdNumber || matchedEmployee?.id_number || "",
       company: row.company || matchedEmployee?.company || "",
       branch: row.branch || matchedEmployee?.branch || "",
       person_type: row.person_type || matchedEmployee?.person_type || "",
       business_unit: row.business_unit || matchedEmployee?.business_unit || "",
       department: row.department || matchedEmployee?.department || "",
       team: row.team || matchedEmployee?.team || "",
       job_title: row.job_title || matchedEmployee?.job_title || "",
       cost_center: row.cost_center || matchedEmployee?.cost_center || "",
       region: row.region || matchedEmployee?.region || "",
       store: row.store || matchedEmployee?.store || "",
       store_code: row.store_code || matchedEmployee?.store_code || "",
     });

     events.push(event);

     allocatedRows.push({
       row_number: row.raw_row_number,
       source_file_name: row.source_file_name,
       employee_code: resolvedEmployeeCode,
       id_number: event.id_number,
       employee_name: employeeName,
       clocked_at: event.clocked_at,
       clock_date: event.clock_date,
       clock_time: event.clock_time,
       device_name: event.device_name,
       method: event.method,
       direction: event.direction,
       matched_by: matchedBy,
       employee_profile_status: matchedEmployee?.status || "new_profile",
       status: "allocated",
       reason: matchedEmployee
         ? matchedByCode
           ? `Allocated using employee code to a ${matchedEmployee.status || "active"} employee profile.`
           : matchedById
             ? `Allocated using ID number to employee code ${resolvedEmployeeCode} on a ${matchedEmployee.status || "active"} employee profile.`
             : matchedByAlias
               ? `Allocated using alias to employee code ${resolvedEmployeeCode} on a ${matchedEmployee.status || "active"} employee profile.`
               : `Allocated using employee name to employee code ${resolvedEmployeeCode} on a ${matchedEmployee.status || "active"} employee profile.`
         : `Allocated using workbook employee code ${resolvedEmployeeCode}. The employee sync step will create or update the profile if needed.`,
     });
   });

   const dedupedEvents = dedupeClockEvents(events).items;

   return {
     events: dedupedEvents,
     report: {
       totalRows: parsedRows.length,
       allocatedCount: allocatedRows.length,
       unallocatedCount: unallocatedRows.length,
       allocatedRows,
       unallocatedRows,
     },
   };
 }

export function parseClockWorkbook(
   buffer: ArrayBuffer,
   sourceFileName: string,
   employees: Employee[] = []
): ClockWorkbookParseResult {
   const parsedRows = parseClockWorkbookRows(buffer, sourceFileName);
   return buildClockWorkbookImportResult(parsedRows, employees);
 }

export function buildEmployeeInputsFromClockEvents(events: BiometricClockEvent[], existingEmployees: Employee[]) {
  const existingMap = new Map(existingEmployees.map((employee) => [normalizeEmployeeCode(employee.employee_code), employee]));
  const nextMap = new Map<string, EmployeeInput>();

  events.forEach((event) => {
    const normalizedCode = normalizeEmployeeCode(event.employee_code);
    const existing = existingMap.get(normalizedCode);
    const region = event.region && event.region !== "Unknown Region" ? event.region : existing?.region || "";
    const store = event.store || existing?.store || "";
    const storeCode = event.store_code || existing?.store_code || "";

    nextMap.set(normalizedCode, {
      employee_code: normalizedCode,
      first_name: event.first_name || existing?.first_name || "",
      last_name: event.last_name || existing?.last_name || "",
      title: existing?.title || "",
      alias: event.alias || existing?.alias || "",
      id_number: event.id_number || existing?.id_number || "",
      email: existing?.email || "",
      phone: existing?.phone || "",
      job_title: event.job_title || existing?.job_title || "",
      department: event.department || existing?.department || "",
      region,
      store,
      store_code: storeCode,
      hire_date: existing?.hire_date || "",
      person_type: event.person_type || existing?.person_type || "",
      fingerprints_enrolled: existing?.fingerprints_enrolled ?? null,
      company: event.company || existing?.company || "",
      branch: event.branch || existing?.branch || "",
      business_unit: event.business_unit || existing?.business_unit || "",
      cost_center: event.cost_center || existing?.cost_center || "",
      team: event.team || existing?.team || "",
      ta_integration_id_1: existing?.ta_integration_id_1 || "",
      ta_integration_id_2: existing?.ta_integration_id_2 || "",
      access_profile: existing?.access_profile || "",
      ta_enabled: existing?.ta_enabled ?? null,
      permanent: existing?.permanent ?? null,
      active: existing?.active ?? (existing ? existing.status === "active" : true),
      status: existing?.status || "active",
    });
  });

  return Array.from(nextMap.values()).filter((employee) => employee.employee_code && employee.first_name && employee.last_name);
}

export async function initializeClockDatabase() {
  try {
    const isAvailable = await checkRemoteClockTableAvailability();
    if (!isAvailable) {
      console.warn("Clock database initialization warning:", CLOCK_TABLE_SETUP_HINT);
    }
    return isAvailable;
  } catch (error) {
    console.warn("Clock database initialization warning:", getClockStorageErrorMessage(error));
    return false;
  }
}

export async function getClockEvents(filters?: GetClockEventsFilters) {
  const hasFilters = filters?.search || filters?.store || filters?.startDate || filters?.endDate || (filters as GetClockEventsFilters | undefined)?.employeeCodes?.length
  
  if (!hasFilters) {
    const cached = getCachedClockEvents()
    if (cached) return cached
  }
  
  const localEvents = await loadLocalClockEvents();
  if (localEvents.length > 0 && !hasFilters) {
    setCachedClockEvents(localEvents)
    return localEvents
  }
  
  const normalizedEmployeeCodes = (filters as GetClockEventsFilters | undefined)?.employeeCodes
    ?.map((code) => normalizeEmployeeCode(code))
    .filter(Boolean);

  const applyFilters = (events: BiometricClockEvent[]) =>
    events.filter((event) => {
      const matchesStore = !filters?.store || event.store === filters.store;
      const queryText = normalizeText(filters?.search).toLowerCase();
      const haystack = `${event.employee_code} ${event.first_name} ${event.last_name} ${event.alias} ${event.id_number} ${event.device_name} ${event.store}`.toLowerCase();
      const matchesSearch = !queryText || haystack.includes(queryText);
      const matchesEmployeeCodes =
        !normalizedEmployeeCodes || normalizedEmployeeCodes.length === 0 || normalizedEmployeeCodes.includes(normalizeEmployeeCode(event.employee_code));
      const matchesStartDate = !(filters as GetClockEventsFilters | undefined)?.startDate || event.clock_date >= (filters as GetClockEventsFilters).startDate!;
      const matchesEndDate = !(filters as GetClockEventsFilters | undefined)?.endDate || event.clock_date <= (filters as GetClockEventsFilters).endDate!;
      return matchesStore && matchesSearch && matchesEmployeeCodes && matchesStartDate && matchesEndDate;
    });

  try {
    let query = supabase.from("biometric_clock_events").select("*").order("clocked_at", { ascending: false }).limit(5000);
    if (filters?.store) query = query.eq("store", filters.store);
    if ((filters as GetClockEventsFilters | undefined)?.startDate) query = query.gte("clock_date", (filters as GetClockEventsFilters).startDate!);
    if ((filters as GetClockEventsFilters | undefined)?.endDate) query = query.lte("clock_date", (filters as GetClockEventsFilters).endDate!);
    if (filters?.search) {
      const search = filters.search.replace(/,/g, "");
      query = query.or(
        `employee_code.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%,alias.ilike.%${search}%,id_number.ilike.%${search}%,device_name.ilike.%${search}%,store.ilike.%${search}%`
      );
    }

    const { data, error } = await withClockTimeout(query);
    if (error) {
      console.warn("Get clock events warning:", getClockStorageErrorMessage(error));
      return applyFilters(localEvents);
    }

    const merged = mergeClockEvents(localEvents, (data || []).map((event) => normalizeClockEvent(event as BiometricClockEvent)));
    await saveLocalClockEvents(merged);
    const result = applyFilters(merged);
    if (!hasFilters) {
      setCachedClockEvents(result)
    }
    return result;
  } catch (error) {
    console.warn("Get clock events warning:", getClockStorageErrorMessage(error));
    return applyFilters(localEvents);
  }
}

export async function getClockEventsForEmployeeProfile(
  employee: Pick<Employee, "employee_code" | "id_number" | "first_name" | "last_name">
) {
  const localEvents = await loadLocalClockEvents();
  const localMatches = localEvents.filter((event) => matchesEmployeeClockProfile(event, employee));
  const primaryCode = normalizeEmployeeCode(employee.employee_code);
  const fallbackIdNumber = normalizeText(employee.id_number);
  const fallbackFirstName = normalizeText(employee.first_name);
  const fallbackLastName = normalizeText(employee.last_name);

  try {
    let remoteMatches: BiometricClockEvent[] = [];

    if (primaryCode) {
      const { data, error } = await supabase
        .from("biometric_clock_events")
        .select("*")
        .eq("employee_code", primaryCode)
        .order("clocked_at", { ascending: false });

      if (error) {
        console.warn("Get employee clock profile warning:", getClockStorageErrorMessage(error));
        return mergeClockEvents(localMatches);
      }

      remoteMatches = (data || []).map((event) => normalizeClockEvent(event as BiometricClockEvent));
    }

    if (remoteMatches.length === 0 && fallbackIdNumber) {
      const { data, error } = await supabase
        .from("biometric_clock_events")
        .select("*")
        .eq("id_number", fallbackIdNumber)
        .order("clocked_at", { ascending: false })
        .limit(500);

      if (error) {
        console.warn("Get employee clock profile warning:", getClockStorageErrorMessage(error));
        return mergeClockEvents(localMatches);
      }

      remoteMatches = (data || []).map((event) => normalizeClockEvent(event as BiometricClockEvent));
    }

    if (remoteMatches.length === 0 && fallbackFirstName && fallbackLastName) {
      const { data, error } = await supabase
        .from("biometric_clock_events")
        .select("*")
        .ilike("first_name", fallbackFirstName)
        .ilike("last_name", fallbackLastName)
        .order("clocked_at", { ascending: false })
        .limit(500);

      if (error) {
        console.warn("Get employee clock profile warning:", getClockStorageErrorMessage(error));
        return mergeClockEvents(localMatches);
      }

      remoteMatches = (data || []).map((event) => normalizeClockEvent(event as BiometricClockEvent));
    }

    const merged = mergeClockEvents(localMatches, remoteMatches.filter((event) => matchesEmployeeClockProfile(event, employee)));
    if (merged.length > 0) {
      await saveLocalClockEvents(mergeClockEvents(localEvents, merged));
    }
    return merged;
  } catch (error) {
    console.warn("Get employee clock profile warning:", getClockStorageErrorMessage(error));
    return mergeClockEvents(localMatches);
  }
}

export async function getClockOverview(filters?: GetClockEventsFilters): Promise<ClockOverview> {
  const hasFilters = filters?.search || filters?.store || filters?.startDate || filters?.endDate
  
  if (!hasFilters) {
    const cached = getCachedClockEvents()
    if (cached) {
      const summaries = buildClockEmployeeSummaries(cached);
      const processedDays = buildProcessedClockDays(cached);
      return {
        totalEvents: cached.length,
        totalProcessedDays: processedDays.length,
        employeesWithClocks: summaries.length,
        verifiedEvents: cached.filter((event) => event.access_verified).length,
        stores: Array.from(new Set(cached.map((event) => event.store).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
        summaries,
      };
    }
  }
  
  try {
    let query = supabase.from("biometric_clock_events").select("*").order("clocked_at", { ascending: false }).limit(5000);
    if (filters?.store) query = query.eq("store", filters.store);
    if (filters?.startDate) query = query.gte("clock_date", filters.startDate);
    if (filters?.endDate) query = query.lte("clock_date", filters.endDate);
    
    const { data, error } = await withClockTimeout(query);
    if (error) throw error;
    
    const events = (data || []).map((e) => normalizeClockEvent(e as BiometricClockEvent));
    const localEvents = await loadLocalClockEvents();
    const merged = mergeClockEvents(localEvents, events);
    const summaries = buildClockEmployeeSummaries(merged);
    const processedDays = buildProcessedClockDays(merged);

    return {
      totalEvents: merged.length,
      totalProcessedDays: processedDays.length,
      employeesWithClocks: summaries.length,
      verifiedEvents: merged.filter((event) => event.access_verified).length,
      stores: Array.from(new Set(merged.map((event) => event.store).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
      summaries,
    };
  } catch (err) {
    console.warn("Clock overview error:", err);
    return { totalEvents: 0, totalProcessedDays: 0, employeesWithClocks: 0, verifiedEvents: 0, stores: [], summaries: [] };
  }
}

export async function getClockEventsPage(filters?: ClockPageFilters): Promise<ClockPageResult<BiometricClockEvent>> {
  const events = await getClockEvents(filters);
  const offset = Math.max(0, filters?.offset || 0);
  const limit = Math.max(1, filters?.limit || 100);
  return {
    items: events.slice(offset, offset + limit),
    total: events.length,
  };
}

export async function getProcessedClockDaysPage(filters?: ClockPageFilters): Promise<ClockPageResult<ProcessedClockDay>> {
  const events = await getClockEvents(filters);
  const processedDays = buildProcessedClockDays(events);
  const offset = Math.max(0, filters?.offset || 0);
  const limit = Math.max(1, filters?.limit || 100);
  return {
    items: processedDays.slice(offset, offset + limit),
    total: processedDays.length,
  };
}

export async function upsertClockEvents(
  events: BiometricClockEvent[],
  onProgress?: (progress: ClockUpsertProgress) => void
) {
  const { items: uniqueEvents, duplicatesRemoved } = dedupeClockEvents(events);
  
  const existingKeys = await getExistingEventKeys();
  const newOnlyEvents = uniqueEvents.filter((event) => !existingKeys.has(normalizeClockEvent(event).event_key));
  
  const safeEmit = (phase: "local" | "remote", completed: number, total: number) => {
    const percent = total <= 0 ? 100 : Math.max(0, Math.min(100, Math.round((completed / total) * 100)));
    onProgress?.({ phase, completed, total, percent });
  };
  
  safeEmit("local", 0, Math.max(1, newOnlyEvents.length));
  
  if (newOnlyEvents.length > 0) {
    let localWritten = 0;
    for (const chunk of chunkArray(newOnlyEvents)) {
      const result = await writeNewClockEventsOnly(chunk);
      localWritten += result.writtenCount;
      safeEmit("local", localWritten, newOnlyEvents.length);
      await waitForTick();
    }
  } else {
    safeEmit("local", 1, 1);
  }
  
  try {
    const payload = uniqueEvents.map((event) => {
      const normalized = normalizeClockEvent(event);
      return {
        event_key: normalized.event_key,
        employee_code: normalized.employee_code,
        employee_number: normalized.employee_number,
        first_name: normalized.first_name,
        last_name: normalized.last_name,
        alias: normalized.alias,
        id_number: normalized.id_number,
        device_name: normalized.device_name,
        clockiq_device_name: normalized.clockiq_device_name,
        direction: normalized.direction,
        method: normalized.method,
        company: normalized.company,
        branch: normalized.branch,
        person_type: normalized.person_type,
        business_unit: normalized.business_unit,
        department: normalized.department,
        team: normalized.team,
        job_title: normalized.job_title,
        cost_center: normalized.cost_center,
        custom_1: normalized.custom_1,
        custom_2: normalized.custom_2,
        access_granted: normalized.access_granted,
        access_verified: normalized.access_verified,
        region: normalized.region,
        store: normalized.store,
        store_code: normalized.store_code,
        clocked_at: normalized.clocked_at,
        clock_date: normalized.clock_date,
        clock_time: normalized.clock_time,
        source_file_name: normalized.source_file_name,
      };
    });
    
    safeEmit("remote", 0, Math.max(1, payload.length));
    
    let remoteSaved = 0;
    for (const chunk of chunkArray(payload)) {
      const { error } = await supabase.from("biometric_clock_events").upsert(chunk, { onConflict: "event_key" });
      if (error) {
        const message = getClockStorageErrorMessage(error);
        console.warn("Upsert clock events warning:", message);
        return { success: true, error: message, count: payload.length, duplicatesRemoved };
      }
      remoteSaved += chunk.length;
      safeEmit("remote", remoteSaved, payload.length);
      await waitForTick();
    }
    
    safeEmit("remote", payload.length, payload.length);
    clockCache = { data: null, timestamp: 0 }
    try { localStorage.removeItem(CLOCK_CACHE_KEY) } catch {}
    return { success: true, count: payload.length, duplicatesRemoved };
  } catch (error) {
    const message = getClockStorageErrorMessage(error);
    console.warn("Upsert clock events warning:", message);
    clockCache = { data: null, timestamp: 0 }
    try { localStorage.removeItem(CLOCK_CACHE_KEY) } catch {}
    return { success: true, error: message, count: uniqueEvents.length, duplicatesRemoved };
  }
}

export async function clearClockEvents() {
  await saveLocalClockEvents([]);
  clockCache = { data: null, timestamp: 0 }

  try {
    const { error } = await supabase.from("biometric_clock_events").delete().neq("id", "");
    if (error) {
      const message = getClockStorageErrorMessage(error);
      console.warn("Clear clock events warning:", message);
      return { success: true, error: message };
    }

    clockRemoteSetupAvailable = true;
    return { success: true };
  } catch (error) {
    const message = getClockStorageErrorMessage(error);
    console.warn("Clear clock events warning:", message);
    return { success: true, error: message };
  }
}

export async function replaceClockEvents(events: BiometricClockEvent[]) {
  const clearResult = await clearClockEvents();
  const importResult = await upsertClockEvents(events);

  return {
    success: true,
    count: importResult.count,
    duplicatesRemoved: importResult.duplicatesRemoved,
    error: [clearResult.error, importResult.error].filter(Boolean).join(" ").trim(),
  };
}

export function buildClockEmployeeSummaries(events: BiometricClockEvent[]): ClockEmployeeSummary[] {
  const map = new Map<string, ClockEmployeeSummary>();

  events.forEach((event) => {
    if (!map.has(event.employee_code)) {
      map.set(event.employee_code, {
        employee_code: event.employee_code,
        employee_name: `${event.first_name} ${event.last_name}`.trim() || event.employee_code,
        alias: event.alias,
        id_number: event.id_number,
        store: event.store,
        store_code: event.store_code,
        last_clocked_at: event.clocked_at,
        total_events: 0,
        verified_events: 0,
        devices: [],
        methods: [],
      });
    }

    const summary = map.get(event.employee_code)!;
    summary.total_events += 1;
    if (event.access_verified) summary.verified_events += 1;
    if (!summary.devices.includes(event.device_name) && event.device_name) summary.devices.push(event.device_name);
    if (!summary.methods.includes(event.method) && event.method) summary.methods.push(event.method);
    if (event.clocked_at > summary.last_clocked_at) summary.last_clocked_at = event.clocked_at;
    if (!summary.store && event.store) summary.store = event.store;
    if (!summary.store_code && event.store_code) summary.store_code = event.store_code;
    if (!summary.id_number && event.id_number) summary.id_number = event.id_number;
    if (!summary.alias && event.alias) summary.alias = event.alias;
  });

  return Array.from(map.values()).sort((a, b) => b.last_clocked_at.localeCompare(a.last_clocked_at));
}

export function buildProcessedClockDays(events: BiometricClockEvent[]): ProcessedClockDay[] {
  const grouped = new Map<string, BiometricClockEvent[]>();

  events.forEach((event) => {
    const dateKey = event.clock_date || event.clocked_at.slice(0, 10);
    const key = `${event.employee_code}__${dateKey}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(event);
  });

  return Array.from(grouped.entries())
    .map(([key, items]) => {
      const sorted = [...items].sort((a, b) => a.clocked_at.localeCompare(b.clocked_at));
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const clockCount = sorted.length;
      const status: ProcessedClockDay["status"] = clockCount === 1 ? "No In/Out" : "In/Out";

      return {
        key,
        employee_code: first.employee_code,
        employee_name: `${first.first_name} ${first.last_name}`.trim() || first.alias || first.employee_code,
        id_number: first.id_number || "",
        store: first.store || "",
        clock_date: first.clock_date || first.clocked_at.slice(0, 10),
        clock_count: clockCount,
        first_clock: getClockTimeValue(first),
        last_clock: clockCount > 1 ? getClockTimeValue(last) : "",
        status,
        verified_count: sorted.filter((event) => event.access_verified).length,
        granted_count: sorted.filter((event) => event.access_granted).length,
        devices: Array.from(new Set(sorted.map((event) => event.device_name).filter(Boolean))),
        methods: Array.from(new Set(sorted.map((event) => event.method).filter(Boolean))),
        source_files: Array.from(new Set(sorted.map((event) => event.source_file_name).filter(Boolean))),
      };
    })
    .sort((a, b) => b.clock_date.localeCompare(a.clock_date) || a.employee_name.localeCompare(b.employee_name));
}
