import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Clock3, RefreshCw, Search, Shield, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getEmployees, importEmployees, initializeEmployeeDatabase, normalizeEmployeeCode, type Employee } from "@/services/database";
import {
    buildEmployeeInputsFromClockEvents,
    buildClockEmployeeSummaries,
    buildProcessedClockDays,
    compareClockEventsOptimized,
    getClockEvents,
    initializeClockDatabase,
    parseClockWorkbook,
    type ClockOverview,
    type ProcessedClockDay,
    type ClockImportAllocationRow,
    type ClockWorkbookImportReport,
    type ClockUpsertProgress,
    upsertClockEvents,
    type BiometricClockEvent,
  } from "@/services/clockData";

type ClockDataHubProps = {
  employees: Employee[];
  onEmployeesRefresh?: () => Promise<void> | void;
};

function formatClockTimestamp(value: string) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatClockDate(value: string) {
   if (!value) return "-";
   return new Date(`${value}T00:00:00`).toLocaleDateString("en-ZA", {
     year: "numeric",
     month: "short",
     day: "2-digit",
   });
 }

function formatProfileStatus(value: string) {
   if (!value) return "-";
   return value.replace(/_/g, " ");
}

function getAllocationRowClasses(status: "allocated" | "unallocated") {
   return status === "unallocated"
     ? "border-rose-500/20 bg-rose-500/10 text-rose-100"
     : "border-emerald-500/20 bg-emerald-500/10 text-emerald-100";
}

function waitForPaint() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function getTodayClockFilterValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function mapSaveProgressToImportPercent(progress: ClockUpsertProgress) {
  const normalizedPercent = Math.max(0, Math.min(progress.percent, 100));
  if (progress.phase === "local") {
    return 60 + Math.round(normalizedPercent * 0.08);
  }
  return 68 + Math.round(normalizedPercent * 0.10);
}

const RAW_PAGE_SIZE = 200;
const PROCESSED_PAGE_SIZE = 120;

const EMPTY_OVERVIEW: ClockOverview = {
  totalEvents: 0,
  totalProcessedDays: 0,
  employeesWithClocks: 0,
  verifiedEvents: 0,
  stores: [],
  summaries: [],
};

