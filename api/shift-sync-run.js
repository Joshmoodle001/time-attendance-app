import { loadRemoteShiftSyncSettings, runUniversalShiftSync } from "./_shift-sync-utils.js";

function parseBody(body) {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  if (typeof body === "object") return body;
  return {};
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    try {
      const settings = await loadRemoteShiftSyncSettings();
      res.status(200).json({ success: true, settings });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Could not load shift sync settings.",
      });
    }
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = parseBody(req.body);
    const sectionIds = Array.isArray(body.sectionIds)
      ? body.sectionIds
      : body.sectionId
        ? [body.sectionId]
        : [];
    const result = await runUniversalShiftSync("manual", { sectionIds });
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Manual universal shift sync failed.",
    });
  }
}
