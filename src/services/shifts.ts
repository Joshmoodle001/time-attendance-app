import * as XLSX from "xlsx";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
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
const SHIFT_REMOTE_SETUP_HINT =
  "Remote shift table is not set up yet. Run setup-database.ps1 or the SQL in supabase-setup.sql to create the Supabase schema. Shifts are still being saved locally in this browser.";

let shiftRemoteSetupAvailable: boolean | null = null;
let shiftRemoteSetupCheck: Promise<boolean> | null = null;

function randomId() {
  return globalThis.crypto?.randomUUID?.() ?? `shift_${Math.random().toString(36).slice(2)}_${Date.now()}`;
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
  const title = normalizeText(headerRow[0]) || sheetName;
  const storeCode = (title.match(/^(\d+)/)?.[1] || "").trim();
  const storeName = title;
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
  // Column 0: WEEK | Column 1: NAME | Column 2: SHARED | Column 3: TYPE | Column 4: CODE | Column 5-11: MON-SUN | Column 12+: EXTRAS
  const FIXED_RAW_COLUMNS = {
    week: 0,
    name: 1,
    department: 2,  // Shared
    code: 4,       // Employee code
    monday: 5,
    tuesday: 6,
    wednesday: 7,
    thursday: 8,
    friday: 9,
    saturday: 10,
    sunday: 11,
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

    if (useFixedColumns) {
      // Use fixed column positions for raw data
      rawWeekLabel = textAt(row, FIXED_RAW_COLUMNS.week);
      employeeName = textAt(row, FIXED_RAW_COLUMNS.name);
      department = textAt(row, FIXED_RAW_COLUMNS.department);
      employeeCode = textAt(row, FIXED_RAW_COLUMNS.code);
      monday = textAt(row, FIXED_RAW_COLUMNS.monday);
      tuesday = textAt(row, FIXED_RAW_COLUMNS.tuesday);
      wednesday = textAt(row, FIXED_RAW_COLUMNS.wednesday);
      thursday = textAt(row, FIXED_RAW_COLUMNS.thursday);
      friday = textAt(row, FIXED_RAW_COLUMNS.friday);
      saturday = textAt(row, FIXED_RAW_COLUMNS.saturday);
      sunday = textAt(row, FIXED_RAW_COLUMNS.sunday);
    } else {
      // Use header-based parsing
      rawWeekLabel = textAt(row, header.weekIndex >= 0 ? header.weekIndex : 0);
      employeeName = textAt(row, header.nameIndex);
      department = textAt(row, header.departmentIndex);
      employeeCode = textAt(row, header.codeIndex);
      monday = textAt(row, header.dayIndexes.monday);
      tuesday = textAt(row, header.dayIndexes.tuesday);
      wednesday = textAt(row, header.dayIndexes.wednesday);
      thursday = textAt(row, header.dayIndexes.thursday);
      friday = textAt(row, header.dayIndexes.friday);
      saturday = textAt(row, header.dayIndexes.saturday);
      sunday = textAt(row, header.dayIndexes.sunday);
    }

    // Skip if no employee name
    if (!employeeName) {
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
      // If no week detected and no current week, use row as-is with week 1
      currentWeekNumber = 1;
      currentWeekLabel = "WEEK 1";
      currentWeekSlotIndex = rowIndex;
    }

    const weekNumber = currentWeekNumber;
    const timeLabel = textAt(row, header.timeIndex >= 0 ? header.timeIndex : 12); // Column M if exists
    const notes = textAt(row, header.notesIndex);
    const expectedHours = buildExpectedHours(timeLabel || monday || "7-3");

    const extraColumns: Record<string, string> = {};
    if (useFixedColumns) {
      // Collect extra columns from column 12 onwards
      for (let colIndex = 12; colIndex < row.length; colIndex++) {
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
      hr: "",
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

export async function upsertShiftRoster(roster: ShiftRoster): Promise<{ success: boolean; error?: string }> {
  const localRosters = loadLocalShiftRosters();
  const mergedLocal = [
    ...localRosters.filter((item) => item.sheet_name !== roster.sheet_name),
    {
      ...roster,
      updated_at: new Date().toISOString(),
    },
  ].sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  saveLocalShiftRosters(mergedLocal);

  if (!isSupabaseConfigured) {
    return { success: true };
  }

  try {
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
        updated_at: new Date().toISOString(),
      },
      { onConflict: "sheet_name" }
    );

    if (error) {
      const message = getShiftStorageErrorMessage(error);
      console.warn("Upsert shift roster warning:", message);
      return { success: true, error: message };
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
