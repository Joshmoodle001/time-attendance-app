import React, { Suspense, lazy, startTransition, useCallback, useMemo, useRef, useState, useEffect } from "react";
import { uploadAttendanceFile } from "@/services/storage";
import { saveAttendanceRecords, getAvailableDates, getAttendanceByDate, getAttendanceByDateRange, parseRegionStore, getEmployees, importEmployees, initializeEmployeeDatabase, normalizeEmployeeCode } from "@/services/database";
import type { Employee, EmployeeInput } from "@/services/database";
import { getConfig, saveConfig, testConnection, getSyncLogs, syncFromIpulse, clearSyncLogs, startAutoSync, stopAutoSync, IPULSE_SETUP_SQL } from "@/services/ipulse";
import type { IpulseConfig, SyncLog } from "@/services/ipulse";
import { getClockEvents, getClockStats, initializeClockDatabase, type BiometricClockEvent } from "@/services/clockData";
import { saveEmployeeUpdateUploadLog, type EmployeeUpdateReportItem, type EmployeeUpdateUploadLog } from "@/services/employeeUpdateLogs";
import { getCombinedCalendarEvents, getWeekCycleLabel, loadCalendarEvents } from "@/services/calendar";
import { expandLeaveDateRange, getLeaveApplications, getLeaveUploads } from "@/services/leave";
import { getShiftRosters } from "@/services/shifts";
import { loadShiftSyncSettings } from "@/services/shiftSync";
import { performOneTimeTrialReset } from "@/services/trialReset";
import { findRegionMasterRowByRep, getStoreGrouping, resolveRegionForStore } from "@/services/regionMaster";
import { motion } from "framer-motion";
import type { CommunicationAutomation, CommunicationProfile, ReportTemplate } from "@/types/workflows";
import type { WorkBook } from "xlsx";
import {
  TimerReset,
  AlertTriangle,
  CheckCircle2,
  Layers3,
  Upload,
  Download,
  ChevronDown,
  ChevronRight,
  Monitor,
  Server,
  Calendar,
  Circle,
  Check,
  LayoutGrid,
  Table2,
  Users,
  Save,
  Settings,
  RefreshCw,
  Plug,
  PlugZap,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Database,
  Key,
  Globe,
  Trash,
  Play,
  FileSpreadsheet,
  Search,
  X,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from "recharts";

const sidebarItems = [
  { key: "overview", label: "Overview", icon: Layers3 },
  { key: "employees", label: "Employees", icon: Users },
  { key: "reports", label: "Reports", icon: Table2 },
  { key: "shifts", label: "Shifts", icon: LayoutGrid },
  { key: "leave", label: "Leave", icon: FileSpreadsheet },
  { key: "clockData", label: "Clock Data", icon: Clock },
  { key: "calendar", label: "Calendar", icon: Calendar },
  { key: "roster", label: "Roster", icon: Table2 },
  { key: "communications", label: "Comms Hub", icon: Globe },
  { key: "devices", label: "Devices", icon: Server },
  { key: "admin", label: "Admin", icon: Settings },
] as const;

const ShiftBuilder = lazy(() => import("@/components/ShiftBuilder"));
const CalendarBuilder = lazy(() => import("@/components/CalendarBuilder"));
const RosterBuilder = lazy(() => import("@/components/RosterBuilder"));
const ReportsBuilder = lazy(() => import("@/components/ReportsBuilder"));
const CommunicationsHub = lazy(() => import("@/components/CommunicationsHub"));
const ClockDataHub = lazy(() => import("@/components/ClockDataHub"));
const LeaveHub = lazy(() => import("@/components/LeaveHub"));
const ShiftSyncAdminPanel = lazy(() => import("@/components/ShiftSyncAdminPanel"));
const AdminDataToolsPanel = lazy(() => import("@/components/AdminDataToolsPanel"));
const EmployeesHub = lazy(() => import("@/components/EmployeesHub"));

const ATTENDANCE_STATUS_CONFIG = [
  { key: "atWork", name: "At Work", color: "#22c55e" },
  { key: "awol", name: "AWOL", color: "#ef4444" },
  { key: "leave", name: "Leave", color: "#38bdf8" },
  { key: "dayOff", name: "Day Off", color: "#a78bfa" },
  { key: "other", name: "Unscheduled", color: "#94a3b8" },
] as const;

const SCHEDULED_TREND_META = {
  key: "scheduled",
  name: "Scheduled",
  color: "#facc15",
} as const;

const ALL_TREND_METRICS = [...ATTENDANCE_STATUS_CONFIG, SCHEDULED_TREND_META];

const TREND_VIEW_OPTIONS = [
  {
    value: "all",
    label: "All Trends",
    keys: ["atWork", "awol", "leave", "dayOff", "other", "scheduled"],
  },
  {
    value: "atWorkVsAwol",
    label: "At Work vs AWOL",
    keys: ["atWork", "awol"],
  },
  {
    value: "leaveVsDayOff",
    label: "Leave vs Day Off",
    keys: ["leave", "dayOff"],
  },
] as const;

const QUICK_RANGE_OPTIONS = [
  { label: "Today", days: 1 },
  { label: "7 Day", days: 7 },
  { label: "14 Day", days: 14 },
  { label: "31 Day", days: 31 },
] as const;

const REPORT_TEMPLATES_STORAGE_KEY = "report-templates-v1";
const COMMUNICATION_PROFILES_STORAGE_KEY = "communication-profiles-v1";
const COMMUNICATION_AUTOMATIONS_STORAGE_KEY = "communication-automations-v1";
const LAST_ATTENDANCE_DATE_STORAGE_KEY = "last-attendance-date-v1";
const DEVICES_STORAGE_KEY = "devices-v1";
const OVERVIEW_REFRESH_TTL_MS = 30 * 1000;
const EMPLOYEE_REFRESH_TTL_MS = 30 * 1000;
const CLOCK_REFRESH_TTL_MS = 30 * 1000;

type XlsxRuntime = typeof import("xlsx");
type JsPdfConstructor = (typeof import("jspdf"))["default"];
type AutoTableFn = (typeof import("jspdf-autotable"))["default"];

let xlsxRuntimePromise: Promise<XlsxRuntime> | null = null;
let pdfRuntimePromise: Promise<{ jsPDF: JsPdfConstructor; autoTable: AutoTableFn }> | null = null;

function loadXlsxRuntime() {
  if (!xlsxRuntimePromise) {
    xlsxRuntimePromise = import("xlsx");
  }
  return xlsxRuntimePromise;
}

function loadPdfRuntime() {
  if (!pdfRuntimePromise) {
    pdfRuntimePromise = Promise.all([import("jspdf"), import("jspdf-autotable")]).then(([jspdfModule, autoTableModule]) => ({
      jsPDF: jspdfModule.default,
      autoTable: autoTableModule.default,
    }));
  }
  return pdfRuntimePromise;
}

function mapEmployeeToRegionMaster(employee: Employee): Employee {
  const storeGroup = getStoreGrouping(employee.store, employee.store_code, employee.region);
  const fullName = `${String(employee.first_name || "").trim()} ${String(employee.last_name || "").trim()}`.trim();
  const repMatch = fullName ? findRegionMasterRowByRep(fullName) : null;
  const resolvedRegion = storeGroup.region !== "UNASSIGNED" ? storeGroup.region : (repMatch?.region || storeGroup.region);

  return {
    ...employee,
    region: resolvedRegion,
    store: storeGroup.store || employee.store,
  };
}

type AttendanceRecord = {
  id: string;
  employeeCode: string;
  name: string;
  region: string;
  regionCode: string;
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

type DeviceRecord = {
  id: string;
  name: string;
  deviceName: string;
  region: string;
  store: string;
  deviceType: "physical" | "logical";
  status: "online" | "offline" | "warning";
  lastSeen: string;
  lastSeenDate?: string;
};

type OverviewDatum = {
  key: string;
  name: string;
  color: string;
  count: number;
  percentage: number;
  detail: string;
};

type OverviewModuleSnapshot = {
  employeeProfiles: number;
  activeEmployees: number;
  inactiveEmployees: number;
  terminatedEmployees: number;
  shiftRosters: number;
  shiftRows: number;
  enabledShiftSyncs: number;
  leaveUploads: number;
  leaveRowsForDate: number;
  appliedLeaveForDate: number;
  unmatchedLeaveForDate: number;
  customCalendarEvents: number;
  calendarEventsThisMonth: number;
  ipulseAutoSyncEnabled: boolean;
  ipulseLastSyncStatus: string;
  ipulseLastSyncAt: string;
  syncLogCount: number;
  syncErrorsOpen: number;
};

function formatDateValue(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

function parseDateValue(value: string) {
  const [year, month, day] = String(value || "").split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function formatClockTime(date: Date) {
  return date.toLocaleTimeString("en-ZA", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).toLowerCase();
}

function normalizeClockValue(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatClockTime(value);
  }

  const text = String(value || "").trim();
  if (!text) return "";

  const matches = text.match(/\b\d{1,2}:\d{2}(?:\s?[ap]m)?\b/gi);
  if (!matches || matches.length === 0) return "";
  return matches[0].replace(/\s+/g, "").toLowerCase();
}

function extractClockingsFromRow(row: unknown[]) {
  const clockings: string[] = [];

  row.forEach((cell, index) => {
    if (index <= 11) return;
    if (cell instanceof Date && !Number.isNaN(cell.getTime())) {
      if (cell.getHours() === 0 && cell.getMinutes() === 0 && cell.getSeconds() === 0) return;
      clockings.push(formatClockTime(cell));
      return;
    }

    const text = String(cell || "").trim();
    if (!text) return;

    const matches = text.match(/\b\d{1,2}:\d{2}(?:\s?[ap]m)?\b/gi);
    if (!matches) return;
    matches.forEach((match) => {
      const clean = match.replace(/\s+/g, "").toLowerCase();
      if (!clockings.includes(clean)) clockings.push(clean);
    });
  });

  return clockings;
}

function deriveClockStatus({
  leave,
  dayOff,
  clockings,
}: {
  leave: boolean;
  dayOff: boolean;
  clockings: string[];
}) {
  if (leave) {
    return { status: "Leave", firstClock: "", lastClock: "", clockCount: 0 };
  }
  if (dayOff) {
    return { status: "Day Off", firstClock: "", lastClock: "", clockCount: 0 };
  }

  const clockCount = clockings.length;
  if (clockCount === 0) {
    return { status: "AWOL", firstClock: "", lastClock: "", clockCount };
  }
  if (clockCount === 1) {
    return { status: "No In/Out", firstClock: clockings[0], lastClock: "", clockCount };
  }

  return {
    status: "In/Out",
    firstClock: clockings[0],
    lastClock: clockings[clockCount - 1],
    clockCount,
  };
}

function loadLocalArrayState<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as T[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeImportKey(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/#/g, " number ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeEmployeeStatusValue(value: unknown): "active" | "inactive" | "terminated" {
  const clean = String(value || "").trim().toLowerCase();
  if (clean === "inactive") return "inactive";
  if (clean === "terminated") return "terminated";
  return "active";
}

function parseEmployeeBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value;
  const clean = String(value).trim().toLowerCase();
  if (["true", "yes", "y", "1", "active"].includes(clean)) return true;
  if (["false", "no", "n", "0", "inactive"].includes(clean)) return false;
  return null;
}

function parseEmployeeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseEmployeeDate(value: unknown) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDateValue(value);
  }
  const strValue = String(value).trim();
  // Handle Excel numeric date format (days since 1900-01-01)
  if (/^\d+(\.\d+)?$/.test(strValue)) {
    const excelDate = parseFloat(strValue);
    if (excelDate > 0 && excelDate < 100000) {
      const date = new Date(Math.round((excelDate - 25569) * 86400 * 1000));
      if (!Number.isNaN(date.getTime())) {
        return formatDateValue(date);
      }
    }
  }
  const parsed = new Date(strValue);
  return Number.isNaN(parsed.getTime()) ? "" : formatDateValue(parsed);
}

function getFirstSheetEntry(entries: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = entries[key];
    if (value === null || value === undefined) continue;
    if (String(value).trim() === "") continue;
    return value;
  }
  return "";
}

function normalizeEmployeeGenderValue(value: unknown) {
  const clean = String(value || "").trim();
  if (!clean) return "";
  const lower = clean.toLowerCase();
  if (lower.includes("female") || lower === "f") return "Female";
  if (lower.includes("male") || lower === "m") return "Male";
  return clean;
}

function extractTitleFromDisplayName(value: string) {
  const clean = String(value || "").trim();
  const firstWord = clean.split(/\s+/)[0]?.replace(/\.+$/, "") || "";
  return ["mr", "mrs", "ms", "miss", "dr", "prof"].includes(firstWord.toLowerCase()) ? firstWord : "";
}

function findStaffListHeaderRow(rows: unknown[][]) {
  return rows.findIndex((row) => {
    const normalized = row.map((cell) => normalizeImportKey(String(cell || "")));
    return normalized.includes("employee_code") &&
      normalized.includes("company") &&
      (
        normalized.includes("genentity_first_name") ||
        normalized.includes("display_name")
      );
  });
}

function findEmployeeHeaderRow(rows: unknown[][]) {
  return rows.findIndex((row) =>
    row.some((cell) => {
      const key = normalizeImportKey(String(cell || ""));
      return key === "employee_number" || key === "employee_num" || key === "employee_id" || key === "employee";
    }) &&
    row.some((cell) => {
      const key = normalizeImportKey(String(cell || ""));
      return key === "first_name" || key === "firstname" || key === "first";
    }) &&
    row.some((cell) => {
      const key = normalizeImportKey(String(cell || ""));
      return key === "last_name" || key === "lastname" || key === "last";
    })
  );
}

function buildNormalizedSheetEntries(row: Record<string, unknown>) {
  return Object.entries(row).reduce<Record<string, unknown>>((acc, [key, value]) => {
    const normalized = normalizeImportKey(String(key));
    
    // Map common variations
    acc[normalized] = value;
    
    // Additional mappings for common variations
    if (normalized === "title") acc["title"] = value;
    if (normalized === "firstname") acc["first_name"] = value;
    if (normalized === "lastname") acc["last_name"] = value;
    if (normalized === "surname") acc["last_name"] = value;
    if (normalized === "familyname" || normalized === "family_name") acc["last_name"] = value;
    if (normalized === "givenname" || normalized === "given_name") acc["first_name"] = value;
    if (normalized === "employeenumber" || normalized === "employee_num") acc["employee_number"] = value;
    if (normalized === "employee") acc["employee_number"] = value;
    if (normalized === "emp_num") acc["employee_number"] = value;
    if (normalized === "nationalid" || normalized === "national_id") acc["national_id"] = value;
    if (normalized === "idnumber" || normalized === "id_number") acc["id_number"] = value;
    if (normalized === "t_a" || normalized === "tand_a") acc["t_and_a"] = value;
    if (normalized === "jobtitle") acc["job_title"] = value;
    if (normalized === "jobcode") acc["job_code"] = value;
    if (normalized === "startdate") acc["start_date"] = value;
    if (normalized === "expirydate") acc["expiry_date"] = value;
    if (normalized === "businessunit") acc["business_unit"] = value;
    if (normalized === "costcenter") acc["cost_center"] = value;
    if (normalized === "fingerprintsenrolled") acc["fingerprints_enrolled"] = value;
    if (normalized === "custom1") acc["custom_1"] = value;
    if (normalized === "custom2") acc["custom_2"] = value;
    
    return acc;
  }, {});
}

function parseRegionFromDepartment(value: string) {
  const clean = String(value || "").trim();
  if (!clean) return "";
  const parts = clean.split("-").map((part) => part.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[1] : "";
}

function parseStaffListStoreValue(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) {
    return {
      store: "",
      storeCode: "",
      storeDisplay: "",
    };
  }

  const parsed = parseRegionStore(raw);
  const cleanedStore =
    parsed.store && parsed.store !== "Unknown Store"
      ? parsed.store
      : raw.replace(/\s*\(([^)]+)\)\s*$/, "").trim();
  const codeMatch = raw.match(/\(([^)]+)\)\s*$/);
  const storeCode = String(parsed.storeCode || codeMatch?.[1] || "").trim();
  const storeDisplay = storeCode ? `${storeCode} - ${cleanedStore} (${storeCode})` : cleanedStore;

  return {
    store: cleanedStore,
    storeCode,
    storeDisplay,
  };
}

function deriveStaffListRegion(departmentValue: string, paypointValue: string, existing?: Employee) {
  const paypointPrefix = String(paypointValue || "").split(/\s+-\s+/)[0].trim();
  if (paypointPrefix) return paypointPrefix;
  if (String(departmentValue || "").trim()) return String(departmentValue).trim();
  return existing?.region || "";
}

function parseStoreAssignment(entries: Record<string, unknown>) {
  const teamValue = String(entries.team || "");
  const accessValue = String(entries.access || entries.access_profile || "");
  const directStore = String(entries.store || "");
  const source = directStore || teamValue || accessValue;
  const { store, storeCode, region } = parseRegionStore(source);

  return {
    store: store && store !== "Unknown Store" ? store : source,
    storeCode,
    derivedRegion: region && region !== "Unknown Region" ? region : "",
  };
}

function parseStaffListEmployeeWorkbook(workbook: WorkBook, existingEmployees: Employee[], xlsx: XlsxRuntime) {
  const existingMap = new Map(
    existingEmployees.map((employee) => [normalizeEmployeeCode(employee.employee_code), employee])
  );
  const employeeMap = new Map<string, EmployeeInput>();

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;

    const rawRows = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
    const headerRowIndex = findStaffListHeaderRow(rawRows);
    if (headerRowIndex < 0) return;

    const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
      range: headerRowIndex,
    });

    rows.forEach((row) => {
      const entries = buildNormalizedSheetEntries(row);
      const code = normalizeEmployeeCode(
        getFirstSheetEntry(entries, ["employee_code", "employee_number", "code", "id"])
      );
      if (!code) return;

      const existing = existingMap.get(code);
      const displayName = String(getFirstSheetEntry(entries, ["display_name"])).trim();
      const firstName = String(
        getFirstSheetEntry(entries, ["genentity_first_name", "first_name", "firstname"])
      ).trim();
      const lastName = String(
        getFirstSheetEntry(entries, ["genentity_last_name", "last_name", "lastname", "surname"])
      ).trim();

      if (!firstName || !lastName) return;

      const companyValue = String(getFirstSheetEntry(entries, ["company"])).trim();
      const knownAsName = String(getFirstSheetEntry(entries, ["genentity_known_as_name", "known_as_name", "alias"])).trim();
      const departmentValue = String(getFirstSheetEntry(entries, ["hierarchy_department_hierarchy_name", "department"])).trim();
      const paypointValue = String(getFirstSheetEntry(entries, ["hierarchy_paypoint_hierarchy_name", "paypoint"])).trim();
      const storeSourceValue = String(getFirstSheetEntry(entries, ["hierarchy_stores_hierarchy_name", "store"])).trim();
      const storeAssignment = parseStaffListStoreValue(storeSourceValue);
      const companyRuleValue = String(getFirstSheetEntry(entries, ["company_rule", "cost_center"])).trim();
      const payslipTypeValue = String(getFirstSheetEntry(entries, ["payslip_type", "person_type"])).trim();
      const payRunDefinitionValue = String(getFirstSheetEntry(entries, ["pay_run_definition", "business_unit"])).trim();
      const terminationReason = String(getFirstSheetEntry(entries, ["employee_termination_reason", "termination_reason"])).trim();
      const terminationDate = parseEmployeeDate(getFirstSheetEntry(entries, ["employee_termination_date", "termination_date"]));
      const shouldBeInactive = Boolean(terminationReason || terminationDate);
      const regionValue = deriveStaffListRegion(departmentValue, paypointValue, existing);
      const storeLabel = storeAssignment.storeDisplay || storeAssignment.store;

      employeeMap.set(code, {
        employee_code: code,
        first_name: firstName,
        last_name: lastName,
        gender: normalizeEmployeeGenderValue(getFirstSheetEntry(entries, ["genentity_gender", "gender"])) || "",
        title: extractTitleFromDisplayName(displayName) || "",
        alias: knownAsName,
        id_number: String(getFirstSheetEntry(entries, ["genentity_id_number", "id_number", "national_id"])).trim(),
        email: existing?.email || "",
        phone: existing?.phone || "",
        job_title: existing?.job_title || "",
        department: departmentValue,
        region: regionValue,
        store: storeAssignment.store,
        store_code: storeAssignment.storeCode,
        hire_date: parseEmployeeDate(getFirstSheetEntry(entries, ["employee_date_engaged", "hire_date"])),
        person_type: payslipTypeValue,
        fingerprints_enrolled: existing?.fingerprints_enrolled ?? null,
        company: companyValue,
        branch: paypointValue,
        business_unit: payRunDefinitionValue,
        cost_center: companyRuleValue,
        team: storeLabel,
        ta_integration_id_1: existing?.ta_integration_id_1 || "",
        ta_integration_id_2: existing?.ta_integration_id_2 || "",
        access_profile: existing?.access_profile || "",
        ta_enabled: existing?.ta_enabled ?? null,
        permanent: existing?.permanent ?? null,
        active: shouldBeInactive ? false : true,
        termination_reason: terminationReason,
        termination_date: terminationDate,
        status: shouldBeInactive ? "inactive" : "active",
      });
    });
  });

  const parsedEmployees = Array.from(employeeMap.values());
  return {
    employees: parsedEmployees,
    inactiveCount: parsedEmployees.filter((employee) => employee.status === "inactive").length,
  };
}

const STAFF_LIST_COMPARE_FIELDS: Array<keyof EmployeeInput> = [
  "first_name",
  "last_name",
  "gender",
  "title",
  "alias",
  "id_number",
  "department",
  "region",
  "store",
  "store_code",
  "hire_date",
  "person_type",
  "company",
  "branch",
  "business_unit",
  "cost_center",
  "team",
  "active",
  "status",
  "termination_reason",
  "termination_date",
];

const STAFF_LIST_FIELD_LABELS: Record<string, string> = {
  first_name: "First name",
  last_name: "Last name",
  gender: "Gender",
  title: "Title",
  alias: "Known as",
  id_number: "ID number",
  department: "Department",
  region: "Region",
  store: "Store",
  store_code: "Store code",
  hire_date: "Hire date",
  person_type: "Payslip type",
  company: "Company",
  branch: "Paypoint",
  business_unit: "Pay run",
  cost_center: "Company rule",
  team: "Team",
  active: "Active flag",
  status: "Status",
  termination_reason: "Termination reason",
  termination_date: "Termination date",
};

