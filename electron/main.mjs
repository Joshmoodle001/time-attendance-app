import { app, BrowserWindow, ipcMain } from "electron";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const preloadPath = path.join(__dirname, "preload.cjs");
const appUrl = pathToFileURL(path.join(distDir, "index.html")).toString();
const desktopServerHost = "127.0.0.1";
const desktopServerPort = 43125;
const reportRequestTimeoutMs = 120000;
const remoteBridgeBaseUrl = String(process.env.REPORT_BRIDGE_BASE_URL || "https://time-attendance-app-amber.vercel.app").replace(/\/+$/, "");
const remoteBridgeToken = String(process.env.REPORT_SERVER_TOKEN || "ember-report-server-2026").trim();
const remotePollIntervalMs = 5000;

const portableDataDir = path.join(rootDir, "portable-data");
const portableUserDataDir = path.join(portableDataDir, "user-data");
const portableSessionDataDir = path.join(portableDataDir, "session-data");
const bridgeLogPath = path.join(portableDataDir, "report-bridge.log");
const workerConfigPath = path.join(portableDataDir, "worker-config.json");
const machineConfigPath = path.join(portableDataDir, "machine.json");

const legacyUserDataDir = path.join(rootDir, ".electron-user-data");
const legacySessionDataDir = path.join(rootDir, ".electron-session-data");
const legacyBridgeLogPath = path.join(rootDir, "report-bridge.log");
const legacyWorkerConfigPath = path.join(legacyUserDataDir, "worker-config.json");

let mainWindow = null;
let workerWindow = null;
let setupWindow = null;
let workerReady = false;
let desktopServer = null;
let remotePollIntervalId = null;
let remotePollInFlight = false;
let activeRemoteJobId = "";
let remoteWorkerId = "";

const pendingReportJobs = new Map();

function ensureDir(targetPath) {
  try {
    fs.mkdirSync(targetPath, { recursive: true });
  } catch {
    // ignore
  }
}

function safeReadJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function safeWriteJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function moveIfMissing(sourcePath, targetPath) {
  try {
    if (!fs.existsSync(sourcePath) || fs.existsSync(targetPath)) return;
    ensureDir(path.dirname(targetPath));
    fs.cpSync(sourcePath, targetPath, { recursive: true, force: true });
  } catch {
    // ignore migration errors
  }
}

function migrateLegacyPortableData() {
  ensureDir(portableDataDir);
  ensureDir(portableUserDataDir);
  ensureDir(portableSessionDataDir);
  moveIfMissing(legacyUserDataDir, portableUserDataDir);
  moveIfMissing(legacySessionDataDir, portableSessionDataDir);
  moveIfMissing(legacyBridgeLogPath, bridgeLogPath);
  moveIfMissing(legacyWorkerConfigPath, workerConfigPath);
}

function normalizeWorkerPriority(value) {
  return String(value || "").trim().toLowerCase() === "primary" ? "primary" : "secondary";
}

function readWorkerConfig() {
  ensureDir(path.dirname(workerConfigPath));
  const parsed = safeReadJson(workerConfigPath, {}) || {};
  return {
    workerPriority: normalizeWorkerPriority(parsed.workerPriority),
    workerId: String(parsed.workerId || "").trim(),
    vcellRole: String(parsed.vcellRole || "").trim(),
  };
}

function writeWorkerConfig(config) {
  const current = readWorkerConfig();
  const next = {
    ...current,
    ...config,
    workerPriority: config.workerPriority != null ? normalizeWorkerPriority(config.workerPriority) : current.workerPriority,
    workerId: String(config.workerId != null ? config.workerId : current.workerId || "").trim(),
    vcellRole: String(config.vcellRole != null ? config.vcellRole : current.vcellRole || "").trim(),
  };
  safeWriteJson(workerConfigPath, next);
  if (config.workerId != null) remoteWorkerId = String(config.workerId).trim();
  return next;
}

function getHostSignature() {
  const user = (() => {
    try {
      return os.userInfo().username || "";
    } catch {
      return "";
    }
  })();

  return `${os.hostname()}|${process.platform}|${process.arch}|${user}`;
}

