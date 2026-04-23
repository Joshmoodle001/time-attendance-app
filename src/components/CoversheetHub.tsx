import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronDown, ChevronRight, Mail, Phone, Search, Store, Upload, UserRound } from "lucide-react";

type CoversheetStatus = "terminated" | "maternity" | "hold";

type CoversheetEmployee = {
  id: string;
  employeeCode: string;
  employeeName: string;
  phone: string;
  email: string;
  statuses: CoversheetStatus[];
};

type CoversheetStoreGroup = {
  id: string;
  storeCode: string;
  storeName: string;
  employees: CoversheetEmployee[];
};

type CoversheetData = {
  fileName: string;
  uploadedAt: string;
  stores: CoversheetStoreGroup[];
};

type CoversheetHubProps = {
  mode: "admin" | "view";
};

const COVERSHEET_STORAGE_KEY = "coversheet-data-v1";
const COVERSHEET_DB_NAME = "time-attendance-coversheet-db";
const COVERSHEET_DB_VERSION = 1;
const COVERSHEET_DB_STORE = "coversheet_data";
const COVERSHEET_DB_RECORD_ID = "latest";

const STORE_CODE_KEYS = [
  "store_code",
  "store_no",
  "store_number",
  "shop_code",
  "branch_code",
  "route_code",
  "customer_code",
];

const STORE_NAME_KEYS = [
  "store_name",
  "store",
  "branch_name",
  "branch",
  "customer_name",
  "customer",
  "location",
  "site_name",
  "site",
  "route",
];

const EMPLOYEE_CODE_KEYS = [
  "employee_code",
  "employee_no",
  "employee_number",
  "employee_id",
  "payroll_code",
  "payroll_no",
  "payroll_number",
  "rep_code",
  "rep_number",
];

const EMPLOYEE_NAME_KEYS = [
  "employee_name",
  "rep_name",
  "full_name",
  "display_name",
  "name",
];

const FIRST_NAME_KEYS = ["first_name", "firstname", "first"];
const LAST_NAME_KEYS = ["last_name", "lastname", "surname", "last"];

const PHONE_KEYS = ["phone", "phone_number", "cell", "cellphone", "mobile", "mobile_number", "contact_number"];
const EMAIL_KEYS = ["email", "email_address", "mail", "e_mail"];
const STATUS_KEYS = ["status", "employee_status", "employment_status", "route_status", "rep_status"];
const TERMINATED_KEYS = ["terminated", "is_terminated", "termination", "termination_flag", "termination_status"];
const MATERNITY_KEYS = ["maternity", "is_maternity", "maternity_leave", "maternity_status"];
const HOLD_KEYS = ["hold", "on_hold", "is_hold", "hold_status"];

function normalizeKey(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeValue(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function parseTruthy(value: unknown) {
  const clean = normalizeValue(value).toLowerCase();
  return ["1", "y", "yes", "true", "active", "hold", "terminated", "maternity"].includes(clean);
}

function findHeaderRow(rows: unknown[][]) {
  const maxRows = Math.min(rows.length, 40);
  let bestIndex = -1;
  let bestScore = 0;

  for (let rowIndex = 0; rowIndex < maxRows; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!Array.isArray(row) || row.length === 0) continue;

    const keys = row.map((cell) => normalizeKey(normalizeValue(cell))).filter(Boolean);
    if (keys.length === 0) continue;

    const hasStore = keys.some((key) => STORE_CODE_KEYS.includes(key) || STORE_NAME_KEYS.includes(key));
    const hasEmployee =
      keys.some((key) => EMPLOYEE_CODE_KEYS.includes(key) || EMPLOYEE_NAME_KEYS.includes(key)) ||
      (keys.some((key) => FIRST_NAME_KEYS.includes(key)) && keys.some((key) => LAST_NAME_KEYS.includes(key)));

    const score =
      keys.filter((key) => STORE_CODE_KEYS.includes(key)).length * 2 +
      keys.filter((key) => STORE_NAME_KEYS.includes(key)).length * 2 +
      keys.filter((key) => EMPLOYEE_CODE_KEYS.includes(key)).length * 2 +
      keys.filter((key) => EMPLOYEE_NAME_KEYS.includes(key)).length * 2 +
      keys.filter((key) => STATUS_KEYS.includes(key) || TERMINATED_KEYS.includes(key) || MATERNITY_KEYS.includes(key) || HOLD_KEYS.includes(key)).length;

    if (hasStore && hasEmployee && score >= bestScore) {
      bestIndex = rowIndex;
      bestScore = score;
    }
  }

  return bestIndex;
}

function getEntry(entries: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = entries[key];
    if (value === null || value === undefined) continue;
    const text = normalizeValue(value);
    if (!text) continue;
    return text;
  }
  return "";
}

