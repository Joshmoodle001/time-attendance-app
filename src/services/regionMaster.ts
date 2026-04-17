import regionMasterRows from "@/data/regionMaster.json";

export type RegionMasterRow = {
  store: string;
  rep: string;
  region: string;
};

type IndexedRegionRow = RegionMasterRow & {
  normalizedStore: string;
  normalizedRep: string;
  storeCode: string;
};

function normalizeText(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeCompare(value: unknown) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractStoreCode(value: unknown) {
  const text = normalizeText(value);
  if (!text) return "";
  const bracketMatch = text.match(/\((\d{3,})\)\s*$/);
  if (bracketMatch) return bracketMatch[1];
  const leadingMatch = text.match(/^(\d{3,})\b/);
  if (leadingMatch) return leadingMatch[1];
  const anyMatch = text.match(/\b(\d{3,})\b/);
  return anyMatch?.[1] || "";
}

const indexedRows: IndexedRegionRow[] = (regionMasterRows as RegionMasterRow[])
  .map((row) => {
    const store = normalizeText(row.store);
    const rep = normalizeText(row.rep);
    const region = normalizeText(row.region).toUpperCase();
    return {
      store,
      rep,
      region,
      normalizedStore: normalizeCompare(store),
      normalizedRep: normalizeCompare(rep),
      storeCode: extractStoreCode(store),
    };
  })
  .filter((row) => Boolean(row.store || row.rep));

const rowsByStoreCode = new Map<string, IndexedRegionRow>();
const rowsByStoreName = new Map<string, IndexedRegionRow>();
const rowsByRepName = new Map<string, IndexedRegionRow>();

indexedRows.forEach((row) => {
  if (row.storeCode && !rowsByStoreCode.has(row.storeCode)) {
    rowsByStoreCode.set(row.storeCode, row);
  }
  if (row.normalizedStore && !rowsByStoreName.has(row.normalizedStore)) {
    rowsByStoreName.set(row.normalizedStore, row);
  }
  if (row.normalizedRep && !rowsByRepName.has(row.normalizedRep)) {
    rowsByRepName.set(row.normalizedRep, row);
  }
});

function classifyBrand(storeName: string) {
  const normalized = normalizeCompare(storeName);
  if (normalized.includes("checkers")) return "CHECKERS";
  if (normalized.includes("shoprite")) return "SHOPRITE";
  return "OTHER";
}

function titleCaseRegion(region: string) {
  const normalized = normalizeText(region).toUpperCase();
  if (!normalized) return "Unassigned";
  if (["LV", "HV", "NW", "FNW"].includes(normalized)) return normalized;
  if (normalized === "LOCAL") return "Local";
  if (normalized === "LIMPOPO") return "Limpopo";
  return normalized.charAt(0) + normalized.slice(1).toLowerCase();
}

export function findRegionMasterRowByStore(storeName: unknown, storeCode?: unknown): RegionMasterRow | null {
  const normalizedStore = normalizeCompare(storeName);
  const normalizedCode = normalizeText(storeCode) || extractStoreCode(storeName);

  if (normalizedCode) {
    const byCode = rowsByStoreCode.get(normalizedCode);
    if (byCode) return byCode;
  }

  if (normalizedStore) {
    const byName = rowsByStoreName.get(normalizedStore);
    if (byName) return byName;

    let best: IndexedRegionRow | null = null;
    for (const row of indexedRows) {
      if (!row.normalizedStore) continue;
      if (
        normalizedStore.includes(row.normalizedStore) ||
        row.normalizedStore.includes(normalizedStore)
      ) {
        if (!best || row.normalizedStore.length > best.normalizedStore.length) {
          best = row;
        }
      }
    }
    if (best) return best;
  }

  return null;
}

export function findRegionMasterRowByRep(repName: unknown): RegionMasterRow | null {
  const normalizedRep = normalizeCompare(repName);
  if (!normalizedRep) return null;

  const byRep = rowsByRepName.get(normalizedRep);
  if (byRep) return byRep;

  for (const row of indexedRows) {
    if (!row.normalizedRep) continue;
    if (normalizedRep.includes(row.normalizedRep) || row.normalizedRep.includes(normalizedRep)) {
      return row;
    }
  }

  return null;
}

export function resolveRegionForStore(storeName: unknown, storeCode?: unknown, fallbackRegion = "") {
  const match = findRegionMasterRowByStore(storeName, storeCode);
  if (match?.region) return match.region;
  const fallback = normalizeText(fallbackRegion).toUpperCase();
  return fallback || "UNASSIGNED";
}

export function resolveRegionForRep(repName: unknown, fallbackRegion = "") {
  const match = findRegionMasterRowByRep(repName);
  if (match?.region) return match.region;
  const fallback = normalizeText(fallbackRegion).toUpperCase();
  return fallback || "UNASSIGNED";
}

export function getStoreGrouping(storeName: unknown, storeCode?: unknown, fallbackRegion = "") {
  const match = findRegionMasterRowByStore(storeName, storeCode);
  const resolvedStore = normalizeText(match?.store || storeName) || "Unassigned Store";
  const resolvedRegion = resolveRegionForStore(storeName, storeCode, fallbackRegion);
  const brand = classifyBrand(resolvedStore);
  const regionLabel = titleCaseRegion(resolvedRegion);
  const brandLabel = brand === "OTHER" ? "Other" : brand.charAt(0) + brand.slice(1).toLowerCase();
  const key = `${brand}_${resolvedRegion}`;

  return {
    store: resolvedStore,
    region: resolvedRegion,
    rep: normalizeText(match?.rep),
    brand,
    regionLabel,
    groupKey: key,
    groupLabel: `${brandLabel} ${regionLabel}`,
  };
}

export function getRegionMasterRows() {
  return indexedRows.map((row) => ({
    store: row.store,
    rep: row.rep,
    region: row.region,
  }));
}
