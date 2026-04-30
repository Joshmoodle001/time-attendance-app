import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { normalizeEmployeeCode } from "@/services/database";

export type HolidayPlannerEntry = {
  employeeCode: string;
  dateKey: string;
};

export type HolidayPlannerData = {
  fileName: string;
  uploadedAt: string;
  entries: HolidayPlannerEntry[];
};

const STORAGE_KEY = "holiday-planner-v1";
const REMOTE_ROW_ID = "holiday_planner_data";

function normalizeDateKey(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeHolidayPlannerData(value: unknown): HolidayPlannerData | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<HolidayPlannerData>;
  if (!Array.isArray(raw.entries)) return null;
  return {
    fileName: typeof raw.fileName === "string" ? raw.fileName : "",
    uploadedAt: typeof raw.uploadedAt === "string" ? raw.uploadedAt : "",
    entries: raw.entries
      .map((entry) => ({
        employeeCode: normalizeEmployeeCode((entry as Partial<HolidayPlannerEntry>)?.employeeCode),
        dateKey: normalizeDateKey((entry as Partial<HolidayPlannerEntry>)?.dateKey),
      }))
      .filter((entry) => entry.employeeCode && entry.dateKey),
  };
}

function readLocalHolidayPlannerData() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeHolidayPlannerData(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeLocalHolidayPlannerData(data: HolidayPlannerData) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

async function loadRemoteHolidayPlannerData() {
  if (!isSupabaseConfigured) return null;
  try {
    const { data, error } = await supabase
      .from("shift_sync_settings")
      .select("payload")
      .eq("id", REMOTE_ROW_ID)
      .maybeSingle();

    if (error) return null;
    return normalizeHolidayPlannerData(data?.payload);
  } catch {
    return null;
  }
}

async function saveRemoteHolidayPlannerData(data: HolidayPlannerData) {
  if (!isSupabaseConfigured) return false;
  try {
    const { error } = await supabase.from("shift_sync_settings").upsert(
      {
        id: REMOTE_ROW_ID,
        auto_sync_enabled: false,
        last_universal_synced_at: null,
        last_universal_status: "holiday_planner_data",
        payload: data,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );
    return !error;
  } catch {
    return false;
  }
}

export async function loadStoredHolidayPlannerData(): Promise<HolidayPlannerData | null> {
  const remote = await loadRemoteHolidayPlannerData();
  if (remote) {
    writeLocalHolidayPlannerData(remote);
    return remote;
  }

  return readLocalHolidayPlannerData();
}

export async function saveStoredHolidayPlannerData(data: HolidayPlannerData) {
  writeLocalHolidayPlannerData(data);
  const remoteSaved = await saveRemoteHolidayPlannerData(data);
  if (!remoteSaved && typeof window === "undefined") {
    throw new Error("Holiday planner data could not be stored.");
  }
}
