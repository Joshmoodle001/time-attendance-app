import { useEffect, useRef, useState } from "react";
import { Clock3, RefreshCw, Search, Upload, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { normalizeEmployeeCode, type Employee } from "@/services/database";
import {
    initializeClockDatabase,
    getClockEvents,
    parseClockWorkbook,
    upsertClockEvents,
    type BiometricClockEvent,
    type ClockImportAllocationRow,
    type ClockWorkbookImportReport,
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
    hour12: false,
  });
}

// Cache for unallocated clocks
const unallocatedCache = {
  data: null as ClockImportAllocationRow[] | null,
  lastLoaded: 0,
};

export default function ClockDataHub({ employees, onEmployeesRefresh }: ClockDataHubProps) {
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const [unallocatedClocks, setUnallocatedClocks] = useState<ClockImportAllocationRow[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importStage, setImportStage] = useState("");
  const [importPercent, setImportPercent] = useState(0);
  const [importReport, setImportReport] = useState<ClockWorkbookImportReport | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [stats, setStats] = useState({ total: 0, unallocated: 0, allocated: 0 });

  // Load unallocated clocks on mount (fast - just filters existing data)
  useEffect(() => {
    if (unallocatedCache.data && Date.now() - unallocatedCache.lastLoaded < 30000) {
      setUnallocatedClocks(unallocatedCache.data);
      return;
    }
    void loadUnallocatedClocks();
  }, []);

  const loadUnallocatedClocks = async () => {
    setIsLoading(true);
    setStatusMessage("Loading clock data...");
    
    try {
      await initializeClockDatabase();
      const events = await getClockEvents({});
      
      // Build unallocated rows from events that don't match employees
      const unallocated: ClockImportAllocationRow[] = [];
      let allocatedCount = 0;
      
      events.forEach((event, index) => {
        const hasEmployeeCode = normalizeEmployeeCode(event.employee_code);
        const hasLinkedEmployee = hasEmployeeCode && employees.some(
          emp => normalizeEmployeeCode(emp.employee_code) === hasEmployeeCode
        );
        
        if (hasLinkedEmployee) {
          allocatedCount++;
        } else {
          unallocated.push({
            row_number: index + 1,
            source_file_name: (event as any).source_file_name || "",
            employee_code: event.employee_code || "",
            id_number: event.id_number || "",
            employee_name: [event.first_name, event.last_name].filter(Boolean).join(" ") || "Unknown",
            clocked_at: event.clock_time || "",
            clock_date: event.clock_date,
            clock_time: event.clock_time || "",
            device_name: event.device_name || "",
            method: event.method || "",
            direction: event.direction || "",
            matched_by: "" as const,
            employee_profile_status: "",
            status: "unallocated" as const,
            reason: "No matching employee profile",
          });
        }
      });
      
      setStats({
        total: events.length,
        unallocated: unallocated.length,
        allocated: allocatedCount,
      });
      
      // Remove duplicates by employee_code + date
      const seen = new Set<string>();
      const uniqueUnallocated = unallocated.filter(row => {
        const key = `${row.employee_code}-${row.clock_date}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      
      setUnallocatedClocks(uniqueUnallocated);
      unallocatedCache.data = uniqueUnallocated;
      unallocatedCache.lastLoaded = Date.now();
      
      setStatusMessage(`Found ${uniqueUnallocated.length} unallocated clock records`);
    } catch (error) {
      console.error("Error loading clocks:", error);
      setStatusMessage("Error loading clock data");
    } finally {
      setIsLoading(false);
    }
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    setIsImporting(true);
    setImportReport(null);
    setImportPercent(5);
    setImportStage(`Preparing ${files.length} file${files.length === 1 ? "" : "s"}...`);

    try {
      const parsedFiles: BiometricClockEvent[] = [];
      let totalRows = 0;
      let allocatedCount = 0;
      let unallocatedCount = 0;
      const allAllocatedRows: ClockImportAllocationRow[] = [];
      const allUnallocatedRows: ClockImportAllocationRow[] = [];

      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        setImportPercent(10 + Math.round((index / files.length) * 40));
        setImportStage(`Reading ${file.name}...`);
        
        const buffer = await file.arrayBuffer();
        setImportStage(`Parsing ${file.name}...`);
        
        const parsed = parseClockWorkbook(buffer, file.name, employees);
        parsedFiles.push(...parsed.events);
        totalRows += parsed.report.totalRows;
        allocatedCount += parsed.report.allocatedCount;
        unallocatedCount += parsed.report.unallocatedCount;
        allAllocatedRows.push(...parsed.report.allocatedRows);
        allUnallocatedRows.push(...parsed.report.unallocatedRows);
      }

      const importReportData: ClockWorkbookImportReport = {
        totalRows,
        allocatedCount,
        unallocatedCount,
        allocatedRows: allAllocatedRows,
        unallocatedRows: allUnallocatedRows,
      };

      setImportReport(importReportData);
      setImportPercent(60);
      setImportStage("Saving clock events...");

      const progressCallback = (progress: { phase: string; completed: number; total: number; percent: number }) => {
        setImportPercent(60 + Math.round(progress.percent * 0.3));
      };
      
      const { count, error } = await upsertClockEvents(parsedFiles, progressCallback);

      setImportPercent(90);
      setImportStage("Refreshing view...");

      await loadUnallocatedClocks();

      setImportPercent(100);
      setImportStage("Import complete.");
      setStatusMessage(
        error
          ? `Imported ${count || parsedFiles.length} clock events. ${error}`
          : `Imported ${count || parsedFiles.length} clock events.`
      );
      
      // Refresh employees if needed
      if (onEmployeesRefresh) {
        void onEmployeesRefresh();
      }
    } catch (error) {
      console.error("Import error:", error);
      setImportStage("Import failed.");
      setStatusMessage(`Import error: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsImporting(false);
      setTimeout(() => {
        setImportPercent(0);
        setImportStage("");
      }, 3000);
    }
  };

  // Filter unallocated clocks by search
  const filteredClocks = unallocatedClocks.filter(clock => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      clock.employee_code?.toLowerCase().includes(search) ||
      clock.id_number?.toLowerCase().includes(search) ||
      clock.employee_name?.toLowerCase().includes(search) ||
      clock.clock_date?.toLowerCase().includes(search)
    );
  });

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-500/20">
                <Clock3 className="h-6 w-6 text-cyan-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">{stats.total}</div>
                <div className="text-sm text-slate-400">Total Clock Events</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/20">
                <Clock3 className="h-6 w-6 text-emerald-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-emerald-400">{stats.allocated}</div>
                <div className="text-sm text-slate-400">Allocated</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-rose-500/30">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-rose-500/20">
                <AlertTriangle className="h-6 w-6 text-rose-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-rose-400">{stats.unallocated}</div>
                <div className="text-sm text-slate-400">Unallocated</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Actions Bar */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search employee code, name, ID..."
            className="pl-9 bg-slate-800 border-slate-700 text-white"
          />
        </div>

        <input
          ref={uploadRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          multiple
          onChange={handleImport}
          className="hidden"
        />
        <Button
          variant="outline"
          onClick={() => uploadRef.current?.click()}
          disabled={isImporting}
        >
          <Upload className="mr-2 h-4 w-4" />
          {isImporting ? "Importing..." : "Import Clock Files"}
        </Button>

        <Button variant="outline" onClick={() => void loadUnallocatedClocks()} disabled={isLoading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Import Progress */}
      {isImporting && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="text-sm text-slate-300">{importStage || "Processing..."}</div>
            <div className="text-sm font-semibold text-cyan-400">{importPercent}%</div>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-700">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-purple-500 transition-all duration-300"
              style={{ width: `${importPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Status Message */}
      {statusMessage && !isImporting && (
        <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-300">
          {statusMessage}
        </div>
      )}

      {/* Import Report */}
      {importReport && !isImporting && (
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg text-white">Import Results</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="rounded-lg bg-emerald-500/10 p-3 text-center">
                <div className="text-2xl font-bold text-emerald-400">{importReport.allocatedCount}</div>
                <div className="text-sm text-slate-400">Allocated</div>
              </div>
              <div className="rounded-lg bg-rose-500/10 p-3 text-center">
                <div className="text-2xl font-bold text-rose-400">{importReport.unallocatedCount}</div>
                <div className="text-sm text-slate-400">Unallocated</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Unallocated Clocks Table */}
      <div className="rounded-xl border border-slate-700 bg-slate-800/50 overflow-hidden">
        <div className="border-b border-slate-700 px-4 py-3">
          <h3 className="font-semibold text-white flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-rose-400" />
            Unallocated Clock Records ({filteredClocks.length})
          </h3>
          <p className="text-sm text-slate-400 mt-1">
            These clock records could not be matched to any employee profile.
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-slate-400">
            <RefreshCw className="h-6 w-6 animate-spin mr-2" />
            Loading...
          </div>
        ) : filteredClocks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <Clock3 className="h-12 w-12 mb-3 opacity-50" />
            <div className="text-lg font-medium">No unallocated clocks</div>
            <div className="text-sm">All clock records have been matched to employees.</div>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full">
              <thead className="bg-slate-900/80 sticky top-0 text-left">
                <tr>
                  <th className="px-4 py-3 text-sm font-semibold text-cyan-400">Employee Code</th>
                  <th className="px-4 py-3 text-sm font-semibold text-cyan-400">Name</th>
                  <th className="px-4 py-3 text-sm font-semibold text-cyan-400">National ID</th>
                  <th className="px-4 py-3 text-sm font-semibold text-cyan-400">Date</th>
                  <th className="px-4 py-3 text-sm font-semibold text-cyan-400">Time</th>
                  <th className="px-4 py-3 text-sm font-semibold text-cyan-400">Device</th>
                  <th className="px-4 py-3 text-sm font-semibold text-cyan-400">Reason</th>
                </tr>
              </thead>
              <tbody>
                {filteredClocks.map((clock, index) => (
                  <tr
                    key={`${clock.employee_code}-${clock.clock_date}-${index}`}
                    className="border-t border-slate-700/50 hover:bg-slate-700/30"
                  >
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="border-rose-500/50 text-rose-300 bg-rose-500/10">
                        {clock.employee_code || "N/A"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-sm text-white">
                      {clock.employee_name}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-400">
                      {clock.id_number || "-"}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-300">
                      {clock.clock_date}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-300">
                      {clock.clock_time ? formatClockTimestamp(clock.clock_time) : "-"}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-400">
                      {clock.device_name || "-"}
                    </td>
                    <td className="px-4 py-3 text-sm text-rose-400">
                      {clock.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
