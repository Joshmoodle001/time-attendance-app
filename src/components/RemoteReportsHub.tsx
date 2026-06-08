import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Building2, Download, Loader2, Search, Server, ShieldCheck, UserRound, WandSparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  getEmployees,
  initializeEmployeeDatabase,
  normalizeEmployeeCode,
  type Employee,
} from "@/services/database";
import { getStoreGrouping } from "@/services/regionMaster";
import { buildRemoteReportPdf } from "@/lib/remoteReportFormat";
import type { RemoteReportPayload } from "@/types/desktopReportBridge";

type ReportTemplateKey = "attendance_report" | "awol_report";
type SelectionMode = "store" | "employees";

type StoreOption = {
  key: string;
  store: string;
  storeCode: string;
  displayName: string;
  region: string;
  groupKey: string;
  groupLabel: string;
  employeeCount: number;
  employeeCodes: string[];
};

type ReportServerStatus = {
  online?: boolean;
  workerReady?: boolean;
  queue?: {
    queued: number;
    processing?: number;
    active?: number;
    complete?: number;
    completed: number;
    failed: number;
  };
  serverId?: string;
  lastSeenAt?: string;
  lastCompletedAt?: string;
  lastError?: string;
};

type RemotePdfResult = {
  fileName?: string;
  mimeType?: string;
  pdfBase64?: string;
  sessionId?: string;
};

const REPORT_API_BASE = "/api";
const REPORT_SESSION_STORAGE_KEY = "remote-reports-session-id-v1";
const MAX_VISIBLE_SEARCH_RESULTS = 8;

const REPORT_TEMPLATES: Array<{ key: ReportTemplateKey; title: string; description: string }> = [
  {
    key: "attendance_report",
    title: "Attendance Report",
    description: "Generate the attendance report from the desktop host and export the PDF from this browser session.",
  },
  {
    key: "awol_report",
    title: "AWOL Report",
    description: "Generate the AWOL PDF from the desktop app using the same local employee, shift, and attendance data.",
  },
];

function normalizeText(value: unknown) {
  return value === null || value === undefined ? "" : String(value).replace(/\s+/g, " ").trim();
}

function normalizeCompare(value: unknown) {
  return normalizeText(value).toLowerCase();
}

function buildStoreKey(store: unknown, storeCode: unknown) {
  return `${normalizeCompare(storeCode)}::${normalizeCompare(store)}`;
}

function buildStoreDisplayName(store: unknown, storeCode: unknown) {
  const normalizedStore = normalizeText(store) || "Unassigned store";
  const normalizedStoreCode = normalizeText(storeCode);
  return normalizedStoreCode ? `${normalizedStoreCode} - ${normalizedStore} (${normalizedStoreCode})` : normalizedStore;
}

function matchesEmployeeSearch(employee: Employee, query: string) {
  const normalizedQuery = normalizeCompare(query);
  if (!normalizedQuery) return false;
  const haystack = [
    employee.employee_code,
    employee.id_number,
    employee.first_name,
    employee.last_name,
    `${employee.first_name} ${employee.last_name}`,
    `${employee.last_name} ${employee.first_name}`,
    employee.store,
    employee.store_code,
  ]
    .map(normalizeText)
    .join(" ");
  return normalizeCompare(haystack).includes(normalizedQuery);
}

function isEmployeeIncludedInBuilder(employee: Employee | undefined | null, includeInactiveProfiles: boolean) {
  if (!employee) return false;
  if (includeInactiveProfiles) return true;
  const status = normalizeCompare(employee.status);
  if (status === "inactive" || status === "terminated") return false;
  if (employee.active === false) return false;
  return true;
}

function getEmployeeProfileState(employee: Employee | undefined | null) {
  if (!employee) return "";
  const status = normalizeCompare(employee.status);
  if (status) return status;
  if (employee.active === false) return "inactive";
  return "active";
}

