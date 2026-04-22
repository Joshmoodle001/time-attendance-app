import { supabase } from '@/lib/supabase'

export interface AttendanceRecord {
  id: string
  employee_code: string
  name: string
  region: string
  region_code: string
  store: string
  store_code: string
  scheduled: boolean
  at_work: boolean
  leave: boolean
  day_off: boolean
  problem: boolean
  clock_count?: number
  first_clock?: string
  last_clock?: string
  status_label?: string
  clockings?: string[]
  upload_date: string
  created_at: string
}

const ATTENDANCE_STORAGE_KEY = 'attendance-records-cache-v1'
const ATTENDANCE_REMOTE_SETUP_HINT =
  'Remote attendance tables are not set up yet. Run setup-database.ps1 or the SQL in supabase-setup.sql to create the Supabase schema. Attendance is still being stored locally in this browser.'

let attendanceRemoteSetupAvailable: boolean | null = null
let attendanceRemoteSetupCheck: Promise<boolean> | null = null

function buildAttendanceRecordKey(record: Pick<AttendanceRecord, 'employee_code' | 'upload_date' | 'store_code' | 'store' | 'name'>) {
  const employeeKey = String(record.employee_code || record.name || 'unknown').trim().toLowerCase()
  const storeKey = String(record.store_code || record.store || '').trim().toLowerCase()
  return `${record.upload_date}__${employeeKey}__${storeKey}`
}

function normalizeAttendanceRecord(record: AttendanceRecord): AttendanceRecord {
  return {
    ...record,
    scheduled: Boolean(record.scheduled),
    at_work: Boolean(record.at_work),
    leave: Boolean(record.leave),
    day_off: Boolean(record.day_off),
    problem: Boolean(record.problem),
    clock_count: record.clock_count || 0,
    first_clock: record.first_clock || '',
    last_clock: record.last_clock || '',
    status_label: record.status_label || '',
    clockings: Array.isArray(record.clockings) ? record.clockings.filter(Boolean) : [],
  }
}

function toLocalAttendanceRecord(record: Omit<AttendanceRecord, 'id' | 'created_at'>): AttendanceRecord {
  return normalizeAttendanceRecord({
    id: buildAttendanceRecordKey({
      employee_code: record.employee_code,
      upload_date: record.upload_date,
      store_code: record.store_code,
      store: record.store,
      name: record.name,
    }),
    created_at: new Date().toISOString(),
    ...record,
  })
}

function mergeAttendanceCollections(...collections: AttendanceRecord[][]) {
  const map = new Map<string, AttendanceRecord>()

  collections
    .flat()
    .forEach((record) => {
      const normalized = normalizeAttendanceRecord(record)
      map.set(buildAttendanceRecordKey(normalized), normalized)
    })

  return Array.from(map.values()).sort((a, b) =>
    a.upload_date.localeCompare(b.upload_date) ||
    a.store.localeCompare(b.store) ||
    a.name.localeCompare(b.name) ||
    a.employee_code.localeCompare(b.employee_code)
  )
}

function loadLocalAttendanceRecords(): AttendanceRecord[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(ATTENDANCE_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as AttendanceRecord[]
    return Array.isArray(parsed) ? parsed.map(normalizeAttendanceRecord) : []
  } catch (error) {
    console.error('Load local attendance error:', error)
    return []
  }
}

function saveLocalAttendanceRecords(records: AttendanceRecord[]) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(ATTENDANCE_STORAGE_KEY, JSON.stringify(records.map(normalizeAttendanceRecord)))
  } catch (error) {
    console.error('Save local attendance error:', error)
  }
}

function upsertLocalAttendanceRecords(records: Omit<AttendanceRecord, 'id' | 'created_at'>[]) {
  const next = mergeAttendanceCollections(loadLocalAttendanceRecords(), records.map(toLocalAttendanceRecord))
  saveLocalAttendanceRecords(next)
  return next
}

async function checkRemoteAttendanceTablesAvailability() {
  if (attendanceRemoteSetupAvailable !== null) {
    return attendanceRemoteSetupAvailable
  }

  if (attendanceRemoteSetupCheck) {
    return attendanceRemoteSetupCheck
  }

  attendanceRemoteSetupCheck = (async () => {
    try {
      const [{ error: attendanceError }, { error: sessionError }] = await Promise.all([
        supabase.from('attendance_records').select('id').limit(1),
        supabase.from('attendance_upload_sessions').select('id').limit(1),
      ])

      attendanceRemoteSetupAvailable = !attendanceError && !sessionError
      return attendanceRemoteSetupAvailable
    } catch {
      attendanceRemoteSetupAvailable = false
      return false
    } finally {
      attendanceRemoteSetupCheck = null
    }
  })()

  return attendanceRemoteSetupCheck
}

