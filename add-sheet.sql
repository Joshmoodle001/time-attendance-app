-- Insert shift sync settings with Google Sheets URL
-- Run this in Supabase SQL Editor

INSERT INTO shift_sync_settings (id, auto_sync_enabled, payload, updated_at)
VALUES (
  'global',
  false,
  '{
    "sections": [
      {
        "id": "checkers-local",
        "label": "Checkers Local",
        "url": "https://docs.google.com/spreadsheets/d/1K1vFmIzVLGLBPFxw3XFgDggQITPFpXJy81pKlyMZnuk/edit?usp=sharing",
        "lastSyncedAt": "",
        "lastStatus": ""
      },
      {
        "id": "checkers-country",
        "label": "Checkers Country",
        "url": "",
        "lastSyncedAt": "",
        "lastStatus": ""
      },
      {
        "id": "shoprite-local",
        "label": "Shoprite Local",
        "url": "",
        "lastSyncedAt": "",
        "lastStatus": ""
      },
      {
        "id": "shoprite-country",
        "label": "Shoprite Country",
        "url": "",
        "lastSyncedAt": "",
        "lastStatus": ""
      },
      {
        "id": "usave-local",
        "label": "USave Local",
        "url": "",
        "lastSyncedAt": "",
        "lastStatus": ""
      },
      {
        "id": "usave-country",
        "label": "USave Country",
        "url": "",
        "lastSyncedAt": "",
        "lastStatus": ""
      }
    ],
    "scheduledRunTimes": [],
    "backupIntervalMinutes": 60,
    "liveSyncEnabled": false,
    "lastLiveSyncedAt": null,
    "lastLiveStatus": "",
    "liveWebhookKey": ""
  }'::jsonb,
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  payload = EXCLUDED.payload,
  updated_at = NOW();