import { Badge } from "@/components/ui/badge";
import type { RemoteReportPayload } from "@/types/desktopReportBridge";
import {
  buildAttendanceSummary,
  buildEmployeeWorkedHours,
  buildRowNote,
  calculateWorkedHoursForRow,
  formatHours,
  formatLongDate,
  formatRangeLabel,
  getStatusTone,
} from "@/lib/remoteReportFormat";

type RemoteReportPreviewProps = {
  payload: RemoteReportPayload;
};

export default function RemoteReportPreview({ payload }: RemoteReportPreviewProps) {
  if (!payload?.criteria?.templateKey) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 p-4 text-center text-amber-300">
        Report data is incomplete and cannot be previewed.
      </div>
    );
  }

  if (payload.criteria.templateKey === "awol_report") {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Dates</div>
            <div className="mt-2 font-semibold text-slate-900">{formatRangeLabel(payload.criteria.startDate, payload.criteria.endDate)}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-amber-50 p-3">
            <div className="text-xs uppercase tracking-[0.2em] text-amber-600">Threshold</div>
            <div className="mt-2 text-2xl font-bold text-amber-700">{payload.criteria.awolThresholdDays || 0} day(s)</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-red-50 p-3">
            <div className="text-xs uppercase tracking-[0.2em] text-red-600">Results</div>
            <div className="mt-2 text-2xl font-bold text-red-700">{payload.awolRows.length}</div>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-[980px] w-full border-collapse text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="border-b border-slate-200 px-3 py-3 text-left">Employee</th>
                  <th className="border-b border-slate-200 px-3 py-3 text-left">Store</th>
                  <th className="border-b border-slate-200 px-3 py-3 text-left">Region</th>
                  <th className="border-b border-slate-200 px-3 py-3 text-center">AWOL Streak</th>
                  <th className="border-b border-slate-200 px-3 py-3 text-left">AWOL Dates</th>
                  <th className="border-b border-slate-200 px-3 py-3 text-left">Last Day At Work</th>
                </tr>
              </thead>
              <tbody>
                {payload.awolRows.map((row) => (
                  <tr key={`${row.employeeCode}-${row.lastDayAtWork}`} className="bg-white align-top">
                    <td className="border-b border-slate-200 px-3 py-3 font-medium text-slate-900">{row.employeeCode} - {row.employeeName}</td>
                    <td className="border-b border-slate-200 px-3 py-3 text-slate-700">
                      {row.storeCode ? `${row.storeCode} - ${row.store}` : row.store}
                    </td>
                    <td className="border-b border-slate-200 px-3 py-3 text-slate-700">{row.region}</td>
                    <td className="border-b border-slate-200 px-3 py-3 text-center">
                      <Badge className="bg-red-100 text-red-700">{row.currentAwolStreak}</Badge>
                    </td>
                    <td className="border-b border-slate-200 px-3 py-3 text-slate-700">{row.awolDates.map((date) => formatLongDate(date)).join(" | ")}</td>
                    <td className="border-b border-slate-200 px-3 py-3 text-slate-700">{row.lastDayAtWorkLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  const summary = buildAttendanceSummary(payload);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Dates</div>
          <div className="mt-2 font-semibold text-slate-900">{formatRangeLabel(payload.criteria.startDate, payload.criteria.endDate)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Store Sections</div>
          <div className="mt-2 text-2xl font-bold text-slate-900">{summary.sectionCount}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Merchandisers</div>
          <div className="mt-2 text-2xl font-bold text-slate-900">{summary.employeeCount}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-emerald-50 p-3">
          <div className="text-xs uppercase tracking-[0.2em] text-emerald-600">In/Out</div>
          <div className="mt-2 text-2xl font-bold text-emerald-700">{payload.totals.inOut}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-amber-50 p-3">
          <div className="text-xs uppercase tracking-[0.2em] text-amber-600">No In/Out</div>
          <div className="mt-2 text-2xl font-bold text-amber-700">{payload.totals.noInOut}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-red-50 p-3">
          <div className="text-xs uppercase tracking-[0.2em] text-red-600">AWOL</div>
          <div className="mt-2 text-2xl font-bold text-red-700">{payload.totals.awol}</div>
        </div>
      </div>

      <div className="space-y-7">
        {payload.sections.map((section) => (
          <section key={section.key} className="overflow-hidden rounded-[28px] border border-gray-300 bg-slate-950/45 shadow-[0_24px_60px_rgba(2,6,23,0.28)]">
            <div className="border-b border-white/10 bg-gradient-to-r from-gray-950 via-gray-900 to-gray-950 px-6 py-5 text-white">
              <div className="text-xs font-semibold uppercase tracking-[0.25em] text-gray-400">Attendance Report</div>
              <div className="mt-2 text-2xl font-bold tracking-tight">
                {section.storeCode ? `${section.storeCode} - ${section.store}` : section.store}
              </div>
              <div className="mt-2 text-sm text-slate-200">
                Shift Date Range: {formatRangeLabel(payload.criteria.startDate, payload.criteria.endDate)} • Grouped By: Store
              </div>
              <div className="mt-1 text-sm text-slate-300">
                Region: {section.region} • Type: {section.storeType === "physical" ? "Physical" : "Logical"} • {section.employees.length} merchandiser{section.employees.length === 1 ? "" : "s"}
              </div>
            </div>

            <div className="space-y-0">
              {section.employees.map((employee) => {
                const inOutCount = employee.rows.filter((row) => row.status === "In/Out").length;
                const awolCount = employee.rows.filter((row) => row.status === "AWOL").length;
                const workedHours = buildEmployeeWorkedHours(employee);

                return (
                  <div key={`${section.key}-${employee.employeeCode}`} className="border-t border-white/10 px-6 py-6 first:border-t-0">
                    <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                      <div>
                        <div className="text-lg font-semibold text-white">
                          {employee.employeeCode} - {employee.employeeName}
                        </div>
                        <div className="mt-1 text-sm text-slate-400">
                          {employee.role}
                          {employee.department ? ` • Dept: ${employee.department}` : ""}
                          {employee.team ? ` • Team: ${employee.team}` : ""}
                          {employee.costCenter ? ` • Cost Centre: ${employee.costCenter}` : ""}
                        </div>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-3">
                        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">In/Out Days</div>
                          <div className="mt-2 text-xl font-bold text-emerald-300">{inOutCount}</div>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">AWOL Days</div>
                          <div className="mt-2 text-xl font-bold text-red-300">{awolCount}</div>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Worked Hours</div>
                          <div className="mt-2 text-xl font-bold text-white">{formatHours(workedHours)}</div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 overflow-x-auto">
                      <table className="w-full min-w-[980px] border-collapse">
                        <thead className="bg-white/5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">
                          <tr>
                            <th className="border-b border-slate-200 px-3 py-3 text-left">Shift Date</th>
                            <th className="border-b border-slate-200 px-3 py-3 text-left">Day</th>
                            <th className="border-b border-slate-200 px-3 py-3 text-left">Week</th>
                            <th className="border-b border-slate-200 px-3 py-3 text-left">Roster</th>
                            <th className="border-b border-slate-200 px-3 py-3 text-center">Worked Hrs</th>
                            <th className="border-b border-slate-200 px-3 py-3 text-center">In</th>
                            <th className="border-b border-slate-200 px-3 py-3 text-center">Out</th>
                            <th className="border-b border-slate-200 px-3 py-3 text-left">Notes</th>
                            <th className="border-b border-slate-200 px-3 py-3 text-right">Status</th>
                          </tr>
                        </thead>
                        <tbody className="bg-transparent text-sm text-slate-200">
                          {employee.rows.map((row) => (
                            <tr key={`${employee.employeeCode}-${row.dateKey}`} className="align-top">
                              <td className="border-b border-slate-200 px-3 py-3">
                                <div className="font-medium text-white">{row.dateLabel}</div>
                                {row.holidayTitle ? <div className="mt-1 text-xs text-rose-300">{row.holidayTitle}</div> : null}
                              </td>
                              <td className="border-b border-slate-200 px-3 py-3">{row.weekdayLabel}</td>
                              <td className="border-b border-slate-200 px-3 py-3">{row.weekLabel}</td>
                              <td className="border-b border-slate-200 px-3 py-3 font-medium text-slate-100">{row.scheduleLabel}</td>
                              <td className="border-b border-slate-200 px-3 py-3 text-center">{formatHours(calculateWorkedHoursForRow(row))}</td>
                              <td className="border-b border-slate-200 px-3 py-3 text-center">{row.firstClock || "-"}</td>
                              <td className="border-b border-slate-200 px-3 py-3 text-center">{row.lastClock || "-"}</td>
                              <td className="border-b border-slate-200 px-3 py-3 text-xs text-slate-400">{buildRowNote(row) || "-"}</td>
                              <td className="border-b border-slate-200 px-3 py-3 text-right">
                                <Badge className={getStatusTone(row.status)}>{row.status}</Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
