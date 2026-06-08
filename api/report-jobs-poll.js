import {
  buildJobRequestFingerprint,
  downloadJson,
  ensureBucket,
  getAdminClient,
  getJobPath,
  readJobIndex,
  repairStaleJobs,
  upsertJobIndexEntry,
  updateServerStatus,
  uploadJson,
  verifyServerToken,
} from "./_report-bridge.js";

export default async function handler(req, res) {
  const client = getAdminClient();
  if (!client) {
    res.status(500).json({ error: "Supabase service role is not configured." });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  if (!verifyServerToken(req)) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }

  try {
    await ensureBucket(client);
    await repairStaleJobs(client);

    const serverId = String(req.body?.serverId || "desktop-server").trim();
    const workerReady = Boolean(req.body?.workerReady);
    const activeJobId = String(req.body?.activeJobId || "").trim();

    await updateServerStatus(client, {
      serverId,
      workerReady,
      activeJobId: activeJobId || "",
      platform: req.body?.platform || "",
      machine: req.body?.machine || {},
    });

    if (activeJobId) {
      res.status(200).json({ job: null });
      return;
    }

    const index = await readJobIndex(client);
    const jobs = index.entries;
    const processingFingerprints = new Set(
      jobs
        .filter((job) => job.status === "processing")
        .map((job) => String(job.fingerprint || ""))
        .filter(Boolean)
    );
    const candidateJobs = jobs
      .filter((job) => {
        if (job.status !== "queued") return false;
        const fingerprint = String(job.fingerprint || "");
        if (!fingerprint) return true;
        return !processingFingerprints.has(fingerprint);
      })
      .sort((a, b) => {
        const score = (job) => {
          const requestMode = String(job.request?.requestMode || "").trim().toLowerCase();
          const selectionMode = String(job.request?.selectionMode || "").trim().toLowerCase();
          let priority = requestMode === "all" ? 50 : 0;
          if (selectionMode === "employees") priority -= 5;
          return priority;
        };
        const diff = score(a) - score(b);
        if (diff !== 0) return diff;
        return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
      });

    const nextJob = candidateJobs[0];

    if (!nextJob) {
      res.status(200).json({ job: null });
      return;
    }

    const freshJob = (await downloadJson(client, getJobPath(nextJob.jobId))) || nextJob;
    if (freshJob.status !== "queued") {
      res.status(200).json({ job: null });
      return;
    }

    const processingJob = {
      ...freshJob,
      status: "processing",
      updatedAt: new Date().toISOString(),
      processingStartedAt: new Date().toISOString(),
      serverId,
    };
    await uploadJson(client, getJobPath(processingJob.jobId), processingJob);
    await upsertJobIndexEntry(client, processingJob);

    res.status(200).json({
      job: {
        jobId: processingJob.jobId,
        sessionId: processingJob.sessionId,
        ...processingJob.request,
        requestMode: processingJob.request?.requestMode || "selected",
        fullCompany: processingJob.request?.requestMode === "all",
        outputMode: "pdf",
      },
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Report job poll failed." });
  }
}
