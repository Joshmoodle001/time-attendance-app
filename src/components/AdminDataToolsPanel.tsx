import { type ChangeEvent, useMemo, useState } from "react";
import { AlertTriangle, Download, RefreshCw, RotateCcw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  APP_RESTORE_BUNDLE_VERSION,
  createAppRestoreBundle,
  resetApplicationData,
  restoreApplicationData,
  type AppRestoreBundle,
} from "@/services/adminDataTools";

type AdminDataToolsPanelProps = {
  onStatusMessage?: (message: string) => void;
};

function formatCount(value: number) {
  return new Intl.NumberFormat("en-ZA").format(value || 0);
}

function formatBackupTime(value: string) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" });
}

export default function AdminDataToolsPanel({ onStatusMessage }: AdminDataToolsPanelProps) {
  const [isDownloadingBackup, setIsDownloadingBackup] = useState(false);
  const [isResettingData, setIsResettingData] = useState(false);
  const [isRestoringData, setIsRestoringData] = useState(false);
  const [selectedRestoreFile, setSelectedRestoreFile] = useState<File | null>(null);
  const [restoreFileSummary, setRestoreFileSummary] = useState<AppRestoreBundle | null>(null);
  const [dataToolsMessage, setDataToolsMessage] = useState("");
  const [resetProgress, setResetProgress] = useState({ step: "", percent: 0 });

  const summaryHighlights = useMemo(() => {
    if (!restoreFileSummary) return [];

    const summary = restoreFileSummary.summary || {};
    return [
      { label: "Employees", value: Number(summary.employees || 0) },
      { label: "Shifts", value: Number(summary.shift_rosters || 0) },
      { label: "Attendance", value: Number(summary.attendance_records || 0) },
      { label: "Clocks", value: Number(summary.biometric_clock_events || 0) },
      { label: "Calendar", value: Number(summary.calendarEvents || 0) },
    ];
  }, [restoreFileSummary]);

  const setStatus = (message: string) => {
    setDataToolsMessage(message);
    onStatusMessage?.(message);
  };

  const downloadBundle = async () => {
    setIsDownloadingBackup(true);
    setStatus("Building restore file from the current application data...");

    try {
      const bundle = await createAppRestoreBundle();
      const timestamp = new Date(bundle.createdAt)
        .toISOString()
        .replace(/[:]/g, "-")
        .replace(/\.\d+Z$/, "Z");
      const fileName = `time-attendance-app-restore-${timestamp}.json`;
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = window.URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      window.URL.revokeObjectURL(url);
      setStatus(`Restore file created and downloaded: ${fileName}`);
    } catch (error) {
      setStatus(`Could not create the restore file: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsDownloadingBackup(false);
    }
  };

  const handleResetData = async () => {
    const confirmed = window.confirm(
      "This will clear operational data from the app and Supabase, including employees, attendance, shifts, leave, coversheets, assignments, clocks, and logs. Calendar, devices, and users will be kept. Do you want to continue?"
    );
    if (!confirmed) return;

    setIsResettingData(true);
    setResetProgress({ step: "Starting reset...", percent: 0 });
    setStatus("Resetting all application data...");

    try {
      const result = await resetApplicationData((step, percent) => {
        setResetProgress({ step, percent });
      });
      if (result.errors && result.errors.length > 0) {
        setStatus(`Data reset did not fully complete. ${result.errors.join(" | ")}`);
        setIsResettingData(false);
        return;
      } else {
        setStatus("Operational data was cleared from the app and Supabase. Calendar, devices, and users were kept. Reloading the app now...");
      }
      window.setTimeout(() => window.location.reload(), 1500);
    } catch (error) {
      console.error("Reset error:", error);
      setStatus(`Could not reset the application data: ${error instanceof Error ? error.message : "Unknown error"}`);
      setIsResettingData(false);
    }
  };

  const handleRestoreFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    setSelectedRestoreFile(file);
    setRestoreFileSummary(null);

    if (!file) return;

    try {
      const text = await file.text();
      const bundle = JSON.parse(text) as AppRestoreBundle;
      if (!bundle || bundle.version !== APP_RESTORE_BUNDLE_VERSION) {
        throw new Error("This file is not a valid restore file for this application.");
      }
      setRestoreFileSummary(bundle);
      setStatus(`Restore file loaded: ${file.name}`);
    } catch (error) {
      setSelectedRestoreFile(null);
      setRestoreFileSummary(null);
      event.target.value = "";
      setStatus(`Could not read that restore file: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const handleRestoreData = async () => {
    if (!selectedRestoreFile || !restoreFileSummary) {
      setStatus("Choose a valid restore file first.");
      return;
    }

    const confirmed = window.confirm(
      "This will replace the current application data with the contents of the restore file. Do you want to continue?"
    );
    if (!confirmed) return;

    setIsRestoringData(true);
    setStatus(`Restoring application data from ${selectedRestoreFile.name}...`);

    try {
      await restoreApplicationData(restoreFileSummary);
      setStatus("Restore completed. Reloading the app now...");
      window.setTimeout(() => window.location.reload(), 900);
    } catch (error) {
      setStatus(`Could not restore the application data: ${error instanceof Error ? error.message : "Unknown error"}`);
      setIsRestoringData(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl border-amber-200 bg-amber-50/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-amber-900">
            <AlertTriangle className="h-5 w-5" />
            Data Reset
          </CardTitle>
          <CardDescription className="text-amber-800">
            This clears operational app data and the matching Supabase tables. Employees, attendance, shifts,
            leave, coversheets, assignments, clocks, and logs are removed. Calendar, devices, and users are kept.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border border-amber-200 bg-white p-4 text-sm text-slate-700">
            <div className="font-medium text-slate-900">Recommended process</div>
            <div className="mt-2">
              Run the reset, then upload the fresh payroll workbook and the other fresh operational files.
              This reset is designed for a clean re-import cycle, not for backup and restore.
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button onClick={downloadBundle} disabled={isDownloadingBackup || isResettingData || isRestoringData}>
              {isDownloadingBackup ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Building Restore File...
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Download Restore File
                </>
              )}
            </Button>
            <Button
              variant="destructive"
              onClick={handleResetData}
              disabled={isDownloadingBackup || isResettingData || isRestoringData}
            >
              {isResettingData ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Resetting Data...
                </>
              ) : (
                <>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Data Reset
                </>
              )}
            </Button>
          </div>

          {isResettingData && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-slate-700">{resetProgress.step}</span>
                <span className="text-sm font-bold bg-gradient-to-r from-cyan-600 to-purple-600 bg-clip-text text-transparent">{resetProgress.percent}%</span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100">
                <div 
                  className="h-full rounded-full transition-all duration-300 ease-out"
                  style={{ 
                    width: `${resetProgress.percent}%`,
                    background: 'linear-gradient(90deg, #00d4ff, #7c3aed)'
                  }}
                />
              </div>
            </div>
          )}

          {dataToolsMessage && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
              {dataToolsMessage}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Restore
          </CardTitle>
          <CardDescription>
            Upload a restore file that was downloaded from this application, then restore the full saved state.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Restore File</label>
            <Input
              type="file"
              accept=".json,application/json"
              onChange={handleRestoreFileSelected}
              disabled={isRestoringData || isResettingData}
            />
          </div>

          {restoreFileSummary && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                <span className="font-medium text-slate-900">{selectedRestoreFile?.name}</span>
                <span>Created {formatBackupTime(restoreFileSummary.createdAt)}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {summaryHighlights.map((item) => (
                  <span
                    key={item.label}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700"
                  >
                    {item.label}: {formatCount(item.value)}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <Button
              onClick={handleRestoreData}
              disabled={!restoreFileSummary || isRestoringData || isResettingData || isDownloadingBackup}
            >
              {isRestoringData ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Restoring...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Restore Backup
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