// Parse the region/store field from Excel which looks like: "14992 - SHOPRITE - JUBILEE CROSSING (14992)"
// Or: "PRETORIA (PTA) 14992 - SHOPRITE - JUBILEE CROSSING (14992)"
export function parseRegionStore(rawRegion: string): { region: string; regionCode: string; store: string; storeCode: string } {
  // Default values
  let region = 'Unknown Region'
  let regionCode = ''
  let store = 'Unknown Store'
  let storeCode = ''

  if (!rawRegion || typeof rawRegion !== 'string') {
    return { region, regionCode, store, storeCode }
  }

  const trimmed = rawRegion.trim()
  
  // Pattern 1: "REGION (CODE) NUMBER - STORE (NUMBER)"
  // Example: "PRETORIA (PTA) 14992 - SHOPRITE - JUBILEE CROSSING (14992)"
  
  // Pattern 2: "NUMBER - BRANCH - STORE NAME (NUMBER)"
  // Example: "14992 - SHOPRITE - JUBILEE CROSSING (14992)"
  
  // Check for region code pattern at the start: "REGION (CODE)"
  const startRegionMatch = trimmed.match(/^([A-Z]+)\s*\(([A-Z]+)\)\s*/)
  if (startRegionMatch) {
    region = startRegionMatch[1].toUpperCase()
    regionCode = startRegionMatch[2].toUpperCase()
  }
  
  // Split by " - " to get parts
  const parts = trimmed.split(/\s*-\s*/)
  
  if (parts.length >= 2) {
    // First part might be store code or region info
    // If it looks like a number, it's a store code
    const storeCodeCandidate = parts[0].trim()
    if (/^\d+$/.test(storeCodeCandidate)) {
      storeCode = storeCodeCandidate
    }
    
    // Middle parts (if 3+ parts) are branch + store name
    // Last part might have store code in parentheses
    let lastPart = parts[parts.length - 1].trim()
    const lastStoreCodeMatch = lastPart.match(/\((\d+)\)\s*$/)
    if (lastStoreCodeMatch) {
      storeCode = lastStoreCodeMatch[1]
      lastPart = lastPart.replace(/\s*\(\d+\)\s*$/, '').trim()
    }
    
    // Store name is everything except first (store code) and last (if had code)
    // For format "NUMBER - BRANCH - NAME" or "NUMBER - NAME"
    if (parts.length === 3) {
      // Format: NUMBER - BRANCH - NAME
      store = `${parts[1].trim()} - ${lastPart}`
    } else if (parts.length === 2) {
      // Format: NUMBER - NAME
      store = lastPart
    } else if (parts.length > 3) {
      // Format: NUMBER - BRANCH - NAME - EXTRA
      store = parts.slice(1).join(' - ')
      // Remove trailing store code if present
      store = store.replace(/\s*\(\d+\)\s*$/, '').trim()
    }
  } else {
    // No dashes, treat as region or store name
    const regionCodeMatch = trimmed.match(/([A-Z]+)\s*\(([A-Z]+)\)/)
    if (regionCodeMatch) {
      region = regionCodeMatch[1].toUpperCase()
      regionCode = regionCodeMatch[2].toUpperCase()
    } else {
      store = trimmed
    }
  }

  // Ensure we have valid defaults
  if (!store || store === 'Unknown Store') {
    store = trimmed
  }

  return { region, regionCode, store, storeCode }
}

// Database operations
export async function initializeDatabase(): Promise<boolean> {
  try {
    const isAvailable = await checkRemoteAttendanceTablesAvailability()
    if (!isAvailable) {
      console.warn('Database initialization warning:', ATTENDANCE_REMOTE_SETUP_HINT)
    }
    return isAvailable
  } catch (err) {
    console.warn('Database init warning:', err instanceof Error ? err.message : ATTENDANCE_REMOTE_SETUP_HINT)
    return false
  }
}

