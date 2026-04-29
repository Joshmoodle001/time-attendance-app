const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";

const RESET_TABLES = [
  { table: "attendance_records", column: "id" },
  { table: "attendance_upload_sessions", column: "id" },
  { table: "employee_status_history", column: "id" },
  { table: "employees", column: "employee_code" },
  { table: "biometric_clock_events", column: "id" },
  { table: "employee_update_upload_logs", column: "id" },
  { table: "leave_applications", column: "id" },
  { table: "leave_upload_batches", column: "id" },
  { table: "shift_roster_change_events", column: "id" },
  { table: "shift_roster_history", column: "id" },
  { table: "shift_rosters", column: "id" },
  { table: "store_assignments", column: "username" },
  { table: "ipulse_sync_logs", column: "id" },
  { table: "ipulse_config", column: "id" },
];

function createHeaders() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase service role environment variables are missing.")
  }

  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };
}

async function deleteTableRows(table, column) {
  const headers = createHeaders();
  const url = `${SUPABASE_URL}/rest/v1/${table}?${encodeURIComponent(column)}=not.is.null`;
  const response = await fetch(url, {
    method: "DELETE",
    headers,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Failed to clear ${table}`)
  }

  return true;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ success: false, message: "Method not allowed." });
    return;
  }

  try {
    const results = [];
    for (const target of RESET_TABLES) {
      await deleteTableRows(target.table, target.column);
      results.push(target.table);
    }

    res.status(200).json({
      success: true,
      clearedTables: results,
      preserved: ["calendar", "devices", "auth_users"],
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Reset failed.",
    });
  }
}
