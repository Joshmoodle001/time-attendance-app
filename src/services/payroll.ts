export type PayrollSettings = {
  hourlyRate: number;
  updatedAt: string;
};

export type PayrollSaveResult = {
  settings: PayrollSettings;
  persisted: boolean;
};

export const DEFAULT_PAYROLL_HOURLY_RATE = 30.23;
export const PAYROLL_SETTINGS_STORAGE_KEY = "payroll-settings-v1";

const PAYROLL_SETTINGS_EVENT = "payroll-settings-updated";

let memoryPayrollSettings: PayrollSettings = {
  hourlyRate: DEFAULT_PAYROLL_HOURLY_RATE,
  updatedAt: "",
};

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function normalizeRate(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PAYROLL_HOURLY_RATE;
  return Number(parsed.toFixed(2));
}

function normalizePayrollSettings(value: unknown): PayrollSettings {
  const raw = value && typeof value === "object" ? (value as Partial<PayrollSettings>) : {};
  return {
    hourlyRate: normalizeRate(raw.hourlyRate),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
  };
}

function savePayrollSettingsToStorage(settings: PayrollSettings) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(PAYROLL_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

export function loadPayrollSettings(): PayrollSettings {
  if (!canUseStorage()) return memoryPayrollSettings;

  try {
    const raw = window.localStorage.getItem(PAYROLL_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return memoryPayrollSettings;
    }

    const settings = normalizePayrollSettings(JSON.parse(raw));
    memoryPayrollSettings = settings;
    return settings;
  } catch {
    return memoryPayrollSettings;
  }
}

export function savePayrollSettings(hourlyRate: number): PayrollSaveResult {
  const settings: PayrollSettings = {
    hourlyRate: normalizeRate(hourlyRate),
    updatedAt: new Date().toISOString(),
  };
  memoryPayrollSettings = settings;

  let persisted = true;
  try {
    savePayrollSettingsToStorage(settings);
  } catch {
    persisted = false;
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PAYROLL_SETTINGS_EVENT));
  }

  return { settings, persisted };
}

export function resetPayrollSettings() {
  return savePayrollSettings(DEFAULT_PAYROLL_HOURLY_RATE);
}

export function subscribePayrollSettings(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;

  window.addEventListener(PAYROLL_SETTINGS_EVENT, listener);
  return () => window.removeEventListener(PAYROLL_SETTINGS_EVENT, listener);
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}
