// In-memory store with a JSON snapshot on disk.
// Deliberately dependency-free: no native modules, nothing to build, nothing to
// break on a laptop five minutes before a demo.

import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { extractClaims } from "./extract.ts";
import { mergeAnalyses, reconcile } from "./reconcile.ts";
import { analyzeWithLLM, llmConfigured } from "./llm.ts";
import { toE164 } from "./normalize.ts";
import type {
  AgentAction,
  Claim,
  Finding,
  EvidenceItem,
  ExternalSource,
  FollowUpQuestion,
  Incident,
  Interview,
  ParticipantRole,
  ReconciliationState,
  ReconstructionReport,
  ReconstructionState,
  TimelineEvent,
  TranscriptTurn,
  Witness,
} from "./types.ts";

const DATA_FILE = resolve(process.cwd(), "data", "blackbox.json");

interface Snapshot {
  incidents: Incident[];
  witnesses: Witness[];
  interviews: Interview[];
  claims: Claim[];
  findings: Finding[];
  timeline: TimelineEvent[];
  reconciliation: ReconciliationState;
  /** Prompts an investigator pinned to be asked first on the next call. */
  queuedPrompts: string[];
  evidence: EvidenceItem[];
  externalSources: ExternalSource[];
  /** Append-only audit trail, newest last. */
  agentActions: AgentAction[];
  followUps: FollowUpQuestion[];
  report: ReconstructionReport | null;
  reconstruction: ReconstructionState;
  /** Which case the dashboard is currently showing. */
  activeIncidentId: string | null;
}

function emptySnapshot(): Snapshot {
  return {
    incidents: [],
    witnesses: [],
    interviews: [],
    claims: [],
    findings: [],
    timeline: [],
    reconciliation: { status: "idle", lastRunAt: null, error: null, engine: "deterministic" },
    queuedPrompts: [],
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
      message: "Ready to reconstruct.",
      error: null,
    },
    activeIncidentId: null,
  };
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

class Store extends EventEmitter {
  private data: Snapshot = emptySnapshot();

  constructor() {
    super();
    this.setMaxListeners(50);
    this.load();
  }

