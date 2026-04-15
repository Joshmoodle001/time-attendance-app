import * as XLSX from "xlsx";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
const SUPABASE_REST_KEY = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;

const DEFAULT_SHIFT_SYNC_SECTIONS = [];

const DEFAULT_SHIFT_SYNC_SETTINGS = {
  autoSyncEnabled: false,
  backupIntervalMinutes: 60,
  scheduledRunTimes: [],
  lastUniversalSyncedAt: "",
  lastUniversalStatus: "Hourly background sync is off.",
  liveSyncEnabled: false,
  lastLiveSyncedAt: "",
  lastLiveStatus: "Live sheet listening is off until a live Google Sheet link is connected.",
  liveWebhookKey: "",
  sections: DEFAULT_SHIFT_SYNC_SECTIONS,
};

function hasConfiguredSectionLinks(settings) {
  return Boolean(settings?.sections?.some((section) => normalizeText(section.url)));
}

function createLiveWebhookKey() {
  return `shift_live_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

const DAY_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function normalizeText(value) {
  return value === null || value === undefined ? "" : String(value).replace(/\s+/g, " ").trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function randomId() {
  return globalThis.crypto?.randomUUID?.() ?? `shift_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

function mergeSections(sections) {
  const parsedMap = new Map((Array.isArray(sections) ? sections : []).map((item) => [item.id, item]));
  const merged = DEFAULT_SHIFT_SYNC_SECTIONS.map((section) => {
    const stored = parsedMap.get(section.id);
    parsedMap.delete(section.id);
    return {
      ...section,
      ...(stored || {}),
      id: section.id,
      label: section.label,
      url: normalizeText(stored?.url || section.url),
      lastSyncedAt: normalizeText(stored?.lastSyncedAt || section.lastSyncedAt),
      lastStatus: normalizeText(stored?.lastStatus || section.lastStatus),
    };
  });
  const custom = Array.from(parsedMap.values()).map((section) => ({
    id: section.id,
    label: normalizeText(section.label) || section.id,
    url: normalizeText(section.url),
    lastSyncedAt: normalizeText(section.lastSyncedAt),
    lastStatus: normalizeText(section.lastStatus) || "Waiting for a Google document link.",
  }));
  return [...merged, ...custom];
}

function normalizeSettings(value) {
  const raw = typeof value === "object" && value !== null ? value : {};
  return {
    autoSyncEnabled: Boolean(raw.autoSyncEnabled),
    backupIntervalMinutes: Number(raw.backupIntervalMinutes || 60),
    scheduledRunTimes: Array.isArray(raw.scheduledRunTimes)
      ? raw.scheduledRunTimes
          .map((item) => normalizeText(item))
          .filter((item) => /^\d{2}:\d{2}$/.test(item))
      : [],
    lastUniversalSyncedAt: normalizeText(raw.lastUniversalSyncedAt),
    lastUniversalStatus: normalizeText(raw.lastUniversalStatus) || DEFAULT_SHIFT_SYNC_SETTINGS.lastUniversalStatus,
    liveSyncEnabled: raw.liveSyncEnabled === undefined ? DEFAULT_SHIFT_SYNC_SETTINGS.liveSyncEnabled : Boolean(raw.liveSyncEnabled),
    lastLiveSyncedAt: normalizeText(raw.lastLiveSyncedAt),
    lastLiveStatus: normalizeText(raw.lastLiveStatus) || DEFAULT_SHIFT_SYNC_SETTINGS.lastLiveStatus,
    liveWebhookKey: normalizeText(raw.liveWebhookKey) || createLiveWebhookKey(),
    sections: mergeSections(raw.sections),
  };
}

function requireSupabaseConfig() {
  if (!SUPABASE_URL || !SUPABASE_REST_KEY) {
    throw new Error("Supabase environment variables are missing for background shift sync.");
  }
}

async function restFetch(path, options = {}) {
  requireSupabaseConfig();
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_REST_KEY,
      Authorization: `Bearer ${SUPABASE_REST_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(payload || `Supabase request failed with status ${response.status}`);
  }

  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text);
}

export async function loadRemoteShiftSyncSettings() {
  try {
    const data = await restFetch("shift_sync_settings?id=eq.global&select=*", { method: "GET" });
    if (!Array.isArray(data) || !data[0]) return DEFAULT_SHIFT_SYNC_SETTINGS;
    return normalizeSettings({
      autoSyncEnabled: data[0].auto_sync_enabled,
      backupIntervalMinutes: data[0].payload?.backupIntervalMinutes,
      scheduledRunTimes: data[0].payload?.scheduledRunTimes,
      lastUniversalSyncedAt: data[0].last_universal_synced_at,
      lastUniversalStatus: data[0].last_universal_status,
      liveSyncEnabled: data[0].payload?.liveSyncEnabled,
      lastLiveSyncedAt: data[0].payload?.lastLiveSyncedAt,
      lastLiveStatus: data[0].payload?.lastLiveStatus,
      liveWebhookKey: data[0].payload?.liveWebhookKey,
      sections: data[0].payload?.sections,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load remote shift sync settings.";
    if (message.includes("shift_sync_settings")) {
      throw new Error("Remote shift sync settings table is not set up yet.");
    }
    throw error;
  }
}

export async function saveRemoteShiftSyncSettings(settings) {
  const normalized = normalizeSettings(settings);
  try {
    await restFetch("shift_sync_settings?on_conflict=id", {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify([
        {
          id: "global",
          auto_sync_enabled: normalized.autoSyncEnabled,
          last_universal_synced_at: normalized.lastUniversalSyncedAt || null,
          last_universal_status: normalized.lastUniversalStatus,
          payload: {
            backupIntervalMinutes: normalized.backupIntervalMinutes,
            scheduledRunTimes: normalized.scheduledRunTimes,
            liveSyncEnabled: normalized.liveSyncEnabled,
            lastLiveSyncedAt: normalized.lastLiveSyncedAt || null,
            lastLiveStatus: normalized.lastLiveStatus,
            liveWebhookKey: normalized.liveWebhookKey,
            sections: normalized.sections,
          },
          updated_at: new Date().toISOString(),
        },
      ]),
    });
    return normalized;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save remote shift sync settings.";
    if (message.includes("shift_sync_settings")) {
      throw new Error("Remote shift sync settings table is not set up yet.");
    }
    throw error;
  }
}

function buildGoogleDownloadUrl(input) {
  const clean = normalizeText(input);
  if (!clean) return "";

  const spreadsheetId = clean.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1];
  if (spreadsheetId) {
    const gid = clean.match(/[?&]gid=(\d+)/)?.[1];
    return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx${gid ? `&gid=${gid}` : ""}`;
  }

  const driveFileId =
    clean.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9-_]+)/)?.[1] ||
    clean.match(/[?&]id=([a-zA-Z0-9-_]+)/)?.[1];
  if (driveFileId) {
    return `https://drive.google.com/uc?export=download&id=${driveFileId}`;
  }

  return clean;
}

