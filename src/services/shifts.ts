import * as XLSX from "xlsx";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { getWeekCycleLabel } from "@/services/calendar";
import { hasConfiguredShiftSyncLinks, loadShiftSyncSettings } from "@/services/shiftSync";

export type ShiftDayKey =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export type ShiftLog = {
  id: string;
  timestamp: string;
  source: "import" | "edit" | "paste" | "delete" | "merge";
  field: string;
  before: string;
  after: string;
  note?: string;
};

export type ShiftRow = {
  id: string;
  row_key: string;
  group_key: string;
  week_number: number;
  week_label: string;
  order_index: number;
  employee_name: string;
  employee_code: string;
  department: string;
  hr: string;
  time_label: string;
  monday: string;
  tuesday: string;
  wednesday: string;
  thursday: string;
  friday: string;
  saturday: string;
  sunday: string;
  notes: string;
  expected_hours: Record<ShiftDayKey, number>;
  extra_columns: Record<string, string>;
  logs: ShiftLog[];
};

export type ShiftRoster = {
  id: string;
  sheet_name: string;
  store_name: string;
  store_code: string;
  source_file_name: string;
  custom_columns: string[];
  rows: ShiftRow[];
  updated_at: string;
  import_summary: {
    imported_rows: number;
    updated_rows: number;
    preserved_rows: number;
  };
};

export type ShiftRosterHistoryEntry = {
  id: string;
  snapshot_key: string;
  sheet_name: string;
  store_name: string;
  store_code: string;
  source_file_name: string;
  custom_columns: string[];
  rows: ShiftRow[];
  updated_at: string;
  import_summary: ShiftRoster["import_summary"];
  effective_from: string;
  effective_to: string | null;
  changed_at: string;
};

export type ShiftRosterChangeEvent = {
  id: string;
  sheet_name: string;
  row_key: string;
  employee_code: string;
  employee_name: string;
  week_label: string;
  field: string;
  before: string;
  after: string;
  change_type: "added" | "updated" | "removed";
  effective_from: string;
  changed_at: string;
  source_file_name: string;
  store_name: string;
  store_code: string;
};

export type ShiftRosterLookupValue = {
  scheduled: boolean;
  dayOff: boolean;
  leave: boolean;
  store: string;
  storeCode: string;
  sourceSheetName: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  changedAt: string;
};

export type HistoricalRosterSource = {
  sheetName: string;
  storeName: string;
  storeCode: string;
  weekRows: Map<number, ShiftRow>;
  effectiveFrom: string;
  effectiveTo: string | null;
  changedAt: string;
};

type RemoteShiftRosterRecord = {
  id: string;
  sheet_name: string;
  store_name: string;
  store_code: string | null;
  source_file_name: string | null;
  updated_at: string;
  payload: {
    custom_columns?: string[];
    rows?: ShiftRow[];
    import_summary?: {
      imported_rows?: number;
      updated_rows?: number;
      preserved_rows?: number;
    };
  } | null;
};

type RemoteShiftRosterHistoryRecord = {
  id: string;
  snapshot_key: string;
  sheet_name: string;
  store_name: string;
  store_code: string | null;
  source_file_name: string | null;
  effective_from: string;
  effective_to: string | null;
  changed_at: string;
  updated_at: string | null;
  payload: {
    custom_columns?: string[];
    rows?: ShiftRow[];
    import_summary?: ShiftRoster["import_summary"];
  } | null;
};

type RemoteShiftRosterChangeEventRecord = {
  id: string;
  sheet_name: string;
  row_key: string;
  employee_code: string | null;
  employee_name: string | null;
  week_label: string | null;
  field: string;
  before_value: string | null;
  after_value: string | null;
  change_type: "added" | "updated" | "removed";
  effective_from: string;
  changed_at: string;
  source_file_name: string | null;
  store_name: string | null;
  store_code: string | null;
};

type ParsedSheetHeader = {
  weekIndex: number;
  nameIndex: number;
  departmentIndex: number;
  hrIndex: number;
  codeIndex: number;
  timeIndex: number;
  dayIndexes: Record<ShiftDayKey, number>;
  notesIndex: number;
  extraIndexes: Array<{ index: number; key: string }>;
};

const DAY_ORDER: ShiftDayKey[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];
const SHIFT_ROSTER_STORAGE_KEY = "shift-rosters-cache-v1";
const SHIFT_ROSTER_HISTORY_STORAGE_KEY = "shift-roster-history-cache-v1";
const SHIFT_ROSTER_CHANGE_EVENTS_STORAGE_KEY = "shift-roster-change-events-cache-v1";
const SHIFT_REMOTE_SETUP_HINT =
  "Remote shift table is not set up yet. Run setup-database.ps1 or the SQL in supabase-setup.sql to create the Supabase schema. Shifts are still being saved locally in this browser.";

let shiftRemoteSetupAvailable: boolean | null = null;
let shiftRemoteSetupCheck: Promise<boolean> | null = null;

