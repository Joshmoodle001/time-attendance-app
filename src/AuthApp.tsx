import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Eye,
  EyeOff,
  Key,
  Lock,
  RefreshCw,
  TimerReset,
  User,
  UserPlus,
  Shield,
} from "lucide-react";

import App from "./App";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getAllStores, saveStoreAssignments, type StoreInfo } from "@/services/storeAssignments";
import {
  ensureSuperAdminSeeded,
  getDefaultSuperAdminCredentials,
  login,
  refreshSession,
  registerRep,
  type AuthSession,
} from "@/services/auth";

type Banner = {
  type: "success" | "error" | "info";
  text: string;
};

const floatingArtifacts = [
  { title: "Live Workforce", value: "Synced", x: "8%", y: "14%", delay: 0 },
  { title: "Clock Integrity", value: "Verified", x: "76%", y: "18%", delay: 0.2 },
  { title: "Shift Matrix", value: "Ready", x: "12%", y: "72%", delay: 0.35 },
  { title: "Command Access", value: "Secured", x: "72%", y: "74%", delay: 0.5 },
];

type RepDirectoryEntry = {
  repCode: string;
  repLabel: string;
  storeKeys: string[];
  storeLabels: string[];
};

function normalizeText(value: unknown) {
  return value === null || value === undefined ? "" : String(value).replace(/\s+/g, " ").trim();
}

const SIGNUP_COVERSHEET_STORAGE_KEY = "coversheet-data-v1";
const SIGNUP_COVERSHEET_DB_NAME = "time-attendance-coversheet-db";
const SIGNUP_COVERSHEET_DB_VERSION = 1;
const SIGNUP_COVERSHEET_DB_STORE = "coversheet_data";
const SIGNUP_COVERSHEET_DB_RECORD_ID = "latest";

type SignupCoversheetEmployee = {
  repLabel?: unknown;
};

type SignupCoversheetStore = {
  storeCode?: unknown;
  storeName?: unknown;
  employees?: SignupCoversheetEmployee[];
};

type SignupCoversheetData = {
  stores?: SignupCoversheetStore[];
};

type SignupCoversheetIndexedRecord = {
  id: string;
  payload: SignupCoversheetData;
};

function isValidSignupCoversheetData(value: unknown): value is SignupCoversheetData {
  if (!value || typeof value !== "object") return false;
  const data = value as SignupCoversheetData;
  return Array.isArray(data.stores);
}

function extractRepCode(repLabel: string) {
  const clean = normalizeText(repLabel);
  if (!clean) return "";
  const firstSegment = clean.split("-")[0]?.trim() || "";
  return firstSegment.toUpperCase();
}

function openSignupCoversheetIndexedDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const request = window.indexedDB.open(SIGNUP_COVERSHEET_DB_NAME, SIGNUP_COVERSHEET_DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SIGNUP_COVERSHEET_DB_STORE)) {
        database.createObjectStore(SIGNUP_COVERSHEET_DB_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function readSignupCoversheetFromIndexedDb(): Promise<SignupCoversheetData | null> {
  const database = await openSignupCoversheetIndexedDb();
  if (!database) return null;

  return new Promise((resolve) => {
    if (!database.objectStoreNames.contains(SIGNUP_COVERSHEET_DB_STORE)) {
      resolve(null);
      return;
    }
    const transaction = database.transaction(SIGNUP_COVERSHEET_DB_STORE, "readonly");
    const store = transaction.objectStore(SIGNUP_COVERSHEET_DB_STORE);
    const request = store.get(SIGNUP_COVERSHEET_DB_RECORD_ID);

    request.onsuccess = () => {
      const record = request.result as SignupCoversheetIndexedRecord | undefined;
      if (record && isValidSignupCoversheetData(record.payload)) {
        resolve(record.payload);
        return;
      }
      resolve(null);
    };
    request.onerror = () => resolve(null);
  });
}

function readSignupCoversheetFromLocalStorage(): SignupCoversheetData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SIGNUP_COVERSHEET_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isValidSignupCoversheetData(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function loadSignupCoversheetData(): Promise<SignupCoversheetData | null> {
  const indexed = await readSignupCoversheetFromIndexedDb();
  if (indexed) return indexed;
  return readSignupCoversheetFromLocalStorage();
}

function StatusBanner({ banner }: { banner: Banner | null }) {
  if (!banner) return null;

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-2xl border px-4 py-3 text-sm",
        banner.type === "success" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
        banner.type === "error" && "border-red-500/30 bg-red-500/10 text-red-200",
        banner.type === "info" && "border-cyan-500/30 bg-cyan-500/10 text-cyan-200"
      )}
    >
      {banner.type === "success" ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
      ) : banner.type === "error" ? (
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <span>{banner.text}</span>
    </div>
  );
}

function FuturisticBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.22),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(139,92,246,0.24),transparent_30%),linear-gradient(180deg,#020617_0%,#0f172a_45%,#020617_100%)]" />
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            "linear-gradient(rgba(148,163,184,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.12) 1px, transparent 1px)",
          backgroundSize: "90px 90px",
          maskImage: "radial-gradient(circle at center, black 30%, transparent 85%)",
        }}
      />
      <motion.div
        className="absolute left-[-10%] top-[8%] h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl"
        animate={{ x: [0, 40, -20, 0], y: [0, 20, -15, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute bottom-[2%] right-[-8%] h-80 w-80 rounded-full bg-fuchsia-500/20 blur-3xl"
        animate={{ x: [0, -35, 18, 0], y: [0, -25, 10, 0] }}
        transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute left-[42%] top-[18%] h-64 w-64 rounded-full bg-violet-500/10 blur-3xl"
        animate={{ scale: [1, 1.2, 0.95, 1], opacity: [0.45, 0.75, 0.4, 0.45] }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
      />
      {floatingArtifacts.map((artifact) => (
        <motion.div
          key={artifact.title}
          className="absolute hidden min-w-[180px] rounded-2xl border border-white/10 bg-slate-950/45 px-4 py-3 text-white shadow-[0_20px_60px_rgba(2,6,23,0.45)] backdrop-blur-xl lg:block"
          style={{ left: artifact.x, top: artifact.y }}
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: [0, -10, 0] }}
          transition={{
            opacity: { duration: 0.6, delay: artifact.delay },
            y: { duration: 6 + artifact.delay * 4, repeat: Infinity, ease: "easeInOut" },
          }}
        >
          <div className="mb-2 flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-cyan-400 shadow-[0_0_18px_rgba(34,211,238,0.9)]" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-300">
              Artifact
            </span>
          </div>
          <div className="text-sm font-semibold">{artifact.title}</div>
          <div className="mt-1 text-xs text-slate-300">{artifact.value}</div>
        </motion.div>
      ))}
    </div>
  );
}

function WelcomeScreen({
  session,
  onContinue,
}: {
  session: AuthSession;
  onContinue: () => void;
}) {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <FuturisticBackdrop />
      <div className="relative z-10 flex min-h-screen items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 24 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
          className="w-full max-w-3xl rounded-[32px] border border-white/10 bg-slate-950/55 p-8 text-white shadow-[0_30px_120px_rgba(2,6,23,0.75)] backdrop-blur-2xl md:p-10"
        >
          <div className="mb-8 flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-cyan-500 to-violet-500 shadow-[0_0_40px_rgba(34,211,238,0.35)]">
              <TimerReset className="h-7 w-7 text-white" />
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.34em] text-cyan-300">
                Access Granted
              </div>
              <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
                Welcome to the Attendance Command Center
              </h1>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {[
              "Live attendance intelligence",
              "Shift, leave, and roster orchestration",
              "Admin tools, reports, and sync control",
            ].map((item, index) => (
              <motion.div
                key={item}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + index * 0.08 }}
                className="rounded-2xl border border-white/10 bg-white/5 p-4"
              >
                <div className="mb-3 h-1.5 w-16 rounded-full bg-gradient-to-r from-cyan-400 to-fuchsia-400" />
                <div className="text-sm text-slate-200">{item}</div>
              </motion.div>
            ))}
          </div>

          <div className="mt-8 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4 text-sm text-cyan-100">
            Signed in as <span className="font-semibold">{session.username}</span>. Your session is stored locally on this device.
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button size="lg" className="button-glow cyber-button" onClick={onContinue}>
              Open command center
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
            <div className="text-sm text-slate-400">Futuristic login and local reset controls are now active.</div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

