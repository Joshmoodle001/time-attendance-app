import { downloadGoogleWorkbook, parseShiftWorkbook } from "./_shift-sync-utils.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const url = req.query.url;
  if (!url) {
    res.status(400).json({ error: "Missing url parameter" });
    return;
  }

  try {
    let buffer;
    try {
      buffer = await downloadGoogleWorkbook(url);
    } catch (downloadError) {
      res.status(200).json({
        phase: "download",
        error: downloadError instanceof Error ? downloadError.message : "Download failed",
      });
      return;
    }

    if (!buffer || buffer.byteLength === 0) {
      res.status(200).json({ phase: "download", error: "Empty download", byteLength: 0 });
      return;
    }

    let imported;
    try {
      imported = parseShiftWorkbook(buffer, "test.xlsx");
    } catch (parseError) {
      res.status(200).json({
        phase: "parse",
        byteLength: buffer.byteLength,
        error: parseError instanceof Error ? parseError.message : "Parse failed",
      });
      return;
    }

    const sheets = imported.map((r) => ({
      sheet_name: r.sheet_name,
      store_name: r.store_name,
      rowCount: r.rows?.length || 0,
      firstRow: r.rows?.[0]
        ? {
            name: r.rows[0].employee_name,
            code: r.rows[0].employee_code,
            dept: r.rows[0].department,
            hr: r.rows[0].hr,
            time: r.rows[0].time_label,
            mon: r.rows[0].monday,
          }
        : null,
    }));

    res.status(200).json({
      phase: "success",
      byteLength: buffer.byteLength,
      sheetCount: imported.length,
      totalRows: imported.reduce((sum, r) => sum + (r.rows?.length || 0), 0),
      sheets,
    });
  } catch (error) {
    res.status(500).json({
      phase: "unknown",
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack?.split("\n").slice(0, 5) : undefined,
    });
  }
}
