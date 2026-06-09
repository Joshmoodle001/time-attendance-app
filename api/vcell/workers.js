import { ensureBucket, getAdminClient, readWorkerRegistry, verifyServerToken } from "../_report-bridge.js";

export default async function handler(req, res) {
  const client = getAdminClient();
  if (!client) {
    res.status(500).json({ error: "Supabase service role is not configured." });
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  if (!verifyServerToken(req)) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }

  try {
    await ensureBucket(client);
    const registry = await readWorkerRegistry(client);
    const workers = Object.values(registry.workers || {});

    res.status(200).json({ workers });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "vCell workers lookup failed." });
  }
}
