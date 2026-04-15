import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export const SHIFT_SYNC_STORAGE_KEY = "shift-sync-settings-v2";
export const SHIFT_SYNC_UPDATED_EVENT = "shift-sync-settings-updated";
const LEGACY_SHIFT_SYNC_STORAGE_KEY = "shift-sync-sections-v1";
const REMOVED_DEFAULT_IDS = new Set(["checkers-local", "checkers-country", "shoprite-local", "shoprite-country"]);

const SHIFT_SYNC_REMOTE_SETUP_HINT =
  "Background auto sync needs the remote shift sync table to be set up first. The links are still being stored in this browser for now.";

export type ShiftSyncSection = {
  id: string;
  label: string;
  url: string;
  lastSyncedAt: string;
  lastStatus: string;
};

export type ShiftSyncSettings = {
  autoSyncEnabled: boolean;
  backupIntervalMinutes: number;
  scheduledRunTimes: string[];
  lastUniversalSyncedAt: string;
  lastUniversalStatus: string;
  liveSyncEnabled: boolean;
  lastLiveSyncedAt: string;
  lastLiveStatus: string;
  liveWebhookKey: string;
  sections: ShiftSyncSection[];
};

export const DEFAULT_SHIFT_SYNC_SECTIONS: ShiftSyncSection[] = [];

export const DEFAULT_SHIFT_SYNC_SETTINGS: ShiftSyncSettings = {
  autoSyncEnabled: false,
  backupIntervalMinutes: 60,
  scheduledRunTimes: [],
  lastUniversalSyncedAt: "",
  lastUniversalStatus: "Hourly background sync is off.",
  liveSyncEnabled: false,
  lastLiveSyncedAt: "",
  lastLiveStatus: "Live sheet listening is off until a live Google Sheet link is connected.",
  liveWebhookKey: "",
  sections: DEFAULT_SHIFT_SYNC_SECTIONS,
};

export function hasConfiguredShiftSyncLinks(settings?: Pick<ShiftSyncSettings, "sections"> | null) {
  return Boolean(settings?.sections?.some((section) => normalizeText(section.url)));
}

