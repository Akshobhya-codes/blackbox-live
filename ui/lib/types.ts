// Mirrors GET /api/state. Phone numbers arrive masked; the raw value never
// leaves the server.

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

export type ParticipantRole =
  | "driver"
  | "passenger"
  | "pedestrian"
  | "witness"
  | "employee"
  | "first_responder"
  | "other";

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

/** Green / amber / red families used consistently across the whole interface. */
export const CLASSIFICATION_TONE: Record<ClaimClassification, "good" | "warn" | "bad"> = {
  independently_corroborated: "good",
  supported_by_external_evidence: "good",
  internally_inconsistent: "warn",
  contradicted_by_another_claim: "bad",
  contradicted_by_external_evidence: "bad",
  unresolved: "warn",
  requires_follow_up: "warn",
};

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

export interface Participant {
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
  role: ParticipantRole;
  descriptor: string;
  approach?: string;
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
  structuredSummary: string;
  completionStatus: "in_progress" | "completed" | "partial" | "failed";
  startedAt: string;
  endedAt: string | null;
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
  classification?: ClaimClassification;
  analysisConfidence?: number;
  corroboratingClaimIds?: string[];
  conflictingClaimIds?: string[];
  externalEvidenceIds?: string[];
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
  witnessPrompt?: string;
  askPriority?: number;
}

export interface EvidenceItem {
  id: string;
  incidentId: string;
  kind: "image" | "audio" | "video" | "document" | "data" | "other";
  filename: string;
  sizeBytes: number;
  uploadedAt: string;
  description: string;
  extracted: Record<string, unknown> | null;
  processedAt: string | null;
  processedBy: string | null;
  demo: boolean;
}

export interface ExternalSource {
  id: string;
  incidentId: string;
  title: string;
  url: string;
  snippet: string;
  category: string;
  retrievedAt: string;
  relevance: string;
  relatedClaimIds: string[];
  bearing: "supports" | "challenges" | "context";
  provider: string;
}

export interface AgentAction {
  id: string;
  incidentId: string;
  agent:
    | "orchestrator"
    | "interviewer"
    | "claim_analyst"
    | "contradiction_analyst"
    | "evidence_researcher"
    | "report_agent"
    | "sandbox"
    | "memory";
  summary: string;
  detail: string | null;
  at: string;
  status: "running" | "done" | "failed";
  via: string | null;
}

export interface FollowUpQuestion {
  id: string;
  incidentId: string;
  question: string;
  witnessPrompt: string | null;
  targetParticipantIds: string[];
  reason: string;
  sourceFindingId: string | null;
  priority: number;
  status: "open" | "queued" | "asked" | "answered";
}

export interface ReconstructionReport {
  id: string;
  incidentId: string;
  generatedAt: string;
  summary: string;
  established: string[];
  disputed: string[];
  unresolved: string[];
  recommendedNextAction: string;
  confidence: number;
  confidenceBasis: string;
  markdown: string;
}

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
  progress: number;
  message: string;
  error: string | null;
}

export interface IntegrationStatus {
  name: string;
  mode: "live" | "demo" | "unavailable";
  detail: string;
}

export interface AppState {
  demoMode: boolean;
  incident: Incident | null;
  participants: Participant[];
  interviews: Interview[];
  claims: Claim[];
  findings: Finding[];
  timeline: TimelineEvent[];
  evidence: EvidenceItem[];
  externalSources: ExternalSource[];
  agentActions: AgentAction[];
  followUps: FollowUpQuestion[];
  report: ReconstructionReport | null;
  reconstruction: ReconstructionState;
  reconciliation: { status: string; lastRunAt: string | null; error: string | null; engine: string };
}

export const EMPTY_STATE: AppState = {
  demoMode: true,
  incident: null,
  participants: [],
  interviews: [],
  claims: [],
  findings: [],
  timeline: [],
  evidence: [],
  externalSources: [],
  agentActions: [],
  followUps: [],
  report: null,
  reconstruction: {
    phase: "idle",
    startedAt: null,
    completedAt: null,
    progress: 0,
    message: "Connecting…",
    error: null,
  },
  reconciliation: { status: "idle", lastRunAt: null, error: null, engine: "—" },
};
