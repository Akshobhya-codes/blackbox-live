// Derives the timeline graph the dashboard draws, from the reconciled state.
// Pure functions — no data is invented here, only arranged.

import type { AppState, Claim, Finding, Interview, TimelineEvent, Witness } from "./types";

export type ClaimClass = "corroborated" | "contradiction" | "single";

export interface Chip {
  claimId: string;
  witnessId: string;
  label: string;
  cls: ClaimClass;
  excerpt: string;
  certainty: string;
  findingId: string | null;
  /**
   * "badge" — the witness simply confirms this event happened; rendered as a
   * bare letter next to the label. "pill" — the claim says something specific
   * ("Before impact"), so it earns a labelled bubble out on the wing.
   */
  kind: "badge" | "pill";
  side: "left" | "right";
  /** Index within its side (pills) or within the cluster (badges). */
  slot: number;
}

export interface EventRow {
  id: string;
  eventKey: string;
  label: string;
  time: string | null;
  step: number;
  confidence: TimelineEvent["confidence"];
  supportingWitnessIds: string[];
  chips: Chip[];
  contradictionId: string | null;
}

// --------------------------------------------------------------- witnesses

export const WITNESS_COLORS = [
  { key: "green", hex: "#35c46b" },
  { key: "blue", hex: "#4f9cf9" },
  { key: "amber", hex: "#e0a231" },
  { key: "violet", hex: "#a879f0" },
  { key: "cyan", hex: "#3fd0d4" },
  { key: "pink", hex: "#f06fa8" },
];

export interface WitnessMeta {
  id: string;
  letter: string;
  name: string;
  role: string;
  color: string;
  colorKey: string;
}

export function witnessMeta(witnesses: Witness[], interviews: Interview[]): Map<string, WitnessMeta> {
  const map = new Map<string, WitnessMeta>();
  witnesses.forEach((w, i) => {
    const palette = WITNESS_COLORS[i % WITNESS_COLORS.length];
    const interview = interviews.find((x) => x.witnessId === w.id);
    map.set(w.id, {
      id: w.id,
      letter: initialFor(w.displayName, i),
      name: w.displayName,
      role: roleFor(w, interview),
      color: palette.hex,
      colorKey: palette.key,
    });
  });
  return map;
}

function initialFor(name: string, index: number): string {
  const m = /witness\s+([a-z0-9])/i.exec(name);
  if (m) return m[1].toUpperCase();
  const first = name.trim()[0];
  return (first || String.fromCharCode(65 + index)).toUpperCase();
}

/** A short descriptor under the witness name — taken from what they told us. */
function roleFor(w: Witness, interview?: Interview): string {
  if (w.role) return w.role;
  const loc = interview?.fields?.observer_location;
  if (typeof loc === "string" && loc.trim().length > 1) {
    const clean = loc.trim().replace(/^(i was |i were |at |near |in )/i, "");
    return truncate(capitalize(clean), 34);
  }
  if (w.consentStatus === "declined") return "Consent declined";
  if (w.callStatus === "queued") return "Awaiting interview";
  return "Witness";
}

// ------------------------------------------------------------- claim class

const CLASS_RANK: Record<ClaimClass, number> = {
  contradiction: 3,
  corroborated: 2,
  single: 1,
};

export function classifyClaims(findings: Finding[]): Map<string, { cls: ClaimClass; findingId: string }> {
  const out = new Map<string, { cls: ClaimClass; findingId: string }>();
  for (const f of findings) {
    let cls: ClaimClass | null = null;
    if (f.type === "contradiction") cls = "contradiction";
    else if (f.type === "agreement") cls = "corroborated";
    else if (f.type === "unique_claim") cls = "single";
    if (!cls) continue;

    for (const id of f.sourceClaimIds) {
      const prev = out.get(id);
      if (!prev || CLASS_RANK[cls] > CLASS_RANK[prev.cls]) out.set(id, { cls, findingId: f.id });
    }
  }
  return out;
}

// ------------------------------------------------------------- event rows

const SHORT_LABELS: Record<string, string> = {
  collision: "impact",
  rack_collapse: "rack collapse",
  alarm: "alarm",
  chemical_smell: "smell",
  smoke: "smoke",
  fire: "fire",
  spill: "spill",
  shouting: "shouting",
  evacuation: "evacuation",
};

export function shortLabel(key: string): string {
  return SHORT_LABELS[key] ?? key.replace(/_/g, " ");
}

function chipLabel(claim: Claim, eventKey: string): string {
  switch (claim.category) {
    case "temporal_order":
      return claim.subject === eventKey
        ? `Before ${shortLabel(claim.object)}`
        : `After ${shortLabel(claim.subject)}`;
    case "presence":
      return claim.object === "present"
        ? capitalize(shortLabel(claim.subject))
        : `No ${shortLabel(claim.subject)}`;
    case "attribute":
      return `${claim.predicate.replace("_", " ")}: ${claim.object}`;
    case "time_point":
      return claim.displayObject;
    case "location":
      return claim.displayObject;
    case "entity":
      return claim.displayObject;
    default:
      return truncate(claim.displayObject, 26);
  }
}

