import { useEffect, useState } from "react";
import ReportsBuilder from "@/components/ReportsBuilder";
import type { DesktopReportJob, DesktopReportJobResult } from "@/types/desktopReportBridge";

export default function DesktopReportWorker() {
  const [job, setJob] = useState<DesktopReportJob | null>(null);
  const [remoteJobId, setRemoteJobId] = useState("");

  useEffect(() => {
    void window.electronDesktop?.notifyReportWorkerReady?.();
    const cleanup = window.electronDesktop?.onReportJob?.((payload) => {
      setJob(payload);
    });
    return () => {
      if (typeof cleanup === "function") {
        cleanup();
      }
    };
  }, []);

  useEffect(() => {
    const remoteBridge = window.electronDesktop?.remoteBridge;
    if (!remoteBridge || remoteBridge.pollingMode === "main") return;

    let alive = true;
    let polling = false;

    const poll = async () => {
      if (!alive || polling) return;
      polling = true;
      try {
        const activeJobId = remoteJobId || job?.jobId || "";
        const response = await fetch(`${remoteBridge.baseUrl}/api/report-jobs-poll`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Report-Server-Token": remoteBridge.token,
          },
          body: JSON.stringify({
            serverId: remoteBridge.serverId,
            workerReady: true,
            activeJobId,
            platform: window.electronDesktop?.platform || "desktop",
          }),
        });
        if (!response.ok) {
          throw new Error(`Remote poll returned ${response.status}`);
        }
        const payload = await response.json();
        if (!activeJobId && payload?.job && alive) {
          setRemoteJobId(String(payload.job.jobId || ""));
          setJob(payload.job);
        }
      } catch (error) {
        console.error("Remote report worker poll failed:", error);
      } finally {
        polling = false;
      }
    };

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, 5000);

    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, [job, remoteJobId]);

  const handleWorkerResult = async (result: DesktopReportJobResult) => {
    if (remoteJobId && window.electronDesktop?.remoteBridge) {
      const remoteBridge = window.electronDesktop.remoteBridge;
      try {
        await fetch(`${remoteBridge.baseUrl}/api/report-jobs-complete`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Report-Server-Token": remoteBridge.token,
          },
          body: JSON.stringify({
            serverId: remoteBridge.serverId,
            jobId: result.jobId,
            sessionId: result.sessionId,
            success: result.success,
            reportPayload: result.reportPayload || null,
            pdfBase64: result.pdfBase64 || null,
            fileName: result.fileName || "",
            mimeType: result.mimeType || "",
            error: result.error || "",
          }),
        });
      } catch (error) {
        console.error("Remote report completion failed:", error);
      }
    } else {
      await window.electronDesktop?.completeReportJob?.(result);
    }
    setRemoteJobId("");
    setJob(null);
  };

  return (
    <ReportsBuilder
      workerMode
      workerRequest={job}
      onWorkerResult={handleWorkerResult}
      records={[]}
      employees={[]}
      employeesReady
      reportDateRangeLabel=""
    />
  );
}
