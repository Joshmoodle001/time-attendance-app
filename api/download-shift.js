function normalizeUrl(value) {
  return String(value || "").trim();
}

function buildGoogleDownloadUrl(input) {
  const clean = normalizeUrl(input);
  if (!clean) return "";

  const spreadsheetId = clean.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1];
  if (spreadsheetId) {
    const gid = clean.match(/[?&]gid=(\d+)/)?.[1];
    return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx${gid ? `&gid=${gid}` : ""}`;
  }

  const driveFileId =
    clean.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9-_]+)/)?.[1] ||
    clean.match(/[?&]id=([a-zA-Z0-9-_]+)/)?.[1];
  if (driveFileId) {
    return `https://drive.google.com/uc?export=download&id=${driveFileId}`;
  }

  return clean;
}

function isAllowedGoogleHost(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "docs.google.com" || parsed.hostname === "drive.google.com";
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const sourceUrl = normalizeUrl(req.query.url);
  if (!sourceUrl) {
    res.status(400).json({ error: "Missing url parameter" });
    return;
  }

  if (!isAllowedGoogleHost(sourceUrl)) {
    res.status(400).json({ error: "Only docs.google.com and drive.google.com links are allowed" });
    return;
  }

  const downloadUrl = buildGoogleDownloadUrl(sourceUrl);

  try {
    const response = await fetch(downloadUrl, {
      redirect: "follow",
      headers: {
        "User-Agent": "time-attendance-app-shift-sync",
      },
    });

    if (!response.ok) {
      res.status(response.status).json({ error: `Google download failed with status ${response.status}` });
      return;
    }

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Length", buffer.length);
    res.status(200).send(buffer);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to download Google document",
    });
  }
}
