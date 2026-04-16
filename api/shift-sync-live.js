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
  try {
    const body = parseBody(req.body);
    const providedKey = String(req.query?.key || req.headers?.["x-shift-live-key"] || body.key || "").trim();
    const requestedSectionIds = Array.isArray(body.sectionIds)
      ? body.sectionIds
      : req.query?.sectionId
        ? [req.query.sectionId]
        : body.sectionId
          ? [body.sectionId]
          : [];

    const settings = await loadRemoteShiftSyncSettings();
    if (!settings.liveWebhookKey || providedKey !== settings.liveWebhookKey) {
      res.status(401).json({
        success: false,
        error: "Unauthorized live shift sync request.",
      });
      return;
    }

    const result = await runUniversalShiftSync("live", { sectionIds: requestedSectionIds });
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Live shift sync failed.",
    });
  }
}
