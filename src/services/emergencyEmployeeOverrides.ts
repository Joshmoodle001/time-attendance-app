import { normalizeEmployeeCode, type EmployeeInput } from "@/services/database";

const EMERGENCY_OVERRIDE_DB_NAME = "time-attendance-emergency-employee-overrides-db";
const EMERGENCY_OVERRIDE_DB_VERSION = 1;
const EMERGENCY_OVERRIDE_DB_STORE = "employee_overrides";

type StoredEmergencyEmployeeOverride = EmployeeInput & {
  employee_code: string;
};

function openEmergencyOverrideDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const request = window.indexedDB.open(EMERGENCY_OVERRIDE_DB_NAME, EMERGENCY_OVERRIDE_DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(EMERGENCY_OVERRIDE_DB_STORE)) {
        database.createObjectStore(EMERGENCY_OVERRIDE_DB_STORE, { keyPath: "employee_code" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      console.error("Open emergency override IndexedDB error:", request.error);
      resolve(null);
    };
  });
}

function normalizeOverride(employee: EmployeeInput): StoredEmergencyEmployeeOverride {
  return {
    ...employee,
    employee_code: normalizeEmployeeCode(employee.employee_code),
  };
}

export async function getEmergencyEmployeeOverrideMap() {
  const database = await openEmergencyOverrideDb();
  if (!database) return new Map<string, EmployeeInput>();

  return new Promise<Map<string, EmployeeInput>>((resolve) => {
    const transaction = database.transaction(EMERGENCY_OVERRIDE_DB_STORE, "readonly");
    const store = transaction.objectStore(EMERGENCY_OVERRIDE_DB_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      const map = new Map<string, EmployeeInput>();
      const records = Array.isArray(request.result) ? (request.result as StoredEmergencyEmployeeOverride[]) : [];
      records.forEach((record) => {
        map.set(normalizeEmployeeCode(record.employee_code), record);
      });
      resolve(map);
    };
    request.onerror = () => {
      console.error("Read emergency override IndexedDB error:", request.error);
      resolve(new Map<string, EmployeeInput>());
    };
  });
}

export async function upsertEmergencyEmployeeOverrides(employees: EmployeeInput[]) {
  const database = await openEmergencyOverrideDb();
  if (!database) return false;

  return new Promise<boolean>((resolve) => {
    const transaction = database.transaction(EMERGENCY_OVERRIDE_DB_STORE, "readwrite");
    const store = transaction.objectStore(EMERGENCY_OVERRIDE_DB_STORE);

    employees
      .filter((employee) => normalizeEmployeeCode(employee.employee_code))
      .forEach((employee) => store.put(normalizeOverride(employee)));

    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => {
      console.error("Write emergency override IndexedDB error:", transaction.error);
      resolve(false);
    };
  });
}
