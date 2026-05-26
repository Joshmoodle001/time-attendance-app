import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Mail, Phone, Search, Upload, User, MessageCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getEmployees, normalizeEmployeeCode, type Employee } from "@/services/database";
import {
  getSavedCoversheetUpload,
  saveCoversheetUpload,
  type CoversheetEmployee,
  type CoversheetStore,
  type CoversheetUpload,
} from "@/services/coversheet";

type CoversheetHubProps = {
  mode: "view" | "admin";
};

const STORE_CODE_KEYS = ["store_code", "store_no", "store_number", "shop_code", "branch_code", "route_code", "customer_code"];
const STORE_NAME_KEYS = ["store_name", "store", "branch_name", "branch", "customer_name", "customer", "location", "site_name", "site", "route"];
const EMPLOYEE_CODE_KEYS = ["employee_code", "employee_no", "employee_number", "employee_id", "payroll_code", "payroll_no", "payroll_number", "rep_code", "rep_number"];
const EMPLOYEE_NAME_KEYS = ["employee_name", "rep_name", "full_name", "display_name", "name"];
const FIRST_NAME_KEYS = ["first_name", "firstname", "first"];
const LAST_NAME_KEYS = ["last_name", "lastname", "surname", "last"];
const REP_KEYS = ["rep", "rep_name", "rep_code", "rep_number", "representative", "representative_name", "route_rep"];
const PHONE_KEYS = ["phone", "phone_number", "cell", "cellphone", "cell_number", "mobile", "mobile_number", "contact_number"];
const EMAIL_KEYS = ["email", "email_address", "genentity_email_address", "mail", "e_mail"];
const STATUS_KEYS = ["status", "employee_status", "employment_status", "route_status", "rep_status", "rep"];
const TERMINATED_KEYS = ["terminated", "is_terminated", "termination", "termination_flag", "termination_status"];
const MATERNITY_KEYS = ["maternity", "is_maternity", "maternity_leave", "maternity_status"];
const HOLD_KEYS = ["hold", "on_hold", "is_hold", "hold_status"];

type ParsedRow = Record<string, unknown>;
type DetectedSheet = {
  rows: unknown[][];
  headerIndex: number;
  score: number;
};

