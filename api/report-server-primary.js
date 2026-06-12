import {
  applyCors,
  ensureBucket,
  getAdminClient,
  getAllServerStatuses,
  readPrimaryServerPreference,
  selectDispatchServer,
  verifyServerToken,
  writePrimaryServerPreference,
} from "./_report-bridge.js";

export default async function handler(req, res) {
  applyCors(req, res, "GET,POST,OPTIONS");

  const client = getAdminClient();
  if (!client) {
    res.status(500).json({ error: "Supabase service role is not configured." });
    return;
  }

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  try {
    await ensureBucket(client);

    if (req.method === "GET") {
      const servers = await getAllServerStatuses(client);
      const preference = await readPrimaryServerPreference(client);
      const dispatch = selectDispatchServer(servers, preference?.serverId || "");
      res.status(200).json({
        primaryServerId: preference?.serverId || "",
        primaryServerLabel: preference?.machineLabel || "",
        dispatchServerId: dispatch.server?.serverId || "",
        dispatchServerLabel: dispatch.server?.machineLabel || "",
        dispatchMode: dispatch.mode,
        servers,
      });
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

    const serverId = String(req.body?.serverId || "").trim();
    if (!serverId) {
      res.status(400).json({ error: "serverId is required." });
      return;
    }

    const preference = await writePrimaryServerPreference(client, {
      serverId,
      machineId: String(req.body?.machineId || "").trim(),
      machineLabel: String(req.body?.machineLabel || req.body?.hostname || serverId).trim(),
    });
    const servers = await getAllServerStatuses(client);
    const dispatch = selectDispatchServer(servers, preference.serverId || "");

    res.status(200).json({
      success: true,
      primaryServerId: preference.serverId,
      primaryServerLabel: preference.machineLabel,
      dispatchServerId: dispatch.server?.serverId || "",
      dispatchServerLabel: dispatch.server?.machineLabel || "",
      dispatchMode: dispatch.mode,
      servers,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Primary server update failed." });
  }
}
