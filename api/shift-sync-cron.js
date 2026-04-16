import { runUniversalShiftSync } from "./_shift-sync-utils.js";

function isValidCronRequest(req) {
  const cronSecret = process.env.CRON_SECRET || process.env.SHIFT_SYNC_CRON_TOKEN;
  
  if (cronSecret) {
    const authHeader = req.headers?.authorization || req.headers?.Authorization || "";
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return false;
    }
    const token = authHeader.replace("Bearer ", "");
    if (token !== cronSecret) {
      return false;
    }
    return true;
  }

  const userAgent = req.headers?.["user-agent"] || "";
  if (userAgent.includes("vercel-cron") || req.headers?.["x-vercel-cron"]) {
    return true;
  }

  return false;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (!isValidCronRequest(req)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const result = await runUniversalShiftSync("scheduled");

    if (result.skipped) {
      return res.status(200).json({
        success: true,
        skipped: true,
        message: result.message,
      });
    }

    if (result.success) {
      return res.status(200).json({
        success: true,
        successCount: result.successCount,
        failureCount: result.failureCount,
        totalRows: result.totalRows,
        message: result.message,
      });
    }

    return res.status(500).json({
      success: false,
      error: result.error,
      message: result.message,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Shift sync cron error:", errorMessage);
    return res.status(500).json({
      success: false,
      error: errorMessage,
      message: `Cron job failed: ${errorMessage}`,
    });
  }
}