function normalizeHeader(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function cleanText(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function normalizeNumericText(value: string) {
  const compact = value.replace(/[,\s]/g, "");
  if (/^\d+(\.0+)?$/.test(compact)) return compact.replace(/\.0+$/g, "");
  if (/^\d+(\.\d+)?e\+\d+$/i.test(compact)) {
    const num = Number(compact);
    if (Number.isFinite(num)) return Math.trunc(num).toString();
  }
  return value.trim();
}

function normalizePhone(value: unknown) {
  const text = cleanText(value);
  return text ? normalizeNumericText(text).replace(/\s+/g, " ").trim() : "";
}

function normalizeEmail(value: unknown) {
  const text = cleanText(value).replace(/\s+/g, "");
  return text ? text.replace(/[;,]+$/g, "").toLowerCase() : "";
}

function isTruthyStatus(value: unknown) {
  const text = cleanText(value).toLowerCase();
  return ["1", "y", "yes", "true", "active", "hold", "terminated", "maternity", "appointed"].includes(text);
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function digitCount(value: string) {
  return value.replace(/\D/g, "").length;
}

function shouldReplacePhone(current: string, next: string) {
  return next ? (!current || digitCount(next) > digitCount(current)) : false;
}

function shouldReplaceEmail(current: string, next: string) {
  return next ? (!current || (isValidEmail(next) && !isValidEmail(current))) : false;
}

function shouldReplaceText(current: string, next: string) {
  return next ? (!current || next.length > current.length) : false;
}

function storeId(storeCode: string, storeName: string) {
  return `${cleanText(storeCode) || "no-code"}__${(cleanText(storeName) || "Unknown Store").toLowerCase()}`;
}

function combineProfileText(employee: Employee) {
  return [
    employee.store,
    employee.branch,
    employee.team,
    employee.department,
    employee.job_title,
    employee.title,
    employee.business_unit,
    employee.cost_center,
  ]
    .map((value) => cleanText(value).toUpperCase())
    .filter(Boolean)
    .join(" | ");
}

function resolveOperationalStore(employee: Employee) {
  const profileText = combineProfileText(employee);
  if (!profileText) return null;

  const currentStore = cleanText(employee.store);
  const currentStoreCode = cleanText(employee.store_code);
  const shape = (storeName: string) => ({ storeCode: currentStoreCode, storeName: currentStore || storeName });

  if (/\bSTRIKE\s*TEAM\b/.test(profileText)) return shape("STRIKE TEAM");
  if (/\bPFM\s*HQ\b/.test(profileText)) return shape("PFM HQ");
  if (/\bMTS\b/.test(profileText)) return shape("MTS");
  if (/\bIR\b|\bINDUSTRIAL\s+RELATIONS\b/.test(profileText)) return shape("IR");
  return null;
}

function mergeEmployeeWithProfile(store: CoversheetStore, employee: CoversheetEmployee, lookup: Map<string, Employee>) {
  const matched = lookup.get(normalizeEmployeeCode(employee.employeeCode));
  if (!matched) {
    return {
      id: store.id,
      storeCode: store.storeCode,
      storeName: store.storeName,
      phone: employee.phone,
      email: employee.email,
    };
  }

  const operational = resolveOperationalStore(matched);
  const storeCode = operational?.storeCode || store.storeCode;
  const storeName = operational?.storeName || store.storeName;

  return {
    id: storeId(storeCode, storeName),
    storeCode,
    storeName,
    phone: shouldReplacePhone(employee.phone, matched.phone || "") ? normalizePhone(matched.phone) : employee.phone,
    email: shouldReplaceEmail(employee.email, matched.email || "") ? normalizeEmail(matched.email) : employee.email,
  };
}

function withFallbackHeaders(headers: string[]) {
  const extend = (base: string[], predicate: (header: string) => boolean) =>
    Array.from(new Set([...base, ...headers.filter((header) => predicate(header))]));

  return {
    phone: extend(PHONE_KEYS, (header) => /(^|_)(phone|cell|mobile|contact|tel|whatsapp)(_|$)/.test(header)),
    email: extend(EMAIL_KEYS, (header) => /(email|mail)/.test(header)),
    status: extend(STATUS_KEYS, (header) => header === "rep" || /status/.test(header)),
    terminated: extend(TERMINATED_KEYS, (header) => /terminat/.test(header)),
    maternity: extend(MATERNITY_KEYS, (header) => /maternity/.test(header)),
    hold: extend(HOLD_KEYS, (header) => /hold/.test(header)),
  };
}

function readFirstValue(row: ParsedRow, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value == null) continue;
    const text = cleanText(value);
    if (text) return text;
  }
  return "";
}

function getStatuses(row: ParsedRow, headerConfig: ReturnType<typeof withFallbackHeaders>) {
  const statuses: string[] = [];
  const joinedStatus = headerConfig.status.map((key) => cleanText(row[key])).join(" ").toLowerCase();

  if (/terminat/.test(joinedStatus)) statuses.push("terminated");
  if (/maternity|mat(?:ernity)?(?:_|\s|-)?leave/.test(joinedStatus)) statuses.push("maternity");
  if (/hold/.test(joinedStatus)) statuses.push("hold");
  if (headerConfig.terminated.some((key) => isTruthyStatus(row[key]))) statuses.push("terminated");
  if (headerConfig.maternity.some((key) => isTruthyStatus(row[key]))) statuses.push("maternity");
  if (headerConfig.hold.some((key) => isTruthyStatus(row[key]))) statuses.push("hold");

  return Array.from(new Set(statuses));
}

function parseStoreFields(storeCode: string, storeName: string) {
  const trimmedCode = storeCode.trim();
  const trimmedName = storeName.trim();
  if (trimmedCode && trimmedName) return { storeCode: trimmedCode, storeName: trimmedName };

  const matched = (trimmedName || trimmedCode).match(/^([A-Za-z0-9]+)\s*-\s*(.+)$/);
  if (matched) {
    return {
      storeCode: matched[1].trim(),
      storeName: matched[2].trim(),
    };
  }

  return {
    storeCode: trimmedCode,
    storeName: trimmedName || trimmedCode,
  };
}

function detectHeaderRow(rows: unknown[][]) {
  const limit = Math.min(rows.length, 40);
  let bestIndex = -1;
  let bestScore = 0;

  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!Array.isArray(row) || row.length === 0) continue;

    const headers = row.map((cell) => normalizeHeader(cleanText(cell))).filter(Boolean);
    if (headers.length === 0) continue;

    const hasStore = headers.some((header) => STORE_CODE_KEYS.includes(header) || STORE_NAME_KEYS.includes(header));
    const hasEmployee =
      headers.some((header) => EMPLOYEE_CODE_KEYS.includes(header) || EMPLOYEE_NAME_KEYS.includes(header)) ||
      (headers.some((header) => FIRST_NAME_KEYS.includes(header)) && headers.some((header) => LAST_NAME_KEYS.includes(header)));

    const score =
      headers.filter((header) => STORE_CODE_KEYS.includes(header)).length * 2 +
      headers.filter((header) => STORE_NAME_KEYS.includes(header)).length * 2 +
      headers.filter((header) => EMPLOYEE_CODE_KEYS.includes(header)).length * 2 +
      headers.filter((header) => EMPLOYEE_NAME_KEYS.includes(header)).length * 2 +
      headers.filter((header) => STATUS_KEYS.includes(header) || TERMINATED_KEYS.includes(header) || MATERNITY_KEYS.includes(header) || HOLD_KEYS.includes(header)).length;

    if (hasStore && hasEmployee && score >= bestScore) {
      bestIndex = rowIndex;
      bestScore = score;
    }
  }

  return bestIndex;
}

