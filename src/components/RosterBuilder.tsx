import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getShiftRosters, initializeShiftDatabase, type ShiftDayKey, type ShiftRoster, type ShiftRow } from "@/services/shifts";
import { formatDateKey, getCombinedCalendarEvents, getMonthDays, getWeekEventForDate, type CalendarEvent } from "@/services/calendar";
import {
  buildAppliedLeaveLookup,
  getAppliedLeaveApplications,
  getFallbackLeaveLookupKey,
  getSheetScopedLeaveLookupKey,
  initializeLeaveDatabase,
  type LeaveApplication,
} from "@/services/leave";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAY_NAMES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const DAY_KEYS: ShiftDayKey[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

type RosterEmployee = {
  employeeCode: string;
  employeeName: string;
  storeName: string;
  weekRows: Map<number, ShiftRow>;
};

function normalizeText(value: unknown) {
  return value === null || value === undefined ? "" : String(value).replace(/\s+/g, " ").trim();
}

function parseShiftLength(timeLabel: string) {
  const clean = normalizeText(timeLabel).toLowerCase();
  const match = clean.match(/(\d{1,2})(?::(\d{2}))?\s*[-\u2013]\s*(\d{1,2})(?::(\d{2}))?/);
  if (!match) return null;

  const start = Number(match[1]) + Number(match[2] || 0) / 60;
  let end = Number(match[3]) + Number(match[4] || 0) / 60;
  if (end <= start) end += 12;
  if (end <= start) end += 12;
  return Number(Math.max(0, end - start - 1).toFixed(1));
}

function getHoursForShiftRow(row: ShiftRow | undefined, day: ShiftDayKey) {
  if (!row) return 0;
  const raw = normalizeText(row[day]).toUpperCase();
  if (!raw || raw === "OFF") return 0;
  if (day === "saturday") return 6;
  if (day === "sunday") return 5.5;
  if (raw === "X") return parseShiftLength(row.time_label) ?? 0;
  return parseShiftLength(row[day]) ?? 0;
}

function formatHours(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function toSmartTimeLabel(timeLabel: string, day: ShiftDayKey) {
  const clean = normalizeText(timeLabel);
  if (!clean || clean.toUpperCase() === "OFF") return "Day Off";

  const match = clean.match(/(\d{1,2})(?::(\d{2}))?\s*[-\u2013]\s*(\d{1,2})(?::(\d{2}))?/);
  if (!match) return clean;

  const startHour = Number(match[1]);
  const startMinute = Number(match[2] || 0);
  let endHour = Number(match[3]);
  const endMinute = Number(match[4] || 0);
  let numericEnd = endHour + endMinute / 60;
  const numericStart = startHour + startMinute / 60;
  if (numericEnd <= numericStart) numericEnd += 12;
  if (numericEnd <= numericStart) numericEnd += 12;
  endHour = Math.floor(numericEnd % 24);

  const startLabel = `${String(startHour).padStart(2, "0")}${startMinute ? `:${String(startMinute).padStart(2, "0")}` : ""}`;
  const endLabel = `${String(endHour).padStart(2, "0")}${endMinute ? `:${String(endMinute).padStart(2, "0")}` : ""}`;
  return day === "sunday" ? `PFM\nSun ${startLabel}-${endLabel}` : `PFM\n${startLabel}-${endLabel}`;
}

function getDayValue(row: ShiftRow | undefined, day: ShiftDayKey) {
  if (!row) return "";
  const raw = normalizeText(row[day]).toUpperCase();
  if (!raw || raw === "OFF") return "Day Off";
  if (raw === "X") return toSmartTimeLabel(row.time_label, day);
  return toSmartTimeLabel(row[day], day);
}

function getDateWeekdayKey(date: Date) {
  return DAY_KEYS[(date.getDay() + 6) % 7];
}

function getMonthLabel(date: Date) {
  return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

function getWeekNumberFromLabel(label: string) {
  return Number(label.replace(/\D/g, "")) || 0;
}

function getWeekToneClasses(weekNumber: number) {
  if (weekNumber === 1) {
    return {
      week: "bg-cyan-50 text-cyan-700",
      date: "bg-cyan-50/50",
      shift: "bg-cyan-50/40 text-slate-700",
      hours: "bg-cyan-100/60",
    };
  }
  if (weekNumber === 2) {
    return {
      week: "bg-emerald-50 text-emerald-700",
      date: "bg-emerald-50/50",
      shift: "bg-emerald-50/40 text-slate-700",
      hours: "bg-emerald-100/60",
    };
  }
  if (weekNumber === 3) {
    return {
      week: "bg-amber-50 text-amber-700",
      date: "bg-amber-50/50",
      shift: "bg-amber-50/40 text-slate-700",
      hours: "bg-amber-100/60",
    };
  }
  if (weekNumber === 4) {
    return {
      week: "bg-violet-50 text-violet-700",
      date: "bg-violet-50/50",
      shift: "bg-violet-50/40 text-slate-700",
      hours: "bg-violet-100/60",
    };
  }
  return {
    week: "bg-white text-slate-700",
    date: "bg-white",
    shift: "bg-white text-slate-700",
    hours: "bg-slate-50",
  };
}

function getWeekBoundaryClasses(currentWeekNumber: number, previousWeekNumber: number | null) {
  if (previousWeekNumber === null || previousWeekNumber !== currentWeekNumber) {
    return "border-l-2 border-l-slate-300";
  }
  return "";
}

export default function RosterBuilder() {
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const mobileWrapRef = useRef<HTMLDivElement | null>(null);
  const [rosters, setRosters] = useState<ShiftRoster[]>([]);
  const [leaveApplications, setLeaveApplications] = useState<LeaveApplication[]>([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [rosterSearch, setRosterSearch] = useState("");
  const [mobileExpandedEmployees, setMobileExpandedEmployees] = useState<Record<string, boolean>>({});
  const [currentMonth, setCurrentMonth] = useState(() => new Date(2026, new Date().getMonth(), 1));

  useEffect(() => {
    let alive = true;
    const load = async () => {
      await Promise.all([initializeShiftDatabase(), initializeLeaveDatabase()]);
      const [loaded, loadedLeaveApplications] = await Promise.all([getShiftRosters(), getAppliedLeaveApplications()]);
      if (!alive) return;
      setRosters(loaded);
      setLeaveApplications(loadedLeaveApplications);
      if (loaded[0]) setSelectedSheet((current) => current || loaded[0].sheet_name);
    };
    load();
    return () => {
      alive = false;
    };
  }, []);

  const selectedRoster = useMemo(
    () => rosters.find((roster) => roster.sheet_name === selectedSheet) || rosters[0] || null,
    [rosters, selectedSheet]
  );

  const allCalendarEvents = useMemo(() => getCombinedCalendarEvents([2026]), []);
  const eventMap = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    allCalendarEvents.forEach((event) => {
      if (!map.has(event.date)) map.set(event.date, []);
      map.get(event.date)!.push(event);
    });
    return map;
  }, [allCalendarEvents]);

  const monthDays = useMemo(() => getMonthDays(currentMonth), [currentMonth]);
  const leaveLookup = useMemo(() => buildAppliedLeaveLookup(leaveApplications), [leaveApplications]);

  const getAppliedLeaveForDate = (employeeCode: string, dateKey: string, sheetName: string) =>
    leaveLookup.get(getSheetScopedLeaveLookupKey(sheetName, employeeCode, dateKey)) ||
    leaveLookup.get(getFallbackLeaveLookupKey(employeeCode, dateKey)) ||
    null;

  const rosterEmployees = useMemo(() => {
    if (!selectedRoster) return [];
    const employeeMap = new Map<string, RosterEmployee>();

    selectedRoster.rows.forEach((row) => {
      const employeeCode = normalizeText(row.employee_code);
      if (!employeeCode) return;
      if (!employeeMap.has(employeeCode)) {
        employeeMap.set(employeeCode, {
          employeeCode,
          employeeName: normalizeText(row.employee_name) || "Unnamed merchandiser",
          storeName: selectedRoster.store_name || selectedRoster.sheet_name,
          weekRows: new Map<number, ShiftRow>(),
        });
      }

      const current = employeeMap.get(employeeCode)!;
      current.employeeName = normalizeText(row.employee_name) || current.employeeName;
      current.weekRows.set(row.week_number, row);
    });

    return Array.from(employeeMap.values()).sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  }, [selectedRoster]);

  const rosterSearchResults = useMemo(() => {
    const query = normalizeText(rosterSearch).toLowerCase();
    if (!query) return [];

    const results: Array<{
      id: string;
      type: "store" | "employee";
      sheetName: string;
      employeeCode?: string;
      title: string;
      subtitle: string;
    }> = [];

    rosters.forEach((roster) => {
      const storeLabel = `${roster.store_name} ${roster.sheet_name} ${roster.store_code}`.toLowerCase();
      if (storeLabel.includes(query)) {
        results.push({
          id: `store-${roster.sheet_name}`,
          type: "store",
          sheetName: roster.sheet_name,
          title: roster.store_name || roster.sheet_name,
          subtitle: roster.store_code ? `Store code ${roster.store_code}` : "Roster store",
        });
      }

      const seen = new Set<string>();
      roster.rows.forEach((row) => {
        const employeeCode = normalizeText(row.employee_code);
        const employeeName = normalizeText(row.employee_name);
        const key = employeeCode || `${roster.sheet_name}-${employeeName}`;
        if (seen.has(key)) return;
        const haystack = `${employeeName} ${employeeCode} ${roster.store_name}`.toLowerCase();
        if (haystack.includes(query)) {
          seen.add(key);
          results.push({
            id: `employee-${roster.sheet_name}-${key}`,
            type: "employee",
            sheetName: roster.sheet_name,
            employeeCode,
            title: employeeName || employeeCode || "Unnamed merchandiser",
            subtitle: `${employeeCode || "No code"} • ${roster.store_name || roster.sheet_name}`,
          });
        }
      });
    });

    return results.slice(0, 10);
  }, [rosters, rosterSearch]);

  const todayKey = formatDateKey(new Date());

  useEffect(() => {
    const wrapper = tableWrapRef.current;
    if (!wrapper) return;
    const activeCell = wrapper.querySelector<HTMLElement>(`[data-roster-date="${todayKey}"]`);
    if (activeCell) {
      activeCell.scrollIntoView({ block: "nearest", inline: "center" });
    }
  }, [todayKey, currentMonth, selectedRoster]);

  const handleRosterSearchGo = (result: { sheetName: string; employeeCode?: string }) => {
    setSelectedSheet(result.sheetName);
    window.setTimeout(() => {
      if (result.employeeCode) {
        const target = tableWrapRef.current?.querySelector<HTMLElement>(`[data-roster-employee="${result.employeeCode}"]`);
        const mobileTarget = mobileWrapRef.current?.querySelector<HTMLElement>(
          `[data-roster-mobile-employee="${result.employeeCode}"]`
        );
        (target || mobileTarget)?.scrollIntoView({ block: "center", inline: "nearest" });
      } else {
        tableWrapRef.current?.scrollTo({ left: 0, behavior: "smooth" });
        mobileWrapRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      }
    }, 80);
  };

  const toggleMobileEmployee = (employeeCode: string) => {
    setMobileExpandedEmployees((current) => ({ ...current, [employeeCode]: !current[employeeCode] }));
  };

  const buildPdfTable = (monthDate: Date) => {
    const days = getMonthDays(monthDate);
    const head = [
      [
        "Store :",
        "Employee number and name:",
        ...days.map((day) => WEEKDAY_NAMES[(day.getDay() + 6) % 7]),
      ],
      [
        "",
        "",
        ...days.map((day) => getWeekEventForDate(allCalendarEvents, formatDateKey(day))),
      ],
      [
        "",
        "",
        ...days.map((day) => formatDateKey(day)),
      ],
    ];

    const body = rosterEmployees.flatMap((employee) => {
      const shiftRow = days.map((day) => {
        const dateKey = formatDateKey(day);
        const leaveApplication = selectedRoster ? getAppliedLeaveForDate(employee.employeeCode, dateKey, selectedRoster.sheet_name) : null;
        const weekNumber = Number(getWeekEventForDate(allCalendarEvents, formatDateKey(day)).replace(/\D/g, "")) || 0;
        const row = employee.weekRows.get(weekNumber);
        return leaveApplication ? leaveApplication.leave_type : getDayValue(row, getDateWeekdayKey(day));
      });

      const hourRow = days.map((day) => {
        const dateKey = formatDateKey(day);
        const leaveApplication = selectedRoster ? getAppliedLeaveForDate(employee.employeeCode, dateKey, selectedRoster.sheet_name) : null;
        const weekNumber = Number(getWeekEventForDate(allCalendarEvents, formatDateKey(day)).replace(/\D/g, "")) || 0;
        const row = employee.weekRows.get(weekNumber);
        return leaveApplication ? "0" : formatHours(getHoursForShiftRow(row, getDateWeekdayKey(day)));
      });

      return [
        [employee.storeName, `${employee.employeeCode} - ${employee.employeeName}`, ...shiftRow],
        ["", "HR", ...hourRow],
      ];
    });

    return { head, body };
  };

  const handleExportMonthPdf = () => {
    if (!selectedRoster) return;
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a3" });
    const { head, body } = buildPdfTable(currentMonth);

    doc.setFontSize(18);
    doc.text(`${selectedRoster.store_name || selectedRoster.sheet_name} Roster`, 24, 26);
    doc.setFontSize(12);
    doc.text(getMonthLabel(currentMonth), 24, 44);

    autoTable(doc, {
      startY: 56,
      head,
      body,
      theme: "grid",
      styles: { fontSize: 7, cellPadding: 3, valign: "middle", lineColor: [214, 223, 235], lineWidth: 0.4 },
      headStyles: { fillColor: [255, 255, 255], textColor: [15, 23, 42], fontStyle: "bold" },
      columnStyles: {
        0: { cellWidth: 120 },
        1: { cellWidth: 170 },
      },
    });
    doc.save(`${selectedRoster.sheet_name}-${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, "0")}-roster.pdf`);
  };

  const handleExportYearPdf = () => {
    if (!selectedRoster) return;
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a3" });
    Array.from({ length: 12 }, (_, monthIndex) => monthIndex).forEach((monthIndex, index) => {
      const monthDate = new Date(2026, monthIndex, 1);
      if (index > 0) doc.addPage("a3", "landscape");
      const { head, body } = buildPdfTable(monthDate);
      doc.setFontSize(18);
      doc.text(`${selectedRoster.store_name || selectedRoster.sheet_name} Roster`, 24, 26);
      doc.setFontSize(12);
      doc.text(getMonthLabel(monthDate), 24, 44);
      autoTable(doc, {
        startY: 56,
        head,
        body,
        theme: "grid",
        styles: { fontSize: 7, cellPadding: 3, valign: "middle", lineColor: [214, 223, 235], lineWidth: 0.4 },
        headStyles: { fillColor: [255, 255, 255], textColor: [15, 23, 42], fontStyle: "bold" },
        columnStyles: {
          0: { cellWidth: 120 },
          1: { cellWidth: 170 },
        },
      });
    });
    doc.save(`${selectedRoster.sheet_name}-2026-roster-year.pdf`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white sm:text-2xl">Roster Builder</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">
            Generates a yearly roster by marrying the imported shifts with the calendar week labels and 2026 public holidays, keyed by employee code.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setCurrentMonth(new Date())}>
            <CalendarDays className="mr-2 h-4 w-4" />
            Today
          </Button>
          <Button variant="outline" onClick={handleExportMonthPdf} disabled={!selectedRoster}>
            <Download className="mr-2 h-4 w-4" />
            Export Month PDF
          </Button>
          <Button variant="outline" onClick={handleExportYearPdf} disabled={!selectedRoster}>
            <Download className="mr-2 h-4 w-4" />
            Export Year PDF
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-700 bg-slate-900/50 p-2 shadow-sm">
        <div className="px-2 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={rosterSearch}
              onChange={(event) => setRosterSearch(event.target.value)}
              placeholder="Search rosters by store, employee name, or employee code..."
              className="pl-9 bg-slate-800 border-slate-600 text-white"
            />
          </div>
          {rosterSearchResults.length > 0 && (
            <div className="mt-2 grid gap-2 lg:grid-cols-2">
              {rosterSearchResults.map((result) => (
                <button
                  key={result.id}
                  type="button"
                  onClick={() => handleRosterSearchGo(result)}
                  className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-left transition hover:bg-slate-700"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-white">{result.title}</div>
                    <div className="truncate text-xs text-slate-400">{result.subtitle}</div>
                  </div>
                  <span className="ml-3 shrink-0 text-xs font-semibold uppercase tracking-wide text-cyan-400">Go</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-2 overflow-x-auto">
          {rosters.map((roster) => {
            const active = roster.sheet_name === selectedRoster?.sheet_name;
            return (
              <button
                key={roster.sheet_name}
                onClick={() => setSelectedSheet(roster.sheet_name)}
                className={`whitespace-nowrap rounded-xl border px-4 py-2 text-sm font-medium transition ${
                  active ? "border-orange-300 bg-orange-50 text-orange-800" : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                }`}
              >
                {roster.store_name || roster.sheet_name}
              </button>
            );
          })}
        </div>
      </div>

      <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-200 pb-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="text-base font-semibold text-slate-900 sm:text-lg">
                {selectedRoster?.store_name || "No shift roster selected"}
              </CardTitle>
              <CardDescription className="text-slate-500">
                01/01/2026 to 31/12/2026 roster generation with active day highlighting and month exploration.
              </CardDescription>
            </div>

            <div className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2">
              <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(new Date(2026, currentMonth.getMonth() - 1, 1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-[170px] text-center font-medium text-slate-900">{getMonthLabel(currentMonth)}</div>
              <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(new Date(2026, currentMonth.getMonth() + 1, 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {!selectedRoster ? (
            <div className="p-10 text-center text-slate-500">Import shifts first to generate roster output.</div>
          ) : rosterEmployees.length === 0 ? (
            <div className="p-10 text-center text-slate-500">No employee shift groups found for this store.</div>
          ) : (
            <>
              <div ref={mobileWrapRef} className="space-y-3 p-3 md:hidden">
                <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  Mobile view shows compact monthly summaries. Tap an employee to open day-by-day shifts and hours.
                </p>
                {rosterEmployees.map((employee) => {
                  const expanded = Boolean(mobileExpandedEmployees[employee.employeeCode]);
                  const summary = monthDays.reduce(
                    (acc, date) => {
                      const dateKey = formatDateKey(date);
                      const leaveApplication = selectedRoster
                        ? getAppliedLeaveForDate(employee.employeeCode, dateKey, selectedRoster.sheet_name)
                        : null;
                      const weekNumber = Number(getWeekEventForDate(allCalendarEvents, dateKey).replace(/\D/g, "")) || 0;
                      const row = employee.weekRows.get(weekNumber);
                      const dayValue = leaveApplication ? leaveApplication.leave_type : getDayValue(row, getDateWeekdayKey(date));
                      const hours = leaveApplication ? 0 : getHoursForShiftRow(row, getDateWeekdayKey(date));

                      acc.totalHours += hours;
                      if (leaveApplication) {
                        acc.leaveDays += 1;
                      } else if (dayValue === "Day Off") {
                        acc.offDays += 1;
                      } else {
                        acc.workDays += 1;
                      }
                      return acc;
                    },
                    { totalHours: 0, workDays: 0, offDays: 0, leaveDays: 0 }
                  );

                  return (
                    <div
                      key={employee.employeeCode}
                      data-roster-mobile-employee={employee.employeeCode}
                      className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
                    >
                      <button
                        type="button"
                        onClick={() => toggleMobileEmployee(employee.employeeCode)}
                        className="flex w-full items-start justify-between gap-3 text-left"
                      >
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{employee.employeeCode}</p>
                          <p className="truncate text-sm font-semibold text-slate-900">{employee.employeeName}</p>
                          <p className="truncate text-xs text-slate-500">{employee.storeName}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700">
                            {formatHours(summary.totalHours)}h
                          </span>
                          {expanded ? <ChevronUp className="h-4 w-4 text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-500" />}
                        </div>
                      </button>

                      <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700">Work {summary.workDays}</div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-slate-700">Off {summary.offDays}</div>
                        <div className="rounded-lg border border-sky-200 bg-sky-50 px-2 py-1 text-sky-700">Leave {summary.leaveDays}</div>
                      </div>

                      {expanded && (
                        <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                          {monthDays.map((date) => {
                            const dateKey = formatDateKey(date);
                            const leaveApplication = selectedRoster
                              ? getAppliedLeaveForDate(employee.employeeCode, dateKey, selectedRoster.sheet_name)
                              : null;
                            const weekNumber = Number(getWeekEventForDate(allCalendarEvents, dateKey).replace(/\D/g, "")) || 0;
                            const row = employee.weekRows.get(weekNumber);
                            const shiftValue = leaveApplication ? leaveApplication.leave_type : getDayValue(row, getDateWeekdayKey(date));
                            const hours = leaveApplication ? 0 : getHoursForShiftRow(row, getDateWeekdayKey(date));
                            const isToday = dateKey === todayKey;

                            return (
                              <div
                                key={`${employee.employeeCode}-mobile-${dateKey}`}
                                className={`rounded-xl border px-3 py-2 text-xs ${
                                  isToday ? "border-yellow-300 bg-yellow-50" : "border-slate-200 bg-slate-50"
                                }`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <p className="font-semibold text-slate-900">
                                      {WEEKDAY_NAMES[(date.getDay() + 6) % 7]} {date.toLocaleDateString(undefined, { month: "2-digit", day: "2-digit" })}
                                    </p>
                                    <p className="mt-1 whitespace-pre-line text-slate-700">{shiftValue}</p>
                                  </div>
                                  <span className="rounded-md border border-slate-200 bg-white px-2 py-1 font-semibold text-slate-700">
                                    {formatHours(hours)}h
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div ref={tableWrapRef} className="hidden w-full max-w-full overflow-x-auto overscroll-x-contain md:block">
              <table className="min-w-[3600px] w-full border-collapse table-fixed text-sm">
                <colgroup>
                  <col className="w-[220px]" />
                  <col className="w-[340px]" />
                  {monthDays.map((date) => (
                    <col key={`col-${formatDateKey(date)}`} className="w-[96px]" />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th className="border border-slate-200 bg-white px-4 py-4 text-left font-semibold text-slate-900">Store :</th>
                    <th className="border border-slate-200 bg-white px-4 py-4 text-left font-semibold text-slate-900">Employee number and name:</th>
                    {monthDays.map((date, index) => {
                      const dateKey = formatDateKey(date);
                      const weekNumber = getWeekNumberFromLabel(getWeekEventForDate(allCalendarEvents, dateKey));
                      const tone = getWeekToneClasses(weekNumber);
                      const boundary = getWeekBoundaryClasses(
                        weekNumber,
                        index > 0 ? getWeekNumberFromLabel(getWeekEventForDate(allCalendarEvents, formatDateKey(monthDays[index - 1]))) : null
                      );
                      return (
                        <th
                          key={`weekday-${dateKey}`}
                          className={`border border-slate-200 px-2 py-4 text-center text-[11px] font-bold tracking-[0.18em] ${boundary} ${
                            dateKey === todayKey ? "bg-yellow-100 text-yellow-900" : `${tone.date} text-slate-700`
                          }`}
                        >
                          {WEEKDAY_NAMES[(date.getDay() + 6) % 7]}
                        </th>
                      );
                    })}
                  </tr>
                  <tr>
                    <th className="border border-slate-200 bg-white px-4 py-3" />
                    <th className="border border-slate-200 bg-white px-4 py-3" />
                    {monthDays.map((date, index) => {
                      const dateKey = formatDateKey(date);
                      const weekNumber = getWeekNumberFromLabel(getWeekEventForDate(allCalendarEvents, dateKey));
                      const tone = getWeekToneClasses(weekNumber);
                      const boundary = getWeekBoundaryClasses(
                        weekNumber,
                        index > 0 ? getWeekNumberFromLabel(getWeekEventForDate(allCalendarEvents, formatDateKey(monthDays[index - 1]))) : null
                      );
                      return (
                        <th
                          key={`week-${dateKey}`}
                          data-roster-date={dateKey}
                          className={`border border-slate-200 px-2 py-3 text-center text-[11px] font-semibold uppercase ${boundary} ${
                            dateKey === todayKey ? "bg-yellow-50 text-yellow-800" : tone.week
                          }`}
                        >
                          {getWeekEventForDate(allCalendarEvents, dateKey)}
                        </th>
                      );
                    })}
                  </tr>
                  <tr>
                    <th className="border border-slate-200 bg-white px-4 py-3" />
                    <th className="border border-slate-200 bg-white px-4 py-3" />
                    {monthDays.map((date, index) => {
                      const dateKey = formatDateKey(date);
                      const holiday = (eventMap.get(dateKey) || []).find((event) => event.type === "holiday");
                      const weekNumber = getWeekNumberFromLabel(getWeekEventForDate(allCalendarEvents, dateKey));
                      const tone = getWeekToneClasses(weekNumber);
                      const boundary = getWeekBoundaryClasses(
                        weekNumber,
                        index > 0 ? getWeekNumberFromLabel(getWeekEventForDate(allCalendarEvents, formatDateKey(monthDays[index - 1]))) : null
                      );
                      return (
                        <th
                          key={`date-${dateKey}`}
                          className={`border border-slate-200 px-2 py-3 text-center ${boundary} ${
                            dateKey === todayKey ? "bg-yellow-50" : tone.date
                          }`}
                        >
                          <div className="text-[12px] font-semibold text-slate-900">
                            {date.toLocaleDateString(undefined, { month: "2-digit", day: "2-digit" })}
                          </div>
                          <div className={`mt-1 min-h-[2rem] whitespace-normal break-words text-[10px] leading-4 ${holiday ? "text-rose-600" : "text-slate-400"}`}>
                            {holiday?.title || ""}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rosterEmployees.map((employee) => (
                    <Fragment key={employee.employeeCode}>
                      <tr key={`${employee.employeeCode}-shift`} data-roster-employee={employee.employeeCode}>
                        <td rowSpan={2} className="border border-slate-200 bg-orange-50 px-4 py-4 align-top text-slate-900">
                          <div className="whitespace-normal break-words text-sm font-semibold leading-6">
                            {employee.storeName}
                          </div>
                        </td>
                        <td className="border border-slate-200 bg-white px-4 py-4 align-top text-slate-900">
                          <div className="space-y-1">
                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{employee.employeeCode}</div>
                            <div className="whitespace-normal break-words text-sm font-semibold leading-6">{employee.employeeName}</div>
                          </div>
                        </td>
                        {monthDays.map((date, index) => {
                          const dateKey = formatDateKey(date);
                          const leaveApplication = selectedRoster ? getAppliedLeaveForDate(employee.employeeCode, dateKey, selectedRoster.sheet_name) : null;
                          const weekNumber = Number(getWeekEventForDate(allCalendarEvents, dateKey).replace(/\D/g, "")) || 0;
                          const row = employee.weekRows.get(weekNumber);
                          const tone = getWeekToneClasses(weekNumber);
                          const boundary = getWeekBoundaryClasses(
                            weekNumber,
                            index > 0 ? getWeekNumberFromLabel(getWeekEventForDate(allCalendarEvents, formatDateKey(monthDays[index - 1]))) : null
                          );
                           return (
                             <td
                               key={`${employee.employeeCode}-${dateKey}-shift`}
                               className={`border border-slate-200 px-2 py-4 text-center text-[11px] leading-5 ${boundary} ${
                                 leaveApplication
                                   ? "bg-sky-100 text-sky-900"
                                   : dateKey === todayKey
                                     ? "bg-yellow-50 text-slate-900"
                                     : tone.shift
                               }`}
                             >
                               <div className="whitespace-pre-line break-words">
                                 {leaveApplication ? leaveApplication.leave_type : getDayValue(row, getDateWeekdayKey(date))}
                               </div>
                             </td>
                           );
                        })}
                      </tr>
                      <tr key={`${employee.employeeCode}-hours`}>
                        <td className="border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-500">HR</td>
                        {monthDays.map((date, index) => {
                          const dateKey = formatDateKey(date);
                          const leaveApplication = selectedRoster ? getAppliedLeaveForDate(employee.employeeCode, dateKey, selectedRoster.sheet_name) : null;
                          const weekNumber = Number(getWeekEventForDate(allCalendarEvents, dateKey).replace(/\D/g, "")) || 0;
                          const row = employee.weekRows.get(weekNumber);
                          const tone = getWeekToneClasses(weekNumber);
                          const boundary = getWeekBoundaryClasses(
                            weekNumber,
                            index > 0 ? getWeekNumberFromLabel(getWeekEventForDate(allCalendarEvents, formatDateKey(monthDays[index - 1]))) : null
                          );
                          return (
                            <td
                              key={`${employee.employeeCode}-${dateKey}-hours`}
                              className={`border border-slate-200 px-2 py-3 text-center text-[12px] font-semibold text-slate-700 ${boundary} ${
                                leaveApplication
                                  ? "bg-sky-50 text-sky-700"
                                  : dateKey === todayKey
                                    ? "bg-yellow-100"
                                    : tone.hours
                              }`}
                            >
                              {leaveApplication ? "0" : formatHours(getHoursForShiftRow(row, getDateWeekdayKey(date)))}
                            </td>
                          );
                        })}
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
