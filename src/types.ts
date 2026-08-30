// BLACKBOX — core data model.
// "Every witness has a piece. BlackBox builds the timeline."

export type CallStatus =
  | "queued"
  | "ringing"
  | "live"
  | "completed"
  | "no_answer"
  | "incomplete"
  | "failed";

export type ConsentStatus = "unknown" | "granted" | "declined";

export type Certainty = "high" | "medium" | "low";

export interface Incident {
  id: string;
  title: string;
  type: string;
  location: string;
  approximateTime: string; // human string, e.g. "8:12 PM"
  description: string;
  status: "open" | "reconciling" | "reviewed";
  createdAt: string;
  /** Agency case / claim number. */
  referenceId: string;
  /** The investigating body opening the case. */
  openedBy: string;
  /**
   * What the police or insurer already holds on file. Given to the agent as
   * background only — it is never recited to a witness, because doing so would
   * contaminate their account.
   */
  knownContext: string;
}

/** Case templates offered when opening a new investigation. */
export const CASE_TYPES = [
  "Police investigation",
  "Insurance claim",
  "Workplace safety incident",
  "Traffic collision",
  "Public transport incident",
  "Healthcare incident",
  "Compliance / internal investigation",
] as const;

export interface Witness {
  id: string;
  incidentId: string;
  displayName: string;
  phoneNumber: string;
  callStatus: CallStatus;
  consentStatus: ConsentStatus;
  interviewStartedAt: string | null;
  interviewCompletedAt: string | null;
  lastError: string | null;
}

export interface TranscriptTurn {
  speaker: "agent" | "witness";
  text: string;
  at: string;
  utteranceId?: string;
}

export interface Interview {
  id: string;
  witnessId: string;
  incidentId: string;
  callId: string | null;
  transcript: TranscriptTurn[];
  fields: Record<string, unknown>;
  structuredSummary: string;
  completionStatus: "in_progress" | "completed" | "partial" | "failed";
  summaryConfirmed: boolean | null;
  startedAt: string;
  endedAt: string | null;
  terminationReason: string | null;
}

export type ClaimCategory =
  | "entity"
  | "attribute"
  | "temporal_order"
  | "time_point"
  | "presence"
  | "location"
  | "injury"
  | "narrative";

export interface Claim {
  id: string;
  incidentId: string;
  witnessId: string;
  category: ClaimCategory;
  /** Canonical entity/event key, e.g. "forklift", "alarm". */
  subject: string;
  /** Canonical relation, e.g. "color", "before", "observed_at". */
  predicate: string;
  /** Canonical value, e.g. "blue", "rack_collapse", "present". */
  object: string;
  /** Human-readable rendering of the object. */
  displayObject: string;
  /** Minutes since midnight, when the claim carries a clock time. */
  normalizedTime: number | null;
  temporalRelation: "before" | "after" | "simultaneous" | null;
  certainty: Certainty;
  /** Verbatim slice of what the witness actually said. Provenance is mandatory. */
  sourceExcerpt: string;
  sourceField: string | null;
}

export interface TimelineEvent {
  id: string;
  incidentId: string;
  label: string;
  /** Canonical event key. */
  eventKey: string;
  approximateTime: string | null;
  supportingWitnessIds: string[];
  confidence: "corroborated" | "single_source" | "disputed";
  sourceClaimIds: string[];
  /** Relative ordering rank derived from witness accounts. */
  rank: number;
}

export type FindingType =
  | "agreement"
  | "contradiction"
  | "unique_claim"
  | "open_question";

export interface Finding {
  id: string;
  incidentId: string;
  type: FindingType;
  title: string;
  explanation: string;
  involvedWitnessIds: string[];
  sourceClaimIds: string[];
  /** Populated for contradictions: the neutral question that could resolve it. */
  followUpQuestion?: string;
  /**
   * The safe way to put this to a witness on a live call.
   *
   * Investigator-facing questions routinely leak another witness's account
   * ("Did any other witness observe a chemical smell?" reveals that somebody
   * did). Only a question with this field set is ever spoken on a call.
   */
  witnessPrompt?: string;
  /**
   * Ask-order when call time is short. Lower goes first: resolving a live
   * dispute beats filling a gap, and an exclusive attribute (colour, direction)
   * is more likely to settle something than an open sensory prompt.
   */
  askPriority?: number;
}

export interface ReconciliationState {
  status: "idle" | "processing" | "ready" | "error";
  lastRunAt: string | null;
  error: string | null;
  /** Which analysis path produced the current findings, e.g. "openai:gpt-4o". */
  engine: string;
}