export async function saveAttendanceRecords(
  records: Omit<AttendanceRecord, 'id' | 'created_at'>[]
): Promise<{ success: boolean; error?: string; count?: number }> {
  try {
    // First, ensure we have dates
    const recordsWithDates = records.map(record => ({
      ...record,
      upload_date: record.upload_date || new Date().toISOString().split('T')[0],
    }))

    upsertLocalAttendanceRecords(recordsWithDates)

    const { data, error } = await supabase
      .from('attendance_records')
      .insert(recordsWithDates)
      .select('id')

    if (error) {
      if (error.message.includes('clock_count') || error.message.includes('first_clock') || error.message.includes('last_clock') || error.message.includes('status_label') || error.message.includes('clockings')) {
        const legacyRecords = recordsWithDates.map((record) => {
          const legacy = { ...record }
          delete legacy.clock_count
          delete legacy.first_clock
          delete legacy.last_clock
          delete legacy.status_label
          delete legacy.clockings
          return legacy
        })
        const fallback = await supabase
          .from('attendance_records')
          .insert(legacyRecords)
          .select('id')

        if (!fallback.error) {
          return { success: true, count: fallback.data?.length || legacyRecords.length, error: 'Attendance saved, but the database still needs the new clocking columns.' }
        }
      }
      console.error('Save attendance error:', error)
      return { success: false, error: error.message }
    }

    // Record the upload session
    if (recordsWithDates.length > 0) {
      const uploadDate = recordsWithDates[0].upload_date
      await supabase.from('attendance_upload_sessions').upsert({
        upload_date: uploadDate,
        record_count: recordsWithDates.length,
        created_at: new Date().toISOString(),
      }, {
        onConflict: 'upload_date',
        ignoreDuplicates: true,
      })
    }

    return { success: true, count: data?.length || recordsWithDates.length }
  } catch (err) {
    console.error('Save attendance error:', err)
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function getAttendanceByDate(date: string): Promise<AttendanceRecord[]> {
  const t0 = performance.now();
  try {
    const { data, error } = await supabase
      .from('attendance_records')
      .select('*')
      .eq('upload_date', date)
      .order('region')
      .order('store')
      .order('name')

    if (error) {
      console.error('Get attendance error:', error)
      return loadLocalAttendanceRecords().filter((record) => record.upload_date === date)
    }

    const remote = (data || []).map((record) => normalizeAttendanceRecord(record as AttendanceRecord))
    console.log(`[database] getAttendanceByDate(${date}): ${(performance.now() - t0).toFixed(0)}ms (${remote.length} records)`);
    return remote
  } catch (err) {
    console.error('Get attendance error:', err)
    return loadLocalAttendanceRecords().filter((record) => record.upload_date === date)
  }
}

export async function getAttendanceByDateRange(startDate: string, endDate: string): Promise<AttendanceRecord[]> {
  const t0 = performance.now();
  try {
    const { data, error } = await supabase
      .from('attendance_records')
      .select('*')
      .gte('upload_date', startDate)
      .lte('upload_date', endDate)
      .order('upload_date')
      .order('store')
      .order('name')

    if (error) {
      console.error('Get attendance range error:', error)
      return loadLocalAttendanceRecords().filter(
        (record) => record.upload_date >= startDate && record.upload_date <= endDate
      )
    }

    const remote = (data || []).map((record) => normalizeAttendanceRecord(record as AttendanceRecord))
    console.log(`[database] getAttendanceByDateRange(${startDate}..${endDate}): ${(performance.now() - t0).toFixed(0)}ms (${remote.length} records)`);
    return remote
  } catch (err) {
    console.error('Get attendance range error:', err)
    return loadLocalAttendanceRecords().filter(
      (record) => record.upload_date >= startDate && record.upload_date <= endDate
    )
  }
}

export async function getAvailableDates(): Promise<string[]> {
  const localDates = Array.from(new Set(loadLocalAttendanceRecords().map((record) => record.upload_date))).sort((a, b) => b.localeCompare(a))

  try {
    const { data, error } = await supabase
      .from('attendance_upload_sessions')
      .select('upload_date, record_count')
      .order('upload_date', { ascending: false })

    if (error) {
      console.error('Get dates error:', error)
      return localDates
    }

    return Array.from(new Set([...(data || []).map(d => d.upload_date), ...localDates])).sort((a, b) => b.localeCompare(a))
  } catch (err) {
    console.error('Get dates error:', err)
    return localDates
  }
}

export async function getAttendanceStats(): Promise<{
  totalRecords: number
  totalDates: number
  dates: { date: string; count: number }[]
}> {
  try {
    const { data, error } = await supabase
      .from('attendance_upload_sessions')
      .select('upload_date, record_count')
      .order('upload_date', { ascending: false })

    if (error) {
      console.error('Get stats error:', error)
      return { totalRecords: 0, totalDates: 0, dates: [] }
    }

    const dates = (data || []).map(d => ({
      date: d.upload_date,
      count: d.record_count || 0,
    }))

    return {
      totalRecords: dates.reduce((sum, d) => sum + d.count, 0),
      totalDates: dates.length,
      dates,
    }
  } catch (err) {
    console.error('Get stats error:', err)
    return { totalRecords: 0, totalDates: 0, dates: [] }
  }
}

export async function deleteAttendanceByDate(date: string): Promise<boolean> {
  try {
    saveLocalAttendanceRecords(loadLocalAttendanceRecords().filter((record) => record.upload_date !== date))

    const { error } = await supabase
      .from('attendance_records')
      .delete()
      .eq('upload_date', date)

    if (error) {
      console.error('Delete error:', error)
      return true
    }

    // Also delete the session record
    await supabase.from('attendance_upload_sessions').delete().eq('upload_date', date)

    return true
  } catch (err) {
    console.error('Delete error:', err)
    return true
  }
}

// ==================== EMPLOYEE OPERATIONS ====================

export interface Employee {
  id: string
  employee_code: string
  first_name: string
  last_name: string
  gender?: string
  title?: string
  alias?: string
  id_number?: string
  email: string
  phone: string
  job_title: string
  department: string
  region: string
  store: string
  store_code: string
  hire_date: string
  person_type?: string
  fingerprints_enrolled?: number | null
  company?: string
  branch?: string
  business_unit?: string
  cost_center?: string
  team?: string
  ta_integration_id_1?: string
  ta_integration_id_2?: string
  access_profile?: string
  ta_enabled?: boolean | null
  permanent?: boolean | null
  active?: boolean | null
  termination_reason?: string
  termination_date?: string
  status: 'active' | 'inactive' | 'terminated'
  created_at: string
  updated_at: string
}

export interface EmployeeInput {
  employee_code: string
  first_name: string
  last_name: string
  gender?: string
  title?: string
  alias?: string
  id_number?: string
  email?: string
  phone?: string
  job_title?: string
  department?: string
  region?: string
  store?: string
  store_code?: string
  hire_date?: string
  person_type?: string
  fingerprints_enrolled?: number | null
  company?: string
  branch?: string
  business_unit?: string
  cost_center?: string
  team?: string
  ta_integration_id_1?: string
  ta_integration_id_2?: string
  access_profile?: string
  ta_enabled?: boolean | null
  permanent?: boolean | null
  active?: boolean | null
  termination_reason?: string
  termination_date?: string
  status?: 'active' | 'inactive' | 'terminated'
}

const EMPLOYEE_STORAGE_KEY = 'employee-profiles-cache-v1'
const EMPLOYEE_INDEXED_DB_NAME = 'time-attendance-employee-db'
const EMPLOYEE_INDEXED_DB_VERSION = 1
const EMPLOYEE_INDEXED_DB_STORE = 'employees'
const EMPLOYEE_REMOTE_SETUP_HINT =
  'Remote employee table is not set up yet. Run setup-database.ps1 or the SQL in supabase-setup.sql to create the Supabase schema. Employee profiles are being stored locally in this browser.'

let employeeRemoteSetupAvailable: boolean | null = null
let employeeRemoteSetupCheck: Promise<boolean> | null = null

function randomId() {
  return globalThis.crypto?.randomUUID?.() ?? `employee_${Math.random().toString(36).slice(2)}_${Date.now()}`
}

export function normalizeEmployeeCode(value: unknown) {
  return String(value || '').replace(/\s+/g, '').trim().toUpperCase()
}

async function checkRemoteEmployeeTableAvailability() {
  if (employeeRemoteSetupAvailable !== null) {
    return employeeRemoteSetupAvailable
  }

  if (employeeRemoteSetupCheck) {
    return employeeRemoteSetupCheck
  }

  employeeRemoteSetupCheck = (async () => {
    try {
      const { error } = await supabase.from('employees').select('id').limit(1)
      employeeRemoteSetupAvailable = !error
      return employeeRemoteSetupAvailable
    } catch {
      employeeRemoteSetupAvailable = false
      return false
    } finally {
      employeeRemoteSetupCheck = null
    }
  })()

  return employeeRemoteSetupCheck
}

function getEmployeeStorageErrorMessage(error: unknown) {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message || "")
      : error instanceof Error
        ? error.message
        : String(error || "")

  if (message.includes("Could not find the table 'public.employees' in the schema cache")) {
    return EMPLOYEE_REMOTE_SETUP_HINT
  }

  if (message.includes("relation \"public.employees\" does not exist") || message.includes("relation \"employees\" does not exist")) {
    return EMPLOYEE_REMOTE_SETUP_HINT
  }

  if (message.includes("Could not find the function public.exec")) {
    return EMPLOYEE_REMOTE_SETUP_HINT
  }

  return message
}

function sortEmployees(items: Employee[]) {
  return [...items].sort((a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name))
}

function preferEmployeeField<T>(primary: T | null | undefined, fallback: T | null | undefined) {
  if (primary === null || primary === undefined) return fallback as T
  if (typeof primary === 'string' && primary.trim() === '') return fallback as T
  return primary as T
}

function mergeEmployeeRecord(existing: Employee | undefined, incoming: Employee): Employee {
  if (!existing) {
    return {
      ...incoming,
      employee_code: normalizeEmployeeCode(incoming.employee_code),
    }
  }

  return {
    ...existing,
    ...incoming,
    id: preferEmployeeField(incoming.id, existing.id),
    employee_code: normalizeEmployeeCode(incoming.employee_code || existing.employee_code),
    first_name: preferEmployeeField(incoming.first_name, existing.first_name),
    last_name: preferEmployeeField(incoming.last_name, existing.last_name),
    gender: preferEmployeeField(incoming.gender, existing.gender),
    title: preferEmployeeField(incoming.title, existing.title),
    alias: preferEmployeeField(incoming.alias, existing.alias),
    id_number: preferEmployeeField(incoming.id_number, existing.id_number),
    email: preferEmployeeField(incoming.email, existing.email),
    phone: preferEmployeeField(incoming.phone, existing.phone),
    job_title: preferEmployeeField(incoming.job_title, existing.job_title),
    department: preferEmployeeField(incoming.department, existing.department),
    region: preferEmployeeField(incoming.region, existing.region),
    store: preferEmployeeField(incoming.store, existing.store),
    store_code: preferEmployeeField(incoming.store_code, existing.store_code),
    hire_date: preferEmployeeField(incoming.hire_date, existing.hire_date),
    person_type: preferEmployeeField(incoming.person_type, existing.person_type),
    fingerprints_enrolled: incoming.fingerprints_enrolled ?? existing.fingerprints_enrolled ?? null,
    company: preferEmployeeField(incoming.company, existing.company),
    branch: preferEmployeeField(incoming.branch, existing.branch),
    business_unit: preferEmployeeField(incoming.business_unit, existing.business_unit),
    cost_center: preferEmployeeField(incoming.cost_center, existing.cost_center),
    team: preferEmployeeField(incoming.team, existing.team),
    ta_integration_id_1: preferEmployeeField(incoming.ta_integration_id_1, existing.ta_integration_id_1),
    ta_integration_id_2: preferEmployeeField(incoming.ta_integration_id_2, existing.ta_integration_id_2),
    access_profile: preferEmployeeField(incoming.access_profile, existing.access_profile),
    ta_enabled: incoming.ta_enabled ?? existing.ta_enabled ?? null,
    permanent: incoming.permanent ?? existing.permanent ?? null,
    active: incoming.active ?? existing.active ?? null,
    termination_reason: preferEmployeeField(incoming.termination_reason, existing.termination_reason),
    termination_date: preferEmployeeField(incoming.termination_date, existing.termination_date),
    status: preferEmployeeField(incoming.status, existing.status),
    created_at: preferEmployeeField(existing.created_at, incoming.created_at),
    updated_at: preferEmployeeField(incoming.updated_at, existing.updated_at),
  }
}

function filterEmployees(items: Employee[], filters?: {
  search?: string
  region?: string
  store?: string
  status?: string
}) {
  return items.filter((employee) => {
    const search = (filters?.search || '').toLowerCase()
    const matchesSearch =
      !search ||
      employee.employee_code.toLowerCase().includes(search) ||
      employee.first_name.toLowerCase().includes(search) ||
      employee.last_name.toLowerCase().includes(search) ||
      (employee.id_number || '').toLowerCase().includes(search) ||
      (employee.alias || '').toLowerCase().includes(search) ||
      (employee.email || '').toLowerCase().includes(search)
    const matchesRegion = !filters?.region || employee.region === filters.region
    const matchesStore = !filters?.store || employee.store === filters.store
    const matchesStatus = !filters?.status || employee.status === filters.status
    return matchesSearch && matchesRegion && matchesStore && matchesStatus
  })
}

function mergeEmployeeCollections(...collections: Employee[][]) {
  const map = new Map<string, Employee>()

  collections
    .flat()
    .forEach((employee) => {
      const normalizedCode = normalizeEmployeeCode(employee.employee_code)
      if (!normalizedCode) return

      map.set(
        normalizedCode,
        mergeEmployeeRecord(map.get(normalizedCode), {
          ...employee,
          employee_code: normalizedCode,
        } as Employee)
      )
    })

  return sortEmployees(Array.from(map.values()))
}

function loadLocalEmployees(): Employee[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(EMPLOYEE_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Employee[]
    if (Array.isArray(parsed) && parsed.length > 0) {
      return sortEmployees(parsed)
    }
    return []
  } catch (error) {
    console.error('Load local employees error:', error)
    return []
  }
}

function saveLocalEmployees(employees: Employee[]) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(EMPLOYEE_STORAGE_KEY, JSON.stringify(employees))
  } catch (error) {
    console.error('Save local employees error:', error)
  }
}