export function buildRows(state: AppState): EventRow[] {
  const classes = classifyClaims(state.findings);
  const contradictions = state.findings.filter((f) => f.type === "contradiction");

  return state.timeline.map((event, index) => {
    // Claims about this event: presence/order claims naming it, plus — on the
    // first event — the entity attributes that describe the scene.
    const relevant = state.claims.filter((c) => {
      if (c.category === "narrative") return false;

      // An ordering claim names two events, so it would otherwise appear on
      // both rows and split a single disagreement in half. Pin it to one home
      // row — chosen stably from the pair, so every witness's version of the
      // same dispute lands together.
      if (c.category === "temporal_order") {
        return event.eventKey === [c.subject, c.object].sort()[0];
      }

      if (c.subject === event.eventKey || c.object === event.eventKey) return true;
      if (index === 0 && c.category === "attribute" && c.predicate !== "place_id") return true;
      return false;
    });

    // One chip per witness per event — the most significant claim wins.
    const best = new Map<string, { claim: Claim; cls: ClaimClass; findingId: string | null }>();
    for (const claim of relevant) {
      const info = classes.get(claim.id);
      const cls = info?.cls ?? "single";
      const prev = best.get(claim.witnessId);
      if (!prev || CLASS_RANK[cls] > CLASS_RANK[prev.cls]) {
        best.set(claim.witnessId, { claim, cls, findingId: info?.findingId ?? null });
      }
    }

    const entries = [...best.values()];

    // "I saw the rack collapse" on the rack-collapse event adds nothing the
    // label doesn't already say — show it as a bare letter instead.
    const isBadge = (e: (typeof entries)[number]) =>
      e.claim.category === "presence" &&
      e.claim.subject === event.eventKey &&
      e.claim.object === "present" &&
      e.cls !== "contradiction";

    // Witnesses asserting the same thing share a side, so the two halves of a
    // disagreement end up physically facing each other across the spine.
    const stances: string[] = [];
    const sideFor = (claim: (typeof entries)[number]["claim"]): "left" | "right" => {
      const stance = `${claim.subject}|${claim.predicate}|${claim.object}`;
      let idx = stances.indexOf(stance);
      if (idx === -1) {
        stances.push(stance);
        idx = stances.length - 1;
      }
      return idx % 2 === 0 ? "left" : "right";
    };

    let leftSlot = 0;
    let rightSlot = 0;
    let badgeSlot = 0;

    const chips: Chip[] = entries.map((entry) => {
      const badge = isBadge(entry);
      const side: "left" | "right" = badge ? "right" : sideFor(entry.claim);
      return {
        claimId: entry.claim.id,
        witnessId: entry.claim.witnessId,
        label: chipLabel(entry.claim, event.eventKey),
        cls: entry.cls,
        excerpt: entry.claim.sourceExcerpt,
        certainty: entry.claim.certainty,
        findingId: entry.findingId,
        kind: badge ? "badge" : "pill",
        side,
        slot: badge ? badgeSlot++ : side === "left" ? leftSlot++ : rightSlot++,
      };
    });

    const claimIds = new Set(relevant.map((c) => c.id));
    const contradiction =
      contradictions.find((f) => f.sourceClaimIds.some((id) => claimIds.has(id))) ?? null;

    return {
      id: event.id,
      eventKey: event.eventKey,
      label: event.label,
      time: event.approximateTime,
      step: index + 1,
      confidence: event.confidence,
      supportingWitnessIds: event.supportingWitnessIds,
      chips,
      contradictionId: contradiction?.id ?? null,
    };
  });
}

/** Splits a contradiction into its two opposing sides for the detail panel. */
export interface OpposingSide {
  witnessId: string;
  statement: string;
  excerpt: string;
  certainty: string;
  time: string | null;
}

export function opposingSides(finding: Finding, claims: Claim[]): OpposingSide[] {
  const involved = finding.sourceClaimIds
    .map((id) => claims.find((c) => c.id === id))
    .filter((c): c is Claim => Boolean(c));

  // Group by what is actually being asserted, not by who said it. Picking the
  // first claim per witness can land on two witnesses stating the *same* side
  // of a dispute, which renders two identical cards facing each other.
  const stances = new Map<string, Claim[]>();
  for (const c of involved) {
    const key = `${c.subject}|${c.predicate}|${c.object}`;
    const list = stances.get(key);
    if (list) list.push(c);
    else stances.set(key, [c]);
  }

  const picked =
    stances.size >= 2
      ? [...stances.values()].slice(0, 2).map((group) => group[0])
      : // Only one stance present — fall back to one claim per witness.
        [...new Map(involved.map((c) => [c.witnessId, c])).values()].slice(0, 2);

  return picked.map((claim) => ({
    witnessId: claim.witnessId,
    statement: statementFor(claim),
    excerpt: claim.sourceExcerpt,
    certainty: claim.certainty,
    time: claim.normalizedTime !== null ? claim.displayObject : null,
  }));
}

function statementFor(claim: Claim): string {
  switch (claim.category) {
    case "temporal_order":
      return `${capitalize(shortLabel(claim.subject))} happened before ${shortLabel(claim.object)}.`;
    case "attribute":
      return `The ${claim.subject.replace(/_/g, " ")} was ${claim.object}.`;
    case "presence":
      return claim.object === "present"
        ? `${capitalize(shortLabel(claim.subject))} was observed.`
        : `${capitalize(shortLabel(claim.subject))} was not observed.`;
    default:
      return claim.displayObject;
  }
}

/** Confidence shown on a claim card — derived from certainty and corroboration. */
export function confidenceFor(certainty: string, cls: ClaimClass): number {
  const base = certainty === "high" ? 72 : certainty === "medium" ? 55 : 38;
  if (cls === "corroborated") return Math.min(94, base + 18);
  if (cls === "contradiction") return Math.max(28, base - 24);
  return base;
}

// ----------------------------------------------------------------- helpers

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…";
}

export function hasRealData(state: AppState): boolean {
  return state.timeline.length > 0 || state.interviews.length > 0;
}
