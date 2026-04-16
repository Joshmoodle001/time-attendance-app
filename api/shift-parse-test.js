import { downloadGoogleWorkbook, parseShiftWorkbook } from "./_shift-sync-utils.js";

export default async function handler(req, res) {
  const url = req.query.url;
  if (!url) {
    res.status(400).json({ error: "Missing url parameter" });
    return;
  }

  try {
    const buffer = await downloadGoogleWorkbook(url);
    if (!buffer || buffer.byteLength === 0) {
      res.status(200).json({ error: "Empty download", byteLength: 0 });
      return;
    }

    const imported = parseShiftWorkbook(buffer, "test.xlsx");
    
    res.status(200).json({
      byteLength: buffer.byteLength,
      sheetCount: imported.length,
      sheets: imported.map((r) => ({
        sheet_name: r.sheet_name,
        store_name: r.store_name,
        rowCount: r.rows?.length || 0,
        firstRow: r.rows?.[0] || null,
      })),
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