function clearLocalEmployees() {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.removeItem(EMPLOYEE_STORAGE_KEY)
  } catch (error) {
    console.error('Clear local employees error:', error)
  }
}

function openEmployeeIndexedDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    const request = window.indexedDB.open(EMPLOYEE_INDEXED_DB_NAME, EMPLOYEE_INDEXED_DB_VERSION)

    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(EMPLOYEE_INDEXED_DB_STORE)) {
        const store = database.createObjectStore(EMPLOYEE_INDEXED_DB_STORE, { keyPath: 'employee_code' })
        store.createIndex('last_name', 'last_name', { unique: false })
        store.createIndex('status', 'status', { unique: false })
        store.createIndex('store', 'store', { unique: false })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      console.error('Open employee IndexedDB error:', request.error)
      resolve(null)
    }
  })
}

async function readIndexedDbEmployees(): Promise<Employee[]> {
  const database = await openEmployeeIndexedDb()
  if (!database) return []

  return new Promise((resolve) => {
    const transaction = database.transaction(EMPLOYEE_INDEXED_DB_STORE, 'readonly')
    const store = transaction.objectStore(EMPLOYEE_INDEXED_DB_STORE)
    const request = store.getAll()

    request.onsuccess = () => {
      const result = Array.isArray(request.result) ? (request.result as Employee[]) : []
      resolve(sortEmployees(result))
    }
    request.onerror = () => {
      console.error('Read employee IndexedDB error:', request.error)
      resolve([])
    }
  })
}

