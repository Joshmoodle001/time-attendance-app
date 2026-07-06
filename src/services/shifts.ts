import * as XLSX from "xlsx";
import { loadShiftSyncSettings } from "@/services/shiftSync";

export const SHIFT_ROSTERS_UPDATED_EVENT = "shift-rosters-updated";

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

export type ShiftImportSummary = {
  imported_rows: number;
  updated_rows: number;
  preserved_rows: number;
};

export type ShiftRosterSnapshot = {
  effective_date: string;
  captured_at: string;
  source_file_name: string;
  custom_columns: string[];
  rows: ShiftRow[];
  import_summary: ShiftImportSummary;
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
  import_summary: ShiftImportSummary;
  history?: ShiftRosterSnapshot[];
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
    import_summary?: Partial<ShiftImportSummary>;
    history?: ShiftRosterSnapshot[];
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

type SheetLayout = {
  title: string;
  header: ParsedSheetHeader;
  startRowIndex: number;
  useFixedColumns: boolean;
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
} as const;
const SHIFT_ROSTER_STORAGE_KEY = "shift-rosters-cache-v1";

function randomId() {
  return globalThis.crypto?.randomUUID?.() ?? `shift_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

function loadLocalShiftRosters(): ShiftRoster[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(SHIFT_ROSTER_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ShiftRoster[];
    return Array.isArray(parsed) ? parsed.map((roster) => materializeRosterWithHistory(roster)) : [];
  } catch (error) {
    console.error("Load local shift rosters error:", error);
    return [];
  }
}

function saveLocalShiftRosters(rosters: ShiftRoster[]) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(SHIFT_ROSTER_STORAGE_KEY, JSON.stringify(rosters));
    window.dispatchEvent(new CustomEvent(SHIFT_ROSTERS_UPDATED_EVENT, { detail: rosters }));
  } catch (error) {
    console.error("Save local shift rosters error:", error);
  }
}

async function hasActiveShiftSyncLinks() {
  try {
    const settings = await loadShiftSyncSettings();
    return Boolean(settings.sections.some((section) => normalizeText(section.url)));
  } catch {
    return false;
  }
}

function normalizeText(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function normalizeKey(value: string) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function isLegacySyntheticShiftName(row: Pick<ShiftRow, "employee_name" | "employee_code" | "department" | "time_label" | "week_number" | "order_index">) {
  const employeeName = normalizeText(row.employee_name);
  if (!employeeName || normalizeText(row.employee_code)) return false;

  const department = normalizeText(row.department) || "Shift";
  const timeLabel = normalizeText(row.time_label);
  const weekNumber = Number(row.week_number || 0);
  const orderIndex = Number(row.order_index);
  if (!weekNumber || !Number.isFinite(orderIndex)) return false;

  const candidates = [
    normalizeText(`${department} ${timeLabel} W${weekNumber} R${orderIndex}`),
    normalizeText(`${department} W${weekNumber} R${orderIndex}`),
    normalizeText(`Shift ${timeLabel} W${weekNumber} R${orderIndex}`),
    normalizeText(`Shift W${weekNumber} R${orderIndex}`),
  ];

  return candidates.includes(employeeName);
}

function sanitizeShiftRow(row: ShiftRow): ShiftRow {
  if (!isLegacySyntheticShiftName(row)) {
    return row;
  }

  return {
    ...row,
    employee_name: "",
  };
}

function sanitizeShiftRows(rows: ShiftRow[]) {
  return rows.map((row) => sanitizeShiftRow(row));
}

function formatEffectiveDate(value?: string) {
  const source = normalizeText(value) || new Date().toISOString();
  return source.slice(0, 10);
}

function normalizeImportSummary(summary?: Partial<ShiftImportSummary> | null): ShiftImportSummary {
  return {
    imported_rows: Number(summary?.imported_rows || 0),
    updated_rows: Number(summary?.updated_rows || 0),
    preserved_rows: Number(summary?.preserved_rows || 0),
  };
}

function buildSnapshotSignature(snapshot: Pick<ShiftRosterSnapshot, "source_file_name" | "custom_columns" | "rows">) {
  return JSON.stringify({
    source_file_name: normalizeText(snapshot.source_file_name),
    custom_columns: [...(snapshot.custom_columns || [])].sort(),
    rows: snapshot.rows || [],
  });
}

function createRosterSnapshot(
  roster: Pick<ShiftRoster, "source_file_name" | "custom_columns" | "rows" | "updated_at" | "import_summary">,
  effectiveDate?: string
): ShiftRosterSnapshot {
  return {
    effective_date: formatEffectiveDate(effectiveDate || roster.updated_at),
    captured_at: roster.updated_at || new Date().toISOString(),
    source_file_name: normalizeText(roster.source_file_name),
    custom_columns: [...(roster.custom_columns || [])].sort(),
    rows: Array.isArray(roster.rows) ? sanitizeShiftRows(roster.rows) : [],
    import_summary: normalizeImportSummary(roster.import_summary),
  };
}

function normalizeRosterHistory(roster: ShiftRoster): ShiftRosterSnapshot[] {
  const baseSnapshot = createRosterSnapshot(roster, roster.updated_at);
  const incomingHistory = Array.isArray(roster.history) ? roster.history : [];
  const normalized = incomingHistory
    .map((snapshot) => ({
      effective_date: formatEffectiveDate(snapshot?.effective_date || snapshot?.captured_at || roster.updated_at),
      captured_at: normalizeText(snapshot?.captured_at) || roster.updated_at || new Date().toISOString(),
      source_file_name: normalizeText(snapshot?.source_file_name) || normalizeText(roster.source_file_name),
      custom_columns: Array.isArray(snapshot?.custom_columns) ? [...snapshot.custom_columns].sort() : [...roster.custom_columns].sort(),
      rows: Array.isArray(snapshot?.rows) ? sanitizeShiftRows(snapshot.rows) : [],
      import_summary: normalizeImportSummary(snapshot?.import_summary),
    }))
    .filter((snapshot) => snapshot.rows.length > 0);

  normalized.push(baseSnapshot);

  const deduped = new Map<string, ShiftRosterSnapshot>();
  normalized.forEach((snapshot) => {
    const key = `${snapshot.effective_date}__${buildSnapshotSignature(snapshot)}`;
    const prior = deduped.get(key);
    if (!prior || prior.captured_at < snapshot.captured_at) {
      deduped.set(key, snapshot);
    }
  });

  return Array.from(deduped.values()).sort((a, b) => {
    const byDate = a.effective_date.localeCompare(b.effective_date);
    if (byDate !== 0) return byDate;
    return a.captured_at.localeCompare(b.captured_at);
  });
}

function materializeRosterWithHistory(roster: ShiftRoster): ShiftRoster {
  const history = normalizeRosterHistory(roster);
  const latest = history[history.length - 1] || createRosterSnapshot(roster, roster.updated_at);
  return {
    ...roster,
    source_file_name: latest.source_file_name,
    custom_columns: latest.custom_columns,
    rows: sanitizeShiftRows(latest.rows),
    updated_at: latest.captured_at,
    import_summary: latest.import_summary,
    history,
  };
}

function buildRosterHistoryUpdate(existing: ShiftRoster | null | undefined, incoming: ShiftRoster): ShiftRoster {
  const normalizedIncoming = materializeRosterWithHistory({
    ...incoming,
    updated_at: incoming.updated_at || new Date().toISOString(),
  });

  if (!existing) {
    return normalizedIncoming;
  }

  const normalizedExisting = materializeRosterWithHistory(existing);
  const nextHistory = [...(normalizedExisting.history || [])];
  const nextSnapshot = createRosterSnapshot(normalizedIncoming, normalizedIncoming.updated_at);
  const latestSnapshot = nextHistory[nextHistory.length - 1];
  const latestSignature = latestSnapshot ? buildSnapshotSignature(latestSnapshot) : "";
  const nextSignature = buildSnapshotSignature(nextSnapshot);

  if (!latestSnapshot) {
    nextHistory.push(nextSnapshot);
  } else if (latestSnapshot.effective_date === nextSnapshot.effective_date) {
    nextHistory[nextHistory.length - 1] = {
      ...latestSnapshot,
      ...nextSnapshot,
    };
  } else if (latestSignature !== nextSignature) {
    nextHistory.push(nextSnapshot);
  } else {
    nextHistory[nextHistory.length - 1] = {
      ...latestSnapshot,
      captured_at: nextSnapshot.captured_at,
      source_file_name: nextSnapshot.source_file_name,
      custom_columns: nextSnapshot.custom_columns,
      import_summary: nextSnapshot.import_summary,
    };
  }

  return materializeRosterWithHistory({
    ...normalizedExisting,
    ...normalizedIncoming,
    updated_at: nextSnapshot.captured_at,
    history: nextHistory,
  });
}

export function resolveShiftRosterForDate(roster: ShiftRoster, dateValue: string | Date) {
  const dateKey = typeof dateValue === "string" ? formatEffectiveDate(dateValue) : formatEffectiveDate(dateValue.toISOString());
  const normalized = materializeRosterWithHistory(roster);
  const history = normalized.history || [];
  let resolved = history[0] || createRosterSnapshot(normalized, normalized.updated_at);
  for (let index = 0; index < history.length; index += 1) {
    const snapshot = history[index];
    if (snapshot.effective_date <= dateKey) {
      resolved = snapshot;
      continue;
    }
    break;
  }

  return {
    ...normalized,
    source_file_name: resolved.source_file_name,
    custom_columns: resolved.custom_columns,
    rows: resolved.rows,
    updated_at: resolved.captured_at,
    import_summary: resolved.import_summary,
  };
}

export function materializeShiftRostersForDate(rosters: ShiftRoster[], dateValue: string | Date) {
  return rosters.map((roster) => resolveShiftRosterForDate(roster, dateValue));
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
  const notesIndex = findIndex("notes", "note");
  const dayIndexes = {
    monday: findIndex("monday"),
    tuesday: findIndex("tuesday"),
    wednesday: findIndex("wednesday"),
    thursday: findIndex("thursday"),
    friday: findIndex("friday"),
    saturday: findIndex("saturday"),
    sunday: findIndex("sunday"),
  } as Record<ShiftDayKey, number>;
  const dayMax = Math.max(...DAY_ORDER.map((day) => dayIndexes[day]).filter((index) => index >= 0), -1);
  const hasHeaders = weekIndex >= 0 || dayIndexes.monday >= 0 || detectedNameIndex >= 0;

  const resolvedWeekIndex = hasHeaders ? weekIndex : 0;
  const resolvedNameIndex = hasHeaders ? (detectedNameIndex >= 0 ? detectedNameIndex : 1) : 1;
  const resolvedDepartmentIndex = hasHeaders ? (detectedDepartmentIndex >= 0 ? detectedDepartmentIndex : 2) : 2;
  const resolvedCodeIndex = hasHeaders ? codeIndex : 4;
  const resolvedTimeIndex = hasHeaders ? timeIndex : -1;

  const hiddenExtraColumnKeys = new Set(["store", "rep", "terminated", "status", "company", "shared", "type", "b"]);
  const extraIndexes = headerRow
    .map((value, index) => ({ value: normalizeText(value), index }))
    .filter(({ index }) => index > dayMax && index !== notesIndex && index !== weekIndex && index !== detectedNameIndex && index !== detectedDepartmentIndex && index !== hrIndex && index !== codeIndex && index !== timeIndex)
    .filter(({ value }) => value !== "")
    .map(({ value, index }) => ({ index, key: normalizeKey(value) || `extra_${index}` }))
    .filter(({ key }) => !hiddenExtraColumnKeys.has(key));

  return {
    weekIndex: resolvedWeekIndex,
    nameIndex: resolvedNameIndex,
    departmentIndex: resolvedDepartmentIndex,
    hrIndex,
    codeIndex: resolvedCodeIndex,
    timeIndex: resolvedTimeIndex,
    dayIndexes,
    notesIndex,
    extraIndexes,
  };
}

function textAt(row: unknown[], index: number) {
  if (index < 0 || index >= row.length) return "";
  return normalizeText(row[index]);
}

function findHeaderRowIndex(rows: unknown[][]) {
  const scanLimit = Math.min(rows.length, 8);

  for (let rowIndex = 0; rowIndex < scanLimit; rowIndex += 1) {
    const row = rows[rowIndex] as unknown[];
    if (!row || isBlankRow(row)) continue;

    const firstCell = textAt(row, 0);
    if (/^week\s*\d+/i.test(firstCell)) continue;

    const parsed = parseHeaderRow(row);
    const detectedDays = DAY_ORDER.filter((day) => parsed.dayIndexes[day] >= 0).length;
    const hasIdentityColumns = parsed.weekIndex >= 0 || parsed.nameIndex >= 0 || parsed.codeIndex >= 0;

    if (detectedDays >= 3 || (detectedDays >= 2 && hasIdentityColumns)) {
      return rowIndex;
    }
  }

  return -1;
}

function findTitle(rows: unknown[][], fallback: string, limitExclusive: number) {
  for (let rowIndex = 0; rowIndex < Math.min(limitExclusive, rows.length); rowIndex += 1) {
    const row = rows[rowIndex] as unknown[];
    if (!row || isBlankRow(row)) continue;

    const firstCell = textAt(row, 0);
    if (!firstCell) continue;
    if (/^week\s*$/i.test(firstCell) || /^week\s*\d+/i.test(firstCell)) continue;

    return firstCell;
  }

  return fallback;
}

function resolveSheetLayout(rows: unknown[][], sheetName: string): SheetLayout {
  const headerRowIndex = findHeaderRowIndex(rows);
  if (headerRowIndex >= 0) {
    return {
      title: findTitle(rows, sheetName, headerRowIndex),
      header: parseHeaderRow((rows[headerRowIndex] || []) as unknown[]),
      startRowIndex: headerRowIndex + 1,
      useFixedColumns: false,
    };
  }

  let startRowIndex = 0;
  while (startRowIndex < rows.length) {
    const row = rows[startRowIndex] as unknown[];
    if (!row || isBlankRow(row)) {
      startRowIndex += 1;
      continue;
    }

    if (/^week\s*\d+/i.test(textAt(row, FIXED_RAW_COLUMNS.week))) {
      break;
    }

    startRowIndex += 1;
  }

  return {
    title: findTitle(rows, sheetName, startRowIndex),
    header: parseHeaderRow([]),
    startRowIndex,
    useFixedColumns: true,
  };
}

function buildGroupKey(sheetName: string, slotIndex: number) {
  return `${normalizeKey(sheetName)}_slot_${Math.max(1, slotIndex + 1)}`;
}

function parseWeekNumber(value: string) {
  const match = normalizeText(value).match(/week\s*(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function getManualEditedFields(row: Pick<ShiftRow, "logs"> | null | undefined) {
  const fields = new Set<string>();
  const logs = Array.isArray(row?.logs) ? row.logs : [];
  for (const log of logs) {
    const source = normalizeText(log?.source).toLowerCase();
    const field = normalizeText(log?.field);
    if ((source === "edit" || source === "paste") && field) {
      fields.add(field);
    }
  }

  return fields;
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
  const manuallyEditedFields = getManualEditedFields(existing);
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
    if (manuallyEditedFields.has(String(field))) {
      merged[field] = existing[field] as never;
      continue;
    }

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
  const firstCell = textAt(headerRow, 0).toLowerCase();
  const looksLikeHeader = /^(run\s*date|week|employee|date|no\.?|name|store|branch|section|department|code)/i.test(firstCell);
  const looksLikeStoreTitle = /^\d+\s|^checkers|^shoprite|^game|^cna|^pick/i.test(firstCell);
  const derivedTitle = ((!looksLikeHeader || looksLikeStoreTitle) && firstCell ? textAt(headerRow, 0) : sheetName) || sheetName;
  const storeCode = (derivedTitle.match(/^(\d+)/)?.[1] || "").trim();
  const storeName = looksLikeHeader && !looksLikeStoreTitle ? sheetName : derivedTitle;
  const rowMap = new Map<string, ShiftRow>();
  const customColumnSet = new Set<string>();
  let importedRows = 0;
  let currentWeekNumber = 0;
  let currentWeekLabel = "";
  let currentWeekSlotIndex = -1;
  const fixedColumnsByFirstRow =
    /^WEEK\s*\d+/i.test(textAt(headerRow, FIXED_RAW_COLUMNS.week).toUpperCase()) &&
    header.weekIndex === 0 &&
    header.nameIndex === 1;
  const startRowIndex = fixedColumnsByFirstRow ? 0 : 1;

  for (let rowIndex = startRowIndex; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] as unknown[];
    if (!row || isBlankRow(row)) {
      currentWeekSlotIndex = -1;
      continue;
    }

    let rawWeekLabel: string;
    let employeeName: string;
    let department: string;
    let hr: string;
    let employeeCode: string;
    let timeLabel: string;
    let monday: string;
    let tuesday: string;
    let wednesday: string;
    let thursday: string;
    let friday: string;
    let saturday: string;
    let sunday: string;

    if (fixedColumnsByFirstRow) {
      rawWeekLabel = textAt(row, FIXED_RAW_COLUMNS.week);
      employeeName = textAt(row, FIXED_RAW_COLUMNS.name);
      department = textAt(row, FIXED_RAW_COLUMNS.department);
      hr = textAt(row, FIXED_RAW_COLUMNS.hr);
      employeeCode = textAt(row, FIXED_RAW_COLUMNS.code);
      timeLabel = textAt(row, FIXED_RAW_COLUMNS.time);
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
      hr = textAt(row, header.hrIndex);
      employeeCode = textAt(row, header.codeIndex);
      timeLabel = textAt(row, header.timeIndex);
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
    const resolvedTimeLabel = fixedColumnsByFirstRow ? textAt(row, FIXED_RAW_COLUMNS.time) : textAt(row, header.timeIndex >= 0 ? header.timeIndex : 12);
    if (!employeeName) {
      employeeName = employeeCode ? employeeCode : `${department || "Shift"} ${resolvedTimeLabel || ""} W${weekNumber} R${rowIndex}`;
    }
    const notes = textAt(row, header.notesIndex);
    const expectedHours = buildExpectedHours(resolvedTimeLabel || monday || "7-3");

    const extraColumns: Record<string, string> = {};
    if (fixedColumnsByFirstRow) {
      for (let colIndex = FIXED_RAW_COLUMNS.sunday + 1; colIndex < row.length; colIndex += 1) {
        const value = textAt(row, colIndex);
        if (value) {
          const key = `extra_${colIndex}`;
          extraColumns[key] = value;
          customColumnSet.add(key);
        }
      }
    } else {
      header.extraIndexes.forEach(({ index, key }) => {
        const value = textAt(row, index);
        if (value !== "") {
          extraColumns[key] = value;
          customColumnSet.add(key);
        }
      });
    }

    const groupKey = buildGroupKey(sheetName, currentWeekSlotIndex);
    const normalizedEmployeeName = employeeName.replace(/\s+/g, "_").toLowerCase();
    const rowKey = `${employeeCode}_${normalizedEmployeeName}_w${weekNumber}`;

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
      hr,
      time_label: resolvedTimeLabel,
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
    return materializeRosterWithHistory(incoming);
  }

  const existingMap = new Map(existing.rows.map((row) => [row.row_key, row]));
  const mergedRows: ShiftRow[] = [];
  const leavePattern = /\b(AL|SL|LEAVE|ANNUAL LEAVE|SICK LEAVE)\b/;
  let updatedRows = 0;

  for (const incomingRow of incoming.rows) {
    const prior = existingMap.get(incomingRow.row_key);
    const mergedRow = mergeRow(prior, incomingRow, "merge");
    if (prior) {
      for (const day of DAY_ORDER) {
        const priorValue = String(prior[day] || "").toUpperCase();
        const nextValue = String(mergedRow[day] || "").toUpperCase();
        if (leavePattern.test(priorValue) && !leavePattern.test(nextValue)) {
          mergedRow[day] = prior[day];
          updatedRows += 1;
        }
      }
    }
    mergedRows.push(mergedRow);
    existingMap.delete(incomingRow.row_key);
  }

  for (const remaining of existingMap.values()) {
    if (remaining.group_key.includes("_blank_")) {
      mergedRows.push(remaining);
    }
  }

  mergedRows.sort((a, b) => a.week_number - b.week_number || a.order_index - b.order_index);

  return materializeRosterWithHistory({
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
  });
}

export async function initializeShiftDatabase(): Promise<boolean> {
  return true;
}

export async function getShiftRosters(): Promise<ShiftRoster[]> {
  const localRosters = loadLocalShiftRosters();
  void hasActiveShiftSyncLinks();
  return localRosters;
}

export async function upsertShiftRoster(roster: ShiftRoster): Promise<{ success: boolean; error?: string }> {
  const localRosters = loadLocalShiftRosters();
  const existingLocal = localRosters.find((item) => item.sheet_name === roster.sheet_name);
  const mergedRoster = buildRosterHistoryUpdate(existingLocal, {
    ...roster,
    updated_at: new Date().toISOString(),
  });
  const mergedLocal = [
    ...localRosters.filter((item) => item.sheet_name !== roster.sheet_name),
    mergedRoster,
  ].sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  saveLocalShiftRosters(mergedLocal);
  return { success: true };
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
