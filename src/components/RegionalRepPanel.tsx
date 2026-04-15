import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  getStoreAssignments,
  saveStoreAssignments,
  getAllStores,
  getAssignedEmployees,
  type StoreInfo,
  type StoreAssignment,
} from "@/services/storeAssignments";
import { getAuthSession, getRoleLabel, type AuthSession, type AuthRole } from "@/services/auth";
import { getEmployees, type Employee } from "@/services/database";
import { getAttendanceByDate } from "@/services/database";
import {
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  FileSpreadsheet,
  LayoutGrid,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  Store,
  Trash2,
  UserCheck,
  Users,
  X,
} from "lucide-react";

type RepTab = "overview" | "profile" | "shifts" | "reports";

function normalizeText(value: unknown) {
  return value === null || value === undefined ? "" : String(value).replace(/\s+/g, " ").trim();
}

function formatDate(dateStr: string) {
  if (!dateStr) return "";
  try {
    return new Date(dateStr).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return dateStr;
  }
}

export default function RegionalRepPanel({ session }: { session: AuthSession }) {
  const [activeTab, setActiveTab] = useState<RepTab>("overview");
  const [allStores, setAllStores] = useState<StoreInfo[]>([]);
  const [assignedStoreKeys, setAssignedStoreKeys] = useState<string[]>([]);
  const [assignedEmployees, setAssignedEmployees] = useState<Employee[]>([]);
  const [storeSearch, setStoreSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [expandedStore, setExpandedStore] = useState<string | null>(null);

  const isRep = session.role === "rep";
  const isDivisional = session.role === "divisional";
  const isRegional = session.role === "regional";
  const roleLabel = getRoleLabel(session.role);

  const tabs: { key: RepTab; label: string; icon: typeof Building2 }[] = [
    { key: "overview", label: "Overview", icon: LayoutGrid },
    { key: "profile", label: "My Stores", icon: Store },
    { key: "shifts", label: "Shifts", icon: Clock },
    { key: "reports", label: "Reports", icon: FileSpreadsheet },
  ];

  const loadData = async () => {
    setLoading(true);
    try {
      const [stores, keys, emps] = await Promise.all([
        getAllStores(),
        getStoreAssignments(session.username),
        getAssignedEmployees(session.username),
      ]);
      setAllStores(stores);
      setAssignedStoreKeys(keys);
      setAssignedEmployees(emps);
    } catch (err) {
      console.error("Failed to load store data:", err);
      setMessage("Failed to load store data. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const filteredStores = useMemo(() => {
    const q = storeSearch.toLowerCase();
    if (!q) return allStores;
    return allStores.filter(
      (s) =>
        s.storeName.toLowerCase().includes(q) ||
        s.storeCode.includes(q) ||
        s.region.toLowerCase().includes(q)
    );
  }, [allStores, storeSearch]);

  const assignedStoreInfos = useMemo(() => {
    return allStores.filter((s) => assignedStoreKeys.some((k) => k === s.storeKey || k === s.storeName || k === s.storeCode));
  }, [allStores, assignedStoreKeys]);

  const handleAddStore = async (store: StoreInfo) => {
    if (assignedStoreKeys.includes(store.storeKey)) return;
    const next = [...assignedStoreKeys, store.storeKey];
    setSaving(true);
    setMessage("");
    try {
      const result = await saveStoreAssignments(session.username, next);
      if (result.success) {
        setAssignedStoreKeys(next);
        const emps = await getAssignedEmployees(session.username);
        setAssignedEmployees(emps);
        setMessage(`Added ${store.storeName} to your profile.`);
      } else {
        setMessage(result.error || "Failed to save.");
      }
    } catch (err) {
      setMessage("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveStore = async (storeKey: string) => {
    const next = assignedStoreKeys.filter((k) => k !== storeKey);
    setSaving(true);
    setMessage("");
    try {
      const result = await saveStoreAssignments(session.username, next);
      if (result.success) {
        setAssignedStoreKeys(next);
        const emps = await getAssignedEmployees(session.username);
        setAssignedEmployees(emps);
        setMessage("Store removed from your profile.");
      } else {
        setMessage(result.error || "Failed to save.");
      }
    } catch (err) {
      setMessage("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const storeKeyToInfo = (key: string) => allStores.find((s) => s.storeKey === key || s.storeName === key || s.storeCode === key);

  const renderOverview = () => {
    const totalEmployees = assignedEmployees.length;
    const atWorkCount = assignedEmployees.filter((e) => e.status === "active").length;

    return (
      <div className="space-y-6">
        <Card className="rounded-2xl border-white/10 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
          <CardHeader>
            <CardTitle className="text-2xl font-bold text-white">
              Welcome, {session.name || session.username.split("@")[0]}
            </CardTitle>
            <CardDescription className="text-slate-400">
              {roleLabel} dashboard &middot; {assignedStoreInfos.length} store{assignedStoreInfos.length !== 1 ? "s" : ""} assigned &middot; {totalEmployees} employee{totalEmployees !== 1 ? "s" : ""}
            </CardDescription>
          </CardHeader>
        </Card>

        <div className="grid gap-4 md:grid-cols-3">
          <Card className="rounded-2xl border-white/10 bg-slate-900/80 text-white">
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-500/20">
                  <Store className="h-6 w-6 text-cyan-400" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-white">{assignedStoreInfos.length}</div>
                  <div className="text-xs text-slate-400">Assigned Stores</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-white/10 bg-slate-900/80 text-white">
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/20">
                  <Users className="h-6 w-6 text-emerald-400" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-white">{totalEmployees}</div>
                  <div className="text-xs text-slate-400">Total Employees</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-white/10 bg-slate-900/80 text-white">
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-500/20">
                  <UserCheck className="h-6 w-6 text-purple-400" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-white">{atWorkCount}</div>
                  <div className="text-xs text-slate-400">Active</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {assignedStoreInfos.length > 0 ? (
          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-white">Your Stores</h3>
            {assignedStoreInfos.map((store) => {
              const storeEmps = assignedEmployees.filter(
                (e) => e.store === store.storeName || e.store_code === store.storeCode
              );
              return (
                <Card key={store.storeKey} className="rounded-2xl border-white/10 bg-slate-900/80 text-white">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-white">{store.storeName}</div>
                        <div className="text-xs text-slate-400 flex items-center gap-2 mt-1">
                          <MapPin className="h-3 w-3" />
                          {store.region} &middot; Code: {store.storeCode} &middot; {storeEmps.length} employees
                        </div>
                      </div>
                      <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        Active
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card className="rounded-2xl border-dashed border-slate-700 bg-slate-900/80 text-white">
            <CardContent className="p-8 text-center">
              <Store className="h-12 w-12 mx-auto mb-3 text-slate-600" />
              <h3 className="text-lg font-semibold text-white mb-1">No stores assigned yet</h3>
              <p className="text-sm text-slate-400">Go to "My Stores" to assign stores to your profile.</p>
              <Button variant="outline" className="mt-4 border-slate-600 text-white hover:bg-slate-800" onClick={() => setActiveTab("profile")}>
                <Plus className="mr-2 h-4 w-4" />
                Assign stores
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    );
  };

  const renderProfile = () => (
    <div className="space-y-6">
      <Card className="rounded-2xl border-white/10 bg-slate-900/80 text-white">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-white">Profile & Store Assignments</CardTitle>
              <CardDescription className="text-slate-400">
                Manage which stores are assigned to your {roleLabel} profile. Employees from these stores will appear in your view.
              </CardDescription>
            </div>
            <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30">
              {roleLabel}
            </Badge>
          </div>
        </CardHeader>
      </Card>

      {message && (
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-3 text-sm text-slate-300">
          {message}
        </div>
      )}

      {assignedStoreKeys.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-white">Assigned Stores ({assignedStoreKeys.length})</h3>
          {assignedStoreKeys.map((key) => {
            const info = storeKeyToInfo(key);
            const storeEmps = assignedEmployees.filter(
              (e) => e.store === (info?.storeName || key) || e.store_code === (info?.storeCode || key)
            );
            return (
              <Card key={key} className="rounded-2xl border-white/10 bg-slate-900/80 text-white">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="font-semibold text-white">{info?.storeName || key}</div>
                      <div className="text-xs text-slate-400 flex items-center gap-2 mt-1">
                        {info && (
                          <>
                            <MapPin className="h-3 w-3" />
                            {info.region} &middot; Code: {info.storeCode} &middot; {storeEmps.length} employees
                          </>
                        )}
                      </div>
                      <button
                        className="mt-2 text-xs text-slate-400 hover:text-white flex items-center gap-1"
                        onClick={() => setExpandedStore(expandedStore === key ? null : key)}
                      >
                        {expandedStore === key ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        {storeEmps.length} employee{storeEmps.length !== 1 ? "s" : ""}
                      </button>
                      {expandedStore === key && storeEmps.length > 0 && (
                        <div className="mt-2 max-h-48 overflow-y-auto space-y-1">
                          {storeEmps.map((emp) => (
                            <div key={emp.id} className="flex items-center gap-2 rounded-lg bg-slate-800/50 px-2 py-1 text-xs text-slate-300">
                              <span className="font-medium">{emp.first_name} {emp.last_name}</span>
                              <span className="text-slate-500">{emp.employee_code}</span>
                              <span className="text-slate-500">{emp.job_title}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-2 border-red-500/30 text-red-400 hover:bg-red-500/10"
                      onClick={() => void handleRemoveStore(key)}
                      disabled={saving}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="rounded-2xl border-white/10 bg-slate-900/80 text-white">
        <CardHeader>
          <CardTitle className="text-white text-base">Add Stores</CardTitle>
          <CardDescription className="text-slate-400">Search and add stores to your profile.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
            <Input
              placeholder="Search stores by name, code, or region..."
              value={storeSearch}
              onChange={(e) => setStoreSearch(e.target.value)}
              className="pl-10 bg-slate-800 border-slate-700 text-white"
            />
          </div>

          <div className="max-h-80 overflow-y-auto space-y-2">
            {loading ? (
              <div className="py-8 text-center text-slate-500">Loading stores...</div>
            ) : filteredStores.length === 0 ? (
              <div className="py-8 text-center text-slate-500">
                {storeSearch ? "No stores match your search." : "No stores available. Upload employee data first."}
              </div>
            ) : (
              filteredStores.slice(0, 50).map((store) => {
                const isAssigned = assignedStoreKeys.some(
                  (k) => k === store.storeKey || k === store.storeName || k === store.storeCode
                );
                return (
                  <div
                    key={store.storeKey}
                    className={`flex items-center justify-between rounded-xl border p-3 transition-colors ${
                      isAssigned
                        ? "border-emerald-500/30 bg-emerald-500/5"
                        : "border-slate-700 bg-slate-800/50 hover:border-slate-600"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white truncate">{store.storeName}</div>
                      <div className="text-xs text-slate-400">
                        {store.region && `${store.region} · `}Code: {store.storeCode} · {store.employeeCount} employees
                      </div>
                    </div>
                    {isAssigned ? (
                      <Badge className="ml-2 bg-emerald-500/20 text-emerald-400 border-emerald-500/30 shrink-0">
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        Assigned
                      </Badge>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="ml-2 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 shrink-0"
                        onClick={() => void handleAddStore(store)}
                        disabled={saving}
                      >
                        <Plus className="mr-1 h-3 w-3" />
                        Add
                      </Button>
                    )}
                  </div>
                );
              })
            )}
          </div>
          {filteredStores.length > 50 && (
            <div className="text-xs text-slate-500 text-center">
              Showing 50 of {filteredStores.length} stores. Use search to narrow results.
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-white/10 bg-slate-900/80 text-white">
        <CardHeader>
          <CardTitle className="text-white text-base">Your Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="text-xs text-slate-500 uppercase tracking-wider">Name</div>
              <div className="mt-1 text-white font-medium">{session.name || "Not set"}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500 uppercase tracking-wider">Surname</div>
              <div className="mt-1 text-white font-medium">{session.surname || "Not set"}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500 uppercase tracking-wider">Email</div>
              <div className="mt-1 text-white font-medium">{session.username}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500 uppercase tracking-wider">Role</div>
              <div className="mt-1">
                <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30">{roleLabel}</Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderShifts = () => {
    const storeNames = assignedStoreInfos.map((s) => s.storeName);
    return (
      <div className="space-y-6">
        <Card className="rounded-2xl border-white/10 bg-slate-900/80 text-white">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-white">Shift Search</CardTitle>
                <CardDescription className="text-slate-400">
                  Search and view shifts for your assigned stores.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                className="border-slate-600 text-white hover:bg-slate-800"
                onClick={() => void loadData()}
                disabled={loading}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </CardHeader>
        </Card>

        {assignedStoreInfos.length === 0 ? (
          <Card className="rounded-2xl border-dashed border-slate-700 bg-slate-900/80 text-white">
            <CardContent className="p-8 text-center">
              <Clock className="h-12 w-12 mx-auto mb-3 text-slate-600" />
              <h3 className="text-lg font-semibold text-white mb-1">No shifts to show</h3>
              <p className="text-sm text-slate-400">Assign stores to your profile first to view their shifts.</p>
              <Button variant="outline" className="mt-4 border-slate-600 text-white hover:bg-slate-800" onClick={() => setActiveTab("profile")}>
                <Store className="mr-2 h-4 w-4" />
                Assign stores
              </Button>
            </CardContent>
          </Card>
        ) : (
          <ShiftSearchByStores storeNames={storeNames} />
        )}
      </div>
    );
  };

  const renderReports = () => (
    <div className="space-y-6">
      <Card className="rounded-2xl border-white/10 bg-slate-900/80 text-white">
        <CardHeader>
          <CardTitle className="text-white">Reports</CardTitle>
          <CardDescription className="text-slate-400">
            View attendance and employee reports for your assigned stores.
          </CardDescription>
        </CardHeader>
      </Card>

      {assignedStoreInfos.length === 0 ? (
        <Card className="rounded-2xl border-dashed border-slate-700 bg-slate-900/80 text-white">
          <CardContent className="p-8 text-center">
            <FileSpreadsheet className="h-12 w-12 mx-auto mb-3 text-slate-600" />
            <h3 className="text-lg font-semibold text-white mb-1">No reports available</h3>
            <p className="text-sm text-slate-400">Assign stores to your profile first to generate reports.</p>
            <Button variant="outline" className="mt-4 border-slate-600 text-white hover:bg-slate-800" onClick={() => setActiveTab("profile")}>
              <Store className="mr-2 h-4 w-4" />
              Assign stores
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ReportByStores storeInfos={assignedStoreInfos} employees={assignedEmployees} />
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
                isActive
                  ? "bg-gradient-to-r from-cyan-500/20 to-purple-500/20 text-white border border-cyan-500/30"
                  : "text-slate-400 hover:text-white hover:bg-slate-800/50 border border-transparent"
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "overview" && renderOverview()}
      {activeTab === "profile" && renderProfile()}
      {activeTab === "shifts" && renderShifts()}
      {activeTab === "reports" && renderReports()}
    </div>
  );
}

function ShiftSearchByStores({ storeNames }: { storeNames: string[] }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [rosterData, setRosterData] = useState<Array<{ sheet_name: string; store_name: string; rows: Record<string, string>[] }>>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void loadRosters();
  }, []);

  const loadRosters = async () => {
    setLoading(true);
    try {
      const { getShiftRosters } = await import("@/services/shifts");
      const rosters = await getShiftRosters();
      const filtered = rosters.filter(
        (r) => storeNames.some((s) => s.toLowerCase() === (r.store_name || "").toLowerCase()) || storeNames.length === 0
      );
      setRosterData(filtered.map((r) => ({ sheet_name: r.sheet_name, store_name: r.store_name || r.sheet_name, rows: (r.rows as unknown as Record<string, string>[]) || [] })));
    } catch (err) {
      console.error("Failed to load shift rosters:", err);
    } finally {
      setLoading(false);
    }
  };

  const filteredRosters = rosterData.filter((r) => {
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return r.store_name.toLowerCase().includes(q) || r.sheet_name.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
        <Input
          placeholder="Search shifts by store name..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10 bg-slate-800 border-slate-700 text-white"
        />
      </div>

      {loading ? (
        <div className="py-8 text-center text-slate-500">Loading shifts...</div>
      ) : filteredRosters.length === 0 ? (
        <div className="py-8 text-center text-slate-500">No shifts found for your stores.</div>
      ) : (
        filteredRosters.slice(0, 20).map((roster) => (
          <Card key={roster.sheet_name} className="rounded-2xl border-white/10 bg-slate-900/80 text-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-white">{roster.store_name}</CardTitle>
              <CardDescription className="text-slate-400 text-xs">{roster.rows.length} shift entries</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="max-h-48 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-700">
                      {roster.rows.length > 0 &&
                        Object.keys(roster.rows[0]).slice(0, 6).map((key) => (
                          <th key={key} className="px-2 py-1 text-left font-medium">{key}</th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    {roster.rows.slice(0, 10).map((row, idx) => (
                      <tr key={idx} className="border-b border-slate-800">
                        {Object.values(row).slice(0, 6).map((val, ci) => (
                          <td key={ci} className="px-2 py-1 text-slate-300">{String(val || "")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {roster.rows.length > 10 && (
                  <div className="text-xs text-slate-500 mt-1">Showing 10 of {roster.rows.length} entries</div>
                )}
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

function ReportByStores({ storeInfos, employees }: { storeInfos: StoreInfo[]; employees: Employee[] }) {
  const [reportDate, setReportDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [records, setRecords] = useState<Array<Record<string, string>>>([]);
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    if (!reportDate) return;
    setLoading(true);
    try {
      const data = await getAttendanceByDate(reportDate);
      const storeNames = storeInfos.map((s) => s.storeName);
      const storeCodes = storeInfos.map((s) => s.storeCode);
      const filtered = data.filter(
        (r) =>
          storeNames.some((s) => s.toLowerCase() === (r.store || "").toLowerCase()) ||
          storeCodes.some((c) => c === (r.store_code || ""))
      );
      setRecords(filtered as unknown as Array<Record<string, string>>);
    } catch (err) {
      console.error("Failed to generate report:", err);
    } finally {
      setLoading(false);
    }
  };

  const formatCsv = () => {
    if (records.length === 0) return "";
    const headers = Object.keys(records[0]).filter((k) => !["id", "created_at"].includes(k));
    const rows = records.map((r) => headers.map((h) => String(r[h] || "")).join(","));
    return [headers.join(","), ...rows].join("\n");
  };

  const downloadCsv = () => {
    const csv = formatCsv();
    if (!csv) return;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance-report-${reportDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl border-white/10 bg-slate-900/80 text-white">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-48">
              <label className="block text-xs text-slate-400 mb-1">Report Date</label>
              <Input
                type="date"
                value={reportDate}
                onChange={(e) => setReportDate(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>
            <Button
              className="bg-gradient-to-r from-cyan-500 to-purple-500 text-white hover:opacity-90"
              onClick={() => void handleGenerate()}
              disabled={loading}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Generate
            </Button>
            {records.length > 0 && (
              <Button variant="outline" className="border-slate-600 text-white hover:bg-slate-800" onClick={downloadCsv}>
                Download CSV
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {records.length > 0 && (
        <Card className="rounded-2xl border-white/10 bg-slate-900/80 text-white">
          <CardHeader>
            <CardTitle className="text-white text-base">
              Attendance Report &middot; {reportDate} &middot; {records.length} records
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-700">
                    <th className="px-2 py-1 text-left">Name</th>
                    <th className="px-2 py-1 text-left">Store</th>
                    <th className="px-2 py-1 text-left">Status</th>
                    <th className="px-2 py-1 text-left">Scheduled</th>
                    <th className="px-2 py-1 text-left">Clocked</th>
                  </tr>
                </thead>
                <tbody>
                  {records.slice(0, 100).map((r, i) => (
                    <tr key={i} className="border-b border-slate-800">
                      <td className="px-2 py-1 text-white">{r.name || r.employee_code || "-"}</td>
                      <td className="px-2 py-1 text-slate-300">{r.store || "-"}</td>
                      <td className="px-2 py-1 text-slate-300">{r.status_label || r.problem || "-"}</td>
                      <td className="px-2 py-1 text-slate-300">{r.scheduled || "-"}</td>
                      <td className="px-2 py-1 text-slate-300">{r.clock_count || "0"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {records.length > 100 && (
                <div className="text-xs text-slate-500 mt-2 text-center">Showing 100 of {records.length} records</div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {records.length === 0 && !loading && reportDate && (
        <Card className="rounded-2xl border-dashed border-slate-700 bg-slate-900/80 text-white">
          <CardContent className="p-8 text-center">
            <FileSpreadsheet className="h-10 w-10 mx-auto mb-2 text-slate-600" />
            <p className="text-slate-400">Click Generate to view the attendance report for {reportDate}.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}