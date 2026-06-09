import {
  assignWorkerRole,
  ensureBucket,
  getAdminClient,
  readWorkerRegistry,
  registerWorker,
  verifyServerToken,
} from "./_report-bridge.js";

export default async function handler(req, res) {
  const client = getAdminClient();
  if (!client) {
    res.status(500).json({ error: "Supabase service role is not configured." });
    return;
  }

  if (!verifyServerToken(req)) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }

  const action = String(req.body?.action || req.query?.action || "").trim();

  try {
    await ensureBucket(client);

    if (req.method === "POST" && action === "hello") {
      const hostname = String(req.body?.hostname || "unknown").trim();
      const entry = await registerWorker(client, {
        hostname,
        platform: String(req.body?.platform || "").trim(),
        machine: req.body?.machine || {},
      });
      return res.status(200).json({
        workerId: entry.workerId,
        hostname: entry.hostname,
        role: entry.role,
        registeredAt: entry.registeredAt,
      });
    }

    if (req.method === "POST" && action === "assign") {
      const workerId = String(req.body?.workerId || "").trim();
      const role = String(req.body?.role || "secondary").trim().toLowerCase();

      if (!workerId) {
        return res.status(400).json({ error: "workerId is required." });
      }
      if (role !== "primary" && role !== "secondary") {
        return res.status(400).json({ error: "Role must be primary or secondary." });
      }

      const updated = await assignWorkerRole(client, { workerId, role });
      if (!updated) {
        return res.status(404).json({ error: "Worker not found." });
      }
      return res.status(200).json({
        workerId: updated.workerId,
        hostname: updated.hostname,
        role: updated.role,
        assignedAt: updated.assignedAt,
      });
    }

    if (req.method === "GET" || (req.method === "POST" && action === "workers")) {
      const registry = await readWorkerRegistry(client);
      const workers = Object.values(registry.workers || {});
      return res.status(200).json({ workers });
    }

    res.status(400).json({ error: "Unknown vCell action. Use action=hello, action=assign, or action=workers." });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "vCell request failed." });
  }
}
