import { randomUUID } from "node:crypto";
import {
  ensureBucket,
  getAdminClient,
  getJobPath,
  normalizeJobRequest,
  upsertJobIndexEntry,
  uploadJson,
  downloadJson,
} from "./_report-bridge.js";

export default async function handler(req, res) {
  const client = getAdminClient();
  if (!client) {
    res.status(500).json({ error: "Supabase service role is not configured." });
    return;
  }

  try {
    await ensureBucket(client);

    if (req.method === "POST") {
      const request = normalizeJobRequest(req.body);
      if (!request) {
        res.status(400).json({ error: "Invalid report request." });
        return;
      }

      const jobId = randomUUID();
      const timestamp = new Date().toISOString();
      const job = {
        jobId,
        sessionId: request.sessionId,
        status: "queued",
        createdAt: timestamp,
        updatedAt: timestamp,
        request,
      };

      await uploadJson(client, getJobPath(jobId), job);
      await upsertJobIndexEntry(client, job);
      res.setHeader("Cache-Control", "no-store, max-age=0");
      res.status(200).json({ success: true, jobId, status: "queued" });
      return;
    }

    if (req.method === "GET") {
      const jobId = String(req.query.jobId || "").trim();
      const sessionId = String(req.query.sessionId || "").trim();
      if (!jobId || !sessionId) {
        res.status(400).json({ error: "jobId and sessionId are required." });
        return;
      }

      const job = await downloadJson(client, getJobPath(jobId));
      if (!job || String(job.sessionId || "") !== sessionId) {
        res.status(404).json({ error: "Report job not found." });
        return;
      }

      res.setHeader("Cache-Control", "no-store, max-age=0");
      res.status(200).json({ job });
      return;
    }

    res.status(405).json({ error: "Method not allowed." });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Report job request failed." });
  }
}