function collectStatuses(entries: Record<string, unknown>): CoversheetStatus[] {
  const statuses: CoversheetStatus[] = [];

  const statusText = getEntry(entries, STATUS_KEYS).toLowerCase();
  if (statusText.includes("terminated")) statuses.push("terminated");
  if (statusText.includes("maternity")) statuses.push("maternity");
  if (statusText.includes("hold")) statuses.push("hold");

  if (TERMINATED_KEYS.some((key) => parseTruthy(entries[key]))) statuses.push("terminated");
  if (MATERNITY_KEYS.some((key) => parseTruthy(entries[key]))) statuses.push("maternity");
  if (HOLD_KEYS.some((key) => parseTruthy(entries[key]))) statuses.push("hold");

  return Array.from(new Set(statuses));
}

type CoversheetIndexedRecord = {
  id: string;
  payload: CoversheetData;
};

function isValidCoversheetData(value: unknown): value is CoversheetData {
  if (!value || typeof value !== "object") return false;
  const entry = value as CoversheetData;
  return Boolean(entry.fileName) && Boolean(entry.uploadedAt) && Array.isArray(entry.stores);
}

function openCoversheetIndexedDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const request = window.indexedDB.open(COVERSHEET_DB_NAME, COVERSHEET_DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(COVERSHEET_DB_STORE)) {
        database.createObjectStore(COVERSHEET_DB_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function readIndexedDbCoversheetData(): Promise<CoversheetData | null> {
  const database = await openCoversheetIndexedDb();
  if (!database) return null;

  return new Promise((resolve) => {
    const transaction = database.transaction(COVERSHEET_DB_STORE, "readonly");
    const store = transaction.objectStore(COVERSHEET_DB_STORE);
    const request = store.get(COVERSHEET_DB_RECORD_ID);

    request.onsuccess = () => {
      const record = request.result as CoversheetIndexedRecord | undefined;
      if (record && isValidCoversheetData(record.payload)) {
        resolve(record.payload);
      } else {
        resolve(null);
      }
    };
    request.onerror = () => resolve(null);
  });
}

async function writeIndexedDbCoversheetData(data: CoversheetData): Promise<boolean> {
  const database = await openCoversheetIndexedDb();
  if (!database) return false;

  return new Promise<boolean>((resolve) => {
    const transaction = database.transaction(COVERSHEET_DB_STORE, "readwrite");
    const store = transaction.objectStore(COVERSHEET_DB_STORE);
    store.put({
      id: COVERSHEET_DB_RECORD_ID,
      payload: data,
    } satisfies CoversheetIndexedRecord);

    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => resolve(false);
  });
}

function readLocalStorageCoversheetData(): CoversheetData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(COVERSHEET_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isValidCoversheetData(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function loadStoredCoversheetData(): Promise<CoversheetData | null> {
  const indexedData = await readIndexedDbCoversheetData();
  if (indexedData) return indexedData;

  const legacyData = readLocalStorageCoversheetData();
  if (!legacyData) return null;

  await writeIndexedDbCoversheetData(legacyData);
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(COVERSHEET_STORAGE_KEY);
  }
  return legacyData;
}

async function saveStoredCoversheetData(data: CoversheetData) {
  if (typeof window === "undefined") return;

  const indexedSaved = await writeIndexedDbCoversheetData(data);
  if (indexedSaved) {
    window.localStorage.removeItem(COVERSHEET_STORAGE_KEY);
    return;
  }

  try {
    window.localStorage.setItem(COVERSHEET_STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    if (error instanceof DOMException && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED")) {
      throw new Error("Coversheet upload is too large for browser storage. Clear site data or reduce workbook size.");
    }
    throw error;
  }
}

function statusBadgeClass(status: CoversheetStatus) {
  if (status === "terminated") return "bg-red-500/20 text-red-400 border border-red-500/30";
  if (status === "maternity") return "bg-blue-500/20 text-blue-300 border border-blue-500/30";
  return "bg-amber-500/20 text-amber-300 border border-amber-500/30";
}

async function parseWorkbook(file: File): Promise<CoversheetStoreGroup[]> {
  const xlsx = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = xlsx.read(buffer, { type: "array", cellDates: true });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) return [];

  const rows = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });
  if (!rows.length) return [];

  const headerIndex = findHeaderRow(rows);
  const fallbackHeaders = rows[0] || [];
  const headerRow = headerIndex >= 0 ? rows[headerIndex] : fallbackHeaders;
  const startIndex = headerIndex >= 0 ? headerIndex + 1 : 1;

  const headers = (headerRow || []).map((cell, index) => {
    const key = normalizeKey(normalizeValue(cell));
    return key || `column_${index + 1}`;
  });

  const storeMap = new Map<string, CoversheetStoreGroup>();

  for (let i = startIndex; i < rows.length; i += 1) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const entries = headers.reduce<Record<string, unknown>>((acc, key, idx) => {
      acc[key] = row[idx];
      return acc;
    }, {});

    const storeCode = getEntry(entries, STORE_CODE_KEYS);
    const storeName = getEntry(entries, STORE_NAME_KEYS);
    const employeeCode = getEntry(entries, EMPLOYEE_CODE_KEYS);

    let employeeName = getEntry(entries, EMPLOYEE_NAME_KEYS);
    if (!employeeName) {
      const firstName = getEntry(entries, FIRST_NAME_KEYS);
      const lastName = getEntry(entries, LAST_NAME_KEYS);
      employeeName = [firstName, lastName].filter(Boolean).join(" ").trim();
    }

    if (!storeCode && !storeName) continue;
    if (!employeeCode && !employeeName) continue;

    const cleanStoreCode = storeCode.trim();
    const cleanStoreName = storeName.trim() || "Unknown Store";
    const storeId = `${cleanStoreCode || "no-code"}__${cleanStoreName.toLowerCase()}`;

    if (!storeMap.has(storeId)) {
      storeMap.set(storeId, {
        id: storeId,
        storeCode: cleanStoreCode,
        storeName: cleanStoreName,
        employees: [],
      });
    }

    const statuses = collectStatuses(entries);
    const phone = getEntry(entries, PHONE_KEYS);
    const email = getEntry(entries, EMAIL_KEYS);
    const employeeId = `${storeId}__${(employeeCode || employeeName).toLowerCase()}`;
    const group = storeMap.get(storeId)!;
    const existingEmployee = group.employees.find((employee) => employee.id === employeeId);

    if (existingEmployee) {
      existingEmployee.statuses = Array.from(new Set([...existingEmployee.statuses, ...statuses]));
      if (!existingEmployee.phone && phone) existingEmployee.phone = phone;
      if (!existingEmployee.email && email) existingEmployee.email = email;
      continue;
    }

    group.employees.push({
      id: employeeId,
      employeeCode: employeeCode.trim(),
      employeeName: employeeName.trim() || employeeCode.trim(),
      phone: phone.trim(),
      email: email.trim(),
      statuses,
    });
  }

  return Array.from(storeMap.values())
    .map((store) => ({
      ...store,
      employees: [...store.employees].sort((a, b) => a.employeeName.localeCompare(b.employeeName) || a.employeeCode.localeCompare(b.employeeCode)),
    }))
    .sort((a, b) => {
      const left = `${a.storeCode} ${a.storeName}`.trim();
      const right = `${b.storeCode} ${b.storeName}`.trim();
      return left.localeCompare(right);
    });
}

