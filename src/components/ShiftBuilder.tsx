import React, { useEffect, useMemo, useRef, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Expand,
  FileText,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  createBlankShiftGroup,
  getShiftRosters,
  initializeShiftDatabase,
  mergeShiftRosters,
  parseShiftWorkbook,
  type ShiftDayKey,
  type ShiftRoster,
  type ShiftRow,
  upsertShiftRoster,
} from "@/services/shifts";
import { loadShiftSyncSettings, buildShiftDownloadUrl, hasConfiguredShiftSyncLinks } from "@/services/shiftSync";

type CellPosition = {
  rowKey: string;
  field: string;
  customKey?: string;
};

type EditableField = "employee_name" | "department" | "hr" | "employee_code" | "time_label" | "extra" | ShiftDayKey;
const DAY_COLUMNS: Array<{ key: ShiftDayKey; label: string }> = [
  { key: "monday", label: "Monday" },
  { key: "tuesday", label: "Tuesday" },
  { key: "wednesday", label: "Wednesday" },
  { key: "thursday", label: "Thursday" },
  { key: "friday", label: "Friday" },
  { key: "saturday", label: "Saturday" },
  { key: "sunday", label: "Sunday" },
];

const WEEKEND_HEADER = "bg-cyan-100 text-cyan-700";
const TITLE_BAND = "bg-[#17b5e6] text-black";
const WEEKDAY_KEYS: ShiftDayKey[] = ["monday", "tuesday", "wednesday", "thursday", "friday"];

function normalizeText(value: unknown) {
  return value === null || value === undefined ? "" : String(value).replace(/\s+/g, " ").trim();
}

