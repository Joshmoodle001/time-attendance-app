import { assignWorkerRole, ensureBucket, getAdminClient, verifyServerToken } from "../_report-bridge.js";

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

    const workerId = String(req.body?.workerId || "").trim();
    const role = String(req.body?.role || "secondary").trim().toLowerCase();

    if (!workerId) {
      res.status(400).json({ error: "workerId is required." });
      return;
    }

    if (role !== "primary" && role !== "secondary") {
      res.status(400).json({ error: "Role must be primary or secondary." });
      return;
    }

    const updated = await assignWorkerRole(client, { workerId, role });

    if (!updated) {
      res.status(404).json({ error: "Worker not found." });
      return;
    }

    res.status(200).json({
      workerId: updated.workerId,
      hostname: updated.hostname,
      role: updated.role,
      assignedAt: updated.assignedAt,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "vCell assign failed." });
  }
}
