// BLACKBOX — core data model.
// "Every witness has a piece. BlackBox builds the timeline."

export type CallStatus =
  | "queued"
  | "dialing"
  | "ringing"
  | "live"
  | "interviewing"
  | "processing"
  | "completed"
  | "no_answer"
  | "incomplete"
  | "failed";

/** Stages a participant card moves through during a reconstruction. */
export const CALL_STAGE_ORDER: CallStatus[] = [
  "queued",
  "dialing",
  "ringing",
  "interviewing",
  "processing",
  "completed",
];

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
  /** How this person relates to the incident. */
  role: ParticipantRole;
  /** Free-text descriptor shown under the name, e.g. "Black Tesla, northbound". */
  descriptor: string;
  /**
   * Direction of travel or vantage point, taken from the case file rather than
   * from testimony. Two drivers on different approaches cannot both have had a
   * green light, and that joint impossibility is only detectable with this.
   */
  approach?: string;
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
  | "narrative"
  /**
   * What a participant believes happened, as opposed to what they saw.
   * Recorded because investigators need it, and kept strictly apart from
   * observation: an inference never corroborates anything, never
   * contradicts anything, and is never evidence of fault.
   */
  | "inference";

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
  /** Offset into the interview transcript, for audio scrubbing and citation. */
  transcriptSegmentId?: string;
  /** Verdict after weighing every account and external source. */
  classification?: ClaimClassification;
  /** 0-100 confidence in the classification — never in the speaker's honesty. */
  analysisConfidence?: number;
  corroboratingClaimIds?: string[];
  conflictingClaimIds?: string[];
  externalEvidenceIds?: string[];
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

// ---------------------------------------------------------------------------
// Case-file extensions
//
// The reconciliation engine below still speaks in terms of Incident / Witness /
// Claim, so those names are kept intact. Everything an investigator-facing case
// file needs — participants with roles, evidence, external corroboration, the
// agent audit trail, and the final report — is layered on here.
// ---------------------------------------------------------------------------

/** An investigation case. Alias of Incident so the engine keeps compiling. */
export type Case = Incident;

export type ParticipantRole =
  | "driver"
  | "passenger"
  | "pedestrian"
  | "witness"
  | "employee"
  | "first_responder"
  | "other";

/**
 * How a claim stands once every account and external source has been weighed.
 * Deliberately never includes anything resembling "lying" — inconsistency is
 * not deception, and BlackBox does not assign intent.
 */
export type ClaimClassification =
  | "independently_corroborated"
  | "supported_by_external_evidence"
  | "internally_inconsistent"
  | "contradicted_by_another_claim"
  | "contradicted_by_external_evidence"
  | "unresolved"
  | "requires_follow_up";

export const CLASSIFICATION_LABELS: Record<ClaimClassification, string> = {
  independently_corroborated: "Independently corroborated",
  supported_by_external_evidence: "Supported by external evidence",
  internally_inconsistent: "Internally inconsistent",
  contradicted_by_another_claim: "Contradicted by another claim",
  contradicted_by_external_evidence: "Contradicted by external evidence",
  unresolved: "Unresolved",
  requires_follow_up: "Requires follow-up",
};

/** Uploaded material belonging to the case. Raw bytes are never mutated. */
export interface EvidenceItem {
  id: string;
  incidentId: string;
  kind: "image" | "audio" | "video" | "document" | "data" | "other";
  filename: string;
  /** Bytes on disk, when the file was actually uploaded. */
  sizeBytes: number;
  uploadedAt: string;
  description: string;
  /** Output of the sandboxed processing pass, if it has run. */
  extracted: Record<string, unknown> | null;
  processedAt: string | null;
  /** Which sandbox executed it, for the audit trail. */
  processedBy: string | null;
  /** True when this item ships with the seeded demo rather than being uploaded. */
  demo: boolean;
}

/** A public web source retrieved to corroborate or challenge a recollection. */
export interface ExternalSource {
  id: string;
  incidentId: string;
  title: string;
  url: string;
  snippet: string;
  /** Why this was pulled: weather, signals, road layout, news, cameras. */
  category:
    | "weather"
    | "street_layout"
    | "traffic_signal"
    | "road_closure"
    | "nearby_business"
    | "camera"
    | "news"
    | "public_notice"
    | "other";
  retrievedAt: string;
  /** How it bears on the case, in one sentence. */
  relevance: string;
  /** Claims this source speaks to. */
  relatedClaimIds: string[];
  /** Whether it supports, challenges, or merely contextualises those claims. */
  bearing: "supports" | "challenges" | "context";
  /** "brightdata:search_engine" — or "demo_fixture" when running offline. */
  provider: string;
  /**
   * A claim this source settles outright, as subject.predicate — for
   * example "weather.condition". Only set when the source is authoritative
   * on that fact, which is what lets a claim be marked contradicted by
   * external evidence rather than merely disputed by another person.
   */
  factKey?: string;
  factValue?: string;
}

/** One line in the live agent activity feed. Also the audit trail. */
export interface AgentAction {
  id: string;
  incidentId: string;
  /** Which agent role acted. */
  agent:
    | "orchestrator"
    | "interviewer"
    | "claim_analyst"
    | "contradiction_analyst"
    | "evidence_researcher"
    | "report_agent"
    | "sandbox"
    | "memory";
  /** Short imperative summary, e.g. "Extracted 7 claims from Maya Chen". */
  summary: string;
  detail: string | null;
  at: string;
  status: "running" | "done" | "failed";
  /** Which backend actually served this: real SDK or labelled fallback. */
  via: string | null;
}

export interface FollowUpQuestion {
  id: string;
  incidentId: string;
  question: string;
  /** Neutral phrasing safe to read to a participant on a live call. */
  witnessPrompt: string | null;
  targetParticipantIds: string[];
  /** The contradiction or gap that produced it. */
  reason: string;
  sourceFindingId: string | null;
  priority: number;
  status: "open" | "queued" | "asked" | "answered";
}

export interface ReconstructionReport {
  id: string;
  incidentId: string;
  generatedAt: string;
  /** Plain-language account of what can and cannot be established. */
  summary: string;
  established: string[];
  disputed: string[];
  unresolved: string[];
  recommendedNextAction: string;
  /** 0-100. Explained in `confidenceBasis`, never shown bare. */
  confidence: number;
  confidenceBasis: string;
  markdown: string;
}

/** Phases of the reconstruction state machine, in order. */
export type ReconstructionPhase =
  | "idle"
  | "dialing"
  | "interviewing"
  | "extracting"
  | "researching"
  | "reconciling"
  | "reporting"
  | "complete"
  | "failed";

export interface ReconstructionState {
  phase: ReconstructionPhase;
  startedAt: string | null;
  completedAt: string | null;
  /** 0-100, for the header progress indicator. */
  progress: number;
  message: string;
  error: string | null;
}

/** Whether an integration is live or running on a labelled fallback. */
export interface IntegrationStatus {
  name: string;
  mode: "live" | "demo" | "unavailable";
  detail: string;
}
