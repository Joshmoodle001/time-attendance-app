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
  FileText,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  ZoomIn,
  ZoomOut,
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

function getGroupRows(roster: ShiftRoster | null) {
  if (!roster) return [];
  const groups = new Map<string, ShiftRow[]>();
  roster.rows.forEach((row) => {
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

type ShiftBuilderProps = {
  readOnly?: boolean;
};

export default function ShiftBuilder({ readOnly = false }: ShiftBuilderProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const [rosters, setRosters] = useState<ShiftRoster[]>([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [shiftSearch, setShiftSearch] = useState("");
  const [selectedCell, setSelectedCell] = useState<CellPosition | null>(null);
  const [editingCell, setEditingCell] = useState<CellPosition | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Load a workbook to build shifts.");
  const [zoomLevel, setZoomLevel] = useState(1);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncStatus, setSyncStatus] = useState("");
  const isInitialLoadRef = useRef(true);
  const prevSelectedSheetRef = useRef<string>("");
  const scrollPositionRef = useRef<number>(0);
  const hasAutoSyncRef = useRef(false);
  const lastSyncCheckRef = useRef<string>("");

  useEffect(() => {
    if (readOnly) {
      setEditingCell(null);
    }
  }, [readOnly]);

  // Auto-sync on page load
  useEffect(() => {
    if (readOnly) return;
    if (hasAutoSyncRef.current) return;
    hasAutoSyncRef.current = true;
    
    // Delay sync slightly to allow initial render
    const timer = setTimeout(() => {
      void handleSyncFromSheets();
    }, 1500);
    
    return () => clearTimeout(timer);
  }, [readOnly]);

  // Poll for live sync events and trigger sync when detected
  useEffect(() => {
    if (readOnly) return;
    let alive = true;
    let pollInterval: ReturnType<typeof setInterval>;

    const checkForLiveSync = async () => {
      try {
        const settings = await loadShiftSyncSettings();
        if (!alive) return;
        
        // If live sync is enabled, poll more frequently
        if (settings.liveSyncEnabled) {
          const lastLiveSync = settings.lastLiveSyncedAt;
          if (lastLiveSync && lastLiveSync !== lastSyncCheckRef.current) {
            lastSyncCheckRef.current = lastLiveSync;
            console.log("[ShiftBuilder] Live sync detected, refreshing shifts...");
            void handleSyncFromSheets();
          }
        }
      } catch (e) {
        // Ignore polling errors
      }
    };

    // Check every 10 seconds when live sync is enabled
    pollInterval = setInterval(checkForLiveSync, 10000);

    return () => {
      alive = false;
      clearInterval(pollInterval);
    };
  }, [readOnly]);

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

  const orderedRows = useMemo(
    () => (selectedRoster ? [...selectedRoster.rows].sort((a, b) => a.week_number - b.week_number || a.order_index - b.order_index) : []),
    [selectedRoster]
  );

  const rowGroups = useMemo(() => getGroupRows(selectedRoster), [selectedRoster]);
  const shiftSearchResults = useMemo(() => {
    const query = normalizeText(shiftSearch).toLowerCase();
    if (!query) return [];

    const results: Array<{
      id: string;
      type: "store" | "employee";
      sheetName: string;
      title: string;
      subtitle: string;
      rowKey?: string;
    }> = [];

    rosters.forEach((roster) => {
      const storeLabel = `${roster.store_name} ${roster.sheet_name} ${roster.store_code}`.toLowerCase();
      if (storeLabel.includes(query)) {
        results.push({
          id: `store-${roster.sheet_name}`,
          type: "store",
          sheetName: roster.sheet_name,
          title: roster.store_name || roster.sheet_name,
          subtitle: roster.store_code ? `Store code ${roster.store_code}` : "Shift roster",
        });
      }

      roster.rows.forEach((row) => {
        const haystack = `${row.employee_name} ${row.employee_code} ${row.department} ${row.week_label} ${roster.store_name}`.toLowerCase();
        if (haystack.includes(query)) {
          results.push({
            id: `employee-${roster.sheet_name}-${row.row_key}`,
            type: "employee",
            sheetName: roster.sheet_name,
            rowKey: row.row_key,
            title: row.employee_name || row.employee_code || "Unnamed merchandiser",
            subtitle: `${row.employee_code || "No code"} • ${row.week_label} • ${roster.store_name || roster.sheet_name}`,
          });
        }
      });
    });

    return results.slice(0, 10);
  }, [rosters, shiftSearch]);
  const selectedRow = useMemo(
    () => (selectedRoster && selectedCell ? selectedRoster.rows.find((row) => row.row_key === selectedCell.rowKey) || null : selectedRoster?.rows[0] || null),
    [selectedRoster, selectedCell]
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
    if (readOnly) {
      setStatusMessage("Shift editing is disabled for this role. You can only view and search.");
      return;
    }
    setRosters((current) => current.map((roster) => (roster.sheet_name === nextRoster.sheet_name ? nextRoster : roster)));
    const result = await upsertShiftRoster(nextRoster);
    setStatusMessage(result.success ? message : `Saved locally, but failed to persist: ${result.error || "unknown error"}`);
  };

  const applyToSelectedRoster = async (updater: (roster: ShiftRoster) => ShiftRoster, message: string) => {
    if (!selectedRoster) return;
    await persistRoster(updater(selectedRoster), message);
  };

  const handleWorkbookUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (readOnly) {
      event.target.value = "";
      setStatusMessage("Shift upload is disabled for this role.");
      return;
    }
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
    if (readOnly) return;
    setIsSyncing(true);
    setSyncProgress(0);
    const log = (msg: string) => {
      console.log(`[ShiftSync] ${msg}`);
      setSyncStatus(msg);
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
        setIsSyncing(false);
        return;
      }

      let totalImported = 0;
      let failures = 0;
      let currentProgress = 0;
      const progressStep = 100 / linked.length;
      const currentMap = new Map(rosters.map((r) => [r.sheet_name, r]));
      const allMerged: ShiftRoster[] = [];

      for (const section of linked) {
        currentProgress += progressStep;
        setSyncProgress(Math.round(currentProgress));
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

      setSyncProgress(90);
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
      setSyncProgress(100);
    } catch (err) {
      log(`Sync failed: ${err instanceof Error ? err.message : String(err)}`);
      console.error("Sync error:", err);
    } finally {
      setIsSyncing(false);
      setSyncProgress(0);
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
    if (readOnly) return;
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
      if (readOnly) return;
      event.preventDefault();
      void handlePaste();
      return;
    }
    if (event.key === "Enter" || event.key === "F2") {
      if (readOnly) return;
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
    if (readOnly) return;
    if (!selectedRoster) return;
    await applyToSelectedRoster(addBlankGroup, "Added a shift group placeholder.");
  };

  const handleRemoveGroup = async () => {
    if (readOnly) return;
    if (!selectedRoster || !selectedCell) return;
    await applyToSelectedRoster((roster) => removeGroup(roster, selectedCell.rowKey), "Removed shift group.");
    setSelectedCell(null);
    setEditingCell(null);
  };

  const handleMove = async (direction: -1 | 1) => {
    if (readOnly) return;
    if (!selectedRoster || !selectedCell) return;
    await applyToSelectedRoster((roster) => moveGroup(roster, selectedCell.rowKey, direction), "Reordered shift group.");
  };

  const handleDownloadJson = () => {
    if (!selectedRoster) return;
    const blob = new Blob([JSON.stringify(selectedRoster, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selectedRoster.sheet_name}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleZoomOut = () => {
    setZoomLevel((current) => Math.max(0.7, Number((current - 0.1).toFixed(2))));
  };

  const handleZoomIn = () => {
    setZoomLevel((current) => Math.min(1.4, Number((current + 0.1).toFixed(2))));
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

  const handleShiftSearchGo = (result: { sheetName: string; rowKey?: string }) => {
    setSelectedSheet(result.sheetName);
    if (result.rowKey) {
      setSelectedCell({ rowKey: result.rowKey, field: "employee_name" });
      window.setTimeout(() => {
        const target = tableWrapRef.current?.querySelector<HTMLElement>(`[data-shift-row-key="${result.rowKey}"]`);
        target?.scrollIntoView({ block: "center", inline: "nearest" });
      }, 80);
    }
  };

  return (
    <div className="min-w-0 space-y-4" onKeyDown={handleKeyDown} tabIndex={0}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white sm:text-2xl">Shift Grid</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            {readOnly
              ? "View and search shift rosters. Editing, uploads, and row-group changes are disabled for your role."
              : "Single click selects a cell, double click edits it, and Ctrl+C / Ctrl+V work like a spreadsheet."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={handleZoomOut} disabled={zoomLevel <= 0.7}>
            <ZoomOut className="mr-2 h-4 w-4" />
            Zoom out
          </Button>
          <Button variant="outline" className="min-w-[92px] flex-1 sm:flex-none" onClick={() => setZoomLevel(1)}>
            {Math.round(zoomLevel * 100)}%
          </Button>
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={handleZoomIn} disabled={zoomLevel >= 1.4}>
            <ZoomIn className="mr-2 h-4 w-4" />
            Zoom in
          </Button>
          {!readOnly && (
            <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => fileInputRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" />
              Upload workbook
            </Button>
          )}
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={handleExportPdf} disabled={!selectedRoster}>
            <FileText className="mr-2 h-4 w-4" />
            Export PDF
          </Button>
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={handleDownloadJson} disabled={!selectedRoster}>
            <Download className="mr-2 h-4 w-4" />
            Download JSON
          </Button>
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={handleCopy} disabled={!selectedCell}>
            <Copy className="mr-2 h-4 w-4" />
            Copy cell
          </Button>
        </div>
      </div>

      {!readOnly && <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleWorkbookUpload} />}

      {isSyncing && (
        <div className="rounded-2xl border border-cyan-500/30 bg-gradient-to-r from-cyan-500/10 to-purple-500/10 p-4">
          <div className="flex items-center gap-3 mb-2">
            <RefreshCw className="h-5 w-5 animate-spin text-cyan-400" />
            <span className="text-sm font-medium text-white">Syncing from Google Sheets...</span>
            <span className="ml-auto text-sm font-mono text-cyan-400">{syncProgress}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-slate-700 overflow-hidden">
            <div 
              className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-purple-500 transition-all duration-300"
              style={{ width: `${syncProgress}%` }}
            />
          </div>
          <div className="mt-2 text-xs text-slate-400">{syncStatus}</div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-700 bg-slate-900/50 p-2 shadow-sm">
        <div className="px-2 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={shiftSearch}
              onChange={(event) => setShiftSearch(event.target.value)}
              placeholder="Search shifts by store, employee name, or employee code..."
              className="pl-9 bg-slate-800 border-slate-600 text-white"
            />
          </div>
          {shiftSearchResults.length > 0 && (
            <div className="mt-2 grid gap-2 lg:grid-cols-2">
              {shiftSearchResults.map((result) => (
                <button
                  key={result.id}
                  type="button"
                  onClick={() => handleShiftSearchGo(result)}
                  className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left transition hover:bg-slate-100"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">{result.title}</div>
                    <div className="truncate text-xs text-slate-500">{result.subtitle}</div>
                  </div>
                  <span className="ml-3 shrink-0 text-xs font-semibold uppercase tracking-wide text-orange-700">
                    Go
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-2 overflow-x-auto">
          {rosters.map((roster) => {
            const active = roster.sheet_name === selectedRoster?.sheet_name;
            return (
              <button
                key={roster.sheet_name}
                onClick={() => setSelectedSheet(roster.sheet_name)}
                className={`whitespace-nowrap rounded-xl border px-4 py-2 text-sm font-medium transition ${
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
              </div>
              <CardDescription className="text-slate-500">
                {selectedRoster ? `${selectedRoster.rows.length} shift rows | ${rowGroups.length} groups` : "Upload a workbook to start"}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              {!readOnly && (
                <>
                  <Button variant="outline" className="flex-1 sm:flex-none" onClick={handleAddGroup} disabled={!selectedRoster}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add row group
                  </Button>
                  <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => void handleMove(-1)} disabled={!selectedCell}>
                    <ArrowUp className="mr-2 h-4 w-4" />
                    Move up
                  </Button>
                  <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => void handleMove(1)} disabled={!selectedCell}>
                    <ArrowDown className="mr-2 h-4 w-4" />
                    Move down
                  </Button>
                  <Button variant="outline" className="flex-1 sm:flex-none" onClick={handleRemoveGroup} disabled={!selectedCell}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Remove group
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {!selectedRoster ? (
            <div className="p-10 text-center text-slate-500">Upload a workbook to start editing shifts.</div>
          ) : (
            <>
              <div className="grid gap-3 p-3 md:hidden">
                {!readOnly ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    Mobile uses a compact shift card view for speed. Full spreadsheet editing remains available on tablet/desktop.
                  </div>
                ) : null}
                {orderedRows.map((row) => {
                  const selected = selectedCell?.rowKey === row.row_key;
                  return (
                    <button
                      key={`${row.row_key}-mobile-card`}
                      type="button"
                      onClick={() => setSelectedCell({ rowKey: row.row_key, field: "employee_name" })}
                      className={`rounded-xl border p-3 text-left ${
                        selected ? "border-cyan-400 bg-cyan-50" : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900">{row.employee_name || "Blank"}</div>
                          <div className="mt-0.5 text-xs text-slate-500">
                            {row.week_label} | {row.employee_code || "No code"} | {row.time_label || "No time"}
                          </div>
                        </div>
                        <div className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                          {formatHours(getWeekTotal(row))}h
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        {DAY_COLUMNS.map((day) => (
                          <div key={`${row.row_key}-${day.key}-mobile`} className="rounded-lg bg-slate-50 px-2 py-1.5">
                            <div className="uppercase tracking-wide text-slate-400">{day.label}</div>
                            <div className="mt-0.5 font-medium text-slate-900">{getCellValue(row, day.key) || "-"}</div>
                          </div>
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div ref={tableWrapRef} className="mobile-table-wrap hidden w-full max-w-full overflow-x-auto overscroll-x-contain md:block">
                <div style={{ zoom: zoomLevel } as React.CSSProperties}>
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
                              onDoubleClick={readOnly ? undefined : () => setEditingCell({ rowKey: row.row_key, field: "week_label" })}
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
                                {editing && !readOnly ? (
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
                                    onDoubleClick={readOnly ? undefined : () => setEditingCell({ rowKey: row.row_key, field })}
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
                                {editing && !readOnly ? (
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
                                    onDoubleClick={readOnly ? undefined : () => setEditingCell({ rowKey: row.row_key, field: day.key })}
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
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {showDetails && selectedRow && (
        <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-200 pb-4">
            <CardTitle className="text-base font-semibold text-slate-900">Expanded shift hours</CardTitle>
            <CardDescription className="text-slate-500">
              Hidden hours, weekly totals, and overall merchandiser totals only show here when expanded.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4">
            <div className="grid gap-3 md:hidden" style={{ zoom: zoomLevel } as React.CSSProperties}>
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
                  <div className="mt-3 grid grid-cols-2 gap-2">
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
              <div style={{ zoom: zoomLevel } as React.CSSProperties}>
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
