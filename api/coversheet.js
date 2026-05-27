import { createClient } from "@supabase/supabase-js";

const BUCKET_NAME = "shared-app-state";
const OBJECT_PATH = "coversheet/latest.json";

function getSupabaseConfig() {
  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return {
    url,
    serviceRoleKey,
    configured: Boolean(url && serviceRoleKey),
  };
}

function getAdminClient() {
  const config = getSupabaseConfig();
  if (!config.configured) return null;
  return createClient(config.url, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function ensureBucket(client) {
  const { data: buckets, error: listError } = await client.storage.listBuckets();
  if (listError) throw listError;
  const exists = (buckets || []).some((bucket) => bucket.name === BUCKET_NAME);
  if (exists) return;

  const { error: createError } = await client.storage.createBucket(BUCKET_NAME, {
    public: false,
    fileSizeLimit: "20MB",
  });
  if (createError && !String(createError.message || "").toLowerCase().includes("already exists")) {
    throw createError;
  }
}

function normalizePayload(body) {
  if (!body || typeof body !== "object") return null;
  const fileName = String(body.fileName || "").trim();
  const uploadedAt = String(body.uploadedAt || "").trim();
  const stores = Array.isArray(body.stores) ? body.stores : [];
  if (!fileName || !uploadedAt || !Array.isArray(stores)) return null;
  return { fileName, uploadedAt, stores };
}

export default async function handler(req, res) {
  const client = getAdminClient();
  if (!client) {
    res.status(200).json({ upload: null, shared: false, error: "Supabase service role is not configured." });
    return;
  }

  try {
    await ensureBucket(client);

    if (req.method === "GET") {
      const { data, error } = await client.storage.from(BUCKET_NAME).download(OBJECT_PATH);
      if (error) {
        const missing = String(error.message || "").toLowerCase().includes("not found");
        if (missing) {
          res.status(200).json({ upload: null, shared: true });
          return;
        }
        throw error;
      }

      const text = await data.text();
      const upload = normalizePayload(JSON.parse(text));
      res.status(200).json({ upload, shared: true });
      return;
    }

    if (req.method === "POST") {
      const payload = normalizePayload(req.body);
      if (!payload) {
        res.status(400).json({ error: "Invalid coversheet payload." });
        return;
      }

      const content = JSON.stringify(payload);
      const { error } = await client.storage.from(BUCKET_NAME).upload(OBJECT_PATH, content, {
        contentType: "application/json",
        upsert: true,
      });

      if (error) throw error;

      res.status(200).json({ success: true, shared: true });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Coversheet sync failed.",
    });
  }
}
