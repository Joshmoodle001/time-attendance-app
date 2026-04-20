import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, FileSpreadsheet, RefreshCw, Upload, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { initializeShiftDatabase, getShiftRosters } from "@/services/shifts";
import {
  getLeaveApplications,
  getLeaveUploads,
  importLeaveApplications,
  initializeLeaveDatabase,
  parseLeaveWorkbook,
  deleteLeaveUpload,
  deleteLeaveApplication,
  deleteLeaveByDateRange,
  type LeaveApplication,
  type LeaveImportProgress,
  type LeaveUploadBatch,
} from "@/services/leave";
import type { Employee } from "@/services/database";

type LeaveHubProps = {
  employees: Employee[];
};

type UploadProgressState = LeaveImportProgress & {
  currentFile: number;
  totalFiles: number;
  fileName: string;
  status: "active" | "complete" | "error";
};

function formatDateLabel(value: string) {
  if (!value) return "-";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-ZA", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function formatTimestamp(value: string) {
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

export default function LeaveHub({ employees }: LeaveHubProps) {
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const [uploads, setUploads] = useState<LeaveUploadBatch[]>([]);
  const [applications, setApplications] = useState<LeaveApplication[]>([]);
  const [selectedUploadId, setSelectedUploadId] = useState("");
  const [applicationSearch, setApplicationSearch] = useState("");
  const [applicationStatusFilter, setApplicationStatusFilter] = useState("all");
  const [statusMessage, setStatusMessage] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<UploadProgressState | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteStartDate, setDeleteStartDate] = useState("");
  const [deleteEndDate, setDeleteEndDate] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const loadLeaveData = async () => {
    try {
      const [loadedUploads, loadedApplications] = await Promise.all([getLeaveUploads(), getLeaveApplications()]);
      setUploads(loadedUploads);
      setApplications(loadedApplications);
      setSelectedUploadId(loadedUploads[0]?.id || "");
    } catch (error) {
      console.error("Failed to load leave data:", error);
      setStatusMessage("Failed to load leave data. Please try refreshing.");
    }
  };

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        setIsLoading(true);
        await Promise.all([initializeLeaveDatabase(), initializeShiftDatabase()]);
        if (!alive) return;
        await loadLeaveData();
      } catch (error) {
        console.error("Failed to initialize leave database:", error);
        if (alive) {
          setStatusMessage("Failed to initialize. Please try refreshing the page.");
        }
      } finally {
        if (alive) {
          setIsLoading(false);
        }
      }
    };

    void load();
    return () => {
      alive = false;
    };
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await loadLeaveData();
      setStatusMessage("Leave uploads refreshed.");
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const updateImportProgress = (
      fileIndex: number,
      fileName: string,
      progress: LeaveImportProgress,
      status: UploadProgressState["status"] = "active"
    ) => {
      const overallPercent = Math.min(100, ((fileIndex - 1) / files.length) * 100 + progress.percent / files.length);

      setImportProgress({
        ...progress,
        percent: overallPercent,
        currentFile: fileIndex,
        totalFiles: files.length,
        fileName,
        status,
      });
    };

    setIsImporting(true);
    setStatusMessage("");
    setImportProgress({
      phase: "reading",
      percent: 0,
      message: `Preparing ${files.length} leave file${files.length === 1 ? "" : "s"}...`,
      currentFile: 0,
      totalFiles: files.length,
      fileName: "",
      status: "active",
    });

    try {
      const rosters = await getShiftRosters();
      let importedRows = 0;
      let appliedRows = 0;
      let unmatchedRows = 0;
      const notices: string[] = [];

      for (const [index, file] of files.entries()) {
        const fileNumber = index + 1;
        updateImportProgress(fileNumber, file.name, {
          phase: "reading",
          percent: 2,
          message: `Reading ${file.name}...`,
        });

        const buffer = await file.arrayBuffer();
        const parsedRows = await parseLeaveWorkbook(buffer, file.name, {
          onProgress: (progress) => updateImportProgress(fileNumber, file.name, progress),
        });

        if (parsedRows.length === 0) {
          notices.push(`${file.name}: no leave rows found.`);
          updateImportProgress(
            fileNumber,
            file.name,
            {
              phase: "complete",
              percent: 100,
              message: `${file.name} finished with no leave rows found.`,
            },
            "active"
          );
          continue;
        }

        const result = await importLeaveApplications(parsedRows, file.name, employees, rosters, {
          onProgress: (progress) => updateImportProgress(fileNumber, file.name, progress),
        });
        importedRows += result.batch.total_rows;
        appliedRows += result.batch.applied_rows;
        unmatchedRows += result.batch.unmatched_rows;
        if (result.error) notices.push(`${file.name}: ${result.error}`);
      }

      setImportProgress({
        phase: "complete",
        percent: 98,
        message: "Refreshing leave logs...",
        currentFile: files.length,
        totalFiles: files.length,
        fileName: files[files.length - 1]?.name || "",
        status: "active",
      });
      await loadLeaveData();
      setImportProgress({
        phase: "complete",
        percent: 100,
        message: `Leave import complete. ${importedRows} row${importedRows === 1 ? "" : "s"} processed.`,
        currentFile: files.length,
        totalFiles: files.length,
        fileName: files[files.length - 1]?.name || "",
        status: "complete",
      });
      setStatusMessage(
        [
          `Imported ${importedRows} leave row${importedRows === 1 ? "" : "s"} from ${files.length} file${files.length === 1 ? "" : "s"}.`,
          `${appliedRows} applied to roster output.`,
          `${unmatchedRows} still need attention.`,
          notices.join(" "),
        ]
          .filter(Boolean)
          .join(" ")
      );
    } catch (error) {
      setImportProgress((current) =>
        current
          ? {
              ...current,
              status: "error",
              message: `Import failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            }
          : {
              phase: "complete",
              percent: 100,
              message: `Import failed: ${error instanceof Error ? error.message : "Unknown error"}`,
              currentFile: files.length,
              totalFiles: files.length,
              fileName: files[files.length - 1]?.name || "",
              status: "error",
            }
      );
      setStatusMessage(`Leave import failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsImporting(false);
      event.target.value = "";
    }
  };

  const selectedUpload = useMemo(
    () => uploads.find((upload) => upload.id === selectedUploadId) || uploads[0] || null,
    [selectedUploadId, uploads]
  );

  const selectedApplications = useMemo(
    () => applications.filter((application) => application.upload_batch_id === selectedUpload?.id),
    [applications, selectedUpload]
  );

  const filteredApplications = useMemo(() => {
    const query = applicationSearch.trim().toLowerCase();

    return selectedApplications.filter((application) => {
      const matchesStatus =
        applicationStatusFilter === "all" ||
        (applicationStatusFilter === "applied" && application.apply_status === "applied") ||
        (applicationStatusFilter === "review" && application.apply_status !== "applied");

      const storeLabel = application.matched_roster_store_name || application.place || "";
      const haystack = [
        application.merchandiser_name,
        application.merchandiser_surname,
        application.raw_employee_code,
        application.raw_id_number,
        application.matched_employee_code,
        application.leave_type,
        application.status_reason,
        storeLabel,
      ]
        .join(" ")
        .toLowerCase();

      const matchesSearch = !query || haystack.includes(query);
      return matchesStatus && matchesSearch;
    });
  }, [applicationSearch, applicationStatusFilter, selectedApplications]);

  const totals = useMemo(
    () => ({
      uploads: uploads.length,
      rows: applications.length,
      applied: applications.filter((application) => application.apply_status === "applied").length,
      unmatched: applications.filter((application) => application.apply_status !== "applied").length,
    }),
    [applications, uploads]
  );

  return (
    <div className="section-tech-stack">
      {isLoading && (
        <Card className="rounded-2xl border-cyan-500/30 bg-cyan-500/10">
          <CardContent className="flex items-center gap-3 p-4">
            <RefreshCw className="h-5 w-5 animate-spin text-cyan-400" />
            <span className="text-sm text-cyan-400">Loading leave data...</span>
          </CardContent>
        </Card>
      )}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <Card className="section-tech-stat rounded-2xl text-center">
          <CardContent className="p-4 text-center">
            <div className="section-tech-kicker text-cyan-400">Upload Batches</div>
            <div className="mt-2 text-3xl font-bold text-white">{totals.uploads}</div>
            <div className="text-sm text-slate-400">Leave Uploads</div>
          </CardContent>
        </Card>
        <Card className="section-tech-stat rounded-2xl text-center">
          <CardContent className="p-4 text-center">
            <div className="section-tech-kicker text-slate-400">Logged Rows</div>
            <div className="mt-2 text-3xl font-bold text-white">{totals.rows}</div>
            <div className="text-sm text-slate-400">Logged Leave Rows</div>
          </CardContent>
        </Card>
        <Card className="section-tech-stat rounded-2xl text-center">
          <CardContent className="p-4 text-center">
            <div className="section-tech-kicker text-emerald-400">Applied</div>
            <div className="mt-2 text-3xl font-bold text-emerald-400">{totals.applied}</div>
            <div className="text-sm text-slate-400">Applied To Rosters</div>
          </CardContent>
        </Card>
        <Card className="section-tech-stat rounded-2xl text-center">
          <CardContent className="p-4 text-center">
            <div className="section-tech-kicker text-amber-400">Needs Review</div>
            <div className="mt-2 text-3xl font-bold text-amber-400">{totals.unmatched}</div>
            <div className="text-sm text-slate-400">Needs Matching</div>
          </CardContent>
        </Card>
      </div>

      <Card className="section-tech-panel rounded-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <FileSpreadsheet className="section-tech-header-icon" />
            Leave Apply
          </CardTitle>
          <CardDescription className="section-tech-helper text-slate-400">
            Upload merchandiser leave forms, match them to employee profiles by employee code first and then ID number, and apply the leave range to roster output and reports.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="section-tech-subpanel px-5 py-4 text-sm text-slate-400">
            <div className="font-medium text-white">How this works</div>
            <div className="mt-2 leading-6 text-slate-400">
              Every uploaded workbook is logged. Applied rows show green once they match an employee profile and a roster sheet. Rows that do not apply stay yellow so you can review them.
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button onClick={() => uploadRef.current?.click()} disabled={isImporting}>
              <Upload className="mr-2 h-4 w-4" />
              {isImporting ? "Importing leave..." : "Upload Leave Excel"}
            </Button>
            <Button variant="outline" onClick={() => void handleRefresh()} disabled={isRefreshing}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="destructive" onClick={() => setShowDeleteModal(true)}>
              Clear Leave Logs
            </Button>
            <input ref={uploadRef} type="file" accept=".xlsx,.xls,.csv" multiple className="hidden" onChange={handleImport} />
          </div>

          {importProgress ? (
            <div className="section-tech-subpanel px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-[240px] flex-1">
                  <div className="text-sm font-semibold text-white">
                    {importProgress.status === "error"
                      ? "Leave import failed"
                      : importProgress.status === "complete"
                        ? "Leave import complete"
                        : "Uploading leave workbook"}
                  </div>
                  <div className="mt-1 text-sm text-slate-400">{importProgress.message}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {importProgress.totalFiles > 1
                      ? `File ${Math.max(importProgress.currentFile, 1)} of ${importProgress.totalFiles}${importProgress.fileName ? ` - ${importProgress.fileName}` : ""}`
                      : importProgress.fileName || "Waiting for file details..."}
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className={`text-lg font-semibold ${
                      importProgress.status === "error"
                        ? "text-red-400"
                        : importProgress.status === "complete"
                          ? "text-emerald-400"
                          : "text-cyan-400"
                    }`}
                  >
                    {Math.round(importProgress.percent)}%
                  </div>
                  {typeof importProgress.totalRows === "number" && importProgress.totalRows > 0 ? (
                    <div className="text-xs text-slate-400">
                      {Math.min(importProgress.currentRow || importProgress.totalRows, importProgress.totalRows)} / {importProgress.totalRows} rows
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    importProgress.status === "error"
                      ? "bg-gradient-to-r from-red-500 to-rose-400"
                      : importProgress.status === "complete"
                        ? "bg-gradient-to-r from-emerald-500 to-green-400"
                        : "bg-gradient-to-r from-cyan-500 to-sky-400"
                  }`}
                  style={{ width: `${importProgress.percent}%` }}
                />
              </div>
            </div>
          ) : null}

          {statusMessage ? <div className="section-tech-subpanel px-4 py-3 text-sm text-slate-400">{statusMessage}</div> : null}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="section-tech-panel rounded-2xl">
          <CardHeader>
            <CardTitle className="text-white">Upload Log</CardTitle>
            <CardDescription className="section-tech-helper text-slate-400">Every leave workbook stays logged here so you can open it again later.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {uploads.length === 0 ? (
              <div className="section-tech-empty">
                No leave uploads yet.
              </div>
            ) : (
              uploads.map((upload) => {
                const isActive = upload.id === selectedUpload?.id;
                return (
                  <div key={upload.id} className="flex items-center justify-between rounded-2xl border border-slate-700 bg-slate-800/50 p-4 hover:bg-slate-700/50">
                    <button
                      type="button"
                      onClick={() => setSelectedUploadId(upload.id)}
                      className={`flex-1 text-left ${isActive ? "" : ""}`}
                    >
                      <div className="truncate text-sm font-semibold text-white">{upload.file_name}</div>
                      <div className="mt-1 text-xs text-slate-400">{formatTimestamp(upload.created_at)}</div>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">{upload.total_rows} rows</span>
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">{upload.applied_rows} applied</span>
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">{upload.unmatched_rows} unmatched</span>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (confirm(`Delete "${upload.file_name}" and all its ${upload.total_rows} leave rows?`)) {
                          const result = await deleteLeaveUpload(upload.id);
                          if (result.success) {
                            setStatusMessage(`Deleted "${upload.file_name}" and all applied leave`);
                            await loadLeaveData();
                          } else {
                            setStatusMessage(`Failed to delete: ${result.error}`);
                          }
                        }
                      }}
                      className="ml-3 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600"
                      title="Delete this upload"
                    >
                      ✕
                    </button>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="section-tech-panel rounded-[30px]">
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-4">
              <span>{selectedUpload ? selectedUpload.file_name : "Leave rows"}</span>
              {selectedUpload ? (
                <Badge className="bg-slate-100 text-slate-700">{filteredApplications.length} row{filteredApplications.length === 1 ? "" : "s"}</Badge>
              ) : null}
            </CardTitle>
            <CardDescription className="section-tech-helper">
              View each leave row, how it matched, and whether it was applied to a roster sheet.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedUpload ? (
              <div className="flex flex-wrap gap-3">
                <Input
                  value={applicationSearch}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => setApplicationSearch(event.target.value)}
                  placeholder="Filter by merchandiser, code, ID, leave type, or store..."
                  className="min-w-[280px] flex-1"
                />
                <select
                  value={applicationStatusFilter}
                  onChange={(event) => setApplicationStatusFilter(event.target.value)}
                  className="flex h-11 min-w-[180px] rounded-xl border border-input bg-background px-3.5 py-2.5 text-[15px] leading-6"
                >
                  <option value="all">All statuses</option>
                  <option value="applied">Applied only</option>
                  <option value="review">Needs review</option>
                </select>
              </div>
            ) : null}

            {!selectedUpload ? (
              <div className="section-tech-empty">
                Upload a leave workbook to start logging and applying leave.
              </div>
            ) : filteredApplications.length === 0 ? (
              <div className="section-tech-empty">
                No leave rows match the current filters.
              </div>
            ) : (
              <div className="section-tech-table">
                <table className="min-w-[1100px] w-full border-collapse">
                  <thead className="bg-slate-800/80">
                    <tr className="border-b border-slate-700 text-left text-xs uppercase tracking-wide text-cyan-400">
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold">Merchandiser</th>
                      <th className="px-4 py-3 font-semibold">Leave</th>
                      <th className="px-4 py-3 font-semibold">Range</th>
                      <th className="px-4 py-3 font-semibold">Match</th>
                      <th className="px-4 py-3 font-semibold">Roster</th>
                      <th className="px-4 py-3 font-semibold">Reason</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredApplications.map((application) => (
                      <tr key={application.id} className="border-b border-slate-700 align-top">
                        <td>
                          {application.apply_status === "applied" ? (
                            <Badge className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                              <CheckCircle2 className="mr-1 h-3 w-3" />
                              Applied
                            </Badge>
                          ) : (
                            <Badge className="bg-amber-500/20 text-amber-400 border border-amber-500/30">Needs Review</Badge>
                          )}
                        </td>
                        <td className="text-sm text-slate-300">
                          <div className="font-medium text-white">
                            {[application.merchandiser_name, application.merchandiser_surname].filter(Boolean).join(" ") || "Unnamed"}
                          </div>
                          <div className="mt-1 text-xs text-slate-400">
                            Store: {application.matched_roster_store_name || application.place || "Unassigned store"}
                          </div>
                          <div className="mt-1 text-xs text-slate-400">
                            Code: {application.raw_employee_code || "-"} | ID: {application.raw_id_number || "-"}
                          </div>
                        </td>
                        <td className="text-sm text-slate-300">
                          <div className="font-medium text-white">{application.leave_type}</div>
                          <div className="mt-1 text-xs text-slate-400">{application.leave_days || 0} day{application.leave_days === 1 ? "" : "s"}</div>
                        </td>
                        <td className="text-sm text-slate-300">
                          {formatDateLabel(application.leave_start_date)} to {formatDateLabel(application.leave_end_date)}
                        </td>
                        <td className="text-sm text-slate-300">
                          <div className="text-white">{application.matched_employee_code || "-"}</div>
                          <div className="mt-1 text-xs text-slate-400">
                            {application.matched_by === "employee_code"
                              ? "Matched by employee code"
                              : application.matched_by === "id_number"
                                ? "Matched by ID number"
                                : "No employee match"}
                          </div>
                        </td>
                        <td className="text-sm text-slate-300">
                          <div className="text-white">{application.matched_roster_store_name || "-"}</div>
                          <div className="mt-1 text-xs text-slate-400">{application.matched_roster_sheet_name || "No roster sheet"}</div>
                        </td>
                        <td className="text-sm text-slate-400">{application.status_reason}</td>
                        <td>
                          <button
                            type="button"
                            onClick={async () => {
                              if (confirm("Delete this leave row?")) {
                                const result = await deleteLeaveApplication(application.id);
                                if (result.success) {
                                  await loadLeaveData();
                                  setStatusMessage("Leave row deleted");
                                } else {
                                  setStatusMessage(`Failed to delete: ${result.error}`);
                                }
                              }
                            }}
                            className="rounded-lg p-1.5 text-red-500 hover:bg-red-50"
                            title="Delete this row"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-6 shadow-2xl">
            <h3 className="mb-4 text-xl font-bold text-red-600">Clear Leave Logs</h3>
            <p className="mb-4 text-sm text-slate-600">
              Select the date range for leave you want to delete. All leave applications within this range will be permanently removed.
            </p>
            <div className="mb-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700">Start Date</label>
                <input
                  type="date"
                  value={deleteStartDate}
                  onChange={(e) => setDeleteStartDate(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">End Date</label>
                <input
                  type="date"
                  value={deleteEndDate}
                  onChange={(e) => setDeleteEndDate(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeleteStartDate("");
                  setDeleteEndDate("");
                }}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={async () => {
                  if (!deleteStartDate || !deleteEndDate) {
                    setStatusMessage("Please select both start and end dates");
                    return;
                  }
                  if (deleteStartDate > deleteEndDate) {
                    setStatusMessage("Start date must be before end date");
                    return;
                  }
                  if (!confirm(`Delete all leave from ${deleteStartDate} to ${deleteEndDate}?`)) return;
                  
                  setIsDeleting(true);
                  const result = await deleteLeaveByDateRange(deleteStartDate, deleteEndDate);
                  setIsDeleting(false);
                  
                  if (result.success) {
                    setStatusMessage(`Deleted ${result.deletedCount || 0} leave records`);
                    await loadLeaveData();
                    setShowDeleteModal(false);
                    setDeleteStartDate("");
                    setDeleteEndDate("");
                  } else {
                    setStatusMessage(`Failed to delete: ${result.error}`);
                  }
                }}
                disabled={isDeleting}
                className="flex-1"
              >
                {isDeleting ? "Deleting..." : "Delete Leave"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
