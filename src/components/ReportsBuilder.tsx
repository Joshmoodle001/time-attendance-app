import { useEffect, useMemo, useState } from "react";
import { Building2, CalendarRange, Printer, Search, Download, RefreshCw, UserRound, WandSparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  getAttendanceByDateRange,
  getAvailableDates,
  normalizeEmployeeCode,
  type AttendanceRecord,
  type Employee,
} from "@/services/database";
import { getClockEventsForDateRange, type BiometricClockEvent } from "@/services/clockData";
import { getCombinedCalendarEvents, getWeekEventForDate } from "@/services/calendar";
import {
  getShiftRosters,
  initializeShiftDatabase,
  type ShiftDayKey,
  type ShiftRoster,
  type ShiftRow,
} from "@/services/shifts";
import {
  buildAppliedLeaveLookup,
  getAppliedLeaveApplications,
  getFallbackLeaveLookupKey,
  getSheetScopedLeaveLookupKey,
  initializeLeaveDatabase,
  type LeaveApplication,
} from "@/services/leave";

type JsPdfConstructor = (typeof import("jspdf"))["default"];
type AutoTableFn = (typeof import("jspdf-autotable"))["default"];

let pdfRuntimePromise: Promise<{ jsPDF: JsPdfConstructor; autoTable: AutoTableFn }> | null = null;

function loadPdfRuntime() {
  if (!pdfRuntimePromise) {
    pdfRuntimePromise = Promise.all([import("jspdf"), import("jspdf-autotable")]).then(([jspdfModule, autoTableModule]) => ({
      jsPDF: jspdfModule.default,
      autoTable: autoTableModule.default,
    }));
  }

  return pdfRuntimePromise;
}
type AttendanceRecordLike = {
  id: string;
  employeeCode: string;
  name: string;
  region: string;
  store: string;
  storeCode: string;
  scheduled: boolean;
  atWork: boolean;
  leave: boolean;
  dayOff: boolean;
  problem: boolean;
  clockCount: number;
  firstClock: string;
  lastClock: string;
  clockings: string[];
  reportStatus: string;
};

type StoreDeviceEntry = {
  storeCode: string;
  storeName: string;
  hasDevice: boolean;
  deviceStatus: "online" | "offline" | "warning";
  deviceName: string;
};

type ReportsBuilderProps = {
  records: AttendanceRecordLike[];
  employees: Employee[];
  reportDateRangeLabel: string;
  storeDeviceMap?: Map<string, StoreDeviceEntry>;
};

type SelectionMode = "store" | "employees";

type StoreOption = {
  key: string;
  store: string;
  storeCode: string;
  displayName: string;
  employeeCount: number;
  employeeCodes: string[];
};

type EmployeeRosterSource = {
  sheetName: string;
  storeName: string;
  storeCode: string;
  weekRows: Map<number, ShiftRow>;
};

type GeneratedCriteria = {
   templateKey: string;
   startDate: string;
   endDate: string;
   selectionMode: SelectionMode;
   includeInactiveProfiles: boolean;
   selectedStores: string[];
   employeeCodes: string[];
   awolThresholdDays?: number;
};

type AttendanceDayRow = {
  dateKey: string;
  dateLabel: string;
  weekdayLabel: string;
  weekLabel: string;
  holidayTitle: string;
  scheduleLabel: string;
  targetHours: number;
  firstClock: string;
  lastClock: string;
  clockCount: number;
  clockings: string[];
  status: string;
};

type EmployeeReport = {
  employeeCode: string;
  employeeName: string;
  role: string;
  department: string;
  team: string;
  costCenter: string;
  region: string;
  store: string;
  storeCode: string;
  rows: AttendanceDayRow[];
};

type StoreSection = {
  key: string;
  store: string;
  storeCode: string;
  region: string;
  employees: EmployeeReport[];
};

type AwolReportRow = {
  employeeCode: string;
  employeeName: string;
  store: string;
  storeCode: string;
  region: string;
  department: string;
  currentAwolStreak: number;
  awolDates: string[];
  lastDayAtWork: string;
  lastDayAtWorkLabel: string;
};

const BUILT_IN_TEMPLATES = [
  {
    id: "attendance_report",
    title: "Attendance Report",
    description: "Store-based attendance template that joins roster dates to clockings and applies AWOL / No In-Out rules per day.",
  },
  {
    id: "awol_report",
    title: "AWOL Report",
    description: "Ranks merchandisers from worst to best by current consecutive AWOL streak while ignoring leave days and off days.",
  },
];

const DAY_KEYS: ShiftDayKey[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function normalizeText(value: unknown) {
  return value === null || value === undefined ? "" : String(value).replace(/\s+/g, " ").trim();
}

function normalizeCompare(value: unknown) {
  return normalizeText(value).toLowerCase();
}

function hasPhysicalDeviceForStoreInReports(
  storeDeviceMap: Map<string, StoreDeviceEntry>,
  storeCode: unknown,
  storeName: unknown
) {
  if (!storeDeviceMap || storeDeviceMap.size === 0) return true;
  const normalizedCode = normalizeCompare(storeCode);
  if (normalizedCode) {
    const byCode = storeDeviceMap.get(normalizedCode);
    return byCode?.hasDevice === true;
  }

  const normalizedStoreName = normalizeCompare(storeName);
  if (!normalizedStoreName) return false;

  const byName = Array.from(storeDeviceMap.values()).find(
    (entry) => normalizeCompare(entry.storeName) === normalizedStoreName
  );
  return byName?.hasDevice === true;
}

function isEmployeeReportable(employee: Employee | undefined | null, storeDeviceMap: Map<string, StoreDeviceEntry>) {
   if (!employee) return false;
   if (employee.active === false) return false;
   if (!hasPhysicalDeviceForStoreInReports(storeDeviceMap, employee.store_code, employee.store)) return false;
   return normalizeCompare(employee.status) !== "inactive";
 }

function getEmployeeProfileState(employee: Employee | undefined | null) {
   if (!employee) return "";
   const status = normalizeCompare(employee.status);
   if (status) return status;
   if (employee.active === false) return "inactive";
   return "active";
 }

function isEmployeeIncludedInBuilder(
  employee: Employee | undefined | null,
  includeInactiveProfiles: boolean,
  storeDeviceMap: Map<string, StoreDeviceEntry>
) {
   if (!employee) return false;
   if (!hasPhysicalDeviceForStoreInReports(storeDeviceMap, employee.store_code, employee.store)) return false;
   if (includeInactiveProfiles) return true;
   return isEmployeeReportable(employee, storeDeviceMap);
 }

function buildStoreKey(store: unknown, storeCode: unknown) {
   return `${normalizeCompare(storeCode)}::${normalizeCompare(store)}`;
 }

function buildStoreDisplayName(store: unknown, storeCode: unknown) {
   const normalizedStore = normalizeText(store) || "Unassigned store";
   const normalizedStoreCode = normalizeText(storeCode);
   return normalizedStoreCode ? `${normalizedStoreCode} - ${normalizedStore} (${normalizedStoreCode})` : normalizedStore;
 }

function matchesEmployeeSearch(employee: Employee, query: string) {
   const normalizedQuery = normalizeCompare(query);
   if (!normalizedQuery) return false;

   const haystack = [
     employee.employee_code,
     employee.id_number,
     employee.first_name,
     employee.last_name,
     `${employee.first_name} ${employee.last_name}`,
     `${employee.last_name} ${employee.first_name}`,
     employee.store,
     employee.store_code,
   ]
     .map(normalizeText)
     .join(" ");

   return normalizeCompare(haystack).includes(normalizedQuery);
 }

function parseDateKey(dateKey: string) {
  if (!dateKey || typeof dateKey !== "string") return new Date(NaN);
  const parts = dateKey.split("-");
  if (parts.length !== 3) return new Date(NaN);
  const [year, month, day] = parts.map(Number);
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return new Date(NaN);
  return new Date(year, month - 1, day);
}

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getTodayKey() {
  return formatDateKey(new Date());
}

function getDateRangeKeys(startDate: string, endDate: string) {
  const start = parseDateKey(startDate);
  const end = parseDateKey(endDate);
  const dates: string[] = [];

  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    dates.push(formatDateKey(cursor));
  }

  return dates;
}

function shiftDate(dateKey: string, offsetDays: number) {
  const next = parseDateKey(dateKey);
  next.setDate(next.getDate() + offsetDays);
  return formatDateKey(next);
}

