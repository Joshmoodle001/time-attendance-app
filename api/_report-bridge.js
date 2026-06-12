import { createClient } from "@supabase/supabase-js";

const BUCKET_NAME = "shared-app-state";
const JOBS_PREFIX = "report-bridge/jobs";
const JOB_INDEX_PATH = "report-bridge/jobs-index.json";
const SERVER_POOL_PATH = "report-bridge/server-pool.json";
const SERVER_PREFERENCE_PATH = "report-bridge/server-preference.json";
const WORKER_REGISTRY_PATH = "report-bridge/worker-registry.json";
const DEFAULT_SERVER_TOKEN = "ember-report-server-2026";
const SERVER_ONLINE_THRESHOLD_MS = 90_000;
const SERVER_CLEANUP_MS = 24 * 60 * 60_000;
const STALE_PROCESSING_MS = 3 * 60_000;
const COMPLETED_JOB_RETENTION_MS = 30 * 60_000;

function normalizeText(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function sanitizeUrl(value) {
  return normalizeText(value).replace(/^['"]+|['"]+$/g, "").replace(/\/+$/g, "");
}

function normalizeIsoDate(value) {
  const text = normalizeText(value);
  if (!text) return "";
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function normalizeServerLabel(payload = {}) {
  return normalizeText(payload.machineLabel || payload.hostname || payload.serverId || "Desktop report host");
}

function normalizeServerEntry(entry = {}) {
  const lastSeenAt = normalizeIsoDate(entry.lastSeenAt);
  const lastSeenMs = lastSeenAt ? new Date(lastSeenAt).getTime() : 0;
  const now = Date.now();
  return {
    serverId: normalizeText(entry.serverId || "desktop-server") || "desktop-server",
    machineId: normalizeText(entry.machineId),
    machineLabel: normalizeServerLabel(entry),
    hostname: normalizeText(entry.hostname),
    workerId: normalizeText(entry.workerId),
    workerReady: Boolean(entry.workerReady),
    workerPriority: normalizeText(entry.workerPriority).toLowerCase() === "primary" ? "primary" : "secondary",
    activeJobId: normalizeText(entry.activeJobId),
    platform: normalizeText(entry.platform),
    machine: typeof entry.machine === "object" && entry.machine !== null ? entry.machine : {},
    lastSeenAt,
    lastCompletedAt: normalizeIsoDate(entry.lastCompletedAt),
    lastCompletedJobId: normalizeText(entry.lastCompletedJobId),
    lastError: normalizeText(entry.lastError),
    online: Boolean(lastSeenMs) && now - lastSeenMs < SERVER_ONLINE_THRESHOLD_MS,
    stale: Boolean(lastSeenMs) && now - lastSeenMs >= SERVER_CLEANUP_MS,
  };
}

function sortServerCandidates(servers = []) {
  return [...servers].sort((left, right) => {
    const priorityDiff = Number(right.workerPriority === "primary") - Number(left.workerPriority === "primary");
    if (priorityDiff !== 0) return priorityDiff;
    const readyDiff = Number(Boolean(right.workerReady)) - Number(Boolean(left.workerReady));
    if (readyDiff !== 0) return readyDiff;
    return normalizeText(right.lastSeenAt).localeCompare(normalizeText(left.lastSeenAt));
  });
}

export function applyCors(req, res, methods = "GET,POST,OPTIONS") {
  const origin = req.headers?.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Report-Server-Token, X-Shift-Live-Key");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Cache-Control", "no-store");
}

function getSupabaseConfig() {
  const url = sanitizeUrl(
    process.env.SUPABASE_URL
      || process.env.VITE_SUPABASE_URL
      || process.env.NEXT_PUBLIC_SUPABASE_URL
      || "",
  );
  const serviceRoleKey = normalizeText(
    process.env.SUPABASE_SERVICE_ROLE_KEY
      || process.env.SUPABASE_SERVICE_KEY
      || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
      || "",
  );
  return {
    url,
    serviceRoleKey,
    configured: Boolean(url && serviceRoleKey),
  };
}

export function getServerToken() {
  return normalizeText(process.env.REPORT_SERVER_TOKEN || DEFAULT_SERVER_TOKEN);
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
    jobId: normalizeText(job.jobId),
    sessionId: normalizeText(job.sessionId),
    status: normalizeText(job.status),
    createdAt: normalizeText(job.createdAt),
    updatedAt: normalizeText(job.updatedAt),
    completedAt: normalizeText(job.completedAt),
    processingStartedAt: normalizeText(job.processingStartedAt),
    serverId: normalizeText(job.serverId),
    error: normalizeText(job.error),
    fingerprint: buildJobRequestFingerprint(job.request || {}),
    requestMode: normalizeText(job.request?.requestMode) === "all" ? "all" : "selected",
    selectionMode: normalizeText(job.request?.selectionMode),
    selectedStores: Array.isArray(job.request?.selectedStores) ? job.request.selectedStores : [],
    employeeCodes: Array.isArray(job.request?.employeeCodes) ? job.request.employeeCodes : [],
  };
}

export async function readJobIndex(client) {
  const current = await downloadJson(client, JOB_INDEX_PATH);
  if (current && Array.isArray(current.entries)) {
    return {
      entries: pruneJobIndexEntries(current.entries),
      updatedAt: normalizeText(current.updatedAt),
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
  const entries = index.entries.filter((current) => normalizeText(current.jobId) !== entry.jobId);
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
    if (job) jobs.push(job);
  }
  return jobs.sort((a, b) => normalizeText(a.createdAt).localeCompare(normalizeText(b.createdAt)));
}

export async function repairStaleJobs(client) {
  const index = await readJobIndex(client);
  const jobs = [];
  for (const entry of index.entries) {
    if (normalizeText(entry.status) !== "processing") continue;
    const job = await downloadJson(client, getJobPath(entry.jobId));
    if (job) jobs.push(job);
  }
  const now = Date.now();

  for (const job of jobs) {
    if (job.status !== "processing") continue;

    const updatedAt = normalizeText(job.updatedAt || job.processingStartedAt || job.createdAt);
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
  const sessionId = normalizeText(body.sessionId);
  const templateKey = normalizeText(body.templateKey);
  const startDate = normalizeText(body.startDate);
  const endDate = normalizeText(body.endDate);
  const selectionMode = normalizeText(body.selectionMode);
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
    requestMode: normalizeText(body.requestMode) === "all" ? "all" : "selected",
    outputMode: normalizeText(body.outputMode) === "data" ? "data" : "pdf",
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
    outputMode: normalized.outputMode,
  });
}

export function verifyServerToken(req) {
  const token = normalizeText(req.headers["x-report-server-token"] || req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  return token && token === getServerToken();
}

export async function readServerPool(client) {
  const current = (await downloadJson(client, SERVER_POOL_PATH)) || { servers: [] };
  return {
    servers: Array.isArray(current.servers) ? current.servers.map((entry) => normalizeServerEntry(entry)).filter((entry) => !entry.stale) : [],
    updatedAt: normalizeText(current.updatedAt),
  };
}

export async function writeServerPool(client, pool) {
  const next = {
    servers: sortServerCandidates((pool?.servers || []).map((entry) => normalizeServerEntry(entry)).filter((entry) => !entry.stale)),
    updatedAt: new Date().toISOString(),
  };
  await uploadJson(client, SERVER_POOL_PATH, next);
  return next;
}

export async function readPrimaryServerPreference(client) {
  const current = (await downloadJson(client, SERVER_PREFERENCE_PATH)) || null;
  if (!current) return null;
  return {
    serverId: normalizeText(current.serverId),
    machineId: normalizeText(current.machineId),
    machineLabel: normalizeText(current.machineLabel),
    updatedAt: normalizeText(current.updatedAt),
  };
}

export async function writePrimaryServerPreference(client, preference) {
  const next = {
    serverId: normalizeText(preference?.serverId),
    machineId: normalizeText(preference?.machineId),
    machineLabel: normalizeText(preference?.machineLabel),
    updatedAt: new Date().toISOString(),
  };
  await uploadJson(client, SERVER_PREFERENCE_PATH, next);
  return next;
}

export function selectDispatchServer(servers = [], preferredServerId = "") {
  const onlineReady = sortServerCandidates(servers).filter((server) => server.online && server.workerReady);
  if (onlineReady.length === 0) {
    return { server: null, mode: "unavailable" };
  }

  const preferred = preferredServerId
    ? onlineReady.find((server) => server.serverId === preferredServerId)
    : null;
  if (preferred) {
    return { server: preferred, mode: "primary" };
  }

  const primaryCandidate = onlineReady.find((server) => server.workerPriority === "primary");
  if (primaryCandidate) {
    return { server: primaryCandidate, mode: preferredServerId ? "failover" : "auto" };
  }

  return { server: onlineReady[0], mode: preferredServerId ? "failover" : "auto" };
}

export async function updateServerStatus(client, payload) {
  const serverId = normalizeText(payload?.serverId || "desktop-server") || "desktop-server";
  const now = new Date().toISOString();
  const pool = await readServerPool(client);
  const remaining = pool.servers.filter((entry) => entry.serverId !== serverId);
  const nextEntry = normalizeServerEntry({
    ...payload,
    serverId,
    hostname: normalizeText(payload?.hostname || payload?.machine?.hostname),
    machineLabel: normalizeServerLabel(payload),
    workerReady: payload?.workerReady,
    lastSeenAt: now,
  });

  const nextPool = await writeServerPool(client, {
    servers: [...remaining, nextEntry],
  });

  const preference = await readPrimaryServerPreference(client);
  if (!preference?.serverId && nextEntry.workerPriority === "primary") {
    await writePrimaryServerPreference(client, nextEntry);
  }

  return nextPool.servers.find((entry) => entry.serverId === serverId) || nextEntry;
}

export async function getAllServerStatuses(client) {
  const pool = await readServerPool(client);
  return pool.servers;
}

export async function getServerStatus(client) {
  await repairStaleJobs(client);
  const [servers, preference, index] = await Promise.all([
    getAllServerStatuses(client),
    readPrimaryServerPreference(client),
    readJobIndex(client),
  ]);
  const dispatch = selectDispatchServer(servers, preference?.serverId || "");
  const queue = {
    queued: index.entries.filter((job) => job.status === "queued").length,
    processing: index.entries.filter((job) => job.status === "processing").length,
    complete: index.entries.filter((job) => job.status === "complete").length,
    completed: index.entries.filter((job) => job.status === "complete").length,
    failed: index.entries.filter((job) => job.status === "failed").length,
  };

  return {
    online: Boolean(dispatch.server),
    workerReady: Boolean(dispatch.server?.workerReady),
    serverId: dispatch.server?.serverId || "",
    lastSeenAt: dispatch.server?.lastSeenAt || "",
    lastCompletedAt: dispatch.server?.lastCompletedAt || "",
    lastError: dispatch.server?.lastError || "",
    primaryServerId: preference?.serverId || dispatch.server?.serverId || "",
    primaryServerLabel: preference?.machineLabel || dispatch.server?.machineLabel || "",
    dispatchServerId: dispatch.server?.serverId || "",
    dispatchServerLabel: dispatch.server?.machineLabel || "",
    dispatchMode: dispatch.mode,
    servers,
    queue,
  };
}

export async function readWorkerRegistry(client) {
  await ensureBucket(client);
  const registry = (await downloadJson(client, WORKER_REGISTRY_PATH)) || { workers: {} };
  return registry;
}

export async function writeWorkerRegistry(client, registry) {
  await ensureBucket(client);
  await uploadJson(client, WORKER_REGISTRY_PATH, registry);
  return registry;
}

export async function registerWorker(client, { hostname, platform, machine }) {
  const registry = await readWorkerRegistry(client);
  const hostnameKey = normalizeText(hostname || "unknown").toLowerCase() || "unknown";

  let entry = registry.workers[hostnameKey];

  if (!entry) {
    entry = {
      workerId: `${hostnameKey}-${Math.random().toString(36).slice(2, 8)}`,
      hostname: normalizeText(hostname || "unknown") || "unknown",
      role: "secondary",
      registeredAt: new Date().toISOString(),
      platform: platform || "",
      machine: machine || {},
    };
    registry.workers[hostnameKey] = entry;
  } else {
    entry.platform = platform || entry.platform;
    entry.machine = machine || entry.machine;
  }

  await writeWorkerRegistry(client, registry);
  return entry;
}

export async function assignWorkerRole(client, { workerId, role }) {
  const registry = await readWorkerRegistry(client);

  let found = null;
  for (const key of Object.keys(registry.workers)) {
    if (registry.workers[key].workerId === workerId) {
      registry.workers[key].role = role === "primary" ? "primary" : "secondary";
      registry.workers[key].assignedAt = new Date().toISOString();
      found = registry.workers[key];
      break;
    }
  }

  if (!found) return null;

  await writeWorkerRegistry(client, registry);
  return found;
}

export function getWorkerRole(registry, workerId) {
  if (!workerId || !registry?.workers) return "secondary";

  for (const key of Object.keys(registry.workers)) {
    if (registry.workers[key].workerId === workerId) {
      return registry.workers[key].role || "secondary";
    }
  }
  return "secondary";
}
