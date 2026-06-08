import {
  buildJobRequestFingerprint,
  downloadJson,
  ensureBucket,
  getAdminClient,
  getJobPath,
  readJobIndex,
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

    const jobId = String(req.body?.jobId || "").trim();
    if (!jobId) {
      res.status(400).json({ error: "jobId is required." });
      return;
    }

    const job = await downloadJson(client, getJobPath(jobId));
    if (!job) {
      res.status(404).json({ error: "Report job not found." });
      return;
    }

    const success = Boolean(req.body?.success);

    // Build result payload — guard against null/empty reportPayload
    let resultPayload = null;
    if (success) {
      if (req.body?.result) {
        resultPayload = req.body.result;
      } else if (req.body?.reportPayload) {
        resultPayload = { reportPayload: req.body.reportPayload };
      }
    }

    const nextJob = {
      ...job,
      status: success ? "complete" : "failed",
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      error: success ? "" : String(req.body?.error || "Report generation failed."),
      result: resultPayload,
    };

    await uploadJson(client, getJobPath(jobId), nextJob);
    await upsertJobIndexEntry(client, nextJob);

    if (success && resultPayload) {
      const completedFingerprint = buildJobRequestFingerprint(job.request || {});
      if (completedFingerprint) {
        const index = await readJobIndex(client);
        const duplicateQueuedJobs = index.entries.filter((candidate) => {
          if (!candidate || candidate.jobId === jobId) return false;
          if (candidate.status !== "queued") return false;
          return String(candidate.fingerprint || "") === completedFingerprint;
        });

        for (const duplicateJob of duplicateQueuedJobs) {
          const originalQueuedJob = await downloadJson(client, getJobPath(duplicateJob.jobId));
          if (!originalQueuedJob) continue;
          const duplicateCompletedJob = {
            ...originalQueuedJob,
            status: "complete",
            updatedAt: nextJob.updatedAt,
            completedAt: nextJob.completedAt,
            error: "",
            result: resultPayload,
          };
          await uploadJson(client, getJobPath(duplicateJob.jobId), duplicateCompletedJob);
          await upsertJobIndexEntry(client, duplicateCompletedJob);
        }
      }
    }

    await updateServerStatus(client, {
      serverId: String(req.body?.serverId || job.serverId || "desktop-server"),
      workerReady: true,
      activeJobId: "",
      lastCompletedJobId: jobId,
      lastCompletedAt: nextJob.completedAt,
      lastError: nextJob.error || "",
    });

    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Report completion update failed." });
  }
}