async function writeIndexedDbEmployees(employees: Employee[]) {
  const database = await openEmployeeIndexedDb()
  if (!database) return false

  return new Promise<boolean>((resolve) => {
    const transaction = database.transaction(EMPLOYEE_INDEXED_DB_STORE, 'readwrite')
    const store = transaction.objectStore(EMPLOYEE_INDEXED_DB_STORE)
    const normalized = sortEmployees(employees)

    store.clear()
    normalized.forEach((employee) => {
      store.put({
        ...employee,
        employee_code: normalizeEmployeeCode(employee.employee_code),
      })
    })

    transaction.oncomplete = () => resolve(true)
    transaction.onerror = () => {
      console.error('Write employee IndexedDB error:', transaction.error)
      resolve(false)
    }
  })
}

async function loadStoredEmployees(): Promise<Employee[]> {
  if (typeof window === 'undefined') return []

  const indexedDbEmployees = await readIndexedDbEmployees()
  const localEmployees = loadLocalEmployees()
  const merged = mergeEmployeeCollections(localEmployees, indexedDbEmployees)

  if (merged.length > 0) {
    const saved = await writeIndexedDbEmployees(merged)
    if (saved) clearLocalEmployees()
    else saveLocalEmployees(merged)
    return merged
  }

  return []
}

async function saveStoredEmployees(employees: Employee[]) {
  if (typeof window === 'undefined') return
  const normalized = sortEmployees(employees)
  const saved = await writeIndexedDbEmployees(normalized)
  if (saved) clearLocalEmployees()
  else saveLocalEmployees(normalized)
}

function normalizeEmployeeStatus(status?: string | null): 'active' | 'inactive' | 'terminated' {
  const clean = String(status || '').trim().toLowerCase()
  if (clean === 'inactive') return 'inactive'
  if (clean === 'terminated') return 'terminated'
  return 'active'
}

function parseExcelDate(value: unknown): string {
  if (!value) return "";
  const strValue = String(value).trim();
  // Keep as-is - store raw Excel numeric date as text
  return strValue;
}

function toSupabaseDate(value: unknown): string | null {
  const parsed = parseExcelDate(value)
  return parsed || null
}

function normalizeEmployeePayload(employee: EmployeeInput) {
  const normalizedHireDate = toSupabaseDate(employee.hire_date)
  const normalizedTerminationDate = toSupabaseDate(employee.termination_date)
  const hasTermination = Boolean(normalizedTerminationDate || String(employee.termination_reason || "").trim())
  const requestedStatus = employee.status
    ? normalizeEmployeeStatus(employee.status)
    : hasTermination
      ? "inactive"
      : employee.active === false
        ? "inactive"
        : "active"
  const finalStatus: "active" | "inactive" | "terminated" = hasTermination ? "inactive" : requestedStatus
  const isActive =
    employee.active === null || employee.active === undefined
      ? finalStatus === "active"
      : Boolean(employee.active) && !hasTermination && finalStatus === "active"
  return {
    ...employee,
    employee_code: normalizeEmployeeCode(employee.employee_code),
    status: finalStatus,
    active: isActive,
    gender: employee.gender || '',
    title: employee.title || '',
    alias: employee.alias || '',
    id_number: employee.id_number || '',
    email: employee.email || '',
    phone: employee.phone || '',
    job_title: employee.job_title || '',
    department: employee.department || '',
    region: employee.region || '',
    store: employee.store || '',
    store_code: employee.store_code || '',
    hire_date: normalizedHireDate,
    person_type: employee.person_type || '',
    fingerprints_enrolled: employee.fingerprints_enrolled ?? null,
    company: employee.company || '',
    branch: employee.branch || '',
    business_unit: employee.business_unit || '',
    cost_center: employee.cost_center || '',
    team: employee.team || '',
    ta_integration_id_1: employee.ta_integration_id_1 || '',
    ta_integration_id_2: employee.ta_integration_id_2 || '',
    access_profile: employee.access_profile || '',
    ta_enabled: employee.ta_enabled ?? null,
    permanent: employee.permanent ?? null,
    termination_reason: employee.termination_reason || '',
    termination_date: normalizedTerminationDate,
  }
}

