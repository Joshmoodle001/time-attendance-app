import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Eye,
  EyeOff,
  Key,
  Lock,
  LogOut,
  RefreshCw,
  TimerReset,
  User,
} from "lucide-react";

import App from "./App";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  ensureSuperAdminSeeded,
  getAuthSession,
  getDefaultSuperAdminCredentials,
  loginSuperAdmin,
  logoutSuperAdmin,
  resetSuperAdminPassword,
  restoreDefaultSuperAdminPassword,
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
  const [activePanel, setActivePanel] = useState<"login" | "reset">("login");
  const [username, setUsername] = useState(defaults.username);
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [resetUsername, setResetUsername] = useState(defaults.username);
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [banner, setBanner] = useState<Banner | null>({
    type: "info",
    text: "Sign in with your super admin credentials.",
  });

  useEffect(() => {
    ensureSuperAdminSeeded();
  }, []);

  useEffect(() => {
    const existingSession = getAuthSession();
    setSession(existingSession);
    setShowWelcome(false);
    setIsBooting(false);
  }, []);

  const handleLogin = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = loginSuperAdmin(username, password);

    if (!result.success) {
      setBanner({ type: "error", text: result.error });
      return;
    }

    setSession(result.session);
    setShowWelcome(true);
    setPassword("");
    setBanner({ type: "success", text: `Welcome back, ${result.session.username}.` });
  };

  const handleResetPassword = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = resetSuperAdminPassword(resetUsername, newPassword);

    if (!result.success) {
      setBanner({ type: "error", text: result.error });
      return;
    }

    setSession(null);
    setShowWelcome(false);
    setPassword("");
    setNewPassword("");
    setActivePanel("login");
    setBanner({ type: "success", text: result.message });
  };

  const handleRestoreDefault = () => {
    const result = restoreDefaultSuperAdminPassword(resetUsername);

    if (!result.success) {
      setBanner({ type: "error", text: result.error });
      return;
    }

    setSession(null);
    setShowWelcome(false);
    setPassword("");
    setNewPassword("");
    setActivePanel("login");
    setBanner({
      type: "success",
      text: `${result.message} Sign in with your default credentials.`,
    });
  };

  const handleLogout = () => {
    logoutSuperAdmin();
    setSession(null);
    setShowWelcome(false);
    setPassword("");
    setActivePanel("login");
    setBanner({ type: "info", text: "Session ended. Sign in again to continue." });
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
                    <Lock className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-cyan-300">
                      Secure Portal
                    </div>
                    <div className="text-2xl font-bold">Sign in</div>
                  </div>
                </div>

                <div className="rounded-full border border-white/10 bg-white/5 p-1">
                  <button
                    type="button"
                    onClick={() => setActivePanel("login")}
                    className={cn(
                      "rounded-full px-3 py-1.5 text-xs font-semibold transition",
                      activePanel === "login" ? "bg-cyan-500 text-white" : "text-slate-300"
                    )}
                  >
                    Login
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivePanel("reset")}
                    className={cn(
                      "rounded-full px-3 py-1.5 text-xs font-semibold transition",
                      activePanel === "reset" ? "bg-violet-500 text-white" : "text-slate-300"
                    )}
                  >
                    Reset
                  </button>
                </div>
              </div>

              <StatusBanner banner={banner} />

              <AnimatePresence mode="wait">
                {activePanel === "login" ? (
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
                      <label className="text-sm font-medium text-slate-300">Username</label>
                      <div className="relative">
                        <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-300" />
                        <Input
                          value={username}
                          onChange={(event) => setUsername(event.target.value)}
                          className="h-12 border-white/10 bg-white/5 pl-10 text-white placeholder:text-slate-500"
                          placeholder="Super admin username"
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
                  </motion.form>
                ) : (
                  <motion.form
                    key="reset"
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.22 }}
                    onSubmit={handleResetPassword}
                    className="mt-6 space-y-4"
                  >
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-300">Super admin username</label>
                      <div className="relative">
                        <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-violet-300" />
                        <Input
                          value={resetUsername}
                          onChange={(event) => setResetUsername(event.target.value)}
                          className="h-12 border-white/10 bg-white/5 pl-10 text-white placeholder:text-slate-500"
                          placeholder="Account username"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-300">New password</label>
                      <div className="relative">
                        <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-violet-300" />
                        <Input
                          type={showNewPassword ? "text" : "password"}
                          value={newPassword}
                          onChange={(event) => setNewPassword(event.target.value)}
                          className="h-12 border-white/10 bg-white/5 pl-10 pr-12 text-white placeholder:text-slate-500"
                          placeholder="Choose a new password"
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewPassword((current) => !current)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-white"
                        >
                          {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <Button type="submit" size="lg" className="h-12 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:from-violet-500 hover:to-fuchsia-500">
                        Save new password
                      </Button>
                      <Button type="button" size="lg" variant="outline" className="h-12" onClick={handleRestoreDefault}>
                        Restore default password
                      </Button>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
                      Reset is handled locally for this dashboard installation and signs out the current session after changes.
                    </div>
                  </motion.form>
                )}
              </AnimatePresence>
            </motion.div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <App />
      <div className="pointer-events-none fixed right-4 top-4 z-[120]">
        <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2 text-white shadow-[0_20px_60px_rgba(2,6,23,0.5)] backdrop-blur-xl">
          <div className="hidden text-right sm:block">
            <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-300">Signed In</div>
            <div className="text-sm font-medium">{session.username}</div>
          </div>
          <Button variant="outline" size="sm" className="h-9" onClick={handleLogout}>
            <LogOut className="mr-2 h-4 w-4" />
            Logout
          </Button>
        </div>
      </div>
    </>
  );
}
