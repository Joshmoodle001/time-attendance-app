import { app, BrowserWindow, ipcMain } from "electron";
import http from "node:http";
import https from "node:https";
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
const bridgeLogPath = path.join(rootDir, "report-bridge.log");

let mainWindow = null;
let workerWindow = null;
let workerReady = false;
let desktopServer = null;
let remotePollIntervalId = null;
let remotePollInFlight = false;
let activeRemoteJobId = "";

const pendingReportJobs = new Map();
const remoteServerId = `${os.hostname()}-${randomUUID().slice(0, 8)}`;

function logBridge(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    fs.appendFileSync(bridgeLogPath, line, "utf8");
  } catch {
    // ignore log write errors
  }
  console.log(message);
}

app.setPath("userData", path.join(rootDir, ".electron-user-data"));
app.setPath("sessionData", path.join(rootDir, ".electron-session-data"));

function jsonHeaders(origin = "*") {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Private-Network": "true",
    "Cache-Control": "no-store",
  };
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
          machine: {
            cpuCores: os.cpus().length,
            memoryGB: Math.round(os.totalmem() / 1024 / 1024 / 1024),
          },
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

async function pollRemoteReportJobs() {
  if (remotePollInFlight) {
    return;
  }

  remotePollInFlight = true;
  try {
    logBridge(`Polling remote bridge. workerReady=${workerReady} activeRemoteJobId=${activeRemoteJobId || "-"}`);
    const pollPayload = {
      serverId: remoteServerId,
      workerReady,
      activeJobId: activeRemoteJobId,
      platform: process.platform,
      machine: {
        cpuCores: os.cpus().length,
        memoryGB: Math.round(os.totalmem() / 1024 / 1024 / 1024),
      },
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
      jobId: job.jobId,
      sessionId: job.sessionId,
      success: Boolean(result?.success),
      reportPayload: result?.reportPayload || null,
      error: result?.error || "",
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

app.whenReady().then(() => {
  createMainWindow();
  createWorkerWindow();
  startDesktopServer();
  startRemoteReportPolling();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
    if (!workerWindow || workerWindow.isDestroyed()) {
      createWorkerWindow();
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