function normalizeComparableValue(value: unknown) {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function employeeToRollbackInput(employee: Employee): EmployeeInput {
  return {
    employee_code: employee.employee_code,
    first_name: employee.first_name,
    last_name: employee.last_name,
    gender: employee.gender || "",
    title: employee.title || "",
    alias: employee.alias || "",
    id_number: employee.id_number || "",
    email: employee.email || "",
    phone: employee.phone || "",
    job_title: employee.job_title || "",
    department: employee.department || "",
    region: employee.region || "",
    store: employee.store || "",
    store_code: employee.store_code || "",
    hire_date: employee.hire_date || "",
    person_type: employee.person_type || "",
    fingerprints_enrolled: employee.fingerprints_enrolled ?? null,
    company: employee.company || "",
    branch: employee.branch || "",
    business_unit: employee.business_unit || "",
    cost_center: employee.cost_center || "",
    team: employee.team || "",
    ta_integration_id_1: employee.ta_integration_id_1 || "",
    ta_integration_id_2: employee.ta_integration_id_2 || "",
    access_profile: employee.access_profile || "",
    ta_enabled: employee.ta_enabled ?? null,
    permanent: employee.permanent ?? null,
    active: employee.active ?? employee.status === "active",
    termination_reason: employee.termination_reason || "",
    termination_date: employee.termination_date || "",
    status: employee.status,
  };
}

function analyzeStaffListChanges(parsedEmployees: EmployeeInput[], existingEmployees: Employee[]) {
  const existingMap = new Map(existingEmployees.map((employee) => [normalizeEmployeeCode(employee.employee_code), employee]));
  const updatesToApply: EmployeeInput[] = [];
  const reportItems: EmployeeUpdateReportItem[] = [];
  const rollbackEmployees: EmployeeInput[] = [];
  let matchedProfiles = 0;
  let updatedProfiles = 0;
  let inactiveProfiles = 0;
  let unchangedProfiles = 0;
  let unmatchedRows = 0;

  parsedEmployees.forEach((candidate) => {
    const code = normalizeEmployeeCode(candidate.employee_code);
    const existing = existingMap.get(code);

    if (!existing) {
      unmatchedRows += 1;
      reportItems.push({
        employee_code: code,
        employee_name: `${candidate.first_name} ${candidate.last_name}`.trim(),
        change_type: "unmatched",
        changed_fields: [],
      });
      return;
    }

    matchedProfiles += 1;
    const changedFields = STAFF_LIST_COMPARE_FIELDS
      .filter((field) => normalizeComparableValue(existing[field as keyof Employee]) !== normalizeComparableValue(candidate[field]))
      .map((field) => STAFF_LIST_FIELD_LABELS[String(field)] || String(field));

    if (changedFields.length === 0) {
      unchangedProfiles += 1;
      reportItems.push({
        employee_code: code,
        employee_name: `${candidate.first_name} ${candidate.last_name}`.trim(),
        change_type: "unchanged",
        changed_fields: [],
      });
      return;
    }

    updatedProfiles += 1;
    if (candidate.status === "inactive" || candidate.active === false) {
      inactiveProfiles += 1;
    }

    updatesToApply.push(candidate);
    rollbackEmployees.push(employeeToRollbackInput(existing));
    reportItems.push({
      employee_code: code,
      employee_name: `${candidate.first_name} ${candidate.last_name}`.trim(),
      change_type: candidate.status === "inactive" || candidate.active === false ? "inactive" : "updated",
      changed_fields: changedFields,
    });
  });

  return {
    updatesToApply,
    rollbackEmployees,
    reportItems,
    matchedProfiles,
    updatedProfiles,
    inactiveProfiles,
    unchangedProfiles,
    unmatchedRows,
  };
}

function getQuickRangeValues(days: number) {
  const endDate = new Date();
  endDate.setHours(0, 0, 0, 0);
  const startDate = new Date(endDate);
  startDate.setDate(endDate.getDate() - (days - 1));
  return {
    startDate: formatDateValue(startDate),
    endDate: formatDateValue(endDate),
  };
}

function formatTrendLabel(date: Date, totalDays: number) {
  if (totalDays <= 7) return date.toLocaleDateString(undefined, { weekday: "short" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function buildCompanyOverviewDataFromRecords(records: AttendanceRecord[]): OverviewDatum[] {
  const totals: Record<string, number> = { atWork: 0, awol: 0, leave: 0, dayOff: 0, other: 0 };

  records.forEach((record) => {
    if (record.atWork) totals.atWork += 1;
    else if (record.problem) totals.awol += 1;
    else if (record.leave) totals.leave += 1;
    else if (record.dayOff) totals.dayOff += 1;
    else totals.other += 1;
  });

  const selectedTotal = Object.values(totals).reduce((sum, value) => sum + value, 0);
  return ATTENDANCE_STATUS_CONFIG.map((item) => {
    const count = totals[item.key] ?? 0;
    const percentage = selectedTotal === 0 ? 0 : Number(((count / selectedTotal) * 100).toFixed(1));
    return {
      ...item,
      count,
      percentage,
      detail: `${percentage}% of the selected total`,
    };
  });
}

function normalizeOverviewCompare(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function normalizeStoreLookupKey(value: unknown) {
  return normalizeOverviewCompare(value).replace(/\s+/g, " ");
}

function normalizeDeviceType(value: unknown): "physical" | "logical" {
  const normalized = normalizeOverviewCompare(value);
  return normalized.includes("physical") ? "physical" : "logical";
}

function isOverviewEmployeeReportable(employee: Employee | undefined | null) {
  if (!employee) return false;
  if (employee.active === false) return false;
  const status = normalizeOverviewCompare(employee.status);
  return status !== "inactive" && status !== "terminated";
}

function buildOverviewStoreKey(store: unknown, storeCode: unknown) {
  return `${String(storeCode || "").trim().toUpperCase()}::${String(store || "").trim().toUpperCase()}`;
}

function buildOverviewStoreLabel(store: unknown, storeCode: unknown) {
  const cleanStore = String(store || "").trim() || "Unassigned Store";
  const cleanStoreCode = String(storeCode || "").trim();
  return cleanStoreCode ? `${cleanStoreCode} - ${cleanStore} (${cleanStoreCode})` : cleanStore;
}

const OVERVIEW_DAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

function getOverviewDayKey(date: Date) {
  return OVERVIEW_DAY_KEYS[(date.getDay() + 6) % 7];
}

function buildClockingsByEmployee(clockEvents: BiometricClockEvent[]) {
  const map = new Map<string, string[]>();

  clockEvents.forEach((event) => {
    const employeeCode = normalizeEmployeeCode(event.employee_code);
    if (!employeeCode) return;
    const timeValue = event.clock_time || formatClockTime(new Date(event.clocked_at));
    if (!timeValue) return;
    const existing = map.get(employeeCode) || [];
    existing.push(timeValue);
    map.set(employeeCode, existing);
  });

  map.forEach((clockings, employeeCode) => {
    const unique = Array.from(new Set(clockings.filter(Boolean))).sort((a, b) => a.localeCompare(b));
    map.set(employeeCode, unique);
  });

  return map;
}

function buildLeaveCodesByDate(applications: Awaited<ReturnType<typeof getLeaveApplications>>) {
  const map = new Map<string, Set<string>>();

  applications
    .filter((application) => application.apply_status === "applied" && application.matched_employee_code)
    .forEach((application) => {
      expandLeaveDateRange(application.leave_start_date, application.leave_end_date).forEach((dateKey) => {
        const set = map.get(dateKey) || new Set<string>();
        set.add(normalizeEmployeeCode(application.matched_employee_code));
        map.set(dateKey, set);
      });
    });

  return map;
}

function buildRosterStatusLookupsForRange(
  shiftRosters: Awaited<ReturnType<typeof getShiftRosters>>,
  startDate: Date,
  endDate: Date
) {
  const lookupsByDate = new Map<string, Map<string, { scheduled: boolean; dayOff: boolean; leave: boolean; store: string; storeCode: string }>>();
  
  // Index roster rows by week label and day position
  const weekDayRosters = new Map<string, Map<number, { roster: typeof shiftRosters[0]; row: typeof shiftRosters[0]['rows'][0] }[]>>();
  
  for (let r = 0; r < shiftRosters.length; r++) {
    const roster = shiftRosters[r];
    // Get week_label from first row (all rows in a roster have same week)
    const weekLabel = roster.rows[0]?.week_label?.trim().toUpperCase() || "";
    if (!weekLabel) continue;
    
    if (!weekDayRosters.has(weekLabel)) {
      weekDayRosters.set(weekLabel, new Map());
    }
    const dayMap = weekDayRosters.get(weekLabel)!;
    
    for (let rowIdx = 0; rowIdx < roster.rows.length; rowIdx++) {
      const row = roster.rows[rowIdx];
      const employeeCode = normalizeEmployeeCode(row.employee_code);
      if (!employeeCode) continue;
      
      // Check each day column (0=monday, 6=sunday)
      for (let dayPos = 0; dayPos < 7; dayPos++) {
        const dayKey = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'][dayPos] as keyof typeof row;
        const rawValue = String(row[dayKey] || "").trim();
        if (!rawValue) continue;
        
        if (!dayMap.has(dayPos)) {
          dayMap.set(dayPos, []);
        }
        dayMap.get(dayPos)!.push({ roster, row });
      }
    }
  }

  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    const dateKey = formatDateValue(cursor);
    const weekLabel = getWeekCycleLabel(cursor).toUpperCase();
    
    const dayMap = weekDayRosters.get(weekLabel);
    if (dayMap) {
      const dayPos = (cursor.getDay() + 6) % 7; // Convert JS day (0=Sun) to our day (0=Mon)
      const dayRosters = dayMap.get(dayPos) || [];
      
      const lookup = new Map<string, { scheduled: boolean; dayOff: boolean; leave: boolean; store: string; storeCode: string }>();
      
      for (let i = 0; i < dayRosters.length; i++) {
        const { roster, row } = dayRosters[i];
        const employeeCode = normalizeEmployeeCode(row.employee_code);
        const dayKey = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'][dayPos] as keyof typeof row;
        const rawValue = String(row[dayKey] || "").trim().toUpperCase();
        
        const isDayOff = rawValue === "OFF" || rawValue === "OFF DAY";
        const isLeave = /\b(AL|SL|LEAVE|ANNUAL LEAVE|SICK LEAVE)\b/.test(rawValue);
        const scheduled = !isDayOff && !isLeave;
        
        if (!lookup.has(employeeCode)) {
          lookup.set(employeeCode, {
            scheduled,
            dayOff: isDayOff,
            leave: isLeave,
            store: roster.store_name || "",
            storeCode: roster.store_code || "",
          });
        }
      }
      
      lookupsByDate.set(dateKey, lookup);
    }
    
    cursor.setDate(cursor.getDate() + 1);
  }
  
  return lookupsByDate;
}

function buildRosterStatusLookup(
  shiftRosters: Awaited<ReturnType<typeof getShiftRosters>>,
  dateValue: string
) {
  const lookup = new Map<string, { scheduled: boolean; dayOff: boolean; leave: boolean; store: string; storeCode: string }>();
  const selectedDate = parseDateValue(dateValue);
  if (!selectedDate) return lookup;

  const weekLabel = getWeekCycleLabel(selectedDate).toUpperCase();
  const dayKey = getOverviewDayKey(selectedDate);

  for (let i = 0; i < shiftRosters.length; i++) {
    const roster = shiftRosters[i];
    for (let j = 0; j < roster.rows.length; j++) {
      const row = roster.rows[j];
      if (String(row.week_label || "").trim().toUpperCase() !== weekLabel) continue;

      const employeeCode = normalizeEmployeeCode(row.employee_code);
      if (!employeeCode) continue;

      const rawValue = String(row[dayKey] || "").trim();
      if (!rawValue) continue;

      const normalizedValue = rawValue.toUpperCase();
      const isDayOff = normalizedValue === "OFF" || normalizedValue === "OFF DAY";
      const isLeave = /\b(AL|SL|LEAVE|ANNUAL LEAVE|SICK LEAVE)\b/.test(normalizedValue);
      const scheduled = !isDayOff && !isLeave;
      const current = lookup.get(employeeCode) || {
        scheduled: false,
        dayOff: false,
        leave: false,
        store: roster.store_name || "",
        storeCode: roster.store_code || "",
      };

      lookup.set(employeeCode, {
        scheduled: current.scheduled || scheduled,
        dayOff: current.dayOff || isDayOff,
        leave: current.leave || isLeave,
        store: current.store || roster.store_name || "",
        storeCode: current.storeCode || roster.store_code || "",
      });
    }
  }

  return lookup;
}

function buildOverviewAttendanceRecordsFromSources({
  dateValue,
  existingRecords,
  employeeProfiles,
  shiftRosters,
  clockEvents,
  leaveApplications,
  precomputedLookups,
}: {
  dateValue: string;
  existingRecords: AttendanceRecord[];
  employeeProfiles: Employee[];
  shiftRosters: Awaited<ReturnType<typeof getShiftRosters>>;
  clockEvents: BiometricClockEvent[];
  leaveApplications: Awaited<ReturnType<typeof getLeaveApplications>>;
  precomputedLookups?: {
    rosterLookup: Map<string, { scheduled: boolean; dayOff: boolean; leave: boolean; store: string; storeCode: string }>;
    clockingsByEmployee: Map<string, string[]>;
    leaveCodes: Set<string>;
  };
}) {
  const employeeMap = new Map(employeeProfiles.map((employee) => [normalizeEmployeeCode(employee.employee_code), employee]));
  const existingMap = new Map(existingRecords.map((record) => [normalizeEmployeeCode(record.employeeCode), record]));
  const rosterLookup = precomputedLookups?.rosterLookup || buildRosterStatusLookup(shiftRosters, dateValue);
  const clockingsByEmployee = precomputedLookups?.clockingsByEmployee || buildClockingsByEmployee(clockEvents);
  const leaveCodes = precomputedLookups?.leaveCodes || (buildLeaveCodesByDate(leaveApplications).get(dateValue) || new Set<string>());

  const activeEmployeeCodes = new Set(
    employeeProfiles
      .filter((employee) => employee.status === "active")
      .map((employee) => normalizeEmployeeCode(employee.employee_code))
  );

  const allCodes = new Set<string>([
    ...activeEmployeeCodes,
    ...existingRecords.map((record) => normalizeEmployeeCode(record.employeeCode)),
    ...clockingsByEmployee.keys(),
    ...rosterLookup.keys(),
    ...leaveCodes,
  ]);

  const synthesized: AttendanceRecord[] = [];
  for (const employeeCode of allCodes) {
    if (!employeeCode) continue;
    const employee = employeeMap.get(employeeCode);
    const existing = existingMap.get(employeeCode);
    const roster = rosterLookup.get(employeeCode);
    const incomingClockings = clockingsByEmployee.get(employeeCode) || [];
    const clockings = Array.from(new Set([...(existing?.clockings || []), ...incomingClockings])).sort((a, b) => a.localeCompare(b));

    const scheduled = Boolean(existing?.scheduled || roster?.scheduled || existing?.atWork || existing?.leave || existing?.dayOff || existing?.problem);
    const atWork = Boolean(existing?.atWork || clockings.length > 0);
    let leave = Boolean(existing?.leave || roster?.leave || leaveCodes.has(employeeCode));
    let dayOff = Boolean(existing?.dayOff || roster?.dayOff);
    let problem = Boolean(existing?.problem);

    if (atWork) {
      leave = false;
      dayOff = false;
      problem = false;
    } else if (leave) {
      dayOff = false;
      problem = false;
    } else if (dayOff) {
      problem = false;
    } else if (scheduled) {
      problem = true;
    }

    const derivedClock = deriveClockStatus({ leave, dayOff, clockings });
    const name =
      existing?.name ||
      `${employee?.first_name || ""} ${employee?.last_name || ""}`.trim() ||
      employeeCode;
    const region = existing?.region || employee?.region || "Unassigned Region";
    const store = existing?.store || employee?.store || employee?.branch || roster?.store || "Unassigned Store";
    const storeCode = existing?.storeCode || employee?.store_code || roster?.storeCode || "";

    synthesized.push({
      id: existing?.id || employee?.id || `${dateValue}__${employeeCode}`,
      employeeCode,
      name,
      region,
      regionCode: existing?.regionCode || "",
      store,
      storeCode,
      scheduled,
      atWork,
      leave,
      dayOff,
      problem,
      clockCount: derivedClock.clockCount,
      firstClock: derivedClock.firstClock,
      lastClock: derivedClock.lastClock,
      clockings,
      reportStatus: atWork ? derivedClock.status : leave ? "Leave" : dayOff ? "Day Off" : problem ? "AWOL" : "Unscheduled",
    } satisfies AttendanceRecord);
  }

  return synthesized.sort(
    (a, b) =>
      a.region.localeCompare(b.region) ||
      a.store.localeCompare(b.store) ||
      a.name.localeCompare(b.name) ||
      a.employeeCode.localeCompare(b.employeeCode)
  );
}

function buildOverviewTrendSeriesFromSources({
  startDateValue,
  endDateValue,
  existingRecords,
  employeeProfiles,
  shiftRosters,
  clockEvents,
  leaveApplications,
  precomputedLookups,
}: {
  startDateValue: string;
  endDateValue: string;
  existingRecords: AttendanceRecord[];
  employeeProfiles: Employee[];
  shiftRosters: Awaited<ReturnType<typeof getShiftRosters>>;
  clockEvents: BiometricClockEvent[];
  leaveApplications: Awaited<ReturnType<typeof getLeaveApplications>>;
  precomputedLookups?: {
    rosterLookupsByDate: Map<string, Map<string, { scheduled: boolean; dayOff: boolean; leave: boolean; store: string; storeCode: string }>>;
    clocksByDate: Map<string, BiometricClockEvent[]>;
    leaveCodesByDate: Map<string, Set<string>>;
  };
}) {
  const startDate = parseDateValue(startDateValue);
  const endDate = parseDateValue(endDateValue);
  if (!startDate || !endDate || startDate > endDate) return [] as Array<Record<string, number | string>>;

  const totalDays = Math.max(1, Math.floor((endDate.getTime() - startDate.getTime()) / 86400000) + 1);

  // Pre-compute clocks by date
  const clocksByDate = precomputedLookups?.clocksByDate || (() => {
    const m = new Map<string, BiometricClockEvent[]>();
    for (let i = 0; i < clockEvents.length; i++) {
      const event = clockEvents[i];
      const dateKey = event.clock_date;
      const current = m.get(dateKey) || [];
      current.push(event);
      m.set(dateKey, current);
    }
    return m;
  })();

  // Pre-compute clockings by employee for each date
  const clockingsByDateEmployee = new Map<string, Map<string, string[]>>();
  clocksByDate.forEach((events, dateKey) => {
    const employeeClockings = new Map<string, string[]>();
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const code = normalizeEmployeeCode(event.employee_code);
      if (!code) continue;
      const timeValue = event.clock_time || formatClockTime(new Date(event.clocked_at));
      if (!timeValue) continue;
      const existing = employeeClockings.get(code) || [];
      existing.push(timeValue);
      employeeClockings.set(code, existing);
    }
    employeeClockings.forEach((clockings, code) => {
      const unique = Array.from(new Set(clockings)).sort((a, b) => a.localeCompare(b));
      employeeClockings.set(code, unique);
    });
    clockingsByDateEmployee.set(dateKey, employeeClockings);
  });

  // Pre-compute attendance by date
  const attendanceByDate = new Map<string, Map<string, AttendanceRecord>>();
  for (let i = 0; i < existingRecords.length; i++) {
    const record = existingRecords[i];
    const uploadDateMatch = record.id.match(/^(\d{4}-\d{2}-\d{2})__/);
    const dateKey = uploadDateMatch?.[1] || "";
    if (!dateKey) continue;
    if (!attendanceByDate.has(dateKey)) {
      attendanceByDate.set(dateKey, new Map());
    }
    const code = normalizeEmployeeCode(record.employeeCode);
    attendanceByDate.get(dateKey)!.set(code, record);
  }

  const leaveCodesByDate = precomputedLookups?.leaveCodesByDate || buildLeaveCodesByDate(leaveApplications);
  const rosterLookupsByDate = precomputedLookups?.rosterLookupsByDate || buildRosterStatusLookupsForRange(shiftRosters, startDate, endDate);

  // Collect ALL unique employee codes across all data sources (one-time cost)
  const allUniqueCodes = new Set<string>();
  existingRecords.forEach(r => allUniqueCodes.add(normalizeEmployeeCode(r.employeeCode)));
  clockEvents.forEach(e => allUniqueCodes.add(normalizeEmployeeCode(e.employee_code)));
  leaveApplications.forEach(l => {
    if (l.apply_status === "applied" && l.matched_employee_code) {
      allUniqueCodes.add(normalizeEmployeeCode(l.matched_employee_code));
    }
  });

  const series: Array<Record<string, number | string>> = [];
  const cursor = new Date(startDate);
  
  while (cursor <= endDate) {
    const dateKey = formatDateValue(cursor);
    const dayAttendanceMap = attendanceByDate.get(dateKey) || new Map();
    const dayClockings = clockingsByDateEmployee.get(dateKey) || new Map();
    const dayLeaveCodes = leaveCodesByDate.get(dateKey) || new Set<string>();
    const rosterLookup = rosterLookupsByDate.get(dateKey) || new Map();

    let atWork = 0, awol = 0, scheduled = 0, leave = 0, dayOff = 0, other = 0;

    // Only iterate over employees that have ANY data for this day
    allUniqueCodes.forEach((employeeCode) => {
      if (!employeeCode) return;
      
      const existing = dayAttendanceMap.get(employeeCode);
      const hasExistingData = existing !== undefined;
      const hasClocks = dayClockings.has(employeeCode);
      const hasRoster = rosterLookup.has(employeeCode);
      const hasLeave = dayLeaveCodes.has(employeeCode);
      
      // Skip if no data for this day
      if (!hasExistingData && !hasClocks && !hasRoster && !hasLeave) return;

      const incomingClockings = dayClockings.get(employeeCode) || [];
      const hasExistingClocks = (existing?.clockings || []).length > 0;
      const totalClockings = hasExistingClocks || incomingClockings.length > 0;

      const recScheduled = Boolean(existing?.scheduled || rosterLookup.get(employeeCode)?.scheduled || existing?.atWork || existing?.leave || existing?.dayOff || existing?.problem);
      const recAtWork = Boolean(existing?.atWork || totalClockings);
      let recLeave = Boolean(existing?.leave || rosterLookup.get(employeeCode)?.leave || hasLeave);
      let recDayOff = Boolean(existing?.dayOff || rosterLookup.get(employeeCode)?.dayOff);
      let recProblem = Boolean(existing?.problem);

      if (recAtWork) {
        recLeave = false;
        recDayOff = false;
        recProblem = false;
      } else if (recLeave) {
        recDayOff = false;
        recProblem = false;
      } else if (recDayOff) {
        recProblem = false;
      }

      if (recAtWork) atWork++;
      else if (recProblem) awol++;
      else if (recLeave) leave++;
      else if (recDayOff) dayOff++;
      else if (recScheduled) scheduled++;
      else other++;
    });

    series.push({
      label: formatTrendLabel(new Date(cursor), totalDays),
      dateValue: dateKey,
      atWork,
      awol,
      scheduled,
      leave,
      dayOff,
      other,
    });

    cursor.setDate(cursor.getDate() + 1);
  }

  return series;
}

function mapDatabaseAttendanceRecord(
  record: Awaited<ReturnType<typeof getAttendanceByDate>>[number]
): AttendanceRecord {
  return {
    id: record.id,
    employeeCode: record.employee_code,
    name: record.name,
    region: record.region,
    regionCode: record.region_code || "",
    store: record.store,
    storeCode: record.store_code || "",
    scheduled: record.scheduled,
    atWork: record.at_work,
    leave: record.leave,
    dayOff: record.day_off,
    problem: record.problem,
    clockCount: record.clock_count || 0,
    firstClock: record.first_clock || "",
    lastClock: record.last_clock || "",
    clockings: record.clockings || [],
    reportStatus:
      record.status_label ||
      deriveClockStatus({
        leave: record.leave,
        dayOff: record.day_off,
        clockings: record.clockings || [],
      }).status,
  };
}

export default function App() {
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const deviceUploadInputRef = useRef<HTMLInputElement | null>(null);
  const employeeUploadInputRef = useRef<HTMLInputElement | null>(null);
  const employeeUpdateUploadInputRef = useRef<HTMLInputElement | null>(null);
  const ipulseAutoSyncRunningRef = useRef(false);

  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [deviceRecords, setDeviceRecords] = useState<DeviceRecord[]>(() => {
    try {
      const stored = localStorage.getItem(DEVICES_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (!Array.isArray(parsed)) return [];
        const hasTypedRows = parsed.some((row) => {
          if (!row || typeof row !== "object") return false;
          const record = row as Record<string, unknown>;
          return typeof record.deviceType === "string" || typeof record["device_type"] === "string";
        });
        if (!hasTypedRows) {
          try {
            localStorage.removeItem(DEVICES_STORAGE_KEY);
            localStorage.removeItem(`${DEVICES_STORAGE_KEY}_date`);
          } catch {}
          return [];
        }
        return parsed.map((row, index) => {
          const record = row as Partial<DeviceRecord> & Record<string, unknown>;
          const statusValue = normalizeOverviewCompare(record.status);
          const status: "online" | "offline" | "warning" =
            statusValue === "offline" || statusValue === "warning"
              ? (statusValue as "offline" | "warning")
              : "online";
          const name = String(record.name || record.deviceName || `Device ${index + 1}`).trim();
          return {
            id: String(record.id || `DEV-${index + 1}`),
            name,
            deviceName: String(record.deviceName || name).trim(),
            region: String(record.region || "Unassigned Region").trim(),
            store: String(record.store || "Unassigned Store").trim(),
            deviceType: normalizeDeviceType(record.deviceType || record["device_type"] || record.type),
            status,
            lastSeen: String(record.lastSeen || new Date().toISOString()),
            lastSeenDate: record.lastSeenDate ? String(record.lastSeenDate) : undefined,
          };
        });
      }
    } catch {}
    return [];
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedRegion, setSelectedRegion] = useState("all");
  const [selectedStore, setSelectedStore] = useState("all");
  const [activeNav, setActiveNav] = useState<(typeof sidebarItems)[number]["key"]>("overview");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [attendanceImportDate, setAttendanceImportDate] = useState("");
  const [deviceImportDate, setDeviceImportDate] = useState(() => {
    try {
      const stored = localStorage.getItem(`${DEVICES_STORAGE_KEY}_date`);
      if (stored) {
        return new Date(stored).toLocaleDateString();
      }
    } catch {}
    return "";
  });
  const [saveMessage, setSaveMessage] = useState("");
  const [trialResetReady, setTrialResetReady] = useState(false);
  const [activeRangeDays, setActiveRangeDays] = useState(7);
  const [trendView, setTrendView] = useState("all");
  const [selectedTrendKeys, setSelectedTrendKeys] = useState<string[]>([...TREND_VIEW_OPTIONS[0].keys]);
  const [overviewStartDate, setOverviewStartDate] = useState(() => getQuickRangeValues(7).startDate);
  const [overviewEndDate, setOverviewEndDate] = useState(() => getQuickRangeValues(7).endDate);
  const [selectedSlice, setSelectedSlice] = useState<string | null>(null);
  const [percentageFilter, setPercentageFilter] = useState<number>(0);
  const [expandedStores, setExpandedStores] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"pie" | "table">("pie");
  const [selectedOverviewDate, setSelectedOverviewDate] = useState<string>(formatDateValue(new Date()));
  const [selectedOverviewRegion, setSelectedOverviewRegion] = useState<string>("all");
  const [selectedOverviewStoreKey, setSelectedOverviewStoreKey] = useState<string>("all");
  const [overviewStoreSearch, setOverviewStoreSearch] = useState("");
  const [expandedRegions, setExpandedRegions] = useState<Set<string>>(new Set());
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [overviewAttendanceRecords, setOverviewAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [overviewTrendSeries, setOverviewTrendSeries] = useState<Array<Record<string, number | string>>>([]);

  useEffect(() => {
    if (!saveMessage) return;
    const timeout = window.setTimeout(() => setSaveMessage(""), 6000);
    return () => window.clearTimeout(timeout);
  }, [saveMessage]);
  const [overviewEmployeeProfiles, setOverviewEmployeeProfiles] = useState<Employee[]>([]);
  const [overviewModuleSnapshot, setOverviewModuleSnapshot] = useState<OverviewModuleSnapshot>({
    employeeProfiles: 0,
    activeEmployees: 0,
    inactiveEmployees: 0,
    terminatedEmployees: 0,
    shiftRosters: 0,
    shiftRows: 0,
    enabledShiftSyncs: 0,
    leaveUploads: 0,
    leaveRowsForDate: 0,
    appliedLeaveForDate: 0,
    unmatchedLeaveForDate: 0,
    customCalendarEvents: 0,
    calendarEventsThisMonth: 0,
    ipulseAutoSyncEnabled: false,
    ipulseLastSyncStatus: "",
    ipulseLastSyncAt: "",
    syncLogCount: 0,
    syncErrorsOpen: 0,
  });
  const [isLoadingOverview, setIsLoadingOverview] = useState(false);
  const [overviewLastUpdatedAt, setOverviewLastUpdatedAt] = useState("");

  // Employee state
  const [employees, setEmployees] = useState<Employee[]>([]);
  const employeesRef = useRef<Employee[]>([]);
  const [clockOverview, setClockOverview] = useState({
    totalEvents: 0,
    employeesWithClocks: 0,
    verifiedEvents: 0,
  });
  const clockOverviewRef = useRef({
    totalEvents: 0,
    employeesWithClocks: 0,
    verifiedEvents: 0,
  });
  const [isLoadingEmployees, setIsLoadingEmployees] = useState(false);
  const [isLoadingClockEvents, setIsLoadingClockEvents] = useState(false);
  const employeeRequestRef = useRef<{ fetchedAt: number; inFlight: boolean }>({
    fetchedAt: 0,
    inFlight: false,
  });
  const employeeLoadPromiseRef = useRef<Promise<Employee[]> | null>(null);
  const clockRequestRef = useRef<{ fetchedAt: number; inFlight: boolean }>({
    fetchedAt: 0,
    inFlight: false,
  });
  const clockLoadPromiseRef = useRef<Promise<Awaited<ReturnType<typeof getClockStats>>> | null>(null);
  const hasInitializedOverviewRangeRef = useRef(false);
  const overviewRequestRef = useRef<{ key: string; fetchedAt: number; inFlight: boolean }>({
    key: "",
    fetchedAt: 0,
    inFlight: false,
  });
  const overviewDataCacheRef = useRef<{
    employees: Employee[];
    shiftRosters: Awaited<ReturnType<typeof getShiftRosters>>;
    leaveUploads: Awaited<ReturnType<typeof getLeaveUploads>>;
    rangeAttendance: Awaited<ReturnType<typeof getAttendanceByDateRange>>;
    rangeClockEvents: BiometricClockEvent[];
    leaveApplicationsForRange: Awaited<ReturnType<typeof getLeaveApplications>>;
    fetchedAt: number;
  } | null>(null);
  const activeNavRef = useRef<(typeof sidebarItems)[number]["key"]>(activeNav);
  const overviewTrendRequestRef = useRef(0);
  const [isUpdatingEmployeesFromStaffList, setIsUpdatingEmployeesFromStaffList] = useState(false);
  const [staffListUploadProgress, setStaffListUploadProgress] = useState(0);
  const [staffListUploadStage, setStaffListUploadStage] = useState("");
  const [reportTemplates] = useState<ReportTemplate[]>(() => loadLocalArrayState<ReportTemplate>(REPORT_TEMPLATES_STORAGE_KEY));
  const [communicationProfiles, setCommunicationProfiles] = useState<CommunicationProfile[]>(() =>
    loadLocalArrayState<CommunicationProfile>(COMMUNICATION_PROFILES_STORAGE_KEY)
  );
  const [communicationAutomations, setCommunicationAutomations] = useState<CommunicationAutomation[]>(() =>
    loadLocalArrayState<CommunicationAutomation>(COMMUNICATION_AUTOMATIONS_STORAGE_KEY)
  );

  useEffect(() => {
    employeesRef.current = employees;
  }, [employees]);

  useEffect(() => {
    clockOverviewRef.current = clockOverview;
  }, [clockOverview]);

  // Load employees from database
  const loadEmployees = useCallback(async (options?: { force?: boolean }) => {
    const now = Date.now();
    const cachedEmployees = employeesRef.current;

    if (
      !options?.force &&
      cachedEmployees.length > 0 &&
      now - employeeRequestRef.current.fetchedAt < EMPLOYEE_REFRESH_TTL_MS
    ) {
      return cachedEmployees;
    }

    if (employeeRequestRef.current.inFlight && employeeLoadPromiseRef.current) {
      return employeeLoadPromiseRef.current;
    }

    employeeRequestRef.current.inFlight = true;
    setIsLoadingEmployees(true);

    employeeLoadPromiseRef.current = (async () => {
      try {
        await initializeEmployeeDatabase();
      const data = await getEmployees({ preferRemote: true });
        const mapped = data.map(mapEmployeeToRegionMaster);
        employeesRef.current = mapped;
        setEmployees(mapped);
        employeeRequestRef.current = {
          fetchedAt: Date.now(),
          inFlight: false,
        };
        return mapped;
      } finally {
        employeeRequestRef.current = {
          ...employeeRequestRef.current,
          inFlight: false,
        };
        employeeLoadPromiseRef.current = null;
        setIsLoadingEmployees(false);
      }
    })();

    return employeeLoadPromiseRef.current;
  }, []);

  const loadClockEvents = useCallback(async (options?: { force?: boolean }) => {
    const now = Date.now();
    if (!options?.force && now - clockRequestRef.current.fetchedAt < CLOCK_REFRESH_TTL_MS) {
      const cachedOverview = clockOverviewRef.current;
      return {
        totalEvents: cachedOverview.totalEvents,
        employeesWithClocks: cachedOverview.employeesWithClocks,
        verifiedEvents: cachedOverview.verifiedEvents,
      };
    }

    if (clockRequestRef.current.inFlight && clockLoadPromiseRef.current) {
      return clockLoadPromiseRef.current;
    }

    clockRequestRef.current.inFlight = true;
    setIsLoadingClockEvents(true);
    clockLoadPromiseRef.current = (async () => {
      try {
        await initializeClockDatabase();
        const overview = await getClockStats();
        setClockOverview({
          totalEvents: overview.totalEvents,
          employeesWithClocks: overview.employeesWithClocks,
          verifiedEvents: overview.verifiedEvents,
        });
        clockOverviewRef.current = {
          totalEvents: overview.totalEvents,
          employeesWithClocks: overview.employeesWithClocks,
          verifiedEvents: overview.verifiedEvents,
        };
        clockRequestRef.current = {
          fetchedAt: Date.now(),
          inFlight: false,
        };
        return overview;
      } finally {
        clockRequestRef.current = {
          ...clockRequestRef.current,
          inFlight: false,
        };
        clockLoadPromiseRef.current = null;
        setIsLoadingClockEvents(false);
      }
    })();

    return clockLoadPromiseRef.current;
  }, []);

  // Separate state for trend loading to allow pie chart to show first
  const [trendLoading, setTrendLoading] = useState(false);

  // Debounce timer ref for range changes
  const trendRangeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadOverviewDashboard = useCallback(async (options?: { force?: boolean; skipTrend?: boolean }) => {
    const overviewQueryKey = `${selectedOverviewDate || "none"}__${overviewStartDate || "none"}__${overviewEndDate || "none"}`;
    const now = Date.now();
    
    const cache = overviewDataCacheRef.current;
    const cacheAge = cache ? now - cache.fetchedAt : Infinity;
    const isCacheValid = cache && cacheAge < OVERVIEW_REFRESH_TTL_MS;
    
    if (
      !options?.force &&
      overviewRequestRef.current.key === overviewQueryKey &&
      isCacheValid &&
      !options?.skipTrend
    ) {
      return;
    }

    if (overviewRequestRef.current.inFlight && !options?.force) {
      return;
    }

    overviewRequestRef.current.inFlight = true;
    setIsLoadingOverview(true);

    try {
      // Phase 1: Load essential data (pie chart needs)
      const shouldFetchEmployees = !cache || options?.force;
      const employeeProfiles = shouldFetchEmployees
        ? await loadEmployees({ force: options?.force })
        : cache.employees;
      
      const shouldFetchShifts = !cache || options?.force;
      const shiftRosters = shouldFetchShifts ? await getShiftRosters() : cache.shiftRosters;
      
      const shouldFetchLeaveUploads = !cache || options?.force;
      const leaveUploads = shouldFetchLeaveUploads ? await getLeaveUploads() : cache.leaveUploads;
      
      // Load day-specific data for pie chart
      const [dayAttendance, leaveApplicationsForDate, latestSyncLogs, dayClockEvents] =
        await Promise.all([
          selectedOverviewDate ? getAttendanceByDate(selectedOverviewDate) : Promise.resolve([]),
          selectedOverviewDate
            ? getLeaveApplications({ startDate: selectedOverviewDate, endDate: selectedOverviewDate })
            : Promise.resolve([]),
          getSyncLogs(10),
          selectedOverviewDate
            ? getClockEvents({ startDate: selectedOverviewDate, endDate: selectedOverviewDate })
            : Promise.resolve([]),
        ]);

      const customCalendarEvents = loadCalendarEvents();
      const selectedDate = parseDateValue(selectedOverviewDate) || new Date();
      const monthEvents = getCombinedCalendarEvents([selectedDate.getFullYear()]).filter((event) => {
        const eventDate = parseDateValue(event.date);
        return (
          eventDate &&
          eventDate.getFullYear() === selectedDate.getFullYear() &&
          eventDate.getMonth() === selectedDate.getMonth()
        );
      });
      const shiftSyncSettings = await loadShiftSyncSettings();
      const latestConfig = await getConfig();
      const mappedDayAttendance = dayAttendance.map(mapDatabaseAttendanceRecord);

      const dayRosterLookup = buildRosterStatusLookup(shiftRosters, selectedOverviewDate);
      const dayClockingsByEmployee = buildClockingsByEmployee(dayClockEvents);
      const dayLeaveCodes = buildLeaveCodesByDate(leaveApplicationsForDate).get(selectedOverviewDate) || new Set<string>();

      const derivedOverviewRecords = selectedOverviewDate
        ? buildOverviewAttendanceRecordsFromSources({
            dateValue: selectedOverviewDate,
            existingRecords: mappedDayAttendance,
            employeeProfiles,
            shiftRosters,
            clockEvents: dayClockEvents,
            leaveApplications: leaveApplicationsForDate,
            precomputedLookups: {
              rosterLookup: dayRosterLookup,
              clockingsByEmployee: dayClockingsByEmployee,
              leaveCodes: dayLeaveCodes,
            },
          })
        : [];

      // Update cache with essential data
      overviewDataCacheRef.current = {
        employees: employeeProfiles,
        shiftRosters,
        leaveUploads,
        rangeAttendance: cache?.rangeAttendance || [],
        rangeClockEvents: cache?.rangeClockEvents || [],
        leaveApplicationsForRange: cache?.leaveApplicationsForRange || [],
        fetchedAt: now,
      };

      setOverviewAttendanceRecords(derivedOverviewRecords);
      setOverviewEmployeeProfiles(employeeProfiles);
      setOverviewModuleSnapshot({
        employeeProfiles: employeeProfiles.length,
        activeEmployees: employeeProfiles.filter((employee) => employee.status === "active").length,
        inactiveEmployees: employeeProfiles.filter((employee) => employee.status === "inactive").length,
        terminatedEmployees: employeeProfiles.filter((employee) => employee.status === "terminated").length,
        shiftRosters: shiftRosters.length,
        shiftRows: shiftRosters.reduce((sum, roster) => sum + roster.rows.length, 0),
        enabledShiftSyncs: shiftSyncSettings.sections.filter((section) => section.url).length,
        leaveUploads: leaveUploads.length,
        leaveRowsForDate: leaveApplicationsForDate.length,
        appliedLeaveForDate: leaveApplicationsForDate.filter((item) => item.apply_status === "applied").length,
        unmatchedLeaveForDate: leaveApplicationsForDate.filter((item) => item.apply_status !== "applied").length,
        customCalendarEvents: customCalendarEvents.length,
        calendarEventsThisMonth: monthEvents.length,
        ipulseAutoSyncEnabled: Boolean(latestConfig?.auto_sync_enabled),
        ipulseLastSyncStatus: latestConfig?.last_sync_status || "",
        ipulseLastSyncAt: latestConfig?.last_sync_at || "",
        syncLogCount: latestSyncLogs.length,
        syncErrorsOpen: latestSyncLogs.filter((log) => log.status === "error" || log.status === "partial").length,
      });
      setOverviewLastUpdatedAt(new Date().toISOString());
      
      // Show UI immediately with pie chart data
      setIsLoadingOverview(false);
      
      // Phase 2: Load and compute trend data asynchronously (skip if requested)
      if (options?.skipTrend) {
        overviewRequestRef.current = {
          key: overviewQueryKey,
          fetchedAt: Date.now(),
          inFlight: false,
        };
        return;
      }

      // Debounce trend computation
      if (trendRangeTimeoutRef.current) {
        clearTimeout(trendRangeTimeoutRef.current);
      }

      const trendRequestId = ++overviewTrendRequestRef.current;
      trendRangeTimeoutRef.current = setTimeout(async () => {
        if (trendRequestId !== overviewTrendRequestRef.current || activeNavRef.current !== "overview") {
          return;
        }

        setTrendLoading(true);
        try {
          const cache = overviewDataCacheRef.current;
          if (!cache || !overviewStartDate || !overviewEndDate) {
            setTrendLoading(false);
            return;
          }

          const [rangeAttendance, leaveApplicationsForRange, rangeClockEvents] =
            await Promise.all([
              getAttendanceByDateRange(overviewStartDate, overviewEndDate),
              getLeaveApplications({ startDate: overviewStartDate, endDate: overviewEndDate }),
              getClockEvents({ startDate: overviewStartDate, endDate: overviewEndDate }),
            ]);

          if (trendRequestId !== overviewTrendRequestRef.current || activeNavRef.current !== "overview") {
            return;
          }

          // Update cache with range data
          cache.rangeAttendance = rangeAttendance;
          cache.rangeClockEvents = rangeClockEvents;
          cache.leaveApplicationsForRange = leaveApplicationsForRange;
          cache.fetchedAt = Date.now();

          const mappedRangeAttendance = rangeAttendance.map(mapDatabaseAttendanceRecord);
          const rangeStartDate = parseDateValue(overviewStartDate);
          const rangeEndDate = parseDateValue(overviewEndDate);

          if (rangeStartDate && rangeEndDate) {
            const rangeClocksByDate = new Map<string, BiometricClockEvent[]>();
            for (const event of rangeClockEvents) {
              const current = rangeClocksByDate.get(event.clock_date) || [];
              current.push(event);
              rangeClocksByDate.set(event.clock_date, current);
            }
            const rangeLeaveCodesByDate = buildLeaveCodesByDate(leaveApplicationsForRange);
            const rangeRosterLookupsByDate = buildRosterStatusLookupsForRange(cache.shiftRosters, rangeStartDate, rangeEndDate);

            const derivedTrendSeries = buildOverviewTrendSeriesFromSources({
              startDateValue: overviewStartDate,
              endDateValue: overviewEndDate,
              existingRecords: mappedRangeAttendance.map((record, index) => ({
                ...record,
                id: `${rangeAttendance[index]?.upload_date || ""}__${record.employeeCode}`,
              })),
              employeeProfiles: cache.employees,
              shiftRosters: cache.shiftRosters,
              clockEvents: rangeClockEvents,
              leaveApplications: leaveApplicationsForRange,
              precomputedLookups: {
                rosterLookupsByDate: rangeRosterLookupsByDate,
                clocksByDate: rangeClocksByDate,
                leaveCodesByDate: rangeLeaveCodesByDate,
              },
            });

            if (trendRequestId !== overviewTrendRequestRef.current || activeNavRef.current !== "overview") {
              return;
            }

            setOverviewTrendSeries(derivedTrendSeries);
          }
        } catch (error) {
          console.error("Error loading trend data:", error);
        } finally {
          if (trendRequestId === overviewTrendRequestRef.current) {
            setTrendLoading(false);
          }
        }
      }, 300);

      overviewRequestRef.current = {
        key: overviewQueryKey,
        fetchedAt: Date.now(),
        inFlight: false,
      };
    } catch (error) {
      console.error("Error loading overview dashboard:", error);
    } finally {
      if (!overviewRequestRef.current.inFlight || options?.force) {
        setIsLoadingOverview(false);
      }
      overviewRequestRef.current = {
        ...overviewRequestRef.current,
        inFlight: false,
      };
    }
  }, [loadEmployees, overviewEndDate, overviewStartDate, selectedOverviewDate]);

  const loadAttendanceForDate = async (date: string, options?: { silent?: boolean }) => {
    if (!date) return [];

    const records = await getAttendanceByDate(date);
    const mappedRecords = records.map(mapDatabaseAttendanceRecord);

    setAttendanceRecords(mappedRecords);
    setAttendanceImportDate(date);
    setSelectedOverviewDate(date);

    if (!options?.silent) {
      setSaveMessage(
        mappedRecords.length > 0
          ? `Loaded ${mappedRecords.length} records from ${date}`
          : `No saved attendance records were found for ${date}`
      );
    }

    return mappedRecords;
  };

  useEffect(() => {
    let alive = true;

    const bootstrapTrialReset = async () => {
      const result = await performOneTimeTrialReset();
      if (!alive) return;
      if (result.ran) {
        setSaveMessage("App data was reset for a clean trial. Calendar events were kept.");
      }
      setTrialResetReady(true);
    };

    void bootstrapTrialReset();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!trialResetReady) return;
    if (!attendanceImportDate) return;
    window.localStorage.setItem(LAST_ATTENDANCE_DATE_STORAGE_KEY, attendanceImportDate);
  }, [attendanceImportDate, trialResetReady]);

  useEffect(() => {
    if (!trialResetReady) return;
    let alive = true;

    const hydrateSavedData = async () => {
      const [dates] = await Promise.all([getAvailableDates(), loadEmployees(), loadClockEvents()]);
      if (!alive) return;

      setAvailableDates(dates);

      const lastSavedDate =
        typeof window !== "undefined" ? window.localStorage.getItem(LAST_ATTENDANCE_DATE_STORAGE_KEY) || "" : "";
      const dateToLoad = (lastSavedDate && dates.includes(lastSavedDate) ? lastSavedDate : dates[0]) || "";

      if (dateToLoad) {
        await loadAttendanceForDate(dateToLoad, { silent: true });
      }
    };

    void hydrateSavedData();

    return () => {
      alive = false;
    };
  }, [loadClockEvents, loadEmployees, trialResetReady]);

  useEffect(() => {
    if (!trialResetReady) return;
    if (activeNav === "employees" || activeNav === "communications" || activeNav === "reports" || activeNav === "clockData" || activeNav === "leave") {
      void loadEmployees();
    }
  }, [activeNav, loadEmployees, trialResetReady]);

  useEffect(() => {
    if (!trialResetReady) return;
    if (activeNav === "employees") {
      void loadClockEvents();
    }
  }, [activeNav, loadClockEvents, trialResetReady]);

  useEffect(() => {
    activeNavRef.current = activeNav;
    if (activeNav === "overview") return;

    overviewTrendRequestRef.current += 1;
    if (trendRangeTimeoutRef.current) {
      clearTimeout(trendRangeTimeoutRef.current);
      trendRangeTimeoutRef.current = null;
    }
    setTrendLoading(false);
  }, [activeNav]);

  useEffect(() => {
    return () => {
      if (trendRangeTimeoutRef.current) {
        clearTimeout(trendRangeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!trialResetReady) return;
    if (activeNav !== "overview") return;

    let cancelled = false;
    const refreshOverview = async () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      await loadOverviewDashboard();
    };

    void refreshOverview();
    const interval = window.setInterval(() => {
      void refreshOverview();
    }, OVERVIEW_REFRESH_TTL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeNav, loadOverviewDashboard, trialResetReady]);

  useEffect(() => {
    if (!trialResetReady) return;
    if (activeNav !== "overview") return;
    if (!hasInitializedOverviewRangeRef.current) {
      hasInitializedOverviewRangeRef.current = true;
      return;
    }
    loadOverviewDashboard({ force: true });
  }, [overviewStartDate, overviewEndDate, trialResetReady, activeNav, loadOverviewDashboard]);

  const lastSavedReportTemplates = useRef<string>("");
  const lastSavedCommunicationProfiles = useRef<string>("");
  const lastSavedCommunicationAutomations = useRef<string>("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!trialResetReady) return;
    const serialized = JSON.stringify(reportTemplates);
    if (lastSavedReportTemplates.current !== serialized) {
      lastSavedReportTemplates.current = serialized;
      window.localStorage.setItem(REPORT_TEMPLATES_STORAGE_KEY, serialized);
    }
  }, [reportTemplates, trialResetReady]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!trialResetReady) return;
    const serialized = JSON.stringify(communicationProfiles);
    if (lastSavedCommunicationProfiles.current !== serialized) {
      lastSavedCommunicationProfiles.current = serialized;
      window.localStorage.setItem(COMMUNICATION_PROFILES_STORAGE_KEY, serialized);
    }
  }, [communicationProfiles, trialResetReady]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!trialResetReady) return;
    const serialized = JSON.stringify(communicationAutomations);
    if (lastSavedCommunicationAutomations.current !== serialized) {
      lastSavedCommunicationAutomations.current = serialized;
      window.localStorage.setItem(COMMUNICATION_AUTOMATIONS_STORAGE_KEY, serialized);
    }
  }, [communicationAutomations, trialResetReady]);

  const exportEmployeeUpdateLogWorkbook = async (log: EmployeeUpdateUploadLog) => {
    const xlsx = await loadXlsxRuntime();
    const workbook = xlsx.utils.book_new();
    const items = log.items || [];
    const allMatched = items.filter((item) => item.change_type !== "unmatched");
    const updated = items.filter((item) => item.change_type === "updated");
    const inactive = items.filter((item) => item.change_type === "inactive");
    const unchanged = items.filter((item) => item.change_type === "unchanged");
    const unmatched = items.filter((item) => item.change_type === "unmatched");

    const toSheetRows = (rows: EmployeeUpdateReportItem[]) =>
      rows.map((item) => ({
        "Employee Code": item.employee_code,
        Employee: item.employee_name,
        Result:
          item.change_type === "inactive"
            ? "Updated and inactive"
            : item.change_type.charAt(0).toUpperCase() + item.change_type.slice(1),
        "Updated Fields": item.changed_fields.join(", "),
      }));

    const summaryRows = [
      { Metric: "File name", Value: log.file_name },
      { Metric: "Created at", Value: new Date(log.created_at).toLocaleString("en-ZA") },
      { Metric: "Matched existing profiles", Value: log.matched_profiles },
      { Metric: "Updated profiles", Value: log.updated_profiles },
      { Metric: "Inactive from termination data", Value: log.inactive_profiles },
      { Metric: "Unchanged profiles", Value: log.unchanged_profiles },
      { Metric: "Unmatched rows", Value: log.unmatched_rows },
      { Metric: "Remote message", Value: log.remote_message || "" },
    ];

    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(summaryRows), "Summary");
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(toSheetRows(allMatched)), "Matched");
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(toSheetRows(updated)), "Updated");
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(toSheetRows(inactive)), "Inactive");
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(toSheetRows(unchanged)), "Unchanged");
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(toSheetRows(unmatched)), "Unmatched");

    const safeDate = log.created_at.slice(0, 10);
    const safeName = log.file_name.replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
    xlsx.writeFile(workbook, `${safeName || "employee-update"}-${safeDate}.xlsx`);
  };

  const [payrollUploadProgress, setPayrollUploadProgress] = useState(0);
  const [payrollUploadStage, setPayrollUploadStage] = useState("");
  const [isUploadingPayroll, setIsUploadingPayroll] = useState(false);

  const handleEmployeeUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      alert("No file selected");
      return;
    }

    setIsUploadingPayroll(true);
    setPayrollUploadProgress(0);
    setPayrollUploadStage("Reading workbook...");
    setSaveMessage("Importing payroll workbook...");

    try {
      const buffer = await file.arrayBuffer();
      setPayrollUploadProgress(10);
      
      setPayrollUploadStage("Parsing spreadsheet...");
      const xlsx = await loadXlsxRuntime();
      const workbook = xlsx.read(buffer, { type: "array" });
      
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
      
      const headerRowIndex = findEmployeeHeaderRow(rawRows);
      
      if (headerRowIndex < 0) {
        const msg = "Could not find header row. Need columns: Employee #, First Name, Last Name";
        setSaveMessage(msg);
        setPayrollUploadProgress(0);
        setIsUploadingPayroll(false);
        return;
      }

      setPayrollUploadProgress(20);
      setPayrollUploadStage("Extracting employee data...");
      const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: "",
        range: headerRowIndex,
      });

      if (rows.length === 0) {
        const msg = "No data rows found in spreadsheet";
        setSaveMessage(msg);
        setPayrollUploadProgress(0);
        setIsUploadingPayroll(false);
        return;
      }

      setPayrollUploadProgress(40);
      setPayrollUploadStage(`Processing ${rows.length} rows...`);
      
      const newEmployees: EmployeeInput[] = rows
        .map((row) => {
          const entries = buildNormalizedSheetEntries(row);

          const code = String(
            entries.employee_number || 
            entries.employee_code || 
            entries.code || 
            entries.id || 
            entries.employee ||
            entries.employee_num ||
            entries.emp_num ||
            ""
          );
          const firstName = String(
            entries.first_name || 
            entries.firstname || 
            entries.first || 
            entries.given_name || 
            ""
          );
          const lastName = String(
            entries.last_name || 
            entries.lastname || 
            entries.last || 
            entries.surname || 
            entries.family_name || 
            ""
          );

          if (!code || !firstName || !lastName) return null;

          const storeAssignment = parseStoreAssignment(entries);
          const region = String(entries.region || storeAssignment.derivedRegion || parseRegionFromDepartment(String(entries.department || "")) || "");
          const normalizedStatus = normalizeEmployeeStatusValue(entries.status);

          return {
            employee_code: code,
            first_name: firstName,
            last_name: lastName,
            title: String(entries.title || ""),
            alias: String(entries.alias || ""),
            id_number: String(entries.national_id || entries.id_number || ""),
            email: String(entries.email || ""),
            phone: String(entries.phone || entries.telephone || entries.mobile || ""),
            job_title: String(entries.job_title || entries.jobtitle || entries.position || entries.job_title || ""),
            department: String(entries.department || entries.dept || ""),
            region,
            store: storeAssignment.store,
            store_code: String(entries.store_code || entries.storecode || storeAssignment.storeCode || ""),
            hire_date: parseEmployeeDate(entries.hire_date || entries.hiredate || entries.start_date),
            person_type: String(entries.person_type || ""),
            fingerprints_enrolled: parseEmployeeNumber(entries.fingerprints_enrolled),
            company: String(entries.company || ""),
            branch: String(entries.branch || ""),
            business_unit: String(entries.business_unit || ""),
            cost_center: String(entries.cost_center || ""),
            team: String(entries.team || ""),
            ta_integration_id_1: String(entries.t_and_a_intergration_id_number_1 || entries.t_and_a_integration_id_number_1 || entries.ta_integration_id_1 || ""),
            ta_integration_id_2: String(entries.t_and_a_intergration_id_number_2 || entries.t_and_a_integration_id_number_2 || entries.ta_integration_id_2 || ""),
            access_profile: String(entries.access || entries.access_profile || ""),
            ta_enabled: parseEmployeeBoolean(entries.t_and_a),
            permanent: parseEmployeeBoolean(entries.permanent),
            active: parseEmployeeBoolean(entries.active) ?? normalizedStatus === "active",
            status: normalizedStatus,
          } as EmployeeInput;
        })
        .filter(Boolean) as EmployeeInput[];

      if (newEmployees.length === 0) {
        const msg = "No valid employees found. Check that rows have Employee #, First Name, and Last Name columns.";
        setSaveMessage(msg);
        setPayrollUploadProgress(0);
        setIsUploadingPayroll(false);
        return;
      }

      setPayrollUploadProgress(60);
      setPayrollUploadStage(`Importing ${newEmployees.length} employees to database...`);
      
      const result = await importEmployees(newEmployees);
      
      setPayrollUploadProgress(90);
      setPayrollUploadStage("Finalizing import...");
      if (result.success) {
        const msg = result.error 
          ? `Imported ${result.count} employee profiles from ${file.name}. ${result.error}` 
          : `Imported ${result.count} employee profiles from ${file.name}`;
        setSaveMessage(msg);
        await loadEmployees();
      } else {
        const msg = `Import error: ${result.error}`;
        setSaveMessage(msg);
      }
      setPayrollUploadProgress(100);
      setPayrollUploadStage("Complete!");
    } catch (err) {
      console.error("Employee upload error:", err);
      const msg = `Error: ${err instanceof Error ? err.message : "Unknown error"}`;
      setSaveMessage(msg);
      alert("FATAL ERROR: " + msg);
      setPayrollUploadProgress(0);
    } finally {
      setIsUploadingPayroll(false);
    }

    event.target.value = "";
  };

  const handleEmployeeUpdateUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUpdatingEmployeesFromStaffList(true);
    setStaffListUploadProgress(10);
    setStaffListUploadStage("Reading staff list workbook...");

    try {
      const buffer = await file.arrayBuffer();
      setStaffListUploadProgress(30);
      setStaffListUploadStage("Parsing employee rows and matching employee codes...");
      const xlsx = await loadXlsxRuntime();
      const workbook = xlsx.read(buffer, { type: "array", cellDates: true });
      const existingEmployees = await getEmployees();
      const parsed = parseStaffListEmployeeWorkbook(workbook, existingEmployees, xlsx);
      const analysis = analyzeStaffListChanges(parsed.employees, existingEmployees);

      if (parsed.employees.length === 0) {
        setSaveMessage("No valid employee updates were found in that staff list workbook.");
        setStaffListUploadProgress(100);
        setStaffListUploadStage("No valid employee updates were found.");
        return;
      }

      if (analysis.matchedProfiles === 0) {
        await saveEmployeeUpdateUploadLog({
          file_name: file.name,
          upload_type: "emergency_upload_update",
          matched_profiles: 0,
          updated_profiles: 0,
          inactive_profiles: 0,
          unchanged_profiles: 0,
          unmatched_rows: analysis.unmatchedRows,
          remote_message: "",
          items: [],
          rollback_employees: [],
        });
        setSaveMessage(`No matching employee codes were found in existing profiles for ${file.name}.`);
        setStaffListUploadProgress(100);
        setStaffListUploadStage("No matching employee codes were found in existing profiles.");
        return;
      }

      if (analysis.updatesToApply.length === 0) {
        await saveEmployeeUpdateUploadLog({
          file_name: file.name,
          upload_type: "emergency_upload_update",
          matched_profiles: analysis.matchedProfiles,
          updated_profiles: 0,
          inactive_profiles: 0,
          unchanged_profiles: analysis.unchangedProfiles,
          unmatched_rows: analysis.unmatchedRows,
          remote_message: "",
          items: [],
          rollback_employees: [],
        });
        setSaveMessage(`No employee profile changes were needed from ${file.name}.`);
        setStaffListUploadProgress(100);
        setStaffListUploadStage("No profile changes were needed.");
        return;
      }

      setStaffListUploadProgress(65);
      setStaffListUploadStage("Applying staff list updates to employee profiles...");
      const result = await importEmployees(analysis.updatesToApply);
      if (result.success) {
        await saveEmployeeUpdateUploadLog({
          file_name: file.name,
          upload_type: "emergency_upload_update",
          matched_profiles: analysis.matchedProfiles,
          updated_profiles: analysis.updatedProfiles,
          inactive_profiles: analysis.inactiveProfiles,
          unchanged_profiles: analysis.unchangedProfiles,
          unmatched_rows: analysis.unmatchedRows,
          remote_message: result.error || "",
          items: analysis.reportItems,
          rollback_employees: analysis.rollbackEmployees,
        });
        setStaffListUploadProgress(100);
        setStaffListUploadStage("Employee profiles updated successfully.");
        setSaveMessage(
          result.error
            ? `Updated ${analysis.updatedProfiles} matching employee profile${analysis.updatedProfiles === 1 ? "" : "s"} from ${file.name}. ${analysis.inactiveProfiles} profile${analysis.inactiveProfiles === 1 ? "" : "s"} were marked inactive from termination data. ${result.error}`
            : `Updated ${analysis.updatedProfiles} matching employee profile${analysis.updatedProfiles === 1 ? "" : "s"} from ${file.name}. ${analysis.inactiveProfiles} profile${analysis.inactiveProfiles === 1 ? "" : "s"} were marked inactive from termination data.`
        );
        await loadEmployees();
      } else {
        setStaffListUploadProgress(100);
        setStaffListUploadStage("Employee update import failed.");
        setSaveMessage(`Employee update import error: ${result.error}`);
      }
    } catch (err) {
      console.error("Employee staff list update error:", err);
      setStaffListUploadProgress(100);
      setStaffListUploadStage("Could not process the staff list workbook.");
      setSaveMessage("Error parsing the employee staff list workbook.");
    } finally {
      setIsUpdatingEmployeesFromStaffList(false);
    }

    event.target.value = "";
  };

  // ==================== ADMIN / IPULSE STATE ====================
  const [ipulseConfig, setIpulseConfig] = useState<IpulseConfig | null>(null);
  const [ipulseFormData, setIpulseFormData] = useState({
    api_url: "",
    api_key: "",
    api_secret: "",
    sync_interval_minutes: 60,
    auto_sync_enabled: false,
  });
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSavingIpulseConfig, setIsSavingIpulseConfig] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<{ success: boolean; error?: string; response_time?: number } | null>(null);
  const [activeAdminTab, setActiveAdminTab] = useState<"attendance" | "api" | "sync" | "logs" | "data">("attendance");

  // Load iPulse config
  const loadIpulseConfig = async () => {
    const config = await getConfig();
    setIpulseConfig(config);
    if (config) {
      setIpulseFormData({
        api_url: config.api_url || "",
        api_key: config.api_key || "",
        api_secret: config.api_secret || "",
        sync_interval_minutes: config.sync_interval_minutes || 60,
        auto_sync_enabled: config.auto_sync_enabled || false,
      });
    }
  };

  // Load sync logs
  const loadSyncLogs = async () => {
    const logs = await getSyncLogs(50);
    setSyncLogs(logs);
  };

  useEffect(() => {
    void loadIpulseConfig();
  }, []);

  // Initialize admin
  useEffect(() => {
    if (activeNav === "admin") {
      loadIpulseConfig();
      loadSyncLogs();
    }
  }, [activeNav]);

  useEffect(() => {
    const canAutoSync = Boolean(
      ipulseConfig?.auto_sync_enabled &&
      ipulseConfig?.sync_interval_minutes &&
      ipulseConfig.sync_interval_minutes > 0 &&
      ipulseConfig.api_url &&
      ipulseConfig.api_key
    );

    if (!canAutoSync) {
      stopAutoSync();
      return;
    }

    const intervalMinutes = ipulseConfig?.sync_interval_minutes || 60;

    startAutoSync(intervalMinutes, async () => {
      if (ipulseAutoSyncRunningRef.current) return;
      ipulseAutoSyncRunningRef.current = true;

      try {
        await syncFromIpulse("incremental");
        await loadIpulseConfig();
        if (activeNav === "admin") {
          await loadSyncLogs();
        }
      } finally {
        ipulseAutoSyncRunningRef.current = false;
      }
    });

    return () => {
      stopAutoSync();
    };
  }, [activeNav, ipulseConfig]);

  // Handle save config
  const handleSaveIpulseConfig = async () => {
    setIsSavingIpulseConfig(true);

    try {
      const result = await saveConfig(ipulseFormData);
      if (result.success) {
        setSaveMessage(
          result.error
            ? `iPulse API configuration saved successfully. ${result.error}`
            : "iPulse API configuration saved successfully"
        );
        await loadIpulseConfig();
      } else {
        setSaveMessage(`Error saving config: ${result.error}`);
      }
    } finally {
      setIsSavingIpulseConfig(false);
    }
  };

  // Handle test connection
  const handleTestConnection = async () => {
    setIsTestingConnection(true);
    setConnectionTestResult(null);
    const result = await testConnection(ipulseFormData);
    setConnectionTestResult(result);
    setIsTestingConnection(false);
  };

  // Handle manual sync
  const handleManualSync = async () => {
    if (!ipulseConfig?.api_url || !ipulseConfig?.api_key) {
      setSaveMessage("Save the iPulse API URL and API key in Admin before running manual sync.");
      return;
    }

    setIsSyncing(true);
    setSaveMessage("Starting sync with iPulse API...");

    const result = await syncFromIpulse();

    if (result.success) {
      setSaveMessage(`Sync completed: ${result.employees_synced} employees, ${result.attendance_synced} attendance records (${result.duration_seconds.toFixed(1)}s)`);
    } else {
      setSaveMessage(`Sync completed with errors: ${result.errors.join(", ")}`);
    }

    await loadSyncLogs();
    await loadIpulseConfig();
    setIsSyncing(false);
  };

  // Handle clear logs
  const handleClearLogs = async () => {
    if (confirm("Are you sure you want to clear all sync logs?")) {
      await clearSyncLogs();
      setSyncLogs([]);
      setSaveMessage("Sync logs cleared");
    }
  };

  const overviewStoreOptions = useMemo(() => {
    const values = new Map<
      string,
      {
        key: string;
        label: string;
        store: string;
        storeCode: string;
        region: string;
        employeeCount: number;
        employeeCodes: string[];
        attendanceCount: number;
      }
    >();

    overviewEmployeeProfiles.forEach((employee) => {
      if (!isOverviewEmployeeReportable(employee)) return;

      const store = String(employee.store || "").trim();
      const storeCode = String(employee.store_code || "").trim();
      if (!store && !storeCode) return;
      const region = resolveRegionForStore(store, storeCode, employee.region);

      const key = buildOverviewStoreKey(store, storeCode);
      const existing =
        values.get(key) ||
        {
          key,
          label: buildOverviewStoreLabel(store, storeCode),
          store,
          storeCode,
          region,
          employeeCount: 0,
          employeeCodes: [],
          attendanceCount: 0,
        };

      existing.employeeCount += 1;

      const normalizedEmployeeCode = normalizeEmployeeCode(employee.employee_code);
      if (normalizedEmployeeCode && !existing.employeeCodes.includes(normalizedEmployeeCode)) {
        existing.employeeCodes.push(normalizedEmployeeCode);
      }

      values.set(key, existing);
    });

    const employeeCodeToStoreKey = new Map<string, string>();
    values.forEach((option) => {
      option.employeeCodes.forEach((employeeCode) => {
        employeeCodeToStoreKey.set(normalizeEmployeeCode(employeeCode), option.key);
      });
    });

    overviewAttendanceRecords.forEach((record) => {
      const employeeCode = normalizeEmployeeCode(record.employeeCode);
      const storeKey = employeeCodeToStoreKey.get(employeeCode);
      if (!storeKey) return;
      const existing = values.get(storeKey);
      if (existing) {
        existing.attendanceCount += 1;
      }
    });

    return Array.from(values.values())
      .map((option) => ({
        ...option,
        employeeCodes: [...option.employeeCodes].sort((a, b) => a.localeCompare(b)),
      }))
      .sort((a, b) => b.employeeCount - a.employeeCount || a.label.localeCompare(b.label));
  }, [overviewAttendanceRecords, overviewEmployeeProfiles]);

  const overviewRegionOptions = useMemo(() => {
    const regions = new Set<string>();
    overviewStoreOptions.forEach((option) => {
      if (option.region && option.region !== "UNASSIGNED") regions.add(option.region);
    });
    if (regions.size === 0) return ["all"];
    return ["all", ...Array.from(regions).sort((a, b) => a.localeCompare(b))];
  }, [overviewStoreOptions]);

  const selectedOverviewStoreOption = useMemo(
    () => overviewStoreOptions.find((option) => option.key === selectedOverviewStoreKey) || null,
    [overviewStoreOptions, selectedOverviewStoreKey]
  );

  const selectedOverviewStoreEmployeeCodes = useMemo(
    () =>
      new Set(
        (selectedOverviewStoreOption?.employeeCodes || [])
          .map((employeeCode) => normalizeEmployeeCode(employeeCode))
          .filter(Boolean)
      ),
    [selectedOverviewStoreOption]
  );

  const overviewEmployeeRegionByCode = useMemo(() => {
    const map = new Map<string, string>();
    overviewEmployeeProfiles.forEach((employee) => {
      const code = normalizeEmployeeCode(employee.employee_code);
      if (!code) return;
      map.set(code, resolveRegionForStore(employee.store, employee.store_code, employee.region));
    });
    return map;
  }, [overviewEmployeeProfiles]);

  const filteredOverviewStoreOptions = useMemo(() => {
    const query = normalizeOverviewCompare(overviewStoreSearch);
    if (!query) return [];
    return overviewStoreOptions
      .filter((option) => selectedOverviewRegion === "all" || option.region === selectedOverviewRegion)
      .filter((option) => normalizeOverviewCompare(`${option.label} ${option.store} ${option.storeCode} ${option.region}`).includes(query))
      .slice(0, 10);
  }, [overviewStoreOptions, overviewStoreSearch, selectedOverviewRegion]);

  // Toggle store expansion
  const toggleStore = (storeName: string) => {
    setExpandedStores(prev => {
      const next = new Set(prev);
      if (next.has(storeName)) next.delete(storeName);
      else next.add(storeName);
      return next;
    });
  };

  const filteredOverviewAttendanceRecords = useMemo(() => {
    const regionFiltered =
      selectedOverviewRegion === "all"
        ? overviewAttendanceRecords
        : overviewAttendanceRecords.filter((record) => {
            const employeeRegion = overviewEmployeeRegionByCode.get(normalizeEmployeeCode(record.employeeCode));
            return employeeRegion === selectedOverviewRegion;
          });

    if (selectedOverviewStoreKey === "all") return regionFiltered;
    return regionFiltered.filter((record) =>
      selectedOverviewStoreEmployeeCodes.has(normalizeEmployeeCode(record.employeeCode))
    );
  }, [overviewAttendanceRecords, overviewEmployeeRegionByCode, selectedOverviewRegion, selectedOverviewStoreEmployeeCodes, selectedOverviewStoreKey]);

  const filteredOverviewEmployeeProfiles = useMemo(() => {
    const regionFiltered =
      selectedOverviewRegion === "all"
        ? overviewEmployeeProfiles
        : overviewEmployeeProfiles.filter(
            (employee) => resolveRegionForStore(employee.store, employee.store_code, employee.region) === selectedOverviewRegion
          );

    if (selectedOverviewStoreKey === "all") return regionFiltered;
    return regionFiltered.filter((employee) =>
      selectedOverviewStoreEmployeeCodes.has(normalizeEmployeeCode(employee.employee_code))
    );
  }, [overviewEmployeeProfiles, selectedOverviewRegion, selectedOverviewStoreEmployeeCodes, selectedOverviewStoreKey]);

  useEffect(() => {
    if (
      selectedOverviewStoreKey !== "all" &&
      !overviewStoreOptions.some(
        (option) =>
          option.key === selectedOverviewStoreKey &&
          (selectedOverviewRegion === "all" || option.region === selectedOverviewRegion)
      )
    ) {
      setSelectedOverviewStoreKey("all");
      setOverviewStoreSearch("");
      setSelectedSlice(null);
      setExpandedStores(new Set());
      setExpandedRegions(new Set());
    }
  }, [overviewStoreOptions, selectedOverviewRegion, selectedOverviewStoreKey]);

  // Region-based table data for table view
  const regionTableData = useMemo(() => {
    const regionMap = new Map<string, {
      region: string;
      profileCount: number;
      total: number;
      atWork: number;
      awol: number;
      leave: number;
      dayOff: number;
      unscheduled: number;
      stores: Map<string, {
        store: string;
        profileCount: number;
        total: number;
        atWork: number;
        awol: number;
        leave: number;
        dayOff: number;
        unscheduled: number;
      }>;
    }>();

    filteredOverviewAttendanceRecords.forEach(record => {
      if (!regionMap.has(record.region)) {
        regionMap.set(record.region, {
          region: record.region,
          profileCount: 0,
          total: 0,
          atWork: 0,
          awol: 0,
          leave: 0,
          dayOff: 0,
          unscheduled: 0,
          stores: new Map(),
        });
      }
      
      const regionData = regionMap.get(record.region)!;
      regionData.total++;
      
      if (record.atWork) regionData.atWork++;
      else if (record.problem) regionData.awol++;
      else if (record.leave) regionData.leave++;
      else if (record.dayOff) regionData.dayOff++;
      else regionData.unscheduled++;

      if (!regionData.stores.has(record.store)) {
        regionData.stores.set(record.store, {
          store: record.store,
          profileCount: 0,
          total: 0,
          atWork: 0,
          awol: 0,
          leave: 0,
          dayOff: 0,
          unscheduled: 0,
        });
      }
      
      const storeData = regionData.stores.get(record.store)!;
      storeData.total++;
      if (record.atWork) storeData.atWork++;
      else if (record.problem) storeData.awol++;
      else if (record.leave) storeData.leave++;
      else if (record.dayOff) storeData.dayOff++;
      else storeData.unscheduled++;
    });

    overviewEmployeeProfiles.forEach((employee) => {
      const regionName = employee.region || "Unassigned Region";
      const storeName = employee.store || employee.branch || "Unassigned Store";

      if (!regionMap.has(regionName)) {
        regionMap.set(regionName, {
          region: regionName,
          profileCount: 0,
          total: 0,
          atWork: 0,
          awol: 0,
          leave: 0,
          dayOff: 0,
          unscheduled: 0,
          stores: new Map(),
        });
      }

      const regionData = regionMap.get(regionName)!;
      regionData.profileCount++;

      if (!regionData.stores.has(storeName)) {
        regionData.stores.set(storeName, {
          store: storeName,
          profileCount: 0,
          total: 0,
          atWork: 0,
          awol: 0,
          leave: 0,
          dayOff: 0,
          unscheduled: 0,
        });
      }

      regionData.stores.get(storeName)!.profileCount++;
    });

    return Array.from(regionMap.values()).map(r => ({
      ...r,
      stores: Array.from(r.stores.values()).sort((a, b) => b.profileCount - a.profileCount || b.total - a.total),
    })).sort((a, b) => b.profileCount - a.profileCount || b.total - a.total);
  }, [filteredOverviewAttendanceRecords, filteredOverviewEmployeeProfiles]);

  // Toggle region expansion in table view
  const toggleRegion = (regionName: string) => {
    setExpandedRegions(prev => {
      const next = new Set(prev);
      if (next.has(regionName)) next.delete(regionName);
      else next.add(regionName);
      return next;
    });
  };

  // Store breakdown by status with employee details
  const storeBreakdown = useMemo(() => {
    if (!selectedSlice) return [];
    
    const storeData = new Map<string, { count: number; employees: AttendanceRecord[] }>();
    
    for (let i = 0; i < filteredOverviewAttendanceRecords.length; i++) {
      const record = filteredOverviewAttendanceRecords[i];
      let isMatch = false;
      switch (selectedSlice) {
        case "atWork":
          isMatch = record.atWork;
          break;
        case "awol":
          isMatch = record.problem;
          break;
        case "leave":
          isMatch = record.leave;
          break;
        case "dayOff":
          isMatch = record.dayOff;
          break;
        case "other":
          isMatch = !record.atWork && !record.problem && !record.leave && !record.dayOff && record.scheduled;
          break;
      }
      if (isMatch) {
        const existing = storeData.get(record.store);
        if (existing) {
          existing.count++;
          existing.employees.push(record);
        } else {
          storeData.set(record.store, { count: 1, employees: [record] });
        }
      }
    }
    
    const entries = Array.from(storeData.entries());
    entries.sort((a, b) => b[1].count - a[1].count);
    return entries.map(([store, data]) => ({ store, count: data.count, employees: data.employees }));
  }, [selectedSlice, filteredOverviewAttendanceRecords]);

  const storeDeviceTypeLookup = useMemo(() => {
    const lookup = new Map<string, "physical" | "logical">();
    deviceRecords.forEach((device) => {
      const key = normalizeStoreLookupKey(device.store);
      if (!key) return;
      const current = lookup.get(key);
      if (device.deviceType === "physical" || !current) {
        lookup.set(key, device.deviceType);
      }
    });
    return lookup;
  }, [deviceRecords]);

  const getStoreDeviceType = useCallback((store: string) => {
    const type = storeDeviceTypeLookup.get(normalizeStoreLookupKey(store));
    return type || "logical";
  }, [storeDeviceTypeLookup]);

  // Export store breakdown as PDF
  const exportStoreBreakdownPDF = async () => {
    if (!selectedSlice || filteredStoreBreakdown.length === 0) return;

    const { jsPDF, autoTable } = await loadPdfRuntime();
    const statusName = ATTENDANCE_STATUS_CONFIG.find(c => c.key === selectedSlice)?.name || "Store Breakdown";
    const filterText = percentageFilter > 0 ? ` (${percentageFilter}%+ threshold)` : "";
    const doc = new jsPDF();
    
    // Header
    doc.setFontSize(18);
    doc.setTextColor(30, 41, 59);
    doc.text(`${statusName} by Store${filterText}`, 14, 20);
    
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text(`Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}`, 14, 28);
    doc.text(`Total: ${filteredStoreBreakdown.length} stores`, 14, 34);
    
    // Table
    const tableData = filteredStoreBreakdown.map((item, index) => [
      index + 1,
      item.store,
      getStoreDeviceType(item.store) === "physical" ? "Physical" : "Logical",
      item.count,
      `${Math.round((item.count / storeBreakdown[0].count) * 100)}%`
    ]);
    
    autoTable(doc, {
      startY: 40,
      head: [['#', 'Store Name', 'Type', 'Count', 'Percentage']],
      body: tableData,
      headStyles: { 
        fillColor: [30, 41, 59],
        textColor: [255, 255, 255],
        fontStyle: 'bold'
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      styles: { fontSize: 10 },
      columnStyles: {
        0: { cellWidth: 15, halign: 'center' },
        1: { cellWidth: 78 },
        2: { cellWidth: 28, halign: 'center' },
        3: { cellWidth: 28, halign: 'center' },
        4: { cellWidth: 28, halign: 'right' }
      }
    });
    
    // Footer
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(`Page ${i} of ${pageCount}`, doc.internal.pageSize.width / 2, doc.internal.pageSize.height - 10, { align: 'center' });
    }
    
    const filename = `${statusName.toLowerCase().replace(/\s+/g, '-')}-by-store${percentageFilter > 0 ? `-${percentageFilter}plus` : ''}.pdf`;
    doc.save(filename);
  };

  // Filtered store breakdown based on percentage threshold
  const filteredStoreBreakdown = useMemo(() => {
    if (!selectedSlice || storeBreakdown.length === 0) return [];
    
    return storeBreakdown.filter(item => {
      const percentage = Math.round((item.count / storeBreakdown[0].count) * 100);
      return percentage >= percentageFilter;
    });
  }, [storeBreakdown, percentageFilter, selectedSlice]);

  const regionOptions = useMemo(() => {
    const regions = new Set(attendanceRecords.map(r => r.region));
    return ["all", ...Array.from(regions).sort()];
  }, [attendanceRecords]);

  const storeOptions = useMemo(() => {
    const stores = new Set(attendanceRecords.map(r => r.store));
    return ["all", ...Array.from(stores).sort()];
  }, [attendanceRecords]);

  const filteredRecords = useMemo(() => {
    return attendanceRecords.filter(record => {
      const matchesSearch = !searchTerm || 
        record.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        record.employeeCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
        record.store.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesRegion = selectedRegion === "all" || record.region === selectedRegion;
      const matchesStore = selectedStore === "all" || record.store === selectedStore;
      return matchesSearch && matchesRegion && matchesStore;
    });
  }, [attendanceRecords, searchTerm, selectedRegion, selectedStore]);

  const deviceStats = useMemo(() => {
    const physicalStores = new Set(
      deviceRecords
        .filter((d) => d.deviceType === "physical")
        .map((d) => normalizeStoreLookupKey(d.store))
        .filter(Boolean)
    ).size;
    return {
      total: deviceRecords.length,
      online: deviceRecords.filter(d => d.status === "online").length,
      offline: deviceRecords.filter(d => d.status === "offline").length,
      warning: deviceRecords.filter(d => d.status === "warning").length,
      physicalStores,
    };
  }, [deviceRecords]);

  // Get all unique stores from devices
  const deviceStoresMap = useMemo(() => {
    const map = new Map<string, DeviceRecord[]>();
    deviceRecords.forEach(device => {
      if (device.store) {
        const existing = map.get(device.store) || [];
        existing.push(device);
        map.set(device.store, existing);
      }
    });
    return map;
  }, [deviceRecords]);

  const reportDateRangeLabel = useMemo(() => {
    if (availableDates.length > 1) {
      const sorted = [...availableDates].sort();
      return `${sorted[0]} to ${sorted[sorted.length - 1]}`;
    }
    if (attendanceImportDate) return attendanceImportDate;
    return "Current loaded data";
  }, [attendanceImportDate, availableDates]);

  // Overview stats for display
  const overviewStats = useMemo(() => {
    let atWork = 0, awol = 0, leave = 0, dayOff = 0, scheduled = 0, total = 0;
    for (let i = 0; i < filteredOverviewAttendanceRecords.length; i++) {
      const r = filteredOverviewAttendanceRecords[i];
      total++;
      if (r.atWork) atWork++;
      else if (r.problem) awol++;
      else if (r.leave) leave++;
      else if (r.dayOff) dayOff++;
      if (r.scheduled) scheduled++;
    }
    return { total, atWork, awol, scheduled, leave, dayOff, other: total - atWork - awol - leave - dayOff };
  }, [filteredOverviewAttendanceRecords]);

  const attendanceTrendSeries = useMemo(() => {
    if (selectedOverviewStoreKey === "all") return overviewTrendSeries;
    const cache = overviewDataCacheRef.current;
    if (!cache || selectedOverviewStoreEmployeeCodes.size === 0) return [];

    const selectedEmployees = cache.employees.filter((employee) =>
      selectedOverviewStoreEmployeeCodes.has(normalizeEmployeeCode(employee.employee_code))
    );

    const filteredRangeAttendance = cache.rangeAttendance
      .map(mapDatabaseAttendanceRecord)
      .filter((record) => selectedOverviewStoreEmployeeCodes.has(normalizeEmployeeCode(record.employeeCode)));

    const filteredRangeClockEvents = cache.rangeClockEvents.filter((event) =>
      selectedOverviewStoreEmployeeCodes.has(normalizeEmployeeCode(event.employee_code))
    );

    const filteredLeaveApplications = cache.leaveApplicationsForRange.filter((application) =>
      selectedOverviewStoreEmployeeCodes.has(normalizeEmployeeCode(application.matched_employee_code))
    );

    return buildOverviewTrendSeriesFromSources({
      startDateValue: overviewStartDate,
      endDateValue: overviewEndDate,
      existingRecords: filteredRangeAttendance,
      employeeProfiles: selectedEmployees,
      shiftRosters: cache.shiftRosters,
      clockEvents: filteredRangeClockEvents,
      leaveApplications: filteredLeaveApplications,
    });
  }, [overviewTrendSeries, overviewStartDate, overviewEndDate, selectedOverviewStoreEmployeeCodes, selectedOverviewStoreKey]);
  
  const companyOverviewData = useMemo(
    () => buildCompanyOverviewDataFromRecords(filteredOverviewAttendanceRecords),
    [filteredOverviewAttendanceRecords]
  );

  const trendMetricConfig = useMemo(
    () => ALL_TREND_METRICS.filter((metric) => selectedTrendKeys.includes(metric.key)),
    [selectedTrendKeys]
  );

  const overviewModuleCards = useMemo(
    () => [
      {
        title: "Employees",
        value: `${overviewModuleSnapshot.employeeProfiles}`,
        detail: `${overviewModuleSnapshot.activeEmployees} active • ${overviewModuleSnapshot.inactiveEmployees + overviewModuleSnapshot.terminatedEmployees} inactive / terminated`,
      },
      {
        title: "Clock Coverage",
        value: `${clockOverview.totalEvents}`,
        detail: `${clockOverview.employeesWithClocks} employee profiles linked to clock history`,
      },
      {
        title: "Shift Rosters",
        value: `${overviewModuleSnapshot.shiftRosters}`,
        detail: `${overviewModuleSnapshot.shiftRows} roster rows • ${overviewModuleSnapshot.enabledShiftSyncs} sync timer${overviewModuleSnapshot.enabledShiftSyncs === 1 ? "" : "s"} enabled`,
      },
      {
        title: "Leave",
        value: `${overviewModuleSnapshot.leaveRowsForDate}`,
        detail: `${overviewModuleSnapshot.appliedLeaveForDate} applied • ${overviewModuleSnapshot.unmatchedLeaveForDate} unmatched on ${selectedOverviewDate || "selected date"}`,
      },
      {
        title: "Calendar",
        value: `${overviewModuleSnapshot.calendarEventsThisMonth}`,
        detail: `${overviewModuleSnapshot.customCalendarEvents} custom event${overviewModuleSnapshot.customCalendarEvents === 1 ? "" : "s"} saved this year`,
      },
      {
        title: "iPulse Sync",
        value: overviewModuleSnapshot.ipulseLastSyncStatus
          ? overviewModuleSnapshot.ipulseLastSyncStatus.charAt(0).toUpperCase() + overviewModuleSnapshot.ipulseLastSyncStatus.slice(1)
          : "Not run",
        detail: overviewModuleSnapshot.ipulseAutoSyncEnabled
          ? `Auto sync on • ${overviewModuleSnapshot.syncErrorsOpen} recent warning / error log${overviewModuleSnapshot.syncErrorsOpen === 1 ? "" : "s"}${overviewModuleSnapshot.ipulseLastSyncAt ? ` • last run ${new Date(overviewModuleSnapshot.ipulseLastSyncAt).toLocaleString("en-ZA")}` : ""}`
          : overviewModuleSnapshot.ipulseLastSyncAt
            ? `Auto sync off • last run ${new Date(overviewModuleSnapshot.ipulseLastSyncAt).toLocaleString("en-ZA")}`
            : "Auto sync off",
      },
    ],
    [clockOverview, overviewModuleSnapshot, selectedOverviewDate]
  );

  const parseAttendanceWorkbook = (workbook: WorkBook, xlsx: XlsxRuntime): AttendanceRecord[] => {
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return [];
    const sheet = workbook.Sheets[firstSheetName];
    
    // Get raw data to preserve column order
    const rows: Record<string, unknown>[] = [];
    
    // Convert to array of arrays first
    const sheetData = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
    
    // Track current region from Regional rows
    let currentRegion = "";
    let currentStore = "";
    
    for (let rowIdx = 0; rowIdx < sheetData.length; rowIdx++) {
      const row = sheetData[rowIdx] as unknown[];
      if (!row || row.length === 0) continue;
      
      // Column indices (0-based)
      // A(0): Regional indicator or data, B(1): Branch, C(2): Store, E(4): Employee
      // H(7): Scheduled, I(8): Leave, J(9): Day Off, K(10): At Work, L(11): Problem
      
      const colA = String(row[0] || "").trim();
      const colC = String(row[2] || "").trim();
      const colE = String(row[4] || "").trim();
      
      // Check if this is a Regional header row like "Regional : PRETORIA"
      if (colA.toLowerCase().startsWith("regional :")) {
        currentRegion = colA.replace(/regional\s*:\s*/i, "").trim().toUpperCase();
        currentStore = colC;
        continue;
      }
      
      // Check if this is a store header row (has store info but no employee)
      if (colC && !colE) {
        currentStore = colC;
        continue;
      }
      
      // Skip if no employee data
      if (!colE || colE.toLowerCase() === "total" || colE.toLowerCase().includes("total")) {
        continue;
      }
      
      // Skip header row (check if colE looks like "Employee" or "Employee Name")
      if (colE.toLowerCase().startsWith("employee")) {
        continue;
      }
      
      // Parse employee: "A2333 - GAOPALELWE BOIYANE"
      const employeeParts = colE.match(/^([A-Z0-9]+)\s*-\s*(.+)$/i);
      if (!employeeParts) continue;
      
      const employeeCode = employeeParts[1];
      const employeeName = employeeParts[2].trim();
      
      // Parse attendance flags (columns H-L, indices 7-11)
      const scheduled = Number(row[7]) === 1;
      const leave = Number(row[8]) === 1;
      const dayOff = Number(row[9]) === 1;
      const atWork = Number(row[10]) === 1;
      const problem = Number(row[11]) === 1;
      const clockings = extractClockingsFromRow(row).map(normalizeClockValue).filter(Boolean);
      const derivedClockStatus = deriveClockStatus({ leave, dayOff, clockings });
      
      // Parse store info from currentStore
      const { region, regionCode, store, storeCode } = parseRegionStore(currentStore);
      
      // Use currentRegion if parse didn't find one, or if it's just the store name
      const parsedRegion = currentRegion && currentRegion !== "UNKNOWN REGION" ? currentRegion : region;
      const mappedRegion = resolveRegionForStore(store || currentStore, storeCode, parsedRegion);

      rows.push({
        id: employeeCode,
        employeeCode: employeeCode,
        name: employeeName,
        region: mappedRegion,
        regionCode: regionCode,
        store: store || currentStore,
        storeCode: storeCode,
        scheduled,
        atWork,
        leave,
        dayOff,
        problem,
        clockCount: derivedClockStatus.clockCount,
        firstClock: derivedClockStatus.firstClock,
        lastClock: derivedClockStatus.lastClock,
        clockings,
        reportStatus: derivedClockStatus.status,
      });
    }
    
    return rows as AttendanceRecord[];
  };

  const parseDeviceWorkbook = (workbook: WorkBook, xlsx: XlsxRuntime): DeviceRecord[] => {
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return [];
    const sheet = workbook.Sheets[firstSheetName];
    const rawRows = xlsx.utils.sheet_to_json<unknown[]>(sheet, { defval: "", header: 1 });
    const rows = rawRows as unknown[][];

    const headerRowIndex = rows.findIndex((row) => {
      const normalized = row.map((cell) => normalizeOverviewCompare(cell));
      return normalized.some((cell) => cell.includes("device name") || cell === "device" || cell === "device_name");
    });
    if (headerRowIndex === -1) return [];
    const headers = rows[headerRowIndex] || [];
    const dataRows = rows.slice(headerRowIndex + 1);

    // Find column indices helper
    const findColumn = (names: string[]): number => {
      for (const name of names) {
        const idx = headers.findIndex(h => String(h || "").toLowerCase().trim().includes(name.toLowerCase()));
        if (idx !== -1) return idx;
      }
      return -1;
    };

    const deviceNameIdx = findColumn(["device name", "device", "name", "device_name"]);
    const displayNameIdx = findColumn(["display name", "display_name"]);
    const descriptionIdx = findColumn(["description"]);
    const storeIdx = findColumn(["store", "store name", "store_name"]);
    const regionIdx = findColumn(["region", "territory"]);
    const deviceTypeIdx = findColumn(["device type", "type"]);
    const statusIdx = findColumn(["status", "device status", "device_status"]);
    const connectedIdx = findColumn(["connected", "connection"]);
    const lastSeenIdx = findColumn(["last seen", "last_seen", "lastseen", "last activity"]);

    return dataRows
      .map((row) => {
        if (deviceNameIdx === -1) return null;

        const deviceName = String(
          row[deviceNameIdx] ||
          row[displayNameIdx] ||
          row[descriptionIdx] ||
          ""
        ).trim();
        if (!deviceName) return null;

        const storeSource = String(row[storeIdx] || deviceName).trim();
        const parsedStore = parseRegionStore(storeSource);
        const storeGroup = getStoreGrouping(
          parsedStore.store && parsedStore.store !== "Unknown Store" ? parsedStore.store : storeSource,
          parsedStore.storeCode,
          String(row[regionIdx] || parsedStore.region || "")
        );
        const store = (
          storeGroup.store
        )
          .replace(/\s*\(\d+\)\s*$/, "")
          .trim() || "Unassigned Store";
        const region = storeGroup.region || "UNASSIGNED";
        const deviceType = normalizeDeviceType(row[deviceTypeIdx]);

        let status: "online" | "offline" | "warning" = "online";
        if (connectedIdx !== -1) {
          const connectedVal = normalizeOverviewCompare(row[connectedIdx]);
          if (connectedVal.includes("offline") || connectedVal === "n/a" || connectedVal === "na") {
            status = "offline";
          } else if (connectedVal.includes("online")) {
            status = "online";
          }
        }
        if (statusIdx !== -1) {
          const statusVal = normalizeOverviewCompare(row[statusIdx]);
          if (
            statusVal.includes("offline") ||
            statusVal.includes("inactive") ||
            statusVal === "0" ||
            statusVal === "false"
          ) {
            status = "offline";
          } else if (statusVal.includes("warning") || statusVal === "warning") {
            status = "warning";
          } else if (statusVal.includes("active")) {
            status = "online";
          }
        }

        let lastSeen = "";
        let lastSeenDate = "";
        if (lastSeenIdx !== -1) {
          const dateVal = row[lastSeenIdx];
          if (dateVal) {
            lastSeen = String(dateVal);
            const parsed = new Date(String(dateVal));
            if (!isNaN(parsed.getTime())) {
              lastSeenDate = parsed.toISOString().split('T')[0];
              const hoursDiff = (Date.now() - parsed.getTime()) / (1000 * 60 * 60);
              if (hoursDiff > 24) {
                status = "offline";
              } else if (hoursDiff > 12) {
                status = "warning";
              }
            }
          }
        }

        const normalizedName = deviceName.toLowerCase().trim().replace(/\s+/g, '-');

        return {
          id: `DEV-${normalizedName}`,
          name: deviceName,
          deviceName: deviceName,
          region,
          store,
          deviceType,
          status,
          lastSeen: lastSeen || new Date().toISOString(),
          lastSeenDate,
        } satisfies DeviceRecord;
      })
      .filter(Boolean) as DeviceRecord[];
  };

  const handleAttendanceUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      // Get today's date for categorizing the upload
      const uploadDate = new Date().toISOString().split('T')[0];
      
      // Upload to cloud storage
      const uploadResult = await uploadAttendanceFile(file);
      if (uploadResult.success) {
        setSaveMessage(`File uploaded to cloud: ${uploadResult.url}`);
      }

      const buffer = await file.arrayBuffer();
      const xlsx = await loadXlsxRuntime();
      const workbook = xlsx.read(buffer, { type: "array" });
      const parsed = parseAttendanceWorkbook(workbook, xlsx);

      if (!parsed.length) {
        setSaveMessage(`No attendance records found in ${file.name}`);
        return;
      }

      // Save to database
      const dbRecords = parsed.map(r => ({
        employee_code: r.employeeCode,
        name: r.name,
        region: r.region,
        region_code: r.regionCode,
        store: r.store,
        store_code: r.storeCode,
        scheduled: r.scheduled,
        at_work: r.atWork,
        leave: r.leave,
        day_off: r.dayOff,
        problem: r.problem,
        clock_count: r.clockCount,
        first_clock: r.firstClock,
        last_clock: r.lastClock,
        status_label: r.reportStatus,
        clockings: r.clockings,
        upload_date: uploadDate,
      }));

      const dbResult = await saveAttendanceRecords(dbRecords);
      
      if (dbResult.success) {
        setSaveMessage(`Saved ${parsed.length} attendance records for ${uploadDate} to database`);
      } else {
        // Database save failed, but we still have local data
        setSaveMessage(`Imported ${parsed.length} records locally (DB save: ${dbResult.error || 'skipped'})`);
      }

      setAttendanceRecords(parsed);
      setAttendanceImportDate(uploadDate);
      setSelectedOverviewDate(uploadDate);
      setSaveMessage(`Imported ${parsed.length} attendance records from ${file.name}`);
      
      // Refresh available dates
      const dates = await getAvailableDates();
      setAvailableDates(dates);
      
    } catch (error) {
      setSaveMessage(`Upload failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      event.target.value = "";
    }
  };

  const handleDeviceUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const xlsx = await loadXlsxRuntime();
      const workbook = xlsx.read(buffer, { type: "array" });
      const parsed = parseDeviceWorkbook(workbook, xlsx);

      if (!parsed.length) {
        setSaveMessage(`No device records found in ${file.name}`);
        return;
      }

      // Save to localStorage for persistence
      try {
        localStorage.setItem(DEVICES_STORAGE_KEY, JSON.stringify(parsed));
        localStorage.setItem(`${DEVICES_STORAGE_KEY}_date`, new Date().toISOString());
      } catch (e) {
        console.error("Failed to save devices to localStorage:", e);
      }

      setDeviceRecords(parsed);
      setDeviceImportDate(new Date().toLocaleDateString());
      setSaveMessage(`Replaced devices with ${parsed.length} records from ${file.name}`);
    } catch (error) {
      setSaveMessage(`Device upload failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      event.target.value = "";
    }
  };

  const handleClearDevices = () => {
    const shouldClear = window.confirm("Clear all imported device records?");
    if (!shouldClear) return;
    try {
      localStorage.removeItem(DEVICES_STORAGE_KEY);
      localStorage.removeItem(`${DEVICES_STORAGE_KEY}_date`);
    } catch {}
    setDeviceRecords([]);
    setDeviceImportDate("");
    setSaveMessage("Cleared all imported device records.");
  };

  const exportAttendance = () => {
    const csv = [
      ["ID", "Employee Code", "Name", "Region", "Store", "Scheduled", "At Work", "Leave", "Day Off", "Problem"],
      ...filteredRecords.map(r => [
        r.id, r.employeeCode, r.name, r.region, r.store,
        r.scheduled ? "1" : "0",
        r.atWork ? "1" : "0",
        r.leave ? "1" : "0",
        r.dayOff ? "1" : "0",
        r.problem ? "1" : "0",
      ])
    ].map(row => row.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "attendance-export.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleQuickRangeChange = (days: number) => {
    const range = getQuickRangeValues(days);
    setActiveRangeDays(days);
    setOverviewStartDate(range.startDate);
    setOverviewEndDate(range.endDate);
  };

  const handleTrendPresetChange = (value: string) => {
    const option = TREND_VIEW_OPTIONS.find((item) => item.value === value);
    setTrendView(value);
    setSelectedTrendKeys(option ? [...option.keys] : []);
  };

  const toggleTrendMetric = (key: string) => {
    setSelectedTrendKeys((current) => {
      if (current.includes(key)) {
        const next = current.filter((item) => item !== key);
        return next.length ? next : [key];
      }
      return [...current, key];
    });
  };

  // ==================== RENDER OVERVIEW ====================
  const renderOverview = () => (
    <div className="space-y-6">
      {/* Attendance Overview - Dark Futuristic Style */}
      <section className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6 md:p-8 border border-slate-700/50">
        {/* Background pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0" style={{ 
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)',
            backgroundSize: '40px 40px' 
          }} />
        </div>
        
        {/* Header */}
        <div className="relative mb-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl md:text-3xl font-bold text-white">Attendance Overview</h2>
              <p className="text-slate-400 text-sm mt-1">Live overview synced to attendance, employees, clocks, shifts, leave, calendar, and iPulse status</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => void loadOverviewDashboard({ force: true })}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isLoadingOverview}
              >
                <RefreshCw className={`h-4 w-4 ${isLoadingOverview ? "animate-spin" : ""}`} />
                Refresh
              </button>

              {/* Store Search / Filter */}
              <div className="relative min-w-[280px] flex-1 max-w-[420px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <Input
                  value={selectedOverviewStoreKey === "all" ? overviewStoreSearch : selectedOverviewStoreOption?.label || overviewStoreSearch}
                  onChange={(e) => {
                    if (selectedOverviewStoreKey !== "all") {
                      setSelectedOverviewStoreKey("all");
                    }
                    setOverviewStoreSearch(e.target.value);
                  }}
                  placeholder="Search store name or code..."
                  className="h-10 border-slate-600 bg-slate-800 pl-9 pr-10 text-white placeholder:text-slate-500"
                />
                {(selectedOverviewStoreKey !== "all" || overviewStoreSearch) && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedOverviewStoreKey("all");
                      setOverviewStoreSearch("");
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 transition hover:bg-slate-700 hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}

                {selectedOverviewStoreKey === "all" && overviewStoreSearch && (
                  <div className="absolute z-30 mt-2 max-h-72 w-full overflow-y-auto rounded-xl border border-slate-700 bg-slate-900/95 p-2 shadow-2xl backdrop-blur">
                    {filteredOverviewStoreOptions.length > 0 ? (
                      filteredOverviewStoreOptions.map((option) => (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => {
                            setSelectedOverviewStoreKey(option.key);
                            setOverviewStoreSearch("");
                            setSelectedSlice(null);
                            setExpandedStores(new Set());
                            setExpandedRegions(new Set());
                          }}
                          className="flex w-full items-start justify-between rounded-lg px-3 py-2 text-left transition hover:bg-slate-800"
                        >
                          <div>
                            <div className="text-sm font-medium text-white">{option.label}</div>
                            <div className="text-xs text-slate-400">
                              {option.region} - {option.employeeCount} active profiles - {option.attendanceCount} attendance rows
                            </div>
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="rounded-lg border border-dashed border-slate-700 px-3 py-3 text-center text-sm text-slate-400">No active store matched that search.</div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-slate-400" />
                <select
                  value={selectedOverviewRegion}
                  onChange={(e) => {
                    setSelectedOverviewRegion(e.target.value);
                    setSelectedOverviewStoreKey("all");
                    setOverviewStoreSearch("");
                    setSelectedSlice(null);
                    setExpandedStores(new Set());
                    setExpandedRegions(new Set());
                  }}
                  className="h-10 rounded-lg border border-slate-600 bg-slate-800 px-3 text-sm text-white"
                >
                  {overviewRegionOptions.map((option) => (
                    <option key={option} value={option}>
                      {option === "all" ? "All regions" : option}
                    </option>
                  ))}
                </select>
              </div>

              {/* Date Selector */}
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-slate-400" />
                <input
                  type="date"
                  value={selectedOverviewDate}
                  onChange={(e) => setSelectedOverviewDate(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-slate-800 text-white text-sm border border-slate-600 cursor-pointer"
                />
              </div>
              
              {/* View Toggle Slider */}
              <div className="flex items-center gap-2 bg-slate-800/50 rounded-lg p-1 border border-slate-700">
                <button
                  onClick={() => setViewMode("pie")}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition ${
                    viewMode === "pie" 
                      ? "bg-green-600 text-white" 
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <LayoutGrid className="w-4 h-4" />
                  <span>Chart</span>
                </button>
                <button
                  onClick={() => setViewMode("table")}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition ${
                    viewMode === "table" 
                      ? "bg-green-600 text-white" 
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <Table2 className="w-4 h-4" />
                  <span>Table</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="relative mb-4 flex flex-wrap items-center gap-3 text-xs text-slate-400">
          <Badge className="border-slate-700 bg-slate-800/70 text-slate-200">
            {filteredOverviewAttendanceRecords.length} attendance row{filteredOverviewAttendanceRecords.length === 1 ? "" : "s"} on {selectedOverviewDate || "selected date"}
          </Badge>
          <Badge className="border-slate-700 bg-slate-800/70 text-slate-200">
            {regionTableData.length} region{regionTableData.length === 1 ? "" : "s"} across the employee master
          </Badge>
          {selectedOverviewStoreOption ? (
            <Badge className="border-cyan-500/30 bg-cyan-500/15 text-cyan-200">
              Store filter: {selectedOverviewStoreOption.label}
            </Badge>
          ) : null}
          {selectedOverviewRegion !== "all" ? (
            <Badge className="border-indigo-500/30 bg-indigo-500/15 text-indigo-200">
              Region filter: {selectedOverviewRegion}
            </Badge>
          ) : null}
          {overviewLastUpdatedAt ? (
            <Badge className="border-slate-700 bg-slate-800/70 text-slate-200">
              Refreshed {new Date(overviewLastUpdatedAt).toLocaleString("en-ZA")}
            </Badge>
          ) : null}
          {isLoadingOverview ? (
            <Badge className="border-cyan-500/30 bg-cyan-500/20 text-cyan-300">
              <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
              Loading overview
            </Badge>
          ) : trendLoading ? (
            <Badge className="border-amber-500/30 bg-amber-500/20 text-amber-300">
              <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
              Loading trend data
            </Badge>
          ) : null}
        </div>

        {/* Status Cards - Compact */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { name: "At Work", count: overviewStats.atWork, color: "#22c55e", icon: Check, bg: "from-green-500/25 to-emerald-600/15", border: "border-green-500/30", key: "atWork" },
            { name: "AWOL", count: overviewStats.awol, color: "#ef4444", icon: AlertTriangle, bg: "from-red-500/25 to-rose-600/15", border: "border-red-500/30", key: "awol" },
            { name: "Leave", count: overviewStats.leave, color: "#3b82f6", icon: Calendar, bg: "from-blue-500/25 to-sky-600/15", border: "border-blue-500/30", key: "leave" },
            { name: "Unscheduled", count: overviewStats.other, color: "#94a3b8", icon: Circle, bg: "from-slate-500/25 to-gray-600/15", border: "border-slate-500/30", key: "other" },
          ].map((item, index) => {
            const Icon = item.icon;
            const isSelected = selectedSlice === item.key;
            return (
              <motion.div
                key={item.name}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                onClick={() => setSelectedSlice(selectedSlice === item.key ? null : item.key)}
                className={`rounded-[16px] bg-gradient-to-br ${item.bg} border ${item.border} p-3 cursor-pointer transition-all hover:scale-[1.02] ${
                  isSelected ? "ring-2 ring-white/40 ring-offset-2 ring-offset-slate-900" : ""
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${item.color}30` }}>
                      <Icon className="w-4 h-4" style={{ color: item.color }} />
                    </div>
                    <span className="text-sm font-medium text-white/90">{item.name}</span>
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-white/80" />}
                </div>
                <div className="text-2xl font-bold text-white">{item.count}</div>
                {item.count > 0 && (
                  <div className="mt-1 text-xs text-white/50">Click to view details</div>
                )}
              </motion.div>
            );
          })}
        </div>

        {/* View Content - Conditionally show Pie or Table */}
        {viewMode === "pie" ? (
          /* Pie Chart - Larger with Click */
          <div className="mt-4 rounded-[16px] bg-slate-800/40 border border-slate-700/40 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-slate-300">Attendance Distribution</span>
              <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Click slice to drill down</Badge>
            </div>
            {filteredOverviewAttendanceRecords.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-700/60 bg-slate-900/40 px-4 py-16 text-center text-sm text-slate-400">
                No attendance rows were found for the selected date.
              </div>
            ) : (
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie 
                      data={companyOverviewData} 
                      dataKey="count" 
                      nameKey="name" 
                      innerRadius={80} 
                      outerRadius={150} 
                      paddingAngle={3} 
                      cx="50%" 
                      cy="50%"
                      strokeWidth={0}
                      isAnimationActive={false}
                      onClick={(_, index) => {
                        const key = companyOverviewData[index]?.key;
                        setSelectedSlice(selectedSlice === key ? null : key);
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      {companyOverviewData.map((entry) => (
                        <Cell 
                          key={entry.key} 
                          fill={entry.color}
                          stroke={selectedSlice === entry.key ? "#fff" : "transparent"}
                          strokeWidth={selectedSlice === entry.key ? 3 : 0}
                          style={{ filter: selectedSlice === entry.key ? "brightness(1.2)" : "none" }}
                        />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'rgba(30, 41, 59, 0.95)', 
                        borderRadius: "8px", 
                        border: "1px solid rgba(148, 163, 184, 0.2)",
                        color: "#f1f5f9",
                        fontSize: "12px"
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="flex flex-wrap justify-center gap-4 mt-3 pt-3 border-t border-slate-700/30">
              {ATTENDANCE_STATUS_CONFIG.map((config) => (
                <button
                  key={config.key}
                  onClick={() => setSelectedSlice(selectedSlice === config.key ? null : config.key)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition ${
                    selectedSlice === config.key 
                      ? "bg-white/10 border border-white/20" 
                      : "hover:bg-white/5"
                  }`}
                >
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: config.color }} />
                  <span className="text-sm text-slate-400">{config.name}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Table View - Grouped by Region */
          <div className="mt-4 rounded-[16px] bg-slate-800/40 border border-slate-700/40 overflow-hidden">
            {/* Table Header */}
            <div className="bg-slate-800/95 p-4 border-b border-slate-700/50">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-white">Attendance by Region</h3>
                  <p className="text-sm text-slate-400 mt-0.5">
                    {regionTableData.length} regions | {filteredOverviewEmployeeProfiles.length} employee profiles | {filteredOverviewAttendanceRecords.length} attendance rows on this date
                  </p>
                </div>
                <button 
                  onClick={() => {
                    const headers = [["Region", "Store", "At Work", "AWOL", "Leave", "Day Off", "Unscheduled", "Profiles", "Total"]];
                    const rows = regionTableData.flatMap(region => [
                      [region.region, "TOTAL", region.atWork.toString(), region.awol.toString(), region.leave.toString(), region.dayOff.toString(), region.unscheduled.toString(), region.profileCount.toString(), region.total.toString()],
                      ...region.stores.map(store => ["", store.store, store.atWork.toString(), store.awol.toString(), store.leave.toString(), store.dayOff.toString(), store.unscheduled.toString(), store.profileCount.toString(), store.total.toString()])
                    ]);
                    const csv = [...headers, ...rows].map(row => row.join(',')).join('\n');
                    const blob = new Blob([csv], { type: 'text/csv' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `attendance-by-region-${selectedOverviewDate}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-green-600 text-sm text-white hover:bg-green-500 flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />Export CSV
                </button>
              </div>
            </div>
            
            {/* Table Content */}
            <div className="overflow-y-auto" style={{ maxHeight: "500px" }}>
              <table className="w-full">
                <thead className="bg-slate-900/50 sticky top-0">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Region / Store</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-green-400 uppercase tracking-wider">At Work</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-red-400 uppercase tracking-wider">AWOL</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-blue-400 uppercase tracking-wider">Leave</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-purple-400 uppercase tracking-wider">Day Off</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-slate-400 uppercase tracking-wider">Unscheduled</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-cyan-300 uppercase tracking-wider">Profiles</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-white uppercase tracking-wider">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {regionTableData.map((region, regionIndex) => {
                    const isExpanded = expandedRegions.has(region.region);
                    return (
                      <React.Fragment key={region.region}>
                        {/* Region Row */}
                        <tr 
                          className="bg-slate-800/30 hover:bg-slate-700/30 cursor-pointer transition"
                          onClick={() => toggleRegion(region.region)}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded bg-slate-700 flex items-center justify-center text-xs font-bold text-white">
                                {regionIndex + 1}
                              </div>
                              <span className="font-semibold text-white">{region.region}</span>
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4 text-slate-400" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-slate-400" />
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center text-green-400 font-medium">{region.atWork}</td>
                          <td className="px-4 py-3 text-center text-red-400 font-medium">{region.awol}</td>
                          <td className="px-4 py-3 text-center text-blue-400 font-medium">{region.leave}</td>
                          <td className="px-4 py-3 text-center text-purple-400 font-medium">{region.dayOff}</td>
                          <td className="px-4 py-3 text-center text-slate-400 font-medium">{region.unscheduled}</td>
                          <td className="px-4 py-3 text-center text-cyan-300 font-medium">{region.profileCount}</td>
                          <td className="px-4 py-3 text-center text-white font-bold">{region.total}</td>
                        </tr>
                        
                        {/* Store Rows */}
                        {isExpanded && region.stores.map((store, storeIndex) => (
                          <tr 
                            key={`${region.region}-${store.store}`}
                            className="bg-slate-900/20 hover:bg-slate-800/40 transition"
                          >
                            <td className="px-4 py-2 pl-12">
                              <div className="flex items-center gap-2 text-sm">
                                <span className="w-5 h-5 rounded bg-slate-700/50 flex items-center justify-center text-xs text-slate-400">
                                  {storeIndex + 1}
                                </span>
                                <span className="text-slate-300">{store.store}</span>
                              </div>
                            </td>
                            <td className="px-4 py-2 text-center text-sm text-green-300">{store.atWork}</td>
                            <td className="px-4 py-2 text-center text-sm text-red-300">{store.awol}</td>
                            <td className="px-4 py-2 text-center text-sm text-blue-300">{store.leave}</td>
                            <td className="px-4 py-2 text-center text-sm text-purple-300">{store.dayOff}</td>
                            <td className="px-4 py-2 text-center text-sm text-slate-400">{store.unscheduled}</td>
                            <td className="px-4 py-2 text-center text-sm text-cyan-300">{store.profileCount}</td>
                            <td className="px-4 py-2 text-center text-sm text-white font-medium">{store.total}</td>
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
                  
                  {regionTableData.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                        No attendance rows were found for the selected date. The profile counts still reflect the employee master.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Store Breakdown Panel */}
        {selectedSlice && storeBreakdown.length > 0 && (
          <div className="relative rounded-[16px] bg-slate-800/40 border border-slate-700/40 overflow-hidden">
            {/* Header */}
            <div className="bg-slate-800/95 p-4 border-b border-slate-700/50">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-white">
                    {ATTENDANCE_STATUS_CONFIG.find(c => c.key === selectedSlice)?.name} by Store
                  </h3>
                  <p className="text-sm text-slate-400 mt-0.5">
                    {filteredStoreBreakdown.length} of {storeBreakdown.length} stores
                    {percentageFilter > 0 && ` (${percentageFilter}%+ threshold)`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <select
                    value={percentageFilter}
                    onChange={(e) => setPercentageFilter(Number(e.target.value))}
                    className="px-3 py-1.5 rounded-lg bg-slate-700 text-sm text-white border border-slate-600 cursor-pointer"
                  >
                    <option value={0}>All Stores</option>
                    <option value={50}>50%+</option>
                    <option value={40}>40%+</option>
                    <option value={30}>30%+</option>
                    <option value={20}>20%+</option>
                    <option value={10}>10%+</option>
                  </select>
                  <button 
                    onClick={() => void exportStoreBreakdownPDF()}
                    className="px-3 py-1.5 rounded-lg bg-green-600 text-sm text-white hover:bg-green-500 flex items-center gap-2"
                  >
                    <Download className="w-4 h-4" />Export
                  </button>
                  <button 
                    onClick={() => { setSelectedSlice(null); setPercentageFilter(0); setExpandedStores(new Set()); }}
                    className="px-3 py-1.5 rounded-lg bg-slate-700 text-sm text-slate-300 hover:bg-slate-600"
                  >
                    Clear
                  </button>
                </div>
              </div>
            </div>
            
            {/* Scrollable store list */}
            <div className="overflow-y-auto" style={{ maxHeight: "450px" }}>
              <div className="p-4 space-y-2">
                {filteredStoreBreakdown.length === 0 ? (
                  <div className="text-center py-8 text-slate-400">
                    No stores match the filter.
                  </div>
                ) : (
                  filteredStoreBreakdown.map((item, index) => {
                    const percentage = Math.round((item.count / storeBreakdown[0].count) * 100);
                    const config = ATTENDANCE_STATUS_CONFIG.find(c => c.key === selectedSlice);
                    const isExpanded = expandedStores.has(item.store);
                    
                    return (
                      <div key={item.store} className="rounded-lg bg-slate-900/50 border border-slate-700/30">
                        {/* Store header row */}
                        <button
                          className="w-full flex items-center gap-3 p-3 hover:bg-slate-800/50 transition text-left"
                          onClick={() => toggleStore(item.store)}
                        >
                          <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
                            {index + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium text-white">{item.store}</span>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${
                                getStoreDeviceType(item.store) === "physical"
                                  ? "bg-green-900/50 text-green-300 border border-green-700/40"
                                  : "bg-amber-900/50 text-amber-300 border border-amber-700/40"
                              }`}>
                                {getStoreDeviceType(item.store) === "physical" ? "Physical" : "Logical"}
                              </span>
                              <span className="px-2 py-0.5 rounded-full text-xs bg-slate-700 text-slate-300">{item.count}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-1.5">
                              <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                <div 
                                  className="h-full rounded-full"
                                  style={{ 
                                    width: `${percentage}%`,
                                    backgroundColor: config?.color || "#94a3b8"
                                  }}
                                />
                              </div>
                              <span className="text-xs text-slate-400 w-10 text-right flex-shrink-0">{percentage}%</span>
                            </div>
                          </div>
                          <div className="text-slate-400 flex-shrink-0">
                            {isExpanded ? (
                              <ChevronDown className="w-5 h-5" />
                            ) : (
                              <ChevronRight className="w-5 h-5" />
                            )}
                          </div>
                        </button>
                        
                        {/* Expanded employee list */}
                        {isExpanded && (
                          <div className="border-t border-slate-700/30 bg-slate-950/50">
                            <div className="p-3">
                              <div className="text-xs text-slate-500 uppercase tracking-wider mb-2 px-1">
                                Employees ({item.employees.length})
                              </div>
                              <div className="space-y-1">
                                {item.employees.map((emp, empIndex) => (
                                  <div 
                                    key={emp.id}
                                    className="flex items-center justify-between p-2 rounded bg-slate-900/30 hover:bg-slate-800/40 transition"
                                  >
                                    <div className="flex items-center gap-3">
                                      <span className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center text-xs text-slate-400 flex-shrink-0">
                                        {empIndex + 1}
                                      </span>
                                      <div className="min-w-0">
                                        <div className="text-sm text-white font-medium truncate">{emp.name}</div>
                                        <div className="text-xs text-slate-400">{emp.employeeCode}</div>
                                      </div>
                                    </div>
                                    <div className="text-right flex-shrink-0 ml-3">
                                      <div className="text-xs text-slate-300">{emp.store || "Unassigned"}</div>
                                      <div className="text-xs text-slate-500">{emp.storeCode || emp.region || ""}</div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      <section>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {overviewModuleCards.map((card) => (
            <Card key={card.title} className="rounded-[24px] border bg-white shadow-sm">
              <CardContent className="p-5">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{card.title}</div>
                <div className="mt-3 text-3xl font-bold text-slate-950">{card.value}</div>
                <div className="mt-2 text-sm text-slate-600">{card.detail}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Trend Chart */}
      <section>
        <Card className="rounded-[28px] border border-slate-200 bg-white shadow-sm">
          <CardHeader className="gap-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="space-y-2">
                <div>
                  <CardTitle className="text-slate-900">Attendance trend</CardTitle>
                  <CardDescription className="text-slate-500">
                    Historical attendance trends over time. Use the date range and metric chips below to isolate the patterns you want to review.
                  </CardDescription>
                </div>
                {selectedOverviewStoreOption ? (
                  <Badge className="w-fit border-cyan-200 bg-cyan-50 text-cyan-700">
                    Showing trend for {selectedOverviewStoreOption.label}
                  </Badge>
                ) : (
                  <Badge className="w-fit border-slate-200 bg-slate-100 text-slate-700">
                    Showing company-wide trend
                  </Badge>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {QUICK_RANGE_OPTIONS.map((option) => {
                  const active = activeRangeDays === option.days;
                  return (
                    <button
                      key={option.days}
                      type="button"
                      onClick={() => handleQuickRangeChange(option.days)}
                      className={`rounded-2xl px-4 py-2 text-sm font-semibold transition-all ${
                        active
                          ? "border border-cyan-600 bg-cyan-600 text-white shadow-sm"
                          : "border border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_240px]">
              <Input
                type="date"
                value={overviewStartDate}
                onChange={(e) => setOverviewStartDate(e.target.value)}
                className="h-12 rounded-2xl border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus-visible:ring-cyan-500/30"
              />
              <Input
                type="date"
                value={overviewEndDate}
                onChange={(e) => setOverviewEndDate(e.target.value)}
                className="h-12 rounded-2xl border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus-visible:ring-cyan-500/30"
              />
              <select
                value={trendView}
                onChange={(e) => handleTrendPresetChange(e.target.value)}
                className="flex h-12 w-full items-center justify-between rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
              >
                {TREND_VIEW_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap gap-2">
              {ALL_TREND_METRICS.map((metric) => {
                const active = selectedTrendKeys.includes(metric.key);
                return (
                  <button
                    key={metric.key}
                    type="button"
                    onClick={() => toggleTrendMetric(metric.key)}
                    className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-all ${
                      active
                        ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                        : "border-slate-300 bg-slate-50 text-slate-700 hover:border-slate-400 hover:bg-slate-100"
                    }`}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: metric.color }}
                    />
                    <span>{metric.name}</span>
                  </button>
                );
              })}
            </div>
          </CardHeader>

          <CardContent>
            {trendLoading ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-12 flex flex-col items-center justify-center gap-3">
                <RefreshCw className="h-8 w-8 animate-spin text-slate-400" />
                <div className="text-sm text-slate-500">Computing trend data...</div>
              </div>
            ) : attendanceTrendSeries.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-12 text-center text-sm text-slate-500">
                No saved attendance data exists in the selected date range yet.
              </div>
            ) : (
              <div className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-3 md:p-4">
                <div className="h-[420px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={attendanceTrendSeries}
                      margin={{ top: 16, right: 12, left: 6, bottom: 6 }}
                    >
                      <CartesianGrid
                        stroke="#cbd5e1"
                        strokeDasharray="4 4"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: "#64748b", fontSize: 12 }}
                        tickLine={false}
                        axisLine={{ stroke: "#cbd5e1" }}
                      />
                      <YAxis
                        tick={{ fill: "#64748b", fontSize: 12 }}
                        tickLine={false}
                        axisLine={{ stroke: "#cbd5e1" }}
                        width={56}
                      />
                      <Tooltip
                        contentStyle={{
                          borderRadius: "16px",
                          border: "1px solid #0f172a",
                          backgroundColor: "#0f172a",
                          boxShadow: "0 12px 30px rgba(15, 23, 42, 0.22)",
                        }}
                        labelStyle={{
                          color: "#e2e8f0",
                          fontWeight: 700,
                          marginBottom: "6px",
                        }}
                        itemStyle={{ color: "#ffffff" }}
                        formatter={(value, name) => [
                          `${Number(value || 0).toLocaleString("en-ZA")}`,
                          name,
                        ]}
                      />
                      {trendMetricConfig.map((metric) => (
                        <Line
                          key={metric.key}
                          type="monotone"
                          dataKey={metric.key}
                          name={metric.name}
                          stroke={metric.color}
                          strokeWidth={3}
                          dot={false}
                          activeDot={{
                            r: 6,
                            fill: metric.color,
                            stroke: "#ffffff",
                            strokeWidth: 2,
                          }}
                          isAnimationActive={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );

  // ==================== RENDER ATTENDANCE ====================
  const renderAttendance = () => (
    <div className="space-y-6">
      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle>Upload Attendance Data</CardTitle>
          <CardDescription>
            Excel with columns: name, region, store, scheduled, atwork, leave, dayoff
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Upload Section */}
          <div className="flex flex-wrap gap-4 items-center">
            <Button onClick={() => uploadInputRef.current?.click()}>
              <Upload className="w-4 h-4 mr-2" /> Upload Attendance Excel
            </Button>
            <Button variant="outline" onClick={() => deviceUploadInputRef.current?.click()}>
              <Monitor className="w-4 h-4 mr-2" /> Upload Device Data
            </Button>
            
            {/* Date Selector for saved data */}
            {availableDates.length > 0 && (
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-sm text-slate-500">Load saved date:</span>
                <select
                  value={attendanceImportDate}
                  onChange={async (e) => {
                    const date = e.target.value;
                    if (date) {
                      await loadAttendanceForDate(date);
                    }
                  }}
                  className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                >
                  <option value="">Select date...</option>
                  {availableDates.map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <input
            ref={uploadInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleAttendanceUpload}
          />
          <input
            ref={deviceUploadInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleDeviceUpload}
          />

          <div className="grid gap-3 md:grid-cols-3">
            <Input
              placeholder="Search employee, code, store..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="rounded-xl"
            />
            <select
              value={selectedRegion}
              onChange={(e) => setSelectedRegion(e.target.value)}
              className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
            >
              {regionOptions.map(opt => (
                <option key={opt} value={opt}>{opt === "all" ? "All Regions" : opt}</option>
              ))}
            </select>
            <select
              value={selectedStore}
              onChange={(e) => setSelectedStore(e.target.value)}
              className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
            >
              {storeOptions.map(opt => (
                <option key={opt} value={opt}>{opt === "all" ? "All Stores" : opt}</option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {filteredRecords.length > 0 && (
        <Card className="rounded-2xl">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Attendance Records</CardTitle>
              <CardDescription>{filteredRecords.length} records shown</CardDescription>
            </div>
            <Button variant="outline" onClick={exportAttendance}>
              <Download className="w-4 h-4 mr-2" /> Export CSV
            </Button>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border overflow-hidden">
              <table className="w-full">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium">Employee</th>
                    <th className="px-4 py-3 text-center text-sm font-medium">Region</th>
                    <th className="px-4 py-3 text-center text-sm font-medium">Store</th>
                    <th className="px-4 py-3 text-center text-sm font-medium">Sch</th>
                    <th className="px-4 py-3 text-center text-sm font-medium">Work</th>
                    <th className="px-4 py-3 text-center text-sm font-medium">Leave</th>
                    <th className="px-4 py-3 text-center text-sm font-medium">Off</th>
                    <th className="px-4 py-3 text-center text-sm font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.map((record) => (
                    <tr key={record.id} className="border-t hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-medium">{record.name}</div>
                        <div className="text-xs text-slate-500">{record.employeeCode}</div>
                      </td>
                      <td className="px-4 py-3 text-center text-sm">{record.region}</td>
                      <td className="px-4 py-3 text-center text-sm">{record.store}</td>
                      <td className="px-4 py-3 text-center">{record.scheduled ? "1" : "-"}</td>
                      <td className="px-4 py-3 text-center">{record.atWork ? "1" : "-"}</td>
                      <td className="px-4 py-3 text-center">{record.leave ? "1" : "-"}</td>
                      <td className="px-4 py-3 text-center">{record.dayOff ? "1" : "-"}</td>
                      <td className="px-4 py-3 text-center">
                        {record.problem && (
                          <Badge className="bg-red-100 text-red-700">
                            <AlertTriangle className="w-3 h-3 mr-1" /> AWOL
                          </Badge>
                        )}
                        {!record.problem && record.atWork && (
                          <Badge className="bg-green-100 text-green-700">
                            <CheckCircle2 className="w-3 h-3 mr-1" /> At Work
                          </Badge>
                        )}
                        {!record.problem && record.leave && (
                          <Badge className="bg-blue-100 text-blue-700">Leave</Badge>
                        )}
                        {!record.problem && record.dayOff && (
                          <Badge className="bg-purple-100 text-purple-700">Day Off</Badge>
                        )}
                        {!record.problem && !record.atWork && !record.leave && !record.dayOff && record.scheduled && (
                          <Badge className="bg-gray-100 text-gray-700">Pending</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );

  // ==================== RENDER REPORTS ====================
  const renderReports = () => (
    <Suspense fallback={
      <Card className="overflow-hidden rounded-[28px] border-white/10 bg-slate-950/70 text-white">
        <CardContent className="tech-loader p-8 text-center text-slate-300">
          <div className="orb-loader mx-auto mb-4 w-fit">
            <span />
            <span />
            <span />
          </div>
          <div className="font-medium text-white">Loading reports</div>
          <div className="mt-1 text-xs text-slate-400">Building live report logic and preview data...</div>
        </CardContent>
      </Card>
    }>
      <ReportsBuilder
        records={filteredRecords}
        employees={employees}
        reportDateRangeLabel={reportDateRangeLabel}
        employeesReady={!isLoadingEmployees && employees.length > 0}
      />
    </Suspense>
  );

  const renderCommunications = () => (
    <CommunicationsHub
      employees={employees}
      reportTemplates={reportTemplates}
      profiles={communicationProfiles}
      automations={communicationAutomations}
      onProfilesChange={setCommunicationProfiles}
      onAutomationsChange={setCommunicationAutomations}
    />
  );

  const renderClockData = () => (
    <ClockDataHub
      employees={employees}
      onEmployeesRefresh={async () => {
        await loadEmployees();
        await loadClockEvents();
      }}
    />
  );

  // ==================== RENDER DEVICES ====================
  const renderDevices = () => {
    // Get all unique stores from attendance/employees for logical stores
    const allEmployeeStores = new Set([
      ...employees.map(e => e.store).filter(Boolean),
      ...overviewEmployeeProfiles.map(e => e.store).filter(Boolean),
    ]);
    const normalizedEmployeeStores = new Map<string, string>();
    Array.from(allEmployeeStores).forEach((store) => {
      const key = normalizeStoreLookupKey(store);
      if (key && !normalizedEmployeeStores.has(key)) normalizedEmployeeStores.set(key, store);
    });

    const physicalStores = Array.from(deviceStoresMap.keys())
      .filter((store) => getStoreDeviceType(store) === "physical");
    const logicalFromDeviceSheet = Array.from(deviceStoresMap.keys())
      .filter((store) => getStoreDeviceType(store) === "logical");
    const logicalWithoutDeviceRows = Array.from(normalizedEmployeeStores.entries())
      .filter(([key]) => !storeDeviceTypeLookup.has(key))
      .map(([, store]) => store);
    const logicalStores = Array.from(new Set([...logicalFromDeviceSheet, ...logicalWithoutDeviceRows]));

    return (
    <div className="space-y-6">
      <Card className="rounded-2xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Device Management</CardTitle>
              <CardDescription>
                {deviceImportDate ? `Last import: ${deviceImportDate}` : "Upload device data to see status"}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {deviceRecords.length > 0 && (
                <button
                  onClick={handleClearDevices}
                  className="px-4 py-2 bg-slate-200 text-slate-800 rounded-lg hover:bg-slate-300"
                >
                  Clear Devices
                </button>
              )}
              <button
                onClick={() => deviceUploadInputRef.current?.click()}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 flex items-center gap-2"
              >
                <Upload className="w-4 h-4" />
                Import Devices
              </button>
            </div>
          </div>
          <input
            ref={deviceUploadInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleDeviceUpload}
          />
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-5">
            <div className="p-4 bg-slate-100 rounded-xl text-center">
              <div className="text-2xl font-bold">{deviceStats.total}</div>
              <div className="text-sm text-slate-600">Total Devices</div>
            </div>
            <div className="p-4 bg-green-50 rounded-xl text-center">
              <div className="text-2xl font-bold text-green-700">{deviceStats.online}</div>
              <div className="text-sm text-green-600">Online</div>
            </div>
            <div className="p-4 bg-yellow-50 rounded-xl text-center">
              <div className="text-2xl font-bold text-yellow-700">{deviceStats.warning}</div>
              <div className="text-sm text-yellow-600">Warning</div>
            </div>
            <div className="p-4 bg-red-50 rounded-xl text-center">
              <div className="text-2xl font-bold text-red-700">{deviceStats.offline}</div>
              <div className="text-sm text-red-600">Offline</div>
            </div>
            <div className="p-4 bg-cyan-50 rounded-xl text-center">
              <div className="text-2xl font-bold text-cyan-700">{deviceStats.physicalStores}</div>
              <div className="text-sm text-cyan-600">Physical Stores</div>
            </div>
          </div>
          
          {logicalStores.length > 0 && (
            <div className="mt-4 p-4 bg-amber-50 rounded-xl border border-amber-200">
              <div className="text-sm font-medium text-amber-800">
                {logicalStores.length} Logical Store{logicalStores.length !== 1 ? "s" : ""} (No Devices)
              </div>
              <div className="text-xs text-amber-600 mt-1">
                {logicalStores.slice(0, 5).join(", ")}
                {logicalStores.length > 5 && ` and ${logicalStores.length - 5} more`}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {deviceRecords.length > 0 && (
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle>Stores with Devices (Physical)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border overflow-hidden">
              <table className="w-full">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium">Store</th>
                    <th className="px-4 py-3 text-center text-sm font-medium">Type</th>
                    <th className="px-4 py-3 text-center text-sm font-medium">Devices</th>
                    <th className="px-4 py-3 text-center text-sm font-medium">Online</th>
                    <th className="px-4 py-3 text-center text-sm font-medium">Offline</th>
                  </tr>
                </thead>
                <tbody className="text-slate-700">
                  {physicalStores.map((store) => {
                    const storeDevices = deviceStoresMap.get(store) || [];
                    const online = storeDevices.filter(d => d.status === "online").length;
                    const offline = storeDevices.filter(d => d.status === "offline" || d.status === "warning").length;
                    return (
                      <tr key={store} className="border-t hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <div className="font-medium">{store}</div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge className="bg-green-100 text-green-700">Physical</Badge>
                        </td>
                        <td className="px-4 py-3 text-center font-medium">{storeDevices.length}</td>
                        <td className="px-4 py-3 text-center text-green-600">{online}</td>
                        <td className="px-4 py-3 text-center text-red-600">{offline}</td>
                      </tr>
                    );
                  })}
                  {physicalStores.length === 0 && (
                    <tr className="border-t">
                      <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-500">
                        No physical stores detected in the current device import. If this looks wrong, click `Clear Devices` and import the latest sheet again.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {logicalStores.length > 0 && (
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle>Stores without Devices (Logical)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {logicalStores.sort().map(store => (
                <div key={store} className="px-3 py-2 bg-amber-50 rounded-lg border border-amber-200 text-sm text-slate-700">
                  <Badge className="bg-amber-100 text-amber-700 text-xs mr-2">Logical</Badge>
                  {store}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {deviceRecords.length > 0 && (
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle>All Devices</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border overflow-hidden">
              <table className="w-full">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium">Device Name</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Store</th>
                    <th className="px-4 py-3 text-center text-sm font-medium">Type</th>
                    <th className="px-4 py-3 text-center text-sm font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="text-slate-700">
                  {deviceRecords.map((device) => (
                    <tr key={device.id} className="border-t hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium">{device.name}</td>
                      <td className="px-4 py-3 text-sm">{device.store}</td>
                      <td className="px-4 py-3 text-center">
                        {device.deviceType === "physical" ? (
                          <Badge className="bg-green-100 text-green-700">Physical</Badge>
                        ) : (
                          <Badge className="bg-amber-100 text-amber-700">Logical</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {device.status === "online" && (
                          <Badge className="bg-green-100 text-green-700">
                            <CheckCircle2 className="w-3 h-3 mr-1" /> Online
                          </Badge>
                        )}
                        {device.status === "warning" && (
                          <Badge className="bg-yellow-100 text-yellow-700">
                            <AlertTriangle className="w-3 h-3 mr-1" /> Warning
                          </Badge>
                        )}
                        {device.status === "offline" && (
                          <Badge className="bg-red-100 text-red-700">
                            <XCircle className="w-3 h-3 mr-1" /> Offline
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {deviceRecords.length === 0 && (
        <Card className="rounded-2xl">
          <CardContent className="py-12 text-center">
            <Server className="w-12 h-12 mx-auto text-slate-300 mb-4" />
            <div className="text-lg font-medium text-slate-600">No devices imported</div>
            <div className="text-sm text-slate-400 mt-1">
              Upload a device Excel file to get started
            </div>
            <button
              onClick={() => deviceUploadInputRef.current?.click()}
              className="mt-4 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500"
            >
              Import Devices
            </button>
          </CardContent>
        </Card>
      )}
    </div>
  );
  };

  const handleEmployeesHubChange = useCallback(() => {
    overviewDataCacheRef.current = null;
    overviewRequestRef.current = { key: "", fetchedAt: 0, inFlight: false };
    employeeRequestRef.current = { ...employeeRequestRef.current, fetchedAt: 0 };
    clockRequestRef.current = { ...clockRequestRef.current, fetchedAt: 0 };
    void Promise.all([
      loadEmployees({ force: true }),
      loadClockEvents({ force: true }),
    ]);
  }, [loadClockEvents, loadEmployees]);

  const renderEmployees = () => {
    return (
      <>
        <input
          id="payroll-file-input"
          ref={employeeUploadInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={handleEmployeeUpload}
        />
        <input
          ref={employeeUpdateUploadInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={handleEmployeeUpdateUpload}
        />
        <Suspense fallback={
          <Card className="overflow-hidden rounded-[28px] border-white/10 bg-slate-950/70 text-white">
            <CardContent className="flex items-center gap-4 p-6 text-sm text-slate-300">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
              <div>
                <div className="font-medium text-white">Loading Employees</div>
                <div className="text-xs text-slate-400">Loading employee data...</div>
              </div>
            </CardContent>
          </Card>
        }>
          <EmployeesHub
            onEmployeesChange={handleEmployeesHubChange}
            onOpenPayrollUpload={() => {
              const input = document.getElementById('payroll-file-input');
              if (input) {
                input.click();
              } else if (employeeUploadInputRef.current) {
                employeeUploadInputRef.current.click();
              }
            }}
            onOpenStaffListUpload={() => employeeUpdateUploadInputRef.current?.click()}
            onExportUploadLog={(log) => void exportEmployeeUpdateLogWorkbook(log)}
            isUpdatingStaffList={isUpdatingEmployeesFromStaffList}
            staffListUploadStage={staffListUploadStage}
            payrollUploadProgress={payrollUploadProgress}
            payrollUploadStage={payrollUploadStage}
            isUploadingPayroll={isUploadingPayroll}
          />
        </Suspense>
      </>
    );
  };

  const renderAdmin = () => {
    return (
    <div className="space-y-6">
      {/* Admin Tabs */}
      <Card className="rounded-2xl">
        <CardContent className="p-1">
          <div className="flex gap-1">
            <button
              onClick={() => setActiveAdminTab("attendance")}
              className={`flex-1 px-4 py-3 rounded-lg text-sm font-medium transition ${
                activeAdminTab === "attendance"
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <FileSpreadsheet className="w-4 h-4" />
                Attendance
              </div>
            </button>
            <button
              onClick={() => setActiveAdminTab("api")}
              className={`flex-1 px-4 py-3 rounded-lg text-sm font-medium transition ${
                activeAdminTab === "api"
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <Plug className="w-4 h-4" />
                API Configuration
              </div>
            </button>
            <button
              onClick={() => setActiveAdminTab("sync")}
              className={`flex-1 px-4 py-3 rounded-lg text-sm font-medium transition ${
                activeAdminTab === "sync"
                  ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                  : "text-slate-300 hover:bg-slate-800"
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4" />
                Sync Settings
              </div>
            </button>
            <button
              onClick={() => setActiveAdminTab("logs")}
              className={`flex-1 px-4 py-3 rounded-lg text-sm font-medium transition ${
                activeAdminTab === "logs"
                  ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                  : "text-slate-300 hover:bg-slate-800"
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <Clock className="w-4 h-4" />
                Sync Logs
              </div>
            </button>
            <button
              onClick={() => setActiveAdminTab("data")}
              className={`flex-1 px-4 py-3 rounded-lg text-sm font-medium transition ${
                activeAdminTab === "data"
                  ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                  : "text-slate-300 hover:bg-slate-800"
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <Database className="w-4 h-4" />
                Data Tools
              </div>
            </button>
          </div>
        </CardContent>
      </Card>

      {activeAdminTab === "attendance" && renderAttendance()}

      {/* API Configuration Tab */}
      {activeAdminTab === "api" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="rounded-2xl border-slate-700 bg-slate-900/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <PlugZap className="w-5 h-5" />
                iPulse API Settings
              </CardTitle>
              <CardDescription className="text-slate-400">
                Configure connection to iPulse Systems API
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1 text-slate-300">API URL</label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    placeholder="https://api.ipulse-systems.com"
                    value={ipulseFormData.api_url}
                    onChange={(e) => setIpulseFormData({ ...ipulseFormData, api_url: e.target.value })}
                    className="pl-9 bg-slate-800 border-slate-600 text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 text-slate-300">API Key</label>
                <div className="relative">
                  <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    type="password"
                    placeholder="Enter your API key"
                    value={ipulseFormData.api_key}
                    onChange={(e) => setIpulseFormData({ ...ipulseFormData, api_key: e.target.value })}
                    className="pl-9 bg-slate-800 border-slate-600 text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 text-slate-300">API Secret</label>
                <div className="relative">
                  <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    type="password"
                    placeholder="Enter your API secret"
                    value={ipulseFormData.api_secret}
                    onChange={(e) => setIpulseFormData({ ...ipulseFormData, api_secret: e.target.value })}
                    className="pl-9 bg-slate-800 border-slate-600 text-white"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-4">
                <Button
                  variant="outline"
                  onClick={handleTestConnection}
                  disabled={isTestingConnection || !ipulseFormData.api_url}
                  className="flex-1"
                >
                  {isTestingConnection ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Testing...
                    </>
                  ) : (
                    <>
                      <Plug className="w-4 h-4 mr-2" />
                      Test Connection
                    </>
                  )}
                </Button>
                <Button
                  onClick={handleSaveIpulseConfig}
                  disabled={isSavingIpulseConfig}
                  className="flex-1"
                >
                  {isSavingIpulseConfig ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      Save Settings
                    </>
                  )}
                </Button>
              </div>

              {connectionTestResult && (
                <div className={`p-3 rounded-lg ${
                  connectionTestResult.success
                    ? "bg-green-50 text-green-700 border border-green-200"
                    : "bg-red-50 text-red-700 border border-red-200"
                }`}>
                  <div className="flex items-center gap-2">
                    {connectionTestResult.success ? (
                      <CheckCircle className="w-4 h-4" />
                    ) : (
                      <XCircle className="w-4 h-4" />
                    )}
                    <span className="font-medium">
                      {connectionTestResult.success ? "Connection Successful" : "Connection Failed"}
                    </span>
                  </div>
                  {connectionTestResult.error && (
                    <p className="text-sm mt-1">{connectionTestResult.error}</p>
                  )}
                  {connectionTestResult.response_time && (
                    <p className="text-sm mt-1">Response time: {connectionTestResult.response_time}ms</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="w-5 h-5" />
                Database Setup
              </CardTitle>
              <CardDescription>
                Required database tables for iPulse integration
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-600 mb-4">
                Run the following SQL in your Supabase SQL Editor to create the required tables:
              </p>
              <div className="bg-slate-900 text-slate-300 p-4 rounded-lg text-xs font-mono overflow-x-auto">
                <pre className="whitespace-pre-wrap">{IPULSE_SETUP_SQL}</pre>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Sync Settings Tab */}
      {activeAdminTab === "sync" && (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="rounded-2xl border-slate-700 bg-slate-900/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <RefreshCw className="w-5 h-5" />
                Sync Configuration
              </CardTitle>
              <CardDescription className="text-slate-400">
                Configure automatic sync settings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                <div>
                  <div className="font-medium text-white">Auto Sync</div>
                  <div className="text-sm text-slate-400">Automatically sync data at intervals</div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ipulseFormData.auto_sync_enabled}
                    onChange={(e) => setIpulseFormData({ ...ipulseFormData, auto_sync_enabled: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 text-slate-300">
                  Sync Interval (minutes)
                </label>
                <select
                  value={ipulseFormData.sync_interval_minutes}
                  onChange={(e) => setIpulseFormData({ ...ipulseFormData, sync_interval_minutes: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border border-slate-600 bg-slate-800 rounded-lg text-sm text-white"
                  disabled={!ipulseFormData.auto_sync_enabled}
                >
                  <option value={15}>Every 15 minutes</option>
                  <option value={30}>Every 30 minutes</option>
                  <option value={60}>Every hour</option>
                  <option value={120}>Every 2 hours</option>
                  <option value={240}>Every 4 hours</option>
                  <option value={480}>Every 8 hours</option>
                </select>
              </div>

              <div className="pt-4">
                <Button
                  onClick={handleSaveIpulseConfig}
                  disabled={isSavingIpulseConfig}
                  className="w-full"
                >
                  {isSavingIpulseConfig ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      Save Sync Settings
                    </>
                  )}
                </Button>
              </div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-slate-700 bg-slate-900/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <Play className="w-5 h-5" />
                Manual Sync
              </CardTitle>
              <CardDescription className="text-slate-400">
                Trigger an immediate sync with iPulse API
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-white">Last Sync</span>
                  {ipulseConfig?.last_sync_status === 'success' && (
                    <Badge className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      <CheckCircle className="w-3 h-3 mr-1" /> Success
                    </Badge>
                  )}
                  {ipulseConfig?.last_sync_status === 'error' && (
                    <Badge className="bg-red-500/20 text-red-400 border border-red-500/30">
                      <XCircle className="w-3 h-3 mr-1" /> Error
                    </Badge>
                  )}
                  {ipulseConfig?.last_sync_status === 'partial' && (
                    <Badge className="bg-amber-500/20 text-amber-400 border border-amber-500/30">
                      <AlertCircle className="w-3 h-3 mr-1" /> Partial
                    </Badge>
                  )}
                  {!ipulseConfig?.last_sync_status && (
                    <Badge className="bg-slate-500/20 text-slate-400 border border-slate-500/30">Never</Badge>
                  )}
                </div>
                <div className="text-sm text-slate-400">
                  {ipulseConfig?.last_sync_at
                    ? new Date(ipulseConfig.last_sync_at).toLocaleString()
                    : "No sync performed yet"}
                </div>
                {ipulseConfig?.last_error && (
                  <div className="text-sm text-red-400 mt-1">{ipulseConfig.last_error}</div>
                )}
              </div>

              <Button
                onClick={handleManualSync}
                disabled={isSyncing || !ipulseConfig?.api_url}
                className="w-full"
                size="lg"
              >
                {isSyncing ? (
                  <>
                    <RefreshCw className="w-5 h-5 mr-2 animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-5 h-5 mr-2" />
                    Sync Now
                  </>
                )}
              </Button>

              <p className="text-xs text-slate-400 text-center">
                {ipulseConfig?.api_url
                  ? "Click to sync employees and attendance from iPulse"
                  : "Configure API settings first to enable sync"}
              </p>
              </CardContent>
            </Card>
          </div>

          <Suspense fallback={
            <Card className="overflow-hidden rounded-[28px] border-white/10 bg-slate-950/70 text-white">
              <CardContent className="tech-loader p-8 text-center text-slate-300">
                <div className="orb-loader mx-auto mb-4 w-fit">
                  <span />
                  <span />
                  <span />
                </div>
                <div className="font-medium text-white">Loading sync settings</div>
                <div className="mt-1 text-xs text-slate-400">Connecting live sheet orchestration and schedules...</div>
              </CardContent>
            </Card>
          }>
            <ShiftSyncAdminPanel />
          </Suspense>
        </div>
      )}

      {/* Sync Logs Tab */}
      {activeAdminTab === "logs" && (
        <Card className="rounded-2xl">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="w-5 h-5" />
                  Sync History
                </CardTitle>
                <CardDescription>
                  Recent sync operations and their results
                </CardDescription>
              </div>
              {syncLogs.length > 0 && (
                <Button variant="outline" size="sm" onClick={handleClearLogs}>
                  <Trash className="w-4 h-4 mr-2" />
                  Clear Logs
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {syncLogs.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <Clock className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No sync logs yet</p>
                <p className="text-sm">Sync history will appear here after your first sync</p>
              </div>
            ) : (
              <div className="space-y-3">
                {syncLogs.map((log) => (
                  <div key={log.id} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          log.sync_type === 'manual' ? 'bg-blue-100 text-blue-700' :
                          log.sync_type === 'full' ? 'bg-purple-100 text-purple-700' :
                          'bg-slate-100 text-slate-700'
                        }`}>
                          {log.sync_type}
                        </span>
                        <span className="text-sm text-slate-500">
                          {new Date(log.started_at).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {log.status === 'success' && (
                          <Badge className="bg-green-100 text-green-700">
                            <CheckCircle className="w-3 h-3 mr-1" /> Success
                          </Badge>
                        )}
                        {log.status === 'error' && (
                          <Badge className="bg-red-100 text-red-700">
                            <XCircle className="w-3 h-3 mr-1" /> Error
                          </Badge>
                        )}
                        {log.status === 'partial' && (
                          <Badge className="bg-yellow-100 text-yellow-700">
                            <AlertCircle className="w-3 h-3 mr-1" /> Partial
                          </Badge>
                        )}
                        {log.status === 'started' && (
                          <Badge className="bg-blue-100 text-blue-700">
                            <RefreshCw className="w-3 h-3 mr-1" /> Started
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <span className="text-slate-500">Employees:</span>
                        <span className="ml-2 font-medium">{log.employees_synced}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Attendance:</span>
                        <span className="ml-2 font-medium">{log.attendance_synced}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Duration:</span>
                        <span className="ml-2 font-medium">
                          {log.duration_seconds ? `${log.duration_seconds.toFixed(1)}s` : '-'}
                        </span>
                      </div>
                    </div>
                    {log.errors.length > 0 && (
                      <div className="mt-2 text-sm text-red-600">
                        <div className="font-medium">Errors:</div>
                        {log.errors.slice(0, 3).map((err, i) => (
                          <div key={i} className="text-red-500">{err}</div>
                        ))}
                        {log.errors.length > 3 && (
                          <div className="text-slate-500">...and {log.errors.length - 3} more errors</div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {activeAdminTab === "data" && (
        <Suspense fallback={
          <Card className="overflow-hidden rounded-[28px] border-white/10 bg-slate-950/70 text-white">
            <CardContent className="tech-loader p-8 text-center text-slate-300">
              <div className="orb-loader mx-auto mb-4 w-fit">
                <span />
                <span />
                <span />
              </div>
              <div className="font-medium text-white">Loading data tools</div>
              <div className="mt-1 text-xs text-slate-400">Preparing backup, restore, and reset controls...</div>
            </CardContent>
          </Card>
        }>
          <AdminDataToolsPanel onStatusMessage={setSaveMessage} />
        </Suspense>
      )}
    </div>
    );
  };

  const renderMainSection = () => {
    if (activeNav === "shifts") return <ShiftBuilder />;
    if (activeNav === "calendar") return <CalendarBuilder />;
    if (activeNav === "roster") return <RosterBuilder />;
    if (activeNav === "leave") return <LeaveHub employees={employees} />;
    if (activeNav === "clockData") return renderClockData();
    if (activeNav === "communications") return renderCommunications();
    if (activeNav === "employees") return renderEmployees();
    if (activeNav === "admin") return renderAdmin();
    if (activeNav === "reports") return renderReports();
    if (activeNav === "devices") return renderDevices();
    return renderOverview();
  };

  const renderSectionFallback = () => (
    <Card className="overflow-hidden rounded-[28px] border-gray-800 bg-black text-white">
      <CardContent className="tech-loader flex items-center gap-4 p-6 text-sm text-gray-300">
        <div className="orb-loader">
          <span />
          <span />
          <span />
        </div>
        <div>
          <div className="font-medium text-white">Loading section</div>
          <div className="text-xs text-gray-400">Preparing live data, visuals, and tools...</div>
        </div>
      </CardContent>
    </Card>
  );

  const handleNavClick = (key: typeof sidebarItems[number]["key"]) => {
    startTransition(() => {
      setActiveNav(key);
    });
    setMobileMenuOpen(false);
  };

  return (
    <div className="app-shell min-h-screen">
      <div className="flex min-h-screen flex-col md:flex-row">
        <aside className="sidebar-gradient hidden w-72 shrink-0 border-r border-slate-200/10 p-4 md:block md:min-h-screen">
          <div className="mb-8">
            <div className="mb-5 flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl shadow-lg shadow-cyan-500/20" style={{ background: 'linear-gradient(135deg, #0ea5e9, #8b5cf6)' }}>
                <TimerReset className="h-6 w-6 text-white" />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[0.25em] text-cyan-400 font-bold">Attendance</div>
                <div className="text-lg font-bold text-gradient">Backend System</div>
              </div>
            </div>
          </div>

          <nav className="scrollbar-tech space-y-1.5">
            {sidebarItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeNav === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => handleNavClick(item.key)}
                  className={`nav-item group relative flex w-full items-center gap-3.5 rounded-xl px-4 py-3.5 text-left transition-all duration-300 ${
                    isActive
                      ? "bg-gradient-to-r from-cyan-500/20 to-purple-500/20 text-white font-medium border border-cyan-500/20"
                      : "text-slate-400 hover:from-cyan-500/10 hover:to-purple-500/10 hover:text-white"
                  }`}
                >
                  <Icon className={`h-5 w-5 ${isActive ? "text-cyan-400" : "text-slate-500 group-hover:text-cyan-400"} transition-colors`} />
                  <span className="text-sm font-medium">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="header-gradient sticky top-0 z-50 border-b border-slate-200/10 px-4 py-3 md:hidden backdrop-blur-md">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl shadow-lg shadow-cyan-500/20" style={{ background: 'linear-gradient(135deg, #0ea5e9, #8b5cf6)' }}>
                <TimerReset className="h-5 w-5 text-white" />
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-[0.2em] text-cyan-400 font-bold">Attendance</div>
                <div className="text-sm font-bold text-white">Backend</div>
              </div>
            </div>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="flex h-11 w-11 items-center justify-center rounded-xl transition-all hover:scale-105"
              style={{ background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.2), rgba(139, 92, 246, 0.2))', border: '1px solid rgba(14, 165, 233, 0.3)' }}
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? (
                <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>

          {mobileMenuOpen && (
            <>
              <div 
                className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm mt-3"
                onClick={() => setMobileMenuOpen(false)}
              />
              <nav className="relative z-50 mt-3 grid grid-cols-2 gap-2">
                {sidebarItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeNav === item.key;
                  return (
                    <button
                      key={item.key}
                      onClick={() => handleNavClick(item.key)}
                      className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition-all ${
                        isActive
                          ? "bg-gradient-to-r from-cyan-500/30 to-purple-500/30 text-white border border-cyan-500/30"
                          : "bg-slate-800/50 text-slate-300 border border-slate-700/50"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="text-xs">{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </>
          )}
        </div>

        <main className="min-w-0 flex-1 p-4 pt-6 sm:p-6 sm:pt-8 lg:p-8">
          <div className="mx-auto w-full max-w-[1800px] space-y-6">
            <div className="glass-panel-light rounded-2xl px-6 py-5">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-3xl font-bold text-white">
                    {sidebarItems.find(i => i.key === activeNav)?.label || "Overview"}
                  </h1>
                  <p className="mt-2 text-slate-400 text-sm">
                    {activeNav === "overview" && "Real-time attendance monitoring with trends"}
                    {activeNav === "shifts" && "Build and update workbook-based shift rosters"}
                    {activeNav === "calendar" && "Create calendar events across multiple dates and export month or year PDFs"}
                    {activeNav === "roster" && "Generate yearly roster output by marrying shifts with calendar weeks and holidays"}
                    {activeNav === "leave" && "Upload merchandiser leave workbooks, apply them to roster output, and track which rows matched"}
                    {activeNav === "clockData" && "Read-only biometric clock events linked to employee profiles by employee code"}
                    {activeNav === "communications" && "Manage recipients, report automations, and the reporting organogram"}
                    {activeNav === "employees" && "Manage employee profiles and records"}
                    {activeNav === "admin" && "Configure iPulse API and sync settings"}
                    {activeNav === "reports" && "Build custom reports from criteria and save reusable report templates"}
                    {activeNav === "devices" && "Monitor device connectivity"}
                  </p>
                </div>
                <div className="hidden md:flex items-center gap-3">
                  <div className="px-4 py-2 rounded-xl bg-slate-800/50 border border-slate-700/50 text-slate-400 text-sm">
                    <span className="text-cyan-400 font-semibold">{overviewModuleSnapshot.activeEmployees}</span>
                    <span className="ml-1">Active</span>
                  </div>
                </div>
              </div>
            </div>

            {saveMessage && (
              <div className="glass-panel-light rounded-xl px-5 py-4 text-sm text-slate-300 border border-cyan-500/20 bg-cyan-500/5">
                {saveMessage}
              </div>
            )}

            <Suspense fallback={renderSectionFallback()}>
              <motion.div
                key={activeNav}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="slide-up"
              >
                {renderMainSection()}
              </motion.div>
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}
