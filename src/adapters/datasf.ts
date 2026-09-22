// DataSF adapter — opens real cases from San Francisco's open crash register.
//
// The case library should not be a set of fixtures an investigator scrolls past
// on the way to the one prepared case. This pulls genuine, recent, injury
// collisions from the city's open data portal so the library is populated with
// real incidents that a detective could actually be assigned.
//
// The portal is open — no key required. Records are public and contain no
// personal identifiers: street pair, time, severity, and collision type only.
// Participants are never invented; an imported case starts with an empty roster
// and the investigator adds the people they have contact details for.

import type { Incident } from "../types.ts";

const ENDPOINT = "https://data.sf.gov/resource/ubvf-ztfx.json";
const ATTRIBUTION = "DataSF — Traffic Crashes Resulting in Injury";

interface CrashRow {
  case_id_pkey?: string;
  unique_id?: string;
  collision_datetime?: string;
  primary_rd?: string;
  secondary_rd?: string;
  collision_severity?: string;
  type_of_collision?: string;
  weather_1?: string;
  lighting?: string;
  number_injured?: string;
  number_killed?: string;
  tb_latitude?: string;
  tb_longitude?: string;
}

export interface ImportedCase {
  draft: Omit<Incident, "id" | "createdAt" | "status">;
  sourceUrl: string;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w.toUpperCase()))
    .join(" ");
}

function clockOf(iso?: string): string {
  if (!iso) return "unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/**
 * Fetches recent injury collisions and shapes each into an openable case.
 *
 * Returns [] on any failure — an unreachable portal must never stop the app,
 * and the caller surfaces the reason rather than inventing records.
 */
export async function fetchRecentCases(limit = 8): Promise<ImportedCase[]> {
  const url =
    `${ENDPOINT}?$limit=${limit}&$order=collision_datetime%20DESC` +
    `&$where=primary_rd%20IS%20NOT%20NULL%20AND%20secondary_rd%20IS%20NOT%20NULL`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`DataSF ${res.status}`);
    const rows = (await res.json()) as CrashRow[];
    return rows.map(toCase).filter((c): c is ImportedCase => c !== null);
  } catch (err) {
    console.warn("[datasf] import failed:", (err as Error).message);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function toCase(row: CrashRow): ImportedCase | null {
  const a = row.primary_rd?.trim();
  const b = row.secondary_rd?.trim();
  if (!a || !b) return null;

  const location = `${titleCase(a)} & ${titleCase(b)}, San Francisco`;
  const when = row.collision_datetime ? new Date(row.collision_datetime) : null;
  const dateStr = when && !Number.isNaN(when.getTime()) ? when.toLocaleDateString() : "unknown date";
  const ref = `SF-${(row.case_id_pkey ?? row.unique_id ?? Math.random().toString(36).slice(2, 8))
    .toString()
    .slice(-8)
    .toUpperCase()}`;

  const severity = row.collision_severity ?? "Injury";
  const kind = row.type_of_collision ?? "Collision";

  // Everything in knownContext is straight from the register. Nothing about
  // what happened is asserted — that is what the interviews are for.
  const known = [
    `Imported from ${ATTRIBUTION}.`,
    `Register entry: ${kind}, severity "${severity}", recorded ${dateStr} at ${clockOf(row.collision_datetime)}.`,
    row.number_injured ? `Injuries recorded: ${row.number_injured}.` : null,
    row.number_killed && row.number_killed !== "0" ? `Fatalities recorded: ${row.number_killed}.` : null,
    row.weather_1 ? `Weather on record: ${row.weather_1}.` : null,
    row.lighting ? `Lighting on record: ${row.lighting}.` : null,
    row.tb_latitude && row.tb_longitude
      ? `Geocoded to ${Number(row.tb_latitude).toFixed(5)}, ${Number(row.tb_longitude).toFixed(5)}.`
      : null,
    "No statements have been taken. Sequence, right of way, and contributing factors are all unestablished.",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    sourceUrl: `https://data.sf.gov/resource/ubvf-ztfx.json?case_id_pkey=${row.case_id_pkey ?? ""}`,
    draft: {
      title: `${titleCase(kind)} — ${titleCase(a)} & ${titleCase(b)}`,
      type: "Traffic collision",
      location,
      approximateTime: clockOf(row.collision_datetime),
      description:
        `${severity} collision recorded at ${location} on ${dateStr}. ` +
        `Classified in the city register as "${kind}". Witness accounts have not been taken.`,
      referenceId: ref,
      openedBy: "SFPD Traffic Collision Investigation Unit",
      knownContext: known,
    },
  };
}