export default function AuthApp() {
  const defaults = useMemo(() => getDefaultSuperAdminCredentials(), []);
  const [isBooting, setIsBooting] = useState(true);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "enrollment" | "signup">("signin");
  const [enrollmentCode, setEnrollmentCode] = useState("");
  const [enrollmentError, setEnrollmentError] = useState("");
  const [username, setUsername] = useState(defaults.username);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [banner, setBanner] = useState<Banner | null>({
    type: "info",
    text: "Sign in with your credentials.",
  });

  const [signupData, setSignupData] = useState({
    name: "",
    surname: "",
    username: "",
    password: "",
    confirmPassword: "",
    coversheetCode: "",
  });
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [signupStoreUniverse, setSignupStoreUniverse] = useState<StoreInfo[]>([]);
  const [signupStoreSearch, setSignupStoreSearch] = useState("");
  const [signupSelectedStores, setSignupSelectedStores] = useState<string[]>([]);
  const [signupRepDirectory, setSignupRepDirectory] = useState<RepDirectoryEntry[]>([]);
  const [signupRepSearch, setSignupRepSearch] = useState("");
  const [signupRepAssignedStores, setSignupRepAssignedStores] = useState<string[]>([]);

  useEffect(() => {
    ensureSuperAdminSeeded();
  }, []);

  useEffect(() => {
    const existingSession = refreshSession();
    setSession(existingSession);
    setShowWelcome(false);
    setIsBooting(false);
  }, []);

  useEffect(() => {
    if (authMode !== "signup") return;
    let alive = true;
    void (async () => {
      try {
        const [stores, coversheetData] = await Promise.all([getAllStores(), loadSignupCoversheetData()]);
        if (!alive) return;
        setSignupStoreUniverse(stores);

        const directoryMap = new Map<
          string,
          { repCode: string; repLabel: string; storeKeys: Set<string>; storeLabels: Set<string> }
        >();

        (coversheetData?.stores || []).forEach((store) => {
          const storeCode = normalizeText(store.storeCode);
          const storeName = normalizeText(store.storeName);
          const storeKey = [storeCode, storeName].filter(Boolean).join(" - ");
          const storeLabel = storeKey || "Unknown Store";

          (store.employees || []).forEach((employee) => {
            const repLabel = normalizeText(employee.repLabel);
            if (!repLabel) return;
            const mapKey = repLabel.toLowerCase();
            const repCode = extractRepCode(repLabel);
            const existing = directoryMap.get(mapKey);
            if (existing) {
              if (!existing.repCode && repCode) existing.repCode = repCode;
              if (storeKey) existing.storeKeys.add(storeKey);
              existing.storeLabels.add(storeLabel);
              return;
            }

            const storeKeys = new Set<string>();
            if (storeKey) storeKeys.add(storeKey);
            directoryMap.set(mapKey, {
              repCode,
              repLabel,
              storeKeys,
              storeLabels: new Set<string>([storeLabel]),
            });
          });
        });

        const directory = Array.from(directoryMap.values())
          .map(
            (entry) =>
              ({
                repCode: entry.repCode,
                repLabel: entry.repLabel,
                storeKeys: Array.from(entry.storeKeys),
                storeLabels: Array.from(entry.storeLabels),
              }) satisfies RepDirectoryEntry
          )
          .sort((a, b) => a.repLabel.localeCompare(b.repLabel) || a.repCode.localeCompare(b.repCode));
        setSignupRepDirectory(directory);
      } catch {
        if (alive) setBanner({ type: "error", text: "Could not load store and coversheet rep data for signup." });
      }
    })();

    return () => {
      alive = false;
    };
  }, [authMode]);

  const signupStoreMatches = useMemo(() => {
    const query = normalizeText(signupStoreSearch).toLowerCase();
    const available = signupStoreUniverse.filter((store) => !signupSelectedStores.includes(store.storeKey));
    if (!query) return available.slice(0, 12);
    return available
      .filter((store) => `${store.storeName} ${store.storeCode} ${store.region}`.toLowerCase().includes(query))
      .slice(0, 12);
  }, [signupSelectedStores, signupStoreSearch, signupStoreUniverse]);

  const signupRepMatches = useMemo(() => {
    const query = normalizeText(signupRepSearch).toLowerCase();
    if (!query) return signupRepDirectory.slice(0, 8);
    return signupRepDirectory
      .filter((entry) => `${entry.repCode} ${entry.repLabel} ${entry.storeLabels.join(" ")}`.toLowerCase().includes(query))
      .slice(0, 8);
  }, [signupRepDirectory, signupRepSearch]);

  const handleLogin = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = login(username, password);

    if (!result.success) {
      setBanner({ type: "error", text: result.error });
      return;
    }

    setSession(result.session);
    setShowWelcome(true);
    setPassword("");
    setBanner({ type: "success", text: `Welcome back, ${result.session.username}!` });
  };

  const handleSignup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (signupData.password !== signupData.confirmPassword) {
      setBanner({ type: "error", text: "Passwords do not match." });
      return;
    }

    const result = registerRep({
      username: signupData.username,
      password: signupData.password,
      name: signupData.name,
      surname: signupData.surname,
      coversheetCode: signupData.coversheetCode,
    });

    if (!result.success) {
      setBanner({ type: "error", text: result.error });
      return;
    }

    const loginResult = login(signupData.username, signupData.password);
    if (loginResult.success) {
      if (signupSelectedStores.length > 0) {
        await saveStoreAssignments(signupData.username, signupSelectedStores);
      }
      setSession(loginResult.session);
      setShowWelcome(true);
      setBanner({ type: "success", text: `Account created! Welcome, ${loginResult.session.username}!` });
    }
  };

  const handleSignupAddStore = (storeKey: string) => {
    if (signupSelectedStores.includes(storeKey)) return;
    setSignupSelectedStores((current) => [...current, storeKey]);
  };

  const handleSignupRemoveStore = (storeKey: string) => {
    setSignupSelectedStores((current) => current.filter((key) => key !== storeKey));
  };

  const clearSignupRepSelection = () => {
    setSignupData((current) => ({ ...current, coversheetCode: "" }));
    setSignupRepSearch("");
    setSignupSelectedStores((current) => current.filter((key) => !signupRepAssignedStores.includes(key)));
    setSignupRepAssignedStores([]);
  };

  const handleSignupSelectRep = (entry: RepDirectoryEntry) => {
    const nextRepStores = entry.storeKeys.filter(Boolean);
    setSignupData((current) => ({
      ...current,
      coversheetCode: entry.repCode || current.coversheetCode,
    }));
    setSignupSelectedStores((current) => {
      const withoutPreviousRepStores = current.filter((key) => !signupRepAssignedStores.includes(key));
      const next = new Set(withoutPreviousRepStores);
      nextRepStores.forEach((storeKey) => next.add(storeKey));
      return Array.from(next);
    });
    setSignupRepAssignedStores(nextRepStores);
    setSignupRepSearch(entry.repLabel);
  };

  if (isBooting) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-slate-950 text-white">
        <FuturisticBackdrop />
        <div className="relative z-10 flex min-h-screen items-center justify-center p-6">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-[28px] border border-white/10 bg-slate-950/60 px-8 py-7 text-center shadow-[0_30px_120px_rgba(2,6,23,0.75)] backdrop-blur-2xl"
          >
            <div className="orb-loader mx-auto mb-4 w-fit">
              <span />
              <span />
              <span />
            </div>
            <div className="text-lg font-semibold">Initializing secure access</div>
            <div className="mt-2 text-sm text-slate-400">Loading the futuristic authentication shell...</div>
          </motion.div>
        </div>
      </div>
    );
  }

  if (session && showWelcome) {
    return <WelcomeScreen session={session} onContinue={() => setShowWelcome(false)} />;
  }

  if (!session) {
    return (
      <div className="relative min-h-screen overflow-hidden text-white">
        <FuturisticBackdrop />
        <div className="relative z-10 flex min-h-screen items-center justify-center p-5 md:p-8">
          <div className="grid w-full max-w-6xl gap-8 xl:grid-cols-[1.08fr_0.92fr]">
            <motion.div
              initial={{ opacity: 0, x: -24 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.45 }}
              className="hidden rounded-[32px] border border-white/10 bg-slate-950/35 p-8 shadow-[0_30px_120px_rgba(2,6,23,0.65)] backdrop-blur-2xl xl:block"
            >
              <div className="mb-8 flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-cyan-500 to-violet-500 shadow-[0_0_40px_rgba(34,211,238,0.35)]">
                  <TimerReset className="h-7 w-7 text-white" />
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.34em] text-cyan-300">
                    PFM Operations
                  </div>
                  <h1 className="text-4xl font-bold tracking-tight">Futuristic Attendance Access</h1>
                </div>
              </div>

              <p className="max-w-xl text-base leading-7 text-slate-300">
                Step into a secured control layer built to match the live workforce dashboard. Sign in to open the command center, review the welcome screen, and manage the platform with a futuristic glass-panel experience.
              </p>

              <div className="mt-10 grid gap-4 md:grid-cols-2">
                {[
                  { title: "Theme aligned", detail: "Built around the existing cyan, violet, and glassmorphism language." },
                  { title: "Local secure session", detail: "The dashboard stays locked until the super admin signs in." },
                  { title: "Reset control", detail: "Update or restore the super admin password directly from the login portal." },
                  { title: "Welcome layer", detail: "A dedicated arrival screen appears immediately after successful sign-in." },
                ].map((item) => (
                  <div key={item.title} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="mb-2 flex items-center gap-2 text-cyan-300">
                      <CheckCircle2 className="h-4 w-4" />
                      <span className="text-sm font-semibold">{item.title}</span>
                    </div>
                    <div className="text-sm leading-6 text-slate-300">{item.detail}</div>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.45, delay: 0.05 }}
              className="rounded-[32px] border border-white/10 bg-slate-950/55 p-6 shadow-[0_30px_120px_rgba(2,6,23,0.75)] backdrop-blur-2xl sm:p-8"
            >
              <div className="mb-6 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-violet-500 shadow-[0_0_35px_rgba(34,211,238,0.35)]">
                    {authMode === "signin" ? (
                      <Lock className="h-6 w-6 text-white" />
                    ) : authMode === "enrollment" ? (
                      <Shield className="h-6 w-6 text-white" />
                    ) : (
                      <UserPlus className="h-6 w-6 text-white" />
                    )}
                  </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-cyan-300">
                        {authMode === "signin" ? "Secure Portal" : authMode === "enrollment" ? "Company Access" : "Create Account"}
                      </div>
                      <div className="text-2xl font-bold">{authMode === "signin" ? "Sign in" : authMode === "enrollment" ? "Enrollment" : "Sign up"}</div>
                    </div>
                </div>
              </div>

              <StatusBanner banner={banner} />

              {authMode === "signin" ? (
                <motion.form
                  key="login"
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.22 }}
                  onSubmit={handleLogin}
                  className="mt-6 space-y-4"
                >
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">Email</label>
                    <div className="relative">
                      <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-300" />
                      <Input
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        className="h-12 border-white/10 bg-white/5 pl-10 text-white placeholder:text-slate-500"
                        placeholder="your@email.com"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">Password</label>
                    <div className="relative">
                      <Key className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-300" />
                      <Input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        className="h-12 border-white/10 bg-white/5 pl-10 pr-12 text-white placeholder:text-slate-500"
                        placeholder="Enter password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((current) => !current)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-white"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
                    Default super admin credentials are seeded automatically for first-time access.
                  </div>

                  <Button type="submit" size="lg" className="cyber-button button-glow h-12 w-full">
                    Unlock command center
                    <ChevronRight className="ml-2 h-4 w-4" />
                  </Button>

                  <div className="relative my-4">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-white/10" />
                    </div>
                    <div className="relative flex justify-center text-xs">
                      <span className="bg-slate-950/55 px-3 text-slate-500">or</span>
                    </div>
                  </div>

                  <div className="text-center">
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMode("enrollment");
                        setEnrollmentCode("");
                        setEnrollmentError("");
                        setBanner({ type: "info", text: "Enter your company enrollment code to sign up." });
                      }}
                      className="text-sm text-cyan-300 hover:text-cyan-200 transition"
                    >
                      Don't have an account? <span className="font-semibold">Sign up</span>
                    </button>
                  </div>
                </motion.form>
              ) : authMode === "enrollment" ? (
                <motion.form
                  key="enrollment"
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.22 }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const code = enrollmentCode.trim().toUpperCase();
                    if (code === "PFM") {
                      setAuthMode("signup");
                      setBanner({ type: "info", text: "Enrollment verified. Create your rep account." });
                    } else {
                      setEnrollmentError("Invalid enrollment code. Contact your company admin.");
                    }
                  }}
                  className="mt-6 space-y-4"
                >
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">Enrollment Code</label>
                    <div className="relative">
                      <Shield className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-300" />
                      <Input
                        value={enrollmentCode}
                        onChange={(e) => {
                          setEnrollmentCode(e.target.value);
                          setEnrollmentError("");
                        }}
                        className="h-12 border-white/10 bg-white/5 pl-10 text-white placeholder:text-slate-500 uppercase tracking-widest"
                        placeholder="Enter code"
                        autoFocus
                      />
                    </div>
                  </div>

                  {enrollmentError && (
                    <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
                      {enrollmentError}
                    </div>
                  )}

                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
                    Enter the enrollment code provided by your company to register for a rep account. This ensures you join the correct organization.
                  </div>

                  <Button type="submit" size="lg" className="cyber-button button-glow h-12 w-full">
                    Verify code
                    <ChevronRight className="ml-2 h-4 w-4" />
                  </Button>

                  <div className="text-center">
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMode("signin");
                        setEnrollmentCode("");
                        setEnrollmentError("");
                        setBanner({ type: "info", text: "Sign in with your credentials." });
                      }}
                      className="text-sm text-cyan-300 hover:text-cyan-200 transition"
                    >
                      Already have an account? <span className="font-semibold">Sign in</span>
                    </button>
                  </div>
                </motion.form>
              ) : (
                <motion.form
                  key="signup"
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.22 }}
                  onSubmit={handleSignup}
                  className="mt-6 space-y-4"
                >
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-300">First Name</label>
                      <Input
                        value={signupData.name}
                        onChange={(e) => setSignupData({ ...signupData, name: e.target.value })}
                        className="h-11 border-white/10 bg-white/5 text-white placeholder:text-slate-500"
                        placeholder="First name"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-300">Surname</label>
                      <Input
                        value={signupData.surname}
                        onChange={(e) => setSignupData({ ...signupData, surname: e.target.value })}
                        className="h-11 border-white/10 bg-white/5 text-white placeholder:text-slate-500"
                        placeholder="Surname"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">Email</label>
                    <div className="relative">
                      <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-300" />
                      <Input
                        type="email"
                        value={signupData.username}
                        onChange={(e) => setSignupData({ ...signupData, username: e.target.value.toLowerCase() })}
                        className="h-11 border-white/10 bg-white/5 pl-10 text-white placeholder:text-slate-500"
                        placeholder="your@email.com"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">Password</label>
                    <div className="relative">
                      <Key className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-300" />
                      <Input
                        type={showSignupPassword ? "text" : "password"}
                        value={signupData.password}
                        onChange={(e) => setSignupData({ ...signupData, password: e.target.value })}
                        className="h-11 border-white/10 bg-white/5 pl-10 pr-12 text-white placeholder:text-slate-500"
                        placeholder="Min 4 characters"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowSignupPassword((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-white"
                      >
                        {showSignupPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">Confirm Password</label>
                    <div className="relative">
                      <Key className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-300" />
                      <Input
                        type={showSignupPassword ? "text" : "password"}
                        value={signupData.confirmPassword}
                        onChange={(e) => setSignupData({ ...signupData, confirmPassword: e.target.value })}
                        className="h-11 border-white/10 bg-white/5 pl-10 text-white placeholder:text-slate-500"
                        placeholder="Re-enter password"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">Coversheet Code</label>
                    <Input
                      value={signupData.coversheetCode}
                      onChange={(e) => setSignupData({ ...signupData, coversheetCode: e.target.value.toUpperCase() })}
                      className="h-11 border-white/10 bg-white/5 text-white placeholder:text-slate-500"
                      placeholder="Enter code manually or pick from rep search"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">Find Your Rep Code (Coversheet Rep List)</label>
                    <Input
                      value={signupRepSearch}
                      onChange={(e) => {
                        const value = e.target.value;
                        setSignupRepSearch(value);
                        if (!normalizeText(value) && signupRepAssignedStores.length > 0) {
                          clearSignupRepSelection();
                        }
                      }}
                      className="h-11 border-white/10 bg-white/5 text-white placeholder:text-slate-500"
                      placeholder="Search by rep value, code, or store"
                    />
                    {(signupRepAssignedStores.length > 0 || signupData.coversheetCode) && (
                      <button
                        type="button"
                        onClick={clearSignupRepSelection}
                        className="text-xs font-medium text-rose-300 transition hover:text-rose-200"
                      >
                        Remove selected rep and auto-added stores
                      </button>
                    )}
                    <div className="max-h-36 space-y-1 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-2">
                      {signupRepDirectory.length === 0 ? (
                        <div className="px-2 py-1 text-xs text-slate-400">No coversheet rep values found yet. Upload coversheet data in Admin first.</div>
                      ) : signupRepMatches.length === 0 ? (
                        <div className="px-2 py-1 text-xs text-slate-400">No rep matches found.</div>
                      ) : (
                        signupRepMatches.map((entry) => (
                          <button
                            key={entry.repLabel}
                            type="button"
                            onClick={() => handleSignupSelectRep(entry)}
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-left text-xs text-slate-200 hover:bg-white/10"
                          >
                            <div className="font-semibold text-cyan-200">{entry.repLabel}</div>
                            <div className="text-slate-400">
                              {entry.storeLabels.length > 0
                                ? entry.storeLabels.slice(0, 2).join(" • ")
                                : "No store linked"}
                              {entry.storeLabels.length > 2 ? ` • +${entry.storeLabels.length - 2} more` : ""}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-300">Assign Stores Before Finish</label>
                    <Input
                      value={signupStoreSearch}
                      onChange={(e) => setSignupStoreSearch(e.target.value)}
                      className="h-11 border-white/10 bg-white/5 text-white placeholder:text-slate-500"
                      placeholder="Search stores by name, code, or region"
                    />
                    {signupSelectedStores.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 rounded-xl border border-white/10 bg-black/20 p-2">
                        {signupSelectedStores.map((storeKey) => (
                          <button
                            key={storeKey}
                            type="button"
                            onClick={() => handleSignupRemoveStore(storeKey)}
                            className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-200 hover:bg-cyan-500/20"
                          >
                            {storeKey} ×
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="max-h-36 space-y-1 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-2">
                      {signupStoreMatches.length === 0 ? (
                        <div className="px-2 py-1 text-xs text-slate-400">No stores matched your search.</div>
                      ) : (
                        signupStoreMatches.map((store) => (
                          <button
                            key={store.storeKey}
                            type="button"
                            onClick={() => handleSignupAddStore(store.storeKey)}
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-left text-xs text-slate-200 hover:bg-white/10"
                          >
                            <div className="font-semibold text-cyan-200">{store.storeCode} - {store.storeName}</div>
                            <div className="text-slate-400">{store.region}</div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-3 text-xs text-cyan-200/80">
                    Signing up creates a <strong>Rep</strong> account with access to Overview, Reports, Shifts, Calendar, and Coversheet. Selected stores are saved now so your dashboard opens with the correct scope.
                  </div>

                  <Button type="submit" size="lg" className="cyber-button button-glow h-12 w-full">
                    Create account
                    <UserPlus className="ml-2 h-4 w-4" />
                  </Button>

                  <div className="relative my-4">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-white/10" />
                    </div>
                    <div className="relative flex justify-center text-xs">
                      <span className="bg-slate-950/55 px-3 text-slate-500">or</span>
                    </div>
                  </div>

                  <div className="text-center">
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMode("signin");
                        setBanner({ type: "info", text: "Sign in with your credentials." });
                      }}
                      className="text-sm text-cyan-300 hover:text-cyan-200 transition"
                    >
                      Already have an account? <span className="font-semibold">Sign in</span>
                    </button>
                  </div>
                </motion.form>
              )}
            </motion.div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <App />
    </>
  );
}