export default function ClockDataHub({ employees, onEmployeesRefresh }: ClockDataHubProps) {
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const autoLinkRef = useRef(false);
  const loadRequestRef = useRef(0);
  const processedTableRef = useRef<HTMLDivElement>(null);
  const rawTableRef = useRef<HTMLDivElement>(null);
  const [overview, setOverview] = useState<ClockOverview>(EMPTY_OVERVIEW);
  const [rawEvents, setRawEvents] = useState<BiometricClockEvent[]>([]);
  const [processedClockDays, setProcessedClockDays] = useState<ProcessedClockDay[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const [storeFilter, setStoreFilter] = useState("all");
  const [startDateFilter, setStartDateFilter] = useState(getTodayClockFilterValue);
  const [endDateFilter, setEndDateFilter] = useState(getTodayClockFilterValue);
  const [statusMessage, setStatusMessage] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [loadPercent, setLoadPercent] = useState(0);
  const [loadStage, setLoadStage] = useState("");
const [importPercent, setImportPercent] = useState(0);
   const [importStage, setImportStage] = useState("");
   const [rawPage, setRawPage] = useState(1);
   const [processedPage, setProcessedPage] = useState(1);
   const [lastImportReport, setLastImportReport] = useState<ClockWorkbookImportReport | null>(null);

  // Virtualizers for large tables
  const processedRowVirtualizer = useVirtualizer({
    count: processedClockDays.length,
    getScrollElement: () => processedTableRef.current,
    estimateSize: () => 60,
    overscan: 5,
  });

  const rawRowVirtualizer = useVirtualizer({
    count: rawEvents.length,
    getScrollElement: () => rawTableRef.current,
    estimateSize: () => 60,
    overscan: 5,
  });

  useEffect(() => {
    if (!isLoadingData) {
      setLoadPercent(0);
      return;
    }

    const timer = window.setInterval(() => {
      setLoadPercent((current) => (current >= 90 ? current : current + (current < 40 ? 12 : current < 70 ? 7 : 3)));
    }, 180);

    return () => {
      window.clearInterval(timer);
    };
  }, [isLoadingData]);

  const loadClockView = useCallback(
    async (options?: { rawPage?: number; processedPage?: number; preserveStatus?: boolean; startDate?: string; endDate?: string }) => {
      const requestId = ++loadRequestRef.current;
      const nextRawPage = options?.rawPage ?? rawPage;
      const nextProcessedPage = options?.processedPage ?? processedPage;
      const effectiveStartDate = options?.startDate ?? startDateFilter;
      const effectiveEndDate = options?.endDate ?? endDateFilter;
      const filters = {
        search: deferredSearchTerm.trim() || undefined,
        store: storeFilter === "all" ? undefined : storeFilter,
        startDate: effectiveStartDate || undefined,
        endDate: effectiveEndDate || undefined,
      };

      setIsLoadingData(true);
      setLoadPercent(8);
      setLoadStage("Connecting to Supabase clock data...");

      try {
        await initializeClockDatabase();
        if (requestId !== loadRequestRef.current) return;

        setLoadPercent(28);
        setLoadStage("Loading overview and processed clock summaries...");

        const events = await getClockEvents(filters);
        if (requestId !== loadRequestRef.current) return;

        const summaries = buildClockEmployeeSummaries(events);
        const processedDays = buildProcessedClockDays(events);
        const pagedProcessedDays = processedDays.slice(
          Math.max(0, (nextProcessedPage - 1) * PROCESSED_PAGE_SIZE),
          Math.max(0, (nextProcessedPage - 1) * PROCESSED_PAGE_SIZE) + PROCESSED_PAGE_SIZE
        );
        const pagedRawEvents = events.slice(
          Math.max(0, (nextRawPage - 1) * RAW_PAGE_SIZE),
          Math.max(0, (nextRawPage - 1) * RAW_PAGE_SIZE) + RAW_PAGE_SIZE
        );
        const nextOverview: ClockOverview = {
          totalEvents: events.length,
          totalProcessedDays: processedDays.length,
          employeesWithClocks: summaries.length,
          verifiedEvents: events.filter((clockEvent) => clockEvent.access_verified).length,
          stores: Array.from(new Set(events.map((clockEvent) => clockEvent.store).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
          summaries,
        };

        setLoadPercent(100);
        setLoadStage("Clock data loaded.");
        setOverview(nextOverview);
        setProcessedClockDays(pagedProcessedDays);
        setRawEvents(pagedRawEvents);

        if (!options?.preserveStatus) {
          setStatusMessage(`Loaded ${nextOverview.totalEvents} biometric clock event${nextOverview.totalEvents === 1 ? "" : "s"} from Supabase.`);
        }
      } catch (error) {
        if (requestId !== loadRequestRef.current) return;
        setOverview(EMPTY_OVERVIEW);
        setProcessedClockDays([]);
        setRawEvents([]);
        setStatusMessage(`Clock data load failed: ${error instanceof Error ? error.message : "Unknown error"}`);
      } finally {
        window.setTimeout(() => {
          if (requestId !== loadRequestRef.current) return;
          setIsLoadingData(false);
          setLoadStage("");
        }, 300);
      }
    },
    [deferredSearchTerm, endDateFilter, processedPage, rawPage, startDateFilter, storeFilter]
  );

  useEffect(() => {
    void loadClockView();
    return () => {
      loadRequestRef.current += 1;
    };
  }, [loadClockView]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      setLoadPercent(10);
      setLoadStage("Refreshing Supabase clock data...");
      await loadClockView();
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    setRawPage(1);
    setProcessedPage(1);
  }, [deferredSearchTerm, storeFilter, startDateFilter, endDateFilter]);

  const storeOptions = useMemo(() => ["all", ...overview.stores], [overview.stores]);

  const summaries = useMemo(() => overview.summaries.slice(0, 6), [overview.summaries]);
  const linkedEmployees = useMemo(
    () =>
      new Set(
        overview.summaries
          .map((event) => normalizeEmployeeCode(event.employee_code))
          .filter((code) => employees.some((employee) => normalizeEmployeeCode(employee.employee_code) === code))
      ).size,
    [overview.summaries, employees]
  );
  const hasSeedOnlyData = useMemo(
    () => overview.totalEvents === 1,
    [overview.totalEvents]
  );

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    setIsImporting(true);
    setLastImportReport(null);
    setImportPercent(5);
    setImportStage(`Preparing ${files.length} biometric file${files.length === 1 ? "" : "s"}...`);
    try {
      await waitForPaint();

      await initializeEmployeeDatabase();
      const liveEmployees = await getEmployees({ preferRemote: true });
      const matchingEmployees = liveEmployees.length > 0 ? liveEmployees : employees;

      const parsedFiles: BiometricClockEvent[] = [];
      const allocatedRows: ClockImportAllocationRow[] = [];
      const unallocatedRows: ClockImportAllocationRow[] = [];
      let totalWorkbookRows = 0;

      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const readPercent = 10 + Math.round((index / files.length) * 35);
        setImportPercent(readPercent);
        setImportStage(`Reading ${file.name} (${index + 1} of ${files.length})...`);
        await waitForPaint();

        const buffer = await file.arrayBuffer();
        setImportPercent(Math.min(50, readPercent + 10));
        setImportStage(`Parsing ${file.name}...`);
        await waitForPaint();

        const parsed = parseClockWorkbook(buffer, file.name, matchingEmployees);
         parsedFiles.push(...parsed.events);
         allocatedRows.push(...parsed.report.allocatedRows);
         unallocatedRows.push(...parsed.report.unallocatedRows);
        totalWorkbookRows += parsed.report.totalRows;
      }

      const importReport: ClockWorkbookImportReport = {
        totalRows: totalWorkbookRows,
        allocatedCount: allocatedRows.length,
        unallocatedCount: unallocatedRows.length,
        allocatedRows,
        unallocatedRows,
      };
      setLastImportReport(importReport);

      if (parsedFiles.length === 0) {
        setStatusMessage(
          importReport.unallocatedCount > 0
            ? `No allocatable biometric clock events were found. ${importReport.unallocatedCount} row${importReport.unallocatedCount === 1 ? "" : "s"} could not be matched and are listed in the unallocated report below.`
            : `No biometric clock events were found in the selected upload.`
        );
        return;
      }

      const uniqueParsedFiles = Array.from(new Map(parsedFiles.map((item) => [item.event_key, item])).values());
      const duplicateRowsSkipped = Math.max(0, parsedFiles.length - uniqueParsedFiles.length);
      const uniqueEmployees = new Set(uniqueParsedFiles.map((item) => item.employee_code)).size;
      const importedDates = uniqueParsedFiles.map((item) => item.clock_date).filter(Boolean).sort();
      const importedStartDate = importedDates[0] || startDateFilter;
      const importedEndDate = importedDates[importedDates.length - 1] || endDateFilter;
      setImportPercent(54);
      setImportStage("Comparing upload against existing clock data...");
      await waitForPaint();

      const comparison = await compareClockEventsOptimized(uniqueParsedFiles);
      setImportPercent(60);
      setImportStage(`Saving ${uniqueParsedFiles.length} biometric event${uniqueParsedFiles.length === 1 ? "" : "s"}...`);
      await waitForPaint();

      const clockResult = await upsertClockEvents(uniqueParsedFiles, (progress) => {
        const nextPercent = mapSaveProgressToImportPercent(progress);
        const itemLabel =
          progress.phase === "local"
            ? "Preparing Supabase write"
            : "Saving to Supabase clock table";

        setImportPercent((current) => Math.max(current, nextPercent));
        setImportStage(
          `${itemLabel} ${Math.min(progress.completed, progress.total)} of ${progress.total} biometric event${progress.total === 1 ? "" : "s"}...`
        );
      });
      const employeeInputs = buildEmployeeInputsFromClockEvents(uniqueParsedFiles, matchingEmployees);
      setImportPercent(78);
      setImportStage(`Linking ${employeeInputs.length} employee profile${employeeInputs.length === 1 ? "" : "s"}...`);
      await waitForPaint();

      const employeeResult = employeeInputs.length > 0 ? await importEmployees(employeeInputs) : { success: true, count: 0 };
      setImportPercent(92);
      setImportStage("Refreshing clock audit view...");
      await waitForPaint();

      setStartDateFilter(importedStartDate);
      setEndDateFilter(importedEndDate);
      setRawPage(1);
      setProcessedPage(1);
      await loadClockView({ rawPage: 1, processedPage: 1, preserveStatus: true, startDate: importedStartDate, endDate: importedEndDate });
      await onEmployeesRefresh?.();
      setImportPercent(100);
      setImportStage("Import complete.");

      setStatusMessage(
        [
          `Read ${importReport.totalRows} payroll clock row${importReport.totalRows === 1 ? "" : "s"} from ${files.length} file${files.length === 1 ? "" : "s"}.`,
          `Allocated ${importReport.allocatedCount} row${importReport.allocatedCount === 1 ? "" : "s"} to employee profiles and flagged ${importReport.unallocatedCount} row${importReport.unallocatedCount === 1 ? "" : "s"} as unallocated.`,
          `Parsed ${uniqueParsedFiles.length} unique biometric event${uniqueParsedFiles.length === 1 ? "" : "s"} across ${uniqueEmployees} employee${uniqueEmployees === 1 ? "" : "s"}.`,
          `Compared against ${comparison.incomingCount} incoming event${comparison.incomingCount === 1 ? "" : "s"}: ${comparison.existingCount} already existed and ${comparison.newCount} ${comparison.newCount === 1 ? "is" : "are"} new to Clock Data.`,
          comparison.matchingEmployees > 0
            ? `${comparison.matchingEmployees} employee profile${comparison.matchingEmployees === 1 ? "" : "s"} in the upload already had clock history in Clock Data.`
            : `None of the employee codes in this upload matched the current Clock Data yet.`,
          duplicateRowsSkipped > 0 || (clockResult.duplicatesRemoved || 0) > 0
            ? `Skipped ${duplicateRowsSkipped + (clockResult.duplicatesRemoved || 0)} duplicate biometric row${duplicateRowsSkipped + (clockResult.duplicatesRemoved || 0) === 1 ? "" : "s"} during import.`
            : "",
          uniqueParsedFiles.length <= 1
            ? "This workbook only contained 1 biometric row after parsing. If you expected a full clock export, check whether the source workbook was filtered or exported in payroll-only format."
            : "",
          uniqueParsedFiles.length === 1 && uniqueEmployees === 1 && files.length === 1
            ? `The selected workbook contained one biometric row for ${uniqueParsedFiles[0]?.employee_code || "one employee"}.`
            : "",
          `Imported ${clockResult.count || uniqueParsedFiles.length} biometric clock event${(clockResult.count || uniqueParsedFiles.length) === 1 ? "" : "s"} into Clock Data.`,
          employeeInputs.length > 0 ? `Synced ${employeeResult.count || employeeInputs.length} employee profile${(employeeResult.count || employeeInputs.length) === 1 ? "" : "s"} from the biometric file.` : "",
          clockResult.error || employeeResult.error || "",
        ]
          .filter(Boolean)
          .join(" ")
      );
    } catch (error) {
      setStatusMessage(`Clock import failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      window.setTimeout(() => {
        setImportPercent(0);
        setImportStage("");
      }, 600);
      setIsImporting(false);
      event.target.value = "";
    }
  };

  useEffect(() => {
    if (autoLinkRef.current || overview.summaries.length === 0) return;

    const employeeMap = new Map(employees.map((employee) => [normalizeEmployeeCode(employee.employee_code), employee]));
    const needsSync = overview.summaries.some((summary) => {
      const existing = employeeMap.get(normalizeEmployeeCode(summary.employee_code));
      return !existing || (!existing.store && !!summary.store) || (!existing.id_number && !!summary.id_number);
    });

    if (!needsSync) {
      autoLinkRef.current = true;
      return;
    }

    let alive = true;

    const syncLinkedProfiles = async () => {
      const employeeInputs = overview.summaries
        .map((summary) => {
          const existing = employeeMap.get(normalizeEmployeeCode(summary.employee_code));
          return {
            employee_code: normalizeEmployeeCode(summary.employee_code),
            first_name: summary.employee_name.split(" ").slice(0, -1).join(" ") || existing?.first_name || "",
            last_name: summary.employee_name.split(" ").slice(-1).join(" ") || existing?.last_name || "",
            alias: existing?.alias || "",
            id_number: summary.id_number || existing?.id_number || "",
            store: summary.store || existing?.store || "",
            store_code: existing?.store_code || "",
            region: existing?.region || "",
            department: existing?.department || "",
            team: existing?.team || "",
            job_title: existing?.job_title || "",
            company: existing?.company || "",
            branch: existing?.branch || "",
            person_type: existing?.person_type || "",
            business_unit: existing?.business_unit || "",
            cost_center: existing?.cost_center || "",
            email: existing?.email || "",
            phone: existing?.phone || "",
            title: existing?.title || "",
            hire_date: existing?.hire_date || "",
            ta_integration_id_1: existing?.ta_integration_id_1 || "",
            ta_integration_id_2: existing?.ta_integration_id_2 || "",
            access_profile: existing?.access_profile || "",
            ta_enabled: existing?.ta_enabled ?? null,
            permanent: existing?.permanent ?? null,
            active: existing?.active ?? (existing ? existing.status === "active" : true),
            status: existing?.status || "active",
            fingerprints_enrolled: existing?.fingerprints_enrolled ?? null,
          };
        })
        .filter((input) => input.employee_code && (input.first_name || input.last_name));

      if (employeeInputs.length === 0) {
        autoLinkRef.current = true;
        return;
      }

      const result = await importEmployees(employeeInputs);
      if (!alive) return;
      autoLinkRef.current = true;
      await onEmployeesRefresh?.();
      setStatusMessage((current) =>
        [
          current,
          `Auto-linked ${result.count || employeeInputs.length} employee profile${(result.count || employeeInputs.length) === 1 ? "" : "s"} from the biometric clock employee codes.`,
          result.error || "",
        ]
          .filter(Boolean)
          .join(" ")
      );
    };

    syncLinkedProfiles();

    return () => {
      alive = false;
    };
  }, [overview.summaries, employees, onEmployeesRefresh]);

  return (
    <div className="section-tech-stack">
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">
        <Card className="section-tech-stat rounded-2xl border-slate-700/50">
          <CardContent className="p-4 text-center">
            <div className="section-tech-kicker text-cyan-400">Raw Capture</div>
            <div className="mt-2 text-3xl font-bold text-white">{overview.totalEvents}</div>
            <div className="text-sm text-slate-400">Total Biometric Events</div>
          </CardContent>
        </Card>
        <Card className="section-tech-stat rounded-2xl border-slate-700/50">
          <CardContent className="p-4 text-center">
            <div className="section-tech-kicker text-purple-400">Daily Intelligence</div>
            <div className="mt-2 text-3xl font-bold text-purple-400">{overview.totalProcessedDays}</div>
            <div className="text-sm text-slate-400">Processed Clock Days</div>
          </CardContent>
        </Card>
        <Card className="section-tech-stat rounded-2xl border-slate-700/50">
          <CardContent className="p-4 text-center">
            <div className="section-tech-kicker text-cyan-400">Coverage</div>
            <div className="mt-2 text-3xl font-bold text-white">{overview.employeesWithClocks}</div>
            <div className="text-sm text-slate-400">Employees With Clocks</div>
          </CardContent>
        </Card>
        <Card className="section-tech-stat rounded-2xl border-slate-700/50">
          <CardContent className="p-4 text-center">
            <div className="section-tech-kicker text-emerald-400">Verified</div>
            <div className="mt-2 text-3xl font-bold text-emerald-400">{overview.verifiedEvents}</div>
            <div className="text-sm text-slate-400">Verified Events</div>
          </CardContent>
        </Card>
        <Card className="section-tech-stat rounded-2xl border-slate-700/50">
          <CardContent className="p-4 text-center">
            <div className="section-tech-kicker text-purple-400">Linked Profiles</div>
            <div className="mt-2 text-3xl font-bold text-purple-400">{linkedEmployees}</div>
            <div className="text-sm text-slate-400">Linked Profiles</div>
          </CardContent>
        </Card>
      </div>

      <Card className="section-tech-panel rounded-2xl border-slate-700/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <Clock3 className="section-tech-header-icon" />
            Clock Data
          </CardTitle>
          <CardDescription className="text-slate-400">
            Read-only biometric clock history linked to employees by employee code. These events can be searched and imported, but not edited.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="section-tech-subpanel px-4 py-3 text-sm text-slate-300">
            <div className="flex items-center gap-2 font-medium text-white">
              <Shield className="h-4 w-4" />
              Biometric clock data is locked
            </div>
            <div className="mt-1">Clock events are audit data. They are searchable and importable only, and there are no edit or delete actions in this section.</div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="relative min-w-[240px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search employee code, name, ID number, store, device, or method..."
                className="border-white/10 bg-white/5 pl-9 text-white placeholder:text-slate-400"
              />
            </div>

            <select
              value={storeFilter}
              onChange={(e) => setStoreFilter(e.target.value)}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100"
            >
              {storeOptions.map((store) => (
                <option key={store} value={store}>
                  {store === "all" ? "All stores" : store}
                </option>
              ))}
            </select>

            <Input
              type="date"
              value={startDateFilter}
              onChange={(e) => setStartDateFilter(e.target.value)}
              className="w-[170px] border-white/10 bg-white/5 text-white"
            />

            <Input
              type="date"
              value={endDateFilter}
              onChange={(e) => setEndDateFilter(e.target.value)}
              className="w-[170px] border-white/10 bg-white/5 text-white"
            />

            <input ref={uploadRef} type="file" accept=".xlsx,.xls,.csv" multiple onChange={handleImport} className="hidden" />
            <Button variant="outline" onClick={() => uploadRef.current?.click()} disabled={isImporting}>
              <Upload className="mr-2 h-4 w-4" />
              {isImporting ? "Importing..." : "Import clock payroll workbook(s)"}
            </Button>
            <Button variant="outline" onClick={() => void handleRefresh()} disabled={isImporting || isRefreshing}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
              {isRefreshing ? "Refreshing..." : "Refresh clock data"}
            </Button>
          </div>

          <div className="section-tech-subpanel px-4 py-3 text-sm text-slate-300">
            Select one file or many clock payroll workbooks together. The import supports branded exports with headings starting on <span className="font-semibold text-white">row 5</span>. Clock Data now loads only the selected <span className="font-semibold text-white">date or date range</span> from Supabase instead of pulling all clock history into the browser.
          </div>

          {hasSeedOnlyData ? (
            <div className="section-tech-subpanel border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
              The sample clock workbook currently loaded in the app contains only 1 biometric event for 1 employee. Upload the full clock files to populate the rest of the team.
            </div>
          ) : null}

          {isImporting ? (
            <div className="section-tech-subpanel border-slate-700 bg-slate-800/50 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-slate-300">{importStage || "Processing biometric clock import..."}</div>
                <div className="shrink-0 text-sm font-semibold text-cyan-400">{importPercent}%</div>
              </div>
              <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-700">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-gray-400 to-gray-600 transition-all duration-300"
                  style={{ width: `${Math.max(0, Math.min(importPercent, 100))}%` }}
                />
              </div>
            </div>
          ) : null}

          {isLoadingData ? (
            <div className="section-tech-subpanel tech-loader border-gray-400 bg-gray-100 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-gray-700">{loadStage || "Loading clock data..."}</div>
                <div className="shrink-0 text-sm font-semibold text-gray-700">{Math.max(0, Math.min(loadPercent, 100))}%</div>
              </div>
              <div className="mt-3 h-3 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-gray-500 to-gray-400 transition-all duration-300"
                  style={{ width: `${Math.max(0, Math.min(loadPercent, 100))}%` }}
                />
              </div>
            </div>
          ) : null}

          {statusMessage ? (
            <div className="section-tech-subpanel px-4 py-3 text-sm text-slate-300">{statusMessage}</div>
          ) : null}

          {lastImportReport ? (
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="section-tech-subpanel border-emerald-500/20 bg-emerald-500/5 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-emerald-300">Allocated clock rows</div>
                    <div className="mt-1 text-2xl font-bold text-white">{lastImportReport.allocatedCount}</div>
                    <div className="text-sm text-slate-300">Rows successfully allocated to employee codes.</div>
                  </div>
                  <Badge className="border-emerald-400/30 bg-emerald-500/10 text-emerald-100">
                    {lastImportReport.totalRows} total row{lastImportReport.totalRows === 1 ? "" : "s"}
                  </Badge>
                </div>

                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left text-slate-300">
                        <th className="px-3 py-2">Row</th>
                        <th className="px-3 py-2">Employee</th>
                        <th className="px-3 py-2">Match</th>
                        <th className="px-3 py-2">Profile</th>
                        <th className="px-3 py-2">Clock</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lastImportReport.allocatedRows.slice(0, 20).map((row) => (
                        <tr key={`${row.source_file_name}-${row.row_number}-allocated`} className={`border-b border-white/5 ${getAllocationRowClasses(row.status)}`}>
                          <td className="px-3 py-2">{row.row_number}</td>
                          <td className="px-3 py-2">
                            <div className="font-semibold text-white">{row.employee_code || "-"}</div>
                            <div className="text-xs text-slate-300">{row.employee_name}</div>
                          </td>
                          <td className="px-3 py-2">{row.matched_by || "employee_code"}</td>
                          <td className="px-3 py-2">{formatProfileStatus(row.employee_profile_status)}</td>
                          <td className="px-3 py-2">{formatClockTimestamp(row.clocked_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="section-tech-subpanel border-rose-500/20 bg-rose-500/5 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-rose-300">Unallocated clock rows</div>
                    <div className="mt-1 text-2xl font-bold text-white">{lastImportReport.unallocatedCount}</div>
                    <div className="text-sm text-slate-300">Rows that could not be allocated and were not saved.</div>
                  </div>
                  <Badge className="border-rose-400/30 bg-rose-500/10 text-rose-100">
                    Highlighted for review
                  </Badge>
                </div>

                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left text-slate-300">
                        <th className="px-3 py-2">Row</th>
                        <th className="px-3 py-2">Name / ID</th>
                        <th className="px-3 py-2">Clock</th>
                        <th className="px-3 py-2">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lastImportReport.unallocatedRows.length === 0 ? (
                        <tr>
                          <td className="px-3 py-3 text-slate-300" colSpan={4}>
                            No unallocated clock rows in the last import.
                          </td>
                        </tr>
                      ) : (
                        lastImportReport.unallocatedRows.slice(0, 20).map((row) => (
                          <tr key={`${row.source_file_name}-${row.row_number}-unallocated`} className={`border-b border-rose-400/10 ${getAllocationRowClasses(row.status)}`}>
                            <td className="px-3 py-2">{row.row_number}</td>
                            <td className="px-3 py-2">
                              <div className="font-semibold text-white">{row.employee_name}</div>
                              <div className="text-xs text-rose-100/80">{row.id_number || "No ID number"}</div>
                            </td>
                            <td className="px-3 py-2">{formatClockTimestamp(row.clocked_at)}</td>
                            <td className="px-3 py-2">{row.reason}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}

          <div className="section-tech-subpanel border-gray-300 bg-gray-100 px-4 py-3 text-sm text-gray-800">
            Clocks are now processed per employee and per date below. A single clock becomes <span className="font-semibold">No In/Out</span>, and two or more clocks use the first and last clock as <span className="font-semibold">In/Out</span>.
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {summaries.map((summary) => (
              <div key={summary.employee_code} className="section-tech-subpanel p-5">
                <div className="text-sm font-semibold text-white">
                  {summary.employee_code} - {summary.employee_name}
                </div>
                <div className="mt-1 text-xs text-slate-400">{summary.store || "Unassigned store"}</div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Events</div>
                    <div className="mt-1 font-semibold text-white">{summary.total_events}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Last Clock</div>
                    <div className="mt-1 font-semibold text-white">{formatClockTimestamp(summary.last_clocked_at)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="section-tech-table">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-gray-100 px-4 py-3">
              <div className="text-sm font-semibold text-gray-800">Processed Clock Days</div>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <span>
                  Showing {(processedPage - 1) * PROCESSED_PAGE_SIZE + (processedClockDays.length ? 1 : 0)}-
                  {(processedPage - 1) * PROCESSED_PAGE_SIZE + processedClockDays.length} of {overview.totalProcessedDays}
                </span>
                <Button variant="outline" size="sm" onClick={() => setProcessedPage((page) => Math.max(1, page - 1))} disabled={processedPage === 1}>
                  Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setProcessedPage((page) => page + 1)}
                  disabled={processedPage * PROCESSED_PAGE_SIZE >= overview.totalProcessedDays}
                >
                  Next
                </Button>
              </div>
            </div>
            <div ref={processedTableRef} className="overflow-auto max-h-[500px]">
              <table className="w-full min-w-[1200px] border-collapse sticky top-0">
                <thead className="bg-slate-800/80 text-left">
                  <tr>
                    <th className="px-4 py-3 text-sm font-semibold text-cyan-400">Date</th>
                    <th className="px-4 py-3 text-sm font-semibold text-cyan-400">Employee</th>
                    <th className="px-4 py-3 text-sm font-semibold text-cyan-400">Store</th>
                    <th className="px-4 py-3 text-sm font-semibold text-cyan-400">Clocks</th>
                    <th className="px-4 py-3 text-sm font-semibold text-cyan-400">First Clock</th>
                    <th className="px-4 py-3 text-sm font-semibold text-cyan-400">Last Clock</th>
                    <th className="px-4 py-3 text-sm font-semibold text-cyan-400">Status</th>
                    <th className="px-4 py-3 text-sm font-semibold text-cyan-400">Method / Device</th>
                  </tr>
                </thead>
                <tbody>
                  {processedClockDays.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">
                        No processed clock days match the current search.
                      </td>
                    </tr>
) : (
                     processedRowVirtualizer.getVirtualItems().map((virtualRow: { index: number; size: number }) => {
                       const day = processedClockDays[virtualRow.index];
                       return (
                         <tr
                           key={day.key}
                           className="border-t border-white/10 bg-transparent hover:bg-white/5"
                           style={{
                             height: `${virtualRow.size}px`,
                           }}
                         >
                          <td className="px-4 py-3 text-sm font-medium text-white">{formatClockDate(day.clock_date)}</td>
                          <td className="px-4 py-3 text-sm">
                            <div className="font-medium text-white">
                              {day.employee_code} - {day.employee_name}
                            </div>
                            <div className="text-xs text-slate-400">{day.id_number || "No ID number"}</div>
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-300">{day.store || "-"}</td>
                          <td className="px-4 py-3 text-sm font-semibold text-white">{day.clock_count}</td>
                          <td className="px-4 py-3 text-sm text-slate-300">{day.first_clock || "-"}</td>
                          <td className="px-4 py-3 text-sm text-slate-300">{day.last_clock || "-"}</td>
                          <td className="px-4 py-3 text-sm">
                            <Badge className={day.status === "In/Out" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}>
                              {day.status}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-sm">
                            <div className="font-medium text-white">{day.methods.join(", ") || "-"}</div>
                            <div className="text-xs text-slate-400">{day.devices.join(", ") || "-"}</div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="section-tech-table">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-white/5 px-4 py-3">
              <div className="text-sm font-semibold text-white">Raw Biometric Events</div>
              <div className="flex items-center gap-2 text-sm text-slate-300">
                <span>
                  Showing {(rawPage - 1) * RAW_PAGE_SIZE + (rawEvents.length ? 1 : 0)}-
                  {(rawPage - 1) * RAW_PAGE_SIZE + rawEvents.length} of {overview.totalEvents}
                </span>
                <Button variant="outline" size="sm" onClick={() => setRawPage((page) => Math.max(1, page - 1))} disabled={rawPage === 1}>
                  Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRawPage((page) => page + 1)}
                  disabled={rawPage * RAW_PAGE_SIZE >= overview.totalEvents}
                >
                  Next
                </Button>
              </div>
            </div>
            <div ref={rawTableRef} className="overflow-auto max-h-[500px]">
              <table className="w-full min-w-[1200px] border-collapse sticky top-0">
                <thead className="bg-slate-800/80 text-left">
                  <tr>
                    <th className="px-4 py-3 text-sm font-semibold text-cyan-400">Clocked At</th>
                    <th className="px-4 py-3 text-sm font-semibold text-cyan-400">Employee</th>
                    <th className="px-4 py-3 text-sm font-semibold text-cyan-400">ID Number</th>
                    <th className="px-4 py-3 text-sm font-semibold text-cyan-400">Store / Device</th>
                    <th className="px-4 py-3 text-sm font-semibold text-cyan-400">Method</th>
                    <th className="px-4 py-3 text-sm font-semibold text-cyan-400">Direction</th>
                    <th className="px-4 py-3 text-sm font-semibold text-cyan-400">Access</th>
                    <th className="px-4 py-3 text-sm font-semibold text-cyan-400">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {rawEvents.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">
                        No biometric clock events match the current search.
                      </td>
                    </tr>
                  ) : (
                    rawRowVirtualizer.getVirtualItems().map((virtualRow) => {
                      const item = rawEvents[virtualRow.index];
                      return (
                        <tr
                          key={item.event_key}
                          className="border-t border-slate-700/50 hover:bg-slate-800/50"
                          style={{
                            height: `${virtualRow.size}px`,
                          }}
                        >
                          <td className="px-4 py-3 text-sm font-medium text-white">{formatClockTimestamp(item.clocked_at)}</td>
                          <td className="px-4 py-3 text-sm">
                            <div className="font-medium text-white">
                              {item.employee_code} - {[item.first_name, item.last_name].filter(Boolean).join(" ") || item.alias || "Unknown employee"}
                            </div>
                            <div className="text-xs text-slate-400">{item.alias || item.employee_number || "No alias"}</div>
                          </td>
                          <td className="px-4 py-3 text-sm font-mono">{item.id_number || "-"}</td>
                          <td className="px-4 py-3 text-sm">
                            <div className="font-medium text-white">{item.store || "-"}</div>
                            <div className="text-xs text-slate-400">{item.device_name || "-"}</div>
                          </td>
                          <td className="px-4 py-3 text-sm">
                            <Badge className="bg-slate-700 text-slate-200 border border-slate-600">{item.method || "Unknown"}</Badge>
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-300">{item.direction || "-"}</td>
                          <td className="px-4 py-3 text-sm">
                            <div className="flex flex-wrap gap-2">
                              <Badge className={item.access_granted ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-red-500/20 text-red-400 border border-red-500/30"}>
                                {item.access_granted ? "Granted" : "Blocked"}
                              </Badge>
                              <Badge className={item.access_verified ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30" : "bg-slate-500/20 text-slate-400 border border-slate-500/30"}>
                                {item.access_verified ? "Verified" : "Unverified"}
                              </Badge>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-400">{item.source_file_name || "-"}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
