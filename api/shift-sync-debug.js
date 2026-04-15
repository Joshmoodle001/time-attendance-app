export default async function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/shift_sync_settings?id=eq.global&select=*`, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });
    
    const data = await response.text();
    res.status(200).json({ 
      success: response.ok, 
      status: response.status,
      url: supabaseUrl,
      hasKey: !!supabaseKey,
      data: data,
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : "Unknown error",
      url: supabaseUrl,
      hasKey: !!supabaseKey,
    });
  }
}