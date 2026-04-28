import { useState, useEffect } from "react";
import {
  Users,
  Database,
  Server,
  FileText,
  Plus,
  Trash2,
  Edit3,
  Key,
  Search,
  RefreshCw,
  Shield,
  XCircle,
  AlertTriangle,
  Clock,
  ShieldCheck,
  LayoutGrid,
  Eye,
  EyeOff,
  Copy,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DEFAULT_SUPER_ADMIN_USERNAME, getUsers, createUser, updateUser, deleteUser, resetUserPassword, getLogs, clearLogs, getRoleLabel, getAllRoles, type AuthSession, type AuthRole, type AuthUser } from "@/services/auth";

type Tab = "users" | "database" | "vercel" | "logs";

const ROLE_COLORS: Record<AuthRole, string> = {
  super_admin: "bg-red-500/20 text-red-400 border-red-500/30",
  admin: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  divisional: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  regional: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  rep: "bg-green-500/20 text-green-400 border-green-500/30",
};

export default function SuperAdminPanel({ session }: { session: AuthSession }) {
  const isRootSuperAdmin = session.username.toLowerCase() === DEFAULT_SUPER_ADMIN_USERNAME.toLowerCase();
  const [activeTab, setActiveTab] = useState<Tab>("users");
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [logs, setLogs] = useState<Array<{ timestamp: string; action: string; user?: string; details: string }>>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState<AuthUser | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(new Set());
  const [copiedPassword, setCopiedPassword] = useState<string | null>(null);

  const loadData = () => {
    setUsers(getUsers());
    setLogs(getLogs());
  };

  useEffect(() => {
    loadData();
  }, []);

  const filteredUsers = users.filter(user =>
    user.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.surname.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.role.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleCreateUser = async (data: { username: string; password: string; role: AuthRole; name: string; surname: string }) => {
    setIsLoading(true);
    const result = createUser(session, data);
    setIsLoading(false);
    if (result.success) {
      loadData();
      setShowCreateModal(false);
    }
    return result;
  };

  const handleUpdateUser = async (username: string, updates: { name?: string; surname?: string; role?: AuthRole; active?: boolean }) => {
    setIsLoading(true);
    const result = updateUser(session, username, updates);
    setIsLoading(false);
    if (result.success) {
      loadData();
      setShowEditModal(null);
    }
    return result;
  };

  const handleResetPassword = async (username: string, newPassword: string) => {
    const result = resetUserPassword(session, username, newPassword);
    if (result.success) {
      loadData();
    }
    return result;
  };

  const handleDeleteUser = (username: string) => {
    const result = deleteUser(session, username);
    if (result.success) {
      loadData();
      setShowDeleteConfirm(null);
    }
    return result;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-red-500 to-orange-500">
          <Shield className="h-6 w-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Super Admin</h1>
          <p className="text-sm text-slate-400">Manage users, database, and system settings</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-700 pb-2">
        <TabButton active={activeTab === "users"} onClick={() => setActiveTab("users")} icon={Users} label="Users" />
        <TabButton active={activeTab === "database"} onClick={() => setActiveTab("database")} icon={Database} label="Database" />
        <TabButton active={activeTab === "vercel"} onClick={() => setActiveTab("vercel")} icon={Server} label="Vercel" />
        <TabButton active={activeTab === "logs"} onClick={() => setActiveTab("logs")} icon={FileText} label="Logs" />
      </div>

      {/* Users Tab */}
      {activeTab === "users" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search users..."
                className="pl-9 bg-slate-800 border-slate-700 text-white"
              />
            </div>
            <Button onClick={() => setShowCreateModal(true)} className="bg-cyan-500 hover:bg-cyan-600">
              <Plus className="h-4 w-4 mr-2" />
              Add User
            </Button>
            <Button variant="outline" onClick={loadData}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredUsers.map((user) => (
              <Card key={user.username} className="bg-slate-800/50 border-slate-700">
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`flex h-10 w-10 items-center justify-center rounded-full ${user.active ? "bg-cyan-500/20" : "bg-slate-700"}`}>
                          {user.active ? (
                            <ShieldCheck className="h-5 w-5 text-cyan-400" />
                          ) : (
                            <XCircle className="h-5 w-5 text-slate-500" />
                          )}
                        </div>
                        <div>
                          <div className="font-medium text-white">{user.name} {user.surname}</div>
                          <div className="text-xs text-slate-400">{user.username}</div>
                        </div>
                      </div>
                      <Badge className={ROLE_COLORS[user.role]}>{getRoleLabel(user.role)}</Badge>
                    </div>
                    <div className="mb-3 rounded-lg border border-slate-700/50 bg-slate-900/50 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <Key className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                          {visiblePasswords.has(user.username) ? (
                            <span className="text-sm text-slate-200 font-mono truncate">{user.secret}</span>
                          ) : (
                            <span className="text-sm text-slate-500 font-mono tracking-widest">••••••••</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => {
                              const next = new Set(visiblePasswords);
                              if (next.has(user.username)) next.delete(user.username);
                              else next.add(user.username);
                              setVisiblePasswords(next);
                            }}
                            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition"
                            title={visiblePasswords.has(user.username) ? "Hide password" : "Show password"}
                          >
                            {visiblePasswords.has(user.username) ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                          <button
                            onClick={() => {
                              navigator.clipboard?.writeText(user.secret);
                              setCopiedPassword(user.username);
                              setTimeout(() => setCopiedPassword(null), 1500);
                            }}
                            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition"
                            title="Copy password"
                          >
                            {copiedPassword === user.username ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </div>
                    </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => setShowEditModal(user)}
                    >
                      <Edit3 className="h-3 w-3 mr-1" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => {
                        const newPassword = prompt("Enter new password for " + user.username + ":");
                        if (newPassword) handleResetPassword(user.username, newPassword);
                      }}
                    >
                      <Key className="h-3 w-3 mr-1" />
                      Reset
                    </Button>
                    {(user.role !== "super_admin" || isRootSuperAdmin) && user.username.toLowerCase() !== DEFAULT_SUPER_ADMIN_USERNAME.toLowerCase() && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-red-400 border-red-500/30 hover:bg-red-500/10"
                        onClick={() => setShowDeleteConfirm(user)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {filteredUsers.length === 0 && (
            <div className="text-center py-12 text-slate-400">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <div>No users found</div>
            </div>
          )}
        </div>
      )}

      {/* Database Tab */}
      {activeTab === "database" && <DatabaseSchemaView />}

      {/* Vercel Tab */}
      {activeTab === "vercel" && <VercelInfoPanel />}

      {/* Logs Tab */}
      {activeTab === "logs" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-white">Admin Logs</h2>
            <Button variant="outline" size="sm" onClick={() => { clearLogs(); loadData(); }} className="text-red-400 border-red-500/30">
              Clear Logs
            </Button>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-800/50 overflow-hidden">
            <div className="max-h-[600px] overflow-y-auto">
              {logs.map((log, index) => (
                <div key={index} className="flex items-start gap-4 px-4 py-3 border-b border-slate-700/50 hover:bg-slate-700/30">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-700">
                    <Clock className="h-4 w-4 text-slate-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className={getLogBadgeClass(log.action)}>{log.action}</Badge>
                      {log.user && <span className="text-sm text-cyan-400">{log.user}</span>}
                    </div>
                    <div className="text-sm text-slate-400">{log.details}</div>
                    <div className="text-xs text-slate-500 mt-1">{new Date(log.timestamp).toLocaleString()}</div>
                  </div>
                </div>
              ))}
              {logs.length === 0 && (
                <div className="text-center py-12 text-slate-400">
                  <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <div>No logs yet</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create User Modal */}
      {showCreateModal && (
        <UserModal
          title="Create User"
          onClose={() => setShowCreateModal(false)}
          onSubmit={handleCreateUser}
          isLoading={isLoading}
          roles={getAllRoles()}
        />
      )}

      {/* Edit User Modal */}
      {showEditModal && (
        <UserModal
          title="Edit User"
          user={showEditModal}
          onClose={() => setShowEditModal(null)}
          onSubmit={(data) => handleUpdateUser(showEditModal.username, data)}
          onPasswordReset={(password) => handleResetPassword(showEditModal.username, password)}
          isLoading={isLoading}
          roles={getAllRoles()}
          canChangeRole={isRootSuperAdmin || showEditModal.role !== "super_admin" || session.username === showEditModal.username}
        />
      )}

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <Card className="w-full max-w-md bg-slate-900 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-400" />
                Confirm Delete
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-slate-300 mb-4">
                Are you sure you want to delete user <strong>{showDeleteConfirm.username}</strong>?
                This action cannot be undone.
              </p>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setShowDeleteConfirm(null)}>
                  Cancel
                </Button>
                <Button
                  className="flex-1 bg-red-500 hover:bg-red-600"
                  onClick={() => handleDeleteUser(showDeleteConfirm.username)}
                >
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: React.ElementType; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
        active ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30" : "text-slate-400 hover:text-white hover:bg-slate-800"
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function UserModal({
  title,
  user,
  onClose,
  onSubmit,
  onPasswordReset,
  isLoading,
  roles,
  canChangeRole = true,
}: {
  title: string;
  user?: AuthUser;
  onClose: () => void;
  onSubmit: (data: any) => Promise<{ success: boolean; error?: string }>;
  onPasswordReset?: (password: string) => Promise<{ success: boolean; error?: string }>;
  isLoading: boolean;
  roles: AuthRole[];
  canChangeRole?: boolean;
}) {
  const [formData, setFormData] = useState({
    username: user?.username || "",
    password: "",
    role: user?.role || "rep",
    name: user?.name || "",
    surname: user?.surname || "",
    active: user?.active ?? true,
  });
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!user && !formData.password) {
      setError("Password is required for new users");
      return;
    }

    const result = user
      ? await onSubmit({ name: formData.name, surname: formData.surname, role: formData.role, active: formData.active })
      : await onSubmit(formData);

    if (!result.success && result.error) {
      setError(result.error);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <Card className="w-full max-w-md bg-slate-900 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Email</label>
              <Input
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value.toLowerCase() })}
                disabled={!!user}
                className="bg-slate-800 border-slate-700 text-white disabled:opacity-50"
                placeholder="user@example.com"
              />
            </div>

            {!user && (
              <div>
                <label className="block text-sm text-slate-400 mb-1">Password</label>
                <Input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="bg-slate-800 border-slate-700 text-white"
                  placeholder="Enter password"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Name</label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="bg-slate-800 border-slate-700 text-white"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Surname</label>
                <Input
                  value={formData.surname}
                  onChange={(e) => setFormData({ ...formData, surname: e.target.value })}
                  className="bg-slate-800 border-slate-700 text-white"
                />
              </div>
            </div>

            {canChangeRole && (
              <div>
                <label className="block text-sm text-slate-400 mb-1">Role</label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as AuthRole })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white"
                >
                  {roles.map((role) => (
                    <option key={role} value={role}>{getRoleLabel(role)}</option>
                  ))}
                </select>
              </div>
            )}

            {user && user.role !== "super_admin" && (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="active"
                  checked={formData.active}
                  onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                  className="rounded border-slate-600"
                />
                <label htmlFor="active" className="text-sm text-slate-300">Active</label>
              </div>
            )}

            {user && onPasswordReset && (
              <div>
                <label className="block text-sm text-slate-400 mb-1">Reset Password</label>
                <Input
                  type="password"
                  placeholder="New password"
                  onChange={(e) => {}}
                  className="bg-slate-800 border-slate-700 text-white"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const newPassword = (e.target as HTMLInputElement).value;
                      if (newPassword) {
                        onPasswordReset(newPassword);
                        (e.target as HTMLInputElement).value = "";
                      }
                    }
                  }}
                />
              </div>
            )}

            {error && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1 bg-cyan-500 hover:bg-cyan-600" disabled={isLoading}>
                {isLoading ? "Saving..." : user ? "Update" : "Create"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function getLogBadgeClass(action: string): string {
  if (action.includes("CREATED")) return "bg-green-500/20 text-green-400 border-green-500/30";
  if (action.includes("DELETED")) return "bg-red-500/20 text-red-400 border-red-500/30";
  if (action.includes("UPDATED") || action.includes("CHANGED")) return "bg-blue-500/20 text-blue-400 border-blue-500/30";
  if (action.includes("FAILED")) return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
  if (action.includes("SUCCESS")) return "bg-green-500/20 text-green-400 border-green-500/30";
  return "bg-slate-500/20 text-slate-400 border-slate-500/30";
}

function DatabaseSchemaView() {
  const schema = [
    {
      name: "employees",
      description: "Employee profiles with all personal and work details",
      fields: [
        { name: "id", type: "uuid", description: "Primary key" },
        { name: "employee_code", type: "varchar", description: "Unique employee identifier" },
        { name: "first_name", type: "varchar", description: "Employee first name" },
        { name: "last_name", type: "varchar", description: "Employee surname" },
        { name: "email", type: "varchar", description: "Email address" },
        { name: "region", type: "varchar", description: "Region assignment" },
        { name: "store", type: "varchar", description: "Store location" },
        { name: "status", type: "varchar", description: "active, inactive, terminated" },
        { name: "created_at", type: "timestamp", description: "Record creation time" },
        { name: "updated_at", type: "timestamp", description: "Last update time" },
      ],
    },
    {
      name: "attendance",
      description: "Daily attendance records",
      fields: [
        { name: "id", type: "uuid", description: "Primary key" },
        { name: "employee_code", type: "varchar", description: "Link to employee" },
        { name: "date", type: "date", description: "Attendance date" },
        { name: "status", type: "varchar", description: "P, A, L, etc." },
        { name: "region", type: "varchar", description: "Region at time of attendance" },
        { name: "store", type: "varchar", description: "Store at time of attendance" },
        { name: "created_at", type: "timestamp", description: "Record creation time" },
      ],
    },
    {
      name: "clock_events",
      description: "Biometric clock events from devices",
      fields: [
        { name: "id", type: "uuid", description: "Primary key" },
        { name: "employee_code", type: "varchar", description: "Link to employee" },
        { name: "clock_date", type: "date", description: "Date of clock event" },
        { name: "clock_time", type: "time", description: "Time of clock event" },
        { name: "direction", type: "varchar", description: "In or Out" },
        { name: "device_name", type: "varchar", description: "Clocking device" },
        { name: "store", type: "varchar", description: "Store location" },
        { name: "created_at", type: "timestamp", description: "Record creation time" },
      ],
    },
    {
      name: "shift_rosters",
      description: "Shift roster data synced from Google Sheets",
      fields: [
        { name: "id", type: "uuid", description: "Primary key" },
        { name: "sheet_name", type: "varchar", description: "Source sheet name" },
        { name: "store_name", type: "varchar", description: "Store name" },
        { name: "date", type: "date", description: "Shift date" },
        { name: "employee_code", type: "varchar", description: "Employee identifier" },
        { name: "start_time", type: "time", description: "Shift start" },
        { name: "end_time", type: "time", description: "Shift end" },
        { name: "created_at", type: "timestamp", description: "Record creation time" },
      ],
    },
    {
      name: "leave_applications",
      description: "Employee leave requests",
      fields: [
        { name: "id", type: "uuid", description: "Primary key" },
        { name: "employee_code", type: "varchar", description: "Link to employee" },
        { name: "leave_type", type: "varchar", description: "Type of leave" },
        { name: "start_date", type: "date", description: "Leave start" },
        { name: "end_date", type: "date", description: "Leave end" },
        { name: "status", type: "varchar", description: "pending, approved, rejected" },
        { name: "created_at", type: "timestamp", description: "Record creation time" },
      ],
    },
    {
      name: "calendar_events",
      description: "Calendar events and public holidays",
      fields: [
        { name: "id", type: "uuid", description: "Primary key" },
        { name: "title", type: "varchar", description: "Event title" },
        { name: "date", type: "date", description: "Event date" },
        { name: "event_type", type: "varchar", description: "holiday, meeting, etc." },
        { name: "created_at", type: "timestamp", description: "Record creation time" },
      ],
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Database Schema</h2>
        <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30">
          {schema.length} Tables
        </Badge>
      </div>

      <div className="space-y-4">
        {schema.map((table) => (
          <Card key={table.name} className="bg-slate-800/50 border-slate-700">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-cyan-400" />
                <CardTitle className="text-white text-lg">{table.name}</CardTitle>
              </div>
              <p className="text-sm text-slate-400">{table.description}</p>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className="text-left py-2 px-3 text-cyan-400 font-medium">Column</th>
                      <th className="text-left py-2 px-3 text-cyan-400 font-medium">Type</th>
                      <th className="text-left py-2 px-3 text-cyan-400 font-medium">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {table.fields.map((field) => (
                      <tr key={field.name} className="border-b border-slate-700/50">
                        <td className="py-2 px-3 text-white font-mono">{field.name}</td>
                        <td className="py-2 px-3 text-purple-400 font-mono">{field.type}</td>
                        <td className="py-2 px-3 text-slate-400">{field.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function VercelInfoPanel() {
  const vercelInfo = {
    project: "time-attendance-app-main",
    url: "https://time-attendance-app-main.vercel.app",
    region: "Washington, D.C., USA (East) – iad1",
    buildTime: "~3-4 seconds",
    framework: "Vite + React",
    nodeVersion: "18.x",
  };

  const supabaseInfo = {
    projectId: "reonusfvugpusmewacqz",
    url: "https://reonusfvugpusmewacqz.supabase.co",
    region: "AWS Africa (Cape Town)",
    status: "Active",
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-white">Infrastructure Overview</h2>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <Server className="h-5 w-5 text-cyan-400" />
              Vercel Deployment
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <InfoRow label="Project" value={vercelInfo.project} />
            <InfoRow label="URL" value={vercelInfo.url} copyable />
            <InfoRow label="Region" value={vercelInfo.region} />
            <InfoRow label="Build Time" value={vercelInfo.buildTime} />
            <InfoRow label="Framework" value={vercelInfo.framework} />
            <InfoRow label="Node Version" value={vercelInfo.nodeVersion} />
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <Database className="h-5 w-5 text-green-400" />
              Supabase Database
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <InfoRow label="Project ID" value={supabaseInfo.projectId} />
            <InfoRow label="URL" value={supabaseInfo.url} copyable />
            <InfoRow label="Region" value={supabaseInfo.region} />
            <InfoRow label="Status" value={supabaseInfo.status} status="green" />
          </CardContent>
        </Card>
      </div>

      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <LayoutGrid className="h-5 w-5 text-purple-400" />
            Environment Variables
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between py-2 px-3 bg-slate-900/50 rounded-lg">
              <span className="text-slate-400">VITE_SUPABASE_URL</span>
              <Badge className="bg-green-500/20 text-green-400">Configured</Badge>
            </div>
            <div className="flex items-center justify-between py-2 px-3 bg-slate-900/50 rounded-lg">
              <span className="text-slate-400">VITE_SUPABASE_ANON_KEY</span>
              <Badge className="bg-green-500/20 text-green-400">Configured</Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function InfoRow({ label, value, copyable, status }: { label: string; value: string; copyable?: boolean; status?: "green" | "red" | "yellow" }) {
  const statusColors = {
    green: "text-green-400",
    red: "text-red-400",
    yellow: "text-yellow-400",
  };

  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-400">{label}</span>
      <div className="flex items-center gap-2">
        <span className={status ? statusColors[status] : "text-white"}>{value}</span>
        {copyable && (
          <button
            onClick={() => navigator.clipboard?.writeText(value)}
            className="text-slate-500 hover:text-cyan-400"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