function buildMachineProfile() {
  return {
    hostname: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    cpuCores: os.cpus().length,
    memoryGB: Math.round(os.totalmem() / 1024 / 1024 / 1024),
  };
}

function initializeMachineContext() {
  migrateLegacyPortableData();

  const workerConfig = readWorkerConfig();
  const previous = safeReadJson(machineConfigPath, null);
  const hostSignature = getHostSignature();
  const machineProfile = buildMachineProfile();
  const copiedToNewMachine = Boolean(previous?.hostSignature) && previous.hostSignature !== hostSignature;
  const needsFreshRecord = !previous || copiedToNewMachine;

  const next = needsFreshRecord
    ? {
        machineId: randomUUID(),
        serverId: `${machineProfile.hostname}-${randomUUID().slice(0, 8)}`,
        machineLabel: `${machineProfile.hostname} portable host`,
        hostSignature,
        setupComplete: false,
        createdAt: new Date().toISOString(),
        preferredRole: workerConfig.workerPriority,
      }
    : {
        ...previous,
        machineLabel: String(previous.machineLabel || `${machineProfile.hostname} portable host`).trim(),
        hostSignature,
      };

  if (copiedToNewMachine) {
    writeWorkerConfig({
      workerPriority: workerConfig.workerPriority,
      workerId: "",
      vcellRole: "",
    });
  }

  next.lastLaunchedAt = new Date().toISOString();
  next.hostname = machineProfile.hostname;
  next.platform = machineProfile.platform;
  next.arch = machineProfile.arch;
  next.machine = machineProfile;
  next.needsSetup = copiedToNewMachine || !Boolean(next.setupComplete);
  next.copiedToNewMachine = copiedToNewMachine;

  safeWriteJson(machineConfigPath, next);
  return next;
}

let machineContextState = initializeMachineContext();
const remoteServerId = String(machineContextState.serverId || `${os.hostname()}-${randomUUID().slice(0, 8)}`);

app.setPath("userData", portableUserDataDir);
app.setPath("sessionData", portableSessionDataDir);

function getMachineContext() {
  const workerConfig = readWorkerConfig();
  return {
    ...machineContextState,
    serverId: remoteServerId,
    workerPriority: workerConfig.workerPriority,
    workerId: workerConfig.workerId,
    vcellRole: workerConfig.vcellRole,
    dataDirectory: portableDataDir,
  };
}

function jsonHeaders(origin = "*") {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Private-Network": "true",
    "Cache-Control": "no-store",
  };
}

function logBridge(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    fs.appendFileSync(bridgeLogPath, line, "utf8");
  } catch {
    // ignore log write errors
  }
  console.log(message);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    autoHideMenuBar: true,
    backgroundColor: "#020617",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  void mainWindow.loadURL(appUrl);
}

function createWorkerWindow() {
  workerWindow = new BrowserWindow({
    show: false,
    width: 1200,
    height: 900,
    backgroundColor: "#020617",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  workerReady = false;
  void workerWindow.loadURL(`${appUrl}?desktopReportWorker=1`);

  workerWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    console.error(`Desktop report worker failed to load: ${errorCode} ${errorDescription}`);
  });

  workerWindow.on("closed", () => {
    workerWindow = null;
    workerReady = false;
    for (const [jobId, pending] of pendingReportJobs.entries()) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error(`Desktop report worker closed while processing ${jobId}.`));
      pendingReportJobs.delete(jobId);
    }
  });
}