function createLiveWebhookKey() {
  return `shift_live_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function normalizeText(value: unknown) {
  return value === null || value === undefined ? "" : String(value).replace(/\s+/g, " ").trim();
}

function pickPreferredText(...values: unknown[]) {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) return normalized;
  }
  return "";
}

function mergeSections(...sectionSets: Array<ShiftSyncSection[] | undefined>) {
  const parsedMap = new Map<string, ShiftSyncSection>();
  sectionSets
    .filter(Array.isArray)
    .forEach((sectionSet) => {
      sectionSet?.forEach((item) => {
        parsedMap.set(item.id, {
          ...(parsedMap.get(item.id) || {}),
          ...item,
        });
      });
    });

  const mergedDefaults = DEFAULT_SHIFT_SYNC_SECTIONS.map((section) => {
    const combined = parsedMap.get(section.id);
    parsedMap.delete(section.id);
    return {
      ...section,
      ...(combined || {}),
      id: section.id,
      label: section.label,
      url: pickPreferredText(combined?.url, section.url),
      lastSyncedAt: pickPreferredText(combined?.lastSyncedAt, section.lastSyncedAt),
      lastStatus: pickPreferredText(combined?.lastStatus, section.lastStatus),
    };
  });

  const customSections = Array.from(parsedMap.values())
    .filter((section) => section.id && !REMOVED_DEFAULT_IDS.has(section.id))
    .map((section) => ({
      id: section.id!,
      label: pickPreferredText(section.label, section.id),
      url: pickPreferredText(section.url),
      lastSyncedAt: pickPreferredText(section.lastSyncedAt),
      lastStatus: pickPreferredText(section.lastStatus, "Waiting for a Google document link."),
    }));

  return [...mergedDefaults, ...customSections];
}

function normalizeSettings(value: unknown): ShiftSyncSettings {
  const raw = typeof value === "object" && value !== null ? (value as Partial<ShiftSyncSettings>) : {};
  const legacySections = Array.isArray(value) ? (value as ShiftSyncSection[]) : undefined;
  return {
    autoSyncEnabled: Boolean(raw.autoSyncEnabled),
    backupIntervalMinutes: Number(raw.backupIntervalMinutes || 60),
    scheduledRunTimes: Array.isArray(raw.scheduledRunTimes)
      ? raw.scheduledRunTimes
          .map((item) => normalizeText(item))
          .filter((item) => /^\d{2}:\d{2}$/.test(item))
      : [],
    lastUniversalSyncedAt: normalizeText(raw.lastUniversalSyncedAt),
    lastUniversalStatus: normalizeText(raw.lastUniversalStatus) || DEFAULT_SHIFT_SYNC_SETTINGS.lastUniversalStatus,
    liveSyncEnabled: raw.liveSyncEnabled === undefined ? DEFAULT_SHIFT_SYNC_SETTINGS.liveSyncEnabled : Boolean(raw.liveSyncEnabled),
    lastLiveSyncedAt: normalizeText(raw.lastLiveSyncedAt),
    lastLiveStatus: normalizeText(raw.lastLiveStatus) || DEFAULT_SHIFT_SYNC_SETTINGS.lastLiveStatus,
    liveWebhookKey: normalizeText(raw.liveWebhookKey) || createLiveWebhookKey(),
    sections: (mergeSections(raw.sections || legacySections)).filter((s) => !REMOVED_DEFAULT_IDS.has(s.id)),
  };
}

function loadLocalShiftSyncSettings() {
  if (typeof window === "undefined") return DEFAULT_SHIFT_SYNC_SETTINGS;

  try {
    const raw = window.localStorage.getItem(SHIFT_SYNC_STORAGE_KEY);
    if (raw) return normalizeSettings(JSON.parse(raw));

    const legacyRaw = window.localStorage.getItem(LEGACY_SHIFT_SYNC_STORAGE_KEY);
    if (legacyRaw) {
      return normalizeSettings({
        sections: JSON.parse(legacyRaw),
      });
    }

    return DEFAULT_SHIFT_SYNC_SETTINGS;
  } catch (error) {
    console.error("Could not load shift sync settings:", error);
    return DEFAULT_SHIFT_SYNC_SETTINGS;
  }
}

function saveLocalShiftSyncSettings(settings: ShiftSyncSettings) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(SHIFT_SYNC_STORAGE_KEY, JSON.stringify(normalizeSettings(settings)));
    window.localStorage.removeItem(LEGACY_SHIFT_SYNC_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(SHIFT_SYNC_UPDATED_EVENT, { detail: normalizeSettings(settings) }));
  } catch (error) {
    console.error("Could not save shift sync settings:", error);
  }
}

function getShiftSyncStorageErrorMessage(error: unknown) {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message || "")
      : error instanceof Error
        ? error.message
        : String(error || "");

  if (message.includes("Could not find the table 'public.shift_sync_settings' in the schema cache")) {
    return SHIFT_SYNC_REMOTE_SETUP_HINT;
  }

  if (message.includes('relation "public.shift_sync_settings" does not exist') || message.includes('relation "shift_sync_settings" does not exist')) {
    return SHIFT_SYNC_REMOTE_SETUP_HINT;
  }

  return message;
}

export async function loadShiftSyncSettings() {
  const localSettings = loadLocalShiftSyncSettings();

  if (!isSupabaseConfigured) {
    return localSettings;
  }

  try {
    const { data, error } = await supabase
      .from("shift_sync_settings")
      .select("*")
      .eq("id", "global")
      .maybeSingle();

    if (error) {
      console.warn("Load shift sync settings warning:", getShiftSyncStorageErrorMessage(error));
      return localSettings;
    }

    if (!data) {
      return localSettings;
    }

    const remoteSettings = normalizeSettings({
      autoSyncEnabled: data.auto_sync_enabled,
      backupIntervalMinutes: data.payload?.backupIntervalMinutes,
      scheduledRunTimes: data.payload?.scheduledRunTimes,
      lastUniversalSyncedAt: data.last_universal_synced_at,
      lastUniversalStatus: data.last_universal_status,
      liveSyncEnabled: data.payload?.liveSyncEnabled,
      lastLiveSyncedAt: data.payload?.lastLiveSyncedAt,
      lastLiveStatus: data.payload?.lastLiveStatus,
      liveWebhookKey: data.payload?.liveWebhookKey,
      sections: data.payload?.sections,
    });

    const mergedSettings = normalizeSettings({
      autoSyncEnabled: remoteSettings.autoSyncEnabled || localSettings.autoSyncEnabled,
      backupIntervalMinutes: remoteSettings.backupIntervalMinutes || localSettings.backupIntervalMinutes,
      scheduledRunTimes:
        remoteSettings.scheduledRunTimes.length > 0
          ? remoteSettings.scheduledRunTimes
          : localSettings.scheduledRunTimes,
      lastUniversalSyncedAt: pickPreferredText(remoteSettings.lastUniversalSyncedAt, localSettings.lastUniversalSyncedAt),
      lastUniversalStatus: pickPreferredText(remoteSettings.lastUniversalStatus, localSettings.lastUniversalStatus),
      liveSyncEnabled: remoteSettings.liveSyncEnabled ?? localSettings.liveSyncEnabled,
      lastLiveSyncedAt: pickPreferredText(remoteSettings.lastLiveSyncedAt, localSettings.lastLiveSyncedAt),
      lastLiveStatus: pickPreferredText(remoteSettings.lastLiveStatus, localSettings.lastLiveStatus),
      liveWebhookKey: pickPreferredText(remoteSettings.liveWebhookKey, localSettings.liveWebhookKey),
      sections: (() => {
        const localIds = new Set(localSettings.sections.map((s) => s.id));
        const remoteIds = new Set(remoteSettings.sections.map((s) => s.id));
        const allIds = new Set([...localIds, ...remoteIds]);
        return Array.from(allIds)
          .filter((id) => !REMOVED_DEFAULT_IDS.has(id))
          .map((id) => {
            const localSection = localSettings.sections.find((item) => item.id === id);
            const remoteSection = remoteSettings.sections.find((item) => item.id === id);
            return {
              id: id,
              label: pickPreferredText(remoteSection?.label, localSection?.label, id),
              url: pickPreferredText(remoteSection?.url, localSection?.url),
              lastSyncedAt: pickPreferredText(remoteSection?.lastSyncedAt, localSection?.lastSyncedAt),
              lastStatus: pickPreferredText(remoteSection?.lastStatus, localSection?.lastStatus, "Waiting for a Google document link."),
            };
          });
      })(),
    });

    saveLocalShiftSyncSettings(mergedSettings);
    return mergedSettings;
  } catch (error) {
    console.warn("Load shift sync settings warning:", getShiftSyncStorageErrorMessage(error));
    return localSettings;
  }
}

export async function saveShiftSyncSettings(settings: ShiftSyncSettings) {
  const normalized = normalizeSettings(settings);
  saveLocalShiftSyncSettings(normalized);

  if (!isSupabaseConfigured) {
    return { success: true };
  }

  try {
    const { error } = await supabase.from("shift_sync_settings").upsert(
      {
        id: "global",
        auto_sync_enabled: normalized.autoSyncEnabled,
        last_universal_synced_at: normalized.lastUniversalSyncedAt || null,
        last_universal_status: normalized.lastUniversalStatus,
        payload: {
          backupIntervalMinutes: normalized.backupIntervalMinutes,
          scheduledRunTimes: normalized.scheduledRunTimes,
          liveSyncEnabled: normalized.liveSyncEnabled,
          lastLiveSyncedAt: normalized.lastLiveSyncedAt || null,
          lastLiveStatus: normalized.lastLiveStatus,
          liveWebhookKey: normalized.liveWebhookKey,
          sections: normalized.sections,
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );

    if (error) {
      const message = getShiftSyncStorageErrorMessage(error);
      console.warn("Save shift sync settings warning:", message);
      return { success: true, error: message };
    }

    return { success: true };
  } catch (error) {
    const message = getShiftSyncStorageErrorMessage(error);
    console.warn("Save shift sync settings warning:", message);
    return { success: true, error: message };
  }
}

export function createShiftSyncSectionId(label: string) {
  const normalized = normalizeText(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || `sheet-${Date.now().toString(36)}`;
}

export function buildShiftDownloadUrl(url: string) {
  const clean = normalizeText(url);
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

export function buildShiftLiveWebhookUrl(baseUrl: string, liveWebhookKey: string, sectionId?: string) {
  const cleanBase = normalizeText(baseUrl).replace(/\/+$/g, "");
  const cleanKey = normalizeText(liveWebhookKey);
  if (!cleanBase || !cleanKey) return "";
  const params = new URLSearchParams({ key: cleanKey });
  if (sectionId) params.set("sectionId", sectionId);
  return `${cleanBase}/api/shift-sync-live?${params.toString()}`;
}

export function buildShiftAppsScriptSnippet(listenerUrl: string) {
  const cleanUrl = normalizeText(listenerUrl);
  if (!cleanUrl) return "";
  return `function pushShiftSync() {
  UrlFetchApp.fetch('${cleanUrl}', {
    method: 'post',
    muteHttpExceptions: true
  });
}

// Add this as an installable trigger in Apps Script:
// Trigger function: pushShiftSync
// Event source: From spreadsheet
// Event type: On change`;
}
