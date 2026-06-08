import type { RemoteAttendanceDayRow, RemoteEmployeeReport, RemoteReportPayload } from "@/types/desktopReportBridge";

type JsPdfConstructor = (typeof import("jspdf"))["default"];
type AutoTableFn = (typeof import("jspdf-autotable"))["default"];

let pdfRuntimePromise: Promise<{ jsPDF: JsPdfConstructor; autoTable: AutoTableFn }> | null = null;

function loadPdfRuntime() {
  if (!pdfRuntimePromise) {
    pdfRuntimePromise = Promise.all([import("jspdf"), import("jspdf-autotable")]).then(([jspdfModule, autoTableModule]) => ({
      jsPDF: jspdfModule.default,
      autoTable: autoTableModule.default,
    }));
  }

  return pdfRuntimePromise;
}

function parseDateKey(value: string) {
  const [year, month, day] = String(value || "").split("-").map(Number);
  return new Date(year || 0, (month || 1) - 1, day || 1);
}

export function formatRangeLabel(startDate: string, endDate: string) {
  if (!startDate || !endDate) return "No date range";
  const start = parseDateKey(startDate);
  const end = parseDateKey(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${startDate || "?"} to ${endDate || "?"}`;
  }
  const startStr = start.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  const endStr = end.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  return startStr === endStr ? startStr : `${startStr} to ${endStr}`;
}

export function formatLongDate(dateKey: string) {
  if (!dateKey) return "-";
  const parsed = parseDateKey(dateKey);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

export function formatHours(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function parseClockTimeToSeconds(value: string) {
  if (!value || value === "-") return null;
  const parts = String(value).split(":").map(Number);
  if (parts.length < 2 || parts.some((part) => Number.isNaN(part))) return null;
  const [hours, minutes, seconds = 0] = parts;
  return hours * 3600 + minutes * 60 + seconds;
}

export function calculateWorkedHoursForRow(row: {
  firstClock?: string;
  lastClock?: string;
  clockCount: number;
}) {
  const start = parseClockTimeToSeconds(row.firstClock || "");
  const end = parseClockTimeToSeconds(row.lastClock || "");
  if (start === null || end === null || row.clockCount < 2 || end <= start) return 0;
  return Number(((end - start) / 3600).toFixed(2));
}

export function calculateWorkedHoursForEmployee(rows: Array<{
  firstClock?: string;
  lastClock?: string;
  clockCount: number;
}>) {
  return Number(rows.reduce((sum, row) => sum + calculateWorkedHoursForRow(row), 0).toFixed(2));
}

export function buildRowNote(row: RemoteAttendanceDayRow) {
  if (row.holidayTitle) return `Holiday: ${row.holidayTitle}`;
  if (row.clockings.length > 0) return row.clockings.join(" | ");
  if (row.status === "No In/Out") return "Single clocking";
  if (row.status === "AWOL") return "No clockings";
  return "";
}

export function getStatusTone(status: string) {
  if (status === "P/H") return "bg-rose-100 text-rose-700";
  if (status === "Public Holiday") return "bg-rose-50 text-rose-600";
  if (status === "AWOL") return "bg-red-100 text-red-700";
  if (status === "No In/Out") return "bg-amber-100 text-amber-700";
  if (status === "In/Out") return "bg-emerald-100 text-emerald-700";
  if (status === "Day Off") return "bg-violet-100 text-violet-700";
  return "bg-blue-100 text-blue-700";
}

export async function buildRemoteReportPdf(payload: RemoteReportPayload) {
  if (!payload?.criteria?.templateKey) {
    throw new Error("Report payload is incomplete — missing criteria with templateKey.");
  }

  const { jsPDF, autoTable } = await loadPdfRuntime();
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const title = payload.criteria.templateKey === "awol_report" ? "AWOL Report" : "Attendance Report";
  const range = formatRangeLabel(payload.criteria.startDate, payload.criteria.endDate);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(title, 32, 34);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(range, 32, 52);

  if (payload.criteria.templateKey === "awol_report") {
    autoTable(doc, {
      startY: 70,
      head: [["Employee", "Store", "Region", "AWOL Streak", "Dates", "Last At Work"]],
      body: payload.awolRows.map((row) => [
        `${row.employeeCode} - ${row.employeeName}`,
        row.storeCode ? `${row.storeCode} - ${row.store}` : row.store,
        row.region,
        String(row.currentAwolStreak),
        row.awolDates.map((date) => formatLongDate(date)).join(" | "),
        row.lastDayAtWorkLabel || "-",
      ]),
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [14, 116, 144] },
      margin: { left: 24, right: 24 },
    });
  } else {
    let currentY = 70;
    payload.sections.forEach((section, sectionIndex) => {
      if (sectionIndex > 0) {
        doc.addPage();
        currentY = 34;
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.text(section.storeCode ? `${section.storeCode} - ${section.store}` : section.store, 32, currentY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(`Region: ${section.region} | Type: ${section.storeType === "physical" ? "Physical" : "Logical"}`, 32, currentY + 16);

      currentY += 30;

      section.employees.forEach((employee, employeeIndex) => {
        if (employeeIndex > 0 || sectionIndex > 0) {
          currentY += 10;
        }
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.text(`${employee.employeeCode} - ${employee.employeeName}`, 32, currentY);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.text(
          [employee.role, employee.department && `Dept: ${employee.department}`, employee.team && `Team: ${employee.team}`]
            .filter(Boolean)
            .join(" • "),
          32,
          currentY + 12,
        );

        autoTable(doc, {
          startY: currentY + 20,
          head: [["Shift Date", "Day", "Week", "Roster", "Worked Hrs", "In", "Out", "Notes", "Status"]],
          body: employee.rows.map((row) => [
            row.dateLabel,
            row.weekdayLabel,
            row.weekLabel,
            row.scheduleLabel,
            formatHours(calculateWorkedHoursForRow(row)),
            row.firstClock || "-",
            row.lastClock || "-",
            buildRowNote(row) || "-",
            row.status,
          ]),
          styles: { fontSize: 7, cellPadding: 3 },
          headStyles: { fillColor: [14, 116, 144] },
          margin: { left: 24, right: 24 },
          didDrawPage: (data) => {
            currentY = data.cursor?.y || currentY;
          },
        });
        currentY = (((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY) || currentY) + 18;
      });
    });
  }

  const stem = payload.criteria.templateKey === "awol_report" ? "awol-report" : "attendance-report";
  const fileName = `${stem}-${payload.criteria.startDate}-to-${payload.criteria.endDate}.pdf`;
  const blob = doc.output("blob");
  return { blob, fileName };
}

export async function exportRemoteReportPdf(payload: RemoteReportPayload) {
  const { blob, fileName } = await buildRemoteReportPdf(payload);
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    if (typeof window !== "undefined" && /Android|iPhone|iPad|iPod/i.test(window.navigator.userAgent || "")) {
      window.open(objectUrl, "_blank", "noopener,noreferrer");
    }
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
  }
}

export function buildAttendanceSummary(payload: RemoteReportPayload) {
  return {
    sectionCount: payload.sections.length,
    employeeCount: payload.sections.reduce((total, section) => total + section.employees.length, 0),
  };
}

export function buildEmployeeWorkedHours(employee: RemoteEmployeeReport) {
  return calculateWorkedHoursForEmployee(employee.rows);
}