function normalizeEmployeeUpdatePayload(updates: Partial<EmployeeInput>) {
  const next: Record<string, unknown> = {}

  Object.entries(updates).forEach(([key, value]) => {
    if (value === undefined) return
    if (key === "employee_code") {
      next[key] = normalizeEmployeeCode(value)
      return
    }
    if (key === "hire_date" || key === "termination_date") {
      next[key] = toSupabaseDate(value)
      return
    }
    next[key] = value
  })

  if ('status' in updates) {
    const status = normalizeEmployeeStatus(updates.status)
    next.status = status
    if (!('active' in updates)) {
      next.active = status === 'active'
    }
  }

  const hasTermination = Boolean(
    ("termination_date" in updates && String(next.termination_date || "").trim()) ||
    ("termination_reason" in updates && String(updates.termination_reason || "").trim())
  )

  if (hasTermination) {
    next.status = "inactive"
    if (!("active" in updates)) {
      next.active = false
    }
  }

  return next
}

export const EMPLOYEE_SETUP_SQL = `
CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  gender TEXT DEFAULT '',
  title TEXT DEFAULT '',
  alias TEXT DEFAULT '',
  id_number TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  job_title TEXT DEFAULT '',
  department TEXT DEFAULT '',
  region TEXT DEFAULT '',
  store TEXT DEFAULT '',
  store_code TEXT DEFAULT '',
  hire_date DATE,
  person_type TEXT DEFAULT '',
  fingerprints_enrolled INTEGER,
  company TEXT DEFAULT '',
  branch TEXT DEFAULT '',
  business_unit TEXT DEFAULT '',
  cost_center TEXT DEFAULT '',
  team TEXT DEFAULT '',
  ta_integration_id_1 TEXT DEFAULT '',
  ta_integration_id_2 TEXT DEFAULT '',
  access_profile TEXT DEFAULT '',
  ta_enabled BOOLEAN,
  permanent BOOLEAN,
  active BOOLEAN DEFAULT true,
  termination_reason TEXT DEFAULT '',
  termination_date DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'terminated')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE employees ADD COLUMN IF NOT EXISTS title TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS gender TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS alias TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS id_number TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS email TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS job_title TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS department TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS region TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS store TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS store_code TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS hire_date DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS person_type TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS fingerprints_enrolled INTEGER;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS company TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS branch TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS business_unit TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS cost_center TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS team TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS ta_integration_id_1 TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS ta_integration_id_2 TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS access_profile TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS ta_enabled BOOLEAN;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS permanent BOOLEAN;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS termination_reason TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS termination_date DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS idx_employees_code ON employees(employee_code);
CREATE INDEX IF NOT EXISTS idx_employees_name ON employees(last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_employees_id_number ON employees(id_number);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
CREATE INDEX IF NOT EXISTS idx_employees_store ON employees(store);

DROP POLICY IF EXISTS "Allow public read employees" ON employees;
DROP POLICY IF EXISTS "Allow public insert employees" ON employees;
DROP POLICY IF EXISTS "Allow public update employees" ON employees;
DROP POLICY IF EXISTS "Allow public delete employees" ON employees;

CREATE POLICY "Allow public read employees" ON employees FOR SELECT USING (true);
CREATE POLICY "Allow public insert employees" ON employees FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update employees" ON employees FOR UPDATE USING (true);
CREATE POLICY "Allow public delete employees" ON employees FOR DELETE USING (true);
`

export async function initializeEmployeeDatabase(): Promise<boolean> {
  try {
    const isAvailable = await checkRemoteEmployeeTableAvailability()
    if (!isAvailable) {
      console.warn('Employee database initialization warning:', EMPLOYEE_REMOTE_SETUP_HINT)
    }
    return isAvailable
  } catch (err) {
    console.warn('Employee database initialization warning:', getEmployeeStorageErrorMessage(err))
    return false
  }
}

export async function getEmployees(filters?: {
  search?: string
  region?: string
  store?: string
  status?: string
}): Promise<Employee[]> {
  const t0 = performance.now();
  try {
    const PAGE_SIZE = 1000
    const allRows: Employee[] = []
    let page = 0
    let hasMore = true

    while (hasMore) {
      let query = supabase
        .from('employees')
        .select('*')
        .order('last_name')
        .order('first_name')
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

      if (filters?.search) {
        const search = filters.search.replace(/,/g, '')
        query = query.or(`employee_code.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%,id_number.ilike.%${search}%,alias.ilike.%${search}%,email.ilike.%${search}%,ta_integration_id_1.ilike.%${search}%,ta_integration_id_2.ilike.%${search}%`)
      }
      if (filters?.region) {
        query = query.eq('region', filters.region)
      }
      if (filters?.store) {
        query = query.eq('store', filters.store)
      }
      if (filters?.status) {
        query = query.eq('status', filters.status)
      }

      const { data, error } = await query
      if (error) {
        console.warn('Get employees warning:', getEmployeeStorageErrorMessage(error))
        const localEmployees = await loadStoredEmployees()
        return filterEmployees(localEmployees, filters)
      }

      const pageRows = (data || []) as Employee[]
      allRows.push(...pageRows)
      hasMore = pageRows.length === PAGE_SIZE
      page += 1
    }

    const remote = allRows
    console.log(`[database] getEmployees: ${(performance.now() - t0).toFixed(0)}ms (${remote.length} from Supabase)`);
    return remote
  } catch (err) {
    console.warn('Get employees warning:', getEmployeeStorageErrorMessage(err))
    const localEmployees = await loadStoredEmployees()
    return filterEmployees(localEmployees, filters)
  }
}

export async function getEmployeeById(id: string): Promise<Employee | null> {
  try {
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .eq('id', id)
      .single()

    if (error) {
      console.error('Get employee error:', error)
      return null
    }

    return data
  } catch (err) {
    console.error('Get employee error:', err)
    return null
  }
}

