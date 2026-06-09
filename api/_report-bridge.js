import { createClient } from "@supabase/supabase-js";

const BUCKET_NAME = "shared-app-state";
const JOBS_PREFIX = "report-bridge/jobs";
const SERVERS_PREFIX = "report-bridge/servers";
const SERVER_STATUS_PATH = "report-bridge/server-status.json";
const JOB_INDEX_PATH = "report-bridge/jobs-index.json";
const DEFAULT_SERVER_TOKEN = "ember-report-server-2026";
const SERVER_ONLINE_THRESHOLD_MS = 90_000;
const SERVER_CLEANUP_MS = 24 * 60 * 60_000;
const STALE_PROCESSING_MS = 3 * 60_000;
const COMPLETED_JOB_RETENTION_MS = 30 * 60_000;

function getSupabaseConfig() {
  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return {
    url,
    serviceRoleKey,
    configured: Boolean(url && serviceRoleKey),
  };
}

export function getServerToken() {
  return String(process.env.REPORT_SERVER_TOKEN || DEFAULT_SERVER_TOKEN).trim();
}

export function getAdminClient() {
  const config = getSupabaseConfig();
  if (!config.configured) return null;
  return createClient(config.url, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function ensureBucket(client) {
  const { data: buckets, error: listError } = await client.storage.listBuckets();
  if (listError) throw listError;
  const exists = (buckets || []).some((bucket) => bucket.name === BUCKET_NAME);
  if (exists) return;

  const { error: createError } = await client.storage.createBucket(BUCKET_NAME, {
    public: false,
    fileSizeLimit: "50MB",
  });
  if (createError && !String(createError.message || "").toLowerCase().includes("already exists")) {
    throw createError;
  }
}

export function getJobPath(jobId) {
  return `${JOBS_PREFIX}/${jobId}.json`;
}

export async function uploadJson(client, objectPath, payload) {
  const content = JSON.stringify(payload);
  const { error } = await client.storage.from(BUCKET_NAME).upload(objectPath, content, {
    contentType: "application/json",
    upsert: true,
  });
  if (error) throw error;
}

export async function downloadJson(client, objectPath) {
  const { data, error } = await client.storage.from(BUCKET_NAME).download(objectPath);
  if (error) {
    const missing = String(error.message || "").toLowerCase().includes("not found");
    if (missing) return null;
    throw error;
  }
  return JSON.parse(await data.text());
}

function pruneJobIndexEntries(entries) {
  const now = Date.now();
  return (Array.isArray(entries) ? entries : []).filter((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const status = String(entry.status || "").trim().toLowerCase();
    if (status !== "complete" && status !== "failed") return true;
    const updatedAt = String(entry.updatedAt || entry.completedAt || entry.createdAt || "").trim();
    const updatedMs = updatedAt ? new Date(updatedAt).getTime() : 0;
    if (!updatedMs) return false;
    return now - updatedMs < COMPLETED_JOB_RETENTION_MS;
  });
}

function toJobIndexEntry(job) {
  if (!job || typeof job !== "object") return null;
  return {
    jobId: String(job.jobId || "").trim(),
    sessionId: String(job.sessionId || "").trim(),
    status: String(job.status || "").trim(),
    createdAt: String(job.createdAt || "").trim(),
    updatedAt: String(job.updatedAt || "").trim(),
    completedAt: String(job.completedAt || "").trim(),
    processingStartedAt: String(job.processingStartedAt || "").trim(),
    serverId: String(job.serverId || "").trim(),
    error: String(job.error || "").trim(),
    fingerprint: buildJobRequestFingerprint(job.request || {}),
    requestMode: String(job.request?.requestMode || "").trim() === "all" ? "all" : "selected",
    selectionMode: String(job.request?.selectionMode || "").trim(),
    selectedStores: Array.isArray(job.request?.selectedStores) ? job.request.selectedStores : [],
    employeeCodes: Array.isArray(job.request?.employeeCodes) ? job.request.employeeCodes : [],
  };
}

export async function readJobIndex(client) {
  const current = await downloadJson(client, JOB_INDEX_PATH);
  if (current && Array.isArray(current.entries)) {
    return {
      entries: pruneJobIndexEntries(current.entries),
      updatedAt: String(current.updatedAt || "").trim(),
    };
  }

  const jobs = await listJobs(client);
  const rebuilt = {
    entries: pruneJobIndexEntries(jobs.map((job) => toJobIndexEntry(job)).filter(Boolean)),
    updatedAt: new Date().toISOString(),
  };
  await uploadJson(client, JOB_INDEX_PATH, rebuilt);
  return rebuilt;
}

export async function writeJobIndex(client, index) {
  const next = {
    entries: pruneJobIndexEntries(index?.entries || []),
    updatedAt: new Date().toISOString(),
  };
  await uploadJson(client, JOB_INDEX_PATH, next);
  return next;
}

export async function upsertJobIndexEntry(client, job) {
  const entry = toJobIndexEntry(job);
  if (!entry?.jobId) return null;
  const index = await readJobIndex(client);
  const entries = index.entries.filter((current) => String(current.jobId || "") !== entry.jobId);
  entries.push(entry);
  await writeJobIndex(client, { entries });
  return entry;
}

export async function listJobFiles(client) {
  const { data, error } = await client.storage.from(BUCKET_NAME).list(JOBS_PREFIX, {
    limit: 200,
    sortBy: { column: "name", order: "asc" },
  });
  if (error) throw error;
  return (data || []).filter((item) => item.name?.endsWith(".json"));
}

export async function listJobs(client) {
  const files = await listJobFiles(client);
  const jobs = [];
  for (const file of files) {
    const job = await downloadJson(client, getJobPath(file.name.replace(/\.json$/i, "")));
    if (job) {
      jobs.push(job);
    }
  }
  return jobs.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
}

export async function repairStaleJobs(client) {
  const index = await readJobIndex(client);
  const jobs = [];
  for (const entry of index.entries) {
    if (String(entry.status || "") !== "processing") continue;
    const job = await downloadJson(client, getJobPath(entry.jobId));
    if (job) jobs.push(job);
  }
  const now = Date.now();

  for (const job of jobs) {
    if (job.status !== "processing") continue;

    const updatedAt = String(job.updatedAt || job.processingStartedAt || job.createdAt || "");
    const updatedAtMs = updatedAt ? new Date(updatedAt).getTime() : 0;
    if (!updatedAtMs || now - updatedAtMs < STALE_PROCESSING_MS) continue;

    const attemptCount = Number(job.attemptCount || 0) + 1;
    const nextJob =
      attemptCount >= 3
        ? {
            ...job,
            status: "failed",
            updatedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            attemptCount,
            error: "The server host stopped responding while processing this report.",
          }
        : {
            ...job,
            status: "queued",
            updatedAt: new Date().toISOString(),
            attemptCount,
            serverId: "",
            processingStartedAt: "",
            error: "",
          };

    await uploadJson(client, getJobPath(job.jobId), nextJob);
    await upsertJobIndexEntry(client, nextJob);
  }
}

export function normalizeJobRequest(body) {
  if (!body || typeof body !== "object") return null;
  const sessionId = String(body.sessionId || "").trim();
  const templateKey = String(body.templateKey || "").trim();
  const startDate = String(body.startDate || "").trim();
  const endDate = String(body.endDate || "").trim();
  const selectionMode = String(body.selectionMode || "").trim();
  if (!sessionId || !templateKey || !startDate || !endDate || !selectionMode) return null;
  return {
    sessionId,
    templateKey,
    startDate,
    endDate,
    selectionMode,
    includeInactiveProfiles: Boolean(body.includeInactiveProfiles),
    selectedStores: Array.isArray(body.selectedStores) ? body.selectedStores.map((value) => String(value).trim()).filter(Boolean) : [],
    employeeCodes: Array.isArray(body.employeeCodes) ? body.employeeCodes.map((value) => String(value).trim()).filter(Boolean) : [],
    awolThresholdDays: Number(body.awolThresholdDays || 0) || undefined,
    requestMode: String(body.requestMode || "").trim() === "all" ? "all" : "selected",
  };
}

export function buildJobRequestFingerprint(request) {
  const normalized = normalizeJobRequest(request);
  if (!normalized) return "";
  return JSON.stringify({
    templateKey: normalized.templateKey,
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    selectionMode: normalized.selectionMode,
    includeInactiveProfiles: normalized.includeInactiveProfiles,
    requestMode: normalized.requestMode,
    selectedStores: [...normalized.selectedStores].sort((a, b) => a.localeCompare(b)),
    employeeCodes: [...normalized.employeeCodes].sort((a, b) => a.localeCompare(b)),
    awolThresholdDays: normalized.awolThresholdDays || 0,
  });
}

export function verifyServerToken(req) {
  const token = String(req.headers["x-report-server-token"] || req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  return token && token === getServerToken();
}

function getServerStatusPath(serverId) {
  const safeId = String(serverId || "desktop-server").trim().replace(/[^a-zA-Z0-9\-_]/g, "-");
  return `${SERVERS_PREFIX}/${safeId}.json`;
}

export async function updateServerStatus(client, payload) {
  const serverId = String(payload?.serverId || "desktop-server").trim();
  const now = new Date().toISOString();

  const perServerPath = getServerStatusPath(serverId);
  const current = (await downloadJson(client, perServerPath)) || {};
  const next = {
    ...current,
    ...payload,
    serverId,
    lastSeenAt: now,
    workerPriority: String(payload?.workerPriority || current.workerPriority || "secondary").trim().toLowerCase() === "primary" ? "primary" : "secondary",
  };
  await uploadJson(client, perServerPath, next);

  const aggregate = (await downloadJson(client, SERVER_STATUS_PATH)) || {};
  aggregate.serverId = serverId;
  aggregate.workerReady = payload?.workerReady != null ? Boolean(payload.workerReady) : aggregate.workerReady;
  aggregate.lastSeenAt = now;
  aggregate.workerPriority = next.workerPriority;
  await uploadJson(client, SERVER_STATUS_PATH, aggregate);

  return next;
}

async function listServerFiles(client) {
  const { data, error } = await client.storage.from(BUCKET_NAME).list(SERVERS_PREFIX, {
    limit: 100,
    sortBy: { column: "name", order: "asc" },
  });
  if (error) throw error;
  return (data || []).filter((item) => item.name?.endsWith(".json"));
}

export async function getAllServerStatuses(client) {
  const files = await listServerFiles(client);
  const servers = [];
  const now = Date.now();
  for (const file of files) {
    const serverId = file.name.replace(/\.json$/i, "");
    const status = await downloadJson(client, getServerStatusPath(serverId));
    if (status) {
      const lastSeenAt = new Date(String(status.lastSeenAt || "")).getTime();
      servers.push({
        ...status,
        serverId: String(status.serverId || serverId),
        online: Boolean(lastSeenAt) && now - lastSeenAt < SERVER_ONLINE_THRESHOLD_MS,
        stale: Boolean(lastSeenAt) && now - lastSeenAt >= SERVER_CLEANUP_MS,
      });
    }
  }
  return servers.filter((s) => !s.stale);
}

export function hasOnlinePrimary(servers) {
  return servers.some((s) => s.online && s.workerReady && s.workerPriority === "primary");
}

export function shouldDispatchToWorker(requestingServerId, allServers) {
  const requestingServer = allServers.find((s) => s.serverId === requestingServerId);
  if (!requestingServer || !requestingServer.online || !requestingServer.workerReady) return false;

  const primaryOnline = hasOnlinePrimary(allServers);
  if (!primaryOnline) return true;
  return requestingServer.workerPriority === "primary";
}

export async function getServerStatus(client) {
  await repairStaleJobs(client);
  const status = await downloadJson(client, SERVER_STATUS_PATH);
  const allServers = await getAllServerStatuses(client);
  const index = await readJobIndex(client);
  if (!status) {
    return { online: false, workerReady: false, servers: allServers, queue: { queued: 0, processing: 0, complete: 0, completed: 0, failed: 0 } };
  }
  const queue = {
    queued: index.entries.filter((job) => job.status === "queued").length,
    processing: index.entries.filter((job) => job.status === "processing").length,
    complete: index.entries.filter((job) => job.status === "complete").length,
    completed: index.entries.filter((job) => job.status === "complete").length,
    failed: index.entries.filter((job) => job.status === "failed").length,
  };
  const lastSeenAt = String(status.lastSeenAt || "");
  const online = Boolean(lastSeenAt) && Date.now() - new Date(lastSeenAt).getTime() < SERVER_ONLINE_THRESHOLD_MS;
  return {
    ...status,
    online,
    servers: allServers,
    queue,
  };
}
