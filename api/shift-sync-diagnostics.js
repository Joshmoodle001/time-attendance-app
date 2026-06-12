import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function cleanUrl(value) {
  return text(value).replace(/^['\"]+|['\"]+$/g, "").replace(/\/+$/g, "");
}

function pickEnv(...values) {
  for (const value of values) {
    if (text(value)) return text(value);
  }
  return "";
}

function toErrorObject(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  if (error && typeof error === "object") {
    try {
      return JSON.parse(JSON.stringify(error));
    } catch {
      return { message: String(error) };
    }
  }
  return { message: String(error) };
}

function getConfig() {
  const url = cleanUrl(
    pickEnv(
      process.env.VITE_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_URL,
    ),
  );
  const anonKey = pickEnv(
    process.env.VITE_SUPABASE_ANON_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    process.env.SUPABASE_ANON_KEY,
  );
  const serviceRoleKey = pickEnv(
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_SERVICE_KEY,
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
    process.env.VITE_SUPABASE_SERVICE_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY,
  );
  return {
    url,
    anonKey,
    serviceRoleKey,
  };
}

export default async function handler(req, res) {
  const config = getConfig();
  const diagnostics = {
    method: req.method,
    node: process.version,
    xlsxVersion: XLSX.version,
    hasSupabaseUrl: Boolean(config.url),
    supabaseHost: config.url ? new URL(config.url).host : "",
    hasAnonKey: Boolean(config.anonKey),
    hasServiceRoleKey: Boolean(config.serviceRoleKey),
  };

  try {
    if (!config.url || (!config.serviceRoleKey && !config.anonKey)) {
      res.status(200).json({
        ok: false,
        diagnostics,
        error: "Supabase configuration is incomplete.",
      });
      return;
    }

    const key = config.serviceRoleKey || config.anonKey;
    const client = createClient(config.url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const settingsResult = await client
      .from("shift_sync_settings")
      .select("*")
      .eq("id", "global")
      .maybeSingle();

    const storageResult = await client.storage.listBuckets();

    res.status(200).json({
      ok: true,
      diagnostics,
      settingsResult: {
        data: settingsResult.data,
        error: settingsResult.error ? toErrorObject(settingsResult.error) : null,
      },
      storageResult: {
        bucketCount: Array.isArray(storageResult.data) ? storageResult.data.length : null,
        error: storageResult.error ? toErrorObject(storageResult.error) : null,
      },
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      diagnostics,
      error: toErrorObject(error),
    });
  }
}
