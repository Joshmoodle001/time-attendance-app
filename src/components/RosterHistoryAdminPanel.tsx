import { useEffect, useMemo, useState } from "react";
import { Beaker, Clock3, GitBranch, RefreshCw, Search, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  buildHistoricalRosterSources,
  buildHistoricalRosterStatusLookup,
  getShiftRosterChangeEvents,
  getShiftRosterHistory,
  matchHistoricalRosterSourceForDate,
  type HistoricalRosterSource,
  type ShiftDayKey,
  type ShiftRoster,
  type ShiftRosterChangeEvent,
  type ShiftRosterHistoryEntry,
  type ShiftRow,
} from "@/services/shifts";
import { getWeekCycleLabel } from "@/services/calendar";
import { getEmployeeStatusHistory, type EmployeeStatusHistoryEntry } from "@/services/database";

const DAY_KEYS: ShiftDayKey[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

const DAY_OPTIONS: Array<{ key: ShiftDayKey; label: string }> = [
  { key: "monday", label: "Monday" },
  { key: "tuesday", label: "Tuesday" },
  { key: "wednesday", label: "Wednesday" },
  { key: "thursday", label: "Thursday" },
  { key: "friday", label: "Friday" },
  { key: "saturday", label: "Saturday" },
  { key: "sunday", label: "Sunday" },
];

type SimulationForm = {
  employeeCode: string;
  employeeName: string;
  sheetName: string;
  storeName: string;
  storeCode: string;
  beforeEffectiveFrom: string;
  changeEffectiveFrom: string;
  reportStart: string;
  reportEnd: string;
  beforeOffDay: ShiftDayKey;
  afterOffDay: ShiftDayKey;
  shiftLabel: string;
  inactiveFrom: string;
};

type SimulationRow = {
  dateKey: string;
  weekdayLabel: string;
  weekLabel: string;
  rosterLabel: string;
  statusLabel: string;
  rosterVersionFrom: string;
  profileStatus: string;
};

function normalizeText(value: unknown) {
  return value === null || value === undefined ? "" : String(value).replace(/\s+/g, " ").trim();
}

function normalizeCompare(value: unknown) {
  return normalizeText(value).toLowerCase();
}

function formatDateOnly(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function formatDateLabel(dateKey: string) {
  if (!dateKey) return "-";
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return date.toLocaleDateString("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatTimestamp(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-ZA", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getWeekNumberForDate(dateKey: string) {
  const label = getWeekCycleLabel(new Date(`${dateKey}T00:00:00`)).toUpperCase();
  const match = label.match(/(\d+)/);
  return match ? Number(match[1]) : 1;
}

function getShiftDayKey(dateKey: string): ShiftDayKey {
  const date = new Date(`${dateKey}T00:00:00`);
  return DAY_KEYS[(date.getDay() + 6) % 7];
}

function buildSimulationDayValues(offDay: ShiftDayKey) {
  return DAY_KEYS.reduce<Record<ShiftDayKey, string>>(
    (acc, dayKey) => {
      if (dayKey === offDay || dayKey === "saturday" || dayKey === "sunday") {
        acc[dayKey] = "OFF";
      } else {
        acc[dayKey] = "X";
      }
      return acc;
    },
    {
      monday: "X",
      tuesday: "X",
      wednesday: "X",
      thursday: "X",
      friday: "X",
      saturday: "OFF",
      sunday: "OFF",
    }
  );
}

function buildExpectedHours(timeLabel: string, values: Record<ShiftDayKey, string>) {
  return DAY_KEYS.reduce<Record<ShiftDayKey, number>>(
    (acc, dayKey) => {
      const normalized = normalizeText(values[dayKey]).toUpperCase();
      acc[dayKey] = normalized === "OFF" ? 0 : normalizeText(timeLabel) ? 8 : 0;
      return acc;
    },
    {
      monday: 0,
      tuesday: 0,
      wednesday: 0,
      thursday: 0,
      friday: 0,
      saturday: 0,
      sunday: 0,
    }
  );
}

function buildSimulationRows(
  employeeCode: string,
  employeeName: string,
  shiftLabel: string,
  offDay: ShiftDayKey
) {
  const values = buildSimulationDayValues(offDay);

  return [1, 2, 3, 4].map<ShiftRow>((weekNumber) => ({
    id: `sim-row-${employeeCode}-${weekNumber}-${offDay}`,
    row_key: `sim-${employeeCode}-week-${weekNumber}`,
    group_key: `sim-${employeeCode}-group`,
    week_number: weekNumber,
    week_label: `WEEK ${weekNumber}`,
    order_index: weekNumber - 1,
    employee_name: employeeName,
    employee_code: employeeCode,
    department: "Simulation",
    hr: "Simulation",
    time_label: shiftLabel,
    monday: values.monday,
    tuesday: values.tuesday,
    wednesday: values.wednesday,
    thursday: values.thursday,
    friday: values.friday,
    saturday: values.saturday,
    sunday: values.sunday,
    notes: "Sandbox preview only",
    expected_hours: buildExpectedHours(shiftLabel, values),
    extra_columns: {},
    logs: [],
  }));
}

function getRosterLabelForDate(source: HistoricalRosterSource | null, dateKey: string) {
  if (!source) return "Unscheduled";
  const weekRow = source.weekRows.get(getWeekNumberForDate(dateKey));
  if (!weekRow) return "Unscheduled";
  const dayKey = getShiftDayKey(dateKey);
  const value = normalizeText(weekRow[dayKey]).toUpperCase();
  if (!value) return "Unscheduled";
  if (value === "OFF") return "< off >";
  if (value === "X") return weekRow.time_label || "Scheduled";
  return value;
}

function parseDateKey(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildDateRange(startDate: string, endDate: string) {
  const start = parseDateKey(startDate);
  const end = parseDateKey(endDate);
  if (!start || !end || start > end) return [];

  const rows: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    rows.push(formatDateOnly(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return rows;
}

function getStatusBadgeClass(value: string) {
  const normalized = normalizeCompare(value);
  if (normalized.includes("inactive")) return "bg-amber-500/15 text-amber-300 border-amber-500/30";
  if (normalized.includes("terminated")) return "bg-red-500/15 text-red-300 border-red-500/30";
  if (normalized.includes("day off")) return "bg-sky-500/15 text-sky-300 border-sky-500/30";
  if (normalized.includes("scheduled")) return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  return "bg-slate-500/15 text-slate-300 border-slate-500/30";
}

export default function RosterHistoryAdminPanel() {
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [historyEntries, setHistoryEntries] = useState<ShiftRosterHistoryEntry[]>([]);
  const [changeEvents, setChangeEvents] = useState<ShiftRosterChangeEvent[]>([]);
  const [employeeStatusHistory, setEmployeeStatusHistory] = useState<EmployeeStatusHistoryEntry[]>([]);
  const [historySearch, setHistorySearch] = useState("");
  const [eventSearch, setEventSearch] = useState("");
  const [statusSearch, setStatusSearch] = useState("");
  const [simulation, setSimulation] = useState<SimulationForm>({
    employeeCode: "SIM001",
    employeeName: "Simulation User",
    sheetName: "SIMULATION SHEET",
    storeName: "Simulation Store",
    storeCode: "SIM-001",
    beforeEffectiveFrom: "2026-04-01",
    changeEffectiveFrom: "2026-04-17",
    reportStart: "2026-04-14",
    reportEnd: "2026-04-24",
    beforeOffDay: "tuesday",
    afterOffDay: "friday",
    shiftLabel: "08-16",
    inactiveFrom: "",
  });

  const loadHistory = async (refresh = false) => {
    if (refresh) setIsRefreshing(true);
    else setIsLoading(true);
    setErrorMessage("");

    try {
      const [nextHistory, nextEvents, nextEmployeeStatusHistory] = await Promise.all([
        getShiftRosterHistory(),
        getShiftRosterChangeEvents(),
        getEmployeeStatusHistory(),
      ]);
      setHistoryEntries(nextHistory);
      setChangeEvents(nextEvents);
      setEmployeeStatusHistory(nextEmployeeStatusHistory);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load history data.");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void loadHistory();
  }, []);

  const filteredHistoryEntries = useMemo(() => {
    const query = normalizeCompare(historySearch);
    return historyEntries.filter((entry) => {
      if (!query) return true;
      return [
        entry.sheet_name,
        entry.store_name,
        entry.store_code,
        entry.source_file_name,
        entry.effective_from,
        entry.effective_to || "",
      ].some((value) => normalizeCompare(value).includes(query));
    });
  }, [historyEntries, historySearch]);

  const filteredChangeEvents = useMemo(() => {
    const query = normalizeCompare(eventSearch);
    return changeEvents.filter((entry) => {
      if (!query) return true;
      return [
        entry.employee_code,
        entry.employee_name,
        entry.field,
        entry.before,
        entry.after,
        entry.sheet_name,
        entry.store_name,
        entry.change_type,
        entry.effective_from,
      ].some((value) => normalizeCompare(value).includes(query));
    });
  }, [changeEvents, eventSearch]);

  const filteredEmployeeStatusHistory = useMemo(() => {
    const query = normalizeCompare(statusSearch);
    return employeeStatusHistory.filter((entry) => {
      if (!query) return true;
      return [
        entry.employee_code,
        entry.before_status,
        entry.after_status,
        entry.store,
        entry.store_code,
        entry.termination_reason || "",
        entry.termination_date || "",
      ].some((value) => normalizeCompare(value).includes(query));
    });
  }, [employeeStatusHistory, statusSearch]);

  const simulationPreview = useMemo(() => {
    const employeeCode = normalizeText(simulation.employeeCode).toUpperCase();
    const employeeName = normalizeText(simulation.employeeName) || "Simulation User";
    const sheetName = normalizeText(simulation.sheetName) || "SIMULATION SHEET";
    const storeName = normalizeText(simulation.storeName) || sheetName;
    const storeCode = normalizeText(simulation.storeCode);
    const shiftLabel = normalizeText(simulation.shiftLabel) || "08-16";

    if (!employeeCode) {
      return { rows: [] as SimulationRow[], warning: "Employee code is required for the sandbox preview." };
    }

    const beforeDate = parseDateKey(simulation.beforeEffectiveFrom);
    const changeDate = parseDateKey(simulation.changeEffectiveFrom);
    if (!beforeDate || !changeDate) {
      return { rows: [] as SimulationRow[], warning: "Both effective dates must be valid." };
    }
    if (changeDate <= beforeDate) {
      return { rows: [] as SimulationRow[], warning: "Change effective date must be after the initial effective date." };
    }

    const dateRange = buildDateRange(simulation.reportStart, simulation.reportEnd);
    if (dateRange.length === 0) {
      return { rows: [] as SimulationRow[], warning: "Report range must contain at least one valid date." };
    }

    const previousEffectiveTo = formatDateOnly(new Date(changeDate.getTime() - 86400000));
    const beforeRows = buildSimulationRows(employeeCode, employeeName, shiftLabel, simulation.beforeOffDay);
    const afterRows = buildSimulationRows(employeeCode, employeeName, shiftLabel, simulation.afterOffDay);

    const currentRoster: ShiftRoster = {
      id: "simulation-current",
      sheet_name: sheetName,
      store_name: storeName,
      store_code: storeCode,
      source_file_name: "simulation-after.xlsx",
      custom_columns: [],
      rows: afterRows,
      updated_at: `${simulation.changeEffectiveFrom}T08:00:00.000Z`,
      import_summary: {
        imported_rows: afterRows.length,
        updated_rows: afterRows.length,
        preserved_rows: 0,
      },
    };

    const syntheticHistory: ShiftRosterHistoryEntry[] = [
      {
        id: "simulation-history-before",
        snapshot_key: `${sheetName}__${simulation.beforeEffectiveFrom}`,
        sheet_name: sheetName,
        store_name: storeName,
        store_code: storeCode,
        source_file_name: "simulation-before.xlsx",
        custom_columns: [],
        rows: beforeRows,
        updated_at: `${simulation.beforeEffectiveFrom}T08:00:00.000Z`,
        import_summary: {
          imported_rows: beforeRows.length,
          updated_rows: beforeRows.length,
          preserved_rows: 0,
        },
        effective_from: simulation.beforeEffectiveFrom,
        effective_to: previousEffectiveTo,
        changed_at: `${simulation.beforeEffectiveFrom}T08:00:00.000Z`,
      },
      {
        id: "simulation-history-after",
        snapshot_key: `${sheetName}__${simulation.changeEffectiveFrom}`,
        sheet_name: sheetName,
        store_name: storeName,
        store_code: storeCode,
        source_file_name: "simulation-after.xlsx",
        custom_columns: [],
        rows: afterRows,
        updated_at: `${simulation.changeEffectiveFrom}T08:00:00.000Z`,
        import_summary: {
          imported_rows: afterRows.length,
          updated_rows: afterRows.length,
          preserved_rows: 0,
        },
        effective_from: simulation.changeEffectiveFrom,
        effective_to: null,
        changed_at: `${simulation.changeEffectiveFrom}T08:00:00.000Z`,
      },
    ];

    const sources =
      buildHistoricalRosterSources([currentRoster], syntheticHistory).get(employeeCode) || [];

    const rows = dateRange.map<SimulationRow>((dateKey) => {
      const lookup = buildHistoricalRosterStatusLookup([currentRoster], syntheticHistory, dateKey).get(employeeCode);
      const source = matchHistoricalRosterSourceForDate({ store: storeName, store_code: storeCode }, sources, dateKey);
      const rosterLabel = getRosterLabelForDate(source, dateKey);
      const inactiveFrom = normalizeText(simulation.inactiveFrom);
      const profileStatus = inactiveFrom && dateKey >= inactiveFrom ? "Inactive" : "Active";
      const statusLabel = lookup?.dayOff
        ? "Day Off"
        : lookup?.leave
          ? "Leave"
          : lookup?.scheduled
            ? "Scheduled"
            : "Unscheduled";

      return {
        dateKey,
        weekdayLabel: DAY_OPTIONS.find((option) => option.key === getShiftDayKey(dateKey))?.label || "-",
        weekLabel: getWeekCycleLabel(new Date(`${dateKey}T00:00:00`)).toUpperCase(),
        rosterLabel,
        statusLabel,
        rosterVersionFrom: source?.effectiveFrom || "",
        profileStatus,
      };
    });

    return {
      rows,
      warning: "",
      sources,
    };
  }, [simulation]);

  const latestHistoryDate = historyEntries[0]?.changed_at || "";
  const latestChangeDate = changeEvents[0]?.changed_at || "";
  const latestStatusDate = employeeStatusHistory[0]?.changed_at || "";

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl border-slate-700 bg-slate-900/50">
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-white">
              <GitBranch className="h-5 w-5" />
              Roster History Controls
            </CardTitle>
            <CardDescription className="text-slate-400">
              Inspect effective-dated roster history, field-level roster changes, and employee status transitions.
            </CardDescription>
          </div>
          <Button variant="outline" onClick={() => void loadHistory(true)} disabled={isLoading || isRefreshing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            Refresh History
          </Button>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4">
            <div className="text-xs uppercase tracking-[0.2em] text-cyan-300">Roster Snapshots</div>
            <div className="mt-2 text-3xl font-semibold text-white">{historyEntries.length}</div>
            <div className="mt-1 text-sm text-slate-300">
              Latest change: {latestHistoryDate ? formatTimestamp(latestHistoryDate) : "Not recorded"}
            </div>
          </div>
          <div className="rounded-2xl border border-violet-500/20 bg-violet-500/10 p-4">
            <div className="text-xs uppercase tracking-[0.2em] text-violet-300">Field Change Events</div>
            <div className="mt-2 text-3xl font-semibold text-white">{changeEvents.length}</div>
            <div className="mt-1 text-sm text-slate-300">
              Latest event: {latestChangeDate ? formatTimestamp(latestChangeDate) : "Not recorded"}
            </div>
          </div>
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
            <div className="text-xs uppercase tracking-[0.2em] text-amber-300">Employee Status Events</div>
            <div className="mt-2 text-3xl font-semibold text-white">{employeeStatusHistory.length}</div>
            <div className="mt-1 text-sm text-slate-300">
              Latest event: {latestStatusDate ? formatTimestamp(latestStatusDate) : "Not recorded"}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-slate-700 bg-slate-900/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <Beaker className="h-5 w-5" />
            Sandbox Roster Change Lab
          </CardTitle>
          <CardDescription className="text-slate-400">
            This test lab does not write to live shift rosters, roster history, or employee tables. It runs the historical lookup logic entirely in memory.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">Employee Code</label>
              <Input
                value={simulation.employeeCode}
                onChange={(event) => setSimulation((current) => ({ ...current, employeeCode: event.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">Employee Name</label>
              <Input
                value={simulation.employeeName}
                onChange={(event) => setSimulation((current) => ({ ...current, employeeName: event.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">Sheet Name</label>
              <Input
                value={simulation.sheetName}
                onChange={(event) => setSimulation((current) => ({ ...current, sheetName: event.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">Store Code</label>
              <Input
                value={simulation.storeCode}
                onChange={(event) => setSimulation((current) => ({ ...current, storeCode: event.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">Store Name</label>
              <Input
                value={simulation.storeName}
                onChange={(event) => setSimulation((current) => ({ ...current, storeName: event.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">Initial Effective From</label>
              <Input
                type="date"
                value={simulation.beforeEffectiveFrom}
                onChange={(event) => setSimulation((current) => ({ ...current, beforeEffectiveFrom: event.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">Change Effective From</label>
              <Input
                type="date"
                value={simulation.changeEffectiveFrom}
                onChange={(event) => setSimulation((current) => ({ ...current, changeEffectiveFrom: event.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">Inactive From (Optional)</label>
              <Input
                type="date"
                value={simulation.inactiveFrom}
                onChange={(event) => setSimulation((current) => ({ ...current, inactiveFrom: event.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">Report Start</label>
              <Input
                type="date"
                value={simulation.reportStart}
                onChange={(event) => setSimulation((current) => ({ ...current, reportStart: event.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">Report End</label>
              <Input
                type="date"
                value={simulation.reportEnd}
                onChange={(event) => setSimulation((current) => ({ ...current, reportEnd: event.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">Before Change Off Day</label>
              <select
                value={simulation.beforeOffDay}
                onChange={(event) => setSimulation((current) => ({ ...current, beforeOffDay: event.target.value as ShiftDayKey }))}
                className="flex h-11 w-full rounded-xl border border-white/10 bg-[#0d1117] px-3.5 py-2.5 text-[15px] text-white"
              >
                {DAY_OPTIONS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">After Change Off Day</label>
              <select
                value={simulation.afterOffDay}
                onChange={(event) => setSimulation((current) => ({ ...current, afterOffDay: event.target.value as ShiftDayKey }))}
                className="flex h-11 w-full rounded-xl border border-white/10 bg-[#0d1117] px-3.5 py-2.5 text-[15px] text-white"
              >
                {DAY_OPTIONS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">Shift Label</label>
              <Input
                value={simulation.shiftLabel}
                onChange={(event) => setSimulation((current) => ({ ...current, shiftLabel: event.target.value }))}
              />
            </div>
          </div>

          {simulationPreview.warning ? (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
              {simulationPreview.warning}
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-200">
                Sandbox preview uses one synthetic employee and two synthetic roster versions. It is safe to use on production because nothing is saved.
              </div>
              <div className="overflow-x-auto rounded-2xl border border-white/10">
                <table className="min-w-full divide-y divide-white/10 text-sm">
                  <thead className="bg-white/5">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold text-slate-200">Date</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-200">Day</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-200">Week</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-200">Roster</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-200">Version From</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-200">Roster Status</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-200">Profile Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {simulationPreview.rows.map((row) => (
                      <tr key={row.dateKey} className="bg-slate-950/40">
                        <td className="px-4 py-3 text-slate-200">{formatDateLabel(row.dateKey)}</td>
                        <td className="px-4 py-3 text-slate-300">{row.weekdayLabel}</td>
                        <td className="px-4 py-3 text-slate-300">{row.weekLabel}</td>
                        <td className="px-4 py-3 text-slate-200">{row.rosterLabel}</td>
                        <td className="px-4 py-3 text-cyan-300">{row.rosterVersionFrom || "-"}</td>
                        <td className="px-4 py-3">
                          <Badge className={getStatusBadgeClass(row.statusLabel)}>{row.statusLabel}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Badge className={getStatusBadgeClass(row.profileStatus)}>{row.profileStatus}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="rounded-2xl border-slate-700 bg-slate-900/50 xl:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <Search className="h-5 w-5" />
              Roster Snapshots
            </CardTitle>
            <CardDescription className="text-slate-400">
              Every roster version with its effective date range.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              placeholder="Search sheet, store, code, file, or date..."
              value={historySearch}
              onChange={(event) => setHistorySearch(event.target.value)}
            />
            <div className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
              {filteredHistoryEntries.slice(0, 120).map((entry) => (
                <div key={entry.id} className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-white">{entry.sheet_name}</div>
                      <div className="text-xs text-slate-400">
                        {entry.store_name || "No store"} {entry.store_code ? `(${entry.store_code})` : ""}
                      </div>
                    </div>
                    <Badge className="bg-cyan-500/15 text-cyan-300 border-cyan-500/30">{entry.rows.length} rows</Badge>
                  </div>
                  <div className="mt-3 space-y-1 text-xs text-slate-300">
                    <div>Effective: {entry.effective_from} to {entry.effective_to || "open"}</div>
                    <div>Changed: {formatTimestamp(entry.changed_at)}</div>
                    <div>Source: {entry.source_file_name || "Manual / current snapshot"}</div>
                  </div>
                </div>
              ))}
              {!isLoading && filteredHistoryEntries.length === 0 && (
                <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4 text-sm text-slate-400">
                  No roster history matches this filter.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-slate-700 bg-slate-900/50 xl:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <Clock3 className="h-5 w-5" />
              Change Events
            </CardTitle>
            <CardDescription className="text-slate-400">
              Field-level roster changes logged during imports and updates.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              placeholder="Search employee, field, value, type, or date..."
              value={eventSearch}
              onChange={(event) => setEventSearch(event.target.value)}
            />
            <div className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
              {filteredChangeEvents.slice(0, 120).map((entry) => (
                <div key={entry.id} className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-white">
                        {entry.employee_code || "No code"} {entry.employee_name ? `- ${entry.employee_name}` : ""}
                      </div>
                      <div className="text-xs text-slate-400">
                        {entry.sheet_name} {entry.week_label ? `- ${entry.week_label}` : ""}
                      </div>
                    </div>
                    <Badge className={getStatusBadgeClass(entry.change_type)}>{entry.change_type}</Badge>
                  </div>
                  <div className="mt-3 space-y-1 text-xs text-slate-300">
                    <div>
                      Field: <span className="text-white">{entry.field}</span>
                    </div>
                    <div>
                      Before: <span className="text-slate-400">{entry.before || "<blank>"}</span>
                    </div>
                    <div>
                      After: <span className="text-white">{entry.after || "<blank>"}</span>
                    </div>
                    <div>Effective from: {entry.effective_from}</div>
                    <div>Changed: {formatTimestamp(entry.changed_at)}</div>
                  </div>
                </div>
              ))}
              {!isLoading && filteredChangeEvents.length === 0 && (
                <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4 text-sm text-slate-400">
                  No roster change events match this filter.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-slate-700 bg-slate-900/50 xl:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <ShieldAlert className="h-5 w-5" />
              Employee Status History
            </CardTitle>
            <CardDescription className="text-slate-400">
              Active, inactive, and terminated status transitions are preserved here.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              placeholder="Search employee, status, store, or reason..."
              value={statusSearch}
              onChange={(event) => setStatusSearch(event.target.value)}
            />
            <div className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
              {filteredEmployeeStatusHistory.slice(0, 120).map((entry) => (
                <div key={entry.id} className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-white">{entry.employee_code}</div>
                      <div className="text-xs text-slate-400">
                        {entry.store || "No store"} {entry.store_code ? `(${entry.store_code})` : ""}
                      </div>
                    </div>
                    <Badge className={getStatusBadgeClass(entry.after_status)}>{entry.after_status}</Badge>
                  </div>
                  <div className="mt-3 space-y-1 text-xs text-slate-300">
                    <div>
                      Transition: <span className="text-slate-400">{entry.before_status || "new"}</span> to{" "}
                      <span className="text-white">{entry.after_status}</span>
                    </div>
                    <div>Effective from: {entry.effective_from}</div>
                    <div>Changed: {formatTimestamp(entry.changed_at)}</div>
                    {entry.termination_date ? <div>Termination date: {entry.termination_date}</div> : null}
                    {entry.termination_reason ? <div>Reason: {entry.termination_reason}</div> : null}
                  </div>
                </div>
              ))}
              {!isLoading && filteredEmployeeStatusHistory.length === 0 && (
                <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4 text-sm text-slate-400">
                  No employee status history matches this filter.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {errorMessage ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {errorMessage}
        </div>
      ) : null}
    </div>
  );
}