export async function getEmployeeByCode(code: string): Promise<Employee | null> {
  const normalizedCode = normalizeEmployeeCode(code)

  try {
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .ilike('employee_code', normalizedCode)
      .single()

    if (error) {
      return (await loadStoredEmployees()).find((employee) => normalizeEmployeeCode(employee.employee_code) === normalizedCode) || null
    }

    return data
  } catch {
    return (await loadStoredEmployees()).find((employee) => normalizeEmployeeCode(employee.employee_code) === normalizedCode) || null
  }
}

export async function createEmployee(employee: EmployeeInput): Promise<{ success: boolean; error?: string; id?: string }> {
  const now = new Date().toISOString()
  const localId = randomId()
  try {
    const localEmployees = await loadStoredEmployees()
    const localRecord: Employee = {
      id: localId,
      ...(normalizeEmployeePayload(employee) as Omit<Employee, 'id' | 'created_at' | 'updated_at'>),
      created_at: now,
      updated_at: now,
    }
    await saveStoredEmployees([...localEmployees.filter((item) => item.employee_code !== localRecord.employee_code), localRecord])

    const { data, error } = await supabase
      .from('employees')
      .insert({
        ...normalizeEmployeePayload(employee),
        created_at: now,
        updated_at: now,
      })
      .select('id')
      .single()

    if (error) {
      const message = getEmployeeStorageErrorMessage(error)
      console.warn('Create employee warning:', message)
      return { success: true, id: localId, error: message }
    }

    return { success: true, id: data.id }
  } catch (err) {
    const message = getEmployeeStorageErrorMessage(err)
    console.warn('Create employee warning:', message)
    return { success: true, error: message, id: localId }
  }
}

