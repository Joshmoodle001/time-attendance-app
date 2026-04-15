export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ 
      error: "Supabase not configured",
      hasUrl: Boolean(SUPABASE_URL),
      hasKey: Boolean(SUPABASE_SERVICE_KEY)
    });
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/shift_sync_settings?id=eq.global&select=*`, {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
    });

    const data = await response.json();
    
    return res.status(200).json({
      status: response.status,
      data,
      downloadUrl: data?.[0]?.payload?.sections?.[0]?.url ? 
        `https://docs.google.com/spreadsheets/d/${data[0].payload.sections[0].url.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1]}/export?format=xlsx` : 
        null
    });
  } catch (error) {
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : "Unknown error" 
    });
  }
}