function createSetupMarkup(context) {
  const safeLabel = JSON.stringify(context.machineLabel || context.hostname || "Portable host");
  const safeDataDir = JSON.stringify(context.dataDirectory || portableDataDir);
  const safeCopiedFlag = context.copiedToNewMachine ? "This folder was detected on a new machine, so it is setting up a fresh machine identity." : "This portable package keeps its local database and report-host data inside this folder.";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Portable Host Setup</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #08111f;
      --panel: rgba(15, 23, 42, 0.92);
      --line: rgba(148, 163, 184, 0.18);
      --text: #e2e8f0;
      --muted: #94a3b8;
      --accent: #22d3ee;
      --accent-2: #38bdf8;
      --ok: #34d399;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at top left, rgba(34, 211, 238, 0.22), transparent 36%),
        linear-gradient(160deg, #020617, var(--bg));
      color: var(--text);
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
    }
    .panel {
      width: min(760px, 100%);
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 28px;
      padding: 28px;
      box-shadow: 0 24px 80px rgba(2, 6, 23, 0.55);
    }
    .eyebrow {
      color: var(--accent);
      letter-spacing: 0.2em;
      text-transform: uppercase;
      font-size: 12px;
      font-weight: 700;
      margin-bottom: 12px;
    }
    h1 {
      margin: 0 0 10px;
      font-size: 30px;
      line-height: 1.1;
    }
    .sub {
      color: var(--muted);
      margin-bottom: 22px;
      line-height: 1.6;
    }
    .card {
      border: 1px solid var(--line);
      border-radius: 20px;
      background: rgba(15, 23, 42, 0.6);
      padding: 18px;
      margin-bottom: 16px;
    }
    .card strong {
      display: block;
      margin-bottom: 8px;
      font-size: 15px;
    }
    ul {
      margin: 0;
      padding-left: 20px;
      color: var(--muted);
      line-height: 1.7;
    }
    .machine {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin: 18px 0;
    }
    .machine div {
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 14px;
      background: rgba(8, 17, 31, 0.55);
    }
    .machine span {
      display: block;
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 4px;
    }
    label.choice {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      border: 1px solid rgba(52, 211, 153, 0.28);
      background: rgba(52, 211, 153, 0.08);
      padding: 16px;
      border-radius: 18px;
      margin: 16px 0 20px;
    }
    label.choice input {
      margin-top: 3px;
      accent-color: var(--ok);
      transform: scale(1.1);
    }
    .row {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      margin-top: 20px;
    }
    .status {
      color: var(--muted);
      min-height: 22px;
      font-size: 13px;
    }
    button {
      border: none;
      border-radius: 14px;
      padding: 12px 18px;
      font-weight: 700;
      cursor: pointer;
      font-size: 14px;
    }
    .ghost {
      background: rgba(148, 163, 184, 0.08);
      color: var(--text);
      border: 1px solid var(--line);
    }
    .primary {
      background: linear-gradient(135deg, var(--accent-2), var(--accent));
      color: #02131d;
    }
  </style>
</head>
<body>
  <div class="panel">
    <div class="eyebrow">Portable Setup</div>
    <h1>Prepare this machine to host reports and local data</h1>
    <div class="sub">${safeCopiedFlag}</div>

    <div class="card">
      <strong>What this setup does</strong>
      <ul>
        <li>Keeps the Electron app database and local host data inside this portable folder.</li>
        <li>Creates a machine-specific host identity so copied folders can run side by side.</li>
        <li>Connects this machine to the Amber live queue for PDF report generation.</li>
      </ul>
    </div>

    <div class="machine">
      <div><span>Host label</span><strong id="hostLabel"></strong></div>
      <div><span>Portable data folder</span><strong id="dataDir"></strong></div>
    </div>

    <label class="choice">
      <input id="primaryHost" type="checkbox" />
      <div>
        <strong style="margin:0 0 6px;">Make this the primary report machine</strong>
        <div style="color: var(--muted); line-height: 1.6;">Use this when you want the Amber live app to send report load here first. If it is offline, the queue can fail over to another ready machine.</div>
      </div>
    </label>

    <div class="row">
      <div class="status" id="status">Ready to initialize.</div>
      <div style="display:flex; gap:12px; flex-wrap:wrap;">
        <button class="ghost" id="laterButton" type="button">Later</button>
        <button class="primary" id="initButton" type="button">Initialize This Machine</button>
      </div>
    </div>
  </div>
  <script>
    const hostLabelEl = document.getElementById("hostLabel");
    const dataDirEl = document.getElementById("dataDir");
    const statusEl = document.getElementById("status");
    const primaryHostEl = document.getElementById("primaryHost");
    const initButton = document.getElementById("initButton");
    const laterButton = document.getElementById("laterButton");

    hostLabelEl.textContent = ${safeLabel};
    dataDirEl.textContent = ${safeDataDir};

    async function runSetup() {
      statusEl.textContent = "Initializing this portable host...";
      initButton.disabled = true;
      laterButton.disabled = true;
      try {
        const result = await window.electronDesktop?.completePortableSetup?.({ primary: primaryHostEl.checked });
        if (result?.error) throw new Error(result.error);
        statusEl.textContent = primaryHostEl.checked
          ? "This machine is ready and marked as the primary host."
          : "This machine is ready as a secondary backup host.";
        window.setTimeout(() => window.close(), 900);
      } catch (error) {
        statusEl.textContent = error instanceof Error ? error.message : String(error || "Setup failed.");
        initButton.disabled = false;
        laterButton.disabled = false;
      }
    }

    initButton.addEventListener("click", runSetup);
    laterButton.addEventListener("click", () => window.close());
  </script>
</body>
</html>`;
}

function showPortableSetupWindow() {
  const context = getMachineContext();
  if (!context.needsSetup) return;
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.focus();
    return;
  }

  setupWindow = new BrowserWindow({
    width: 820,
    height: 760,
    resizable: false,
    minimizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    backgroundColor: "#020617",
    title: "Portable Host Setup",
    parent: mainWindow || undefined,
    modal: Boolean(mainWindow),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  const html = createSetupMarkup(context);
  void setupWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`);
  setupWindow.on("closed", () => {
    setupWindow = null;
  });
}

