import { useDeferredValue, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  RefreshCw,
  Plus,
  Upload,
  X,
  Edit3,
  Trash2,
  ChevronRight,
  Circle,
  Check,
  Download,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  getEmployees,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  initializeEmployeeDatabase,
  normalizeEmployeeCode,
  type Employee,
  type EmployeeInput,
} from "@/services/database";
import {
  getEmployeeUpdateUploadLogs,
  type EmployeeUpdateReportItem,
  type EmployeeUpdateUploadLog,
} from "@/services/employeeUpdateLogs";
import { getClockEventsForEmployeeProfile, getClockOverview, initializeClockDatabase, type BiometricClockEvent } from "@/services/clockData";
// Format helpers
function formatClockAuditTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleString("en-ZA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatClockAuditDateLabel(dateKey: string): string {
  const date = new Date(dateKey);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

type EmployeesHubProps = {
  onEmployeesChange?: () => void;
  onOpenPayrollUpload?: () => void;
  onOpenStaffListUpload?: () => void;
  onExportUploadLog?: (logId: string) => void;
  isUpdatingStaffList?: boolean;
  staffListUploadStage?: string;
  payrollUploadProgress?: number;
  payrollUploadStage?: string;
  isUploadingPayroll?: boolean;
};

const EMPLOYEE_REFRESH_TTL_MS = 5 * 60 * 1000; // 5 minutes

function formatDateValue(date: Date) {
  return date.toISOString().split("T")[0];
}

export default function EmployeesHub({
  onEmployeesChange,
  onOpenPayrollUpload,
  onOpenStaffListUpload,
  onExportUploadLog,
  isUpdatingStaffList = false,
  staffListUploadStage = "",
  payrollUploadProgress = 0,
  payrollUploadStage = "",
  isUploadingPayroll = false,
}: EmployeesHubProps) {
  // Employee core state
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const deferredEmployeeSearch = useDeferredValue(employeeSearch);
  const [employeeFilterRegion, setEmployeeFilterRegion] = useState("all");
  const [employeeFilterStatus, setEmployeeFilterStatus] = useState("all");
  const [employeeLocations, setEmployeeLocations] = useState<{ regions: string[]; stores: { store: string; region: string }[] }>({ regions: [], stores: [] });
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [isAddingEmployee, setIsAddingEmployee] = useState(false);
  const employeeTableRef = useRef<HTMLDivElement>(null);

  // Clock overview state
  const [clockOverview, setClockOverview] = useState({
    totalEvents: 0,
    employeesWithClocks: 0,
    verifiedEvents: 0,
  });
  const [employeeClockSummaryMap, setEmployeeClockSummaryMap] = useState<
    Map<string, { totalEvents: number; verifiedEvents: number; lastClockedAt: string; stores: string[] }>
  >(new Map());
  const [isLoadingClockEvents, setIsLoadingClockEvents] = useState(false);

  // Clock profile state
  const [selectedClockProfileEmployee, setSelectedClockProfileEmployee] = useState<Employee | null>(null);
  const [selectedClockProfileEvents, setSelectedClockProfileEvents] = useState<BiometricClockEvent[]>([]);
  const [isLoadingClockProfile, setIsLoadingClockProfile] = useState(false);
  const [clockProfileLoadMessage, setClockProfileLoadMessage] = useState("");
  const [clockProfileSearch, setClockProfileSearch] = useState("");
  const [clockProfileStartDate, setClockProfileStartDate] = useState("");
  const [clockProfileEndDate, setClockProfileEndDate] = useState("");
  const deferredClockProfileSearch = useDeferredValue(clockProfileSearch);

  const [staffListUploadResult, setStaffListUploadResult] = useState<{
    logId?: string;
    fileName: string;
    createdAt: string;
    matchedCount: number;
    updatedCount: number;
    inactiveCount: number;
    unchangedCount: number;
    unmatchedCount: number;
    reportItems: EmployeeUpdateReportItem[];
    remoteMessage?: string;
  } | null>(null);
  const [staffListUploadLogs, setStaffListUploadLogs] = useState<EmployeeUpdateUploadLog[]>([]);
  const [expandedStaffListLogDates, setExpandedStaffListLogDates] = useState<Set<string>>(new Set());
  const [showUploadHistory, setShowUploadHistory] = useState(false);
  const employeeRequestRef = useRef<{ fetchedAt: number; inFlight: boolean }>({ fetchedAt: 0, inFlight: false });

  // Form state
  const [employeeFormData, setEmployeeFormData] = useState<EmployeeInput>({
    employee_code: "",
    first_name: "",
    last_name: "",
    gender: "",
    title: "",
    alias: "",
    id_number: "",
    email: "",
    phone: "",
    job_title: "",
    department: "",
    region: "",
    store: "",
    store_code: "",
    hire_date: "",
    person_type: "",
    fingerprints_enrolled: null,
    company: "",
    branch: "",
    business_unit: "",
    cost_center: "",
    team: "",
    ta_integration_id_1: "",
    ta_integration_id_2: "",
    access_profile: "",
    ta_enabled: null,
    permanent: null,
    active: true,
    termination_reason: "",
    termination_date: "",
    status: "active",
  });

  // Derive employee locations
  const deriveEmployeeLocationsFromProfiles = (emps: Employee[]) => {
    const regions = new Set<string>();
    const stores: { store: string; region: string }[] = [];
    const storeMap = new Map<string, string>();
    emps.forEach((emp) => {
      if (emp.region) regions.add(emp.region);
      if (emp.store) {
        stores.push({ store: emp.store, region: emp.region || "" });
        storeMap.set(emp.store, emp.region || "");
      }
    });
    return { regions: Array.from(regions).sort(), stores };
  };

  // Load employees
  const loadEmployees = useCallback(async (options?: { force?: boolean }) => {
    const now = Date.now();
    if (
      !options?.force &&
      employees.length > 0 &&
      now - employeeRequestRef.current.fetchedAt < EMPLOYEE_REFRESH_TTL_MS
    ) {
      return employees;
    }

    if (employeeRequestRef.current.inFlight) {
      return employees;
    }

    employeeRequestRef.current.inFlight = true;

    try {
      await initializeEmployeeDatabase();
      const data = await getEmployees();
      setEmployees(data);
      setEmployeeLocations(deriveEmployeeLocationsFromProfiles(data));
      employeeRequestRef.current = { fetchedAt: Date.now(), inFlight: false };
      return data;
    } finally {
      employeeRequestRef.current.inFlight = false;
    }
  }, [employees]);

  // Load clock events
  const loadClockEvents = useCallback(async () => {
    setIsLoadingClockEvents(true);
    try {
      await initializeClockDatabase();
      const overview = await getClockOverview();
      setClockOverview({
        totalEvents: overview.totalEvents,
        employeesWithClocks: overview.employeesWithClocks,
        verifiedEvents: overview.verifiedEvents,
      });
      setEmployeeClockSummaryMap(
        new Map(
          overview.summaries.map((summary) => [
            normalizeEmployeeCode(summary.employee_code),
            {
              totalEvents: summary.total_events,
              verifiedEvents: summary.verified_events,
              lastClockedAt: summary.last_clocked_at,
              stores: summary.store ? [summary.store] : [],
            },
          ])
        )
      );
    } finally {
      setIsLoadingClockEvents(false);
    }
  }, []);

  // Load staff list logs
  const loadStaffListLogs = async () => {
    const logs = await getEmployeeUpdateUploadLogs();
    setStaffListUploadLogs(logs);
    const latestDate = logs[0]?.created_at ? formatDateValue(new Date(logs[0].created_at)) : "";
    if (latestDate) {
      setExpandedStaffListLogDates((prev) => (prev.has(latestDate) ? prev : new Set([...prev, latestDate])));
    }
    const latestLog = logs[0];
    if (latestLog) {
      setStaffListUploadResult({
        logId: latestLog.id,
        fileName: latestLog.file_name,
        createdAt: latestLog.created_at,
        matchedCount: latestLog.matched_profiles,
        updatedCount: latestLog.updated_profiles,
        inactiveCount: latestLog.inactive_profiles,
        unchangedCount: latestLog.unchanged_profiles,
        unmatchedCount: latestLog.unmatched_rows,
        reportItems: latestLog.items || [],
        remoteMessage: latestLog.remote_message || "",
      });
    }
  };

  // Initial load - employees only (clocks load on demand in ClockDataHub)
  useEffect(() => {
    void loadEmployees();
    void loadStaffListLogs();
  }, [loadEmployees]);

  // Refresh employees when payroll upload completes
  const prevUploadingRef = useRef(false);
  useEffect(() => {
    if (prevUploadingRef.current && !isUploadingPayroll) {
      loadEmployees({ force: true });
    }
    prevUploadingRef.current = isUploadingPayroll;
  }, [isUploadingPayroll, loadEmployees]);

  // Filtered employees
  const filteredEmployees = useMemo(() => {
    const query = deferredEmployeeSearch.trim().toLowerCase();
    return employees.filter((employee) => {
      const matchesStatus = employeeFilterStatus === "all" || employee.status === employeeFilterStatus;
      const matchesRegion = employeeFilterRegion === "all" || employee.region === employeeFilterRegion;
      const haystack = [
        employee.employee_code,
        employee.first_name,
        employee.last_name,
        employee.id_number,
        employee.store,
        employee.department,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const matchesSearch = !query || haystack.includes(query);
      return matchesStatus && matchesRegion && matchesSearch;
    });
  }, [deferredEmployeeSearch, employeeFilterRegion, employeeFilterStatus, employees]);

  // Simple pagination instead of virtualizer for better performance
  const [employeePage, setEmployeePage] = useState(0);
  const EMPLOYEES_PER_PAGE = 50;
  const paginatedEmployees = useMemo(() => {
    const start = employeePage * EMPLOYEES_PER_PAGE;
    return filteredEmployees.slice(start, start + EMPLOYEES_PER_PAGE);
  }, [filteredEmployees, employeePage]);
  
  const totalEmployeePages = Math.ceil(filteredEmployees.length / EMPLOYEES_PER_PAGE);

  // Employee form handlers
  const resetEmployeeForm = () => {
    setEmployeeFormData({
      employee_code: "",
      first_name: "",
      last_name: "",
      gender: "",
      title: "",
      alias: "",
      id_number: "",
      email: "",
      phone: "",
      job_title: "",
      department: "",
      region: "",
      store: "",
      store_code: "",
      hire_date: "",
      person_type: "",
      fingerprints_enrolled: null,
      company: "",
      branch: "",
      business_unit: "",
      cost_center: "",
      team: "",
      ta_integration_id_1: "",
      ta_integration_id_2: "",
      access_profile: "",
      ta_enabled: null,
      permanent: null,
      active: true,
      termination_reason: "",
      termination_date: "",
      status: "active",
    });
  };

  const handleAddEmployee = async () => {
    if (!employeeFormData.employee_code.trim() || !employeeFormData.first_name.trim() || !employeeFormData.last_name.trim()) {
      alert("Please fill in the required fields: Employee Code, First Name, and Last Name.");
      return;
    }
    try {
      await createEmployee(employeeFormData);
      setIsAddingEmployee(false);
      setEditingEmployee(null);
      resetEmployeeForm();
      await loadEmployees({ force: true });
      onEmployeesChange?.();
    } catch (error) {
      alert(`Failed to add employee: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const handleEditEmployee = (employee: Employee) => {
    setEditingEmployee(employee);
    setIsAddingEmployee(true);
    setEmployeeFormData({
      employee_code: employee.employee_code || "",
      first_name: employee.first_name || "",
      last_name: employee.last_name || "",
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
      fingerprints_enrolled: employee.fingerprints_enrolled,
      company: employee.company || "",
      branch: employee.branch || "",
      business_unit: employee.business_unit || "",
      cost_center: employee.cost_center || "",
      team: employee.team || "",
      ta_integration_id_1: employee.ta_integration_id_1 || "",
      ta_integration_id_2: employee.ta_integration_id_2 || "",
      access_profile: employee.access_profile || "",
      ta_enabled: employee.ta_enabled,
      permanent: employee.permanent,
      active: employee.active ?? true,
      termination_reason: employee.termination_reason || "",
      termination_date: employee.termination_date || "",
      status: employee.status || "active",
    });
  };

  const handleUpdateEmployee = async () => {
    if (!editingEmployee?.id) return;
    if (!employeeFormData.employee_code.trim() || !employeeFormData.first_name.trim() || !employeeFormData.last_name.trim()) {
      alert("Please fill in the required fields: Employee Code, First Name, and Last Name.");
      return;
    }
    try {
      await updateEmployee(editingEmployee.id, employeeFormData);
      setIsAddingEmployee(false);
      setEditingEmployee(null);
      resetEmployeeForm();
      await loadEmployees({ force: true });
      onEmployeesChange?.();
    } catch (error) {
      alert(`Failed to update employee: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const handleDeleteEmployee = async (id: string) => {
    if (!confirm("Are you sure you want to delete this employee?")) return;
    try {
      await deleteEmployee(id);
      await loadEmployees({ force: true });
      onEmployeesChange?.();
    } catch (error) {
      alert(`Failed to delete employee: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const handleSetEmployeeStatus = async (employee: Employee, status: "active" | "inactive" | "terminated") => {
    if (!employee.id) return;
    try {
      await updateEmployee(employee.id, { status, active: status === "active" });
      await loadEmployees({ force: true });
      onEmployeesChange?.();
    } catch (error) {
      alert(`Failed to update status: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  // Clock profile
  const openEmployeeClockProfile = async (employee: Employee) => {
    setSelectedClockProfileEmployee(employee);
    setIsLoadingClockProfile(true);
    setClockProfileLoadMessage("Starting clock data load...");

    try {
      const events = await getClockEventsForEmployeeProfile(employee);
      setClockProfileLoadMessage(`Found ${events.length} clock event${events.length === 1 ? "" : "s"}...`);
      setSelectedClockProfileEvents(events);
      setClockProfileLoadMessage("Clock data loaded.");
    } catch (error) {
      setClockProfileLoadMessage(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsLoadingClockProfile(false);
    }
  };

  const closeEmployeeClockProfile = () => {
    setSelectedClockProfileEmployee(null);
    setSelectedClockProfileEvents([]);
    setClockProfileSearch("");
    setClockProfileStartDate("");
    setClockProfileEndDate("");
  };

  const selectedClockProfileTimeline = useMemo(() => {
    const query = deferredClockProfileSearch.trim().toLowerCase();
    const start = clockProfileStartDate ? new Date(clockProfileStartDate) : null;
    const end = clockProfileEndDate ? new Date(clockProfileEndDate) : null;

    return selectedClockProfileEvents
      .filter((event) => {
        if (start && new Date(event.clocked_at) < start) return false;
        if (end && new Date(event.clocked_at) > end) return false;
        if (query) {
          const haystack = `${event.store} ${event.device_name} ${event.method} ${event.direction} ${event.source_file_name}`.toLowerCase();
          if (!haystack.includes(query)) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.clocked_at).getTime() - new Date(a.clocked_at).getTime())
      .reduce((groups, event) => {
        const dateKey = event.clock_date || event.clocked_at.split("T")[0];
        const existing = groups.find((g) => g.dateKey === dateKey);
        if (existing) {
          existing.events.push(event);
        } else {
          groups.push({ dateKey, events: [event] });
        }
        return groups;
      }, [] as { dateKey: string; events: BiometricClockEvent[] }[]);
  }, [selectedClockProfileEvents, deferredClockProfileSearch, clockProfileStartDate, clockProfileEndDate]);

  // Render
  return (
    <div className="section-tech-stack">
      {/* Stats Cards */}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-6">
        <Card className="section-tech-stat rounded-2xl border-slate-700/50 text-center">
          <CardContent className="p-4 text-center">
            <div className="section-tech-kicker text-cyan-400">Employee Core</div>
            <div className="mt-2 text-3xl font-bold text-white">{employees.length}</div>
            <div className="text-sm text-slate-400">Total Employees</div>
          </CardContent>
        </Card>
        <Card className="section-tech-stat rounded-2xl border-slate-700/50 text-center">
          <CardContent className="p-4 text-center">
            <div className="section-tech-kicker text-emerald-400">Operational</div>
            <div className="mt-2 text-3xl font-bold text-emerald-400">{employees.filter((e) => e.status === "active").length}</div>
            <div className="text-sm text-slate-400">Active</div>
          </CardContent>
        </Card>
        <Card className="section-tech-stat rounded-2xl border-amber-500/20 text-center">
          <CardContent className="p-4 text-center">
            <div className="section-tech-kicker text-amber-400">Watchlist</div>
            <div className="mt-2 text-3xl font-bold text-amber-400">{employees.filter((e) => e.status === "inactive").length}</div>
            <div className="text-sm text-slate-400">Inactive</div>
          </CardContent>
        </Card>
        <Card className="section-tech-stat rounded-2xl border-slate-700/50 text-center">
          <CardContent className="p-4 text-center">
            <div className="section-tech-kicker text-slate-400">Archived</div>
            <div className="mt-2 text-3xl font-bold text-slate-400">{employees.filter((e) => e.status === "terminated").length}</div>
            <div className="text-sm text-slate-500">Terminated</div>
          </CardContent>
        </Card>
        <Card className="section-tech-stat rounded-2xl border-slate-700/50 text-center">
          <CardContent className="p-4 text-center">
            <div className="section-tech-kicker text-cyan-400">Clock Layer</div>
            <div className="mt-2 text-3xl font-bold text-cyan-400">{clockOverview.totalEvents}</div>
            <div className="text-sm text-slate-400">Clock Events Loaded</div>
          </CardContent>
        </Card>
        <Card className="section-tech-stat rounded-2xl border-slate-700/50 text-center">
          <CardContent className="p-4 text-center">
            <div className="section-tech-kicker text-purple-400">Linked Audit Trail</div>
            <div className="mt-2 text-3xl font-bold text-purple-400">{clockOverview.employeesWithClocks}</div>
            <div className="text-sm text-slate-400">Profiles With Clocks</div>
          </CardContent>
        </Card>
      </div>

      {/* Actions Bar */}
      <Card className="section-tech-panel rounded-[30px]">
        <CardContent className="p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <div className="flex flex-wrap items-start gap-4">
                <div className="relative min-w-[260px] flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    placeholder="Search employees..."
                    value={employeeSearch}
                    onChange={(e) => setEmployeeSearch(e.target.value)}
                    className="h-11 border-white/10 bg-white/5 pl-9 text-white placeholder:text-slate-400"
                  />
                </div>

                <select
                  value={employeeFilterRegion}
                  onChange={(e) => setEmployeeFilterRegion(e.target.value)}
                  className="h-11 min-w-[188px] rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100"
                >
                  <option style={{ backgroundColor: "#0f172a", color: "#f8fafc" }} value="all">
                    All Regions
                  </option>
                  {employeeLocations.regions.map((region) => (
                    <option
                      key={region}
                      value={region}
                      style={{ backgroundColor: "#0f172a", color: "#f8fafc" }}
                    >
                      {region}
                    </option>
                  ))}
                </select>

                <select
                  value={employeeFilterStatus}
                  onChange={(e) => setEmployeeFilterStatus(e.target.value)}
                  className="h-11 min-w-[118px] rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100"
                >
                  <option style={{ backgroundColor: "#0f172a", color: "#f8fafc" }} value="all">
                    All Status
                  </option>
                  <option style={{ backgroundColor: "#0f172a", color: "#f8fafc" }} value="active">
                    Active
                  </option>
                  <option style={{ backgroundColor: "#0f172a", color: "#f8fafc" }} value="inactive">
                    Inactive
                  </option>
                  <option style={{ backgroundColor: "#0f172a", color: "#f8fafc" }} value="terminated">
                    Terminated
                  </option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-start gap-2 xl:max-w-[58%] xl:justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  if (onOpenPayrollUpload) {
                    onOpenPayrollUpload();
                  }
                }}
                className="h-11 whitespace-nowrap flex items-center gap-2"
              >
                <Upload className="w-4 h-4" />
                Import payroll workbook
              </Button>

              <Button
                variant="outline"
                onClick={onOpenStaffListUpload}
                disabled={isUpdatingStaffList}
                className="h-11 whitespace-nowrap flex items-center gap-2"
              >
                <Upload className={`w-4 h-4 ${isUpdatingStaffList ? "animate-pulse" : ""}`} />
                Emergency upload and update
              </Button>

              <Button
                variant="outline"
                onClick={() => setShowUploadHistory(!showUploadHistory)}
                className="h-11 whitespace-nowrap flex items-center gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${showUploadHistory ? "animate-spin" : ""}`} />
                View History
              </Button>

              <Button
                variant="outline"
                onClick={() => void loadClockEvents()}
                disabled={isLoadingClockEvents}
                className="h-11 whitespace-nowrap flex items-center gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${isLoadingClockEvents ? "animate-spin" : ""}`} />
                Refresh clocks
              </Button>

              <Button
                onClick={() => {
                  setIsAddingEmployee(true);
                  setEditingEmployee(null);
                  resetEmployeeForm();
                }}
                className="h-11 whitespace-nowrap flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Add Employee
              </Button>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2.5 text-sm text-slate-300">
            <Badge className="border-slate-600 bg-slate-800/50 text-slate-300">{employees.length} profiles loaded</Badge>
            <Badge className="border-cyan-500/30 bg-cyan-500/10 text-cyan-400">{filteredEmployees.length} in current view</Badge>
            <Badge className="border-slate-600 bg-slate-800/50 text-slate-300">{clockOverview.totalEvents} biometric clock events</Badge>
            {isUpdatingStaffList && (
              <Badge className="border-cyan-500/30 bg-cyan-500/10 text-cyan-400">
                {staffListUploadStage || "Processing staff list workbook..."}
              </Badge>
            )}
          </div>

          {isUploadingPayroll && (
            <div className="mt-4 rounded-xl border border-slate-700 bg-slate-800/50 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-slate-300">{payrollUploadStage || "Processing payroll workbook..."}</span>
                <span className="text-sm font-bold text-cyan-400">{payrollUploadProgress}%</span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-slate-700">
                <div 
                  className="h-full rounded-full transition-all duration-300 ease-out"
                  style={{ 
                    width: `${payrollUploadProgress}%`,
                    background: 'linear-gradient(90deg, #0ea5e9, #8b5cf6)'
                  }}
                />
              </div>
            </div>
          )}

          {/* Upload History Section */}
          {showUploadHistory && (
            <Card className="mt-4 rounded-2xl">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Emergency Upload History</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowUploadHistory(false)}
                  >
                    × Close
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {staffListUploadLogs.length === 0 ? (
                  <div className="text-center text-slate-500 py-4">No upload history found.</div>
                ) : (
                  <div className="space-y-3">
                    {staffListUploadLogs.slice(0, 20).map((log: EmployeeUpdateUploadLog) => (
                      <div key={log.id} className="rounded-xl border border-slate-200 p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <div className="font-medium text-slate-900">{log.file_name}</div>
                            <div className="text-xs text-slate-500">
                              {new Date(log.created_at).toLocaleString("en-ZA")}
                              {log.rolled_back_at && <span className="ml-2 text-red-600">(Rolled back)</span>}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => onExportUploadLog?.(log.id)}
                            >
                              <Download className="w-4 h-4 mr-1" /> Export
                            </Button>
                            <Badge className="bg-blue-100 text-blue-700">{log.matched_profiles} matched</Badge>
                            <Badge className="bg-green-100 text-green-700">{log.updated_profiles} updated</Badge>
                            <Badge className="bg-red-100 text-red-700">{log.inactive_profiles} inactive</Badge>
                          </div>
                        </div>
                        <div className="flex gap-4 text-xs text-slate-600">
                          <span>Unchanged: {log.unchanged_profiles}</span>
                          <span>Unmatched: {log.unmatched_rows}</span>
                        </div>
                        {log.items && log.items.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-slate-100">
                            <div className="text-xs font-medium text-slate-700 mb-2">Changes:</div>
                            <div className="max-h-40 overflow-auto text-xs">
                              {log.items.slice(0, 10).map((item: EmployeeUpdateReportItem, idx: number) => (
                                <div key={idx} className="flex justify-between py-1 border-b border-slate-50">
                                  <span>{item.employee_code} - {item.employee_name}</span>
                                  <span className={item.change_type === "updated" ? "text-green-600" : item.change_type === "inactive" ? "text-red-600" : "text-slate-500"}>
                                    {item.change_type}
                                  </span>
                                </div>
                              ))}
                              {log.items.length > 10 && <div className="text-slate-400 mt-2">...and {log.items.length - 10} more</div>}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>

      {/* Employee Table */}
      <Card className="rounded-2xl bg-slate-900/50 border-slate-700/50">
        <CardContent className="p-0">
          <div className="rounded-xl border border-slate-700/50">
            <div className="border-b border-slate-700/50 bg-slate-800/50 px-4 py-3 text-sm text-slate-300">
              Employee directory view for imported payroll profiles.
            </div>
            <div ref={employeeTableRef} className="overflow-auto" style={{ height: '600px' }}>
              <table className="w-full min-w-[1220px]" style={{ tableLayout: 'fixed' }}>
                <thead className="bg-slate-800/80 sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-cyan-400">Employee</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-cyan-400">Code</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-cyan-400">ID Number</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-cyan-400">Role</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-cyan-400">Branch / Store</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-cyan-400">Clock History</th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-cyan-400">Status</th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-cyan-400">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedEmployees.map((employee) => {
                    const normalizedCode = normalizeEmployeeCode(employee.employee_code);
                    const clockSummary = employeeClockSummaryMap.get(normalizedCode);
                    const isSelectedClockProfile =
                      normalizeEmployeeCode(selectedClockProfileEmployee?.employee_code) === normalizedCode;

                    return (
                      <tr
                        key={employee.id}
                        className={`border-t border-slate-700/50 ${isSelectedClockProfile ? "bg-cyan-900/20" : "hover:bg-slate-800/50"}`}
                      >
                          <td className="px-4 py-3">
                            <div className="font-medium text-white">
                              {employee.first_name} {employee.last_name}
                            </div>
                            <div className="text-xs text-slate-400">
                              {[employee.alias, employee.email].filter(Boolean).join(" - ") || "No alias or email"}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm font-mono text-cyan-300">{employee.employee_code}</td>
                          <td className="px-4 py-3 text-sm font-mono text-slate-300">{employee.id_number || "-"}</td>
                          <td className="px-4 py-3 text-sm">
                            <div className="text-white">{employee.job_title || "-"}</div>
                            <div className="text-xs text-slate-400">{employee.department || employee.person_type || "-"}</div>
                          </td>
                          <td className="px-4 py-3 text-sm">
                            <div className="text-white">{employee.store || employee.branch || "-"}</div>
                            <div className="text-xs text-slate-400">{employee.branch || employee.region || employee.company || "-"}</div>
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {clockSummary ? (
                              <div className="space-y-2">
                                <div className="font-medium text-cyan-400">
                                  {clockSummary.totalEvents} event{clockSummary.totalEvents === 1 ? "" : "s"}
                                </div>
                                <div className="text-xs text-slate-400">Last clock: {formatClockAuditTimestamp(clockSummary.lastClockedAt)}</div>
                              </div>
                            ) : (
                              <div className="space-y-2">
                                <div className="font-medium text-slate-500">No clock history yet</div>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Badge
                              className={
                                employee.status === "active"
                                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                                  : employee.status === "inactive"
                                  ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                                  : "bg-slate-500/20 text-slate-400 border border-slate-500/30"
                              }
                            >
                              {employee.status}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex justify-center gap-1 flex-wrap">
                              <button
                                onClick={() => void openEmployeeClockProfile(employee)}
                                className={`flex items-center gap-1 rounded-lg border px-2 py-2 ${
                                  isSelectedClockProfile
                                    ? "border-cyan-400 bg-cyan-400/20 text-cyan-400"
                                    : "border-slate-600 text-slate-300 hover:bg-slate-700"
                                }`}
                                title="Open clock profile"
                              >
                                <ChevronRight className="w-4 h-4" />
                                <span className="text-xs font-medium">Clock profile</span>
                              </button>
                              {employee.status === "active" ? (
                                <button
                                  onClick={() => void handleSetEmployeeStatus(employee, "inactive")}
                                  className="p-2 hover:bg-amber-500/20 rounded-lg text-amber-400"
                                  title="Mark inactive"
                                >
                                  <Circle className="w-4 h-4" />
                                </button>
                              ) : (
                                <button
                                  onClick={() => void handleSetEmployeeStatus(employee, "active")}
                                  className="p-2 hover:bg-emerald-500/20 rounded-lg text-emerald-400"
                                  title="Mark active"
                                >
                                  <Check className="w-4 h-4" />
                                </button>
                              )}
                              <button
                                onClick={() => handleEditEmployee(employee)}
                                className="p-2 hover:bg-cyan-500/20 rounded-lg text-cyan-400"
                                title="Edit"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteEmployee(employee.id)}
                                className="p-2 hover:bg-red-500/20 rounded-lg text-red-400"
                                title="Delete"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
              {totalEmployeePages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-slate-700/50">
                  <div className="text-sm text-slate-400">
                    Showing {employeePage * EMPLOYEES_PER_PAGE + 1}-{Math.min((employeePage + 1) * EMPLOYEES_PER_PAGE, filteredEmployees.length)} of {filteredEmployees.length}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setEmployeePage(p => Math.max(0, p - 1))}
                      disabled={employeePage === 0}
                      className="px-3 py-1 rounded-lg border border-slate-600 text-sm text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-800"
                    >
                      Previous
                    </button>
                    <button
                      onClick={() => setEmployeePage(p => Math.min(totalEmployeePages - 1, p + 1))}
                      disabled={employeePage >= totalEmployeePages - 1}
                      className="px-3 py-1 rounded-lg border border-slate-600 text-sm text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-800"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Employee Form Modal */}
      <AnimatePresence>
        {isAddingEmployee && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => {
              setIsAddingEmployee(false);
              setEditingEmployee(null);
              resetEmployeeForm();
            }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold">{editingEmployee ? "Edit Employee" : "Add New Employee"}</h2>
                <button
                  onClick={() => {
                    setIsAddingEmployee(false);
                    setEditingEmployee(null);
                    resetEmployeeForm();
                  }}
                  className="p-2 hover:bg-slate-100 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium mb-1">Employee Code *</label>
                  <Input
                    value={employeeFormData.employee_code}
                    onChange={(e) => setEmployeeFormData({ ...employeeFormData, employee_code: e.target.value })}
                    placeholder="e.g., A2333"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Status</label>
                  <select
                    value={employeeFormData.status}
                    onChange={(e) =>
                      setEmployeeFormData({
                        ...employeeFormData,
                        status: e.target.value as "active" | "inactive" | "terminated",
                        active: e.target.value === "active",
                      })
                    }
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="terminated">Terminated</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">First Name *</label>
                  <Input
                    value={employeeFormData.first_name}
                    onChange={(e) => setEmployeeFormData({ ...employeeFormData, first_name: e.target.value })}
                    placeholder="e.g., John"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Last Name *</label>
                  <Input
                    value={employeeFormData.last_name}
                    onChange={(e) => setEmployeeFormData({ ...employeeFormData, last_name: e.target.value })}
                    placeholder="e.g., Smith"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">National ID</label>
                  <Input
                    value={employeeFormData.id_number}
                    onChange={(e) => setEmployeeFormData({ ...employeeFormData, id_number: e.target.value })}
                    placeholder="e.g., 8811265216087"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Store</label>
                  <Input
                    value={employeeFormData.store}
                    onChange={(e) => setEmployeeFormData({ ...employeeFormData, store: e.target.value })}
                    placeholder="e.g., Checkers Amanzimtoti"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Department</label>
                  <Input
                    value={employeeFormData.department}
                    onChange={(e) => setEmployeeFormData({ ...employeeFormData, department: e.target.value })}
                    placeholder="e.g., Merchandising"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Job Title</label>
                  <Input
                    value={employeeFormData.job_title}
                    onChange={(e) => setEmployeeFormData({ ...employeeFormData, job_title: e.target.value })}
                    placeholder="e.g., Merchandiser"
                  />
                </div>
              </div>

              <div className="mt-6 flex gap-3 justify-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsAddingEmployee(false);
                    setEditingEmployee(null);
                    resetEmployeeForm();
                  }}
                >
                  Cancel
                </Button>
                <Button onClick={editingEmployee ? handleUpdateEmployee : handleAddEmployee}>
                  {editingEmployee ? "Update Employee" : "Add Employee"}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Clock Profile Modal */}
      <AnimatePresence>
        {selectedClockProfileEmployee && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-950/80"
            onClick={closeEmployeeClockProfile}
          >
            <motion.div
              initial={{ x: 48, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 48, opacity: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 28 }}
              className="ml-auto flex h-full w-full max-w-[880px] flex-col bg-slate-900 border-l border-slate-700 shadow-2xl overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-b border-slate-700 px-4 py-4 sm:px-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-400">Employee Clock Profile</div>
                    <h2 className="mt-1 text-2xl font-bold text-white">
                      {selectedClockProfileEmployee.first_name} {selectedClockProfileEmployee.last_name}
                    </h2>
                  </div>
                  <button onClick={closeEmployeeClockProfile} className="rounded-xl border border-slate-600 p-2 text-slate-300 hover:bg-slate-800">
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>
              <div className="p-6">
                {isLoadingClockProfile ? (
                  <div className="text-center py-8 text-slate-400">
                    <RefreshCw className="w-8 h-8 mx-auto mb-4 animate-spin text-cyan-400" />
                    <p>{clockProfileLoadMessage}</p>
                  </div>
                ) : selectedClockProfileTimeline.length === 0 ? (
                  <div className="text-center py-8 text-slate-400">No clock events found.</div>
                ) : (
                  <div className="space-y-4">
                    {selectedClockProfileTimeline.map((group) => (
                      <div key={group.dateKey} className="rounded-2xl border border-slate-700 bg-slate-800/50 p-4">
                        <div className="flex items-center justify-between">
                          <div className="font-semibold text-white">{formatClockAuditDateLabel(group.dateKey)}</div>
                          <Badge className="bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">{group.events.length} events</Badge>
                        </div>
                        <div className="mt-3 space-y-2">
                          {group.events.map((event) => (
                            <div key={event.event_key} className="rounded-lg bg-slate-800/80 p-3 text-sm border border-slate-700">
                              <div className="font-medium text-cyan-400">{formatClockAuditTimestamp(event.clocked_at)}</div>
                              <div className="text-slate-400">
                                {event.store} • {event.device_name}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
