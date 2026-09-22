// Derives everything the interface draws from the case state. Pure functions —
// nothing is invented here, only arranged and colour-coded.

import {
  CLASSIFICATION_TONE,
  type AppState,
  type Claim,
  type ClaimClassification,
  type Finding,
  type Participant,
  type TimelineEvent,
} from "./types";

export const PARTICIPANT_COLORS = [
  "#3ad6c8",
  "#6ea8fe",
  "#f0a94c",
  "#c08cf5",
  "#5fd97f",
  "#f07fa8",
];

export interface ParticipantMeta {
  id: string;
  initials: string;
  name: string;
  role: string;
  descriptor: string;
  color: string;
}

export function participantMeta(participants: Participant[]): Map<string, ParticipantMeta> {
  const map = new Map<string, ParticipantMeta>();
  participants.forEach((p, i) => {
    map.set(p.id, {
      id: p.id,
      initials: initials(p.displayName),
      name: p.displayName,
      role: p.role.replace(/_/g, " "),
      descriptor: p.descriptor,
      color: PARTICIPANT_COLORS[i % PARTICIPANT_COLORS.length],
    });
  });
  return map;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ---------------------------------------------------------------- call states

const STAGE_INDEX: Record<string, number> = {
  queued: 0,
  dialing: 1,
  ringing: 2,
  live: 3,
  interviewing: 3,
  processing: 4,
  completed: 5,
};

export function stageProgress(status: string): number {
  const i = STAGE_INDEX[status];
  return i === undefined ? 0 : (i / 5) * 100;
}

export function stageLabel(status: string): string {
  switch (status) {
    case "queued": return "Queued";
    case "dialing": return "Dialing";
    case "ringing": return "Ringing";
    case "live":
    case "interviewing": return "Interviewing";
    case "processing": return "Processing";
    case "completed": return "Complete";
    case "no_answer": return "No answer";
    case "incomplete": return "Incomplete";
    case "failed": return "Failed";
    default: return status;
  }
}

export function isActive(status: string): boolean {
  return ["dialing", "ringing", "live", "interviewing", "processing"].includes(status);
}

// -------------------------------------------------------------- claim bubbles

export type Tone = "good" | "warn" | "bad" | "neutral";

export function claimTone(c: Claim): Tone {
  if (!c.classification) return "neutral";
  return CLASSIFICATION_TONE[c.classification] ?? "neutral";
}

export const TONE_COLOR: Record<Tone, string> = {
  good: "#3ad6c8",
  warn: "#f0a94c",
  bad: "#ff5f56",
  neutral: "#6ea8fe",
};

/** A claim positioned against a timeline event. */
export interface Bubble {
  claim: Claim;
  tone: Tone;
  side: "left" | "right";
  slot: number;
  label: string;
}

export interface EventRow {
  event: TimelineEvent;
  bubbles: Bubble[];
  contradiction: Finding | null;
}

const SHORT: Record<string, string> = {
  collision: "impact",
  horn: "horn",
  braking: "braking",
  traffic_light: "signal",
  rack_collapse: "collapse",
  alarm: "alarm",
  steam: "steam",
};

function short(key: string): string {
  return SHORT[key] ?? key.replace(/_/g, " ");
}

function bubbleLabel(c: Claim): string {
  switch (c.category) {
    case "temporal_order":
      return `Before ${short(c.object)}`;
    case "presence":
      return c.object === "present" ? cap(short(c.subject)) : `No ${short(c.subject)}`;
    case "attribute":
      return `${short(c.subject)} ${c.predicate}: ${c.object}`;
    case "time_point":
      return c.displayObject;
    case "entity":
      return c.displayObject;
    default:
      return truncate(c.displayObject, 28);
  }
}

/**
 * Lays claims out against the timeline.
 *
 * Claims asserting the same thing share a side, so the two halves of a
 * disagreement end up facing each other across the spine rather than scattered.
 */
export function buildRows(state: AppState): EventRow[] {
  const contradictions = state.findings.filter((f) => f.type === "contradiction");

  return state.timeline.map((event, index) => {
    const relevant = state.claims.filter((c) => {
      if (c.category === "temporal_order") {
        return event.eventKey === [c.subject, c.object].sort()[0];
      }
      if (c.subject === event.eventKey || c.object === event.eventKey) return true;
      // Scene-level attributes (vehicle colours, the signal) anchor to the first event.
      if (index === 0 && c.category === "attribute") return true;
      return false;
    });

    // One bubble per participant per event: the most significant claim wins.
    const rank = (c: Claim) => (claimTone(c) === "bad" ? 3 : claimTone(c) === "warn" ? 2 : 1);
    const best = new Map<string, Claim>();
    for (const c of relevant) {
      const prev = best.get(c.witnessId);
      if (!prev || rank(c) > rank(prev)) best.set(c.witnessId, c);
    }

    const stances: string[] = [];
    let left = 0;
    let right = 0;
    const bubbles: Bubble[] = [...best.values()].map((claim) => {
      const stance = `${claim.subject}|${claim.predicate}|${claim.object}`;
      let si = stances.indexOf(stance);
      if (si === -1) si = stances.push(stance) - 1;
      const side: "left" | "right" = si % 2 === 0 ? "left" : "right";
      return {
        claim,
        tone: claimTone(claim),
        side,
        slot: side === "left" ? left++ : right++,
        label: bubbleLabel(claim),
      };
    });

    const ids = new Set(relevant.map((c) => c.id));
    const contradiction =
      contradictions.find((f) => f.sourceClaimIds.some((id) => ids.has(id))) ?? null;

    return { event, bubbles, contradiction };
  });
}

// ------------------------------------------------------------- contradictions

export interface Side {
  participantId: string;
  statement: string;
  excerpt: string;
  certainty: string;
  claimId: string;
  confidence: number;
}

/** Splits a contradiction into its opposing positions, one card each. */
export function opposingSides(finding: Finding, claims: Claim[]): Side[] {
  const involved = finding.sourceClaimIds
    .map((id) => claims.find((c) => c.id === id))
    .filter((c): c is Claim => Boolean(c));

  // Group by what is asserted, not by who said it — otherwise two people on the
  // same side of a dispute render as two identical, facing cards.
  const stances = new Map<string, Claim[]>();
  for (const c of involved) {
    const key = `${c.subject}|${c.predicate}|${c.object}`;
    const list = stances.get(key);
    if (list) list.push(c);
    else stances.set(key, [c]);
  }

  const picked =
    stances.size >= 2
      ? [...stances.values()].slice(0, 2).map((g) => g[0])
      : [...new Map(involved.map((c) => [c.witnessId, c])).values()].slice(0, 2);

  return picked.map((c) => ({
    participantId: c.witnessId,
    statement: statementFor(c),
    excerpt: c.sourceExcerpt,
    certainty: c.certainty,
    claimId: c.id,
    confidence: c.analysisConfidence ?? 50,
  }));
}

function statementFor(c: Claim): string {
  switch (c.category) {
    case "temporal_order":
      return `${cap(short(c.subject))} happened before ${short(c.object)}.`;
    case "attribute":
      return `The ${short(c.subject)} was ${c.object}.`;
    case "presence":
      return c.object === "present"
        ? `${cap(short(c.subject))} was observed.`
        : `${cap(short(c.subject))} was not observed.`;
    case "time_point":
      return `It happened at about ${c.displayObject}.`;
    default:
      return c.displayObject;
  }
}

// --------------------------------------------------------------------- counts

export function counts(state: AppState) {
  const t = (x: string) => state.findings.filter((f) => f.type === x).length;
  return {
    agreements: t("agreement"),
    contradictions: t("contradiction"),
    unique: t("unique_claim"),
    open: t("open_question"),
    claims: state.claims.length,
    interviewed: state.participants.filter((p) => p.callStatus === "completed").length,
  };
}

export function classificationBreakdown(claims: Claim[]): [ClaimClassification, number][] {
  const m = new Map<ClaimClassification, number>();
  for (const c of claims) {
    if (!c.classification) continue;
    m.set(c.classification, (m.get(c.classification) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

// -------------------------------------------------------------------- helpers

export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…";
}

export function timeAgo(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(d) || d < 0) return "";
  if (d < 60_000) return `${Math.floor(d / 1000)}s ago`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export const AGENT_LABEL: Record<string, string> = {
  orchestrator: "Orchestrator",
  interviewer: "Interview Agent",
  claim_analyst: "Claim Analyst",
  contradiction_analyst: "Contradiction Analyst",
  evidence_researcher: "Evidence Researcher",
  report_agent: "Report Agent",
  sandbox: "Sandbox",
  memory: "Case Memory",
};