async function ensureWorkerReady() {
  if (!workerWindow || workerWindow.isDestroyed()) {
    createWorkerWindow();
  }

  if (workerReady) {
    return workerWindow;
  }

  await new Promise((resolve, reject) => {
    const started = Date.now();
    const intervalId = setInterval(() => {
      if (workerReady && workerWindow && !workerWindow.isDestroyed()) {
        clearInterval(intervalId);
        resolve(true);
        return;
      }
      if (Date.now() - started > 15000) {
        clearInterval(intervalId);
        reject(new Error("Desktop report worker did not become ready in time."));
      }
    }, 150);
  });

  return workerWindow;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

async function dispatchReportJob(payload) {
  const targetWindow = await ensureWorkerReady();
  if (!targetWindow || targetWindow.isDestroyed()) {
    throw new Error("Desktop report worker is not available.");
  }

  const jobId = payload.jobId || randomUUID();
  const job = { ...payload, jobId };

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingReportJobs.delete(jobId);
      reject(new Error("Desktop report generation timed out."));
    }, reportRequestTimeoutMs);

    pendingReportJobs.set(jobId, { resolve, reject, timeoutId });
    targetWindow.webContents.send("desktop:report-job", job);
  });
}

async function handleGenerateReport(req, res) {
  const origin = req.headers.origin || "*";
  try {
    const payload = await readRequestBody(req);
    const result = await dispatchReportJob(payload);

    if (!result?.success || !result?.pdfBase64) {
      res.writeHead(500, {
        ...jsonHeaders(origin),
        "Content-Type": "application/json",
      });
      res.end(JSON.stringify({ error: result?.error || "Desktop report generation failed.", sessionId: payload.sessionId || result?.sessionId || null }));
      return;
    }

    const pdfBuffer = Buffer.from(result.pdfBase64, "base64");
    res.writeHead(200, {
      ...jsonHeaders(origin),
      "Content-Type": result.mimeType || "application/pdf",
      "Content-Length": String(pdfBuffer.length),
      "Content-Disposition": `attachment; filename="${result.fileName || "desktop-report.pdf"}"`,
      "X-Desktop-Session-Id": String(result.sessionId || payload.sessionId || ""),
    });
    res.end(pdfBuffer);
  } catch (error) {
    res.writeHead(500, {
      ...jsonHeaders(origin),
      "Content-Type": "application/json",
    });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Desktop report request failed." }));
  }
}