  // ------------------------------------------------------------- persistence
  private load(): void {
    try {
      const raw = readFileSync(DATA_FILE, "utf8");
      const parsed = JSON.parse(raw) as Partial<Snapshot>;
      this.data = { ...emptySnapshot(), ...parsed };
    } catch {
      this.data = emptySnapshot(); // first run, or an unreadable snapshot — start clean
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(DATA_FILE), { recursive: true });
      writeFileSync(DATA_FILE, JSON.stringify(this.data, null, 2), "utf8");
    } catch (err) {
      // Persistence is a convenience, never a demo blocker.
      console.warn("[store] snapshot write failed:", (err as Error).message);
    }
  }

  private changed(reason: string): void {
    this.persist();
    this.emit("change", { reason, at: new Date().toISOString() });
  }

  // ------------------------------------------------------------------ reads
  getState() {
    return this.data;
  }

  getIncident(): Incident | null {
    const id = this.data.activeIncidentId;
    return (id && this.data.incidents.find((i) => i.id === id)) || this.data.incidents[0] || null;
  }

  /** Every case on file, newest first, with enough detail for the library. */
  listCases(): (Incident & { participants: number; contradictions: number; active: boolean })[] {
    const activeId = this.getIncident()?.id;
    return [...this.data.incidents]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((i) => ({
        ...i,
        participants: this.data.witnesses.filter((w) => w.incidentId === i.id).length,
        contradictions: this.data.findings.filter(
          (f) => f.incidentId === i.id && f.type === "contradiction",
        ).length,
        active: i.id === activeId,
      }));
  }

  setActiveCase(id: string): Incident | null {
    const found = this.data.incidents.find((i) => i.id === id);
    if (!found) return null;
    this.data.activeIncidentId = id;
    this.changed("case:activated");
    return found;
  }

  /** Removes a case and everything belonging to it. */
  deleteCase(id: string): boolean {
    if (!this.data.incidents.some((i) => i.id === id)) return false;
    this.data.incidents = this.data.incidents.filter((i) => i.id !== id);
    const gone = (x: { incidentId: string }) => x.incidentId !== id;
    this.data.witnesses = this.data.witnesses.filter(gone);
    this.data.interviews = this.data.interviews.filter(gone);
    this.data.claims = this.data.claims.filter(gone);
    this.data.findings = this.data.findings.filter(gone);
    this.data.timeline = this.data.timeline.filter(gone);
    this.data.evidence = this.data.evidence.filter(gone);
    this.data.externalSources = this.data.externalSources.filter(gone);
    this.data.agentActions = this.data.agentActions.filter(gone);
    this.data.followUps = this.data.followUps.filter(gone);
    if (this.data.report?.incidentId === id) this.data.report = null;
    if (this.data.activeIncidentId === id) {
      this.data.activeIncidentId = this.data.incidents[0]?.id ?? null;
    }
    this.changed("case:deleted");
    return true;
  }

  getWitness(id: string): Witness | undefined {
    return this.data.witnesses.find((w) => w.id === id);
  }

  findWitnessByPhone(phone: string): Witness | undefined {
    const target = toE164(phone);
    return this.data.witnesses.find((w) => w.phoneNumber && toE164(w.phoneNumber) === target);
  }

  getInterviewByWitness(witnessId: string): Interview | undefined {
    return this.data.interviews.find((i) => i.witnessId === witnessId);
  }

  getInterviewByCallId(callId: string): Interview | undefined {
    return this.data.interviews.find((i) => i.callId === callId);
  }

  // ----------------------------------------------------------------- writes
  createIncident(input: Omit<Incident, "id" | "createdAt" | "status">): Incident {
    const incident: Incident = {
      id: newId("inc"),
      status: "open",
      createdAt: new Date().toISOString(),
      ...input,
    };
    // Cases accumulate into a library; opening one does not discard the rest.
    this.data.incidents.push(incident);
    this.data.activeIncidentId = incident.id;
    this.changed("incident:created");
    return incident;
  }

  addWitness(
    incidentId: string,
    displayName: string,
    phoneNumber: string,
    role: ParticipantRole = "witness",
    descriptor = "",
    approach?: string,
  ): Witness {
    const witness: Witness = {
      id: newId("wit"),
      incidentId,
      displayName,
      phoneNumber: phoneNumber ? toE164(phoneNumber) : "",
      callStatus: "queued",
      consentStatus: "unknown",
      interviewStartedAt: null,
      interviewCompletedAt: null,
      lastError: null,
      role,
      descriptor,
      approach,
    };
    this.data.witnesses.push(witness);
    this.changed("witness:added");
    return witness;
  }

  updateWitness(id: string, patch: Partial<Witness>): Witness | undefined {
    const w = this.getWitness(id);
    if (!w) return undefined;
    Object.assign(w, patch);
    this.changed("witness:updated");
    return w;
  }

  startInterview(witnessId: string, callId: string | null): Interview {
    const witness = this.getWitness(witnessId);
    if (!witness) throw new Error(`unknown witness ${witnessId}`);

    let interview = this.getInterviewByWitness(witnessId);
    if (!interview) {
      interview = {
        id: newId("int"),
        witnessId,
        incidentId: witness.incidentId,
        callId,
        transcript: [],
        fields: {},
        structuredSummary: "",
        completionStatus: "in_progress",
        summaryConfirmed: null,
        startedAt: new Date().toISOString(),
        endedAt: null,
        terminationReason: null,
      };
      this.data.interviews.push(interview);
    } else {
      // Re-interview: clear prior content but keep identity.
      interview.callId = callId;
      interview.transcript = [];
      interview.fields = {};
      interview.completionStatus = "in_progress";
      interview.summaryConfirmed = null;
      interview.startedAt = new Date().toISOString();
      interview.endedAt = null;
      interview.terminationReason = null;
      this.data.claims = this.data.claims.filter((c) => c.witnessId !== witnessId);
    }

    witness.callStatus = "live";
    witness.interviewStartedAt = interview.startedAt;
    witness.lastError = null;
    this.changed("interview:started");
    return interview;
  }

  /**
   * Reopens an existing interview for a follow-up call.
   *
   * Unlike startInterview this keeps the prior transcript and answers — the
   * point of a callback is to add to a statement, not replace it. Reconciliation
   * then runs over the combined account.
   */
  startFollowUp(witnessId: string, callId: string | null): Interview {
    const existing = this.getInterviewByWitness(witnessId);
    if (!existing) return this.startInterview(witnessId, callId);

    const witness = this.getWitness(witnessId);
    existing.callId = callId;
    existing.completionStatus = "in_progress";
    existing.endedAt = null;
    existing.terminationReason = null;
    existing.transcript.push({
      speaker: "agent",
      text: "— follow-up interview —",
      at: new Date().toISOString(),
    });

    if (witness) {
      witness.callStatus = "live";
      witness.lastError = null;
    }
    this.changed("interview:followup");
    return existing;
  }

  /**
   * Pins a question to the front of the ask queue. Survives re-reconciliation
   * by matching on the prompt text, since finding ids are regenerated on each
   * analysis run.
   */
  queueQuestion(findingId: string): void {
    const finding = this.data.findings.find((f) => f.id === findingId);
    if (!finding) return;
    const prompt = finding.witnessPrompt ?? finding.followUpQuestion;
    if (!prompt) return;

    finding.askPriority = -1;
    if (!this.data.queuedPrompts.includes(prompt)) this.data.queuedPrompts.push(prompt);
    this.changed("question:queued");
  }

  /** Questions the voice agent is cleared to ask a witness on a live call. */
  askableQuestions(excludeWitnessId?: string): Finding[] {
    const claimOwner = new Map(this.data.claims.map((c) => [c.id, c.witnessId]));

    /**
     * Never put a question to the very person it came from — if every claim
     * behind it is theirs, they have already answered it and asking again just
     * sounds broken.
     */
    const alreadyAnswered = (f: Finding): boolean => {
      if (!excludeWitnessId) return false;
      const owners = f.sourceClaimIds.map((id) => claimOwner.get(id)).filter(Boolean);
      return owners.length > 0 && owners.every((w) => w === excludeWitnessId);
    };

    const candidates = this.data.findings.filter(
      (f) =>
        f.type === "open_question" &&
        typeof f.witnessPrompt === "string" &&
        f.witnessPrompt.trim().length > 8 &&
        !alreadyAnswered(f),
    );

    // A call has room for three questions, so ask the ones most likely to
    // settle something first — anything an investigator pinned goes ahead of all.
    const rank = (f: Finding) =>
      this.data.queuedPrompts.includes(f.witnessPrompt ?? "") ? -1 : (f.askPriority ?? 5);
    candidates.sort((a, b) => rank(a) - rank(b));

    // Drop only exact restatements. Fuzzy matching here is not worth it: these
    // prompts share long boilerplate tails ("…and what were the lighting
    // conditions where you were standing?"), so a similarity test throws away
    // genuinely different questions. Asking one near-duplicate is a far smaller
    // failure than never asking the question that resolves the case.
    const seen = new Set<string>();
    return candidates.filter((f) => {
      const key = f.witnessPrompt!.toLowerCase().replace(/[^a-z]/g, "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  appendTurn(interviewId: string, turn: TranscriptTurn): void {
    const interview = this.data.interviews.find((i) => i.id === interviewId);
    if (!interview) return;

    // Guava re-sends an utterance under the same id as it is refined; the last
    // version wins rather than accumulating duplicates.
    if (turn.utteranceId) {
      const idx = interview.transcript.findIndex((t) => t.utteranceId === turn.utteranceId);
      if (idx >= 0) {
        interview.transcript[idx] = turn;
        this.changed("transcript:updated");
        return;
      }
    }
    interview.transcript.push(turn);
    this.changed("transcript:appended");
  }

  setInterviewFields(interviewId: string, fields: Record<string, unknown>): void {
    const interview = this.data.interviews.find((i) => i.id === interviewId);
    if (!interview) return;
    interview.fields = { ...interview.fields, ...fields };
    this.changed("interview:fields");
  }

  completeInterview(
    interviewId: string,
    patch: Partial<Pick<Interview, "completionStatus" | "terminationReason" | "summaryConfirmed" | "structuredSummary">>,
  ): void {
    const interview = this.data.interviews.find((i) => i.id === interviewId);
    if (!interview) return;
    Object.assign(interview, patch);
    interview.endedAt = new Date().toISOString();

    const witness = this.getWitness(interview.witnessId);
    if (witness) {
      witness.interviewCompletedAt = interview.endedAt;
      witness.callStatus =
        patch.completionStatus === "completed"
          ? "completed"
          : patch.completionStatus === "partial"
            ? "incomplete"
            : "failed";
    }
    this.changed("interview:completed");
  }

  // -------------------------------------------------------- reconciliation
  setReconciliation(patch: Partial<ReconciliationState>): void {
    this.data.reconciliation = { ...this.data.reconciliation, ...patch };
    this.changed("reconciliation:status");
  }

  /**
   * Re-derives every claim, finding, and timeline entry from the interviews on
   * record. Safe to call repeatedly; results always reflect real interview data.
   */
  runReconciliation(): { claims: Claim[]; findings: Finding[]; timeline: TimelineEvent[] } {
    const incident = this.getIncident();
    if (!incident) throw new Error("no incident");

    this.setReconciliation({ status: "processing", error: null });
    try {
      const usable = this.usableInterviews();

      const claims: Claim[] = [];
      for (const interview of usable) {
        try {
          claims.push(...extractClaims(interview, incident, interview.witnessId));
        } catch (err) {
          // One malformed interview must not take down the whole analysis.
          console.error(`[reconcile] extraction failed for ${interview.id}:`, err);
        }
      }

      const witnesses = this.data.witnesses;
      const { findings, timeline } = reconcile(claims, witnesses, incident);

      this.data.claims = claims;
      this.data.findings = findings;
      this.data.timeline = timeline;
      this.data.reconciliation = {
        status: "ready",
        lastRunAt: new Date().toISOString(),
        error: null,
        engine: this.data.reconciliation.engine,
      };
      this.changed("reconciliation:complete");
      return { claims, findings, timeline };
    } catch (err) {
      this.setReconciliation({ status: "error", error: (err as Error).message });
      throw err;
    }
  }

  /**
   * Interviews worth analysing right now, including one still in progress.
   * Used mid-call so a partial account already shows on the board.
   */
  liveInterviews(): Interview[] {
    return this.data.interviews.filter(
      (i) =>
        i.completionStatus !== "failed" &&
        i.transcript.some((t) => t.speaker === "witness"),
    );
  }

  /** Interviews with enough content to analyse. */
  usableInterviews(): Interview[] {
    return this.data.interviews.filter(
      (i) => i.completionStatus === "completed" || i.completionStatus === "partial",
    );
  }

  /**
   * Two engines, cross-checked.
   *
   * The deterministic pass runs first and always — it is instant, proven, and
   * puts findings on screen immediately. The OpenAI pass then runs and its
   * results are merged in, catching anything the lexicon could not parse. If
   * the model is unavailable or returns something untrustworthy, the
   * deterministic result simply stands.
   */
  async runReconciliationSmart(): Promise<{
    claims: Claim[];
    findings: Finding[];
    timeline: TimelineEvent[];
    engine: string;
  }> {
    const incident = this.getIncident();
    if (!incident) throw new Error("no incident");

    const deterministic = this.runReconciliation();
    const interviews = this.usableInterviews();

    if (!llmConfigured() || interviews.length === 0) {
      this.setReconciliation({ engine: "deterministic" });
      return { ...deterministic, engine: "deterministic" };
    }

    this.setReconciliation({ status: "processing", error: null });
    try {
      const llm = await analyzeWithLLM(incident, this.data.witnesses, interviews);
      if (llm) {
        const merged = mergeAnalyses(deterministic, llm);
        const engine = `openai:${llm.model} + rules`;
        this.data.claims = merged.claims;
        this.data.findings = merged.findings;
        this.data.timeline = merged.timeline;
        this.data.reconciliation = {
          status: "ready",
          lastRunAt: new Date().toISOString(),
          error: null,
          engine,
        };
        this.changed("reconciliation:complete");
        return { ...merged, engine };
      }
      console.warn("[store] LLM analysis unusable — deterministic result stands");
    } catch (err) {
      console.warn("[store] LLM analysis failed:", (err as Error).message);
    }

    this.setReconciliation({ status: "ready", engine: "deterministic" });
    return { ...deterministic, engine: "deterministic" };
  }


  // ------------------------------------------------------- case file objects

  addEvidence(item: Omit<EvidenceItem, "id" | "incidentId">, incidentId: string): EvidenceItem {
    const ev: EvidenceItem = { id: newId("evd"), incidentId, ...item };
    this.data.evidence.push(ev);
    this.changed("evidence:added");
    return ev;
  }

  updateEvidence(id: string, patch: Partial<EvidenceItem>): void {
    const ev = this.data.evidence.find((e) => e.id === id);
    if (!ev) return;
    Object.assign(ev, patch);
    this.changed("evidence:updated");
  }

  addExternalSource(src: Omit<ExternalSource, "id">): ExternalSource {
    const s: ExternalSource = { id: newId("src"), ...src };
    this.data.externalSources.push(s);
    this.changed("source:added");
    return s;
  }

  /**
   * Appends to the activity feed. Returns the id so a long-running step can be
   * marked done or failed once it finishes.
   */
  logAction(action: Omit<AgentAction, "id" | "at">): string {
    const a: AgentAction = { id: newId("act"), at: new Date().toISOString(), ...action };
    this.data.agentActions.push(a);
    // The feed is a demo surface as much as an audit trail; keep it bounded.
    if (this.data.agentActions.length > 400) this.data.agentActions.splice(0, 100);
    this.changed("agent:action");
    return a.id;
  }

  finishAction(id: string, status: "done" | "failed", detail?: string): void {
    const a = this.data.agentActions.find((x) => x.id === id);
    if (!a) return;
    a.status = status;
    if (detail) a.detail = detail;
    this.changed("agent:action");
  }

  setFollowUps(items: FollowUpQuestion[]): void {
    this.data.followUps = items;
    this.changed("followups:set");
  }

  setReport(report: ReconstructionReport | null): void {
    this.data.report = report;
    this.changed("report:set");
  }

  setReconstruction(patch: Partial<ReconstructionState>): void {
    this.data.reconstruction = { ...this.data.reconstruction, ...patch };
    this.changed("reconstruction:state");
  }

  /** Replaces the transcript wholesale — used by the deterministic simulator. */
  setTranscript(interviewId: string, turns: TranscriptTurn[]): void {
    const iv = this.data.interviews.find((i) => i.id === interviewId);
    if (!iv) return;
    iv.transcript = turns;
    this.changed("transcript:set");
  }

  /** Installs a completed analysis pass as the current case state. */
  applyAnalysis(
    claims: Claim[],
    findings: Finding[],
    timeline: TimelineEvent[],
    engine: string,
  ): void {
    // Scope the replacement to this case so other investigations survive.
    const caseId = this.getIncident()?.id;
    const other = (x: { incidentId: string }) => x.incidentId !== caseId;
    this.data.claims = [...this.data.claims.filter(other), ...claims];
    this.data.findings = [...this.data.findings.filter(other), ...findings];
    this.data.timeline = [...this.data.timeline.filter(other), ...timeline];
    this.data.reconciliation = {
      status: "ready",
      lastRunAt: new Date().toISOString(),
      error: null,
      engine,
    };
    this.changed("analysis:applied");
  }

  reset(): void {
    this.data = emptySnapshot();
    this.changed("reset");
  }
}

export const store = new Store();
