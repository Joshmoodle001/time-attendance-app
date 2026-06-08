export type DesktopReportTemplateKey = "attendance_report" | "awol_report";

export type DesktopReportSelectionMode = "store" | "employees";

export type RemoteAttendanceDayRow = {
  dateKey: string;
  dateLabel: string;
  weekdayLabel: string;
  weekLabel: string;
  holidayTitle: string;
  scheduleLabel: string;
  targetHours: number;
  firstClock: string;
  lastClock: string;
  clockCount: number;
  clockings: string[];
  status: string;
};

export type RemoteEmployeeReport = {
  employeeCode: string;
  employeeName: string;
  role: string;
  department: string;
  team: string;
  costCenter: string;
  region: string;
  store: string;
  storeCode: string;
  rows: RemoteAttendanceDayRow[];
};

export type RemoteStoreSection = {
  key: string;
  store: string;
  storeCode: string;
  storeType: "physical" | "logical";
  region: string;
  employees: RemoteEmployeeReport[];
};

export type RemoteAwolReportRow = {
  employeeCode: string;
  employeeName: string;
  store: string;
  storeCode: string;
  storeType: "physical" | "logical";
  region: string;
  department: string;
  currentAwolStreak: number;
  awolDates: string[];
  lastDayAtWork: string;
  lastDayAtWorkLabel: string;
};

export type RemoteGeneratedCriteria = {
  templateKey: DesktopReportTemplateKey;
  startDate: string;
  endDate: string;
  selectionMode: DesktopReportSelectionMode;
  includeInactiveProfiles: boolean;
  selectedStores: string[];
  employeeCodes: string[];
  awolThresholdDays?: number;
};

export type RemoteReportPayload = {
  generatedAt: string;
  criteria: RemoteGeneratedCriteria;
  totals: {
    totalRows: number;
    inOut: number;
    noInOut: number;
    awol: number;
    workedHours: number;
  };
  sections: RemoteStoreSection[];
  awolRows: RemoteAwolReportRow[];
};

export type DesktopReportJob = {
  jobId: string;
  sessionId?: string;
  templateKey: DesktopReportTemplateKey;
  startDate: string;
  endDate: string;
  selectionMode: DesktopReportSelectionMode;
  includeInactiveProfiles?: boolean;
  selectedStores?: string[];
  employeeCodes?: string[];
  awolThresholdDays?: number;
  requestMode?: "selected" | "all";
  fullCompany?: boolean;
  outputMode?: "pdf" | "data";
};

export type DesktopReportJobResult = {
  jobId: string;
  sessionId?: string;
  success: boolean;
  fileName?: string;
  mimeType?: string;
  pdfBase64?: string;
  error?: string;
  reportPayload?: RemoteReportPayload;
};
