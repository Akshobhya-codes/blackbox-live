// Mirrors the payload from GET /api/state (server strips raw phone numbers).

export type CallStatus =
  | "queued"
  | "ringing"
  | "live"
  | "completed"
  | "no_answer"
  | "incomplete"
  | "failed";

export interface Incident {
  id: string;
  title: string;
  type: string;
  location: string;
  approximateTime: string;
  description: string;
  status: string;
  createdAt: string;
  referenceId: string;
  openedBy: string;
  knownContext: string;
}

export interface Witness {
  id: string;
  incidentId: string;
  displayName: string;
  phoneMasked: string | null;
  hasPhone: boolean;
  callStatus: CallStatus;
  consentStatus: "unknown" | "granted" | "declined";
  interviewStartedAt: string | null;
  interviewCompletedAt: string | null;
  lastError: string | null;
  /** Filled in by the UI so a witness keeps one colour everywhere. */
  role?: string;
}

export interface TranscriptTurn {
  speaker: "agent" | "witness";
  text: string;
  at: string;
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
  simulated?: boolean;
}

export interface Claim {
  id: string;
  incidentId: string;
  witnessId: string;
  category: string;
  subject: string;
  predicate: string;
  object: string;
  displayObject: string;
  normalizedTime: number | null;
  certainty: "high" | "medium" | "low";
  sourceExcerpt: string;
  sourceField: string | null;
}

export interface TimelineEvent {
  id: string;
  incidentId: string;
  label: string;
  eventKey: string;
  approximateTime: string | null;
  supportingWitnessIds: string[];
  confidence: "corroborated" | "single_source" | "disputed";
  sourceClaimIds: string[];
  rank: number;
}

export interface Finding {
  id: string;
  incidentId: string;
  type: "agreement" | "contradiction" | "unique_claim" | "open_question";
  title: string;
  explanation: string;
  involvedWitnessIds: string[];
  sourceClaimIds: string[];
  followUpQuestion?: string;
  /** Set when this question is safe to read aloud to a witness on a call. */
  witnessPrompt?: string;
}

export interface AppState {
  incident: Incident | null;
  witnesses: Witness[];
  interviews: Interview[];
  claims: Claim[];
  findings: Finding[];
  timeline: TimelineEvent[];
  reconciliation: {
    status: "idle" | "processing" | "ready" | "error";
    lastRunAt: string | null;
    error: string | null;
    engine: string;
  };
  guava: {
    ready: boolean;
    error: string | null;
    agentNumber: string | null;
    inbound: boolean;
  };
}
