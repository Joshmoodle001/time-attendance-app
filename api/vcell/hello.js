import { ensureBucket, getAdminClient, readWorkerRegistry, registerWorker, verifyServerToken } from "../_report-bridge.js";

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

    const hostname = String(req.body?.hostname || "unknown").trim();
    const platform = String(req.body?.platform || "").trim();
    const machine = req.body?.machine || {};

    const entry = await registerWorker(client, { hostname, platform, machine });

    res.status(200).json({
      workerId: entry.workerId,
      hostname: entry.hostname,
      role: entry.role,
      registeredAt: entry.registeredAt,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "vCell hello failed." });
  }
}
