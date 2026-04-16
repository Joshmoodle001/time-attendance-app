export type ReportGroupBy = "store" | "region" | "status" | "employee";

export type ReportStatusFilter = "all" | "atWork" | "awol" | "leave" | "dayOff" | "scheduled";

export type ReportTemplate = {
  id: string;
  title: string;
  description: string;
  groupBy: ReportGroupBy;
  statusFilter: ReportStatusFilter;
  regionFilter: string;
  storeFilter: string;
  searchTerm: string;
  templateKey?: string;
  selectionMode?: "store" | "employees";
  selectedStore?: string;
  selectedEmployeeCodes?: string[];
  startDate?: string;
  endDate?: string;
  awolThresholdDays?: number;
  createdAt: string;
};

export type CommunicationProfileLevel = "rep" | "regional" | "divisional";

export type CommunicationProfile = {
  id: string;
  firstName: string;
  lastName: string;
  idNumber: string;
  payrollCode: string;
  area: string;
  groceryPerishable: string;
  level: CommunicationProfileLevel;
  managerId: string;
  active: boolean;
  source: "manual" | "employee";
  notes: string;
};

export type CommunicationAutomation = {
  id: string;
  title: string;
  reportTemplateId: string;
  recipientIds: string[];
  frequency: "manual" | "daily" | "weekly" | "monthly";
  timeOfDay: string;
  active: boolean;
  description: string;
  lastRunAt: string;
};
