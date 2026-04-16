import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { normalizeEmployeeCode, type Employee } from "@/services/database";
import { type ShiftRoster } from "@/services/shifts";

export type LeaveUploadBatch = {
  id: string;
  file_name: string;
  total_rows: number;
  applied_rows: number;
  unmatched_rows: number;
  created_at: string;
};

export type LeaveApplication = {
  id: string;
  upload_batch_id: string;
  row_number: number;
  representative_name: string;
  submitted_at: string;
  place: string;
  territory: string;
  raw_employee_code: string;
  raw_id_number: string;
  merchandiser_name: string;
  merchandiser_surname: string;
  leave_type: string;
  leave_days: number;
  leave_start_date: string;
  leave_end_date: string;
  form_link: string;
  comments: string;
  matched_employee_id: string;
  matched_employee_code: string;
  matched_by: "employee_code" | "id_number" | "";
  matched_roster_sheet_name: string;
  matched_roster_store_name: string;
  matched_roster_store_code: string;
  apply_status: "applied" | "unmatched";
  status_reason: string;
  source_file_name: string;
  created_at: string;
};

type ParsedLeaveRow = Omit<
  LeaveApplication,
  | "id"
  | "upload_batch_id"
  | "matched_employee_id"
  | "matched_employee_code"
  | "matched_by"
  | "matched_roster_sheet_name"
  | "matched_roster_store_name"
  | "matched_roster_store_code"
  | "apply_status"
  | "status_reason"
  | "created_at"
>;

type GetLeaveApplicationFilters = {
  uploadBatchId?: string;
  employeeCodes?: string[];
  startDate?: string;
  endDate?: string;
  status?: "applied" | "unmatched";
};

type RosterSource = {
  sheetName: string;
  storeName: string;
  storeCode: string;
};

const LEAVE_UPLOADS_STORAGE_KEY = "leave-upload-batches-cache-v1";
const LEAVE_APPLICATIONS_STORAGE_KEY = "leave-applications-cache-v1";
const LEAVE_REMOTE_SETUP_HINT =
  "Remote leave tables are not set up yet. Run setup-database.ps1 or the SQL in supabase-setup.sql to create the Supabase schema. Leave uploads are still being stored locally in this browser.";

let leaveRemoteSetupAvailable: boolean | null = null;
let leaveRemoteSetupCheck: Promise<boolean> | null = null;