export async function updateEmployee(id: string, updates: Partial<EmployeeInput>): Promise<{ success: boolean; error?: string }> {
  try {
    const localEmployees = await loadStoredEmployees()
    await saveStoredEmployees(localEmployees.map((employee) =>
      employee.id === id
        ? {
            ...employee,
            ...normalizeEmployeeUpdatePayload(updates),
            updated_at: new Date().toISOString(),
          }
        : employee
    ))

    const { error } = await supabase
      .from('employees')
      .update({
        ...normalizeEmployeeUpdatePayload(updates),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (error) {
      const message = getEmployeeStorageErrorMessage(error)
      console.warn('Update employee warning:', message)
      return { success: true, error: message }
    }

    return { success: true }
  } catch (err) {
    const message = getEmployeeStorageErrorMessage(err)
    console.warn('Update employee warning:', message)
    return { success: true, error: message }
  }
}

export async function deleteEmployee(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    await saveStoredEmployees((await loadStoredEmployees()).filter((employee) => employee.id !== id))

    const { error } = await supabase
      .from('employees')
      .delete()
      .eq('id', id)

    if (error) {
      const message = getEmployeeStorageErrorMessage(error)
      console.warn('Delete employee warning:', message)
      return { success: true, error: message }
    }

    return { success: true }
  } catch (err) {
    const message = getEmployeeStorageErrorMessage(err)
    console.warn('Delete employee warning:', message)
    return { success: true, error: message }
  }
}

export async function importEmployees(employees: EmployeeInput[]): Promise<{ success: boolean; error?: string; count?: number; skipped?: number }> {
  try {
    const now = new Date().toISOString()
    
    // Process employees in a single pass without loading existing data first
    const processedEmployees = employees.map(emp => ({
      ...normalizeEmployeePayload(emp),
      created_at: now,
      updated_at: now,
    }))

    // Batch save to local storage without merging first (faster)
    const existingEmployees = await loadStoredEmployees()
    const localMap = new Map(existingEmployees.map((employee) => [normalizeEmployeeCode(employee.employee_code), employee]))
    
    processedEmployees.forEach((employee) => {
      const normalizedCode = normalizeEmployeeCode(employee.employee_code)
      const existing = localMap.get(normalizedCode)
      localMap.set(normalizedCode, {
        id: existing?.id || randomId(),
        employee_code: normalizedCode,
        first_name: employee.first_name,
        last_name: employee.last_name,
        gender: employee.gender || '',
        title: employee.title || '',
        alias: employee.alias || '',
        id_number: employee.id_number || '',
        email: employee.email || '',
        phone: employee.phone || '',
        job_title: employee.job_title || '',
        department: employee.department || '',
        region: employee.region || '',
        store: employee.store || '',
        store_code: employee.store_code || '',
        hire_date: parseExcelDate(employee.hire_date),
        person_type: employee.person_type || '',
        fingerprints_enrolled: employee.fingerprints_enrolled ?? null,
        company: employee.company || '',
        branch: employee.branch || '',
        business_unit: employee.business_unit || '',
        cost_center: employee.cost_center || '',
        team: employee.team || '',
        ta_integration_id_1: employee.ta_integration_id_1 || '',
        ta_integration_id_2: employee.ta_integration_id_2 || '',
        access_profile: employee.access_profile || '',
        ta_enabled: employee.ta_enabled ?? null,
        permanent: employee.permanent ?? null,
        active: employee.active ?? employee.status === 'active',
        termination_reason: employee.termination_reason || '',
        termination_date: parseExcelDate(employee.termination_date),
        status: normalizeEmployeeStatus(employee.status),
        created_at: existing?.created_at || now,
        updated_at: now,
      })
    })
    await saveStoredEmployees(sortEmployees(Array.from(localMap.values())))

    const { data, error } = await supabase
      .from('employees')
      .upsert(processedEmployees, { onConflict: 'employee_code' })
      .select('id')

    if (error) {
      const message = getEmployeeStorageErrorMessage(error)
      console.warn('Import employees warning:', message)
      return { success: true, count: processedEmployees.length, error: message }
    }

    return { success: true, count: data?.length || processedEmployees.length }
  } catch (err) {
    const message = getEmployeeStorageErrorMessage(err)
    console.warn('Import employees warning:', message)
    return { success: true, count: employees.length, error: message }
  }
}

// Strict import path used by critical upload flows where remote Supabase write must succeed.
// This still refreshes local cache first for UI continuity, but returns success=false when remote upsert fails.
export async function importEmployeesRemoteOverwrite(
  employees: EmployeeInput[]
): Promise<{ success: boolean; error?: string; count?: number }> {
  try {
    const now = new Date().toISOString()
    const processedEmployees = employees.map(emp => ({
      ...normalizeEmployeePayload(emp),
      created_at: now,
      updated_at: now,
    }))

    const existingEmployees = await loadStoredEmployees()
    const localMap = new Map(existingEmployees.map((employee) => [normalizeEmployeeCode(employee.employee_code), employee]))

    processedEmployees.forEach((employee) => {
      const normalizedCode = normalizeEmployeeCode(employee.employee_code)
      const existing = localMap.get(normalizedCode)
      localMap.set(normalizedCode, {
        id: existing?.id || randomId(),
        employee_code: normalizedCode,
        first_name: employee.first_name,
        last_name: employee.last_name,
        gender: employee.gender || '',
        title: employee.title || '',
        alias: employee.alias || '',
        id_number: employee.id_number || '',
        email: employee.email || '',
        phone: employee.phone || '',
        job_title: employee.job_title || '',
        department: employee.department || '',
        region: employee.region || '',
        store: employee.store || '',
        store_code: employee.store_code || '',
        hire_date: parseExcelDate(employee.hire_date),
        person_type: employee.person_type || '',
        fingerprints_enrolled: employee.fingerprints_enrolled ?? null,
        company: employee.company || '',
        branch: employee.branch || '',
        business_unit: employee.business_unit || '',
        cost_center: employee.cost_center || '',
        team: employee.team || '',
        ta_integration_id_1: employee.ta_integration_id_1 || '',
        ta_integration_id_2: employee.ta_integration_id_2 || '',
        access_profile: employee.access_profile || '',
        ta_enabled: employee.ta_enabled ?? null,
        permanent: employee.permanent ?? null,
        active: employee.active ?? employee.status === 'active',
        termination_reason: employee.termination_reason || '',
        termination_date: parseExcelDate(employee.termination_date),
        status: normalizeEmployeeStatus(employee.status),
        created_at: existing?.created_at || now,
        updated_at: now,
      })
    })
    await saveStoredEmployees(sortEmployees(Array.from(localMap.values())))

    const { data, error } = await supabase
      .from('employees')
      .upsert(processedEmployees, { onConflict: 'employee_code' })
      .select('id')

    if (error) {
      const message = getEmployeeStorageErrorMessage(error)
      console.error('Import employees remote overwrite failed:', message)
      return { success: false, error: message }
    }

    return { success: true, count: data?.length || processedEmployees.length }
  } catch (err) {
    const message = getEmployeeStorageErrorMessage(err)
    console.error('Import employees remote overwrite failed:', message)
    return { success: false, error: message }
  }
}

export async function getEmployeeStats(): Promise<{
  total: number
  active: number
  inactive: number
  terminated: number
  byRegion: { region: string; count: number }[]
  byDepartment: { department: string; count: number }[]
}> {
  try {
    const { data, error } = await supabase
      .from('employees')
      .select('region, department, status')

    if (error) {
      console.error('Get employee stats error:', error)
      return { total: 0, active: 0, inactive: 0, terminated: 0, byRegion: [], byDepartment: [] }
    }

    const employees = data || []
    const byRegion = employees.reduce((acc, emp) => {
      const region = emp.region || 'Unassigned'
      acc[region] = (acc[region] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    const byDepartment = employees.reduce((acc, emp) => {
      const dept = emp.department || 'Unassigned'
      acc[dept] = (acc[dept] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    return {
      total: employees.length,
      active: employees.filter(e => e.status === 'active').length,
      inactive: employees.filter(e => e.status === 'inactive').length,
      terminated: employees.filter(e => e.status === 'terminated').length,
      byRegion: Object.entries(byRegion).map(([region, count]) => ({ region, count })).sort((a, b) => b.count - a.count),
      byDepartment: Object.entries(byDepartment).map(([department, count]) => ({ department, count })).sort((a, b) => b.count - a.count),
    }
  } catch (err) {
    console.error('Get employee stats error:', err)
    return { total: 0, active: 0, inactive: 0, terminated: 0, byRegion: [], byDepartment: [] }
  }
}

// Get unique regions and stores from employees
export async function getEmployeeLocations(): Promise<{ regions: string[]; stores: { store: string; region: string }[] }> {
  try {
    const localEmployees = await loadStoredEmployees()
    const { data, error } = await supabase
      .from('employees')
      .select('region, store')

    if (error) {
      console.warn('Get locations warning:', getEmployeeStorageErrorMessage(error))
      const regions = [...new Set(localEmployees.map(e => e.region).filter(Boolean))].sort()
      const stores = [...new Map(localEmployees.map(e => [e.store, { store: e.store, region: e.region }])).values()].filter((item) => item.store)
      return { regions, stores }
    }

    const employees = data || []
    const regions = [...new Set(employees.map(e => e.region).filter(Boolean))].sort()
    const stores = [...new Map(employees.map(e => [e.store, { store: e.store, region: e.region }])).values()]

    return { regions, stores }
  } catch (err) {
    console.warn('Get locations warning:', getEmployeeStorageErrorMessage(err))
    const localEmployees = await loadStoredEmployees()
    const regions = [...new Set(localEmployees.map(e => e.region).filter(Boolean))].sort()
    const stores = [...new Map(localEmployees.map(e => [e.store, { store: e.store, region: e.region }])).values()].filter((item) => item.store)
    return { regions, stores }
  }
}