function startDesktopServer() {
  if (desktopServer) {
    return;
  }

  desktopServer = http.createServer(async (req, res) => {
    const origin = req.headers.origin || "*";

    if (req.method === "OPTIONS") {
      res.writeHead(204, jsonHeaders(origin));
      res.end();
      return;
    }

    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, {
        ...jsonHeaders(origin),
        "Content-Type": "application/json",
      });
      res.end(
        JSON.stringify({
          ok: true,
          workerReady,
          platform: process.platform,
          machine: buildMachineProfile(),
          context: getMachineContext(),
        }),
      );
      return;
    }

    if (req.url === "/reports/generate" && req.method === "POST") {
      await handleGenerateReport(req, res);
      return;
    }

    res.writeHead(404, {
      ...jsonHeaders(origin),
      "Content-Type": "application/json",
    });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  desktopServer.listen(desktopServerPort, desktopServerHost);
}

async function postRemoteBridge(pathname, payload) {
  logBridge(`POST ${pathname}`);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  const response = await fetch(`${remoteBridgeBaseUrl}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Report-Server-Token": remoteBridgeToken,
    },
    body: JSON.stringify(payload),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeoutId));

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    logBridge(`POST ${pathname} failed with ${response.status}`);
    throw new Error(body?.error || `Remote bridge request failed with ${response.status}.`);
  }

  logBridge(`POST ${pathname} succeeded`);
  return body;
}

function getRemoteWorkerId() {
  if (remoteWorkerId) return remoteWorkerId;
  const config = readWorkerConfig();
  remoteWorkerId = String(config.workerId || "").trim();
  return remoteWorkerId;
}

async function pushPrimaryPreferenceIfNeeded() {
  const context = getMachineContext();
  if (!context.setupComplete) return;
  if (context.workerPriority !== "primary") return;

  try {
    await postRemoteBridge("/api/report-server-primary", {
      serverId: remoteServerId,
      machineId: context.machineId,
      machineLabel: context.machineLabel,
      hostname: context.hostname,
    });
  } catch (error) {
    logBridge(`Primary server preference update failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function registerWithVcell() {
  if (getRemoteWorkerId()) {
    logBridge(`vCell: already registered as worker ${getRemoteWorkerId()}`);
    await pushPrimaryPreferenceIfNeeded();
    return getRemoteWorkerId();
  }

  try {
    const machineProfile = buildMachineProfile();
    const payload = {
      action: "hello",
      hostname: machineProfile.hostname,
      platform: process.platform,
      machine: machineProfile,
    };

    const result = await postRemoteBridge("/api/vcell", payload);

    if (result?.workerId) {
      writeWorkerConfig({ workerId: result.workerId, vcellRole: result.role });
      logBridge(`vCell: registered as ${result.workerId} (role: ${result.role})`);
      await pushPrimaryPreferenceIfNeeded();
      return result.workerId;
    }
  } catch (error) {
    logBridge(`vCell: hello failed - ${error instanceof Error ? error.message : String(error)}`);
  }

  return "";
}

async function pollRemoteReportJobs() {
  if (remotePollInFlight) {
    return;
  }

  remotePollInFlight = true;
  try {
    const machineProfile = buildMachineProfile();
    const machineContext = getMachineContext();
    logBridge(`Polling remote bridge. workerReady=${workerReady} activeRemoteJobId=${activeRemoteJobId || "-"}`);
    const pollPayload = {
      serverId: remoteServerId,
      machineId: machineContext.machineId,
      machineLabel: machineContext.machineLabel,
      hostname: machineProfile.hostname,
      workerId: getRemoteWorkerId(),
      workerReady,
      activeJobId: activeRemoteJobId,
      platform: process.platform,
      workerPriority: readWorkerConfig().workerPriority,
      machine: machineProfile,
    };

    const { job } = await postRemoteBridge("/api/report-jobs-poll", pollPayload);
    if (!job || activeRemoteJobId) {
      logBridge("No queued remote job returned.");
      return;
    }

    activeRemoteJobId = String(job.jobId || "");
    logBridge(`Received remote job ${activeRemoteJobId}`);
    const result = await dispatchReportJob(job);
    await postRemoteBridge("/api/report-jobs-complete", {
      serverId: remoteServerId,
      machineId: machineContext.machineId,
      machineLabel: machineContext.machineLabel,
      hostname: machineProfile.hostname,
      workerId: getRemoteWorkerId(),
      jobId: job.jobId,
      sessionId: job.sessionId,
      success: Boolean(result?.success),
      result: result || null,
      reportPayload: result?.reportPayload || null,
      error: result?.error || "",
      workerPriority: readWorkerConfig().workerPriority,
      machine: machineProfile,
    });
    logBridge(`Completed remote job ${activeRemoteJobId} success=${Boolean(result?.success)}`);
  } catch (error) {
    logBridge(`Remote report polling failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    activeRemoteJobId = "";
    remotePollInFlight = false;
  }
}

function startRemoteReportPolling() {
  if (remotePollIntervalId) {
    return;
  }

  logBridge(`Starting remote report polling against ${remoteBridgeBaseUrl} as ${remoteServerId}`);
  void pollRemoteReportJobs();
  remotePollIntervalId = setInterval(() => {
    void pollRemoteReportJobs();
  }, remotePollIntervalMs);
}

async function completePortableSetup({ primary } = {}) {
  const nextWorkerConfig = writeWorkerConfig({
    workerPriority: primary ? "primary" : "secondary",
  });

  machineContextState = {
    ...machineContextState,
    machineLabel: machineContextState.machineLabel || `${os.hostname()} portable host`,
    preferredRole: nextWorkerConfig.workerPriority,
    setupComplete: true,
    needsSetup: false,
    initializedAt: new Date().toISOString(),
  };
  safeWriteJson(machineConfigPath, machineContextState);

  await registerWithVcell();
  if (nextWorkerConfig.workerPriority === "primary") {
    await pushPrimaryPreferenceIfNeeded();
  }

  return getMachineContext();
}

ipcMain.handle("desktop:report-worker-ready", async () => {
  workerReady = true;
  return true;
});

ipcMain.handle("desktop:report-job-result", async (_event, payload) => {
  if (!payload?.jobId) {
    return false;
  }
  const pending = pendingReportJobs.get(payload.jobId);
  if (!pending) {
    return false;
  }

  clearTimeout(pending.timeoutId);
  pendingReportJobs.delete(payload.jobId);
  pending.resolve(payload);
  return true;
});

ipcMain.handle("desktop:get-worker-config", async () => readWorkerConfig());
ipcMain.handle("desktop:set-worker-config", async (_event, config) => writeWorkerConfig(config || {}));
ipcMain.handle("desktop:machine-context", async () => getMachineContext());
ipcMain.handle("desktop:complete-portable-setup", async (_event, payload) => {
  try {
    return await completePortableSetup(payload || {});
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle("desktop:vcell-assign-role", async (_event, { role }) => {
  try {
    const workerId = getRemoteWorkerId();
    if (!workerId) {
      return { error: "Not registered with vCell yet." };
    }

    const result = await postRemoteBridge("/api/vcell", {
      action: "assign",
      workerId,
      role: role === "primary" ? "primary" : "secondary",
    });

    if (result?.role) {
      writeWorkerConfig({ vcellRole: result.role, workerPriority: result.role });
      if (result.role === "primary") {
        await pushPrimaryPreferenceIfNeeded();
      }
      return { success: true, role: result.role };
    }

    return { error: "vCell assign returned no role." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
});

app.whenReady().then(() => {
  createMainWindow();
  createWorkerWindow();
  startDesktopServer();
  startRemoteReportPolling();
  void registerWithVcell();
  showPortableSetupWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
    if (!workerWindow || workerWindow.isDestroyed()) {
      createWorkerWindow();
    }
    if (getMachineContext().needsSetup) {
      showPortableSetupWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (desktopServer) {
    desktopServer.close();
    desktopServer = null;
  }
  if (remotePollIntervalId) {
    clearInterval(remotePollIntervalId);
    remotePollIntervalId = null;
  }
});
