import type { Employee } from "@/services/database";

type EmployeeScopeLike = Pick<Employee, "team" | "store" | "store_code">;

export type TeamScopeInfo = {
  key: string;
  label: string;
  code: string;
  name: string;
};

export function normalizeScopeText(value: unknown) {
  return value === null || value === undefined ? "" : String(value).replace(/\s+/g, " ").trim();
}

export function normalizeScopeCompare(value: unknown) {
  return normalizeScopeText(value).toLowerCase();
}

function stripLeadingCode(value: string) {
  return value.replace(/^[A-Za-z0-9]+\s*-\s*/, "").trim();
}

function stripTrailingCode(value: string) {
  return value.replace(/\s*\(([^)]+)\)\s*$/, "").trim();
}

export function getTeamScopeInfo(team: unknown, fallbackStore?: unknown, fallbackStoreCode?: unknown): TeamScopeInfo {
  const normalizedTeam = normalizeScopeText(team);
  if (normalizedTeam) {
    const match = normalizedTeam.match(/^([A-Za-z0-9]+)\s*-\s*(.+)$/);
    if (match) {
      const canonicalLabel = normalizeScopeText(match[2]) || normalizedTeam;
      return {
        key: normalizeScopeCompare(canonicalLabel),
        label: canonicalLabel,
        code: normalizeScopeText(match[1]),
        name: canonicalLabel,
      };
    }

    const canonicalLabel = stripLeadingCode(normalizedTeam) || normalizedTeam;
    return {
      key: normalizeScopeCompare(canonicalLabel),
      label: canonicalLabel,
      code: normalizeScopeText(fallbackStoreCode),
      name: canonicalLabel,
    };
  }

  const store = normalizeScopeText(fallbackStore);
  const storeCode = normalizeScopeText(fallbackStoreCode);
  const baseLabel = store || storeCode || "Unassigned Team";
  const label = stripLeadingCode(baseLabel) || baseLabel;
  return {
    key: normalizeScopeCompare(label),
    label,
    code: storeCode,
    name: store || label,
  };
}

export function getEmployeeScopeInfo(employee: EmployeeScopeLike | null | undefined) {
  return getTeamScopeInfo(employee?.team, employee?.store, employee?.store_code);
}

export function buildTeamAssignmentMatcher(assignedKeys: string[]) {
  const normalizedFull = new Set(assignedKeys.map((key) => normalizeScopeCompare(key)).filter(Boolean));
  const normalizedCodes = new Set<string>();
  const normalizedNames = new Set<string>();

  assignedKeys.forEach((key) => {
    const scope = getTeamScopeInfo(key, "", "");
    if (scope.code) normalizedCodes.add(normalizeScopeCompare(scope.code));
    if (scope.name) normalizedNames.add(normalizeScopeCompare(scope.name));
    if (scope.label) normalizedNames.add(normalizeScopeCompare(scope.label));
  });

  return (...values: unknown[]) => {
    if (normalizedFull.size === 0) return false;

    return values.some((value) => {
      const scope = typeof value === "object" && value !== null && ("team" in (value as object) || "store" in (value as object))
        ? getEmployeeScopeInfo(value as EmployeeScopeLike)
        : getTeamScopeInfo(value, value, value);

      const full = normalizeScopeCompare(scope.label);
      const code = normalizeScopeCompare(scope.code);
      const name = normalizeScopeCompare(scope.name);

      return (
        (full && normalizedFull.has(full)) ||
        (code && (normalizedCodes.has(code) || normalizedFull.has(code))) ||
        (name && (normalizedNames.has(name) || normalizedFull.has(name)))
      );
    });
  };
}