function formatRangeLabel(startDate: string, endDate: string) {
  if (!startDate || !endDate) return "No date range";
  const start = parseDateKey(startDate);
  const end = parseDateKey(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${startDate || "?"} to ${endDate || "?"}`;
  }
  const startStr = start.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  const endStr = end.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  return startStr === endStr ? startStr : `${startStr} to ${endStr}`;
}

function formatLongDate(dateKey: string) {
  if (!dateKey) return "-";
  const parsed = parseDateKey(dateKey);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function formatWeekday(dateKey: string) {
  if (!dateKey) return "-";
  const parsed = parseDateKey(dateKey);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString(undefined, { weekday: "short" });
}

function getDateWeekdayKey(dateKey: string) {
  if (!dateKey) return "monday";
  const parsed = parseDateKey(dateKey);
  if (Number.isNaN(parsed.getTime())) return "monday";
  return DAY_KEYS[(parsed.getDay() + 6) % 7];
}

function parseShiftLength(value: string) {
  const clean = normalizeText(value).toLowerCase();
  const match = clean.match(/(\d{1,2})(?::(\d{2}))?\s*[-\u2013]\s*(\d{1,2})(?::(\d{2}))?/);
  if (!match) return null;

  const start = Number(match[1]) + Number(match[2] || 0) / 60;
  let end = Number(match[3]) + Number(match[4] || 0) / 60;
  if (end <= start) end += 12;
  if (end <= start) end += 12;
  return Number(Math.max(0, end - start - 1).toFixed(1));
}

function formatShiftLabel(value: string) {
  const clean = normalizeText(value);
  if (!clean || clean.toUpperCase() === "OFF") return "< off >";

  const match = clean.match(/(\d{1,2})(?::(\d{2}))?\s*[-\u2013]\s*(\d{1,2})(?::(\d{2}))?/);
  if (!match) return clean;

  const startHour = Number(match[1]);
  const startMinute = Number(match[2] || 0);
  let endHour = Number(match[3]);
  const endMinute = Number(match[4] || 0);
  let numericEnd = endHour + endMinute / 60;
  const numericStart = startHour + startMinute / 60;
  if (numericEnd <= numericStart) numericEnd += 12;
  if (numericEnd <= numericStart) numericEnd += 12;
  endHour = Math.floor(numericEnd % 24);

  const startLabel = `${String(startHour).padStart(2, "0")}${startMinute ? `:${String(startMinute).padStart(2, "0")}` : ""}`;
  const endLabel = `${String(endHour).padStart(2, "0")}${endMinute ? `:${String(endMinute).padStart(2, "0")}` : ""}`;
  return `${startLabel}-${endLabel}`;
}

function getScheduleLabel(row: ShiftRow | undefined, day: ShiftDayKey) {
  if (!row) return "< off >";
  const raw = normalizeText(row[day]).toUpperCase();
  if (!raw || raw === "OFF") return "< off >";
  if (raw === "X") return formatShiftLabel(row.time_label);
  return formatShiftLabel(row[day]);
}

function getTargetHours(row: ShiftRow | undefined, day: ShiftDayKey) {
  if (!row) return 0;
  const raw = normalizeText(row[day]).toUpperCase();
  if (!raw || raw === "OFF") return 0;
  if (day === "saturday") return 6;
  if (day === "sunday") return 5.5;
  if (raw === "X") return parseShiftLength(row.time_label) ?? row.expected_hours[day] ?? 0;
  return parseShiftLength(row[day]) ?? row.expected_hours[day] ?? 0;
}

function formatHours(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseWeekNumber(label: string) {
  return Number(String(label).replace(/\D/g, "")) || 0;
}

function buildAttendanceStatus(record: AttendanceRecord | undefined, targetHours: number, isPublicHoliday: boolean, hasClock: boolean) {
   if (isPublicHoliday) {
     if (hasClock) return "P/H";
     return "Public Holiday";
   }
   
   const clockings = Array.isArray(record?.clockings) ? record!.clockings.filter(Boolean) : [];
   const clockCount = clockings.length || Number(record?.clock_count || 0);

   if (record?.leave) return "On Leave";
   if ((record?.day_off || targetHours === 0) && clockCount === 0) return "Day Off";
   if (clockCount === 0) return "AWOL";
   if (clockCount === 1) return "No In/Out";
   return "In/Out";
 }

function isLeaveStatus(status: string) {
  return !!status && !["P/H", "Public Holiday", "AWOL", "No In/Out", "In/Out", "Day Off"].includes(status);
}

function getStatusTone(status: string) {
   if (status === "P/H") return "bg-rose-100 text-rose-700";
   if (status === "Public Holiday") return "bg-rose-50 text-rose-600";
   if (status === "AWOL") return "bg-red-100 text-red-700";
   if (status === "No In/Out") return "bg-amber-100 text-amber-700";
   if (status === "In/Out") return "bg-emerald-100 text-emerald-700";
   if (isLeaveStatus(status)) return "bg-blue-100 text-blue-700";
   if (status === "Day Off") return "bg-violet-100 text-violet-700";
   return "bg-slate-100 text-slate-700";
 }

function getStatusCssClass(status: string) {
   if (status === "P/H") return "status-ph";
   if (status === "Public Holiday") return "status-public";
   if (status === "AWOL") return "status-awol";
   if (status === "No In/Out") return "status-noinout";
   if (status === "In/Out") return "status-inout";
   if (isLeaveStatus(status)) return "status-leave";
   if (status === "Day Off") return "status-dayoff";
   return "";
 }

function buildRosterSources(rosters: ShiftRoster[]) {
  const sources = new Map<string, EmployeeRosterSource[]>();

  rosters.forEach((roster) => {
    const grouped = new Map<string, EmployeeRosterSource>();

    roster.rows.forEach((row) => {
      const employeeCode = normalizeEmployeeCode(row.employee_code);
      if (!employeeCode) return;

      if (!grouped.has(employeeCode)) {
        grouped.set(employeeCode, {
          sheetName: roster.sheet_name,
          storeName: roster.store_name || roster.sheet_name,
          storeCode: roster.store_code || "",
          weekRows: new Map<number, ShiftRow>(),
        });
      }

      grouped.get(employeeCode)!.weekRows.set(row.week_number, row);
    });

    grouped.forEach((source, employeeCode) => {
      if (!sources.has(employeeCode)) sources.set(employeeCode, []);
      sources.get(employeeCode)!.push(source);
    });
  });

  return sources;
}

function matchRosterSource(employee: Employee, sources: EmployeeRosterSource[]) {
  const employeeStoreCode = normalizeCompare(employee.store_code);
  const employeeStore = normalizeCompare(employee.store);

  return (
    sources.find((source) => employeeStoreCode && normalizeCompare(source.storeCode) === employeeStoreCode) ||
    sources.find((source) => employeeStore && normalizeCompare(source.storeName) === employeeStore) ||
    sources[0] ||
    null
  );
}

function getAttendanceKey(dateKey: string, employeeCode: string) {
  return `${dateKey}__${normalizeEmployeeCode(employeeCode)}`;
}

function formatClockTimeFromRawEvent(event: BiometricClockEvent) {
  if (event.clock_time) return event.clock_time;
  return new Date(event.clocked_at).toLocaleTimeString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function buildAttendanceRecordFromClockEvents(
  key: string,
  events: BiometricClockEvent[],
  employeesByCode: Map<string, Employee>,
  rostersByEmployee: Map<string, EmployeeRosterSource[]>
) {
  const sorted = [...events].sort((a, b) => a.clocked_at.localeCompare(b.clocked_at));
  const first = sorted[0];
  const normalizedCode = normalizeEmployeeCode(first.employee_code);
  const employee = employeesByCode.get(normalizedCode);
  const rosterSource = employee
    ? matchRosterSource(employee, rostersByEmployee.get(normalizedCode) || [])
    : (rostersByEmployee.get(normalizedCode) || [])[0] || null;
  const clockings = sorted.map((event) => formatClockTimeFromRawEvent(event));

  return {
    id: `clock_${key}`,
    employee_code: normalizedCode,
    name: `${normalizeText(employee?.first_name || first.first_name)} ${normalizeText(employee?.last_name || first.last_name)}`.trim() || first.employee_code,
    region: normalizeText(employee?.region) || first.region || "",
    region_code: "",
    store: normalizeText(employee?.store) || rosterSource?.storeName || first.store || "",
    store_code: normalizeText(employee?.store_code) || rosterSource?.storeCode || first.store_code || "",
    scheduled: false,
    at_work: clockings.length > 0,
    leave: false,
    day_off: false,
    problem: clockings.length === 0,
    clock_count: clockings.length,
    first_clock: clockings[0] || "",
    last_clock: clockings.length > 1 ? clockings[clockings.length - 1] : "",
    status_label: clockings.length === 0 ? "AWOL" : clockings.length === 1 ? "No In/Out" : "In/Out",
    clockings,
    upload_date: first.clock_date,
    created_at: first.created_at,
  } satisfies AttendanceRecord;
}

function mergeAttendanceWithClockEvents(
  attendanceRecords: AttendanceRecord[],
  rawClockEvents: BiometricClockEvent[],
  employeesByCode: Map<string, Employee>,
  rostersByEmployee: Map<string, EmployeeRosterSource[]>
) {
  const attendanceMap = new Map<string, AttendanceRecord>();

  attendanceRecords.forEach((record) => {
    attendanceMap.set(getAttendanceKey(record.upload_date, record.employee_code), record);
  });

  const clockEventMap = new Map<string, BiometricClockEvent[]>();
  rawClockEvents.forEach((event) => {
    const key = getAttendanceKey(event.clock_date, event.employee_code);
    if (!clockEventMap.has(key)) clockEventMap.set(key, []);
    clockEventMap.get(key)!.push(event);
  });

  clockEventMap.forEach((events, key) => {
    const synthesized = buildAttendanceRecordFromClockEvents(key, events, employeesByCode, rostersByEmployee);
    const existing = attendanceMap.get(key);

    if (!existing) {
      attendanceMap.set(key, synthesized);
      return;
    }

    const existingClockings = Array.isArray(existing.clockings) ? existing.clockings.filter(Boolean) : [];
    if (existingClockings.length === 0 && Number(existing.clock_count || 0) === 0) {
      attendanceMap.set(key, {
        ...existing,
        first_clock: synthesized.first_clock,
        last_clock: synthesized.last_clock,
        clock_count: synthesized.clock_count,
        clockings: synthesized.clockings,
        status_label: synthesized.status_label,
        at_work: synthesized.clock_count > 0 || existing.at_work,
        problem: synthesized.clock_count === 0 ? existing.problem : false,
        store: existing.store || synthesized.store,
        store_code: existing.store_code || synthesized.store_code,
        region: existing.region || synthesized.region,
        name: existing.name || synthesized.name,
      });
    }
  });

  return Array.from(attendanceMap.values());
}

export default function ReportsBuilder({
  records,
  employees,
  reportDateRangeLabel,
  storeDeviceMap = new Map(),
}: ReportsBuilderProps) {
  const getStoreDeviceLabel = (storeCode: string, storeName?: string): string => {
    const code = (storeCode || "").toLowerCase().trim();
    if (storeDeviceMap.size === 0) return "";
    const entry = code
      ? storeDeviceMap.get(code)
      : Array.from(storeDeviceMap.values()).find((item) => normalizeCompare(item.storeName) === normalizeCompare(storeName));
    if (!entry) return "";
    return entry.hasDevice ? "Physical Store (Has Device)" : "Logical Store (No Device)";
  };

  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [shiftRosters, setShiftRosters] = useState<ShiftRoster[]>([]);
  const [leaveApplications, setLeaveApplications] = useState<LeaveApplication[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState(BUILT_IN_TEMPLATES[0].id);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("store");
  const [includeInactiveProfiles, setIncludeInactiveProfiles] = useState(false);
  const [storeSearch, setStoreSearch] = useState("");
  const [selectedStores, setSelectedStores] = useState<string[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [selectedEmployeeCodes, setSelectedEmployeeCodes] = useState<string[]>([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [awolThresholdDays, setAwolThresholdDays] = useState(3);
  const [generatedCriteria, setGeneratedCriteria] = useState<GeneratedCriteria | null>(null);
  const [generatedRecords, setGeneratedRecords] = useState<AttendanceRecord[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const liveLoadedRecordCount = records.length;

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        setIsLoading(true);
        await Promise.all([initializeShiftDatabase(), initializeLeaveDatabase()]);
        const [dates, rosters, appliedLeave] = await Promise.all([getAvailableDates(), getShiftRosters(), getAppliedLeaveApplications()]);
        if (!alive) return;
        setAvailableDates(dates);
        setShiftRosters(rosters);
        setLeaveApplications(appliedLeave);
      } catch (error) {
        console.error("Failed to load reports data:", error);
        if (alive) {
          setStatusMessage("Failed to load some data. Please refresh the page.");
        }
      } finally {
        if (alive) {
          setIsLoading(false);
        }
      }
    };

    void load();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (startDate && endDate) return;

    const todayKey = getTodayKey();
    const defaultEnd = availableDates[0] || todayKey;
    const defaultStart = availableDates[availableDates.length - 1] || shiftDate(defaultEnd, -6);
    if (!endDate) setEndDate(defaultEnd);
    if (!startDate) setStartDate(defaultStart > defaultEnd ? defaultEnd : defaultStart);
  }, [availableDates, endDate, startDate]);

  // Store options with employee count from active employee profiles
  const storeOptions = useMemo<StoreOption[]>(() => {
    const values = new Map<string, StoreOption>();

    employees.forEach((employee) => {
      if (!isEmployeeIncludedInBuilder(employee, includeInactiveProfiles, storeDeviceMap)) return;

      const store = normalizeText(employee.store);
      const storeCode = normalizeText(employee.store_code);
      if (!store && !storeCode) return;

      const key = buildStoreKey(store, storeCode);
      const existing =
        values.get(key) ||
        {
          key,
          store: store || "Unassigned store",
          storeCode,
          displayName: buildStoreDisplayName(store, storeCode),
          employeeCount: 0,
          employeeCodes: [],
        };

      existing.employeeCount += 1;

      const normalizedEmployeeCode = normalizeEmployeeCode(employee.employee_code);
      if (normalizedEmployeeCode && !existing.employeeCodes.includes(normalizedEmployeeCode)) {
        existing.employeeCodes.push(normalizedEmployeeCode);
      }

      values.set(key, existing);
    });

    return Array.from(values.values())
      .map((option) => ({
        ...option,
        employeeCodes: [...option.employeeCodes].sort((a, b) => a.localeCompare(b)),
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [employees, includeInactiveProfiles, storeDeviceMap]);

  const storeBrandGroups = useMemo(() => {
    const brands = ["Shoprite", "Checkers"];
    return brands
      .map((brand) => ({
        label: brand,
        count: storeOptions.filter((opt) =>
          normalizeCompare(opt.displayName).includes(normalizeCompare(brand))
        ).length,
      }))
      .filter((group) => group.count > 0);
  }, [storeOptions]);

  // Store search with partial matching - shows full store name + employee count
  const storeSearchResults = useMemo(() => {
    const query = normalizeCompare(storeSearch);
    if (!query) return [];

    const selectedSet = new Set(selectedStores);

    return storeOptions
      .filter((opt) => !selectedSet.has(opt.key))
      .filter((opt) =>
        normalizeCompare(`${opt.displayName} ${opt.store} ${opt.storeCode}`).includes(query)
      )
      .slice(0, 10);
  }, [selectedStores, storeOptions, storeSearch]);

  const employeeOptions = useMemo(
    () =>
      [...employees]
        .filter((employee) => isEmployeeIncludedInBuilder(employee, includeInactiveProfiles, storeDeviceMap))
        .sort(
          (a, b) =>
            normalizeText(a.store).localeCompare(normalizeText(b.store)) ||
            normalizeText(a.last_name).localeCompare(normalizeText(b.last_name)) ||
            normalizeText(a.first_name).localeCompare(normalizeText(a.first_name))
        ),
    [employees, includeInactiveProfiles, storeDeviceMap]
  );

  const selectedStoreOptions = useMemo(
    () =>
      selectedStores
        .map((storeKey) => storeOptions.find((option) => option.key === storeKey))
        .filter(Boolean) as StoreOption[],
    [selectedStores, storeOptions]
  );

  const selectedEmployees = useMemo(
    () =>
      selectedEmployeeCodes
        .map((employeeCode) => employeeOptions.find((employee) => normalizeEmployeeCode(employee.employee_code) === normalizeEmployeeCode(employeeCode)))
        .filter(Boolean) as Employee[],
    [employeeOptions, selectedEmployeeCodes]
  );

  const employeeSearchResults = useMemo(() => {
    const query = normalizeCompare(employeeSearch);
    if (!query) return [];

    const selectedSet = new Set(selectedEmployeeCodes.map((code) => normalizeEmployeeCode(code)));

    return employeeOptions
      .filter((employee) => !selectedSet.has(normalizeEmployeeCode(employee.employee_code)))
      .filter((employee) => matchesEmployeeSearch(employee, query))
      .slice(0, 8);
  }, [employeeOptions, employeeSearch, selectedEmployeeCodes]);

  useEffect(() => {
    setSelectedStores((current) => current.filter((storeKey) => storeOptions.some((option) => option.key === storeKey)));
    setSelectedEmployeeCodes((current) =>
      current.filter((employeeCode) =>
        employeeOptions.some((employee) => normalizeEmployeeCode(employee.employee_code) === normalizeEmployeeCode(employeeCode))
      )
    );
  }, [employeeOptions, storeOptions]);

  const addStore = (storeKey: string) => {
    setSelectedStores((current) => (current.includes(storeKey) ? current : [...current, storeKey]));
    setStoreSearch("");
  };

  const removeStore = (storeKey: string) => {
    setSelectedStores((current) => current.filter((value) => value !== storeKey));
  };

  const addStoresByBrand = (brandKeyword: string) => {
    const matching = storeOptions
      .filter((opt) => normalizeCompare(opt.displayName).includes(normalizeCompare(brandKeyword)))
      .map((opt) => opt.key);
    setSelectedStores((current) => {
      const currentSet = new Set(current);
      matching.forEach((key) => currentSet.add(key));
      return Array.from(currentSet);
    });
    setStoreSearch("");
  };

  const addAllStores = () => {
    setSelectedStores(storeOptions.map((opt) => opt.key));
    setStoreSearch("");
  };

  const clearAllStores = () => setSelectedStores([]);

  const addEmployee = (employeeCode: string) => {
    const normalizedCode = normalizeEmployeeCode(employeeCode);
    setSelectedEmployeeCodes((current) => (current.map((code) => normalizeEmployeeCode(code)).includes(normalizedCode) ? current : [...current, normalizedCode]));
    setEmployeeSearch("");
  };

  const removeEmployee = (employeeCode: string) => {
    const normalizedCode = normalizeEmployeeCode(employeeCode);
    setSelectedEmployeeCodes((current) => current.filter((value) => normalizeEmployeeCode(value) !== normalizedCode));
  };

  const attendanceByEmployeeAndDate = useMemo(() => {
    const map = new Map<string, AttendanceRecord[]>();

    generatedRecords.forEach((record) => {
      const key = getAttendanceKey(record.upload_date, record.employee_code);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(record);
    });

    return map;
  }, [generatedRecords]);

  const rosterSourcesByEmployee = useMemo(() => buildRosterSources(shiftRosters), [shiftRosters]);
  const leaveLookup = useMemo(() => buildAppliedLeaveLookup(leaveApplications), [leaveApplications]);
  const employeeMap = useMemo(
    () => new Map(employees.map((employee) => [normalizeEmployeeCode(employee.employee_code), employee])),
    [employees]
  );
  const attendanceByEmployeeCode = useMemo(() => {
    const map = new Map<string, AttendanceRecord[]>();
    generatedRecords.forEach((record) => {
      const code = normalizeEmployeeCode(record.employee_code);
      if (!code) return;
      if (!map.has(code)) map.set(code, []);
      map.get(code)!.push(record);
    });
    return map;
  }, [generatedRecords]);
  const generatedDateKeys = useMemo(
    () => (generatedCriteria ? getDateRangeKeys(generatedCriteria.startDate, generatedCriteria.endDate) : []),
    [generatedCriteria]
  );
  const generatedCalendarEvents = useMemo(() => {
    if (!generatedCriteria) return [];
    const years = Array.from(new Set(generatedDateKeys.map((dateKey) => parseDateKey(dateKey).getFullYear())));
    return getCombinedCalendarEvents(years);
  }, [generatedCriteria, generatedDateKeys]);

  const generatedSections = useMemo<StoreSection[]>(() => {
    if (!generatedCriteria) return [];
    const sections = new Map<string, StoreSection>();

    generatedCriteria.employeeCodes.forEach((employeeCode) => {
      const normalizedEmployeeCode = normalizeEmployeeCode(employeeCode);
      const employee = employeeMap.get(normalizedEmployeeCode);
      if (!isEmployeeReportable(employee, storeDeviceMap)) return;
      const attendanceSamples = attendanceByEmployeeCode.get(normalizedEmployeeCode) || [];
      const rosterSource = employee
        ? matchRosterSource(employee, rosterSourcesByEmployee.get(normalizedEmployeeCode) || [])
        : (rosterSourcesByEmployee.get(normalizedEmployeeCode) || [])[0] || null;

      const store = normalizeText(employee?.store) || rosterSource?.storeName || attendanceSamples[0]?.store || "Unassigned store";
      const storeCode = normalizeText(employee?.store_code) || rosterSource?.storeCode || attendanceSamples[0]?.store_code || "";
      const region = normalizeText(employee?.region) || attendanceSamples[0]?.region || "Unassigned region";
      const employeeName =
        `${normalizeText(employee?.first_name)} ${normalizeText(employee?.last_name)}`.trim() ||
        attendanceSamples[0]?.name ||
        normalizedEmployeeCode;

      const rows = generatedDateKeys.map((dateKey) => {
        const attendanceMatches = attendanceByEmployeeAndDate.get(getAttendanceKey(dateKey, normalizedEmployeeCode)) || [];
        const attendance =
          attendanceMatches.find(
            (record) =>
              (storeCode && normalizeCompare(record.store_code) === normalizeCompare(storeCode)) ||
              normalizeCompare(record.store) === normalizeCompare(store)
          ) || attendanceMatches[0];
        const weekLabel = getWeekEventForDate(generatedCalendarEvents, dateKey);
        const weekNumber = parseWeekNumber(weekLabel);
        const dayKey = getDateWeekdayKey(dateKey);
        const shiftRow = rosterSource?.weekRows.get(weekNumber);
        const targetHours = getTargetHours(shiftRow, dayKey);
        const leaveApplication =
          (rosterSource
            ? leaveLookup.get(getSheetScopedLeaveLookupKey(rosterSource.sheetName, normalizedEmployeeCode, dateKey))
            : null) || leaveLookup.get(getFallbackLeaveLookupKey(normalizedEmployeeCode, dateKey));
        const holidayTitle =
          generatedCalendarEvents.find((event) => event.date === dateKey && event.type === "holiday")?.title || "";
        const isPublicHoliday = !!holidayTitle;
        const clockings = Array.isArray(attendance?.clockings) ? attendance!.clockings.filter(Boolean) : [];
        const clockCount = clockings.length || Number(attendance?.clock_count || 0);
        const hasClock = clockCount > 0;
        const firstClock = clockings[0] || attendance?.first_clock || "";
        const lastClock = clockings.length > 1 ? clockings[clockings.length - 1] : (clockCount > 1 ? attendance?.last_clock || "" : "");
        const status = leaveApplication ? "On Leave" : buildAttendanceStatus(attendance, targetHours, isPublicHoliday, hasClock);

         return {
           dateKey,
           dateLabel: formatLongDate(dateKey),
           weekdayLabel: formatWeekday(dateKey),
           weekLabel,
           holidayTitle,
           scheduleLabel: leaveApplication?.leave_type || (isPublicHoliday ? "Public Holiday" : getScheduleLabel(shiftRow, dayKey)),
           targetHours: leaveApplication ? 0 : (isPublicHoliday ? 0 : targetHours),
           firstClock,
           lastClock,
           clockCount,
           clockings,
           status,
         };
      });

      const sectionKey = `${storeCode || "no-code"}__${store}`;
      if (!sections.has(sectionKey)) {
        sections.set(sectionKey, {
          key: sectionKey,
          store,
          storeCode,
          region,
          employees: [],
        });
      }

      sections.get(sectionKey)!.employees.push({
        employeeCode: normalizedEmployeeCode,
        employeeName,
        role: normalizeText(employee?.job_title) || "Merchandiser",
        department: normalizeText(employee?.department),
        team: normalizeText(employee?.team),
        costCenter: normalizeText(employee?.cost_center),
        region,
        store,
        storeCode,
        rows,
      });
    });

    return Array.from(sections.values())
      .map((section) => ({
        ...section,
        employees: [...section.employees].sort(
          (a, b) => a.employeeName.localeCompare(b.employeeName) || a.employeeCode.localeCompare(b.employeeCode)
        ),
      }))
      .sort((a, b) => a.store.localeCompare(b.store));
  }, [attendanceByEmployeeAndDate, attendanceByEmployeeCode, employeeMap, generatedCalendarEvents, generatedCriteria, generatedDateKeys, leaveLookup, rosterSourcesByEmployee, storeDeviceMap]);

  const generatedTotals = useMemo(() => {
    return generatedSections.reduce(
      (summary, section) => {
        section.employees.forEach((employee) => {
          employee.rows.forEach((row) => {
            summary.totalRows += 1;
            summary.targetHours += row.targetHours;
             if (row.status === "P/H") summary.inOut += 1;
             if (row.status === "Public Holiday") summary.noInOut += 1;
             if (row.status === "In/Out") summary.inOut += 1;
             if (row.status === "No In/Out") summary.noInOut += 1;
             if (row.status === "AWOL") summary.awol += 1;
             if (isLeaveStatus(row.status)) summary.leave += 1;
             if (row.status === "Day Off") summary.dayOff += 1;
          });
        });
        return summary;
      },
      { totalRows: 0, targetHours: 0, inOut: 0, noInOut: 0, awol: 0, leave: 0, dayOff: 0 }
    );
  }, [generatedSections]);

  const generatedAwolRows = useMemo<AwolReportRow[]>(() => {
    if (!generatedCriteria || generatedCriteria.templateKey !== "awol_report") return [];

    return generatedSections
      .flatMap((section) =>
        section.employees.map((employee) => {
          let currentStreak = 0;
          const awolDates: string[] = [];
          let lastDayAtWork = "";

          for (let index = employee.rows.length - 1; index >= 0; index -= 1) {
            const row = employee.rows[index];
            if (row.status === "AWOL") {
              currentStreak += 1;
              awolDates.unshift(row.dateKey);
              continue;
            }

             if (isLeaveStatus(row.status) || row.status === "Day Off") {
               continue;
             }

            lastDayAtWork = row.dateKey;
            break;
          }

          return {
            employeeCode: employee.employeeCode,
            employeeName: employee.employeeName,
            store: section.store,
            storeCode: section.storeCode,
            region: section.region,
            department: employee.department,
            currentAwolStreak: currentStreak,
            awolDates,
            lastDayAtWork,
            lastDayAtWorkLabel: lastDayAtWork ? formatLongDate(lastDayAtWork) : "No worked day in selected range",
          };
        })
      )
      .filter((row) => row.currentAwolStreak >= (generatedCriteria.awolThresholdDays || 0))
      .sort(
        (a, b) =>
          b.currentAwolStreak - a.currentAwolStreak ||
          a.lastDayAtWork.localeCompare(b.lastDayAtWork) ||
          a.employeeName.localeCompare(b.employeeName)
      );
  }, [generatedCriteria, generatedSections]);

  const handleGenerate = async () => {
    const trimmedStart = normalizeText(startDate);
    const trimmedEnd = normalizeText(endDate);

    if (!trimmedStart || !trimmedEnd) {
      setStatusMessage("Choose a start date and end date before generating the report.");
      return;
    }

    if (trimmedStart > trimmedEnd) {
      setStatusMessage("The start date must be before or equal to the end date.");
      return;
    }

    const eligibleEmployees = employeeOptions;
    const selectedStoreEmployeeCodes = Array.from(
      new Set(selectedStoreOptions.flatMap((option) => option.employeeCodes).map((code) => normalizeEmployeeCode(code)).filter(Boolean))
    );

    const employeeCodes =
      selectionMode === "store"
        ? selectedStoreEmployeeCodes
        : selectedEmployeeCodes.filter((employeeCode) =>
            eligibleEmployees.some((employee) => normalizeEmployeeCode(employee.employee_code) === normalizeEmployeeCode(employeeCode))
          );

    if (selectionMode === "store" && selectedStores.length === 0) {
      setStatusMessage("Choose at least one store before generating the report.");
      return;
    }

    if (selectionMode === "employees" && selectedEmployeeCodes.length === 0) {
      setStatusMessage("Search and select at least one employee before generating the report.");
      return;
    }

    if (employeeCodes.length === 0) {
      setStatusMessage(
        selectionMode === "store"
          ? includeInactiveProfiles
            ? "No employee profiles are assigned to the selected store yet."
            : "No active employee profiles are assigned to the selected store yet."
          : includeInactiveProfiles
            ? "Select at least one employee profile before generating the report."
            : "Select at least one active employee profile before generating the report."
      );
      return;
    }

    setIsGenerating(true);
    setStatusMessage("Generating live attendance report...");

    try {
      const normalizedEmployeeCodes = Array.from(
        new Set(
            employeeCodes
              .map((code) => normalizeEmployeeCode(code))
              .filter(Boolean)
            .filter((code) => isEmployeeIncludedInBuilder(employeeMap.get(code), includeInactiveProfiles, storeDeviceMap))
        )
      );
      if (normalizedEmployeeCodes.length === 0) {
        setStatusMessage(
          includeInactiveProfiles
            ? "No employee profiles matched the selected report criteria."
            : "No active employee profiles matched the selected report criteria."
        );
        return;
      }
      const [rangeRecords, rawClockEvents] = await Promise.all([
        getAttendanceByDateRange(trimmedStart, trimmedEnd),
        getClockEventsForDateRange(trimmedStart, trimmedEnd),
      ]);
      const filteredAttendance = rangeRecords.filter((record) => normalizedEmployeeCodes.includes(normalizeEmployeeCode(record.employee_code)));
      const mergedRecords = mergeAttendanceWithClockEvents(filteredAttendance, rawClockEvents, employeeMap, rosterSourcesByEmployee);

      setGeneratedRecords(mergedRecords);
      setGeneratedCriteria({
        templateKey: selectedTemplateId,
        startDate: trimmedStart,
        endDate: trimmedEnd,
        selectionMode,
        includeInactiveProfiles,
        selectedStores,
        employeeCodes: normalizedEmployeeCodes,
        awolThresholdDays,
      });

      setStatusMessage(
        selectedTemplateId === "awol_report"
          ? `Generated AWOL streak report for ${normalizedEmployeeCodes.length} employee profile${normalizedEmployeeCodes.length === 1 ? "" : "s"} with a threshold of ${awolThresholdDays} day${awolThresholdDays === 1 ? "" : "s"}.`
          : mergedRecords.length > 0
            ? `Generated attendance report for ${normalizedEmployeeCodes.length} employee profile${normalizedEmployeeCodes.length === 1 ? "" : "s"} across ${formatRangeLabel(trimmedStart, trimmedEnd)} using shifts, attendance, leave applications, and raw clock data.`
            : `Generated a roster-led attendance report for ${normalizedEmployeeCodes.length} employee profile${normalizedEmployeeCodes.length === 1 ? "" : "s"}. No attendance or raw clock data matched the selected range, so empty scheduled days show as AWOL, Day Off, or On Leave when leave was applied.`
      );
    } catch (error) {
      setStatusMessage(`Could not generate the report: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExportPdf = async () => {
    if (!generatedCriteria) {
      setStatusMessage("Generate a report before exporting it.");
      return;
    }

    const { jsPDF, autoTable } = await loadPdfRuntime();

    if (generatedCriteria.templateKey === "awol_report") {
      if (generatedAwolRows.length === 0) {
        setStatusMessage("Generate an AWOL report before exporting it.");
        return;
      }

      const doc = new jsPDF({
        orientation: "landscape",
        unit: "pt",
        format: "a4",
      });

      doc.setFontSize(18);
      doc.text("AWOL Report", 40, 42);
      doc.setFontSize(10);
      doc.text(
        `${formatRangeLabel(generatedCriteria.startDate, generatedCriteria.endDate)} | Threshold: ${generatedCriteria.awolThresholdDays || 0} day(s)`,
        40,
        60
      );

      autoTable(doc, {
        startY: 78,
        margin: { left: 40, right: 40 },
        styles: { fontSize: 8, cellPadding: 4, valign: "middle" },
        headStyles: { fillColor: [241, 245, 249], textColor: 60 },
        theme: "grid",
        head: [["Rank", "Employee Code", "Employee", "Store", "Streak", "AWOL Dates", "Last Day At Work"]],
        body: generatedAwolRows.map((row, index) => [
          String(index + 1),
          row.employeeCode,
          row.employeeName,
          row.storeCode ? `${row.storeCode} - ${row.store}` : row.store,
          String(row.currentAwolStreak),
          row.awolDates.map((dateKey) => formatLongDate(dateKey)).join(" | "),
          row.lastDayAtWorkLabel,
        ]),
      });

      doc.save(`awol-report-${generatedCriteria.startDate}-to-${generatedCriteria.endDate}.pdf`);
      setStatusMessage("AWOL report exported to PDF.");
      return;
    }

    if (generatedSections.length === 0) {
      setStatusMessage("Generate a report before exporting it.");
      return;
}

    const doc = new jsPDF({
      orientation: "portrait",
      unit: "pt",
      format: "a4",
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const marginX = 26;
    const topY = 30;
    const contentWidth = pageWidth - marginX * 2;
    const bottomMargin = 34;

    const parseClockTimeToSeconds = (value: string) => {
      if (!value || value === "-") return null;
      const parts = String(value).split(":").map(Number);
      if (parts.length < 2 || parts.some((part) => Number.isNaN(part))) return null;
      const [hours, minutes, seconds = 0] = parts;
      return hours * 3600 + minutes * 60 + seconds;
    };

    const calculateWorkedHoursForRow = (row: {
      firstClock?: string;
      lastClock?: string;
      clockCount: number;
    }) => {
      const start = parseClockTimeToSeconds(row.firstClock || "");
      const end = parseClockTimeToSeconds(row.lastClock || "");
      if (start === null || end === null || row.clockCount < 2 || end <= start) return 0;
      return Number(((end - start) / 3600).toFixed(2));
    };

    const calculateWorkedHoursForEmployee = (rows: Array<{
      firstClock?: string;
      lastClock?: string;
      clockCount: number;
    }>) => Number(rows.reduce((sum, row) => sum + calculateWorkedHoursForRow(row), 0).toFixed(2));

    const drawSectionHeader = (section: StoreSection, pageNumber: number) => {
      doc.setDrawColor(34, 211, 238);
      doc.setLineWidth(1.1);
      doc.line(marginX, topY - 10, pageWidth - marginX, topY - 10);

      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.8);
      doc.roundedRect(marginX, topY, contentWidth, 46, 8, 8, "FD");

      doc.setTextColor(15, 23, 42);
      doc.setFontSize(16);
        const storeDeviceLabel = getStoreDeviceLabel(section.storeCode, section.store);
      const storeHeading = section.storeCode ? `${section.storeCode} - ${section.store}` : section.store;
      doc.text(
        storeHeading,
        marginX + 12,
        topY + 18
      );

      if (storeDeviceLabel) {
        const isPhysical = storeDeviceLabel.includes("Physical");
        doc.setFontSize(7.5);
        doc.setTextColor(isPhysical ? 22 : 185, isPhysical ? 163 : 28, isPhysical ? 74 : 28);
        doc.text(
          storeDeviceLabel,
          marginX + 12 + doc.getTextWidth(storeHeading) + 8,
          topY + 18
        );
      }

      doc.setFontSize(8.5);
      doc.setTextColor(100, 116, 139);
      doc.text(
        `${formatRangeLabel(generatedCriteria.startDate, generatedCriteria.endDate)} | Region: ${section.region} | ${section.employees.length} Team Member${section.employees.length === 1 ? "" : "s"}`,
        marginX + 12,
        topY + 32
      );

      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.6);
      doc.line(marginX, pageHeight - 22, pageWidth - marginX, pageHeight - 22);

      doc.setFontSize(7.5);
      doc.setTextColor(148, 163, 184);
      doc.text(
        `Generated ${new Date().toLocaleDateString("en-ZA")} • Page ${pageNumber}`,
        pageWidth - marginX,
        pageHeight - 10,
        { align: "right" }
      );
    };

    let pageNumber = 1;

    generatedSections.forEach((section, sectionIndex) => {
      if (sectionIndex > 0) {
        doc.addPage();
        pageNumber += 1;
      }

      drawSectionHeader(section, pageNumber);
      let cursorY = topY + 58;

      section.employees.forEach((employee) => {
        const empInOut = employee.rows.filter((row) => row.status === "In/Out").length;
        const empAwol = employee.rows.filter((row) => row.status === "AWOL").length;
        const empTarget = Number(employee.rows.reduce((sum, row) => sum + row.targetHours, 0).toFixed(2));
        const empWorked = calculateWorkedHoursForEmployee(employee.rows);

        const metaLine = [
          employee.role,
          employee.department ? `Dept: ${employee.department}` : "",
          employee.team ? `Team: ${employee.team}` : "",
          employee.costCenter ? `Cost Centre: ${employee.costCenter}` : "",
        ]
          .filter(Boolean)
          .join(" | ");

        const estimatedHeight = 62 + (employee.rows.length + 1) * 19;
        if (cursorY + estimatedHeight > pageHeight - bottomMargin) {
          doc.addPage();
          pageNumber += 1;
          drawSectionHeader(section, pageNumber);
          cursorY = topY + 58;
        }

        const employeeCardHeight = 50;
        const employeeCardRight = pageWidth - marginX;
        const employeeMetaX = marginX + 12;
        const metricsStartX = employeeCardRight - 205;

        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(203, 213, 225);
        doc.setLineWidth(0.9);
        doc.roundedRect(marginX, cursorY, contentWidth, employeeCardHeight, 7, 7, "FD");

        // subtle top accent for a more polished look without using much ink
        doc.setDrawColor(34, 211, 238);
        doc.setLineWidth(0.8);
        doc.line(marginX + 8, cursorY + 8, marginX + 84, cursorY + 8);

        // divider between employee details and summary metrics
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.6);
        doc.line(metricsStartX - 12, cursorY + 10, metricsStartX - 12, cursorY + employeeCardHeight - 10);

        doc.setTextColor(15, 23, 42);
        doc.setFontSize(11.2);
        doc.text(`${employee.employeeCode} - ${employee.employeeName}`, employeeMetaX, cursorY + 17);

        doc.setFontSize(7.4);
        doc.setTextColor(100, 116, 139);
        const metaLines = doc.splitTextToSize(metaLine || "-", metricsStartX - employeeMetaX - 24);
        doc.text(metaLines.slice(0, 2), employeeMetaX, cursorY + 31);

        const metricCols = [
          { label: "IN/OUT", value: String(empInOut), x: employeeCardRight - 162, color: [21, 128, 61] as [number, number, number] },
          { label: "AWOL", value: String(empAwol), x: employeeCardRight - 116, color: [185, 28, 28] as [number, number, number] },
          { label: "WORKED", value: formatHours(empWorked), x: employeeCardRight - 60, color: [30, 41, 59] as [number, number, number] },
          { label: "TARGET", value: formatHours(empTarget), x: employeeCardRight - 8, color: [30, 41, 59] as [number, number, number] },
        ];

        metricCols.forEach((metric) => {
          doc.setFontSize(6.8);
          doc.setTextColor(148, 163, 184);
          doc.text(metric.label, metric.x, cursorY + 15, { align: "right" });

          doc.setFontSize(10.2);
          doc.setTextColor(metric.color[0], metric.color[1], metric.color[2]);
          doc.text(metric.value, metric.x, cursorY + 32, { align: "right" });
        });

        cursorY += 56;

        autoTable(doc, {
          startY: cursorY,
          margin: { left: marginX, right: marginX },
          theme: "grid",
          tableLineColor: [203, 213, 225],
          tableLineWidth: 0.5,
          styles: {
            fontSize: 6.7,
            cellPadding: { top: 3.5, right: 3, bottom: 3.5, left: 3 },
            valign: "middle",
            fillColor: [255, 255, 255],
            textColor: [15, 23, 42],
            lineColor: [203, 213, 225],
            lineWidth: 0.5,
            overflow: "linebreak",
          },
          headStyles: {
            fillColor: [255, 255, 255],
            textColor: [51, 65, 85],
            fontStyle: "bold",
            fontSize: 6.5,
            lineColor: [203, 213, 225],
            lineWidth: 0.5,
          },
          bodyStyles: {
            fillColor: [255, 255, 255],
            textColor: [15, 23, 42],
            lineColor: [203, 213, 225],
            lineWidth: 0.5,
          },
          alternateRowStyles: {
            fillColor: [255, 255, 255],
          },
          head: [["DATE", "DAY", "WK", "SHIFT", "TARGET HRS", "IN", "OUT", "NOTES", "STATUS"]],
          columnStyles: {
            0: { cellWidth: 60 },
            1: { cellWidth: 28 },
            2: { cellWidth: 24, halign: "center" },
            3: { cellWidth: 70 },
            4: { cellWidth: 44, halign: "center" },
            5: { cellWidth: 40, halign: "center" },
            6: { cellWidth: 40, halign: "center" },
            7: { cellWidth: 150 },
            8: { cellWidth: 38, halign: "right" },
          },
          body: employee.rows.map((row) => [
            row.dateLabel,
            row.weekdayLabel,
            row.weekLabel.replace(/^WEEK\s+/i, "W"),
            row.scheduleLabel,
            formatHours(row.targetHours),
            row.firstClock || "-",
            row.lastClock || "-",
            "",
            row.status,
          ]),
          didParseCell: (data) => {
            if (data.section === "head") {
              data.cell.styles.fillColor = [255, 255, 255];
              data.cell.styles.textColor = [51, 65, 85];
              data.cell.styles.fontStyle = "bold";
            }

            if (data.section === "body") {
              data.cell.styles.fillColor = [255, 255, 255];
              data.cell.styles.textColor = [15, 23, 42];
            }

            if (data.section === "body" && data.column.index === 8) {
              const status = String(data.cell.raw || "");
              data.cell.styles.fontStyle = "bold";

              if (status === "AWOL") {
                data.cell.styles.textColor = [185, 28, 28];
              } else if (status === "No In/Out") {
                data.cell.styles.textColor = [194, 65, 12];
              } else if (status === "In/Out") {
                data.cell.styles.textColor = [21, 128, 61];
              } else if (status === "P/H" || status === "Public Holiday") {
                data.cell.styles.textColor = [109, 40, 217];
              } else if (status === "On Leave") {
                data.cell.styles.textColor = [29, 78, 216];
              } else if (status === "Day Off") {
                data.cell.styles.textColor = [71, 85, 105];
              } else {
                data.cell.styles.textColor = [51, 65, 85];
              }
            }
          },
        });

        cursorY =
          ((doc as InstanceType<JsPdfConstructor> & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || cursorY + 120) + 14;
      });
    });

    doc.save(`attendance-report-${generatedCriteria.startDate}-to-${generatedCriteria.endDate}.pdf`);
    setStatusMessage("Attendance report exported to clean professional portrait A4 PDF.");
  };

  const handlePrint = () => {
    if (!generatedCriteria) {
      setStatusMessage("Generate a report before printing it.");
      return;
    }

    if (generatedCriteria.templateKey === "awol_report") {
      if (generatedAwolRows.length === 0) {
        setStatusMessage("Generate an AWOL report before printing it.");
        return;
      }

      const rowsHtml = generatedAwolRows
        .map(
          (row, index) => `
            <tr>
              <td>${index + 1}</td>
              <td>${escapeHtml(row.employeeCode)}</td>
              <td>${escapeHtml(row.employeeName)}</td>
              <td>${escapeHtml(row.storeCode ? `${row.storeCode} - ${row.store}` : row.store)}</td>
              <td>${row.currentAwolStreak}</td>
              <td>${escapeHtml(row.awolDates.map((dateKey) => formatLongDate(dateKey)).join(" | "))}</td>
              <td>${escapeHtml(row.lastDayAtWorkLabel)}</td>
            </tr>
          `
        )
        .join("");

      const printWindow = window.open("", "_blank", "noopener,noreferrer,width=1400,height=900");
      if (!printWindow) {
        setStatusMessage("Allow popups in the browser to print the AWOL report.");
        return;
      }

      printWindow.document.write(`
        <html>
          <head>
            <title>AWOL Report</title>
            <style>
              body { font-family: Arial, sans-serif; padding: 24px; color: #0f172a; }
              h1 { margin-bottom: 6px; }
              .device-badge { display: inline-block; margin-left: 12px; padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; vertical-align: middle; }
              .device-badge.physical { background: #dcfce7; color: #166534; }
              .device-badge.logical { background: #fef9c3; color: #854d0e; }
              .meta { margin-bottom: 20px; color: #475569; font-size: 14px; }
              table { width: 100%; border-collapse: collapse; font-size: 12px; }
              th, td { border: 1px solid #cbd5e1; padding: 8px; vertical-align: top; text-align: left; }
              th { background: #f1f5f9; }
            </style>
          </head>
          <body>
            <h1>AWOL Report</h1>
            <div class="meta">${escapeHtml(formatRangeLabel(generatedCriteria.startDate, generatedCriteria.endDate))} | Threshold: ${generatedCriteria.awolThresholdDays || 0} day(s)</div>
            <table>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Employee Code</th>
                  <th>Employee</th>
                  <th>Store</th>
                  <th>Streak</th>
                  <th>AWOL Dates</th>
                  <th>Last Day At Work</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
      setStatusMessage("Opened a print-friendly version of the AWOL report.");
      return;
    }

    if (generatedSections.length === 0) {
      setStatusMessage("Generate a report before printing it.");
      return;
    }

    const printWindow = window.open("", "_blank", "noopener,noreferrer,width=1200,height=900");
    if (!printWindow) {
      setStatusMessage("Print window was blocked by the browser.");
      return;
    }

    const sectionsHtml = generatedSections
      .map(
        (section) => {

          const totalEmployees = section.employees.length;
          return `
          <section class="store-section">
            <div class="store-header">
              <div class="eyebrow">Attendance Report</div>
        <h1>${escapeHtml(section.storeCode ? `${section.storeCode} - ${section.store}` : section.store)}${getStoreDeviceLabel(section.storeCode, section.store) ? `<span class="device-badge ${getStoreDeviceLabel(section.storeCode, section.store).includes('Physical') ? 'physical' : 'logical'}">${escapeHtml(getStoreDeviceLabel(section.storeCode, section.store))}</span>` : ''}</h1>
              <div class="meta">
                <span>${escapeHtml(formatRangeLabel(generatedCriteria.startDate, generatedCriteria.endDate))}</span>
                <span>Region: ${escapeHtml(section.region)}</span>
                <span>${totalEmployees} Team Member${totalEmployees !== 1 ? 's' : ''}</span>
              </div>
            </div>
            ${section.employees
              .map(
                (employee) => {
                  const empInOut = employee.rows.filter((row) => row.status === "In/Out").length;
                  const empAwol = employee.rows.filter((row) => row.status === "AWOL").length;
                  const empTarget = employee.rows.reduce((sum, row) => sum + row.targetHours, 0);
                  return `
                  <div class="employee-block">
                    <div class="employee-header">
                      <div>
                        <h2>${escapeHtml(`${employee.employeeCode} - ${employee.employeeName}`)}</h2>
                        <div class="employee-meta">${escapeHtml(
                          [employee.role, employee.department ? `Dept: ${employee.department}` : "", employee.team ? `Team: ${employee.team}` : "", employee.costCenter ? `Cost Centre: ${employee.costCenter}` : ""]
                            .filter(Boolean)
                            .join(" | ")
                        )}</div>
                      </div>
                      <div class="summary-grid">
                        <div class="summary-item">
                          <div class="summary-label">In/Out</div>
                          <div class="summary-value ${empInOut > 0 ? 'green' : ''}">${empInOut}</div>
                        </div>
                        <div class="summary-item">
                          <div class="summary-label">AWOL</div>
                          <div class="summary-value ${empAwol > 0 ? 'red' : ''}">${empAwol}</div>
                        </div>
                        <div class="summary-item">
                          <div class="summary-label">Hours</div>
                          <div class="summary-value">${formatHours(empTarget)}</div>
                        </div>
                      </div>
                    </div>
                    <table>
                      <thead>
                        <tr>
                          <th>Shift Date</th>
                          <th>Day</th>
                          <th>Week</th>
                          <th>Roster</th>
                          <th style="text-align:center">Hours</th>
                          <th style="text-align:center">In</th>
                          <th style="text-align:center">Out</th>
                          <th style="text-align:center">#</th>
                          <th>Clocks</th>
                          <th style="text-align:right">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${employee.rows
                          .map(
                            (row) => `
                            <tr>
                              <td>${escapeHtml(row.dateLabel)}</td>
                              <td>${escapeHtml(row.weekdayLabel)}</td>
                              <td>${escapeHtml(row.weekLabel)}</td>
                              <td>${escapeHtml(row.scheduleLabel)}</td>
                              <td style="text-align:center">${escapeHtml(formatHours(row.targetHours))}</td>
                              <td style="text-align:center">${escapeHtml(row.firstClock || "-")}</td>
                              <td style="text-align:center">${escapeHtml(row.lastClock || "-")}</td>
                              <td style="text-align:center">${escapeHtml(String(row.clockCount))}</td>
                              <td>${escapeHtml(row.clockings.length > 0 ? row.clockings.join(" | ") : "-")}</td>
                              <td style="text-align:right"><span class="status ${getStatusCssClass(row.status)}">${escapeHtml(row.status)}</span></td>
                            </tr>
                          `
                          )
                          .join("")}
                      </tbody>
                    </table>
                  </div>
                `;
                }
              )
              .join("")}
          </section>
        `;
        }
      )
      .join("");

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>Attendance Report</title>
          <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0f; color: #e4e4e7; margin: 0; padding: 32px; }
            .report-container { max-width: 1200px; margin: 0 auto; }
            .store-section { margin-bottom: 48px; page-break-after: always; }
            .store-section:last-child { page-break-after: auto; }
            .store-header { 
              background: linear-gradient(135deg, #18181b 0%, #27272a 50%, #18181b 100%); 
              border: 1px solid #3f3f46;
              border-radius: 16px; 
              padding: 32px; 
              margin-bottom: 24px;
              position: relative;
              overflow: hidden;
            }
            .store-header::before {
              content: '';
              position: absolute;
              top: 0;
              left: 0;
              right: 0;
              height: 4px;
              background: linear-gradient(90deg, #06b6d4, #8b5cf6, #06b6d4);
            }
            .eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: 0.2em; color: #06b6d4; font-weight: 600; margin-bottom: 8px; }
            h1 { font-size: 28px; font-weight: 700; color: #fafafa; margin-bottom: 8px; letter-spacing: -0.02em; }
            .device-badge { display: inline-block; margin-left: 12px; padding: 2px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; vertical-align: middle; }
            .device-badge.physical { background: #052e16; color: #4ade80; border: 1px solid #166534; }
            .device-badge.logical { background: #422006; color: #fbbf24; border: 1px solid #854d0e; }
            .meta { font-size: 13px; color: #a1a1aa; display: flex; gap: 16px; flex-wrap: wrap; }
            .meta span { display: flex; align-items: center; gap: 6px; }
            .employee-block { 
              background: #18181b; 
              border: 1px solid #27272a; 
              border-radius: 12px; 
              margin-bottom: 20px; 
              overflow: hidden;
            }
            .employee-header { 
              background: linear-gradient(90deg, #27272a 0%, #18181b 100%); 
              padding: 20px 24px; 
              border-bottom: 1px solid #3f3f46;
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              flex-wrap: wrap;
              gap: 16px;
            }
            h2 { font-size: 16px; font-weight: 600; color: #fafafa; }
            .employee-meta { font-size: 12px; color: #71717a; }
            .summary-grid { display: flex; gap: 24px; flex-wrap: wrap; }
            .summary-item { text-align: center; padding: 8px 16px; background: #27272a; border-radius: 8px; min-width: 80px; }
            .summary-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #71717a; }
            .summary-value { font-size: 18px; font-weight: 700; color: #fafafa; }
            .summary-value.green { color: #22c55e; }
            .summary-value.red { color: #ef4444; }
            .summary-value.amber { color: #f59e0b; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th { 
              background: #18181b; 
              color: #a1a1aa; 
              font-weight: 600; 
              text-transform: uppercase; 
              letter-spacing: 0.05em; 
              font-size: 10px;
              padding: 12px 16px; 
              text-align: left; 
              border-bottom: 1px solid #27272a;
            }
            td { 
              padding: 10px 16px; 
              border-bottom: 1px solid #27272a; 
              color: #d4d4d8;
            }
            tr:last-child td { border-bottom: none; }
            tr:hover { background: #18181b; }
            .status { 
              display: inline-block; 
              padding: 4px 10px; 
              border-radius: 9999px; 
              font-size: 10px; 
              font-weight: 600; 
              text-transform: uppercase; 
              letter-spacing: 0.05em;
            }
            .status-ph { background: #4c1d95; color: #e9d5ff; border: 1px solid #6b21a8; }
            .status-public { background: #881337; color: #fecdd3; border: 1px solid #be123c; }
            .status-awol { background: #7f1d1d; color: #fecaca; border: 1px solid #991b1b; }
            .status-noinout { background: #78350f; color: #fef3c7; border: 1px solid #b45309; }
            .status-inout { background: #14532d; color: #bbf7d0; border: 1px solid #15803d; }
            .status-leave { background: #1e3a8a; color: #bfdbfe; border: 1px solid #1d4ed8; }
            .status-dayoff { background: #4a1d7d; color: #e9d5ff; border: 1px solid #6b21a8; }
            .page-number { 
              position: fixed; 
              bottom: 20px; 
              right: 32px; 
              font-size: 11px; 
              color: #52525b; 
            }
            @media print {
              body { padding: 16px; }
              .page-number { position: static; text-align: center; margin-top: 24px; }
            }
          </style>
        </head>
        <body>
          <div class="report-container">
            ${sectionsHtml}
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => {
      printWindow.print();
    }, 250);
    setStatusMessage("Opened a print-friendly version of the attendance report.");
  };

  return (
    <div className="section-tech-stack">
      {isLoading && (
        <Card className="rounded-2xl border-cyan-500/30 bg-cyan-950/30">
          <CardContent className="flex items-center gap-3 p-4">
            <RefreshCw className="h-5 w-5 animate-spin text-cyan-400" />
            <span className="text-sm text-cyan-300">Loading report data...</span>
          </CardContent>
        </Card>
      )}
      <Card className="rounded-2xl border border-white/10 bg-[#0d1117]">
        <CardHeader className="border-b border-white/5 pb-4">
          <CardTitle className="flex items-center gap-2 text-xl font-bold text-white">
            <WandSparkles className="h-5 w-5 text-cyan-400" />
            Report Builder
          </CardTitle>
          <CardDescription className="text-slate-400">
            Generate attendance or AWOL reports by selecting a date range and employees/stores.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          <div className="grid gap-6 xl:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/5 p-5">
              <div className="text-xs font-semibold uppercase tracking-widest text-cyan-400">Step 1</div>
              <div className="mt-3 text-sm font-semibold text-white">Select Template</div>
              <div className="mt-4 grid gap-3">
                {BUILT_IN_TEMPLATES.map((template) => {
                  const active = selectedTemplateId === template.id;
                  return (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => setSelectedTemplateId(template.id)}
                      className={`rounded-xl border p-4 text-left transition-all ${
                        active
                          ? "border-cyan-500 bg-cyan-950/30 shadow-[0_0_20px_rgba(6,182,212,0.15)]"
                          : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10"
                      }`}
                    >
                      <div className="font-semibold text-white">{template.title}</div>
                      <div className="mt-1 text-sm text-slate-300">{template.description}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-5">
              <div className="text-xs font-semibold uppercase tracking-widest text-cyan-400">Rules Engine</div>
              <div className="mt-3 text-sm font-semibold text-white">Status Rules</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge className="border-red-500/30 bg-red-950/30 text-red-300">0 clocks = AWOL</Badge>
                <Badge className="border-amber-500/30 bg-amber-950/30 text-amber-300">1 clock = No In/Out</Badge>
                <Badge className="border-cyan-500/30 bg-cyan-950/30 text-cyan-300">2+ clocks = In/Out</Badge>
                <Badge className="border-violet-500/30 bg-violet-950/30 text-violet-300">Off day = Day Off</Badge>
              </div>
              <div className="mt-4 rounded-lg border border-white/10 bg-[#0d1117] p-3 text-sm text-slate-300">
                <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">Current Data</div>
                {reportDateRangeLabel || "No attendance loaded"}
                <div className="mt-1 text-xs text-slate-500">{liveLoadedRecordCount} records loaded</div>
              </div>
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/5 p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <CalendarRange className="h-4 w-4 text-cyan-400" />
                Step 2: Select Dates
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Start Date</div>
                  <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="border-white/10 bg-[#0d1117] text-white" />
                </div>
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">End Date</div>
                  <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="border-white/10 bg-[#0d1117] text-white" />
                </div>
              </div>
              {selectedTemplateId === "awol_report" && (
                <div className="mt-4 max-w-xs">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Minimum AWOL Days</div>
                  <Input type="number" min={1} value={awolThresholdDays} onChange={(event) => setAwolThresholdDays(Math.max(1, Number(event.target.value) || 1))} className="border-white/10 bg-[#0d1117] text-white" />
                </div>
              )}
              <div className="mt-4 text-xs text-slate-500">Available: {availableDates.length > 0 ? availableDates.slice(0, 5).join(", ") + "..." : "None"}</div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Building2 className="h-4 w-4 text-cyan-400" />
                Step 3: Select Report Target
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button variant={selectionMode === "store" ? "default" : "outline"} size="sm" onClick={() => setSelectionMode("store")}>By Store</Button>
                <Button variant={selectionMode === "employees" ? "default" : "outline"} size="sm" onClick={() => setSelectionMode("employees")}>By Employee</Button>
                <button
                  type="button"
                  onClick={() => setIncludeInactiveProfiles((current) => !current)}
                  className={`ml-auto inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    includeInactiveProfiles
                      ? "border-amber-400/40 bg-amber-500/10 text-amber-200"
                      : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20"
                  }`}
                >
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      includeInactiveProfiles ? "bg-amber-300" : "bg-emerald-400"
                    }`}
                  />
                  {includeInactiveProfiles ? "Including inactive / terminated" : "Only active profiles"}
                </button>
              </div>

              {selectionMode === "store" ? (
                <div className="mt-4 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-slate-500">Quick select:</span>
                    {storeBrandGroups.map((group) => (
                      <button
                        key={group.label}
                        type="button"
                        onClick={() => addStoresByBrand(group.label)}
                        className="rounded-full border border-cyan-500/30 bg-cyan-950/20 px-3 py-1 text-xs font-semibold text-cyan-300 transition hover:bg-cyan-900/40"
                      >
                        All {group.label} ({group.count})
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={addAllStores}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-300 transition hover:border-white/20 hover:bg-white/10"
                    >
                      Select All ({storeOptions.length})
                    </button>
                    {selectedStores.length > 0 && (
                      <button
                        type="button"
                        onClick={clearAllStores}
                        className="rounded-full border border-red-500/30 bg-red-950/20 px-3 py-1 text-xs font-semibold text-red-300 transition hover:bg-red-900/40"
                      >
                        Clear All
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <Input
                      value={storeSearch}
                      onChange={(event) => setStoreSearch(event.target.value)}
                      className="border-white/10 bg-[#0d1117] pl-9 text-white placeholder:text-slate-500"
                      placeholder="Search store name or code..."
                    />
                  </div>

                  {storeSearchResults.length > 0 && (
                    <div className="overflow-hidden rounded-lg border border-white/10">
                      {storeSearchResults.map((result) => (
                        <button key={result.key} type="button" onClick={() => addStore(result.key)} className="flex w-full items-center justify-between border-b border-white/5 px-4 py-3 text-left transition hover:bg-white/5 last:border-b-0">
                          <div>
                            <div className="text-sm font-medium text-white">{result.displayName}</div>
                            <div className="text-xs text-slate-500">
                              {result.employeeCount} {result.employeeCount === 1 ? "employee" : "employees"} ready for grouping
                            </div>
                          </div>
                          <span className="text-xs font-semibold text-cyan-400">+ Add</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {storeSearch && storeSearchResults.length === 0 && (
                    <div className="rounded-lg border border-dashed border-white/10 px-4 py-3 text-center text-sm text-slate-500">
                      No store with reportable employee profiles matched that search.
                    </div>
                  )}

                  {selectedStoreOptions.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {selectedStoreOptions.map((store) => (
                        <button
                          key={store.key}
                          type="button"
                          onClick={() => removeStore(store.key)}
                          className="rounded-full border border-cyan-500/30 bg-cyan-950/30 px-3 py-1 text-sm text-cyan-300 transition hover:bg-cyan-900/50"
                        >
                          {store.displayName} ×
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <Input
                      value={employeeSearch}
                      onChange={(event) => setEmployeeSearch(event.target.value)}
                      className="border-white/10 bg-[#0d1117] pl-9 text-white placeholder:text-slate-500"
                      placeholder="Search first name, last name, employee code, or ID number..."
                    />
                  </div>

                  {employeeSearchResults.length > 0 && (
                    <div className="overflow-hidden rounded-lg border border-white/10">
                      {employeeSearchResults.map((employee) => (
                        <button key={employee.employee_code} type="button" onClick={() => addEmployee(employee.employee_code)} className="flex w-full items-center justify-between border-b border-white/5 px-4 py-3 text-left transition hover:bg-white/5 last:border-b-0">
                          <div>
                            <div className="text-sm font-medium text-white">{employee.first_name} {employee.last_name}</div>
                            <div className="text-xs text-slate-500">
                              {employee.employee_code}
                              {employee.id_number ? ` • ${employee.id_number}` : ""}
                              {employee.store ? ` • ${buildStoreDisplayName(employee.store, employee.store_code)}` : ""}
                              {getEmployeeProfileState(employee) ? ` • ${getEmployeeProfileState(employee)}` : ""}
                            </div>
                          </div>
                          <span className="text-xs font-semibold text-cyan-400">+ Add</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {employeeSearch && employeeSearchResults.length === 0 && (
                    <div className="rounded-lg border border-dashed border-white/10 px-4 py-3 text-center text-sm text-slate-500">
                      No employee profile matched that search.
                    </div>
                  )}

                  {selectedEmployees.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {selectedEmployees.map((employee) => {
                        const normalizedCode = normalizeEmployeeCode(employee.employee_code);
                        return (
                          <button
                            key={normalizedCode}
                            type="button"
                            onClick={() => removeEmployee(normalizedCode)}
                            className="rounded-full border border-cyan-500/30 bg-cyan-950/30 px-3 py-1 text-sm text-cyan-300 transition hover:bg-cyan-900/50"
                          >
                            {employee.first_name} {employee.last_name} ({employee.employee_code}) ×
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {selectedEmployees.length === 0 && !employeeSearch && (
                    <div className="rounded-lg border border-dashed border-white/10 px-4 py-3 text-center text-sm text-slate-500">
                      No employees selected
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button onClick={handleGenerate} disabled={isGenerating} className="bg-cyan-600 hover:bg-cyan-500">
              {isGenerating ? "Generating..." : selectedTemplateId === "awol_report" ? "Generate AWOL Report" : "Generate Attendance Report"}
            </Button>
          </div>

          {statusMessage && (
            <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">{statusMessage}</div>
          )}
        </CardContent>
      </Card>

      <div className="section-tech-stack">
        <Card className="section-tech-panel rounded-[30px] border-gray-300">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2">
                <UserRound className="section-tech-header-icon" />
                {generatedCriteria?.templateKey === "awol_report" ? "AWOL Report Preview" : "Attendance Report Preview"}
              </CardTitle>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => void handleExportPdf()}
                  disabled={!generatedCriteria || (generatedCriteria.templateKey === "awol_report" ? generatedAwolRows.length === 0 : generatedSections.length === 0)}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Export PDF
                </Button>
                <Button
                  variant="outline"
                  onClick={handlePrint}
                  disabled={!generatedCriteria || (generatedCriteria.templateKey === "awol_report" ? generatedAwolRows.length === 0 : generatedSections.length === 0)}
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Print
                </Button>
              </div>
            </div>
            <CardDescription className="text-slate-300">
              {generatedCriteria
                ? generatedCriteria.templateKey === "awol_report"
                  ? `${formatRangeLabel(generatedCriteria.startDate, generatedCriteria.endDate)} | ${generatedCriteria.employeeCodes.length} selected merchandiser${generatedCriteria.employeeCodes.length === 1 ? "" : "s"} | ${generatedAwolRows.length} streak result${generatedAwolRows.length === 1 ? "" : "s"}`
                  : `${formatRangeLabel(generatedCriteria.startDate, generatedCriteria.endDate)} | ${generatedCriteria.employeeCodes.length} selected merchandiser${generatedCriteria.employeeCodes.length === 1 ? "" : "s"} | ${generatedSections.length} store section${generatedSections.length === 1 ? "" : "s"}`
                : "Select a report template, choose a date range, and generate the report."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-7">
            {!generatedCriteria ? (
              <div className="section-tech-empty">
                No report generated yet.
              </div>
            ) : generatedCriteria.templateKey === "awol_report" ? (
              <>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Dates</div>
                    <div className="mt-2 font-semibold text-slate-900">{formatRangeLabel(generatedCriteria.startDate, generatedCriteria.endDate)}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-amber-50 p-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-amber-600">Threshold</div>
                    <div className="mt-2 text-2xl font-bold text-amber-700">{generatedCriteria.awolThresholdDays || awolThresholdDays} day(s)</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-red-50 p-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-red-600">Employees Matched</div>
                    <div className="mt-2 text-2xl font-bold text-red-700">{generatedAwolRows.length}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Worst Streak</div>
                    <div className="mt-2 text-2xl font-bold text-slate-900">{generatedAwolRows[0]?.currentAwolStreak || 0}</div>
                  </div>
                </div>

                {generatedAwolRows.length === 0 ? (
                  <div className="section-tech-empty">
                    No employees matched the current AWOL streak threshold.
                  </div>
                ) : (
                  <div className="section-tech-table">
                    <table className="w-full min-w-[980px] border-collapse">
                      <thead className="bg-white/5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">
                        <tr>
                          <th className="border-b border-slate-200 px-3 py-3 text-left">Rank</th>
                          <th className="border-b border-slate-200 px-3 py-3 text-left">Employee</th>
                          <th className="border-b border-slate-200 px-3 py-3 text-left">Store</th>
                          <th className="border-b border-slate-200 px-3 py-3 text-center">AWOL Days In A Row</th>
                          <th className="border-b border-slate-200 px-3 py-3 text-left">AWOL Dates</th>
                          <th className="border-b border-slate-200 px-3 py-3 text-left">Last Day At Work</th>
                        </tr>
                      </thead>
                      <tbody className="bg-transparent text-sm text-slate-200">
                        {generatedAwolRows.map((row, index) => (
                          <tr key={`${row.employeeCode}-${row.currentAwolStreak}-${row.awolDates.join("-")}`} className="align-top">
                            <td className="border-b border-white/10 px-3 py-3 font-semibold text-white">{index + 1}</td>
                            <td className="border-b border-slate-200 px-3 py-3">
                                <div className="font-medium text-white">
                                {row.employeeCode} - {row.employeeName}
                              </div>
                              <div className="mt-1 text-xs text-slate-400">{row.department || row.region || "No extra profile detail"}</div>
                            </td>
                            <td className="border-b border-slate-200 px-3 py-3 text-sm text-slate-700">
                              {row.storeCode ? `${row.storeCode} - ${row.store}` : row.store}
                              {(() => { const l = getStoreDeviceLabel(row.storeCode, row.store); if (!l) return null; return <span className={`ml-2 text-[10px] font-semibold px-2 py-0.5 rounded-full ${l.includes("Physical") ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>{l}</span>; })()}
                            </td>
                            <td className="border-b border-slate-200 px-3 py-3 text-center">
                              <Badge className="bg-red-100 text-red-700">{row.currentAwolStreak}</Badge>
                            </td>
                            <td className="border-b border-slate-200 px-3 py-3 text-sm text-slate-700">
                              {row.awolDates.map((dateKey) => formatLongDate(dateKey)).join(" | ")}
                            </td>
                            <td className="border-b border-slate-200 px-3 py-3 text-sm text-slate-700">{row.lastDayAtWorkLabel}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Dates</div>
                    <div className="mt-2 font-semibold text-slate-900">{formatRangeLabel(generatedCriteria.startDate, generatedCriteria.endDate)}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Roster Rows</div>
                    <div className="mt-2 text-2xl font-bold text-slate-900">{generatedTotals.totalRows}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-emerald-50 p-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-emerald-600">In/Out</div>
                    <div className="mt-2 text-2xl font-bold text-emerald-700">{generatedTotals.inOut}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-amber-50 p-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-amber-600">No In/Out</div>
                    <div className="mt-2 text-2xl font-bold text-amber-700">{generatedTotals.noInOut}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-red-50 p-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-red-600">AWOL</div>
                    <div className="mt-2 text-2xl font-bold text-red-700">{generatedTotals.awol}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Target Hours</div>
                    <div className="mt-2 text-2xl font-bold text-slate-900">{formatHours(generatedTotals.targetHours)}</div>
                  </div>
                </div>

                {generatedSections.length === 0 ? (
                  <div className="section-tech-empty">
                    No store sections matched the current template criteria.
                  </div>
                ) : (
                  <div className="space-y-7">
                    {generatedSections.map((section) => (
                      <section key={section.key} className="overflow-hidden rounded-[28px] border border-gray-300 bg-slate-950/45 shadow-[0_24px_60px_rgba(2,6,23,0.28)]">
                        <div className="border-b border-white/10 bg-gradient-to-r from-gray-950 via-gray-900 to-gray-950 px-6 py-5 text-white">
                          <div className="text-xs font-semibold uppercase tracking-[0.25em] text-gray-600">Attendance Report</div>
                          <div className="mt-2 text-2xl font-bold tracking-tight flex items-center gap-3">
                            {section.storeCode ? `${section.storeCode} - ${section.store}` : section.store}
                            {(() => {
                              const label = getStoreDeviceLabel(section.storeCode, section.store);
                              if (!label) return null;
                              const isPhysical = label.includes("Physical");
                              return (
                                <span className={`text-xs font-semibold px-3 py-1 rounded-full ${isPhysical ? "bg-green-900/60 text-green-400 border border-green-700" : "bg-amber-900/60 text-amber-400 border border-amber-700"}`}>
                                  {label}
                                </span>
                              );
                            })()}
                          </div>
                          <div className="mt-2 text-sm text-slate-200">
                            Shift Date Range: {formatRangeLabel(generatedCriteria.startDate, generatedCriteria.endDate)} • Grouped By: Store
                          </div>
                          <div className="mt-1 text-sm text-slate-300">
                            Region: {section.region} • {section.employees.length} merchandiser{section.employees.length === 1 ? "" : "s"}
                          </div>
                        </div>

                        <div className="space-y-0">
                          {section.employees.map((employee) => {
                            const inOutCount = employee.rows.filter((row) => row.status === "In/Out").length;
                            const awolCount = employee.rows.filter((row) => row.status === "AWOL").length;
                            const targetHours = employee.rows.reduce((sum, row) => sum + row.targetHours, 0);

                            return (
                              <div key={`${section.key}-${employee.employeeCode}`} className="border-t border-white/10 px-6 py-6 first:border-t-0">
                                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                                  <div>
                                    <div className="text-lg font-semibold text-white">
                                      {employee.employeeCode} - {employee.employeeName}
                                    </div>
                                    <div className="mt-1 text-sm text-slate-400">
                                      {employee.role}
                                      {employee.department ? ` • Dept: ${employee.department}` : ""}
                                      {employee.team ? ` • Team: ${employee.team}` : ""}
                                      {employee.costCenter ? ` • Cost Centre: ${employee.costCenter}` : ""}
                                    </div>
                                  </div>

                                  <div className="grid gap-4 sm:grid-cols-3">
                                    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">In/Out Days</div>
                                      <div className="mt-2 text-xl font-bold text-gray-700">{inOutCount}</div>
                                    </div>
                                    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">AWOL Days</div>
                                      <div className="mt-2 text-xl font-bold text-red-300">{awolCount}</div>
                                    </div>
                                    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Target Hours</div>
                                      <div className="mt-2 text-xl font-bold text-white">{formatHours(targetHours)}</div>
                                    </div>
                                  </div>
                                </div>

                                <div className="section-tech-table mt-5">
                                  <table className="w-full min-w-[980px] border-collapse">
                                    <thead className="bg-white/5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">
                                      <tr>
                                        <th className="border-b border-slate-200 px-3 py-3 text-left">Shift Date</th>
                                        <th className="border-b border-slate-200 px-3 py-3 text-left">Day</th>
                                        <th className="border-b border-slate-200 px-3 py-3 text-left">Week</th>
                                        <th className="border-b border-slate-200 px-3 py-3 text-left">Roster</th>
                                        <th className="border-b border-slate-200 px-3 py-3 text-center">Hours</th>
                                        <th className="border-b border-slate-200 px-3 py-3 text-center">In</th>
                                        <th className="border-b border-slate-200 px-3 py-3 text-center">Out</th>
                                        <th className="border-b border-slate-200 px-3 py-3 text-center">Clocks</th>
                                        <th className="border-b border-slate-200 px-3 py-3 text-left">Clocks</th>
                                        <th className="border-b border-slate-200 px-3 py-3 text-right">Status</th>
                                      </tr>
                                    </thead>
                                    <tbody className="bg-transparent text-sm text-slate-200">
                                      {employee.rows.map((row) => (
                                        <tr key={`${employee.employeeCode}-${row.dateKey}`} className="align-top">
                                          <td className="border-b border-slate-200 px-3 py-3">
                                            <div className="font-medium text-white">{row.dateLabel}</div>
                                            {row.holidayTitle ? <div className="mt-1 text-xs text-rose-600">{row.holidayTitle}</div> : null}
                                          </td>
                                          <td className="border-b border-slate-200 px-3 py-3">{row.weekdayLabel}</td>
                                          <td className="border-b border-slate-200 px-3 py-3">{row.weekLabel}</td>
                                          <td className="border-b border-slate-200 px-3 py-3 font-medium text-slate-900">{row.scheduleLabel}</td>
                                          <td className="border-b border-slate-200 px-3 py-3 text-center">{formatHours(row.targetHours)}</td>
                                          <td className="border-b border-slate-200 px-3 py-3 text-center">{row.firstClock || "-"}</td>
                                          <td className="border-b border-slate-200 px-3 py-3 text-center">{row.lastClock || "-"}</td>
                                          <td className="border-b border-slate-200 px-3 py-3 text-center">{row.clockCount}</td>
                                          <td className="border-b border-slate-200 px-3 py-3 text-xs text-slate-500">
                                            {row.clockings.length > 0 ? row.clockings.join("  |  ") : "No clocks"}
                                          </td>
                                          <td className="border-b border-slate-200 px-3 py-3 text-right">
                                            <Badge className={getStatusTone(row.status)}>{row.status}</Badge>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
