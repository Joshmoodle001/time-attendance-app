const TRIAL_RESET_VERSION_KEY = "trial-reset-version-v1";
const TRIAL_RESET_TARGET_VERSION = "2026-04-29-admin-reset-only-v1";

export async function performOneTimeTrialReset() {
  if (typeof window === "undefined") {
    return { ran: false };
  }

  try {
    window.localStorage.setItem(TRIAL_RESET_VERSION_KEY, TRIAL_RESET_TARGET_VERSION);
  } catch {
    // ignore
  }

  return { ran: false };
}
