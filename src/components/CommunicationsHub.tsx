import { useEffect, useMemo, useState } from "react";
import { GitBranchPlus, MailPlus, RefreshCw, Save, Trash2, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { Employee } from "@/services/database";
import type {
  CommunicationAutomation,
  CommunicationProfile,
  CommunicationProfileLevel,
  ReportTemplate,
} from "@/types/workflows";

type CommunicationsHubProps = {
  employees: Employee[];
  reportTemplates: ReportTemplate[];
  profiles: CommunicationProfile[];
  automations: CommunicationAutomation[];
  onProfilesChange: (profiles: CommunicationProfile[]) => void;
  onAutomationsChange: (automations: CommunicationAutomation[]) => void;
};

type ProfileFormState = {
  id: string;
  firstName: string;
  lastName: string;
  idNumber: string;
  payrollCode: string;
  area: string;
  groceryPerishable: string;
  level: CommunicationProfileLevel;
  managerId: string;
  active: boolean;
  notes: string;
};

type AutomationFormState = {
  id: string;
  title: string;
  reportTemplateId: string;
  recipientIds: string[];
  frequency: "manual" | "daily" | "weekly" | "monthly";
  timeOfDay: string;
  active: boolean;
  description: string;
};

const LEVEL_OPTIONS: Array<{ value: CommunicationProfileLevel; label: string }> = [
  { value: "rep", label: "Rep" },
  { value: "regional", label: "Regional" },
  { value: "divisional", label: "Divisional" },
];

const GROCERY_PERISHABLE_OPTIONS = ["Grocery", "Perishable"] as const;

function randomId() {
  return globalThis.crypto?.randomUUID?.() ?? `comm_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

function normalizeLevel(value: unknown): CommunicationProfileLevel {
  const clean = String(value || "").trim().toLowerCase();
  if (clean === "regional") return "regional";
  if (clean === "divisional" || clean === "devisional" || clean === "division") return "divisional";
  return "rep";
}

function normalizeGroceryPerishable(value: unknown) {
  const clean = String(value || "").trim().toLowerCase();
  if (clean === "grocery") return "Grocery";
  if (clean === "perishable") return "Perishable";
  return "";
}

function normalizeProfile(profile: Partial<CommunicationProfile> & Record<string, unknown>): CommunicationProfile {
  return {
    id: String(profile.id || randomId()),
    firstName: String(profile.firstName || "").trim(),
    lastName: String(profile.lastName || "").trim(),
    idNumber: String(profile.idNumber || profile.id_number || "").trim(),
    payrollCode: String(profile.payrollCode || profile.payroll_code || profile.employeeCode || "").trim(),
    area: String(profile.area || "").trim(),
    groceryPerishable: normalizeGroceryPerishable(profile.groceryPerishable || profile.grocery_perishable),
    level: normalizeLevel(profile.level || profile.role),
    managerId: String(profile.managerId || "").trim(),
    active: profile.active === false ? false : true,
    source: profile.source === "employee" ? "employee" : "manual",
    notes: String(profile.notes || "").trim(),
  };
}

function buildProfileForm(profile?: CommunicationProfile): ProfileFormState {
  return {
    id: profile?.id || "",
    firstName: profile?.firstName || "",
    lastName: profile?.lastName || "",
    idNumber: profile?.idNumber || "",
    payrollCode: profile?.payrollCode || "",
    area: profile?.area || "",
    groceryPerishable: normalizeGroceryPerishable(profile?.groceryPerishable),
    level: profile?.level || "rep",
    managerId: profile?.managerId || "",
    active: profile?.active ?? true,
    notes: profile?.notes || "",
  };
}

function buildAutomationForm(automation?: CommunicationAutomation): AutomationFormState {
  return {
    id: automation?.id || "",
    title: automation?.title || "",
    reportTemplateId: automation?.reportTemplateId || "",
    recipientIds: automation?.recipientIds || [],
    frequency: automation?.frequency || "manual",
    timeOfDay: automation?.timeOfDay || "",
    active: automation?.active ?? true,
    description: automation?.description || "",
  };
}

function profileLabel(profile: CommunicationProfile) {
  return `${profile.firstName} ${profile.lastName}`.trim() || profile.payrollCode || profile.idNumber || "Unnamed profile";
}

function levelLabel(level: CommunicationProfileLevel) {
  return LEVEL_OPTIONS.find((option) => option.value === level)?.label || "Rep";
}

function profileSummary(profile: CommunicationProfile) {
  return [levelLabel(profile.level), profile.area].filter(Boolean).join(" • ") || "No level or area assigned";
}

function profileIdentifiers(profile: CommunicationProfile) {
  const parts = [
    profile.idNumber ? `ID ${profile.idNumber}` : "",
    profile.payrollCode ? `Payroll ${profile.payrollCode}` : "",
    profile.groceryPerishable ? profile.groceryPerishable : "",
  ].filter(Boolean);
  return parts.join(" • ") || "No identifiers added";
}

export default function CommunicationsHub({
  employees,
  reportTemplates,
  profiles,
  automations,
  onProfilesChange,
  onAutomationsChange,
}: CommunicationsHubProps) {
  const [profileSearch, setProfileSearch] = useState("");
  const [profileForm, setProfileForm] = useState<ProfileFormState>(buildProfileForm());
  const [automationForm, setAutomationForm] = useState<AutomationFormState>(buildAutomationForm());
  const [managerToReplace, setManagerToReplace] = useState("");
  const [replacementManagerId, setReplacementManagerId] = useState("");

  const normalizedProfiles = useMemo(
    () => profiles.map((profile) => normalizeProfile(profile as Partial<CommunicationProfile> & Record<string, unknown>)),
    [profiles]
  );

  useEffect(() => {
    const raw = JSON.stringify(profiles);
    const normalized = JSON.stringify(normalizedProfiles);
    if (raw !== normalized) {
      onProfilesChange(normalizedProfiles);
    }
  }, [normalizedProfiles, onProfilesChange, profiles]);

  const managers = useMemo(
    () => normalizedProfiles.filter((profile) => profile.level === "regional" || profile.level === "divisional"),
    [normalizedProfiles]
  );

  const filteredProfiles = useMemo(() => {
    const query = profileSearch.trim().toLowerCase();
    if (!query) return normalizedProfiles;
    return normalizedProfiles.filter((profile) => {
      const haystack = [
        profile.firstName,
        profile.lastName,
        profile.idNumber,
        profile.payrollCode,
        profile.area,
        profile.groceryPerishable,
        profile.level,
        profile.notes,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [normalizedProfiles, profileSearch]);

  const hierarchyRoots = useMemo(() => {
    const profileIds = new Set(normalizedProfiles.map((profile) => profile.id));
    return normalizedProfiles
      .filter((profile) => !profile.managerId || !profileIds.has(profile.managerId))
      .sort((a, b) => profileLabel(a).localeCompare(profileLabel(b)));
  }, [normalizedProfiles]);

  const childrenMap = useMemo(() => {
    const map = new Map<string, CommunicationProfile[]>();
    normalizedProfiles.forEach((profile) => {
      if (!profile.managerId) return;
      if (!map.has(profile.managerId)) map.set(profile.managerId, []);
      map.get(profile.managerId)!.push(profile);
    });
    map.forEach((items) => items.sort((a, b) => profileLabel(a).localeCompare(profileLabel(b))));
    return map;
  }, [normalizedProfiles]);

  const saveProfile = () => {
    if (
      !profileForm.firstName ||
      !profileForm.lastName ||
      !profileForm.idNumber ||
      !profileForm.payrollCode ||
      !profileForm.area ||
      !profileForm.groceryPerishable
    ) {
      return;
    }

    const nextProfile: CommunicationProfile = {
      id: profileForm.id || randomId(),
      firstName: profileForm.firstName.trim(),
      lastName: profileForm.lastName.trim(),
      idNumber: profileForm.idNumber.trim(),
      payrollCode: profileForm.payrollCode.trim(),
      area: profileForm.area.trim(),
      groceryPerishable: normalizeGroceryPerishable(profileForm.groceryPerishable),
      level: profileForm.level,
      managerId: profileForm.managerId,
      active: profileForm.active,
      source: profileForm.id
        ? normalizedProfiles.find((item) => item.id === profileForm.id)?.source || "manual"
        : "manual",
      notes: profileForm.notes.trim(),
    };

    const nextProfiles = profileForm.id
      ? normalizedProfiles.map((profile) => (profile.id === profileForm.id ? nextProfile : profile))
      : [...normalizedProfiles, nextProfile];

    onProfilesChange(nextProfiles);
    setProfileForm(buildProfileForm());
  };

  const saveAutomation = () => {
    if (!automationForm.title || !automationForm.reportTemplateId || automationForm.recipientIds.length === 0) return;

    const nextAutomation: CommunicationAutomation = {
      id: automationForm.id || randomId(),
      title: automationForm.title,
      reportTemplateId: automationForm.reportTemplateId,
      recipientIds: automationForm.recipientIds,
      frequency: automationForm.frequency,
      timeOfDay: automationForm.timeOfDay,
      active: automationForm.active,
      description: automationForm.description,
      lastRunAt: automations.find((item) => item.id === automationForm.id)?.lastRunAt || "",
    };

    const nextAutomations = automationForm.id
      ? automations.map((automation) => (automation.id === automationForm.id ? nextAutomation : automation))
      : [...automations, nextAutomation];

    onAutomationsChange(nextAutomations);
    setAutomationForm(buildAutomationForm());
  };

  const syncFromEmployees = () => {
    const profileMap = new Map(normalizedProfiles.map((profile) => [profile.payrollCode, profile]));
    const merged = [...normalizedProfiles];

    employees.forEach((employee) => {
      const existing = profileMap.get(employee.employee_code);
      if (existing) {
        Object.assign(existing, {
          firstName: employee.first_name || existing.firstName,
          lastName: employee.last_name || existing.lastName,
          idNumber: employee.id_number || existing.idNumber,
          payrollCode: employee.employee_code || existing.payrollCode,
          area: employee.region || employee.branch || employee.department || existing.area,
          active: employee.status === "active",
        });
        return;
      }

      merged.push({
        id: randomId(),
        firstName: employee.first_name,
        lastName: employee.last_name,
        idNumber: employee.id_number || "",
        payrollCode: employee.employee_code,
        area: employee.region || employee.branch || employee.department || "",
        groceryPerishable: "",
        level: "rep",
        managerId: "",
        active: employee.status === "active",
        source: "employee",
        notes: "",
      });
    });

    onProfilesChange([...merged]);
  };

  const replaceManager = () => {
    if (!managerToReplace || !replacementManagerId || managerToReplace === replacementManagerId) return;
    onProfilesChange(
      normalizedProfiles.map((profile) =>
        profile.managerId === managerToReplace ? { ...profile, managerId: replacementManagerId } : profile
      )
    );
    setManagerToReplace("");
    setReplacementManagerId("");
  };

  const renderTree = (profile: CommunicationProfile, depth = 0) => {
    const children = childrenMap.get(profile.id) || [];
    return (
      <div key={profile.id} className="space-y-3">
        <div
          className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${depth > 0 ? "ml-4 md:ml-8" : ""}`}
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="font-semibold text-slate-900">{profileLabel(profile)}</div>
              <div className="mt-1 text-sm text-slate-500">{profileSummary(profile)}</div>
              <div className="mt-1 text-xs text-slate-400">{profileIdentifiers(profile)}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className="bg-slate-100 text-slate-700">{levelLabel(profile.level)}</Badge>
              <Badge className={profile.active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"}>
                {profile.active ? "Active" : "Inactive"}
              </Badge>
              <Badge className="bg-slate-100 text-slate-700">{children.length} reports</Badge>
            </div>
          </div>
        </div>
        {children.length > 0 && <div className="space-y-3">{children.map((child) => renderTree(child, depth + 1))}</div>}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl border-slate-200">
        <CardHeader>
          <CardTitle>Communications Hub</CardTitle>
          <CardDescription>
            Manage your communication structure using first name, last name, ID, payroll code, area, Grocery / Perishable, and role level.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center">
            <div className="text-2xl font-bold text-slate-900">{normalizedProfiles.length}</div>
            <div className="text-sm text-slate-500">Communication profiles</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center">
            <div className="text-2xl font-bold text-slate-900">{managers.length}</div>
            <div className="text-sm text-slate-500">Regional / divisional</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center">
            <div className="text-2xl font-bold text-slate-900">{automations.length}</div>
            <div className="text-sm text-slate-500">Report automations</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center">
            <div className="text-2xl font-bold text-slate-900">{reportTemplates.length}</div>
            <div className="text-sm text-slate-500">Saved report templates</div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="rounded-2xl border-slate-200">
          <CardHeader>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <MailPlus className="h-5 w-5" />
                  Communication Profiles
                </CardTitle>
                <CardDescription>Create profiles manually or sync baseline details from employees.</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={syncFromEmployees}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Sync from employees
                </Button>
                <Button onClick={() => setProfileForm(buildProfileForm())}>
                  <MailPlus className="mr-2 h-4 w-4" />
                  New profile
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              value={profileSearch}
              onChange={(event) => setProfileSearch(event.target.value)}
              placeholder="Search by payroll code, ID, name, area, Grocery / Perishable, or level..."
            />

            <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 text-sm font-semibold text-slate-900">
                  {profileForm.id ? "Edit profile" : "Create profile"}
                </div>
                <div className="space-y-3">
                  <Input
                    value={profileForm.firstName}
                    onChange={(event) => setProfileForm((current) => ({ ...current, firstName: event.target.value }))}
                    placeholder="First name"
                  />
                  <Input
                    value={profileForm.lastName}
                    onChange={(event) => setProfileForm((current) => ({ ...current, lastName: event.target.value }))}
                    placeholder="Last name"
                  />
                  <Input
                    value={profileForm.idNumber}
                    onChange={(event) => setProfileForm((current) => ({ ...current, idNumber: event.target.value }))}
                    placeholder="ID number"
                  />
                  <Input
                    value={profileForm.payrollCode}
                    onChange={(event) => setProfileForm((current) => ({ ...current, payrollCode: event.target.value }))}
                    placeholder="Payroll code"
                  />
                  <Input
                    value={profileForm.area}
                    onChange={(event) => setProfileForm((current) => ({ ...current, area: event.target.value }))}
                    placeholder="Area"
                  />
                  <select
                    value={profileForm.groceryPerishable}
                    onChange={(event) =>
                      setProfileForm((current) => ({
                        ...current,
                        groceryPerishable: event.target.value,
                      }))
                    }
                    className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Select Grocery / Perishable</option>
                    {GROCERY_PERISHABLE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  <select
                    value={profileForm.level}
                    onChange={(event) =>
                      setProfileForm((current) => ({
                        ...current,
                        level: event.target.value as CommunicationProfileLevel,
                      }))
                    }
                    className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                  >
                    {LEVEL_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={profileForm.managerId}
                    onChange={(event) => setProfileForm((current) => ({ ...current, managerId: event.target.value }))}
                    className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">No manager / top level</option>
                    {normalizedProfiles
                      .filter((profile) => profile.id !== profileForm.id)
                      .map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profileLabel(profile)} • {levelLabel(profile.level)}
                        </option>
                      ))}
                  </select>
                  <Input
                    value={profileForm.notes}
                    onChange={(event) => setProfileForm((current) => ({ ...current, notes: event.target.value }))}
                    placeholder="Notes"
                  />
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={profileForm.active}
                      onChange={(event) => setProfileForm((current) => ({ ...current, active: event.target.checked }))}
                    />
                    Profile active
                  </label>
                  <div className="flex gap-2">
                    <Button className="flex-1" onClick={saveProfile}>
                      <Save className="mr-2 h-4 w-4" />
                      Save profile
                    </Button>
                    {profileForm.id && (
                      <Button variant="outline" onClick={() => setProfileForm(buildProfileForm())}>
                        Clear
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {filteredProfiles.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-slate-500">
                    No communication profiles yet.
                  </div>
                ) : (
                  filteredProfiles.map((profile) => (
                    <div key={profile.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <div className="font-semibold text-slate-900">{profileLabel(profile)}</div>
                          <div className="mt-1 text-sm text-slate-500">{profileSummary(profile)}</div>
                          <div className="mt-1 text-xs text-slate-400">{profileIdentifiers(profile)} • {profile.source}</div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge className="bg-slate-100 text-slate-700">{levelLabel(profile.level)}</Badge>
                          <Badge className={profile.active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-700"}>
                            {profile.active ? "Active" : "Inactive"}
                          </Badge>
                          <Button size="sm" variant="outline" onClick={() => setProfileForm(buildProfileForm(profile))}>
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              onProfilesChange(
                                normalizedProfiles
                                  .filter((item) => item.id !== profile.id)
                                  .map((item) => (item.managerId === profile.id ? { ...item, managerId: "" } : item))
                              )
                            }
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-slate-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Workflow className="h-5 w-5" />
              Report Automations
            </CardTitle>
            <CardDescription>Select a saved report and assign it to the right communication profiles.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="grid gap-3">
                <Input
                  value={automationForm.title}
                  onChange={(event) => setAutomationForm((current) => ({ ...current, title: event.target.value }))}
                  placeholder="Automation title"
                />
                <select
                  value={automationForm.reportTemplateId}
                  onChange={(event) => setAutomationForm((current) => ({ ...current, reportTemplateId: event.target.value }))}
                  className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Select report template</option>
                  {reportTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.title}
                    </option>
                  ))}
                </select>
                <select
                  value={automationForm.frequency}
                  onChange={(event) =>
                    setAutomationForm((current) => ({
                      ...current,
                      frequency: event.target.value as AutomationFormState["frequency"],
                    }))
                  }
                  className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="manual">Manual</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
                <Input
                  type="time"
                  value={automationForm.timeOfDay}
                  onChange={(event) => setAutomationForm((current) => ({ ...current, timeOfDay: event.target.value }))}
                />
                <Input
                  value={automationForm.description}
                  onChange={(event) => setAutomationForm((current) => ({ ...current, description: event.target.value }))}
                  placeholder="What should this automation send and to whom?"
                />
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="mb-2 text-sm font-medium text-slate-700">Recipients</div>
                  <div className="max-h-48 space-y-2 overflow-y-auto">
                    {normalizedProfiles.map((profile) => (
                      <label key={profile.id} className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={automationForm.recipientIds.includes(profile.id)}
                          onChange={(event) =>
                            setAutomationForm((current) => ({
                              ...current,
                              recipientIds: event.target.checked
                                ? [...current.recipientIds, profile.id]
                                : current.recipientIds.filter((id) => id !== profile.id),
                            }))
                          }
                        />
                        <span>{profileLabel(profile)} • {levelLabel(profile.level)}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={automationForm.active}
                    onChange={(event) => setAutomationForm((current) => ({ ...current, active: event.target.checked }))}
                  />
                  Automation active
                </label>
                <Button onClick={saveAutomation}>
                  <Save className="mr-2 h-4 w-4" />
                  Save automation
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              {automations.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-slate-500">
                  No report automations yet.
                </div>
              ) : (
                automations.map((automation) => {
                  const template = reportTemplates.find((item) => item.id === automation.reportTemplateId);
                  return (
                    <div key={automation.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <div className="font-semibold text-slate-900">{automation.title}</div>
                          <div className="mt-1 text-sm text-slate-500">
                            {template?.title || "Missing report template"} • {automation.frequency}
                          </div>
                          <div className="mt-1 text-xs text-slate-400">
                            {automation.recipientIds.length} recipients {automation.timeOfDay ? `• ${automation.timeOfDay}` : ""}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge className={automation.active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-700"}>
                            {automation.active ? "Active" : "Paused"}
                          </Badge>
                          <Button size="sm" variant="outline" onClick={() => setAutomationForm(buildAutomationForm(automation))}>
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onAutomationsChange(automations.filter((item) => item.id !== automation.id))}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl border-slate-200">
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <GitBranchPlus className="h-5 w-5" />
                Organogram Builder
              </CardTitle>
              <CardDescription>
                Replace regional or divisional managers and keep reporting lines intact.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <select
                value={managerToReplace}
                onChange={(event) => setManagerToReplace(event.target.value)}
                className="flex h-10 rounded-xl border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Current manager</option>
                {managers.map((manager) => (
                  <option key={manager.id} value={manager.id}>
                    {profileLabel(manager)} • {levelLabel(manager.level)}
                  </option>
                ))}
              </select>
              <select
                value={replacementManagerId}
                onChange={(event) => setReplacementManagerId(event.target.value)}
                className="flex h-10 rounded-xl border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Replacement manager</option>
                {normalizedProfiles
                  .filter((profile) => profile.id !== managerToReplace)
                  .map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profileLabel(profile)} • {levelLabel(profile.level)}
                    </option>
                  ))}
              </select>
              <Button variant="outline" onClick={replaceManager}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Replace manager
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {hierarchyRoots.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-slate-500">
              Add communication profiles to build the organogram.
            </div>
          ) : (
            <div className="space-y-4">{hierarchyRoots.map((profile) => renderTree(profile))}</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