function randomId() {
  return globalThis.crypto?.randomUUID?.() ?? `shift_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

function formatDateOnly(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function shiftDateKey(dateKey: string, days: number) {
  const [year, month, day] = String(dateKey || "").split("-").map(Number);
  if (!year || !month || !day) return dateKey;
  const next = new Date(year, month - 1, day);
  next.setDate(next.getDate() + days);
  return formatDateOnly(next);
}

function isDateWithinEffectiveRange(dateKey: string, effectiveFrom: string, effectiveTo: string | null) {
  if (!dateKey || !effectiveFrom) return false;
  if (dateKey < effectiveFrom) return false;
  if (effectiveTo && dateKey > effectiveTo) return false;
  return true;
}

function getShiftDayKeyForDate(date: Date): ShiftDayKey {
  return DAY_ORDER[(date.getDay() + 6) % 7];
}

function loadLocalShiftRosters(): ShiftRoster[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(SHIFT_ROSTER_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ShiftRoster[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("Load local shift rosters error:", error);
    return [];
  }
}

function loadLocalShiftRosterHistory(): ShiftRosterHistoryEntry[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(SHIFT_ROSTER_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ShiftRosterHistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("Load local shift roster history error:", error);
    return [];
  }
}

function saveLocalShiftRosterHistory(entries: ShiftRosterHistoryEntry[]) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(SHIFT_ROSTER_HISTORY_STORAGE_KEY, JSON.stringify(entries));
  } catch (error) {
    console.error("Save local shift roster history error:", error);
  }
}

function loadLocalShiftRosterChangeEvents(): ShiftRosterChangeEvent[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(SHIFT_ROSTER_CHANGE_EVENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ShiftRosterChangeEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("Load local shift roster change events error:", error);
    return [];
  }
}

function saveLocalShiftRosterChangeEvents(entries: ShiftRosterChangeEvent[]) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(SHIFT_ROSTER_CHANGE_EVENTS_STORAGE_KEY, JSON.stringify(entries));
  } catch (error) {
    console.error("Save local shift roster change events error:", error);
  }
}

function saveLocalShiftRosters(rosters: ShiftRoster[]) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(SHIFT_ROSTER_STORAGE_KEY, JSON.stringify(rosters));
  } catch (error) {
    console.error("Save local shift rosters error:", error);
  }
}

async function hasActiveShiftSyncLinks() {
  try {
    const settings = await loadShiftSyncSettings();
    return hasConfiguredShiftSyncLinks(settings);
  } catch {
    return false;
  }
}

async function checkRemoteShiftTableAvailability() {
  if (shiftRemoteSetupAvailable !== null) {
    return shiftRemoteSetupAvailable;
  }

  if (shiftRemoteSetupCheck) {
    return shiftRemoteSetupCheck;
  }

  shiftRemoteSetupCheck = (async () => {
    try {
      if (!isSupabaseConfigured) {
        shiftRemoteSetupAvailable = false;
        return false;
      }
      const { error } = await supabase.from("shift_rosters").select("id").limit(1);
      shiftRemoteSetupAvailable = !error;
      return shiftRemoteSetupAvailable;
    } catch {
      shiftRemoteSetupAvailable = false;
      return false;
    } finally {
      shiftRemoteSetupCheck = null;
    }
  })();

  return shiftRemoteSetupCheck;
}

function getShiftStorageErrorMessage(error: unknown) {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message || "")
      : error instanceof Error
        ? error.message
        : String(error || "");

  if (message.includes("Could not find the table 'public.shift_rosters' in the schema cache")) {
    return SHIFT_REMOTE_SETUP_HINT;
  }

  if (message.includes("relation \"public.shift_rosters\" does not exist") || message.includes("relation \"shift_rosters\" does not exist")) {
    return SHIFT_REMOTE_SETUP_HINT;
  }

  if (message.includes("Could not find the function public.exec")) {
    return SHIFT_REMOTE_SETUP_HINT;
  }

  return message;
}

function normalizeText(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function normalizeEmployeeCode(value: unknown) {
  return normalizeText(value).replace(/\s+/g, "").toUpperCase();
}

function buildShiftRosterSnapshotKey(sheetName: string, effectiveFrom: string) {
  return `${normalizeKey(sheetName)}__${effectiveFrom}`;
}

function normalizeShiftRosterHistoryEntry(entry: ShiftRosterHistoryEntry): ShiftRosterHistoryEntry {
  return {
    ...entry,
    store_name: normalizeText(entry.store_name),
    store_code: normalizeText(entry.store_code),
    source_file_name: normalizeText(entry.source_file_name),
    effective_from: normalizeText(entry.effective_from),
    effective_to: normalizeText(entry.effective_to) || null,
    changed_at: normalizeText(entry.changed_at) || new Date().toISOString(),
    updated_at: normalizeText(entry.updated_at) || new Date().toISOString(),
    custom_columns: Array.isArray(entry.custom_columns) ? entry.custom_columns.map((value) => normalizeText(value)).filter(Boolean) : [],
    rows: Array.isArray(entry.rows) ? entry.rows : [],
    import_summary: entry.import_summary || {
      imported_rows: 0,
      updated_rows: 0,
      preserved_rows: 0,
    },
  };
}

function normalizeShiftRosterChangeEvent(entry: ShiftRosterChangeEvent): ShiftRosterChangeEvent {
  return {
    ...entry,
    sheet_name: normalizeText(entry.sheet_name),
    row_key: normalizeText(entry.row_key),
    employee_code: normalizeEmployeeCode(entry.employee_code),
    employee_name: normalizeText(entry.employee_name),
    week_label: normalizeText(entry.week_label),
    field: normalizeText(entry.field),
    before: normalizeText(entry.before),
    after: normalizeText(entry.after),
    effective_from: normalizeText(entry.effective_from),
    changed_at: normalizeText(entry.changed_at) || new Date().toISOString(),
    source_file_name: normalizeText(entry.source_file_name),
    store_name: normalizeText(entry.store_name),
    store_code: normalizeText(entry.store_code),
  };
}

function mergeShiftRosterHistoryCollections(...collections: ShiftRosterHistoryEntry[][]) {
  const map = new Map<string, ShiftRosterHistoryEntry>();

  collections.flat().forEach((entry) => {
    const normalized = normalizeShiftRosterHistoryEntry(entry);
    const key = normalized.snapshot_key || buildShiftRosterSnapshotKey(normalized.sheet_name, normalized.effective_from);
    map.set(key, {
      ...normalized,
      snapshot_key: key,
    });
  });

  return Array.from(map.values()).sort((a, b) => {
    if (a.sheet_name !== b.sheet_name) return a.sheet_name.localeCompare(b.sheet_name);
    if (a.effective_from !== b.effective_from) return b.effective_from.localeCompare(a.effective_from);
    return b.changed_at.localeCompare(a.changed_at);
  });
}

function mergeShiftRosterChangeEventCollections(...collections: ShiftRosterChangeEvent[][]) {
  const map = new Map<string, ShiftRosterChangeEvent>();

  collections.flat().forEach((entry) => {
    const normalized = normalizeShiftRosterChangeEvent(entry);
    map.set(normalized.id, normalized);
  });

  return Array.from(map.values()).sort((a, b) => b.changed_at.localeCompare(a.changed_at));
}

function createShiftRosterHistoryEntry(
  roster: ShiftRoster,
  effectiveFrom: string,
  effectiveTo: string | null,
  changedAt: string
): ShiftRosterHistoryEntry {
  return {
    id: randomId(),
    snapshot_key: buildShiftRosterSnapshotKey(roster.sheet_name, effectiveFrom),
    sheet_name: roster.sheet_name,
    store_name: roster.store_name,
    store_code: roster.store_code,
    source_file_name: roster.source_file_name,
    custom_columns: roster.custom_columns,
    rows: roster.rows,
    updated_at: roster.updated_at,
    import_summary: roster.import_summary,
    effective_from: effectiveFrom,
    effective_to: effectiveTo,
    changed_at: changedAt,
  };
}

function buildShiftRosterChangeEvents(
  previous: ShiftRoster | null | undefined,
  next: ShiftRoster,
  effectiveFrom: string,
  changedAt: string
) {
  const events: ShiftRosterChangeEvent[] = [];
  const previousRows = new Map((previous?.rows || []).map((row) => [row.row_key, row]));
  const nextRows = new Map(next.rows.map((row) => [row.row_key, row]));
  const trackedFields: Array<keyof ShiftRow> = [
    "employee_name",
    "employee_code",
    "time_label",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "notes",
  ];

  next.rows.forEach((row) => {
    const prior = previousRows.get(row.row_key);
    if (!prior) {
      events.push({
        id: randomId(),
        sheet_name: next.sheet_name,
        row_key: row.row_key,
        employee_code: row.employee_code,
        employee_name: row.employee_name,
        week_label: row.week_label,
        field: "row",
        before: "",
        after: "added",
        change_type: "added",
        effective_from: effectiveFrom,
        changed_at: changedAt,
        source_file_name: next.source_file_name,
        store_name: next.store_name,
        store_code: next.store_code,
      });
      return;
    }

    trackedFields.forEach((field) => {
      const before = normalizeText(prior[field]);
      const after = normalizeText(row[field]);
      if (before === after) return;
      events.push({
        id: randomId(),
        sheet_name: next.sheet_name,
        row_key: row.row_key,
        employee_code: row.employee_code || prior.employee_code,
        employee_name: row.employee_name || prior.employee_name,
        week_label: row.week_label || prior.week_label,
        field: String(field),
        before,
        after,
        change_type: "updated",
        effective_from: effectiveFrom,
        changed_at: changedAt,
        source_file_name: next.source_file_name,
        store_name: next.store_name,
        store_code: next.store_code,
      });
    });
  });

  previousRows.forEach((row, rowKey) => {
    if (nextRows.has(rowKey)) return;
    events.push({
      id: randomId(),
      sheet_name: previous?.sheet_name || next.sheet_name,
      row_key: row.row_key,
      employee_code: row.employee_code,
      employee_name: row.employee_name,
      week_label: row.week_label,
      field: "row",
      before: "present",
      after: "removed",
      change_type: "removed",
      effective_from: effectiveFrom,
      changed_at: changedAt,
      source_file_name: next.source_file_name || previous?.source_file_name || "",
      store_name: next.store_name || previous?.store_name || "",
      store_code: next.store_code || previous?.store_code || "",
    });
  });

  return events;
}

function appendShiftRosterHistory(
  existingHistory: ShiftRosterHistoryEntry[],
  currentRoster: ShiftRoster | null | undefined,
  nextRoster: ShiftRoster,
  effectiveFrom: string,
  changedAt: string
) {
  const sameSheetHistory = existingHistory.filter((entry) => entry.sheet_name === nextRoster.sheet_name);
  const otherHistory = existingHistory.filter((entry) => entry.sheet_name !== nextRoster.sheet_name);
  const nextHistory = sameSheetHistory
    .filter((entry) => !(entry.effective_to === null && entry.effective_from === effectiveFrom))
    .map((entry) =>
      entry.effective_to === null
        ? {
            ...entry,
            effective_to: shiftDateKey(effectiveFrom, -1),
          }
        : entry
    );

  // When the very first version predates history support, seed it so earlier reports still resolve.
  if (currentRoster && sameSheetHistory.length === 0) {
    nextHistory.push(
      createShiftRosterHistoryEntry(currentRoster, "1900-01-01", shiftDateKey(effectiveFrom, -1), currentRoster.updated_at || changedAt)
    );
  }

  nextHistory.push(createShiftRosterHistoryEntry(nextRoster, effectiveFrom, null, changedAt));
  return mergeShiftRosterHistoryCollections(otherHistory, nextHistory);
}

function materializeRosterSnapshots(currentRosters: ShiftRoster[], historyEntries: ShiftRosterHistoryEntry[]) {
  const normalizedHistory = mergeShiftRosterHistoryCollections(historyEntries);
  const seededHistoryBaselines: ShiftRosterHistoryEntry[] = [];

  // Backfill legacy periods before history tracking began by extending the
  // earliest known snapshot back to 1900-01-01 for each sheet.
  const historyBySheet = new Map<string, ShiftRosterHistoryEntry[]>();
  normalizedHistory.forEach((entry) => {
    if (!historyBySheet.has(entry.sheet_name)) historyBySheet.set(entry.sheet_name, []);
    historyBySheet.get(entry.sheet_name)!.push(entry);
  });

  historyBySheet.forEach((entries) => {
    const sorted = [...entries].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
    const earliest = sorted[0];
    if (!earliest || earliest.effective_from <= "1900-01-01") return;

    seededHistoryBaselines.push({
      ...earliest,
      id: randomId(),
      snapshot_key: buildShiftRosterSnapshotKey(earliest.sheet_name, "1900-01-01"),
      effective_from: "1900-01-01",
      effective_to: shiftDateKey(earliest.effective_from, -1),
      changed_at: earliest.changed_at || earliest.updated_at || new Date().toISOString(),
    });
  });

  const openHistorySheets = new Set(
    normalizedHistory.filter((entry) => entry.effective_to === null).map((entry) => entry.sheet_name)
  );
  const fallbackSnapshots = currentRosters
    .filter((roster) => !openHistorySheets.has(roster.sheet_name))
    .map((roster) =>
      createShiftRosterHistoryEntry(roster, "1900-01-01", null, roster.updated_at || new Date().toISOString())
    );

  return mergeShiftRosterHistoryCollections(normalizedHistory, seededHistoryBaselines, fallbackSnapshots);
}

function normalizeKey(value: string) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function isBlankRow(values: unknown[]) {
  return values.every((value) => normalizeText(value) === "");
}

function parseTimeHours(timeLabel: string) {
  const normalized = normalizeText(timeLabel).toLowerCase();
  const match = normalized.match(/(\d{1,2})(?::(\d{2}))?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?/);
  if (!match) return null;

  const startHour = Number(match[1]);
  const startMinute = Number(match[2] || 0);
  const endHour = Number(match[3]);
  const endMinute = Number(match[4] || 0);

  const start = startHour + startMinute / 60;
  let end = endHour + endMinute / 60;
  if (end <= start) end += 12;
  if (end <= start) end += 12;
  const rawDuration = end - start;
  return Number(Math.max(0, rawDuration - 1).toFixed(1));
}

function buildExpectedHours(timeLabel: string): Record<ShiftDayKey, number> {
  const weekdayHours = parseTimeHours(timeLabel) ?? 7;
  return {
    monday: weekdayHours,
    tuesday: weekdayHours,
    wednesday: weekdayHours,
    thursday: weekdayHours,
    friday: weekdayHours,
    saturday: 6,
    sunday: 5.5,
  };
}

function parseHeaderRow(headerRow: unknown[]): ParsedSheetHeader {
  const normalized = headerRow.map((value, index) => ({
    value: normalizeText(value).toLowerCase(),
    index,
  }));

  const findIndex = (...candidates: string[]) => {
    for (const candidate of candidates) {
      const found = normalized.find((item) => item.value === candidate || item.value.includes(candidate));
      if (found) return found.index;
    }
    return -1;
  };

  const weekIndex = findIndex("week");
  const detectedNameIndex = findIndex("name", "employee name");
  const detectedDepartmentIndex = findIndex("department", "section", "role");
  const hrIndex = findIndex("hr");
  const codeIndex = findIndex("employee code", "code");
  const timeIndex = findIndex("time", "shift");
  const mondayIndex = findIndex("monday");
  const tuesdayIndex = findIndex("tuesday");
  const wednesdayIndex = findIndex("wednesday");
  const thursdayIndex = findIndex("thursday");
  const fridayIndex = findIndex("friday");
  const saturdayIndex = findIndex("saturday");
  const sundayIndex = findIndex("sunday");
  const notesIndex = findIndex("notes", "note");

  const dayIndexes = {
    monday: mondayIndex,
    tuesday: tuesdayIndex,
    wednesday: wednesdayIndex,
    thursday: thursdayIndex,
    friday: fridayIndex,
    saturday: saturdayIndex,
    sunday: sundayIndex,
  } as Record<ShiftDayKey, number>;

  const dayMax = Math.max(...DAY_ORDER.map((day) => dayIndexes[day]).filter((index) => index >= 0), -1);

  // Check if this looks like a header row or raw data
  const hasHeaders = weekIndex >= 0 || mondayIndex >= 0 || detectedNameIndex >= 0;
  
  // If no headers detected, use fixed column positions based on the actual format:
  // Column 0: WEEK | Column 1: NAME | Column 2: SHARED | Column 3: TYPE | Column 4: CODE | Column 5-11: MON-SUN | Column 12+: EXTRAS
  let finalWeekIndex: number;
  let finalNameIndex: number;
  let finalCodeIndex: number;
  let finalDepartmentIndex: number;
  let finalTimeIndex: number;

  if (hasHeaders) {
    // Use detected positions
    finalWeekIndex = weekIndex;
    finalNameIndex = detectedNameIndex >= 0 ? detectedNameIndex : 1;
    finalDepartmentIndex = detectedDepartmentIndex >= 0 ? detectedDepartmentIndex : 2;
    finalCodeIndex = codeIndex;
    finalTimeIndex = timeIndex;
  } else {
    // Use fixed positions for raw data format
    finalWeekIndex = 0;      // WEEK column
    finalNameIndex = 1;      // Employee name
    finalDepartmentIndex = 2; // Shared/Department
    finalCodeIndex = 4;      // Employee code
    finalTimeIndex = -1;     // No dedicated time column in this format
  }

  const hiddenExtraColumnKeys = new Set(["store", "rep", "terminated", "status", "company", "shared", "type", "b"]);
  const extraIndexes = headerRow
    .map((value, index) => ({ value: normalizeText(value), index }))
    .filter(({ index }) => index > dayMax && index !== notesIndex && index !== weekIndex && index !== detectedNameIndex && index !== detectedDepartmentIndex && index !== hrIndex && index !== codeIndex && index !== timeIndex)
    .filter(({ value }) => value !== "")
    .map(({ value, index }) => ({ index, key: normalizeKey(value) || `extra_${index}` }))
    .filter(({ key }) => !hiddenExtraColumnKeys.has(key));

  return {
    weekIndex: finalWeekIndex,
    nameIndex: finalNameIndex,
    departmentIndex: finalDepartmentIndex,
    hrIndex: finalCodeIndex, // Using code index as HR
    codeIndex: finalCodeIndex,
    timeIndex: finalTimeIndex,
    dayIndexes,
    notesIndex,
    extraIndexes,
  };
}

function textAt(row: unknown[], index: number) {
  if (index < 0 || index >= row.length) return "";
  return normalizeText(row[index]);
}

function buildGroupKey(sheetName: string, slotIndex: number) {
  return `${normalizeKey(sheetName)}_slot_${slotIndex + 1}`;
}

function parseWeekNumber(value: string) {
  const match = normalizeText(value).match(/week\s*(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function mergeRow(existing: ShiftRow | undefined, incoming: ShiftRow, source: "import" | "merge" = "import") {
  if (!existing) {
    return {
      ...incoming,
      logs: incoming.logs.length > 0 ? incoming.logs : [],
    };
  }

  const fields: Array<keyof ShiftRow> = [
    "employee_name",
    "employee_code",
    "department",
    "hr",
    "time_label",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "notes",
  ];

  const mergedLogs = [...existing.logs];
  const merged: ShiftRow = {
    ...existing,
    ...incoming,
    extra_columns: { ...existing.extra_columns, ...incoming.extra_columns },
    expected_hours: incoming.expected_hours,
    logs: mergedLogs,
  };

  for (const field of fields) {
    const before = normalizeText(existing[field]);
    const after = normalizeText(incoming[field]);
    if (after !== "" && before !== after) {
      merged[field] = after as never;
      mergedLogs.push({
        id: randomId(),
        timestamp: new Date().toISOString(),
        source,
        field,
        before,
        after,
        note: "Merged from imported shift sheet",
      });
    }
  }

  return merged;
}

function parseSheetRows(sheet: XLSX.WorkSheet, sheetName: string, sourceFileName: string): ShiftRoster {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
  const headerRow = (rows[0] || []) as unknown[];
  const header = parseHeaderRow(headerRow);
  
  // Check if first cell looks like a header label (not a store name)
  const firstCell = normalizeText(headerRow[0]).toLowerCase();
  const looksLikeHeaderLabel = /^(run\s*date|week|employee|date|no\.?|name|store|branch|section|department|code)/i.test(firstCell);
  
  // Use first cell as title only if it looks like a store name (starts with number or specific keywords)
  const looksLikeStoreName = /^\d+\s|^checkers|^shoprite|^game|^cna|^pick/i.test(firstCell);
  const title = (!looksLikeHeaderLabel || looksLikeStoreName) && firstCell ? normalizeText(headerRow[0]) : sheetName;
  const storeCode = (title.match(/^(\d+)/)?.[1] || "").trim();
  const storeName = looksLikeHeaderLabel && !looksLikeStoreName ? sheetName : title;
  const rowMap = new Map<string, ShiftRow>();
  const customColumnSet = new Set<string>();
  let importedRows = 0;
  let currentWeekNumber = 0;
  let currentWeekLabel = "";
  let currentWeekSlotIndex = -1;

  // Check if first row is a header or raw data
  const firstRowText = textAt(headerRow, 0).toUpperCase();
  const isRawData = /^WEEK\s*\d+/i.test(firstRowText);
  
  // For raw data format:
  // Column 0: WEEK | Column 1: NAME | Column 2: DEPT | Column 3: HR | Column 4: CODE | Column 5: TIME | Column 6-12: MON-SUN | Column 13+: EXTRAS
  const FIXED_RAW_COLUMNS = {
    week: 0,
    name: 1,
    department: 2,
    hr: 3,
    code: 4,
    time: 5,
    monday: 6,
    tuesday: 7,
    wednesday: 8,
    thursday: 9,
    friday: 10,
    saturday: 11,
    sunday: 12,
  };

  // Determine if we need to use fixed columns or header-based parsing
  const useFixedColumns = isRawData && header.weekIndex === 0 && header.nameIndex === 1;
  
  const startRowIndex = isRawData ? 0 : 1;

  for (let rowIndex = startRowIndex; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] as unknown[];
    if (!row || isBlankRow(row)) {
      currentWeekSlotIndex = -1;
      continue;
    }

    let rawWeekLabel: string;
    let employeeName: string;
    let department: string;
    let employeeCode: string;
    let monday: string;
    let tuesday: string;
    let wednesday: string;
    let thursday: string;
    let friday: string;
    let saturday: string;
    let sunday: string;

    let hrValue = "";
    if (useFixedColumns) {
      rawWeekLabel = textAt(row, FIXED_RAW_COLUMNS.week);
      employeeName = textAt(row, FIXED_RAW_COLUMNS.name);
      department = textAt(row, FIXED_RAW_COLUMNS.department);
      hrValue = textAt(row, FIXED_RAW_COLUMNS.hr);
      employeeCode = textAt(row, FIXED_RAW_COLUMNS.code);
      monday = textAt(row, FIXED_RAW_COLUMNS.monday);
      tuesday = textAt(row, FIXED_RAW_COLUMNS.tuesday);
      wednesday = textAt(row, FIXED_RAW_COLUMNS.wednesday);
      thursday = textAt(row, FIXED_RAW_COLUMNS.thursday);
      friday = textAt(row, FIXED_RAW_COLUMNS.friday);
      saturday = textAt(row, FIXED_RAW_COLUMNS.saturday);
      sunday = textAt(row, FIXED_RAW_COLUMNS.sunday);
    } else {
      rawWeekLabel = textAt(row, header.weekIndex >= 0 ? header.weekIndex : 0);
      employeeName = textAt(row, header.nameIndex);
      department = textAt(row, header.departmentIndex);
      hrValue = header.hrIndex >= 0 ? textAt(row, header.hrIndex) : "";
      employeeCode = textAt(row, header.codeIndex);
      monday = textAt(row, header.dayIndexes.monday);
      tuesday = textAt(row, header.dayIndexes.tuesday);
      wednesday = textAt(row, header.dayIndexes.wednesday);
      thursday = textAt(row, header.dayIndexes.thursday);
      friday = textAt(row, header.dayIndexes.friday);
      saturday = textAt(row, header.dayIndexes.saturday);
      sunday = textAt(row, header.dayIndexes.sunday);
    }

    if (!employeeName && !employeeCode && !normalizeText(monday) && !normalizeText(tuesday) && !normalizeText(wednesday) && !normalizeText(thursday) && !normalizeText(friday) && !normalizeText(saturday) && !normalizeText(sunday)) {
      continue;
    }

    const parsedWeekNumber = parseWeekNumber(rawWeekLabel);
    if (parsedWeekNumber) {
      currentWeekNumber = parsedWeekNumber;
      currentWeekLabel = rawWeekLabel || `WEEK ${parsedWeekNumber}`;
      currentWeekSlotIndex = 0;
    } else if (currentWeekNumber) {
      currentWeekSlotIndex += 1;
    } else {
      currentWeekNumber = 1;
      currentWeekLabel = "WEEK 1";
      currentWeekSlotIndex = rowIndex;
    }

    const weekNumber = currentWeekNumber;
    const timeLabel = useFixedColumns
      ? textAt(row, FIXED_RAW_COLUMNS.time)
      : textAt(row, header.timeIndex >= 0 ? header.timeIndex : 12);

    if (!employeeName) {
      employeeName = employeeCode ? `${employeeCode}` : `${department || "Shift"} ${timeLabel || ""} W${weekNumber} R${rowIndex}`;
    }

    const notes = textAt(row, header.notesIndex);
    const expectedHours = buildExpectedHours(timeLabel || monday || "7-3");

    const extraColumns: Record<string, string> = {};
    if (useFixedColumns) {
      for (let colIndex = 13; colIndex < row.length; colIndex++) {
        const value = textAt(row, colIndex);
        if (value) {
          const key = `extra_${colIndex}`;
          extraColumns[key] = value;
          customColumnSet.add(key);
        }
      }
    } else {
      // Use header-based extra columns
      header.extraIndexes.forEach(({ index, key }) => {
        const value = textAt(row, index);
        if (value !== "") {
          extraColumns[key] = value;
          customColumnSet.add(key);
        }
      });
    }

    const groupKey = buildGroupKey(sheetName, currentWeekSlotIndex);
    // Use employee code + name + week as unique key to prevent collisions across employees
    const normalizedName = employeeName.replace(/\s+/g, "_").toLowerCase();
    const rowKey = `${employeeCode}_${normalizedName}_w${weekNumber}`;

    const incoming: ShiftRow = {
      id: randomId(),
      row_key: rowKey,
      group_key: groupKey,
      week_number: weekNumber,
      week_label: currentWeekLabel || `WEEK ${weekNumber}`,
      order_index: rowIndex,
      employee_name: employeeName,
      employee_code: employeeCode,
      department,
      hr: hrValue,
      time_label: timeLabel,
      monday,
      tuesday,
      wednesday,
      thursday,
      friday,
      saturday,
      sunday,
      notes,
      expected_hours: expectedHours,
      extra_columns: extraColumns,
      logs: [
        {
          id: randomId(),
          timestamp: new Date().toISOString(),
          source: "import",
          field: "import",
          before: "",
          after: "row loaded",
          note: "Imported from workbook",
        },
      ],
    };

    const existing = rowMap.get(rowKey);
    rowMap.set(rowKey, mergeRow(existing, incoming, "merge"));
    importedRows += 1;
  }

  const rowsList = Array.from(rowMap.values()).sort((a, b) => a.week_number - b.week_number || a.order_index - b.order_index);

  return {
    id: randomId(),
    sheet_name: sheetName,
    store_name: storeName,
    store_code: storeCode,
    source_file_name: sourceFileName,
    custom_columns: Array.from(customColumnSet).sort(),
    rows: rowsList,
    updated_at: new Date().toISOString(),
    import_summary: {
      imported_rows: importedRows,
      updated_rows: 0,
      preserved_rows: 0,
    },
  };
}

export function parseShiftWorkbook(buffer: ArrayBuffer, sourceFileName: string): ShiftRoster[] {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  return workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    return parseSheetRows(sheet, sheetName, sourceFileName);
  }).filter((roster) => roster.rows.length > 0);
}

export function mergeShiftRosters(existing: ShiftRoster | null | undefined, incoming: ShiftRoster): ShiftRoster {
  if (!existing) {
    return incoming;
  }

  const manualRows = existing.rows.filter((row) => row.group_key.includes("_blank_"));
  const existingMap = new Map(manualRows.map((row) => [row.row_key, row]));
  const mergedRows: ShiftRow[] = [];
  let updatedRows = 0;

  for (const incomingRow of incoming.rows) {
    const prior = existingMap.get(incomingRow.row_key);
    const mergedRow = mergeRow(prior, incomingRow, "merge");
    if (prior) {
      const changed = JSON.stringify(prior) !== JSON.stringify(mergedRow);
      if (changed) updatedRows += 1;
    }
    mergedRows.push(mergedRow);
    existingMap.delete(incomingRow.row_key);
  }

  for (const remaining of existingMap.values()) {
    mergedRows.push(remaining);
  }

  mergedRows.sort((a, b) => a.week_number - b.week_number || a.order_index - b.order_index);

  return {
    ...existing,
    sheet_name: incoming.sheet_name,
    store_name: incoming.store_name,
    store_code: incoming.store_code,
    source_file_name: incoming.source_file_name,
    custom_columns: Array.from(new Set([...existing.custom_columns, ...incoming.custom_columns])).sort(),
    rows: mergedRows,
    updated_at: new Date().toISOString(),
    import_summary: {
      imported_rows: incoming.import_summary.imported_rows,
      updated_rows: updatedRows,
      preserved_rows: mergedRows.length - incoming.rows.length,
    },
  };
}

export async function initializeShiftDatabase(): Promise<boolean> {
  try {
    const isAvailable = await checkRemoteShiftTableAvailability();
    if (!isAvailable) {
      console.warn("Shift database initialization warning:", SHIFT_REMOTE_SETUP_HINT);
    }
    return isAvailable;
  } catch (err) {
    console.warn("Shift database init warning:", getShiftStorageErrorMessage(err));
    return false;
  }
}

export async function getShiftRosters(): Promise<ShiftRoster[]> {
  const localRosters = loadLocalShiftRosters();
  const hasActiveLinks = await hasActiveShiftSyncLinks();

  // Always return local rosters if they exist (from manual imports or prior syncs).
  // Only attempt remote fetch if sync links are configured AND Supabase is available.
  if (!hasActiveLinks || !isSupabaseConfigured) {
    return localRosters;
  }

  try {
    const { data, error } = await supabase
      .from("shift_rosters")
      .select("id, sheet_name, store_name, store_code, source_file_name, payload, updated_at")
      .order("updated_at", { ascending: false });

    if (error) {
      console.warn("Get shift rosters warning:", getShiftStorageErrorMessage(error));
      return localRosters;
    }

    const remoteRosters = ((data || []) as RemoteShiftRosterRecord[]).map((item) => {
      const payload = item.payload || {};
      return {
        id: item.id,
        sheet_name: item.sheet_name,
        store_name: item.store_name,
        store_code: item.store_code || "",
        source_file_name: item.source_file_name || "",
        custom_columns: payload.custom_columns || [],
        rows: payload.rows || [],
        updated_at: item.updated_at,
        import_summary: payload.import_summary || {
          imported_rows: 0,
          updated_rows: 0,
          preserved_rows: 0,
        },
      } as ShiftRoster;
    });

    if (remoteRosters.length > 0) {
      // Merge: remote rosters take priority, but preserve any local-only sheets
      const remoteSheetNames = new Set(remoteRosters.map((r) => r.sheet_name));
      const localOnly = localRosters.filter((r) => !remoteSheetNames.has(r.sheet_name));
      const merged = [...remoteRosters, ...localOnly];
      saveLocalShiftRosters(merged);
      return merged;
    }

    return localRosters;
  } catch (err) {
    console.warn("Get shift rosters warning:", getShiftStorageErrorMessage(err));
    return localRosters;
  }
}

export async function getShiftRosterHistory(): Promise<ShiftRosterHistoryEntry[]> {
  const localHistory = mergeShiftRosterHistoryCollections(loadLocalShiftRosterHistory());

  if (!isSupabaseConfigured) {
    return localHistory;
  }

  try {
    const { data, error } = await supabase
      .from("shift_roster_history")
      .select("id, snapshot_key, sheet_name, store_name, store_code, source_file_name, effective_from, effective_to, changed_at, updated_at, payload")
      .order("changed_at", { ascending: false });

    if (error) {
      console.warn("Get shift roster history warning:", getShiftStorageErrorMessage(error));
      return localHistory;
    }

    const remoteHistory = ((data || []) as RemoteShiftRosterHistoryRecord[]).map((item) =>
      normalizeShiftRosterHistoryEntry({
        id: item.id,
        snapshot_key: item.snapshot_key,
        sheet_name: item.sheet_name,
        store_name: item.store_name,
        store_code: item.store_code || "",
        source_file_name: item.source_file_name || "",
        custom_columns: item.payload?.custom_columns || [],
        rows: item.payload?.rows || [],
        updated_at: item.updated_at || item.changed_at,
        import_summary: item.payload?.import_summary || {
          imported_rows: 0,
          updated_rows: 0,
          preserved_rows: 0,
        },
        effective_from: item.effective_from,
        effective_to: item.effective_to,
        changed_at: item.changed_at,
      })
    );

    const merged = mergeShiftRosterHistoryCollections(localHistory, remoteHistory);
    saveLocalShiftRosterHistory(merged);
    return merged;
  } catch (err) {
    console.warn("Get shift roster history warning:", getShiftStorageErrorMessage(err));
    return localHistory;
  }
}

export async function getShiftRosterChangeEvents(): Promise<ShiftRosterChangeEvent[]> {
  const localEvents = mergeShiftRosterChangeEventCollections(loadLocalShiftRosterChangeEvents());

  if (!isSupabaseConfigured) {
    return localEvents;
  }

  try {
    const { data, error } = await supabase
      .from("shift_roster_change_events")
      .select("id, sheet_name, row_key, employee_code, employee_name, week_label, field, before_value, after_value, change_type, effective_from, changed_at, source_file_name, store_name, store_code")
      .order("changed_at", { ascending: false });

    if (error) {
      console.warn("Get shift roster change events warning:", getShiftStorageErrorMessage(error));
      return localEvents;
    }

    const remoteEvents = ((data || []) as RemoteShiftRosterChangeEventRecord[]).map((item) =>
      normalizeShiftRosterChangeEvent({
        id: item.id,
        sheet_name: item.sheet_name,
        row_key: item.row_key,
        employee_code: item.employee_code || "",
        employee_name: item.employee_name || "",
        week_label: item.week_label || "",
        field: item.field,
        before: item.before_value || "",
        after: item.after_value || "",
        change_type: item.change_type,
        effective_from: item.effective_from,
        changed_at: item.changed_at,
        source_file_name: item.source_file_name || "",
        store_name: item.store_name || "",
        store_code: item.store_code || "",
      })
    );

    const merged = mergeShiftRosterChangeEventCollections(localEvents, remoteEvents);
    saveLocalShiftRosterChangeEvents(merged);
    return merged;
  } catch (err) {
    console.warn("Get shift roster change events warning:", getShiftStorageErrorMessage(err));
    return localEvents;
  }
}

export async function upsertShiftRoster(roster: ShiftRoster): Promise<{ success: boolean; error?: string }> {
  const localRosters = loadLocalShiftRosters();
  const currentRoster = localRosters.find((item) => item.sheet_name === roster.sheet_name);
  const changedAt = new Date().toISOString();
  const effectiveFrom = formatDateOnly(new Date());
  const mergedLocal = [
    ...localRosters.filter((item) => item.sheet_name !== roster.sheet_name),
    {
      ...roster,
      updated_at: changedAt,
    },
  ].sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  saveLocalShiftRosters(mergedLocal);
  saveLocalShiftRosterHistory(
    appendShiftRosterHistory(loadLocalShiftRosterHistory(), currentRoster, {
      ...roster,
      updated_at: changedAt,
    }, effectiveFrom, changedAt)
  );
  saveLocalShiftRosterChangeEvents(
    mergeShiftRosterChangeEventCollections(
      loadLocalShiftRosterChangeEvents(),
      buildShiftRosterChangeEvents(currentRoster, {
        ...roster,
        updated_at: changedAt,
      }, effectiveFrom, changedAt)
    )
  );

  if (!isSupabaseConfigured) {
    return { success: true };
  }

  try {
    await supabase
      .from("shift_roster_history")
      .delete()
      .eq("sheet_name", roster.sheet_name)
      .eq("effective_from", effectiveFrom)
      .is("effective_to", null);

    await supabase
      .from("shift_roster_history")
      .update({ effective_to: shiftDateKey(effectiveFrom, -1) })
      .eq("sheet_name", roster.sheet_name)
      .is("effective_to", null);

    const { error } = await supabase.from("shift_rosters").upsert(
      {
        sheet_name: roster.sheet_name,
        store_name: roster.store_name,
        store_code: roster.store_code,
        source_file_name: roster.source_file_name,
        payload: {
          custom_columns: roster.custom_columns,
          rows: roster.rows,
          import_summary: roster.import_summary,
        },
        updated_at: changedAt,
      },
      { onConflict: "sheet_name" }
    );

    if (error) {
      const message = getShiftStorageErrorMessage(error);
      console.warn("Upsert shift roster warning:", message);
      return { success: true, error: message };
    }

    const { error: historyError } = await supabase.from("shift_roster_history").insert({
      snapshot_key: buildShiftRosterSnapshotKey(roster.sheet_name, effectiveFrom),
      sheet_name: roster.sheet_name,
      store_name: roster.store_name,
      store_code: roster.store_code,
      source_file_name: roster.source_file_name,
      effective_from: effectiveFrom,
      effective_to: null,
      changed_at: changedAt,
      updated_at: changedAt,
      payload: {
        custom_columns: roster.custom_columns,
        rows: roster.rows,
        import_summary: roster.import_summary,
      },
    });

    if (historyError) {
      const message = getShiftStorageErrorMessage(historyError);
      console.warn("Upsert shift roster history warning:", message);
      return { success: true, error: message };
    }

    const changeEvents = buildShiftRosterChangeEvents(currentRoster, { ...roster, updated_at: changedAt }, effectiveFrom, changedAt);
    if (changeEvents.length > 0) {
      const { error: changeEventError } = await supabase.from("shift_roster_change_events").insert(
        changeEvents.map((entry) => ({
          id: entry.id,
          sheet_name: entry.sheet_name,
          row_key: entry.row_key,
          employee_code: entry.employee_code,
          employee_name: entry.employee_name,
          week_label: entry.week_label,
          field: entry.field,
          before_value: entry.before,
          after_value: entry.after,
          change_type: entry.change_type,
          effective_from: entry.effective_from,
          changed_at: entry.changed_at,
          source_file_name: entry.source_file_name,
          store_name: entry.store_name,
          store_code: entry.store_code,
        }))
      );

      if (changeEventError) {
        const message = getShiftStorageErrorMessage(changeEventError);
        console.warn("Upsert shift roster change events warning:", message);
        return { success: true, error: message };
      }
    }

    return { success: true };
  } catch (err) {
    const message = getShiftStorageErrorMessage(err);
    console.warn("Upsert shift roster warning:", message);
    return {
      success: true,
      error: message,
    };
  }
}

export async function upsertShiftRosters(rosters: ShiftRoster[]): Promise<{ success: boolean; error?: string }> {
  for (const roster of rosters) {
    const result = await upsertShiftRoster(roster);
    if (!result.success) return result;
  }

  return { success: true };
}

export function buildHistoricalRosterStatusLookup(
  shiftRosters: ShiftRoster[],
  historyEntries: ShiftRosterHistoryEntry[],
  dateValue: string
) {
  const lookup = new Map<string, ShiftRosterLookupValue>();
  const selectedDate = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(selectedDate.getTime())) return lookup;

  const dateKey = formatDateOnly(selectedDate);
  const weekLabel = getWeekCycleLabel(selectedDate).toUpperCase();
  const dayKey = getShiftDayKeyForDate(selectedDate);
  const snapshots = materializeRosterSnapshots(shiftRosters, historyEntries).filter((entry) =>
    isDateWithinEffectiveRange(dateKey, entry.effective_from, entry.effective_to)
  );

  snapshots.forEach((snapshot) => {
    snapshot.rows.forEach((row) => {
      if (String(row.week_label || "").trim().toUpperCase() !== weekLabel) return;
      const employeeCode = normalizeEmployeeCode(row.employee_code);
      if (!employeeCode) return;

      const rawValue = String(row[dayKey] || "").trim();
      if (!rawValue) return;

      const normalizedValue = rawValue.toUpperCase();
      const isDayOff = normalizedValue === "OFF" || normalizedValue === "OFF DAY";
      const isLeave = /\b(AL|SL|LEAVE|ANNUAL LEAVE|SICK LEAVE)\b/.test(normalizedValue);
      const scheduled = !isDayOff && !isLeave;
      const current = lookup.get(employeeCode);

      lookup.set(employeeCode, {
        scheduled: Boolean(current?.scheduled || scheduled),
        dayOff: Boolean(current?.dayOff || isDayOff),
        leave: Boolean(current?.leave || isLeave),
        store: current?.store || snapshot.store_name || "",
        storeCode: current?.storeCode || snapshot.store_code || "",
        sourceSheetName: current?.sourceSheetName || snapshot.sheet_name,
        effectiveFrom: current?.effectiveFrom || snapshot.effective_from,
        effectiveTo: current?.effectiveTo ?? snapshot.effective_to,
        changedAt: current?.changedAt || snapshot.changed_at,
      });
    });
  });

  return lookup;
}

export function buildHistoricalRosterStatusLookupsForRange(
  shiftRosters: ShiftRoster[],
  historyEntries: ShiftRosterHistoryEntry[],
  startDate: Date,
  endDate: Date
) {
  const lookups = new Map<string, Map<string, ShiftRosterLookupValue>>();
  const cursor = new Date(startDate);

  while (cursor <= endDate) {
    const dateKey = formatDateOnly(cursor);
    lookups.set(dateKey, buildHistoricalRosterStatusLookup(shiftRosters, historyEntries, dateKey));
    cursor.setDate(cursor.getDate() + 1);
  }

  return lookups;
}

export function buildHistoricalRosterSources(
  shiftRosters: ShiftRoster[],
  historyEntries: ShiftRosterHistoryEntry[]
) {
  const sources = new Map<string, HistoricalRosterSource[]>();
  const snapshots = materializeRosterSnapshots(shiftRosters, historyEntries);

  snapshots.forEach((snapshot) => {
    const grouped = new Map<string, HistoricalRosterSource>();

    snapshot.rows.forEach((row) => {
      const employeeCode = normalizeEmployeeCode(row.employee_code);
      if (!employeeCode) return;

      if (!grouped.has(employeeCode)) {
        grouped.set(employeeCode, {
          sheetName: snapshot.sheet_name,
          storeName: snapshot.store_name || snapshot.sheet_name,
          storeCode: snapshot.store_code || "",
          weekRows: new Map<number, ShiftRow>(),
          effectiveFrom: snapshot.effective_from,
          effectiveTo: snapshot.effective_to,
          changedAt: snapshot.changed_at,
        });
      }

      grouped.get(employeeCode)!.weekRows.set(row.week_number, row);
    });

    grouped.forEach((source, employeeCode) => {
      if (!sources.has(employeeCode)) sources.set(employeeCode, []);
      sources.get(employeeCode)!.push(source);
    });
  });

  sources.forEach((items, employeeCode) => {
    sources.set(
      employeeCode,
      [...items].sort((a, b) => {
        if (a.effectiveFrom !== b.effectiveFrom) return b.effectiveFrom.localeCompare(a.effectiveFrom);
        return b.changedAt.localeCompare(a.changedAt);
      })
    );
  });

  return sources;
}

export function matchHistoricalRosterSourceForDate(
  employee: Pick<ShiftRow, "employee_code"> | { store?: string; store_code?: string } | null | undefined,
  sources: HistoricalRosterSource[],
  dateKey: string
) {
  const candidates = sources.filter((source) => isDateWithinEffectiveRange(dateKey, source.effectiveFrom, source.effectiveTo));
  if (candidates.length === 0) return null;

  const employeeWithStore = (employee || {}) as { store?: string; store_code?: string };
  const employeeStoreCode = normalizeText(employeeWithStore.store_code).toLowerCase();
  const employeeStore = normalizeText(employeeWithStore.store).toLowerCase();

  return (
    candidates.find((source) => employeeStoreCode && normalizeText(source.storeCode).toLowerCase() === employeeStoreCode) ||
    candidates.find((source) => employeeStore && normalizeText(source.storeName).toLowerCase() === employeeStore) ||
    candidates[0] ||
    null
  );
}

export function createBlankShiftGroup(sheetName: string, storeName: string): ShiftRoster {
  const rows: ShiftRow[] = Array.from({ length: 4 }).flatMap((_, index) => {
    const weekNumber = index + 1;
    const groupKey = `${normalizeKey(sheetName)}_blank_${weekNumber}_${randomId().slice(0, 6)}`;
    return [{
      id: randomId(),
      row_key: `${groupKey}_w${weekNumber}`,
      group_key: groupKey,
      week_number: weekNumber,
      week_label: `WEEK ${weekNumber}`,
      order_index: index,
      employee_name: "",
      employee_code: "",
      department: "Shared",
      hr: "B",
      time_label: "8-4",
      monday: "X",
      tuesday: "X",
      wednesday: "X",
      thursday: "X",
      friday: "X",
      saturday: "8-3",
      sunday: "8-2:30",
      notes: "",
      expected_hours: buildExpectedHours("8-4"),
      extra_columns: {},
      logs: [],
    }];
  });

  return {
    id: randomId(),
    sheet_name: sheetName,
    store_name: storeName,
    store_code: "",
    source_file_name: "",
    custom_columns: [],
    rows,
    updated_at: new Date().toISOString(),
    import_summary: {
      imported_rows: 4,
      updated_rows: 0,
      preserved_rows: 0,
    },
  };
}
