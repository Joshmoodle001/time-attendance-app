import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  buildShiftAppsScriptSnippet,
  buildShiftLiveWebhookUrl,
  createShiftSyncSectionId,
  DEFAULT_SHIFT_SYNC_SETTINGS,
  DEFAULT_SHIFT_SYNC_SECTIONS,
  loadShiftSyncSettings,
  saveShiftSyncSettings,
  type ShiftSyncSettings,
} from "@/services/shiftSync";
import { CheckCircle2, Copy, Link2, Plus, Radio, RefreshCw, Trash2, Waves } from "lucide-react";

function normalizeText(value: unknown) {
  return value === null || value === undefined ? "" : String(value).replace(/\s+/g, " ").trim();
}

function normalizeIncomingSettings(value: unknown): ShiftSyncSettings {
  const raw = typeof value === "object" && value !== null ? (value as Partial<ShiftSyncSettings>) : {};
  const incomingSections = Array.isArray(raw.sections) ? raw.sections : [];
  const mergedSections = [
    ...DEFAULT_SHIFT_SYNC_SECTIONS.map((section) => {
      const incoming = incomingSections.find((item) => item?.id === section.id);
      return {
        ...section,
        ...(incoming || {}),
        id: section.id,
        label: section.label,
        url: normalizeText(incoming?.url || section.url),
        lastSyncedAt: normalizeText(incoming?.lastSyncedAt || section.lastSyncedAt),
        lastStatus: normalizeText(incoming?.lastStatus || section.lastStatus),
      };
    }),
    ...incomingSections
      .filter((section) => section?.id && !DEFAULT_SHIFT_SYNC_SECTIONS.some((defaultSection) => defaultSection.id === section.id))
      .map((section) => ({
        id: section.id!,
        label: normalizeText(section.label) || section.id!,
        url: normalizeText(section.url),
        lastSyncedAt: normalizeText(section.lastSyncedAt),
        lastStatus: normalizeText(section.lastStatus) || "Waiting for a Google document link.",
      })),
  ];

  return {
    autoSyncEnabled: Boolean(raw.autoSyncEnabled),
    backupIntervalMinutes: Number(raw.backupIntervalMinutes || DEFAULT_SHIFT_SYNC_SETTINGS.backupIntervalMinutes),
    scheduledRunTimes: Array.isArray(raw.scheduledRunTimes)
      ? raw.scheduledRunTimes.map((time) => normalizeText(time)).filter((time) => /^\d{2}:\d{2}$/.test(time))
      : [],
    lastUniversalSyncedAt: normalizeText(raw.lastUniversalSyncedAt),
    lastUniversalStatus: normalizeText(raw.lastUniversalStatus) || DEFAULT_SHIFT_SYNC_SETTINGS.lastUniversalStatus,
    liveSyncEnabled: raw.liveSyncEnabled === undefined ? DEFAULT_SHIFT_SYNC_SETTINGS.liveSyncEnabled : Boolean(raw.liveSyncEnabled),
    lastLiveSyncedAt: normalizeText(raw.lastLiveSyncedAt),
    lastLiveStatus: normalizeText(raw.lastLiveStatus) || DEFAULT_SHIFT_SYNC_SETTINGS.lastLiveStatus,
    liveWebhookKey: normalizeText(raw.liveWebhookKey) || DEFAULT_SHIFT_SYNC_SETTINGS.liveWebhookKey,
    sections: mergedSections,
  };
}

async function postJson(url: string, body?: Record<string, unknown>) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body || {}),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      return await response.json().catch(() => null);
    }
    
    // If not JSON, return basic error
    return { 
      success: false, 
      error: `Server returned status ${response.status}`, 
      message: `Request failed with status ${response.status}` 
    };
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        return { success: false, error: "Request timed out", message: "The request took too long. Please try again." };
      }
      return { success: false, error: error.message, message: error.message };
    }
    
    return { success: false, error: "Unknown error", message: "An unknown error occurred" };
  }
}