function isAllowedGoogleHost(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "docs.google.com" || parsed.hostname === "drive.google.com";
  } catch {
    return false;
  }
}

async function downloadGoogleWorkbook(url, timeoutMs = 30000) {
  const downloadUrl = buildGoogleDownloadUrl(url);
  if (!downloadUrl || !isAllowedGoogleHost(downloadUrl)) {
    throw new Error("Only public Google Sheets or Google Drive links are allowed. Make sure the sheet is set to 'Anyone with the link can view'.");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(downloadUrl, {
      redirect: "follow",
      headers: {
        "User-Agent": "time-attendance-app-shift-sync-cron",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Google download failed with status ${response.status}. The sheet may not be publicly accessible or doesn't exist.`);
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > 50 * 1024 * 1024) {
      throw new Error("The downloaded file is too large (>50MB). Please use a smaller sheet.");
    }

    return response.arrayBuffer();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      throw new Error(`Download timed out after ${timeoutMs / 1000} seconds. The sheet may be too large or not accessible.`);
    }
    throw error;
  }
}

function isBlankRow(values) {
  return values.every((value) => normalizeText(value) === "");
}

function parseTimeHours(timeLabel) {
  const normalized = normalizeText(timeLabel).toLowerCase();
  const match = normalized.match(/(\d{1,2})(?::(\d{2}))?\s*[-\u2013]\s*(\d{1,2})(?::(\d{2}))?/);
  if (!match) return null;

  const startHour = Number(match[1]);
  const startMinute = Number(match[2] || 0);
  const endHour = Number(match[3]);
  const endMinute = Number(match[4] || 0);

  const start = startHour + startMinute / 60;
  let end = endHour + endMinute / 60;
  if (end <= start) end += 12;
  if (end <= start) end += 12;
  return Number(Math.max(0, end - start - 1).toFixed(1));
}

function buildExpectedHours(timeLabel) {
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

function parseHeaderRow(headerRow) {
  const normalized = headerRow.map((value, index) => ({
    value: normalizeText(value).toLowerCase(),
    index,
  }));

  const findIndex = (...candidates) => {
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
  };

  const dayMax = Math.max(...DAY_ORDER.map((day) => dayIndexes[day]).filter((index) => index >= 0), -1);
  const nameIndex = detectedNameIndex >= 0 ? detectedNameIndex : 1;
  const departmentIndex = detectedDepartmentIndex >= 0 ? detectedDepartmentIndex : 2;
  const hiddenExtraColumnKeys = new Set(["store", "rep", "terminated", "status", "company"]);
  const extraIndexes = headerRow
    .map((value, index) => ({ value: normalizeText(value), index }))
    .filter(({ index }) => index > dayMax && index !== notesIndex && index !== weekIndex && index !== nameIndex && index !== departmentIndex && index !== hrIndex && index !== codeIndex && index !== timeIndex)
    .filter(({ value }) => value !== "")
    .map(({ value, index }) => ({ index, key: normalizeKey(value) || `extra_${index}` }))
    .filter(({ key }) => !hiddenExtraColumnKeys.has(key));

  return {
    weekIndex,
    nameIndex,
    departmentIndex,
    hrIndex,
    codeIndex,
    timeIndex,
    dayIndexes,
    notesIndex,
    extraIndexes,
  };
}

function textAt(row, index) {
  if (index < 0 || index >= row.length) return "";
  return normalizeText(row[index]);
}

function buildGroupKey(sheetName, slotIndex) {
  return `${normalizeKey(sheetName)}_slot_${slotIndex + 1}`;
}

function parseWeekNumber(value) {
  const match = normalizeText(value).match(/week\s*(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function mergeRow(existing, incoming, source = "import") {
  if (!existing) {
    return {
      ...incoming,
      logs: incoming.logs?.length > 0 ? incoming.logs : [],
    };
  }

  const fields = [
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

  const mergedLogs = [...(existing.logs || [])];
  const merged = {
    ...existing,
    ...incoming,
    extra_columns: { ...(existing.extra_columns || {}), ...(incoming.extra_columns || {}) },
    expected_hours: incoming.expected_hours,
    logs: mergedLogs,
  };

  for (const field of fields) {
    const before = normalizeText(existing[field]);
    const after = normalizeText(incoming[field]);
    if (after !== "" && before !== after) {
      merged[field] = after;
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

function parseSheetRows(sheet, sheetName, sourceFileName) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
  const headerRow = rows[0] || [];
  const header = parseHeaderRow(headerRow);
  const title = normalizeText(headerRow[0]) || sheetName;
  const storeCode = (title.match(/^(\d+)/)?.[1] || "").trim();
  const rowMap = new Map();
  const customColumnSet = new Set();
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
    department: 2,
    code: 4,
    monday: 5,
    tuesday: 6,
    wednesday: 7,
    thursday: 8,
    friday: 9,
    saturday: 10,
    sunday: 11,
  };

  const useFixedColumns = isRawData && header.weekIndex === 0 && header.nameIndex === 1;
  const startRowIndex = isRawData ? 0 : 1;

  for (let rowIndex = startRowIndex; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row || isBlankRow(row)) {
      currentWeekSlotIndex = -1;
      continue;
    }

    let rawWeekLabel, employeeName, department, employeeCode;
    let monday, tuesday, wednesday, thursday, friday, saturday, sunday;

    if (useFixedColumns) {
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
      currentWeekNumber = 1;
      currentWeekLabel = "WEEK 1";
      currentWeekSlotIndex = rowIndex;
    }

    const weekNumber = currentWeekNumber;
    const timeLabel = textAt(row, header.timeIndex >= 0 ? header.timeIndex : 12);
    const notes = textAt(row, header.notesIndex);
    const expectedHours = buildExpectedHours(timeLabel || monday || "7-3");

    const extraColumns = {};
    if (useFixedColumns) {
      for (let colIndex = 12; colIndex < row.length; colIndex++) {
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
    const rowKey = `${employeeCode}_w${weekNumber}`;

    const incoming = {
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

  return {
    id: randomId(),
    sheet_name: sheetName,
    store_name: title,
    store_code: storeCode,
    source_file_name: sourceFileName,
    custom_columns: Array.from(customColumnSet).sort(),
    rows: Array.from(rowMap.values()).sort((a, b) => a.week_number - b.week_number || a.order_index - b.order_index),
    updated_at: new Date().toISOString(),
    import_summary: {
      imported_rows: importedRows,
      updated_rows: 0,
      preserved_rows: 0,
    },
  };
}

function parseShiftWorkbook(buffer, sourceFileName) {
  try {
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new Error("The downloaded file appears to be empty or invalid.");
    }
    const results = workbook.SheetNames.map((sheetName) => {
      try {
        return parseSheetRows(workbook.Sheets[sheetName], sheetName, sourceFileName);
      } catch (sheetError) {
        console.error(`Error parsing sheet "${sheetName}":`, sheetError);
        return null;
      }
    }).filter((roster) => roster && roster.rows && roster.rows.length > 0);
    
    if (results.length === 0) {
      throw new Error("No valid shift data was found in the sheet. Check that the sheet has 'Week' headers and employee rows.");
    }
    
    return results;
  } catch (error) {
    throw new Error(`Failed to parse workbook: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

function mergeShiftRosters(existing, incoming) {
  if (!existing) return incoming;

  const manualRows = (existing.rows || []).filter((row) => String(row.group_key || "").includes("_blank_"));
  const existingMap = new Map(manualRows.map((row) => [row.row_key, row]));
  const mergedRows = [];
  let updatedRows = 0;

  for (const incomingRow of incoming.rows) {
    const prior = existingMap.get(incomingRow.row_key);
    const mergedRow = mergeRow(prior, incomingRow, "merge");
    if (prior && JSON.stringify(prior) !== JSON.stringify(mergedRow)) {
      updatedRows += 1;
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
    custom_columns: Array.from(new Set([...(existing.custom_columns || []), ...(incoming.custom_columns || [])])).sort(),
    rows: mergedRows,
    updated_at: new Date().toISOString(),
    import_summary: {
      imported_rows: incoming.import_summary.imported_rows,
      updated_rows: updatedRows,
      preserved_rows: mergedRows.length - incoming.rows.length,
    },
  };
}

async function loadRemoteShiftRosters() {
  try {
    const data = await restFetch("shift_rosters?select=id,sheet_name,store_name,store_code,source_file_name,payload,updated_at&order=updated_at.desc", { method: "GET" });
    return (Array.isArray(data) ? data : []).map((item) => ({
      id: item.id,
      sheet_name: item.sheet_name,
      store_name: item.store_name,
      store_code: item.store_code || "",
      source_file_name: item.source_file_name || "",
      custom_columns: item.payload?.custom_columns || [],
      rows: item.payload?.rows || [],
      updated_at: item.updated_at,
      import_summary: item.payload?.import_summary || {
        imported_rows: 0,
        updated_rows: 0,
        preserved_rows: 0,
      },
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load remote shift rosters.";
    if (message.includes("shift_rosters")) {
      throw new Error("Remote shift roster table is not set up yet.");
    }
    throw error;
  }
}

async function upsertRemoteShiftRosters(rosters) {
  const payload = rosters.map((roster) => ({
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
  }));

  try {
    await restFetch("shift_rosters?on_conflict=sheet_name", {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save remote shift rosters.";
    if (message.includes("shift_rosters")) {
      throw new Error("Remote shift roster table is not set up yet.");
    }
    throw error;
  }
}

async function runSingleSectionSync(section, trigger) {
  const cleanUrl = normalizeText(section.url);
  if (!cleanUrl) {
    return {
      success: false,
      section: {
        ...section,
        lastStatus: "Add a Google document link before syncing.",
      },
      error: "Add a Google document link before syncing.",
    };
  }

  try {
    const buffer = await downloadGoogleWorkbook(cleanUrl);
    
    if (!buffer || buffer.byteLength === 0) {
      throw new Error("Downloaded file is empty.");
    }
    
    const imported = parseShiftWorkbook(buffer, `${section.label}.xlsx`);
    
    if (imported.length === 0) {
      throw new Error("No shift data found in the sheet. Make sure the sheet has 'Week' headers and employee rows.");
    }

    const currentRosters = await loadRemoteShiftRosters();
    const currentMap = new Map(currentRosters.map((roster) => [roster.sheet_name, roster]));
    const merged = imported.map((incoming) => mergeShiftRosters(currentMap.get(incoming.sheet_name), incoming));
    await upsertRemoteShiftRosters(merged);

    const syncedAt = new Date().toISOString();
    return {
      success: true,
      rosterCount: merged.length,
      totalRows: merged.reduce((sum, r) => sum + (r.rows?.length || 0), 0),
      section: {
        ...section,
        lastSyncedAt: syncedAt,
        lastStatus: `${trigger === "manual" ? "Manual" : "Hourly background"} sync complete: ${merged.length} roster(s) with ${merged.reduce((sum, r) => sum + (r.rows?.length || 0), 0)} employee rows.`,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred.";
    return {
      success: false,
      section: {
        ...section,
        lastStatus: `Sync failed: ${errorMessage}`,
      },
      error: errorMessage,
    };
  }
}

function getTriggerLabel(trigger) {
  if (trigger === "scheduled") return "Hourly background";
  if (trigger === "live") return "Live sheet";
  return "Manual";
}

function shouldRunScheduledSync(settings, now = new Date()) {
  if (!settings.autoSyncEnabled) {
    return { run: false, message: "Auto sync is disabled." };
  }

  if (!hasConfiguredSectionLinks(settings)) {
    return { run: false, message: "No configured sheet links." };
  }

  if (settings.scheduledRunTimes && settings.scheduledRunTimes.length > 0) {
    const johannesburgTime = new Date(now.toLocaleString("en-US", { timeZone: "Africa/Johannesburg" }));
    const currentHour = johannesburgTime.getHours();
    const currentMinute = johannesburgTime.getMinutes();
    const currentTimeInMinutes = currentHour * 60 + currentMinute;
    const currentWindow = Math.floor(currentTimeInMinutes / 15);

    for (const timeStr of settings.scheduledRunTimes) {
      const [scheduledHour, scheduledMinute] = timeStr.split(":").map(Number);
      const scheduledTimeInMinutes = scheduledHour * 60 + scheduledMinute;
      const scheduledWindow = Math.floor(scheduledTimeInMinutes / 15);

      if (currentWindow === scheduledWindow) {
        if (settings.lastUniversalSyncedAt) {
          const lastSynced = new Date(settings.lastUniversalSyncedAt);
          const lastSyncedWindow = Math.floor((lastSynced.getHours() * 60 + lastSynced.getMinutes()) / 15);
          if (lastSyncedWindow === currentWindow && lastSynced.toDateString() === now.toDateString()) {
            return { run: false, message: "Already ran in this scheduled window." };
          }
        }
        return { run: true, message: "Scheduled time matched." };
      }
    }
    return { run: false, message: "No scheduled time matched in current 15-minute window." };
  }

  if (settings.lastUniversalSyncedAt) {
    const lastSynced = new Date(settings.lastUniversalSyncedAt);
    const minutesSinceLastSync = (now.getTime() - lastSynced.getTime()) / 60000;
    if (minutesSinceLastSync < settings.backupIntervalMinutes) {
      return { run: false, message: `Backup interval not reached. Next in ${Math.round(settings.backupIntervalMinutes - minutesSinceLastSync)} minutes.` };
    }
  }

  return { run: true, message: "Backup interval elapsed." };
}

export async function runUniversalShiftSync(trigger = "manual", options = {}) {
  try {
    const currentSettings = await loadRemoteShiftSyncSettings();
    
    if (!hasConfiguredSectionLinks(currentSettings)) {
      return {
        success: true,
        skipped: true,
        settings: currentSettings,
        message: "No configured sheet links. Add a Google Sheet link to a section to enable sync.",
      };
    }

    if (trigger === "scheduled") {
      const shouldRun = shouldRunScheduledSync(currentSettings);
      if (!shouldRun.run) {
        return {
          success: true,
          skipped: true,
          settings: currentSettings,
          message: shouldRun.message,
        };
      }
    }

    if (trigger === "live" && !currentSettings.liveSyncEnabled) {
      return {
        success: true,
        skipped: true,
        settings: currentSettings,
        message: "Hourly background shift sync is disabled.",
      };
    }

    // Live sync processes when called directly (webhook from Google Apps Script)
    // even if liveSyncEnabled is false, so users can trigger sync manually via script

    const requestedSectionIds = Array.isArray(options.sectionIds)
      ? options.sectionIds.map((value) => normalizeText(value)).filter(Boolean)
      : [];
    const sectionsToRun = requestedSectionIds.length
      ? currentSettings.sections.filter((section) => requestedSectionIds.includes(section.id))
      : currentSettings.sections;

    const nextSections = [];
    let successCount = 0;
    let failureCount = 0;
    let totalRows = 0;
    const errors = [];

    for (const section of currentSettings.sections) {
      const shouldRun = sectionsToRun.some((item) => item.id === section.id);
      if (!shouldRun) {
        nextSections.push(section);
        continue;
      }

      if (!normalizeText(section.url)) {
        nextSections.push(section);
        continue;
      }

      try {
        const result = await runSingleSectionSync(section, trigger);
        nextSections.push(result.section);
        if (result.success) {
          successCount += 1;
          totalRows += result.totalRows || 0;
        } else {
          failureCount += 1;
          if (result.error) {
            errors.push({ section: section.label, error: result.error });
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown sync error.";
        nextSections.push({
          ...section,
          lastStatus: `Sync failed: ${message}`,
        });
        failureCount += 1;
        errors.push({ section: section.label, error: message });
      }
    }

    const syncedAt = new Date().toISOString();
    const triggerLabel = getTriggerLabel(trigger);
    const nextSettings = {
      ...currentSettings,
      sections: nextSections,
    };

    let statusText;
    if (failureCount === 0 && successCount > 0) {
      statusText = `${triggerLabel} sync complete for ${successCount} section(s), ${totalRows} total rows.`;
    } else if (failureCount > 0 && successCount > 0) {
      statusText = `${triggerLabel} sync: ${successCount} succeeded, ${failureCount} failed.`;
    } else if (failureCount > 0) {
      statusText = `${triggerLabel} sync failed for all ${failureCount} section(s).`;
    } else {
      statusText = `${triggerLabel} sync complete.`;
    }

    if (trigger === "live") {
      nextSettings.lastLiveSyncedAt = syncedAt;
      nextSettings.lastLiveStatus = statusText;
    } else {
      nextSettings.lastUniversalSyncedAt = syncedAt;
      nextSettings.lastUniversalStatus = statusText;
    }

    const savedSettings = await saveRemoteShiftSyncSettings(nextSettings);
    return {
      success: failureCount === 0,
      settings: savedSettings,
      successCount,
      failureCount,
      totalRows,
      errors: errors.length > 0 ? errors : undefined,
      message: statusText,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred.";
    return {
      success: false,
      error: errorMessage,
      message: `Sync failed: ${errorMessage}`,
    };
  }
}
