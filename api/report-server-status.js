import { ensureBucket, getAdminClient, getServerStatus } from "./_report-bridge.js";

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

  try {
    await ensureBucket(client);
    const status = await getServerStatus(client);
    res.status(200).json(status);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Server status lookup failed." });
  }
}