export default function CoversheetHub({ mode }: CoversheetHubProps) {
  const [data, setData] = useState<CoversheetData | null>(null);
  const [isHydrating, setIsHydrating] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [expandedStoreIds, setExpandedStoreIds] = useState<Set<string>>(new Set());
  const [storeSearch, setStoreSearch] = useState("");
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const deferredStoreSearch = useDeferredValue(storeSearch);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const stored = await loadStoredCoversheetData();
        if (!mounted) return;
        setData(stored);
        setExpandedStoreIds(new Set());
      } finally {
        if (mounted) setIsHydrating(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const totals = useMemo(() => {
    const stores = data?.stores || [];
    let employees = 0;
    let terminated = 0;
    let maternity = 0;
    let hold = 0;

    stores.forEach((store) => {
      employees += store.employees.length;
      store.employees.forEach((employee) => {
        if (employee.statuses.includes("terminated")) terminated += 1;
        if (employee.statuses.includes("maternity")) maternity += 1;
        if (employee.statuses.includes("hold")) hold += 1;
      });
    });

    return { stores: stores.length, employees, terminated, maternity, hold };
  }, [data]);

  const toggleStore = (storeId: string) => {
    setExpandedStoreIds((previous) => {
      const next = new Set(previous);
      if (next.has(storeId)) next.delete(storeId);
      else next.add(storeId);
      return next;
    });
  };

  const handleUpload = async (file: File) => {
    setMessage("");
    setIsUploading(true);
    try {
      const stores = await parseWorkbook(file);
      if (stores.length === 0) {
        setMessage("No coversheet rows were found in this workbook.");
        return;
      }
      const nextData: CoversheetData = {
        fileName: file.name,
        uploadedAt: new Date().toISOString(),
        stores,
      };
      const employeeTotal = stores.reduce((sum, store) => sum + store.employees.length, 0);
      await saveStoredCoversheetData(nextData);
      setData(nextData);
      setExpandedStoreIds(new Set());
      setSelectedStoreId(null);
      setStoreSearch("");
      setMessage(`Imported ${employeeTotal} employee row(s) across ${stores.length} store(s).`);
    } catch (error) {
      setMessage(`Upload failed: ${error instanceof Error ? error.message : "Unknown workbook parse error."}`);
    } finally {
      setIsUploading(false);
    }
  };

  useEffect(() => {
    if (!selectedStoreId || !data?.stores?.length) return;
    const exists = data.stores.some((store) => store.id === selectedStoreId);
    if (!exists) setSelectedStoreId(null);
  }, [data, selectedStoreId]);

  const filteredStores = useMemo(() => {
    const stores = data?.stores || [];
    const searchQuery = normalizeValue(deferredStoreSearch).toLowerCase();
    const selectedFiltered = selectedStoreId ? stores.filter((store) => store.id === selectedStoreId) : stores;
    if (!searchQuery) return selectedFiltered;

    return selectedFiltered.filter((store) => {
      const storeLabel = `${store.storeCode} ${store.storeName}`.toLowerCase();
      if (storeLabel.includes(searchQuery)) return true;
      return store.employees.some((employee) =>
        [
          employee.employeeCode,
          employee.employeeName,
          employee.phone,
          employee.email,
          employee.statuses.join(" "),
        ]
          .join(" ")
          .toLowerCase()
          .includes(searchQuery)
      );
    });
  }, [data, deferredStoreSearch, selectedStoreId]);

  const storeSearchMatches = useMemo(() => {
    const stores = data?.stores || [];
    const searchQuery = normalizeValue(deferredStoreSearch).toLowerCase();
    if (!searchQuery || selectedStoreId) return [];
    return stores
      .filter((store) => `${store.storeCode} ${store.storeName}`.toLowerCase().includes(searchQuery))
      .slice(0, 8);
  }, [data, deferredStoreSearch, selectedStoreId]);

  const selectStore = (storeId: string) => {
    const match = data?.stores.find((store) => store.id === storeId);
    setSelectedStoreId(storeId);
    setExpandedStoreIds(new Set([storeId]));
    if (match) {
      setStoreSearch(`${match.storeCode ? `${match.storeCode} - ` : ""}${match.storeName}`);
    }
  };

  if (mode === "admin") {
    return (
      <div className="space-y-6">
        <Card className="rounded-2xl border-slate-700 bg-slate-900/50">
          <CardHeader>
            <CardTitle className="text-white">Coversheet Upload</CardTitle>
            <CardDescription className="text-slate-400">
              Upload your route list workbook to refresh the Coversheet section shown in the main menu.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => inputRef.current?.click()} disabled={isUploading}>
                <Upload className="mr-2 h-4 w-4" />
                {isUploading ? "Uploading..." : "Upload Coversheet Workbook"}
              </Button>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void handleUpload(file);
                  }
                  event.target.value = "";
                }}
              />
            </div>

            {data && (
              <div className="rounded-xl border border-slate-700 bg-slate-950/40 p-4 text-sm text-slate-300">
                <div className="font-medium text-white">{data.fileName}</div>
                <div className="text-xs text-slate-400">Uploaded {new Date(data.uploadedAt).toLocaleString("en-ZA")}</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-5">
                  <div className="rounded-lg border border-slate-700 px-3 py-2 text-center">
                    <div className="text-lg font-bold text-white">{totals.stores}</div>
                    <div className="text-xs text-slate-400">Stores</div>
                  </div>
                  <div className="rounded-lg border border-slate-700 px-3 py-2 text-center">
                    <div className="text-lg font-bold text-white">{totals.employees}</div>
                    <div className="text-xs text-slate-400">Employees</div>
                  </div>
                  <div className="rounded-lg border border-red-500/30 px-3 py-2 text-center">
                    <div className="text-lg font-bold text-red-400">{totals.terminated}</div>
                    <div className="text-xs text-slate-400">Terminated</div>
                  </div>
                  <div className="rounded-lg border border-blue-500/30 px-3 py-2 text-center">
                    <div className="text-lg font-bold text-blue-300">{totals.maternity}</div>
                    <div className="text-xs text-slate-400">Maternity</div>
                  </div>
                  <div className="rounded-lg border border-amber-500/30 px-3 py-2 text-center">
                    <div className="text-lg font-bold text-amber-300">{totals.hold}</div>
                    <div className="text-xs text-slate-400">Hold</div>
                  </div>
                </div>
              </div>
            )}

            {message && <div className="text-sm text-cyan-300">{message}</div>}
            {isHydrating && <div className="text-xs text-slate-400">Loading saved coversheet data...</div>}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isHydrating) {
    return (
      <Card className="rounded-2xl border-slate-700 bg-slate-900/50">
        <CardContent className="py-10 text-center text-slate-400">
          Loading coversheet data...
        </CardContent>
      </Card>
    );
  }

  if (!data || data.stores.length === 0) {
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
        <Badge className="bg-slate-700/40 text-slate-200 border border-slate-600">{totals.stores} stores</Badge>
        <Badge className="bg-slate-700/40 text-slate-200 border border-slate-600">{totals.employees} employees</Badge>
        <Badge className={statusBadgeClass("terminated")}>{totals.terminated} terminated</Badge>
        <Badge className={statusBadgeClass("maternity")}>{totals.maternity} maternity</Badge>
        <Badge className={statusBadgeClass("hold")}>{totals.hold} hold</Badge>
      </div>

      <Card className="rounded-2xl border-slate-700 bg-slate-900/50">
        <CardContent className="space-y-3 p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={storeSearch}
              onChange={(event) => {
                setStoreSearch(event.target.value);
                if (selectedStoreId) setSelectedStoreId(null);
              }}
              placeholder="Search stores, employee names, codes, phone, or email..."
              className="pl-10"
            />
          </div>

          {selectedStoreId && (
            <div className="flex items-center gap-2">
              <Badge className="border-cyan-500/40 bg-cyan-500/20 text-cyan-300">Store selected</Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectedStoreId(null);
                  setStoreSearch("");
                }}
              >
                Clear selection
              </Button>
            </div>
          )}

          {!selectedStoreId && storeSearchMatches.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {storeSearchMatches.map((store) => (
                <Button key={store.id} variant="outline" size="sm" onClick={() => selectStore(store.id)}>
                  {store.storeCode ? `${store.storeCode} - ` : ""}
                  {store.storeName}
                </Button>
              ))}
            </div>
          )}

          <div className="text-xs text-slate-400">
            Showing {filteredStores.length} of {data.stores.length} store(s)
          </div>
        </CardContent>
      </Card>

      {filteredStores.map((store) => {
        const expanded = expandedStoreIds.has(store.id);
        const storeLabel = `${store.storeCode ? `${store.storeCode} - ` : ""}${store.storeName}`.trim();
        return (
          <Card key={store.id} className="rounded-2xl border-slate-700 bg-slate-900/50">
            <CardContent className="p-0">
              <button
                onClick={() => toggleStore(store.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-800/40"
              >
                <div className="flex items-center gap-2">
                  {expanded ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                  <Store className="h-4 w-4 text-slate-300" />
                  <span className="font-semibold text-white">{storeLabel}</span>
                </div>
                <Badge className="bg-slate-700/50 text-slate-200 border border-slate-600">{store.employees.length}</Badge>
              </button>

              {expanded && (
                <div className="space-y-2 border-t border-slate-700/60 px-4 py-3">
                  {store.employees.map((employee) => (
                    <div key={employee.id} className="rounded-lg border border-slate-700/70 bg-slate-950/40 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <UserRound className="h-3.5 w-3.5 text-slate-400" />
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
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Mail className="h-3.5 w-3.5" />
                          <span>{employee.email || "-"}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {filteredStores.length === 0 && (
        <Card className="rounded-2xl border-slate-700 bg-slate-900/50">
          <CardContent className="py-8 text-center text-slate-400">No stores matched this search.</CardContent>
        </Card>
      )}
    </div>
  );
}