export default function ShiftSyncAdminPanel() {
  const [settings, setSettings] = useState<ShiftSyncSettings>(DEFAULT_SHIFT_SYNC_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncingIds, setSyncingIds] = useState<string[]>([]);
  const [syncingAll, setSyncingAll] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Paste a live Google Sheets link to connect a source.");
  const [newSectionLabel, setNewSectionLabel] = useState("");
  const [newSectionUrl, setNewSectionUrl] = useState("");
  const [newScheduledTime, setNewScheduledTime] = useState("");
  const savedSettingsRef = useRef<ShiftSyncSettings>(DEFAULT_SHIFT_SYNC_SETTINGS);
  // Track the URL value when input was focused (to compare on blur)
  const focusedUrlRef = useRef<string>("");
  // Track auto-save timer for section links
  const linkSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;

    const bootstrap = async () => {
      try {
        const next = await loadShiftSyncSettings();
        if (!alive) return;
        setSettings(next);
        savedSettingsRef.current = next;
        setLoaded(true);
      } catch (error) {
        console.error("Failed to load shift sync settings:", error);
        if (alive) {
          setSettings(DEFAULT_SHIFT_SYNC_SETTINGS);
          setLoaded(true);
        }
      }
    };

    void bootstrap();

    const interval = window.setInterval(() => {
      void loadShiftSyncSettings()
        .then((next) => {
          if (!alive) return;
          try {
            setSettings((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
            savedSettingsRef.current = next;
          } catch (e) {
            console.error("Error updating settings state:", e);
          }
        })
        .catch((error) => {
          console.error("Interval failed to load settings:", error);
        });
    }, 30000);

    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, []);

  const origin = typeof window === "undefined" ? "" : window.location.origin;

  const visibleSections = useMemo(
    () => (settings.sections.length > 0 ? settings.sections : DEFAULT_SHIFT_SYNC_SECTIONS),
    [settings.sections]
  );

  const universalWebhookUrl = useMemo(
    () => buildShiftLiveWebhookUrl(origin, settings.liveWebhookKey),
    [origin, settings.liveWebhookKey]
  );

  const persistSettings = async (next: ShiftSyncSettings, message?: string) => {
    setSaving(true);
    setSettings(next);
    const result = await saveShiftSyncSettings(next);
    savedSettingsRef.current = next;
    if (message) setStatusMessage(message);
    if (result.error) {
      setStatusMessage(result.error);
    }
    setSaving(false);
    return result;
  };

  const isDefaultSection = (sectionId: string) =>
    DEFAULT_SHIFT_SYNC_SECTIONS.some((section) => section.id === sectionId);

  const refreshFromServer = async () => {
    const next = await loadShiftSyncSettings();
    setSettings(next);
    savedSettingsRef.current = next;
  };

  const runProcess = async (sectionId?: string) => {
    try {
      if (sectionId) {
        setSyncingIds((current) => [...current, sectionId]);
      } else {
        setSyncingAll(true);
      }

      setStatusMessage(sectionId ? "Processing sheet..." : "Processing all sheets...");

      const payload = await postJson("/api/shift-sync-run", sectionId ? { sectionId } : {});
      
      // Handle error response without throwing
      if (!payload || payload?.success === false || payload?.error) {
        const errorMsg = payload?.message || payload?.error || "Processing failed.";
        setStatusMessage(`Error: ${errorMsg}`);
        if (payload?.errors && Array.isArray(payload.errors)) {
          payload.errors.forEach((err: { section?: string; error?: string }) => {
            if (err.section && err.error) {
              setStatusMessage(`${err.section}: ${err.error}`);
            }
          });
        }
      } else {
        if (payload?.settings) {
          const normalizedSettings = normalizeIncomingSettings(payload.settings);
          setSettings(normalizedSettings);
          savedSettingsRef.current = normalizedSettings;
          void saveShiftSyncSettings(normalizedSettings);
        } else {
          try {
            await refreshFromServer();
          } catch (refreshError) {
            console.warn("Failed to refresh settings:", refreshError);
          }
        }
        
        const message = payload?.message || 
          payload?.settings?.lastUniversalStatus ||
          (sectionId ? "Sheet processed." : "All linked sheets processed.");
        setStatusMessage(message);
        
        if (payload?.totalRows !== undefined) {
          setStatusMessage(`${message} (${payload.totalRows} rows synced)`);
        }
      }
    } catch (error) {
      console.error("Process error:", error);
      const errorMsg = error instanceof Error ? error.message : "Could not process the live sheet.";
      setStatusMessage(`Error: ${errorMsg}. Make sure the Google Sheet is publicly accessible (Anyone with link can view).`);
    } finally {
      // Use setTimeout to ensure state updates don't cause blank screen
      setTimeout(() => {
        if (sectionId) {
          setSyncingIds((current) => current.filter((id) => id !== sectionId));
        } else {
          setSyncingAll(false);
        }
      }, 0);
    }
  };

  const handleSectionLinkCommit = async (sectionId: string) => {
    // Prevent UI freeze - save state first without processing
    const section = settings.sections.find((item) => item.id === sectionId);
    if (!section) return;

    const nextUrl = normalizeText(section.url);
    const previousUrl = focusedUrlRef.current;
    
    // If URL didn't change since focus, skip
    if (nextUrl === previousUrl) return;

    // Optimistic update
    const nextSettings = {
      ...settings,
      sections: settings.sections.map((item) =>
        item.id === sectionId
          ? {
              ...item,
              url: nextUrl,
              lastStatus: nextUrl ? "Saving link..." : "Waiting for a Google document link.",
            }
          : item
      ),
    };

    setSettings(nextSettings);
    const result = await persistSettings(nextSettings, nextUrl ? "Link saved. Click 'Process now' to sync." : "Live Google Sheet removed.");
    
    // Show error if save failed
    if (!result.success && result.error) {
      setStatusMessage(`Save failed: ${result.error}`);
    }
  };

  const handleToggle = async (field: "autoSyncEnabled" | "liveSyncEnabled", value: boolean) => {
    const nextSettings = {
      ...settings,
      [field]: value,
      lastUniversalStatus:
        field === "autoSyncEnabled"
          ? value
            ? "Hourly backup sync enabled."
            : "Hourly background sync is off."
          : settings.lastUniversalStatus,
      lastLiveStatus:
        field === "liveSyncEnabled"
          ? value
            ? "Live sheet listening enabled."
            : "Live sheet listening disabled."
          : settings.lastLiveStatus,
    };

    await persistSettings(nextSettings);
  };

  const handleIntervalChange = async (intervalMinutes: number) => {
    const nextSettings = {
      ...settings,
      backupIntervalMinutes: intervalMinutes,
      lastUniversalStatus: `Backup sync saved for every ${intervalMinutes} minute${intervalMinutes === 1 ? "" : "s"}.`,
    };
    await persistSettings(nextSettings, nextSettings.lastUniversalStatus);
  };

  const handleAddScheduledTime = async () => {
    const nextTime = normalizeText(newScheduledTime);
    if (!/^\d{2}:\d{2}$/.test(nextTime)) {
      setStatusMessage("Use the time picker to add a valid sync time.");
      return;
    }

    if (settings.scheduledRunTimes.includes(nextTime)) {
      setStatusMessage("That sync time is already saved.");
      return;
    }

    const nextSettings = {
      ...settings,
      scheduledRunTimes: [...settings.scheduledRunTimes, nextTime].sort(),
    };
    setNewScheduledTime("");
    await persistSettings(nextSettings, "Saved a scheduled sync time.");
  };

  const handleRemoveScheduledTime = async (timeValue: string) => {
    const nextSettings = {
      ...settings,
      scheduledRunTimes: settings.scheduledRunTimes.filter((item) => item !== timeValue),
    };
    await persistSettings(nextSettings, "Removed the scheduled sync time.");
  };

  const handleAddSection = async () => {
    const label = normalizeText(newSectionLabel);
    const url = normalizeText(newSectionUrl);
    if (!label) {
      setStatusMessage("Enter a name for the live sheet before adding it.");
      return;
    }

    const nextId = createShiftSyncSectionId(label);
    if (settings.sections.some((section) => section.id === nextId)) {
      setStatusMessage("A live sheet with that name already exists.");
      return;
    }

    const nextSettings = {
      ...settings,
      sections: [
        ...settings.sections,
        {
          id: nextId,
          label,
          url,
          lastSyncedAt: "",
          lastStatus: url ? "Live Google Sheet linked. Processing now..." : "Waiting for a Google document link.",
        },
      ],
    };

    setNewSectionLabel("");
    setNewSectionUrl("");
    await persistSettings(nextSettings, `Added ${label}.`);
    if (url) {
      await runProcess(nextId);
    }
  };

  const handleRemoveSection = async (sectionId: string) => {
    if (isDefaultSection(sectionId)) {
      setStatusMessage("Default live sheets stay in place. You can clear their links if you do not need them.");
      return;
    }

    const nextSettings = {
      ...settings,
      sections: settings.sections.filter((section) => section.id !== sectionId),
    };
    await persistSettings(nextSettings, "Removed the live sheet.");
  };

  const copyText = async (text: string, successMessage: string) => {
    await navigator.clipboard.writeText(text);
    setStatusMessage(successMessage);
  };

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Waves className="h-5 w-5" />
              Live Shift Sheets
            </CardTitle>
            <CardDescription>
              Manage live Google Sheets here. Paste a sheet link, click outside the field, and the app will save it and process it immediately while keeping the Shifts builder unchanged.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={settings.liveSyncEnabled}
                onChange={(event) => void handleToggle("liveSyncEnabled", event.target.checked)}
              />
              Live listening
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={settings.autoSyncEnabled}
                onChange={(event) => void handleToggle("autoSyncEnabled", event.target.checked)}
              />
              Hourly backup
            </label>
            <Button variant="outline" onClick={() => void runProcess()} disabled={syncingAll || saving || !loaded}>
              <RefreshCw className={`mr-2 h-4 w-4 ${syncingAll ? "animate-spin" : ""}`} />
              {syncingAll ? "Processing..." : "Process all now"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          <div className="font-medium text-slate-900">Status</div>
          <div className="mt-1">{statusMessage}</div>
          <div className="mt-2 text-xs text-slate-500">
            {settings.lastUniversalSyncedAt
              ? `Last backup sync ${new Date(settings.lastUniversalSyncedAt).toLocaleString()}`
              : "No hourly backup sync has completed yet."}
          </div>
          <div className="text-xs text-slate-500">
            {settings.lastLiveSyncedAt
              ? `Last live push ${new Date(settings.lastLiveSyncedAt).toLocaleString()}`
              : "No live push has completed yet."}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-sm font-semibold text-slate-900">Backup schedule</div>
            <div className="mt-1 text-xs text-slate-500">
              Save your preferred interval and daily sync times for the live sheet processing setup.
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Backup interval</div>
                <select
                  value={settings.backupIntervalMinutes}
                  onChange={(event) => void handleIntervalChange(Number(event.target.value))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                >
                  <option value={15}>Every 15 minutes</option>
                  <option value={30}>Every 30 minutes</option>
                  <option value={60}>Every hour</option>
                  <option value={120}>Every 2 hours</option>
                  <option value={240}>Every 4 hours</option>
                  <option value={480}>Every 8 hours</option>
                  <option value={720}>Every 12 hours</option>
                  <option value={1440}>Daily</option>
                </select>
              </div>

              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Specific daily sync times</div>
                <div className="flex flex-wrap gap-2">
                  <Input type="time" value={newScheduledTime} onChange={(event) => setNewScheduledTime(event.target.value)} />
                  <Button variant="outline" onClick={() => void handleAddScheduledTime()}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add time
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {settings.scheduledRunTimes.length === 0 ? (
                    <div className="text-xs text-slate-500">No specific times saved yet.</div>
                  ) : (
                    settings.scheduledRunTimes.map((timeValue) => (
                      <button
                        key={timeValue}
                        type="button"
                        onClick={() => void handleRemoveScheduledTime(timeValue)}
                        className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700"
                      >
                        {timeValue} ×
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-sm font-semibold text-slate-900">Add live sheet</div>
            <div className="mt-1 text-xs text-slate-500">
              Create additional live sheet sources and save them here.
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Sheet name</div>
                <Input
                  value={newSectionLabel}
                  placeholder="Example: Checkers Specials"
                  onChange={(event) => setNewSectionLabel(event.target.value)}
                />
              </div>
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Live Google Sheet link</div>
                <Input
                  value={newSectionUrl}
                  placeholder="Paste the live Google Sheets link here"
                  onChange={(event) => setNewSectionUrl(event.target.value)}
                />
              </div>
              <Button onClick={() => void handleAddSection()} disabled={saving}>
                <Plus className="mr-2 h-4 w-4" />
                Add live sheet
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Universal listener URL</div>
                <div className="text-xs text-slate-500">Use this if one Google Apps Script should trigger all linked shift sheets together.</div>
              </div>
              <Button variant="outline" size="sm" onClick={() => void copyText(universalWebhookUrl, "Universal listener URL copied.")}>
                <Copy className="mr-2 h-4 w-4" />
                Copy
              </Button>
            </div>
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 break-all">
              {universalWebhookUrl || "Listener URL will appear once settings are loaded."}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Google Apps Script</div>
                <div className="text-xs text-slate-500">Install this in the Google Sheet so edits can push changes back to the app for processing.</div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void copyText(
                    buildShiftAppsScriptSnippet(universalWebhookUrl),
                    "Google Apps Script snippet copied."
                  )
                }
              >
                <Copy className="mr-2 h-4 w-4" />
                Copy script
              </Button>
            </div>
            <textarea
              readOnly
              value={buildShiftAppsScriptSnippet(universalWebhookUrl)}
              className="mt-3 min-h-[150px] w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700"
            />
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          {visibleSections.map((section) => {
            const listenerUrl = buildShiftLiveWebhookUrl(origin, settings.liveWebhookKey, section.id);
            const syncing = syncingIds.includes(section.id);
            return (
              <div key={section.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold text-slate-900">{section.label}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {section.lastSyncedAt ? `Last processed ${new Date(section.lastSyncedAt).toLocaleString()}` : "No processing yet"}
                    </div>
                  </div>
                  <Badge className={normalizeText(section.url) && settings.liveSyncEnabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-700"}>
                    {normalizeText(section.url) && settings.liveSyncEnabled ? (
                      <>
                        <Radio className="mr-1 h-3 w-3" />
                        Listening
                      </>
                    ) : (
                      "Waiting"
                    )}
                  </Badge>
                </div>

                <div className="mt-4 space-y-3">
                  <div>
                    <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Live Google Sheet link</div>
                    <Input
                      value={section.url}
                      placeholder="Paste the live Google Sheets link here"
                      onFocus={() => {
                        focusedUrlRef.current = section.url;
                      }}
                      onChange={(event) => {
                        const newUrl = event.target.value;
                        setSettings((current) => ({
                          ...current,
                          sections: current.sections.map((item) =>
                            item.id === section.id ? { ...item, url: newUrl } : item
                          ),
                        }));
                        // Auto-save after typing stops (500ms delay)
                        if (linkSaveTimerRef.current) {
                          clearTimeout(linkSaveTimerRef.current);
                        }
                        linkSaveTimerRef.current = setTimeout(() => {
                          const current = settings.sections.find(s => s.id === section.id);
                          if (current && current.url !== newUrl) {
                            void handleSectionLinkCommit(section.id);
                          }
                        }, 500);
                      }}
                      onBlur={() => void handleSectionLinkCommit(section.id)}
                    />
                    <div className="mt-1 text-xs text-slate-500">
                      Paste the sheet link, wait 1 second, then click "Process now" to sync.
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">{section.lastStatus}</div>

                  <div className="rounded-xl border border-dashed border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Listener URL</div>
                      <Button variant="outline" size="sm" onClick={() => void copyText(listenerUrl, `${section.label} listener URL copied.`)}>
                        <Link2 className="mr-2 h-4 w-4" />
                        Copy link
                      </Button>
                    </div>
                    <div className="mt-2 break-all text-xs text-slate-700">{listenerUrl}</div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => void runProcess(section.id)} disabled={syncing || saving || !normalizeText(section.url)}>
                      <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                      {syncing ? "Processing..." : "Process now"}
                    </Button>
                    {!isDefaultSection(section.id) && (
                      <Button variant="outline" size="sm" onClick={() => void handleRemoveSection(section.id)} disabled={saving || syncing}>
                        <Trash2 className="mr-2 h-4 w-4" />
                        Remove
                      </Button>
                    )}
                    {section.lastSyncedAt && (
                      <Badge className="bg-emerald-100 text-emerald-700">
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        Ready
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