function formatDateInput(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export default function RemoteReportsHub() {
  const today = useMemo(() => new Date(), []);
  const [templateKey, setTemplateKey] = useState<ReportTemplateKey>("attendance_report");
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("store");
  const [startDate, setStartDate] = useState(formatDateInput(today));
  const [endDate, setEndDate] = useState(formatDateInput(today));
  const [selectedStores, setSelectedStores] = useState<string[]>([]);
  const [selectedEmployeeCodes, setSelectedEmployeeCodes] = useState<string[]>([]);
  const [awolThresholdDays, setAwolThresholdDays] = useState("3");
  const [includeInactiveProfiles, setIncludeInactiveProfiles] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Ready to send a report request to the desktop server host.");
  const [serverReachable, setServerReachable] = useState<boolean | null>(null);
  const [serverStatus, setServerStatus] = useState<ReportServerStatus | null>(null);
  const [activeJobId, setActiveJobId] = useState("");
  const [reportPayload, setReportPayload] = useState<RemoteReportPayload | null>(null);
  const [pdfResult, setPdfResult] = useState<RemotePdfResult | null>(null);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeesReady, setEmployeesReady] = useState(false);
  const [storeSearch, setStoreSearch] = useState("");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const loadedRef = useRef(false);
  const storeSearchRef = useRef<HTMLInputElement | null>(null);
  const employeeSearchRef = useRef<HTMLInputElement | null>(null);

  const [sessionId] = useState(() => {
    if (typeof window === "undefined") {
      return `session-${Date.now()}`;
    }
    const existing = window.sessionStorage.getItem(REPORT_SESSION_STORAGE_KEY);
    if (existing) {
      return existing;
    }
    const next = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `session-${Date.now()}`;
    window.sessionStorage.setItem(REPORT_SESSION_STORAGE_KEY, next);
    return next;
  });

  const sameMachineHint =
    "Any device can request reports here. The Electron server machine polls the live queue, generates the report from its local data, and sends the finished result back to this browser session.";

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    let alive = true;

    (async () => {
      try {
        await initializeEmployeeDatabase();
        const data = await getEmployees();
        if (!alive) return;
        setEmployees(data);
      } catch (error) {
        console.error("Failed to load employee profiles for remote reports:", error);
        if (alive) {
          setEmployeesReady(true);
        }
      } finally {
        if (alive) setEmployeesReady(true);
      }
    })();

    return () => { alive = false; };
  }, []);

  const effectiveEmployees = useMemo(
    () => employees.filter((emp) => isEmployeeIncludedInBuilder(emp, includeInactiveProfiles)),
    [employees, includeInactiveProfiles],
  );

  const storeOptions = useMemo<StoreOption[]>(() => {
    const values = new Map<string, StoreOption>();

    effectiveEmployees.forEach((employee) => {
      const store = normalizeText(employee.store);
      const storeCode = normalizeText(employee.store_code);
      if (!store && !storeCode) return;
      const grouping = getStoreGrouping(store, storeCode, employee.region);

      const key = buildStoreKey(store, storeCode);
      const existing = values.get(key) || {
        key,
        store: grouping.store || store || "Unassigned store",
        storeCode,
        displayName: buildStoreDisplayName(grouping.store || store, storeCode),
        region: grouping.region,
        groupKey: grouping.groupKey,
        groupLabel: grouping.groupLabel,
        employeeCount: 0,
        employeeCodes: [],
      };

      existing.employeeCount += 1;
      const normalizedCode = normalizeEmployeeCode(employee.employee_code);
      if (normalizedCode && !existing.employeeCodes.includes(normalizedCode)) {
        existing.employeeCodes.push(normalizedCode);
      }

      values.set(key, existing);
    });

    return Array.from(values.values())
      .map((option) => ({
        ...option,
        employeeCodes: [...option.employeeCodes].sort((a, b) => a.localeCompare(b)),
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [effectiveEmployees]);

  const employeeOptions = useMemo(
    () =>
      [...effectiveEmployees].sort(
        (a, b) =>
          normalizeText(a.store).localeCompare(normalizeText(b.store)) ||
          normalizeText(a.last_name).localeCompare(normalizeText(b.last_name)) ||
          normalizeText(a.first_name).localeCompare(normalizeText(a.first_name)),
      ),
    [effectiveEmployees],
  );

  const storeSelectionGroups = useMemo(() => {
    const counts = new Map<string, { key: string; label: string; count: number }>();
    storeOptions.forEach((option) => {
      const existing = counts.get(option.groupKey) || { key: option.groupKey, label: option.groupLabel, count: 0 };
      existing.count += 1;
      counts.set(option.groupKey, existing);
    });
    return Array.from(counts.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [storeOptions]);

  const storeRegionGroups = useMemo(() => {
    const byRegion = new Map<string, { region: string; groups: Map<string, { key: string; label: string; stores: StoreOption[] }> }>();

    storeOptions.forEach((option) => {
      const region = option.region || "UNASSIGNED";
      if (!byRegion.has(region)) {
        byRegion.set(region, { region, groups: new Map() });
      }
      const entry = byRegion.get(region)!;
      if (!entry.groups.has(option.groupKey)) {
        entry.groups.set(option.groupKey, { key: option.groupKey, label: option.groupLabel, stores: [] });
      }
      entry.groups.get(option.groupKey)!.stores.push(option);
    });

    return Array.from(byRegion.values())
      .map((entry) => ({
        region: entry.region,
        groups: Array.from(entry.groups.values())
          .map((group) => ({
            ...group,
            stores: group.stores.sort((a, b) => a.displayName.localeCompare(b.displayName)),
          }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      }))
      .sort((a, b) => a.region.localeCompare(b.region));
  }, [storeOptions]);

  const storeSearchResults = useMemo(() => {
    const query = normalizeCompare(storeSearch);
    if (!query) return [];
    const selectedSet = new Set(selectedStores);
    return storeOptions
      .filter((opt) => !selectedSet.has(opt.key))
      .filter((opt) =>
        normalizeCompare(`${opt.displayName} ${opt.store} ${opt.storeCode}`).includes(query),
      )
      .slice(0, MAX_VISIBLE_SEARCH_RESULTS);
  }, [selectedStores, storeOptions, storeSearch]);

  const employeeSearchResults = useMemo(() => {
    const query = normalizeCompare(employeeSearch);
    if (!query) return [];
    const selectedSet = new Set(selectedEmployeeCodes.map((code) => normalizeEmployeeCode(code)));
    return employeeOptions
      .filter((emp) => !selectedSet.has(normalizeEmployeeCode(emp.employee_code)))
      .filter((emp) => matchesEmployeeSearch(emp, query))
      .slice(0, MAX_VISIBLE_SEARCH_RESULTS);
  }, [employeeOptions, employeeSearch, selectedEmployeeCodes]);

  const queueSummary = useMemo(() => {
    const queue = serverStatus?.queue;
    if (!queue) return null;
    const inProgress = queue.processing ?? queue.active ?? 0;
    const completed = queue.completed ?? queue.complete ?? 0;
    return [
      `${queue.queued} queued`,
      `${inProgress} in progress`,
      `${completed} completed`,
    ].join(" | ");
  }, [serverStatus]);

  const hasSelectedScope = selectionMode === "store" ? selectedStores.length > 0 : selectedEmployeeCodes.length > 0;

  const selectedStoreOptions = useMemo(
    () =>
      selectedStores
        .map((storeKey) => storeOptions.find((option) => option.key === storeKey))
        .filter(Boolean) as StoreOption[],
    [selectedStores, storeOptions],
  );

  const selectedEmployees = useMemo(
    () =>
      selectedEmployeeCodes
        .map((employeeCode) =>
          employeeOptions.find(
            (emp) => normalizeEmployeeCode(emp.employee_code) === normalizeEmployeeCode(employeeCode),
          ),
        )
        .filter(Boolean) as Employee[],
    [employeeOptions, selectedEmployeeCodes],
  );

  const addStore = useCallback((storeKey: string) => {
    setSelectedStores((current) => (current.includes(storeKey) ? current : [...current, storeKey]));
    setStoreSearch("");
  }, []);

  const removeStore = useCallback((storeKey: string) => {
    setSelectedStores((current) => current.filter((key) => key !== storeKey));
  }, []);

  const addStoresByGroup = useCallback((groupKey: string) => {
    const groupStoreKeys = storeOptions
      .filter((option) => option.groupKey === groupKey)
      .map((option) => option.key);
    setSelectedStores((current) => {
      const existing = new Set(current);
      groupStoreKeys.forEach((key) => existing.add(key));
      return Array.from(existing);
    });
  }, [storeOptions]);

  const addAllStores = useCallback(() => {
    setSelectedStores(storeOptions.map((option) => option.key));
  }, [storeOptions]);

  const clearAllStores = useCallback(() => {
    setSelectedStores([]);
    setStoreSearch("");
  }, []);

  const addEmployee = useCallback((employeeCode: string) => {
    const normalized = normalizeEmployeeCode(employeeCode);
    setSelectedEmployeeCodes((current) => (current.includes(normalized) ? current : [...current, normalized]));
    setEmployeeSearch("");
  }, []);

  const removeEmployee = useCallback((employeeCode: string) => {
    const normalized = normalizeEmployeeCode(employeeCode);
    setSelectedEmployeeCodes((current) => current.filter((code) => code !== normalized));
  }, []);

  const handleSearchFocus = useCallback((ref: { current: HTMLInputElement | null }) => {
    if (typeof window === "undefined") return;
    window.setTimeout(() => {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 180);
  }, []);

  const selectorDataReady = employeesReady && storeOptions.length > 0 && employeeOptions.length > 0;

  const checkDesktopServer = useCallback(async (silently = false) => {
    try {
      const response = await fetch(`${REPORT_API_BASE}/report-server-status`, {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Desktop server returned ${response.status}`);
      }
      const payload = (await response.json()) as ReportServerStatus;
      setServerStatus(payload);
      setServerReachable(Boolean(payload.online));
      if (!silently) {
        const workerMessage = payload.workerReady ? "worker ready" : "worker warming up";
        setStatusMessage(
          payload.online
            ? `Desktop report server is online and ${workerMessage}.`
            : "Desktop report server host is offline. Start the Electron host machine and wait a few seconds.",
        );
      }
    } catch (error) {
      setServerStatus(null);
      setServerReachable(false);
      if (!silently) {
        setStatusMessage(error instanceof Error ? error.message : "Desktop report server is not reachable.");
      }
    }
  }, []);

  useEffect(() => {
    void checkDesktopServer(true);
    const interval = window.setInterval(() => {
      void checkDesktopServer(true);
    }, 10000);
    return () => window.clearInterval(interval);
  }, [checkDesktopServer]);

  const pollReportJob = useCallback(
    async (jobId: string) => {
      if (!jobId) return;
      try {
        const response = await fetch(`${REPORT_API_BASE}/report-jobs?jobId=${encodeURIComponent(jobId)}&sessionId=${encodeURIComponent(sessionId)}`, {
          method: "GET",
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(`Report job lookup returned ${response.status}`);
        }
        const payload = await response.json();
        const job = payload?.job;
        if (!job) return;

        if (job.status === "complete" && job.result) {
          if (job.result?.pdfBase64) {
            setPdfResult(job.result as RemotePdfResult);
            setReportPayload(null);
            setStatusMessage("Report generated successfully. You can now download it from this browser session.");
          } else if (job.result?.reportPayload?.criteria?.templateKey) {
            setReportPayload(job.result.reportPayload as RemoteReportPayload);
            setPdfResult(null);
            setStatusMessage("Report generated successfully. You can now export the PDF from this browser session.");
          } else if (job.result?.reportPayload) {
            // reportPayload exists but is missing criteria — log and skip
            console.warn("Report payload missing criteria field:", job.result.reportPayload);
            setPdfResult(null);
            setReportPayload(null);
            setStatusMessage("Report completed, but the data is incomplete. Try generating a new report.");
          } else {
            setPdfResult(null);
            setReportPayload(null);
            setStatusMessage("Report completed, but no usable result payload was returned.");
          }
          setActiveJobId("");
          setIsGenerating(false);
          void checkDesktopServer(true);
          return;
        }

        if (job.status === "failed") {
          setStatusMessage(job.error || "Desktop server failed to generate the requested report.");
          setActiveJobId("");
          setIsGenerating(false);
          void checkDesktopServer(true);
          return;
        }

        if (job.status === "processing") {
          setStatusMessage("Desktop server is processing the report request for this session...");
        } else {
          setStatusMessage("Report request queued. Waiting for the desktop server host to pick it up...");
        }
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : "Could not refresh the report request status.");
      }
    },
    [checkDesktopServer, sessionId],
  );

  useEffect(() => {
    if (!activeJobId) return;
    void pollReportJob(activeJobId);
    const interval = window.setInterval(() => {
      void pollReportJob(activeJobId);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [activeJobId, pollReportJob]);

  const handleGenerate = async (requestMode: "selected" | "all" = "selected") => {
    if (requestMode === "selected" && !hasSelectedScope) {
      setStatusMessage(
        selectionMode === "store"
          ? "Select at least one team or store first. Targeted requests return much faster than full-company runs."
          : "Select at least one employee first. Targeted requests return much faster than full-company runs.",
      );
      return;
    }
    setIsGenerating(true);
    setReportPayload(null);
    setPdfResult(null);
    setStatusMessage(
      requestMode === "all"
        ? "Sending a full-company report request to the desktop server host. This can take longer."
        : "Sending a targeted report request to the desktop server host...",
    );
    try {
      const storeSearchTerms = selectionMode === "store"
        ? selectedStores
            .map((key) => storeOptions.find((opt) => opt.key === key))
            .filter(Boolean)
            .map((opt) => opt!.storeCode || opt!.store)
        : [];

      const payload = {
        sessionId,
        templateKey,
        startDate,
        endDate,
        selectionMode,
        includeInactiveProfiles,
        requestMode,
        selectedStores: requestMode === "all" ? [] : storeSearchTerms,
        employeeCodes: requestMode === "all" ? [] : selectionMode === "employees" ? selectedEmployeeCodes : [],
        awolThresholdDays: templateKey === "awol_report" ? Number(awolThresholdDays || 0) : undefined,
      };

      const response = await fetch(`${REPORT_API_BASE}/report-jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...payload,
          outputMode: "data",
        }),
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null);
        throw new Error(errorPayload?.error || `Report request returned ${response.status}`);
      }

      const responsePayload = await response.json();
      const nextJobId = String(responsePayload?.jobId || "").trim();
      if (!nextJobId) {
        throw new Error("The server host request was accepted, but no job ID was returned.");
      }

      setActiveJobId(nextJobId);
      setServerReachable(true);
      setStatusMessage("Report request queued. Waiting for the desktop server host to process it.");
      void checkDesktopServer(true);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Desktop report request failed.");
      void checkDesktopServer(true);
      setIsGenerating(false);
    }
  };

  const handleExportGeneratedPdf = async () => {
    if (pdfResult?.pdfBase64) {
      try {
        const binary = window.atob(pdfResult.pdfBase64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }
        const blob = new Blob([bytes], { type: pdfResult.mimeType || "application/pdf" });
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = pdfResult.fileName || "remote-report.pdf";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        setStatusMessage("The report PDF was downloaded from this browser session.");
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : "The PDF download failed.");
      }
      return;
    }

    if (!reportPayload) {
      setStatusMessage("Generate a report first, then export it from this web session.");
      return;
    }

    if (!reportPayload?.criteria?.templateKey) {
      console.error("[ExportPDF] reportPayload is missing criteria:", {
        hasPayload: !!reportPayload,
        hasCriteria: !!(reportPayload && reportPayload.criteria),
        payloadKeys: reportPayload ? Object.keys(reportPayload) : [],
        criteriaKeys: reportPayload?.criteria ? Object.keys(reportPayload.criteria) : [],
        rawPayload: reportPayload,
      });
      setStatusMessage("The report data is incomplete and cannot be exported. Try generating a new report.");
      setIsExporting(false);
      return;
    }

    console.log("[ExportPDF] Payload looks valid, generating PDF...", {
      templateKey: reportPayload.criteria.templateKey,
      sections: reportPayload.sections?.length,
      awolRows: reportPayload.awolRows?.length,
    });
    setIsExporting(true);
    try {
      const { blob, fileName } = await buildRemoteReportPdf(reportPayload);
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
      setStatusMessage("The report was exported from this web session.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "The web PDF export failed.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl border border-white/10 bg-[#0d1117]">
        <CardHeader className="border-b border-white/5 pb-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl font-bold text-white">
                <WandSparkles className="h-5 w-5 text-cyan-400" />
                Remote Report Request <Badge className="ml-1 bg-green-600 text-[10px]">v2·guarded</Badge>
              </CardTitle>
              <CardDescription className="mt-2 text-slate-400">
                Send a session-linked request to the Electron server host. The host processes the report and this page handles the finished browser-side export flow.
              </CardDescription>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
              <Badge className={serverReachable === false ? "bg-red-500/20 text-red-300" : "bg-cyan-500/20 text-cyan-300"}>
                {serverReachable === false ? "Server host offline" : serverReachable ? "Server host online" : "Server host unchecked"}
              </Badge>
              <Badge className={serverStatus?.workerReady ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"}>
                {serverStatus?.workerReady ? "Worker ready" : "Worker warming up"}
              </Badge>
              <Button type="button" variant="outline" className="hidden sm:inline-flex sm:w-auto" onClick={() => void checkDesktopServer()}>
                <Server className="mr-2 h-4 w-4" />
                Check server host
              </Button>
            </div>
          </div>
          <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs leading-6 text-amber-100">
            {sameMachineHint}
          </div>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          <div className="grid gap-6 xl:grid-cols-2">
            <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-5">
              <div className="text-xs font-semibold uppercase tracking-widest text-cyan-400">Step 1</div>
              <div className="text-sm font-semibold text-white">Choose report type</div>
              <div className="grid gap-3">
                {REPORT_TEMPLATES.map((template) => {
                  const active = template.key === templateKey;
                  return (
                    <button
                      key={template.key}
                      type="button"
                      onClick={() => setTemplateKey(template.key)}
                      className={`rounded-xl border p-4 text-left transition-all ${
                        active
                          ? "border-cyan-500 bg-cyan-950/30 shadow-[0_0_20px_rgba(6,182,212,0.15)]"
                          : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10"
                      }`}
                    >
                      <div className="font-semibold text-white">{template.title}</div>
                      <div className="mt-1 text-sm text-slate-300">{template.description}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-4 rounded-xl border border-white/10 bg-white/5 p-5">
              <div className="text-xs font-semibold uppercase tracking-widest text-cyan-400">Step 2</div>
              <div className="text-sm font-semibold text-white">Set date range and scope</div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">Start date</label>
                  <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="bg-slate-900/80 text-white" />
                </div>
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">End date</label>
                  <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="bg-slate-900/80 text-white" />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">Selection mode</label>
                  <select
                    value={selectionMode}
                    onChange={(event) => setSelectionMode(event.target.value as SelectionMode)}
                    className="w-full rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white"
                  >
                    <option value="store">By Teams / Stores</option>
                    <option value="employees">By Employee Codes</option>
                  </select>
                </div>
                {templateKey === "awol_report" ? (
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">AWOL threshold</label>
                    <Input
                      type="number"
                      min="1"
                      value={awolThresholdDays}
                      onChange={(event) => setAwolThresholdDays(event.target.value)}
                      className="bg-slate-900/80 text-white"
                    />
                  </div>
                ) : (
                  <div className="flex items-end">
                    <label className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-slate-300">
                      <input
                        type="checkbox"
                        checked={includeInactiveProfiles}
                        onChange={(event) => setIncludeInactiveProfiles(event.target.checked)}
                        className="h-4 w-4 rounded border-white/20 bg-slate-900"
                      />
                      Include inactive profiles
                    </label>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  {selectionMode === "store" ? (
                    <Building2 className="h-4 w-4 text-cyan-400" />
                  ) : (
                    <UserRound className="h-4 w-4 text-cyan-400" />
                  )}
                  <span className="text-sm font-semibold text-white">
                    {selectionMode === "store" ? "Search teams / stores" : "Search employees"}
                  </span>
                  {!selectorDataReady && (
                    <Badge className="border-amber-500/30 bg-amber-950/30 text-amber-300">
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      Loading profiles...
                    </Badge>
                  )}
                  {selectorDataReady && (
                    <Badge className="border-emerald-500/30 bg-emerald-950/30 text-emerald-300">
                      Profiles loaded
                    </Badge>
                  )}
                  <button
                    type="button"
                    onClick={() => setIncludeInactiveProfiles((current) => !current)}
                    className={`inline-flex w-full items-center justify-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition sm:ml-auto sm:w-auto ${
                      includeInactiveProfiles
                        ? "border-amber-400/40 bg-amber-500/10 text-amber-200"
                        : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20"
                    }`}
                  >
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${
                        includeInactiveProfiles ? "bg-amber-300" : "bg-emerald-400"
                      }`}
                    />
                    {includeInactiveProfiles ? "Including inactive / terminated" : "Only active profiles"}
                  </button>
                </div>

                {selectionMode === "store" ? (
                  <>
                    {selectorDataReady && storeSelectionGroups.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={addAllStores}
                          className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-300 transition hover:border-white/20 hover:bg-white/10"
                        >
                          Select All ({storeOptions.length})
                        </button>
                        {selectedStores.length > 0 && (
                          <button
                            type="button"
                            onClick={clearAllStores}
                            className="rounded-full border border-red-500/30 bg-red-950/20 px-3 py-1 text-xs font-semibold text-red-300 transition hover:bg-red-900/40"
                          >
                            Clear All
                          </button>
                        )}
                      </div>
                    )}

                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                      <Input
                        ref={storeSearchRef}
                        value={storeSearch}
                        onChange={(event) => setStoreSearch(event.target.value)}
                        onFocus={() => handleSearchFocus(storeSearchRef)}
                        className="border-white/10 bg-slate-900/80 pl-9 text-white placeholder:text-slate-500"
                        placeholder="Search teams by partial match..."
                      />
                    </div>

                    {storeSearchResults.length > 0 && (
                      <div className="max-h-64 overflow-y-auto rounded-lg border border-white/10">
                        {storeSearchResults.map((result) => (
                          <button
                            key={result.key}
                            type="button"
                            onClick={() => addStore(result.key)}
                            className="flex w-full items-center justify-between border-b border-white/5 px-4 py-3 text-left transition hover:bg-white/5 last:border-b-0"
                          >
                            <div>
                              <div className="text-sm font-medium text-white">{result.displayName}</div>
                              <div className="text-xs text-slate-500">
                                {result.region} - {result.groupLabel} - {result.employeeCount} {result.employeeCount === 1 ? "employee" : "employees"}
                              </div>
                            </div>
                            <span className="text-xs font-semibold text-cyan-400">+ Add</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {storeSearch && storeSearchResults.length === 0 && selectorDataReady && (
                      <div className="rounded-lg border border-dashed border-white/10 px-4 py-3 text-center text-sm text-slate-500">
                        No team matched that search.
                      </div>
                    )}

                    {selectorDataReady && storeRegionGroups.length > 0 && (
                    <div className="hidden rounded-lg border border-white/10 bg-white/[0.02] p-3 lg:block">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Teams by Region</div>
                        <div className="max-h-52 space-y-3 overflow-y-auto pr-1">
                          {storeRegionGroups.map((regionGroup) => (
                            <div key={regionGroup.region} className="rounded-md border border-white/5 bg-black/20 p-2">
                              <div className="mb-2 text-xs font-semibold text-emerald-300">{regionGroup.region}</div>
                              <div className="space-y-2">
                                {regionGroup.groups.map((group) => (
                                  <div key={group.key} className="flex items-center justify-between rounded-md border border-white/5 bg-white/[0.02] p-2">
                                    <div className="text-xs text-slate-300">{group.label}</div>
                                    <button
                                      type="button"
                                      onClick={() => addStoresByGroup(group.key)}
                                      className="rounded-full border border-cyan-500/30 bg-cyan-950/20 px-2 py-1 text-[11px] font-semibold text-cyan-300 transition hover:bg-cyan-900/40"
                                    >
                                      Add all ({group.stores.length})
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedStoreOptions.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {selectedStoreOptions.map((store) => (
                          <button
                            key={store.key}
                            type="button"
                            onClick={() => removeStore(store.key)}
                            className="rounded-full border border-cyan-500/30 bg-cyan-950/30 px-3 py-1 text-sm text-cyan-300 transition hover:bg-cyan-900/50"
                          >
                            {store.displayName} x
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                      <Input
                        ref={employeeSearchRef}
                        value={employeeSearch}
                        onChange={(event) => setEmployeeSearch(event.target.value)}
                        onFocus={() => handleSearchFocus(employeeSearchRef)}
                        className="border-white/10 bg-slate-900/80 pl-9 text-white placeholder:text-slate-500"
                        placeholder="Search first name, last name, employee code, or ID number..."
                      />
                    </div>

                    {employeeSearchResults.length > 0 && (
                      <div className="max-h-64 overflow-y-auto rounded-lg border border-white/10">
                        {employeeSearchResults.map((employee) => (
                          <button
                            key={employee.employee_code}
                            type="button"
                            onClick={() => addEmployee(employee.employee_code)}
                            className="flex w-full items-center justify-between border-b border-white/5 px-4 py-3 text-left transition hover:bg-white/5 last:border-b-0"
                          >
                            <div>
                              <div className="text-sm font-medium text-white">
                                {employee.first_name} {employee.last_name}
                              </div>
                              <div className="text-xs text-slate-500">
                                {employee.employee_code}
                                {employee.id_number ? ` \u2022 ${employee.id_number}` : ""}
                                {employee.store ? ` \u2022 ${buildStoreDisplayName(employee.store, employee.store_code)}` : ""}
                                {getEmployeeProfileState(employee) ? ` \u2022 ${getEmployeeProfileState(employee)}` : ""}
                              </div>
                            </div>
                            <span className="text-xs font-semibold text-cyan-400">+ Add</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {employeeSearch && employeeSearchResults.length === 0 && selectorDataReady && (
                      <div className="rounded-lg border border-dashed border-white/10 px-4 py-3 text-center text-sm text-slate-500">
                        No employee profile matched that search.
                      </div>
                    )}

                    {selectedEmployees.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {selectedEmployees.map((employee) => {
                          const normalizedCode = normalizeEmployeeCode(employee.employee_code);
                          return (
                            <button
                              key={normalizedCode}
                              type="button"
                              onClick={() => removeEmployee(normalizedCode)}
                              className="rounded-full border border-cyan-500/30 bg-cyan-950/30 px-3 py-1 text-sm text-cyan-300 transition hover:bg-cyan-900/50"
                            >
                              {employee.first_name} {employee.last_name} ({employee.employee_code}) x
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {selectedEmployees.length === 0 && !employeeSearch && selectorDataReady && (
                      <div className="rounded-lg border border-dashed border-white/10 px-4 py-3 text-center text-sm text-slate-500">
                        No employees selected — search above to add
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-3 text-sm text-slate-300">
            <div className="flex items-start gap-3">
              {serverReachable === false ? (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              ) : (
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
              )}
              <div>{statusMessage}</div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {reportPayload || pdfResult ? (
                <Badge className="border-emerald-500/30 bg-emerald-950/30 text-emerald-300">Report ready in browser</Badge>
              ) : null}
              {queueSummary ? (
                <Badge className="border-white/10 bg-slate-950/30 text-slate-200 sm:hidden">Queue: {queueSummary}</Badge>
              ) : null}
            </div>
            <div className="mt-3 hidden space-y-1 text-xs text-slate-400 sm:block">
              {queueSummary ? <div>Queue: {queueSummary}</div> : null}
              {serverStatus?.lastSeenAt ? (
                <div>Server last seen: {new Date(serverStatus.lastSeenAt).toLocaleString("en-ZA")}</div>
              ) : null}
              {serverStatus?.lastCompletedAt ? <div>Last completed job: {new Date(serverStatus.lastCompletedAt).toLocaleString("en-ZA")}</div> : null}
              {serverStatus?.lastError ? <div className="text-red-300">Last server error: {serverStatus.lastError}</div> : null}
            </div>
          </div>

          <div className="grid gap-3 sm:flex sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
            <Button type="button" variant="outline" className="hidden sm:inline-flex sm:w-auto" onClick={() => void checkDesktopServer()}>
              <Server className="mr-2 h-4 w-4" />
              Refresh server host
            </Button>
            {selectionMode === "store" ? (
              <Button type="button" variant="outline" className="hidden sm:inline-flex sm:w-auto" onClick={() => void handleGenerate("all")} disabled={isGenerating}>
                {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                Queue Full Company Report
              </Button>
            ) : null}
            <Button type="button" className="w-full sm:w-auto" onClick={() => void handleGenerate("selected")} disabled={isGenerating || !hasSelectedScope}>
              {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Queue Selected Report
            </Button>
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => void handleExportGeneratedPdf()} disabled={(!reportPayload && !pdfResult) || isExporting}>
              {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Export PDF
            </Button>
          </div>
        </CardContent>
      </Card>
      {reportPayload || pdfResult ? (
        <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-200 pb-4">
            <CardTitle className="text-lg font-semibold text-slate-900">Report Ready</CardTitle>
            <CardDescription className="text-slate-500">
              The desktop server host finished this request. Export the PDF from this browser session when you are ready.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 p-4 sm:grid-cols-3 sm:p-6">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Request Type</div>
              <div className="mt-2 text-base font-semibold text-slate-900">
                {templateKey === "awol_report" ? "AWOL Report" : "Attendance Report"}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Queue Status</div>
              <div className="mt-2 text-base font-semibold text-slate-900">
                {queueSummary || "Completed"}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Output</div>
              <div className="mt-2 text-base font-semibold text-slate-900">
                {reportPayload ? "Browser-formatted PDF" : "Returned server PDF"}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