async function parseWorkbook(file: File) {
  const xlsx = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = xlsx.read(buffer, { type: "array", cellDates: true });

  let bestSheet: DetectedSheet | null = null;

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as unknown[][];
    if (!rows.length) return;

    const headerIndex = detectHeaderRow(rows);
    if (headerIndex < 0) return;

    const headers = (rows[headerIndex] || []).map((cell: unknown, index: number) => normalizeHeader(cleanText(cell)) || `column_${index + 1}`);
    const score =
      headers.filter((header) => STORE_CODE_KEYS.includes(header)).length * 3 +
      headers.filter((header) => STORE_NAME_KEYS.includes(header)).length * 2 +
      headers.filter((header) => EMPLOYEE_CODE_KEYS.includes(header)).length * 3 +
      headers.filter((header) => EMPLOYEE_NAME_KEYS.includes(header)).length * 2 +
      headers.filter((header) => FIRST_NAME_KEYS.includes(header) || LAST_NAME_KEYS.includes(header)).length +
      headers.filter((header) => REP_KEYS.includes(header) || STATUS_KEYS.includes(header)).length +
      (sheetName.toLowerCase().includes("raw") ? 4 : 0);

    if (!bestSheet || score > bestSheet.score) {
      bestSheet = { rows, headerIndex, score };
    }
  });

  if (!bestSheet) return [];

  const resolvedBestSheet = bestSheet as DetectedSheet;
  const rows = resolvedBestSheet.rows;
  const headerRow = rows[resolvedBestSheet.headerIndex] || [];
  const headers = headerRow.map((cell: unknown, index: number) => normalizeHeader(cleanText(cell)) || `column_${index + 1}`);
  const dataStartIndex = resolvedBestSheet.headerIndex + 1;
  const headerConfig = withFallbackHeaders(headers);
  const storeMap = new Map<string, CoversheetStore>();

  for (let rowIndex = dataStartIndex; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!Array.isArray(row)) continue;

    const parsed = headers.reduce<ParsedRow>((accumulator: ParsedRow, header: string, index: number) => {
      accumulator[header] = row[index];
      return accumulator;
    }, {});

    const rawStoreCode = readFirstValue(parsed, STORE_CODE_KEYS);
    const rawStoreName = readFirstValue(parsed, STORE_NAME_KEYS);
    const employeeCode = readFirstValue(parsed, EMPLOYEE_CODE_KEYS);

    let employeeName = readFirstValue(parsed, EMPLOYEE_NAME_KEYS);
    if (!employeeName) {
      employeeName = [readFirstValue(parsed, FIRST_NAME_KEYS), readFirstValue(parsed, LAST_NAME_KEYS)].filter(Boolean).join(" ").trim();
    }

    if ((!rawStoreCode && !rawStoreName) || (!employeeCode && !employeeName)) continue;

    const { storeCode, storeName } = parseStoreFields(rawStoreCode, rawStoreName);
    const displayStoreName = storeName || "Unknown Store";
    const nextStoreId = storeId(storeCode, displayStoreName);

    if (!storeMap.has(nextStoreId)) {
      storeMap.set(nextStoreId, {
        id: nextStoreId,
        storeCode,
        storeName: displayStoreName,
        employees: [],
      });
    }

    const statuses = getStatuses(parsed, headerConfig);
    const phone = normalizePhone(readFirstValue(parsed, headerConfig.phone));
    const email = normalizeEmail(readFirstValue(parsed, headerConfig.email));
    const repLabel = cleanText(readFirstValue(parsed, REP_KEYS));
    const employeeId = `${nextStoreId}__${(employeeCode || employeeName).toLowerCase()}`;
    const store = storeMap.get(nextStoreId)!;
    const existing = store.employees.find((item) => item.id === employeeId);

    if (existing) {
      existing.statuses = Array.from(new Set([...existing.statuses, ...statuses]));
      if (shouldReplacePhone(existing.phone, phone)) existing.phone = phone;
      if (shouldReplaceEmail(existing.email, email)) existing.email = email;
      if (shouldReplaceText(existing.repLabel, repLabel)) existing.repLabel = repLabel;
      continue;
    }

    store.employees.push({
      id: employeeId,
      employeeCode: employeeCode.trim(),
      employeeName: employeeName.trim() || employeeCode.trim(),
      phone,
      email,
      repLabel,
      statuses,
    });
  }

  return Array.from(storeMap.values())
    .map((store) => ({
      ...store,
      employees: [...store.employees].sort((left, right) =>
        left.employeeName.localeCompare(right.employeeName) || left.employeeCode.localeCompare(right.employeeCode)
      ),
    }))
    .sort((left, right) => `${left.storeCode} ${left.storeName}`.trim().localeCompare(`${right.storeCode} ${right.storeName}`.trim()));
}