function randomId() {
  return globalThis.crypto?.randomUUID?.() ?? `shift_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

function isWeekday(field: ShiftDayKey) {
  return WEEKDAY_KEYS.includes(field);
}

function getFields() {
  return [
    "week_label",
    "employee_name",
    "department",
    "hr",
    "employee_code",
    "time_label",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ];
}

function getCellValue(row: ShiftRow, field: string, customKey?: string) {
  if (field === "week_label") return row.week_label;
  if (field === "employee_name") return row.employee_name;
  if (field === "department") return row.department;
  if (field === "hr") return row.hr;
  if (field === "employee_code") return row.employee_code;
  if (field === "time_label") return row.time_label;
  if (field === "notes") return row.notes;
  if (field === "extra" && customKey) return row.extra_columns[customKey] || "";
  if (field in row) return String((row as Record<string, unknown>)[field] ?? "");
  return "";
}

function getDayCellClass(day: ShiftDayKey, value: string) {
  const clean = normalizeText(value).toUpperCase();
  if (clean === "OFF") return "bg-[#ffc8d6] text-black";
  if (clean === "SHARED") return "bg-white text-black";
  if (day === "saturday") return "bg-[#ffe68a] text-black";
  if (day === "sunday") return "bg-white text-black";
  return "bg-[#f0c8ea] text-black";
}

function buildExpectedHours(timeLabel: string) {
  const clean = normalizeText(timeLabel).toLowerCase();
  const match = clean.match(/(\d{1,2})(?::(\d{2}))?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?/);
  const weekdayHours = parseShiftLength(timeLabel) ?? 7;
  void clean;
  void match;

  return {
    monday: weekdayHours,
    tuesday: weekdayHours,
    wednesday: weekdayHours,
    thursday: weekdayHours,
    friday: weekdayHours,
    saturday: 6,
    sunday: 5.5,
  } as const;
}

function parseShiftLength(timeLabel: string) {
  const clean = normalizeText(timeLabel).toLowerCase();
  const match = clean.match(/(\d{1,2})(?::(\d{2}))?\s*[-\u2013]\s*(\d{1,2})(?::(\d{2}))?/);
  if (!match) return null;

  const start = Number(match[1]) + Number(match[2] || 0) / 60;
  const rawEnd = Number(match[3]) + Number(match[4] || 0) / 60;
  let end = rawEnd;
  if (end <= start) end += 12;
  if (end <= start) end += 12;
  return Number(Math.max(0, end - start - 1).toFixed(1));
}

function getHoursForCell(row: ShiftRow, day: ShiftDayKey) {
  const raw = normalizeText(row[day]);
  const clean = raw.toUpperCase();
  if (!clean || clean === "OFF") return 0;
  if (day === "saturday") return 6;
  if (day === "sunday") return 5.5;
  if (clean === "X") return parseShiftLength(row.time_label) ?? row.expected_hours[day] ?? 0;
  return parseShiftLength(raw) ?? row.expected_hours[day] ?? 0;
}

function getWeekTotal(row: ShiftRow) {
  return DAY_COLUMNS.reduce((total, day) => total + getHoursForCell(row, day.key), 0);
}

function formatHours(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function getEditorValue(row: ShiftRow, field: EditableField) {
  if (["monday", "tuesday", "wednesday", "thursday", "friday"].includes(field)) {
    const value = normalizeText(row[field as ShiftDayKey]);
    return value.toUpperCase() === "X" ? row.time_label : value;
  }

  return getCellValue(row, field);
}

function getStoredDayValue(row: ShiftRow, field: EditableField, value: string) {
  const clean = normalizeText(value);
  if (!["monday", "tuesday", "wednesday", "thursday", "friday"].includes(field)) {
    return clean;
  }
  if (!clean) return "";
  if (clean.toUpperCase() === "OFF") return "OFF";
  if (clean.toUpperCase() === "X") return "X";
  return normalizeText(clean).toLowerCase() === normalizeText(row.time_label).toLowerCase() ? "X" : clean;
}

function updateRowField(
  row: ShiftRow,
  field: EditableField,
  value: string,
  customKey?: string,
  source: "edit" | "paste" | "import" = "edit"
) {
  const clean = normalizeText(value);
  const before = getCellValue(row, field, customKey);
  const next: ShiftRow = {
    ...row,
    logs: [...row.logs],
    extra_columns: { ...row.extra_columns },
  };

  if (field === "employee_name") next.employee_name = clean;
  if (field === "department") next.department = clean;
  if (field === "hr") next.hr = clean;
  if (field === "employee_code") next.employee_code = clean;
  if (field === "time_label") {
    next.time_label = clean;
    next.expected_hours = buildExpectedHours(clean);
  }
  if (["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].includes(field)) {
    (next as Record<string, unknown>)[field] = clean;
  }
  if (field === "extra" && customKey) {
    next.extra_columns[customKey] = clean;
  }

  if (before !== clean) {
    next.logs.push({
      id: randomId(),
      timestamp: new Date().toISOString(),
      source,
      field,
      before,
      after: clean,
      note: "Cell updated",
    });
  }

  return next;
}

function getGroupRowsFromRows(rows: ShiftRow[]) {
  const groups = new Map<string, ShiftRow[]>();
  rows.forEach((row) => {
    if (!groups.has(row.group_key)) groups.set(row.group_key, []);
    groups.get(row.group_key)!.push(row);
  });
  return Array.from(groups.entries())
    .map(([groupKey, rows]) => ({
      groupKey,
      rows: [...rows].sort((a, b) => a.week_number - b.week_number || a.order_index - b.order_index),
    }))
    .sort((a, b) => a.rows[0].order_index - b.rows[0].order_index);
}

function normalizeRoster(roster: ShiftRoster): ShiftRoster {
  return {
    ...roster,
    rows: [...roster.rows].sort((a, b) => a.week_number - b.week_number || a.order_index - b.order_index),
    updated_at: new Date().toISOString(),
  };
}

function updateRosterGroup(
  roster: ShiftRoster,
  rowKey: string,
  field: EditableField,
  value: string,
  customKey?: string,
  source: "edit" | "paste" | "import" = "edit"
) {
  const target = roster.rows.find((row) => row.row_key === rowKey);
  if (!target) return roster;
  return normalizeRoster({
    ...roster,
    rows: roster.rows.map((row) => (row.group_key === target.group_key ? updateRowField(row, field, value, customKey, source) : row)),
  });
}

function updateRosterSingleCell(
  roster: ShiftRoster,
  rowKey: string,
  field: EditableField,
  value: string,
  customKey?: string,
  source: "edit" | "paste" | "import" = "paste"
) {
  return normalizeRoster({
    ...roster,
    rows: roster.rows.map((row) => (row.row_key === rowKey ? updateRowField(row, field, value, customKey, source) : row)),
  });
}

function addBlankGroup(roster: ShiftRoster) {
  const template = createBlankShiftGroup(roster.sheet_name, roster.store_name);
  const nextIndex = Math.max(0, ...roster.rows.map((row) => row.order_index)) + 1;
  return normalizeRoster({
    ...roster,
    rows: [
      ...roster.rows,
      ...template.rows.map((row, index) => ({ ...row, order_index: nextIndex + index * 0.01 })),
    ],
  });
}

function removeGroup(roster: ShiftRoster, rowKey: string) {
  const target = roster.rows.find((row) => row.row_key === rowKey);
  if (!target) return roster;
  return normalizeRoster({
    ...roster,
    rows: roster.rows.filter((row) => row.group_key !== target.group_key),
  });
}

function moveGroup(roster: ShiftRoster, rowKey: string, direction: -1 | 1) {
  const groups = getGroupRows(roster);
  const index = groups.findIndex((group) => group.rows.some((row) => row.row_key === rowKey));
  if (index < 0) return roster;
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= groups.length) return roster;

  const ordered = [...groups];
  [ordered[index], ordered[nextIndex]] = [ordered[nextIndex], ordered[index]];
  const orderMap = new Map<string, number>();
  ordered.forEach((group, groupIndex) => orderMap.set(group.groupKey, groupIndex));

  return normalizeRoster({
    ...roster,
    rows: roster.rows.map((row) => ({ ...row, order_index: orderMap.get(row.group_key) ?? row.order_index })),
  });
}

function parseClipboardMatrix(text: string) {
  return text.replace(/\r\n/g, "\n").split("\n").map((line) => line.split("\t"));
}

function getGroupRows(roster: ShiftRoster | null) {
  if (!roster) return [];
  return getGroupRowsFromRows(roster.rows);
}

function getMatchScore(haystack: string, query: string) {
  if (!query) return 0;
  const lowerHaystack = haystack.toLowerCase();
  const lowerQuery = query.toLowerCase();
  if (lowerHaystack === lowerQuery) return 400;
  if (lowerHaystack.startsWith(lowerQuery)) return 300;
  const tokenMatch = lowerHaystack.split(/\s+/).some((token) => token.startsWith(lowerQuery));
  if (tokenMatch) return 200;
  if (lowerHaystack.includes(lowerQuery)) return 100;
  return 0;
}

export default function ShiftBuilder() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const shiftSearchRef = useRef<HTMLInputElement | null>(null);
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const fullscreenControlsTimerRef = useRef<number | null>(null);
  const [rosters, setRosters] = useState<ShiftRoster[]>([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [shiftSearch, setShiftSearch] = useState("");
  const [selectedCell, setSelectedCell] = useState<CellPosition | null>(null);
  const [editingCell, setEditingCell] = useState<CellPosition | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [fullscreenControlsVisible, setFullscreenControlsVisible] = useState(true);
  const [statusMessage, setStatusMessage] = useState("Load a workbook to build shifts.");
  const [isSyncing, setIsSyncing] = useState(false);
  const isInitialLoadRef = useRef(true);
  const prevSelectedSheetRef = useRef<string>("");
  const scrollPositionRef = useRef<number>(0);

  useEffect(() => {
    let alive = true;
    const loadRosters = async () => {
      await initializeShiftDatabase();
      const loaded = await getShiftRosters();
      if (!alive) return;
      
      // Only update if data actually changed
      setRosters((current) => {
        // Save scroll position before update
        if (tableWrapRef.current) {
          scrollPositionRef.current = tableWrapRef.current.scrollTop;
        }
        
        const currentJson = JSON.stringify(current);
        const loadedJson = JSON.stringify(loaded);
        if (currentJson === loadedJson) {
          return current;
        }
        return loaded;
      });
      
      // Only set initial sheet on first load, not every refresh
      if (isInitialLoadRef.current && loaded[0]) {
        setSelectedSheet(loaded[0].sheet_name);
        prevSelectedSheetRef.current = loaded[0].sheet_name;
        isInitialLoadRef.current = false;
      }
      
      if (loaded.length) {
        setStatusMessage(`Loaded ${loaded.length} shift roster${loaded.length === 1 ? "" : "s"}.`);
      }
    };

    void loadRosters();
    
    // Refresh less frequently (every 60 seconds instead of 20)
    const interval = window.setInterval(() => {
      void loadRosters();
    }, 60000);

    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, []);

  const selectedRoster = useMemo(() => {
    // Don't fall back to rosters[0] - just return null if selected sheet not found
    const found = rosters.find((roster) => roster.sheet_name === selectedSheet);
    return found || null;
  }, [rosters, selectedSheet]);

  useEffect(() => {
    if (selectedRoster && selectedRoster.sheet_name !== selectedSheet) {
      setSelectedSheet(selectedRoster.sheet_name);
    }
  }, [selectedRoster, selectedSheet]);

  // Restore scroll position after roster updates
  useEffect(() => {
    if (tableWrapRef.current && scrollPositionRef.current > 0) {
      // Small delay to allow DOM to update
      requestAnimationFrame(() => {
        if (tableWrapRef.current) {
          tableWrapRef.current.scrollTop = scrollPositionRef.current;
        }
      });
    }
  }, [rosters]);

  useEffect(() => {
    if (!showFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showFullscreen]);

  useEffect(() => {
    if (!showFullscreen) return;
    const isTouchDevice = window.matchMedia("(pointer: coarse)").matches;
    setFullscreenControlsVisible(!isTouchDevice);

    return () => {
      if (fullscreenControlsTimerRef.current) {
        window.clearTimeout(fullscreenControlsTimerRef.current);
        fullscreenControlsTimerRef.current = null;
      }
    };
  }, [showFullscreen]);

  const filteredRosters = useMemo(() => {
    const query = normalizeText(shiftSearch).toLowerCase();
    if (!query) return rosters;

    return rosters.filter((roster) => {
      const storeLabel = `${roster.store_name} ${roster.sheet_name} ${roster.store_code}`;
      if (getMatchScore(storeLabel, query) > 0) return true;
      return roster.rows.some((row) => {
        const haystack = `${row.employee_name} ${row.employee_code} ${row.department} ${row.week_label} ${roster.store_name}`;
        return getMatchScore(haystack, query) > 0;
      });
    });
  }, [rosters, shiftSearch]);

  useEffect(() => {
    if (!filteredRosters.length) return;
    if (filteredRosters.some((roster) => roster.sheet_name === selectedSheet)) return;
    setSelectedSheet(filteredRosters[0].sheet_name);
  }, [filteredRosters, selectedSheet]);

  const filteredRows = useMemo(() => {
    if (!selectedRoster) return [];
    const query = normalizeText(shiftSearch).toLowerCase();
    if (!query) return [...selectedRoster.rows].sort((a, b) => a.week_number - b.week_number || a.order_index - b.order_index);

    const storeLabel = `${selectedRoster.store_name} ${selectedRoster.sheet_name} ${selectedRoster.store_code}`;
    if (getMatchScore(storeLabel, query) > 0) {
      return [...selectedRoster.rows].sort((a, b) => a.week_number - b.week_number || a.order_index - b.order_index);
    }

    return selectedRoster.rows
      .filter((row) => {
        const haystack = `${row.employee_name} ${row.employee_code} ${row.department} ${row.week_label} ${selectedRoster.store_name}`;
        return getMatchScore(haystack, query) > 0;
      })
      .sort((a, b) => a.week_number - b.week_number || a.order_index - b.order_index);
  }, [selectedRoster, shiftSearch]);

  const orderedRows = useMemo(() => filteredRows, [filteredRows]);
  const rowGroups = useMemo(() => getGroupRowsFromRows(orderedRows), [orderedRows]);
  const selectedRow = useMemo(
    () => (selectedRoster && selectedCell ? orderedRows.find((row) => row.row_key === selectedCell.rowKey) || null : orderedRows[0] || null),
    [selectedRoster, selectedCell, orderedRows]
  );
  const detailedRows = useMemo(
    () =>
      orderedRows.map((row) => ({
        row,
        dailyHours: DAY_COLUMNS.map((day) => ({ key: day.key, label: day.label, hours: getHoursForCell(row, day.key) })),
        weekTotal: getWeekTotal(row),
      })),
    [orderedRows]
  );
  const weeklyTotals = useMemo(() => {
    const totals = new Map<number, Map<string, { employeeCode: string; employeeName: string; totalHours: number }>>();

    orderedRows.forEach((row) => {
      const week = row.week_number;
      const employeeCode = normalizeText(row.employee_code) || `no-code-${row.group_key}`;
      const employeeName = normalizeText(row.employee_name) || "Unknown merchandiser";
      const weekMap = totals.get(week) || new Map<string, { employeeCode: string; employeeName: string; totalHours: number }>();
      const current = weekMap.get(employeeCode) || { employeeCode, employeeName, totalHours: 0 };
      current.totalHours += getWeekTotal(row);
      current.employeeName = employeeName;
      weekMap.set(employeeCode, current);
      totals.set(week, weekMap);
    });

    return new Map(
      Array.from(totals.entries()).map(([week, map]) => [
        week,
        Array.from(map.values()).sort((a, b) => a.employeeName.localeCompare(b.employeeName)),
      ])
    );
  }, [orderedRows]);
  const grandTotals = useMemo(() => {
    const totals = new Map<string, { employeeCode: string; employeeName: string; totalHours: number }>();
    orderedRows.forEach((row) => {
      const employeeCode = normalizeText(row.employee_code) || `no-code-${row.group_key}`;
      const employeeName = normalizeText(row.employee_name) || "Unknown merchandiser";
      const current = totals.get(employeeCode) || { employeeCode, employeeName, totalHours: 0 };
      current.totalHours += getWeekTotal(row);
      current.employeeName = employeeName;
      totals.set(employeeCode, current);
    });

    return Array.from(totals.values()).sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  }, [orderedRows]);

  const persistRoster = async (nextRoster: ShiftRoster, message: string) => {
    setRosters((current) => current.map((roster) => (roster.sheet_name === nextRoster.sheet_name ? nextRoster : roster)));
    const result = await upsertShiftRoster(nextRoster);
    setStatusMessage(result.success ? message : `Saved locally, but failed to persist: ${result.error || "unknown error"}`);
  };

  const applyToSelectedRoster = async (updater: (roster: ShiftRoster) => ShiftRoster, message: string) => {
    if (!selectedRoster) return;
    await persistRoster(updater(selectedRoster), message);
  };

  const handleWorkbookUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const imported = parseShiftWorkbook(buffer, file.name);
      const currentMap = new Map(rosters.map((roster) => [roster.sheet_name, roster]));
      const merged = imported.map((incoming) => mergeShiftRosters(currentMap.get(incoming.sheet_name), incoming));
      const preserved = rosters.filter((roster) => !merged.some((item) => item.sheet_name === roster.sheet_name));
      const next = [...preserved, ...merged].sort((a, b) => a.sheet_name.localeCompare(b.sheet_name));
      setRosters(next);
      if (next[0]) setSelectedSheet((current) => current || next[0].sheet_name);
      await Promise.all(merged.map((roster) => upsertShiftRoster(roster)));
      setStatusMessage(`Imported ${merged.length} sheet roster${merged.length === 1 ? "" : "s"} from ${file.name}.`);
    } catch (err) {
      console.error(err);
      setStatusMessage("Could not parse that workbook.");
    } finally {
      event.target.value = "";
    }
  };

  const handleSyncFromSheets = async () => {
    setIsSyncing(true);
    const log = (msg: string) => {
      console.log(`[ShiftSync] ${msg}`);
      setStatusMessage(msg);
    };

    log("Loading sync settings...");
    try {
      const settings = await loadShiftSyncSettings();
      log(`Settings loaded. ${settings.sections.length} sections found.`);

      const linked = settings.sections.filter((s) => normalizeText(s.url));
      log(`${linked.length} sections have URLs configured: ${linked.map((s) => s.label).join(", ") || "none"}`);

      if (linked.length === 0) {
        log("No Google Sheets links configured. Go to Admin > Sync Settings to add links.");
        return;
      }

      let totalImported = 0;
      let failures = 0;
      const currentMap = new Map(rosters.map((r) => [r.sheet_name, r]));
      const allMerged: ShiftRoster[] = [];

      for (const section of linked) {
        try {
          log(`[${section.label}] Building download URL from: ${section.url}`);
          const downloadUrl = buildShiftDownloadUrl(section.url);
          if (!downloadUrl) {
            log(`[${section.label}] Could not build download URL — skipping.`);
            failures += 1;
            continue;
          }
          log(`[${section.label}] Download URL: ${downloadUrl}`);

          const proxyUrl = `/api/download-shift?url=${encodeURIComponent(section.url)}`;
          log(`[${section.label}] Fetching via proxy: ${proxyUrl}`);

          let buffer: ArrayBuffer | null = null;
          try {
            const resp = await fetch(proxyUrl);
            log(`[${section.label}] Proxy response: ${resp.status} ${resp.statusText}, content-type: ${resp.headers.get("content-type")}`);
            if (resp.ok) {
              buffer = await resp.arrayBuffer();
              log(`[${section.label}] Downloaded ${buffer.byteLength} bytes.`);
            } else {
              const errorBody = await resp.text().catch(() => "");
              log(`[${section.label}] Proxy failed: ${resp.status} — ${errorBody}`);
            }
          } catch (fetchErr) {
            log(`[${section.label}] Fetch error: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`);
          }

          if (!buffer || buffer.byteLength === 0) {
            log(`[${section.label}] No data received. Is the sheet publicly shared?`);
            failures += 1;
            continue;
          }

          log(`[${section.label}] Parsing XLSX...`);
          const imported = parseShiftWorkbook(buffer, `${section.label}.xlsx`);
          log(`[${section.label}] Parsed ${imported.length} sheet(s) with ${imported.reduce((sum, r) => sum + r.rows.length, 0)} total rows.`);

          for (const incoming of imported) {
            const merged = mergeShiftRosters(currentMap.get(incoming.sheet_name), incoming);
            currentMap.set(merged.sheet_name, merged);
            allMerged.push(merged);
            totalImported += 1;
          }
        } catch (err) {
          log(`[${section.label}] Error: ${err instanceof Error ? err.message : String(err)}`);
          console.error(`Sync failed for ${section.label}:`, err);
          failures += 1;
        }
      }

      if (allMerged.length > 0) {
        log(`Saving ${allMerged.length} synced roster(s)...`);
        const preserved = rosters.filter((r) => !allMerged.some((m) => m.sheet_name === r.sheet_name));
        const next = [...preserved, ...allMerged].sort((a, b) => a.sheet_name.localeCompare(b.sheet_name));
        setRosters(next);
        if (next[0]) setSelectedSheet((current) => current || next[0].sheet_name);
        await Promise.all(allMerged.map((r) => upsertShiftRoster(r)));
      }

      const parts: string[] = [];
      if (totalImported > 0) parts.push(`Synced ${totalImported} sheet${totalImported === 1 ? "" : "s"}`);
      if (failures > 0) parts.push(`${failures} failed`);
      log(parts.length > 0 ? parts.join(", ") + "." : "Sync complete — no sheets found.");
    } catch (err) {
      log(`Sync failed: ${err instanceof Error ? err.message : String(err)}`);
      console.error("Sync error:", err);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleCopy = async () => {
    if (!selectedRoster || !selectedCell) return;
    const row = selectedRoster.rows.find((item) => item.row_key === selectedCell.rowKey);
    if (!row) return;
    await navigator.clipboard.writeText(getCellValue(row, selectedCell.field, selectedCell.customKey));
    setStatusMessage("Copied cell.");
  };

  const handlePaste = async () => {
    if (!selectedRoster || !selectedCell) return;
    const text = await navigator.clipboard.readText();
    if (!text) return;

    const matrix = parseClipboardMatrix(text);
    const fields = getFields();
    const startRowIndex = orderedRows.findIndex((row) => row.row_key === selectedCell.rowKey);
    const startFieldIndex = fields.findIndex((field) => field === selectedCell.field);
    if (startRowIndex < 0 || startFieldIndex < 0) return;

    let nextRoster = selectedRoster;
    matrix.forEach((line, lineIndex) => {
      line.forEach((value, columnIndex) => {
        const row = orderedRows[startRowIndex + lineIndex];
        const field = fields[startFieldIndex + columnIndex];
        if (!row || !field || field === "week_label") return;
        nextRoster = updateRosterSingleCell(nextRoster, row.row_key, field as EditableField, value, undefined, "paste");
      });
    });

    await persistRoster(nextRoster, "Pasted clipboard data into shifts.");
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!selectedCell || editingCell) return;

    const rowIndex = orderedRows.findIndex((row) => row.row_key === selectedCell.rowKey);
    const fields = getFields();
    const fieldIndex = fields.findIndex((field) => field === selectedCell.field);

    if (event.ctrlKey && event.key.toLowerCase() === "c") {
      event.preventDefault();
      void handleCopy();
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === "v") {
      event.preventDefault();
      void handlePaste();
      return;
    }
    if (event.key === "Enter" || event.key === "F2") {
      event.preventDefault();
      setEditingCell(selectedCell);
      return;
    }
    if (event.key === "ArrowDown" && rowIndex < orderedRows.length - 1) {
      event.preventDefault();
      setSelectedCell({ ...selectedCell, rowKey: orderedRows[rowIndex + 1].row_key });
      return;
    }
    if (event.key === "ArrowUp" && rowIndex > 0) {
      event.preventDefault();
      setSelectedCell({ ...selectedCell, rowKey: orderedRows[rowIndex - 1].row_key });
      return;
    }
    if (event.key === "ArrowRight" && fieldIndex < fields.length - 1) {
      event.preventDefault();
      setSelectedCell({ ...selectedCell, field: fields[fieldIndex + 1] });
      return;
    }
    if (event.key === "ArrowLeft" && fieldIndex > 0) {
      event.preventDefault();
      setSelectedCell({ ...selectedCell, field: fields[fieldIndex - 1] });
    }
  };

  const handleAddGroup = async () => {
    if (!selectedRoster) return;
    await applyToSelectedRoster(addBlankGroup, "Added a shift group placeholder.");
  };

  const handleRemoveGroup = async () => {
    if (!selectedRoster || !selectedCell) return;
    await applyToSelectedRoster((roster) => removeGroup(roster, selectedCell.rowKey), "Removed shift group.");
    setSelectedCell(null);
    setEditingCell(null);
  };

  const handleMove = async (direction: -1 | 1) => {
    if (!selectedRoster || !selectedCell) return;
    await applyToSelectedRoster((roster) => moveGroup(roster, selectedCell.rowKey, direction), "Reordered shift group.");
  };

  const revealFullscreenControls = () => {
    setFullscreenControlsVisible(true);
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    if (fullscreenControlsTimerRef.current) window.clearTimeout(fullscreenControlsTimerRef.current);
    fullscreenControlsTimerRef.current = window.setTimeout(() => {
      setFullscreenControlsVisible(false);
    }, 2200);
  };

  const bringShiftSearchIntoView = () => {
    if (typeof window === "undefined") return;
    window.setTimeout(() => {
      shiftSearchRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 180);
  };

  const handleExportPdf = () => {
    if (!selectedRoster) return;

    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const title = selectedRoster.store_name || selectedRoster.sheet_name || "Shift roster";
    const pdfRows: string[][] = [];

    orderedRows.forEach((row, index) => {
      const previous = orderedRows[index - 1];
      if (previous && previous.week_number !== row.week_number) {
        pdfRows.push(new Array(13).fill(""));
      }

      pdfRows.push([
        row.week_label,
        row.employee_name,
        row.department,
        row.hr,
        row.employee_code,
        row.time_label,
        row.monday,
        row.tuesday,
        row.wednesday,
        row.thursday,
        row.friday,
        row.saturday,
        row.sunday,
      ]);
    });

    doc.setFontSize(18);
    doc.text(title, 40, 34);

    autoTable(doc, {
      startY: 52,
      styles: { fontSize: 8, cellPadding: 4, lineColor: [220, 228, 240], lineWidth: 0.5, valign: "middle" },
      headStyles: { fillColor: [23, 181, 230], textColor: [0, 0, 0], fontStyle: "bold" },
      head: [[
        "Week",
        "Employee",
        "Section",
        "HR",
        "Employee code",
        "Time",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
      ]],
      body: pdfRows,
      margin: { left: 24, right: 24 },
      didParseCell: (data) => {
        if (data.section !== "body") return;
        const rowValues = Array.isArray(data.row.raw) ? (data.row.raw as string[]) : [];
        const isSpacerRow = rowValues.every((value) => normalizeText(value) === "");
        if (isSpacerRow) {
          data.cell.styles.fillColor = [255, 255, 255];
          data.cell.styles.lineWidth = 0;
          data.cell.styles.minCellHeight = 10;
          data.cell.text = [];
          return;
        }

        const column = data.column.index;
        const cellValue = String(data.cell.raw ?? "").toUpperCase();
        if (column === 0) data.cell.styles.fillColor = [248, 171, 102];
        if (column >= 6 && column <= 10) data.cell.styles.fillColor = cellValue === "OFF" ? [255, 200, 214] : [240, 200, 234];
        if (column === 11) data.cell.styles.fillColor = [255, 230, 138];
        if (column === 12) data.cell.styles.fillColor = cellValue === "OFF" ? [255, 200, 214] : [255, 255, 255];
      },
    });

    doc.save(`${title.replace(/[^a-z0-9]+/gi, "_")}_shifts.pdf`);
    setStatusMessage("Shift-only PDF exported.");
  };

  return (
    <div className="min-w-0 space-y-4" onKeyDown={handleKeyDown} tabIndex={0}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white sm:text-2xl">Shift Grid</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Single click selects a cell, double click edits it, and Ctrl+C / Ctrl+V work like a spreadsheet.
          </p>
        </div>
        <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 xl:flex xl:w-auto xl:flex-wrap">
          <Button variant="outline" className="w-full xl:w-auto" onClick={() => fileInputRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" />
            Upload workbook
          </Button>
          <Button variant="outline" className="w-full xl:w-auto" onClick={handleSyncFromSheets} disabled={isSyncing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
            {isSyncing ? "Syncing..." : "Sync Sheets"}
          </Button>
          <Button variant="outline" className="w-full xl:w-auto" onClick={handleExportPdf} disabled={!selectedRoster}>
            <FileText className="mr-2 h-4 w-4" />
            Export PDF
          </Button>
          <Button variant="outline" className="w-full xl:w-auto" onClick={() => setShowFullscreen(true)} disabled={!selectedRoster}>
            <Expand className="mr-2 h-4 w-4" />
            Full screen
          </Button>
          <Button variant="outline" className="hidden sm:flex sm:flex-none" onClick={handleCopy} disabled={!selectedCell}>
            <Copy className="mr-2 h-4 w-4" />
            Copy cell
          </Button>
        </div>
      </div>

      <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleWorkbookUpload} />

      <div className="rounded-2xl border border-slate-700 bg-slate-900/50 p-2 shadow-sm">
        <div className="px-2 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              ref={shiftSearchRef}
              value={shiftSearch}
              onChange={(event) => setShiftSearch(event.target.value)}
              onFocus={bringShiftSearchIntoView}
              placeholder="Search shifts by store, employee name, or employee code..."
              className="pl-9 bg-slate-800 border-slate-600 text-white"
            />
          </div>
        </div>
        <div className="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredRosters.map((roster) => {
            const active = roster.sheet_name === selectedRoster?.sheet_name;
            return (
              <button
                key={roster.sheet_name}
                onClick={() => setSelectedSheet(roster.sheet_name)}
                className={`min-w-0 w-full max-w-full break-words rounded-xl border px-4 py-3 text-left text-sm font-medium transition ${
                  active ? "border-orange-300 bg-orange-50 text-orange-800" : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                }`}
              >
                {roster.store_name || roster.sheet_name}
              </button>
            );
          })}
        </div>
        <div className="px-2 pt-2 text-xs text-slate-500">{statusMessage}</div>
      </div>

      <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-200 pb-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
              <div className="flex flex-wrap items-center gap-3">
                <CardTitle className="text-base font-semibold text-slate-900 sm:text-lg">
                  {selectedRoster?.sheet_name || "No workbook selected"}
                </CardTitle>
                <Button variant="outline" size="sm" onClick={() => setShowDetails((current) => !current)} disabled={!selectedRoster}>
                  {showDetails ? <ChevronDown className="mr-2 h-4 w-4" /> : <ChevronRight className="mr-2 h-4 w-4" />}
                  {showDetails ? "Collapse" : "Expand"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowFullscreen(true)} disabled={!selectedRoster}>
                  <Expand className="mr-2 h-4 w-4" />
                  Full screen view
                </Button>
              </div>
              <CardDescription className="text-slate-500">
                {selectedRoster ? `${selectedRoster.rows.length} shift rows | ${rowGroups.length} groups` : "Upload a workbook to start"}
              </CardDescription>
            </div>
            <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 xl:flex xl:w-auto xl:flex-wrap">
              <Button variant="outline" className="w-full xl:w-auto" onClick={handleAddGroup} disabled={!selectedRoster}>
                <Plus className="mr-2 h-4 w-4" />
                Add row group
              </Button>
              <Button variant="outline" className="w-full xl:w-auto" onClick={() => void handleMove(-1)} disabled={!selectedCell}>
                <ArrowUp className="mr-2 h-4 w-4" />
                Move up
              </Button>
              <Button variant="outline" className="w-full xl:w-auto" onClick={() => void handleMove(1)} disabled={!selectedCell}>
                <ArrowDown className="mr-2 h-4 w-4" />
                Move down
              </Button>
              <Button variant="outline" className="w-full xl:w-auto" onClick={handleRemoveGroup} disabled={!selectedCell}>
                <Trash2 className="mr-2 h-4 w-4" />
                Remove group
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {!selectedRoster ? (
            <div className="p-10 text-center text-slate-500">Upload a workbook to start editing shifts.</div>
          ) : (
            <>
              <div className="grid gap-3 p-3 md:hidden">
                {orderedRows.map((row) => (
                  <div key={`${row.row_key}-mobile-main`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{row.week_label}</div>
                        <div className="mt-1 break-words text-base font-semibold text-slate-900">{row.employee_name || "Blank"}</div>
                        <div className="mt-1 break-words text-sm text-slate-500">
                          {row.employee_code || "No code"} • {row.department || "No department"}
                        </div>
                      </div>
                      <div className="rounded-full border border-slate-300 bg-white px-3 py-1 text-sm font-semibold text-slate-900">
                        {formatHours(getWeekTotal(row))}h
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {DAY_COLUMNS.map((day) => (
                        <div key={`${row.row_key}-${day.key}-mobile-main-day`} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                          <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{day.label}</div>
                          <div className="mt-1 text-sm font-medium text-slate-900">{getCellValue(row, day.key) || "-"}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div ref={tableWrapRef} className="hidden w-full max-w-full overflow-x-auto overscroll-x-contain md:block">
                  <table className="w-full min-w-[1240px] border-collapse table-fixed xl:min-w-[1320px]">
                  <colgroup>
                    <col className="w-[96px]" />
                    <col className="w-[240px]" />
                    <col className="w-[120px]" />
                    <col className="w-[68px]" />
                    <col className="w-[132px]" />
                    <col className="w-[88px]" />
                    <col className="w-[98px]" />
                    <col className="w-[98px]" />
                    <col className="w-[112px]" />
                    <col className="w-[98px]" />
                    <col className="w-[98px]" />
                    <col className="w-[104px]" />
                    <col className="w-[104px]" />
                  </colgroup>
                  <thead>
                  <tr className="h-14">
                    <th colSpan={3} className={`border border-slate-200 px-3 py-2 text-left text-sm font-bold tracking-wide ${TITLE_BAND}`}>
                      {selectedRoster?.sheet_name || "Shift roster"}
                    </th>
                    <th className="w-[68px] border border-slate-200 bg-white px-3 py-2 text-center text-sm font-bold uppercase tracking-wide text-slate-900">
                      HR
                    </th>
                    <th className="w-[132px] border border-slate-200 bg-white px-3 py-2 text-center text-sm font-bold uppercase tracking-wide text-slate-900">
                      Employee code
                    </th>
                    <th className="w-[88px] border border-slate-200 bg-white px-3 py-2 text-center text-sm font-bold uppercase tracking-wide text-slate-900">
                      Time
                    </th>
                    {DAY_COLUMNS.map((day) => (
                      <th
                        key={day.key}
                        className={`border border-slate-200 px-3 py-2 text-center text-sm font-bold uppercase tracking-wide ${
                          isWeekday(day.key) ? "bg-white text-slate-900" : WEEKEND_HEADER
                        }`}
                      >
                        {day.label}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {orderedRows.map((row, index) => {
                    const isSelectedGroup = selectedCell ? row.group_key === selectedRoster.rows.find((item) => item.row_key === selectedCell.rowKey)?.group_key : false;
                    const rowBg = "bg-white";
                    const previous = orderedRows[index - 1];
                    const spacer = previous && previous.week_number !== row.week_number;

                    return (
                      <React.Fragment key={row.row_key}>
                        {spacer && (
                          <tr>
                            <td colSpan={13} className="h-4 bg-white p-0" />
                          </tr>
                        )}
                        <tr className={rowBg} data-shift-row-key={row.row_key}>
                          <td className="border border-slate-200 bg-orange-50 px-2 py-1 align-middle">
                            <button
                              type="button"
                              onClick={() => setSelectedCell({ rowKey: row.row_key, field: "week_label" })}
                              onDoubleClick={() => setEditingCell({ rowKey: row.row_key, field: "week_label" })}
                              className="flex h-8 w-full items-center justify-start rounded-none bg-[#f8ab66] px-2 text-left text-base font-normal uppercase leading-tight text-black"
                            >
                              {row.week_label}
                            </button>
                          </td>

                          {[
                            { field: "employee_name", tdClass: "bg-white", buttonClass: "min-h-[3rem] whitespace-normal break-words leading-tight text-center text-black" },
                            { field: "department", tdClass: "bg-white", buttonClass: "min-h-[3rem] whitespace-normal break-words leading-tight text-center text-black" },
                            { field: "hr", tdClass: "bg-white", buttonClass: "min-h-[3rem] text-center text-black" },
                            { field: "employee_code", tdClass: "bg-white", buttonClass: "min-h-[3rem] whitespace-normal break-words leading-tight text-center text-black" },
                            { field: "time_label", tdClass: "bg-white", buttonClass: "min-h-[3rem] text-center text-black" },
                          ].map((column) => {
                            const field = column.field as EditableField;
                            const value = getCellValue(row, field);
                            const selected = selectedCell?.rowKey === row.row_key && selectedCell.field === field && !selectedCell.customKey;
                            const editing = editingCell?.rowKey === row.row_key && editingCell.field === field && !editingCell.customKey;

                            return (
                              <td key={`${row.row_key}-${field}`} className={`border border-slate-200 px-2 py-1 align-middle ${column.tdClass}`}>
                                {editing ? (
                                  <Input
                                    autoFocus
                                    value={value}
                                    onChange={(event) => {
                                      const nextValue = event.target.value;
                                      setRosters((current) =>
                                        current.map((roster) =>
                                          roster.sheet_name === selectedRoster.sheet_name
                                            ? normalizeRoster(updateRosterGroup(roster, row.row_key, field, nextValue, undefined, "edit"))
                                            : roster
                                        )
                                      );
                                    }}
                                    onBlur={(event) => {
                                      if (!selectedRoster) return;
                                      void persistRoster(updateRosterGroup(selectedRoster, row.row_key, field, event.target.value, undefined, "edit"), "Shift cell updated.");
                                      setEditingCell(null);
                                    }}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") {
                                        event.preventDefault();
                                        void persistRoster(updateRosterGroup(selectedRoster!, row.row_key, field, (event.target as HTMLInputElement).value, undefined, "edit"), "Shift cell updated.");
                                        setEditingCell(null);
                                      }
                                      if (event.key === "Escape") setEditingCell(null);
                                    }}
                                    className="min-h-[3rem] rounded-none border-slate-300 bg-white text-center text-sm"
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setSelectedCell({ rowKey: row.row_key, field })}
                                    onDoubleClick={() => setEditingCell({ rowKey: row.row_key, field })}
                                    className={`flex h-auto min-h-[3rem] w-full items-center justify-center rounded-none px-2 py-1 text-sm transition ${
                                      selected ? "ring-2 ring-slate-900" : isSelectedGroup ? "ring-1 ring-slate-300" : ""
                                    } ${column.buttonClass || ""}`}
                                  >
                                    {value || ""}
                                  </button>
                                )}
                              </td>
                            );
                          })}

                          {DAY_COLUMNS.map((day) => {
                            const value = getCellValue(row, day.key);
                            const selected = selectedCell?.rowKey === row.row_key && selectedCell.field === day.key && !selectedCell.customKey;
                            const editing = editingCell?.rowKey === row.row_key && editingCell.field === day.key && !editingCell.customKey;
                            const bg = getDayCellClass(day.key, value);

                            return (
                              <td key={`${row.row_key}-${day.key}`} className={`border border-slate-200 px-2 py-2 align-middle ${bg}`}>
                                {editing ? (
                                  <Input
                                    autoFocus
                                    value={getEditorValue(row, day.key as EditableField)}
                                    onChange={(event) => {
                                      const nextValue = getStoredDayValue(row, day.key as EditableField, event.target.value);
                                      setRosters((current) =>
                                        current.map((roster) =>
                                          roster.sheet_name === selectedRoster.sheet_name
                                            ? normalizeRoster(updateRosterGroup(roster, row.row_key, day.key as EditableField, nextValue, undefined, "edit"))
                                            : roster
                                        )
                                      );
                                    }}
                                    onBlur={(event) => {
                                      if (!selectedRoster) return;
                                      void persistRoster(
                                        updateRosterGroup(
                                          selectedRoster,
                                          row.row_key,
                                          day.key as EditableField,
                                          getStoredDayValue(row, day.key as EditableField, event.target.value),
                                          undefined,
                                          "edit"
                                        ),
                                        "Shift cell updated."
                                      );
                                      setEditingCell(null);
                                    }}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") {
                                        event.preventDefault();
                                        void persistRoster(
                                          updateRosterGroup(
                                            selectedRoster!,
                                            row.row_key,
                                            day.key as EditableField,
                                            getStoredDayValue(row, day.key as EditableField, (event.target as HTMLInputElement).value),
                                            undefined,
                                            "edit"
                                          ),
                                          "Shift cell updated."
                                        );
                                        setEditingCell(null);
                                      }
                                      if (event.key === "Escape") setEditingCell(null);
                                    }}
                                    className="h-8 rounded-none border-slate-300 bg-white text-center text-sm"
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setSelectedCell({ rowKey: row.row_key, field: day.key })}
                                    onDoubleClick={() => setEditingCell({ rowKey: row.row_key, field: day.key })}
                                    className={`flex h-8 w-full items-center justify-center rounded-none px-2 text-sm transition ${
                                      selected ? "ring-2 ring-slate-900" : ""
                                    } ${bg}`}
                                  >
                                    {value || ""}
                                  </button>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      </React.Fragment>
                    );
                  })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {showFullscreen && selectedRoster && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-sm"
          onTouchStart={revealFullscreenControls}
          onMouseMove={revealFullscreenControls}
          onClick={revealFullscreenControls}
        >
          <div className="flex h-full flex-col">
            <div
              className={`fixed right-4 top-4 z-10 flex flex-wrap items-center justify-end gap-2 transition-all duration-300 sm:right-6 sm:top-6 ${
                fullscreenControlsVisible ? "translate-y-0 opacity-100" : "-translate-y-3 opacity-0 pointer-events-none"
              }`}
            >
              <div className="flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-slate-700/80 bg-slate-950/85 p-2 shadow-2xl backdrop-blur">
                <Button variant="outline" className="sm:flex-none" onClick={handleExportPdf}>
                  <Download className="mr-2 h-4 w-4" />
                  Download PDF
                </Button>
                <Button variant="outline" className="sm:flex-none" onClick={() => setShowFullscreen(false)}>
                  <X className="mr-2 h-4 w-4" />
                  Exit
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-16 sm:px-6 sm:py-20">
              <div className="mx-auto max-w-7xl">
                <div className="mx-auto max-w-6xl bg-white p-4 shadow-2xl sm:p-8">
                  <div className="mb-5">
                    <h3 className="text-2xl font-semibold text-slate-900 sm:text-3xl">
                      {selectedRoster.store_name || selectedRoster.sheet_name}
                    </h3>
                    <div className="mt-2 text-sm text-slate-500">
                      {selectedRoster.rows.length} rows • {rowGroups.length} groups
                    </div>
                  </div>

                  <div className="grid gap-3 lg:hidden">
                  {orderedRows.map((row) => (
                    <div key={`${row.row_key}-fullscreen-mobile`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-base font-semibold text-slate-900">{row.employee_name || "Blank"}</div>
                          <div className="mt-1 text-sm text-slate-500">
                            {row.employee_code || "No code"} • {row.week_label}
                          </div>
                        </div>
                        <div className="rounded-full border border-slate-300 bg-white px-3 py-1 text-sm font-semibold text-slate-900">
                          {formatHours(getWeekTotal(row))}h
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                        {DAY_COLUMNS.map((day) => (
                          <div key={`${row.row_key}-${day.key}-fs-mobile`} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">{day.label}</div>
                            <div className="mt-1 font-medium text-slate-900">{getCellValue(row, day.key) || "-"}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                  <div className="hidden overflow-x-auto bg-white lg:block">
                  <table className="min-w-[1180px] w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-100">
                        <th className="border border-slate-200 bg-[#f8ab66] px-3 py-3 text-left text-black">Week</th>
                        <th className="border border-slate-200 px-3 py-3 text-left">Employee</th>
                        <th className="border border-slate-200 px-3 py-3 text-left">Department</th>
                        <th className="border border-slate-200 px-3 py-3 text-center">HR</th>
                        <th className="border border-slate-200 px-3 py-3 text-left">Code</th>
                        <th className="border border-slate-200 px-3 py-3 text-left">Time</th>
                        {DAY_COLUMNS.map((day) => (
                          <th
                            key={`${day.key}-fullscreen-header`}
                            className={`border border-slate-200 px-3 py-3 text-center ${isWeekday(day.key) ? "bg-white" : WEEKEND_HEADER}`}
                          >
                            {day.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {orderedRows.map((row) => (
                        <tr key={`${row.row_key}-fullscreen-desktop`} className="bg-white">
                          <td className="border border-slate-200 bg-[#f8ab66] px-3 py-2 text-black">{row.week_label}</td>
                          <td className="border border-slate-200 px-3 py-2 font-medium">{row.employee_name || "Blank"}</td>
                          <td className="border border-slate-200 px-3 py-2">{row.department || "-"}</td>
                          <td className="border border-slate-200 px-3 py-2 text-center">{row.hr || "-"}</td>
                          <td className="border border-slate-200 px-3 py-2">{row.employee_code || "-"}</td>
                          <td className="border border-slate-200 px-3 py-2">{row.time_label || "-"}</td>
                          {DAY_COLUMNS.map((day) => (
                            <td
                              key={`${row.row_key}-${day.key}-fullscreen-desktop`}
                              className={`border border-slate-200 px-3 py-2 text-center ${getDayCellClass(day.key, getCellValue(row, day.key))}`}
                            >
                              {getCellValue(row, day.key) || "-"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDetails && selectedRow && (
        <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-200 pb-4">
            <CardTitle className="text-base font-semibold text-slate-900">Expanded shift hours</CardTitle>
            <CardDescription className="text-slate-500">
              Hidden hours, weekly totals, and overall merchandiser totals only show here when expanded.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4">
            <div className="grid gap-3 md:hidden">
              {detailedRows.map((item) => (
                <div key={`${item.row.row_key}-hours-mobile`} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-slate-900">{item.row.employee_name || "Blank"}</div>
                      <div className="text-xs text-slate-500">
                        {item.row.week_label} • {item.row.employee_code || "Blank"}
                      </div>
                    </div>
                    <div className="text-sm font-semibold text-slate-900">{formatHours(item.weekTotal)}h</div>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {item.dailyHours.map((day) => (
                      <div key={`${item.row.row_key}-${day.key}-mobile`} className="rounded-lg bg-white px-3 py-2 text-sm">
                        <div className="text-xs uppercase tracking-wide text-slate-400">{day.label}</div>
                        <div className="mt-1 font-medium text-slate-900">{formatHours(day.hours)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden w-full max-w-full overflow-x-auto rounded-xl border border-slate-200 overscroll-x-contain md:block">
              <table className="w-full min-w-[980px] border-collapse text-sm lg:min-w-[1180px]">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="border border-slate-200 px-3 py-2 text-left">Week</th>
                    <th className="border border-slate-200 px-3 py-2 text-left">Employee</th>
                    <th className="border border-slate-200 px-3 py-2 text-left">Code</th>
                    {DAY_COLUMNS.map((day) => (
                      <th key={day.key} className="border border-slate-200 px-3 py-2 text-center">
                        {day.label}
                      </th>
                    ))}
                    <th className="border border-slate-200 px-3 py-2 text-center">Week total</th>
                  </tr>
                </thead>
                <tbody>
                  {detailedRows.map((item) => (
                    <tr key={`${item.row.row_key}-hours`} className="bg-white">
                      <td className="border border-slate-200 px-3 py-2">{item.row.week_label}</td>
                      <td className="border border-slate-200 px-3 py-2">{item.row.employee_name || "Blank"}</td>
                      <td className="border border-slate-200 px-3 py-2">{item.row.employee_code || "Blank"}</td>
                      {item.dailyHours.map((day) => (
                        <td key={`${item.row.row_key}-${day.key}-hours`} className="border border-slate-200 px-3 py-2 text-center">
                          {formatHours(day.hours)}
                        </td>
                      ))}
                      <td className="border border-slate-200 px-3 py-2 text-center font-semibold">{formatHours(item.weekTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Weekly merchandiser totals</div>
                <div className="mt-3 space-y-4 text-sm text-slate-700">
                  {Array.from(weeklyTotals.entries())
                    .sort((a, b) => a[0] - b[0])
                    .map(([week, totals]) => (
                      <div key={`weekly-total-${week}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="mb-2 font-semibold text-slate-900">Week {week}</div>
                        <div className="space-y-2">
                          {totals.map((item) => (
                            <div key={`${week}-${item.employeeCode}`} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2">
                              <div>
                                <div className="font-medium text-slate-900">{item.employeeName}</div>
                                <div className="text-xs text-slate-500">{item.employeeCode}</div>
                              </div>
                              <div className="text-sm font-semibold text-slate-900">{formatHours(item.totalHours)}h</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Weeks 1-4 totals</div>
                <div className="mt-3 space-y-2 text-sm text-slate-700">
                  {grandTotals.map((item) => (
                    <div key={item.employeeCode} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <div>
                        <div className="font-medium text-slate-900">{item.employeeName}</div>
                        <div className="text-xs text-slate-500">{item.employeeCode}</div>
                      </div>
                      <div className="text-sm font-semibold text-slate-900">{formatHours(item.totalHours)}h</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Shift logs</div>
                  <div className="text-sm text-slate-500">Latest changes for the selected row.</div>
                </div>
                <Badge className="bg-slate-100 text-slate-700">{selectedRow.logs.length} logs</Badge>
              </div>
              <div className="mt-4 space-y-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  <div>Selected employee: {selectedRow.employee_name || "Blank"}</div>
                  <div>Employee code: {selectedRow.employee_code || "Blank"}</div>
                  <div>Week total: {formatHours(getWeekTotal(selectedRow))}h</div>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                  {selectedRow.logs.length === 0 ? (
                    <div className="rounded-xl border border-dashed p-4 text-sm text-slate-500">No logs yet.</div>
                  ) : (
                    selectedRow.logs.slice(-4).reverse().map((log) => (
                      <div key={log.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className="bg-slate-900 text-white">{log.source}</Badge>
                          <span className="text-slate-500">{new Date(log.timestamp).toLocaleString()}</span>
                        </div>
                        <div className="mt-1 font-medium text-slate-700">{log.field}</div>
                        <div className="mt-1 text-slate-600">
                          {log.before || "blank"}{" -> "}{log.after || "blank"}
                        </div>
                      </div>
                    ))
                  )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

    </div>
  );
}