function randomId() {
  return globalThis.crypto?.randomUUID?.() ?? `leave_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

function normalizeText(value: unknown) {
  return value === null || value === undefined ? "" : String(value).replace(/\s+/g, " ").trim();
}

function normalizeCompare(value: unknown) {
  return normalizeText(value).toLowerCase();
}

function normalizeMatchValue(value: unknown) {
   return normalizeText(value).replace(/\s+/g, "").toUpperCase();
 }

function isUsableMatchValue(value: unknown) {
   const normalized = normalizeMatchValue(value);
   return !!normalized && ![".", "-", "NA", "N/A", "NONE", "NULL"].includes(normalized);
}

function normalizeHeaderKey(value: unknown) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(value: string) {
   const [year, month, day] = String(value || "").split("-").map(Number);
   if (!year || !month || !day) return null;
   return new Date(year, month - 1, day);
 }

function normalizeLeaveDateRange(startDate: string, endDate: string) {
   const start = parseDateKey(startDate);
   const end = parseDateKey(endDate);

   if (!start || !end) {
     return { startDate, endDate };
   }

   if (end < start) {
     return {
       startDate: formatDateKey(end),
       endDate: formatDateKey(start),
     };
   }

   return { startDate, endDate };
}

function normalizeDateValue(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDateKey(value);
  }

  const raw = normalizeText(value);
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : formatDateKey(parsed);
}

function normalizeNumberValue(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeLeaveBatch(batch: LeaveUploadBatch): LeaveUploadBatch {
  return {
    ...batch,
    file_name: normalizeText(batch.file_name),
    total_rows: Number(batch.total_rows || 0),
    applied_rows: Number(batch.applied_rows || 0),
    unmatched_rows: Number(batch.unmatched_rows || 0),
    created_at: normalizeText(batch.created_at) || new Date().toISOString(),
  };
}

function normalizeLeaveApplication(application: LeaveApplication): LeaveApplication {
  return {
    ...application,
    representative_name: normalizeText(application.representative_name),
    submitted_at: normalizeText(application.submitted_at),
    place: normalizeText(application.place),
    territory: normalizeText(application.territory),
    raw_employee_code: normalizeMatchValue(application.raw_employee_code),
    raw_id_number: normalizeMatchValue(application.raw_id_number),
    merchandiser_name: normalizeText(application.merchandiser_name),
    merchandiser_surname: normalizeText(application.merchandiser_surname),
    leave_type: normalizeText(application.leave_type) || "Leave",
    leave_days: Number(application.leave_days || 0),
    leave_start_date: normalizeDateValue(application.leave_start_date),
    leave_end_date: normalizeDateValue(application.leave_end_date),
    form_link: normalizeText(application.form_link),
    comments: normalizeText(application.comments),
    matched_employee_id: normalizeText(application.matched_employee_id),
    matched_employee_code: normalizeEmployeeCode(application.matched_employee_code),
    matched_by: application.matched_by || "",
    matched_roster_sheet_name: normalizeText(application.matched_roster_sheet_name),
    matched_roster_store_name: normalizeText(application.matched_roster_store_name),
    matched_roster_store_code: normalizeText(application.matched_roster_store_code),
    apply_status: application.apply_status === "applied" ? "applied" : "unmatched",
    status_reason: normalizeText(application.status_reason),
    source_file_name: normalizeText(application.source_file_name),
    created_at: normalizeText(application.created_at) || new Date().toISOString(),
  };
}

function loadLocalLeaveUploads() {
  if (typeof window === "undefined") return [] as LeaveUploadBatch[];

  try {
    const raw = window.localStorage.getItem(LEAVE_UPLOADS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LeaveUploadBatch[];
    return Array.isArray(parsed) ? parsed.map(normalizeLeaveBatch) : [];
  } catch (error) {
    console.error("Load local leave uploads error:", error);
    return [];
  }
}

function saveLocalLeaveUploads(items: LeaveUploadBatch[]) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(LEAVE_UPLOADS_STORAGE_KEY, JSON.stringify(items.map(normalizeLeaveBatch)));
  } catch (error) {
    console.error("Save local leave uploads error:", error);
  }
}

function loadLocalLeaveApplications() {
  if (typeof window === "undefined") return [] as LeaveApplication[];

  try {
    const raw = window.localStorage.getItem(LEAVE_APPLICATIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LeaveApplication[];
    return Array.isArray(parsed) ? parsed.map(normalizeLeaveApplication) : [];
  } catch (error) {
    console.error("Load local leave applications error:", error);
    return [];
  }
}

function saveLocalLeaveApplications(items: LeaveApplication[]) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(LEAVE_APPLICATIONS_STORAGE_KEY, JSON.stringify(items.map(normalizeLeaveApplication)));
  } catch (error) {
    console.error("Save local leave applications error:", error);
  }
}

async function checkRemoteLeaveTablesAvailability() {
  if (leaveRemoteSetupAvailable !== null) {
    return leaveRemoteSetupAvailable;
  }

  if (leaveRemoteSetupCheck) {
    return leaveRemoteSetupCheck;
  }

  leaveRemoteSetupCheck = (async () => {
    try {
      const [{ error: uploadsError }, { error: applicationsError }] = await Promise.all([
        supabase.from("leave_upload_batches").select("id").limit(1),
        supabase.from("leave_applications").select("id").limit(1),
      ]);
      leaveRemoteSetupAvailable = !uploadsError && !applicationsError;
      return leaveRemoteSetupAvailable;
    } catch {
      leaveRemoteSetupAvailable = false;
      return false;
    } finally {
      leaveRemoteSetupCheck = null;
    }
  })();

  return leaveRemoteSetupCheck;
}

function mergeLeaveUploads(...collections: LeaveUploadBatch[][]) {
  const map = new Map<string, LeaveUploadBatch>();

  collections.flat().forEach((item) => {
    const normalized = normalizeLeaveBatch(item);
    map.set(normalized.id, normalized);
  });

  return Array.from(map.values()).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function mergeLeaveApplications(...collections: LeaveApplication[][]) {
  const map = new Map<string, LeaveApplication>();

  collections.flat().forEach((item) => {
    const normalized = normalizeLeaveApplication(item);
    map.set(normalized.id, normalized);
  });

  return Array.from(map.values()).sort(
    (a, b) =>
      b.created_at.localeCompare(a.created_at) ||
      a.leave_start_date.localeCompare(b.leave_start_date) ||
      a.matched_employee_code.localeCompare(b.matched_employee_code)
  );
}

function getLeaveStorageErrorMessage(error: unknown) {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message || "")
      : error instanceof Error
        ? error.message
        : String(error || "");

  if (message.includes("Could not find the table 'public.leave_upload_batches' in the schema cache")) {
    return LEAVE_REMOTE_SETUP_HINT;
  }
  if (message.includes('relation "public.leave_upload_batches" does not exist') || message.includes('relation "leave_upload_batches" does not exist')) {
    return LEAVE_REMOTE_SETUP_HINT;
  }
  if (message.includes("Could not find the function public.exec")) {
    return LEAVE_REMOTE_SETUP_HINT;
  }
  return message;
}

function buildRosterSources(rosters: ShiftRoster[]) {
  const sources = new Map<string, RosterSource[]>();

  rosters.forEach((roster) => {
    const seen = new Set<string>();

    roster.rows.forEach((row) => {
      const employeeCode = normalizeEmployeeCode(row.employee_code);
      if (!employeeCode || seen.has(employeeCode)) return;
      seen.add(employeeCode);

      if (!sources.has(employeeCode)) sources.set(employeeCode, []);
      sources.get(employeeCode)!.push({
        sheetName: roster.sheet_name,
        storeName: roster.store_name || roster.sheet_name,
        storeCode: roster.store_code || "",
      });
    });
  });

  return sources;
}

function matchRosterSource(employee: Employee, sources: RosterSource[]) {
  const employeeStoreCode = normalizeCompare(employee.store_code);
  const employeeStore = normalizeCompare(employee.store);

  return (
    sources.find((source) => employeeStoreCode && normalizeCompare(source.storeCode) === employeeStoreCode) ||
    sources.find((source) => employeeStore && normalizeCompare(source.storeName) === employeeStore) ||
    sources[0] ||
    null
  );
}

function buildEmployeeMaps(employees: Employee[]) {
  const byCode = new Map<string, Employee>();
  const byId = new Map<string, Employee>();

  employees.forEach((employee) => {
    const code = normalizeEmployeeCode(employee.employee_code);
    const idNumber = normalizeMatchValue(employee.id_number);
    if (code && !byCode.has(code)) byCode.set(code, employee);
    if (idNumber && !byId.has(idNumber)) byId.set(idNumber, employee);
  });

  return { byCode, byId };
}

function rowLooksEmpty(row: Record<string, unknown>) {
  return Object.values(row).every((value) => normalizeText(value) === "");
}

function toNormalizedEntries(row: Record<string, unknown>) {
  return Object.entries(row).reduce<Record<string, unknown>>((acc, [key, value]) => {
    acc[normalizeHeaderKey(key)] = value;
    return acc;
  }, {});
}

function findHeaderRowIndex(rows: unknown[][]) {
  return rows.findIndex((row) => {
    const keys = row.map((cell) => normalizeHeaderKey(cell));
    const hasEmployee = keys.some((key) => key.includes("employee_number"));
    const hasStartDate = keys.some((key) => key.includes("start_date") || key.includes("merchandisers_leave"));
    const hasEndDate = keys.some((key) => key.includes("end_date") || key.includes("merchandisers_leave"));
    const hasLeaveType = keys.some((key) => key.includes("leave_taken") || key.includes("leave_type"));
    return hasEmployee && hasStartDate && hasEndDate && hasLeaveType;
  });
}

function getEntry(entries: Record<string, unknown>, aliases: string[]) {
  for (const alias of aliases) {
    const direct = entries[alias];
    if (direct !== undefined && normalizeText(direct) !== "") return direct;
  }

  const entryKeys = Object.keys(entries);
  for (const alias of aliases) {
    const fuzzy = entryKeys.find((key) => key.includes(alias));
    if (fuzzy && normalizeText(entries[fuzzy]) !== "") return entries[fuzzy];
  }

  return "";
}

function parseLeaveRowsFromSheet(sheet: XLSX.WorkSheet, sourceFileName: string) {
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true });
  const headerRowIndex = findHeaderRowIndex(rawRows);
  if (headerRowIndex < 0) return [] as ParsedLeaveRow[];

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: true,
    range: headerRowIndex,
  });

  return rows
    .map((row, index) => {
      if (rowLooksEmpty(row)) return null;
      const entries = toNormalizedEntries(row);

      const leaveStartDate = normalizeDateValue(
        getEntry(entries, [
          "what_is_the_start_date_for_merchandisers_leave",
          "start_date",
          "leave_start_date",
          "start_date_for_merchandisers_leave",
        ])
      );
       const leaveEndDate = normalizeDateValue(
         getEntry(entries, [
           "what_is_the_end_date_for_the_merchandisers_leave",
           "end_date",
           "leave_end_date",
           "end_date_for_merchandisers_leave",
         ])
       );
 
       if (!leaveStartDate || !leaveEndDate) return null;
       const normalizedRange = normalizeLeaveDateRange(leaveStartDate, leaveEndDate);
 
       return {
         row_number: headerRowIndex + index + 2,
         representative_name: normalizeText(getEntry(entries, ["representative_name", "rep_name"])),
         submitted_at: normalizeText(getEntry(entries, ["date", "submitted_at", "submission_date"])),
         place: normalizeText(getEntry(entries, ["place", "store", "branch"])),
         territory: normalizeText(getEntry(entries, ["territory", "region", "area"])),
         raw_employee_code: isUsableMatchValue(getEntry(entries, ["employee_number", "employee_code", "emp_no", "staff_number"]))
           ? normalizeMatchValue(getEntry(entries, ["employee_number", "employee_code", "emp_no", "staff_number"]))
           : "",
         raw_id_number: isUsableMatchValue(getEntry(entries, ["employee_id_number", "id_number", "national_id", "sa_id"]))
           ? normalizeMatchValue(getEntry(entries, ["employee_id_number", "id_number", "national_id", "sa_id"]))
           : "",
         merchandiser_name: normalizeText(getEntry(entries, ["merchandiser_name", "employee_name", "first_name", "name"])),
         merchandiser_surname: normalizeText(getEntry(entries, ["merchandiser_surname", "employee_surname", "last_name", "surname"])),
         leave_type: normalizeText(getEntry(entries, ["type_of_leave_taken", "leave_type", "type_of_leave"])) || "Leave",
         leave_days: normalizeNumberValue(getEntry(entries, ["number_of_days", "number_of_days_", "days", "leave_days"])),
         leave_start_date: normalizedRange.startDate,
         leave_end_date: normalizedRange.endDate,
         form_link: normalizeText(getEntry(entries, ["link_to_form", "form_link", "link"])),
         comments: normalizeText(getEntry(entries, ["comments", "comment", "notes", "reason"])),
         source_file_name: sourceFileName,
       } satisfies ParsedLeaveRow;
    })
    .filter(Boolean) as ParsedLeaveRow[];
}

export function parseLeaveWorkbook(buffer: ArrayBuffer, sourceFileName: string): ParsedLeaveRow[] {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true, raw: true });
  return workbook.SheetNames.flatMap((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return [] as ParsedLeaveRow[];
    return parseLeaveRowsFromSheet(sheet, sourceFileName);
  });
}

export async function initializeLeaveDatabase(): Promise<boolean> {
  try {
    const isAvailable = await checkRemoteLeaveTablesAvailability();
    if (!isAvailable) {
      console.warn("Leave database initialization warning:", LEAVE_REMOTE_SETUP_HINT);
    }
    return isAvailable;
  } catch (error) {
    console.warn("Leave database initialization warning:", getLeaveStorageErrorMessage(error));
    return false;
  }
}

export async function getLeaveUploads() {
  const localUploads = loadLocalLeaveUploads();

  try {
    // Reset schema cache by forcing a fresh query
    const { data, error } = await supabase
      .from("leave_upload_batches")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("Get leave uploads warning:", getLeaveStorageErrorMessage(error));
      return localUploads;
    }

    const merged = mergeLeaveUploads(localUploads, (data || []).map((item) => normalizeLeaveBatch(item as LeaveUploadBatch)));
    saveLocalLeaveUploads(merged);
    return merged;
  } catch (error) {
    console.warn("Get leave uploads warning:", getLeaveStorageErrorMessage(error));
    return localUploads;
  }
}

function applicationOverlapsRange(application: LeaveApplication, startDate?: string, endDate?: string) {
  if (startDate && application.leave_end_date < startDate) return false;
  if (endDate && application.leave_start_date > endDate) return false;
  return true;
}

export async function getLeaveApplications(filters?: GetLeaveApplicationFilters) {
  const localApplications = loadLocalLeaveApplications();
  const normalizedEmployeeCodes = filters?.employeeCodes?.map((code) => normalizeEmployeeCode(code)).filter(Boolean) || [];

  const applyFilters = (items: LeaveApplication[]) =>
    items.filter((item) => {
      const matchesUpload = !filters?.uploadBatchId || item.upload_batch_id === filters.uploadBatchId;
      const matchesStatus = !filters?.status || item.apply_status === filters.status;
      const matchesEmployee =
        normalizedEmployeeCodes.length === 0 || normalizedEmployeeCodes.includes(normalizeEmployeeCode(item.matched_employee_code));
      const matchesRange = applicationOverlapsRange(item, filters?.startDate, filters?.endDate);
      return matchesUpload && matchesStatus && matchesEmployee && matchesRange;
    });

  try {
    // Force schema refresh by using raw query first
    await supabase.from("leave_applications").select("id").limit(1);
    
    let query = supabase.from("leave_applications").select("*").order("created_at", { ascending: false });

    if (filters?.uploadBatchId) query = query.eq("upload_batch_id", filters.uploadBatchId);
    if (filters?.status) query = query.eq("apply_status", filters.status);
    if (filters?.startDate) query = query.lte("leave_start_date", filters.endDate || "9999-12-31");
    if (filters?.endDate) query = query.gte("leave_end_date", filters.startDate || "0001-01-01");
    if (normalizedEmployeeCodes.length > 0) query = query.in("matched_employee_code", normalizedEmployeeCodes);

    const { data, error } = await query;
    if (error) {
      console.warn("Get leave applications warning:", getLeaveStorageErrorMessage(error));
      return applyFilters(localApplications);
    }

    const merged = mergeLeaveApplications(localApplications, (data || []).map((item) => normalizeLeaveApplication(item as LeaveApplication)));
    saveLocalLeaveApplications(merged);
    return applyFilters(merged);
  } catch (error) {
    console.warn("Get leave applications warning:", getLeaveStorageErrorMessage(error));
    return applyFilters(localApplications);
  }
}

export async function getAppliedLeaveApplications(filters?: Omit<GetLeaveApplicationFilters, "status">) {
  return getLeaveApplications({ ...filters, status: "applied" });
}

export function expandLeaveDateRange(startDate: string, endDate: string) {
  const start = parseDateKey(startDate);
  const end = parseDateKey(endDate);
  if (!start || !end || start > end) return [] as string[];

  const dates: string[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    dates.push(formatDateKey(cursor));
  }
  return dates;
}

function setLatestLeaveLookup(
  map: Map<string, LeaveApplication>,
  key: string,
  application: LeaveApplication
) {
  const existing = map.get(key);
  if (!existing || application.created_at >= existing.created_at) {
    map.set(key, application);
  }
}

export function getSheetScopedLeaveLookupKey(sheetName: string, employeeCode: string, dateKey: string) {
  return `${normalizeCompare(sheetName) || "*"}__${normalizeEmployeeCode(employeeCode)}__${dateKey}`;
}

export function getFallbackLeaveLookupKey(employeeCode: string, dateKey: string) {
  return `*__${normalizeEmployeeCode(employeeCode)}__${dateKey}`;
}

export function buildAppliedLeaveLookup(applications: LeaveApplication[]) {
  const lookup = new Map<string, LeaveApplication>();

  applications
    .filter((application) => application.apply_status === "applied" && application.matched_employee_code)
    .forEach((application) => {
      expandLeaveDateRange(application.leave_start_date, application.leave_end_date).forEach((dateKey) => {
        if (application.matched_roster_sheet_name) {
          setLatestLeaveLookup(
            lookup,
            getSheetScopedLeaveLookupKey(application.matched_roster_sheet_name, application.matched_employee_code, dateKey),
            application
          );
        }

        setLatestLeaveLookup(lookup, getFallbackLeaveLookupKey(application.matched_employee_code, dateKey), application);
      });
    });

  return lookup;
}

export async function importLeaveApplications(
  parsedRows: ParsedLeaveRow[],
  fileName: string,
  employees: Employee[],
  rosters: ShiftRoster[]
) {
  const createdAt = new Date().toISOString();
  const uploadBatchId = randomId();
  const { byCode, byId } = buildEmployeeMaps(employees);
  const rosterSources = buildRosterSources(rosters);

   const applications = parsedRows.map((row) => {
     const employeeByCode = row.raw_employee_code ? byCode.get(normalizeEmployeeCode(row.raw_employee_code)) || null : null;
     const employeeById = !employeeByCode && row.raw_id_number ? byId.get(normalizeMatchValue(row.raw_id_number)) || null : null;
     const matchedEmployee = employeeByCode || employeeById || null;
     const matchedBy = employeeByCode ? "employee_code" : employeeById ? "id_number" : "";
     const matchedRoster = matchedEmployee ? matchRosterSource(matchedEmployee, rosterSources.get(normalizeEmployeeCode(matchedEmployee.employee_code)) || []) : null;

     const applyStatus: LeaveApplication["apply_status"] = matchedEmployee ? "applied" : "unmatched";
     const statusReason = matchedEmployee
       ? matchedRoster
         ? `Applied to ${matchedRoster.storeName || matchedRoster.sheetName}`
         : "Matched employee profile by employee code or ID number and applied using fallback employee matching"
       : row.raw_employee_code || row.raw_id_number
         ? "No employee profile matched by employee code or ID number"
         : "The leave row did not include a usable employee code or ID number";

     return normalizeLeaveApplication({
       id: randomId(),
       upload_batch_id: uploadBatchId,
       row_number: row.row_number,
       representative_name: row.representative_name,
       submitted_at: row.submitted_at,
       place: row.place,
       territory: row.territory,
       raw_employee_code: row.raw_employee_code,
       raw_id_number: row.raw_id_number,
       merchandiser_name: row.merchandiser_name,
       merchandiser_surname: row.merchandiser_surname,
       leave_type: row.leave_type,
       leave_days: row.leave_days,
       leave_start_date: row.leave_start_date,
       leave_end_date: row.leave_end_date,
       form_link: row.form_link,
       comments: row.comments,
       matched_employee_id: matchedEmployee?.id || "",
       matched_employee_code: matchedEmployee?.employee_code || "",
       matched_by: matchedBy,
       matched_roster_sheet_name: matchedRoster?.sheetName || "",
       matched_roster_store_name: matchedRoster?.storeName || "",
       matched_roster_store_code: matchedRoster?.storeCode || "",
       apply_status: applyStatus,
       status_reason: statusReason,
       source_file_name: fileName,
       created_at: createdAt,
     });
   });

  const uploadBatch = normalizeLeaveBatch({
    id: uploadBatchId,
    file_name: fileName,
    total_rows: applications.length,
    applied_rows: applications.filter((item) => item.apply_status === "applied").length,
    unmatched_rows: applications.filter((item) => item.apply_status !== "applied").length,
    created_at: createdAt,
  });

  const mergedUploads = mergeLeaveUploads(loadLocalLeaveUploads(), [uploadBatch]);
  const mergedApplications = mergeLeaveApplications(loadLocalLeaveApplications(), applications);
  saveLocalLeaveUploads(mergedUploads);
  saveLocalLeaveApplications(mergedApplications);

  try {
    const { error: uploadError } = await supabase.from("leave_upload_batches").insert(uploadBatch);
    if (uploadError) {
      const message = getLeaveStorageErrorMessage(uploadError);
      console.warn("Import leave upload warning:", message);
      return { success: true, batch: uploadBatch, applications, error: message };
    }

    const { error: applicationsError } = await supabase.from("leave_applications").insert(
      applications.map((item) => ({
        id: item.id,
        upload_batch_id: item.upload_batch_id,
        representative_name: item.representative_name || '',
        submitted_at: item.submitted_at || '',
        place: item.place || '',
        territory: item.territory || '',
        raw_employee_code: item.raw_employee_code || '',
        raw_id_number: item.raw_id_number || '',
        merchandiser_name: item.merchandiser_name || '',
        merchandiser_surname: item.merchandiser_surname || '',
        leave_type: item.leave_type || '',
        leave_days: item.leave_days || 0,
        leave_start_date: item.leave_start_date,
        leave_end_date: item.leave_end_date,
        form_link: item.form_link || '',
        comments: item.comments || '',
        matched_employee_id: item.matched_employee_id || '',
        matched_employee_code: item.matched_employee_code || '',
        matched_by: item.matched_by || '',
        matched_roster_sheet_name: item.matched_roster_sheet_name || '',
        matched_roster_store_name: item.matched_roster_store_name || '',
        matched_roster_store_code: item.matched_roster_store_code || '',
        apply_status: item.apply_status || 'unmatched',
        status_reason: item.status_reason || '',
        source_file_name: item.source_file_name || '',
        created_at: item.created_at,
      }))
    );

    if (applicationsError) {
      const message = getLeaveStorageErrorMessage(applicationsError);
      console.warn("Import leave applications warning:", message);
      return { success: true, batch: uploadBatch, applications, error: message };
    }

    return { success: true, batch: uploadBatch, applications };
  } catch (error) {
    const message = getLeaveStorageErrorMessage(error);
    console.warn("Import leave applications warning:", message);
    return { success: true, batch: uploadBatch, applications, error: message };
  }
}

export async function deleteLeaveUpload(uploadId: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Delete applications first
    const { error: appsError } = await supabase.from("leave_applications").delete().eq("upload_batch_id", uploadId);
    // Then delete the batch
    const { error } = await supabase.from("leave_upload_batches").delete().eq("id", uploadId);
    if (error) {
      const message = getLeaveStorageErrorMessage(error);
      return { success: false, error: message };
    }
    // Also delete from local storage
    const localUploads = loadLocalLeaveUploads();
    const localApplications = loadLocalLeaveApplications();
    saveLocalLeaveUploads(localUploads.filter((u) => u.id !== uploadId));
    saveLocalLeaveApplications(localApplications.filter((a) => a.upload_batch_id !== uploadId));
    return { success: true };
  } catch (error) {
    return { success: false, error: getLeaveStorageErrorMessage(error) };
  }
}

export async function deleteLeaveApplication(applicationId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase.from("leave_applications").delete().eq("id", applicationId);
    if (error) {
      const message = getLeaveStorageErrorMessage(error);
      console.warn("Delete leave application warning:", message);
      return { success: false, error: message };
    }
    // Also delete from local storage
    const localApplications = loadLocalLeaveApplications();
    saveLocalLeaveApplications(localApplications.filter((a) => a.id !== applicationId));
    return { success: true };
  } catch (error) {
    return { success: false, error: getLeaveStorageErrorMessage(error) };
  }
}

export async function deleteLeaveByDateRange(startDate: string, endDate: string): Promise<{ success: boolean; error?: string; deletedCount?: number }> {
  try {
    // Delete from Supabase - applications within date range
    const { data: appsToDelete, error: fetchError } = await supabase
      .from("leave_applications")
      .select("id, upload_batch_id")
      .lte("leave_start_date", endDate)
      .gte("leave_end_date", startDate);

    if (fetchError) {
      console.warn("Fetch leave for delete warning:", getLeaveStorageErrorMessage(fetchError));
    }

    const deletedAppIds = (appsToDelete || []).map(a => a.id);
    const uploadBatchIds = [...new Set((appsToDelete || []).map(a => a.upload_batch_id))];

    // Delete applications
    if (deletedAppIds.length > 0) {
      await supabase.from("leave_applications").delete().in("id", deletedAppIds);
    }

    // Delete empty upload batches
    for (const batchId of uploadBatchIds) {
      const { data: remaining } = await supabase
        .from("leave_applications")
        .select("id", { count: 'exact', head: true })
        .eq("upload_batch_id", batchId);
      
      if (!remaining || remaining.length === 0) {
        await supabase.from("leave_upload_batches").delete().eq("id", batchId);
      }
    }

    // Also delete from local storage - applications in date range
    const localApplications = loadLocalLeaveApplications();
    const localUploads = loadLocalLeaveUploads();
    const filteredApps = localApplications.filter(a => 
      a.leave_start_date <= endDate && a.leave_end_date >= startDate
    );
    const affectedBatchIds = [...new Set(filteredApps.map(a => a.upload_batch_id))];
    const remainingApps = localApplications.filter(a => 
      !(a.leave_start_date <= endDate && a.leave_end_date >= startDate)
    );
    saveLocalLeaveApplications(remainingApps);

    // Remove empty batches from local
    const remainingBatches = localUploads.filter(b => {
      const hasRemaining = remainingApps.some(a => a.upload_batch_id === b.id);
      return hasRemaining || !affectedBatchIds.includes(b.id);
    });
    saveLocalLeaveUploads(remainingBatches);

    return { success: true, deletedCount: deletedAppIds.length };
  } catch (error) {
    return { success: false, error: getLeaveStorageErrorMessage(error) };
  }
}