function statusBadgeClass(status: string) {
  if (status === "terminated") return "bg-red-500/20 text-red-400 border border-red-500/30";
  if (status === "maternity") return "bg-blue-500/20 text-blue-300 border border-blue-500/30";
  return "bg-amber-500/20 text-amber-300 border border-amber-500/30";
}

function formatContact(phone: string) {
  const compact = normalizePhone(phone).replace(/[^\d+]/g, "");
  if (!compact) return { tel: "", whatsapp: "" };
  if (compact.startsWith("+")) return { tel: compact, whatsapp: compact.slice(1) };
  if (compact.startsWith("0")) {
    const international = `+27${compact.slice(1)}`;
    return { tel: international, whatsapp: international.slice(1) };
  }
  if (compact.startsWith("27")) return { tel: `+${compact}`, whatsapp: compact };
  return { tel: compact, whatsapp: compact };
}

export default function CoversheetHub({ mode }: CoversheetHubProps) {
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [upload, setUpload] = useState<CoversheetUpload | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [expandedStores, setExpandedStores] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const [savedUpload, loadedEmployees] = await Promise.all([getSavedCoversheetUpload(), getEmployees()]);
        if (!alive) return;
        setUpload(savedUpload);
        setEmployees(loadedEmployees);
        setExpandedStores(new Set());
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const mergedStores = useMemo(() => {
    const stores = upload?.stores || [];
    if (!stores.length) return stores;

    const employeeLookup = new Map(employees.map((employee) => [normalizeEmployeeCode(employee.employee_code), employee]));
    const storeMap = new Map<string, CoversheetStore>();

    stores.forEach((store) => {
      store.employees.forEach((employee) => {
        const merged = mergeEmployeeWithProfile(store, employee, employeeLookup);
        const nextStore = storeMap.get(merged.id) || {
          id: merged.id,
          storeCode: merged.storeCode,
          storeName: merged.storeName,
          employees: [],
        };
        nextStore.employees.push({
          ...employee,
          phone: merged.phone,
          email: merged.email,
        });
        storeMap.set(merged.id, nextStore);
      });
    });

    return Array.from(storeMap.values())
      .map((store) => ({
        ...store,
        employees: [...store.employees].sort((left, right) =>
          left.employeeName.localeCompare(right.employeeName) || left.employeeCode.localeCompare(right.employeeCode)
        ),
      }))
      .sort((left, right) => `${left.storeCode} ${left.storeName}`.trim().localeCompare(`${right.storeCode} ${right.storeName}`.trim()));
  }, [upload?.stores, employees]);

  const stats = useMemo(() => {
    const sourceStores = mergedStores;
    let employeeCount = 0;
    let terminated = 0;
    let maternity = 0;
    let hold = 0;

    sourceStores.forEach((store) => {
      employeeCount += store.employees.length;
      store.employees.forEach((employee) => {
        if (employee.statuses.includes("terminated")) terminated += 1;
        if (employee.statuses.includes("maternity")) maternity += 1;
        if (employee.statuses.includes("hold")) hold += 1;
      });
    });

    return {
      stores: sourceStores.length,
      employees: employeeCount,
      terminated,
      maternity,
      hold,
    };
  }, [mergedStores]);

  const filteredSuggestions = useMemo(() => {
    const query = cleanText(deferredSearch).toLowerCase();
    if (!query || selectedStoreId) return [];
    return mergedStores
      .filter((store) => `${store.storeCode} ${store.storeName}`.toLowerCase().includes(query))
      .slice(0, 8);
  }, [deferredSearch, mergedStores, selectedStoreId]);

  const visibleStores = useMemo(() => {
    const query = cleanText(deferredSearch).toLowerCase();
    const narrowed = selectedStoreId ? mergedStores.filter((store) => store.id === selectedStoreId) : mergedStores;

    if (!query) return narrowed;

    return narrowed.filter((store) => {
      if (`${store.storeCode} ${store.storeName}`.toLowerCase().includes(query)) return true;
      return store.employees.some((employee) =>
        [employee.employeeCode, employee.employeeName, employee.phone, employee.email, employee.statuses.join(" ")]
          .join(" ")
          .toLowerCase()
          .includes(query)
      );
    });
  }, [deferredSearch, mergedStores, selectedStoreId]);

  const handleUpload = async (file: File) => {
    setMessage("");
    setUploading(true);

    try {
      const stores = await parseWorkbook(file);
      if (stores.length === 0) {
        setMessage("No coversheet rows were found in this workbook.");
        return;
      }

      const nextUpload: CoversheetUpload = {
        fileName: file.name,
        uploadedAt: new Date().toISOString(),
        stores,
      };

      const employeeCount = stores.reduce((total, store) => total + store.employees.length, 0);
      const phoneCount = stores.reduce((total, store) => total + store.employees.filter((employee) => !!employee.phone).length, 0);
      const emailCount = stores.reduce((total, store) => total + store.employees.filter((employee) => !!employee.email).length, 0);

      await saveCoversheetUpload(nextUpload);
      setUpload(nextUpload);
      setExpandedStores(new Set());
      setSelectedStoreId(null);
      setSearch("");
      setMessage(`Imported ${employeeCount} employee row(s) across ${stores.length} store(s), ${phoneCount} phone(s), and ${emailCount} email(s).`);
    } catch (error) {
      setMessage(`Upload failed: ${error instanceof Error ? error.message : "Unknown workbook parse error."}`);
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    if (!selectedStoreId || visibleStores.some((store) => store.id === selectedStoreId)) return;
    setSelectedStoreId(null);
  }, [visibleStores, selectedStoreId]);

  const headerDescription =
    mode === "view"
      ? "View grouped route coversheets with terminated, maternity, and hold statuses"
      : "Upload your route list workbook to refresh the Coversheet section shown in the main menu.";

  if (mode === "admin") {
    return (
      <div className="space-y-6">
        <Card className="rounded-2xl border-slate-700 bg-slate-900/50">
          <CardHeader>
            <CardTitle className="text-white">Coversheet Upload</CardTitle>
            <CardDescription className="text-slate-400">{headerDescription}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => uploadInputRef.current?.click()} disabled={uploading}>
                <Upload className="mr-2 h-4 w-4" />
                {uploading ? "Uploading..." : "Upload Coversheet Workbook"}
              </Button>
              <input
                ref={uploadInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleUpload(file);
                  event.target.value = "";
                }}
              />
            </div>

            {upload && (
              <div className="rounded-xl border border-slate-700 bg-slate-950/40 p-4 text-sm text-slate-300">
                <div className="font-medium text-white">{upload.fileName}</div>
                <div className="text-xs text-slate-400">Uploaded {new Date(upload.uploadedAt).toLocaleString("en-ZA")}</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-5">
                  <div className="rounded-lg border border-slate-700 px-3 py-2 text-center">
                    <div className="text-lg font-bold text-white">{stats.stores}</div>
                    <div className="text-xs text-slate-400">Stores</div>
                  </div>
                  <div className="rounded-lg border border-slate-700 px-3 py-2 text-center">
                    <div className="text-lg font-bold text-white">{stats.employees}</div>
                    <div className="text-xs text-slate-400">Employees</div>
                  </div>
                  <div className="rounded-lg border border-red-500/30 px-3 py-2 text-center">
                    <div className="text-lg font-bold text-red-400">{stats.terminated}</div>
                    <div className="text-xs text-slate-400">Terminated</div>
                  </div>
                  <div className="rounded-lg border border-blue-500/30 px-3 py-2 text-center">
                    <div className="text-lg font-bold text-blue-300">{stats.maternity}</div>
                    <div className="text-xs text-slate-400">Maternity</div>
                  </div>
                  <div className="rounded-lg border border-amber-500/30 px-3 py-2 text-center">
                    <div className="text-lg font-bold text-amber-300">{stats.hold}</div>
                    <div className="text-xs text-slate-400">Hold</div>
                  </div>
                </div>
              </div>
            )}

            {message && <div className="text-sm text-cyan-300">{message}</div>}
            {loading && <div className="text-xs text-slate-400">Loading saved coversheet data...</div>}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <Card className="rounded-2xl border-slate-700 bg-slate-900/50">
        <CardContent className="py-10 text-center text-slate-400">Loading coversheet data...</CardContent>
      </Card>
    );
  }

  if (!upload || mergedStores.length === 0) {
    return (
      <Card className="rounded-2xl border-slate-700 bg-slate-900/50">
        <CardContent className="py-10 text-center text-slate-400">
          No coversheet uploaded yet. Use `Admin &gt; Coversheet` to upload the route list workbook.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wider text-slate-400">
        <span className="font-semibold text-slate-300">Coversheet</span>
        <Badge className="border border-slate-600 bg-slate-700/40 text-slate-200">{stats.stores} stores</Badge>
        <Badge className="border border-slate-600 bg-slate-700/40 text-slate-200">{stats.employees} employees</Badge>
        <Badge className={statusBadgeClass("terminated")}>{stats.terminated} terminated</Badge>
        <Badge className={statusBadgeClass("maternity")}>{stats.maternity} maternity</Badge>
        <Badge className={statusBadgeClass("hold")}>{stats.hold} hold</Badge>
      </div>

      <Card className="rounded-2xl border-slate-700 bg-slate-900/50">
        <CardContent className="space-y-3 p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                if (selectedStoreId) setSelectedStoreId(null);
              }}
              placeholder="Search stores, employee names, codes, phone, or email..."
              className="pl-10"
            />
          </div>

          {selectedStoreId && (
            <div className="flex items-center gap-2">
              <Badge className="border-cyan-500/40 bg-cyan-500/20 text-cyan-300">Store selected</Badge>
              <Button variant="outline" size="sm" onClick={() => {
                setSelectedStoreId(null);
                setSearch("");
              }}>
                Clear selection
              </Button>
            </div>
          )}

          {!selectedStoreId && filteredSuggestions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {filteredSuggestions.map((store) => (
                <Button
                  key={store.id}
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedStoreId(store.id);
                    setExpandedStores(new Set([store.id]));
                    setSearch(`${store.storeCode ? `${store.storeCode} - ` : ""}${store.storeName}`);
                  }}
                >
                  {store.storeCode ? `${store.storeCode} - ` : ""}
                  {store.storeName}
                </Button>
              ))}
            </div>
          )}

          <div className="text-xs text-slate-400">Showing {visibleStores.length} of {mergedStores.length} store(s)</div>
        </CardContent>
      </Card>

      {visibleStores.map((store) => {
        const isExpanded = expandedStores.has(store.id);
        const storeLabel = `${store.storeCode ? `${store.storeCode} - ` : ""}${store.storeName}`.trim();

        return (
          <Card key={store.id} className="rounded-2xl border-slate-700 bg-slate-900/50">
            <CardContent className="p-0">
              <button
                onClick={() => {
                  setExpandedStores((current) => {
                    const next = new Set(current);
                    if (next.has(store.id)) next.delete(store.id);
                    else next.add(store.id);
                    return next;
                  });
                }}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-800/40"
              >
                <div className="flex items-center gap-2">
                  {isExpanded ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                  <User className="h-4 w-4 text-slate-300" />
                  <span className="font-semibold text-white">{storeLabel}</span>
                </div>
                <Badge className="border border-slate-600 bg-slate-700/50 text-slate-200">{store.employees.length}</Badge>
              </button>

              {isExpanded && (
                <div className="space-y-2 border-t border-slate-700/60 px-4 py-3">
                  {store.employees.map((employee) => {
                    const contact = formatContact(employee.phone);
                    const email = normalizeEmail(employee.email);
                    const mailTo = isValidEmail(email) ? email : "";

                    return (
                      <div key={employee.id} className="rounded-lg border border-slate-700/70 bg-slate-950/40 px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <User className="h-3.5 w-3.5 text-slate-400" />
                          <span className="font-medium text-slate-100">
                            {employee.employeeCode ? `${employee.employeeCode} - ` : ""}
                            {employee.employeeName}
                          </span>
                          {employee.statuses.map((status) => (
                            <Badge key={`${employee.id}_${status}`} className={statusBadgeClass(status)}>
                              {status}
                            </Badge>
                          ))}
                        </div>

                        <div className="mt-1 space-y-1 text-xs text-slate-400">
                          <div className="flex items-center gap-1.5">
                            <Phone className="h-3.5 w-3.5" />
                            <span>{employee.phone || "-"}</span>
                            {contact.tel && (
                              <a
                                href={`tel:${contact.tel}`}
                                className="ml-2 inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/25"
                              >
                                <Phone className="h-3 w-3" />
                                Call
                              </a>
                            )}
                            {contact.whatsapp && (
                              <a
                                href={`https://wa.me/${contact.whatsapp}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 rounded-md border border-green-500/30 bg-green-500/15 px-2 py-0.5 text-[11px] font-medium text-green-300 hover:bg-green-500/25"
                              >
                                <MessageCircle className="h-3 w-3" />
                                WhatsApp
                              </a>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Mail className="h-3.5 w-3.5" />
                            <span>{email || "-"}</span>
                            {mailTo && (
                              <a
                                href={`mailto:${mailTo}`}
                                className="ml-2 inline-flex items-center gap-1 rounded-md border border-cyan-500/30 bg-cyan-500/15 px-2 py-0.5 text-[11px] font-medium text-cyan-300 hover:bg-cyan-500/25"
                              >
                                <Mail className="h-3 w-3" />
                                Email
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {visibleStores.length === 0 && (
        <Card className="rounded-2xl border-slate-700 bg-slate-900/50">
          <CardContent className="py-8 text-center text-slate-400">No stores matched this search.</CardContent>
        </Card>
      )}
    </div>
  );
}
