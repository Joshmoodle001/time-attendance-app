const { contextBridge, ipcRenderer } = require("electron");

const remoteBridgeBaseUrl = String(process.env.REPORT_BRIDGE_BASE_URL || "https://time-attendance-app-amber.vercel.app").replace(/\/+$/, "");
const remoteBridgeToken = String(process.env.REPORT_SERVER_TOKEN || "ember-report-server-2026").trim();
const remoteServerId = `${process.env.COMPUTERNAME || "desktop-server"}-${process.pid}`;

contextBridge.exposeInMainWorld("electronDesktop", {
  isDesktopApp: true,
  platform: process.platform,
  versions: {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node,
  },
  notifyReportWorkerReady: () => ipcRenderer.invoke("desktop:report-worker-ready"),
  completeReportJob: (payload) => ipcRenderer.invoke("desktop:report-job-result", payload),
  remoteBridge: {
    baseUrl: remoteBridgeBaseUrl,
    token: remoteBridgeToken,
    serverId: remoteServerId,
    pollingMode: "main",
  },
  onReportJob: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("desktop:report-job", listener);
    return () => {
      ipcRenderer.removeListener("desktop:report-job", listener);
    };
  },
  getWorkerConfig: () => ipcRenderer.invoke("desktop:get-worker-config"),
  setWorkerConfig: (config) => ipcRenderer.invoke("desktop:set-worker-config", config),
  vcellAssignRole: (role) => ipcRenderer.invoke("desktop:vcell-assign-role", { role }),
});
