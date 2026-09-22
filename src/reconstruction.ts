// The reconstruction state machine.
//
// One pass over a case: call every participant, interview them, turn each
// account into claims, pull public context, reconcile everything, and write a
// report. Each step logs to the activity feed as it runs, which is both the
// audit trail and the thing an investigator watches.
//
// The loop that matters is interview -> extract -> compare -> find the gap ->
// generate the next question. Follow-ups produced here are fed back to the
// voice agent for the next call.

import { store } from "./store.ts";
import { extractClaims } from "./extract.ts";
import { mergeAnalyses, reconcile } from "./reconcile.ts";
import { analyzeWithLLM, llmConfigured } from "./llm.ts";
import { processEvidence } from "./adapters/sandbox.ts";
import * as brightdata from "./adapters/brightdata.ts";
import * as brain from "./adapters/brain.ts";
import { BB204_EXTERNAL_FIXTURES, bb204Queries } from "./cases/bb204.ts";
import type {
  AgentAction,
  Claim,
  ExternalSource,
  FollowUpQuestion,
  Incident,
  ReconstructionReport,
  TranscriptTurn,
  Witness,
} from "./types.ts";

/**
 * Demo pacing. The full run lands around 70 seconds so it fits inside a pitch.
 * RECON_FAST collapses the waits for automated testing.
 */
const SPEED = process.env.RECON_FAST === "1" ? 0.02 : 1;
const PACE = {
  betweenCalls: 700 * SPEED,
  ring: 900 * SPEED,
  perUtterance: 520 * SPEED,
  afterInterview: 500 * SPEED,
  step: 650 * SPEED,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function demoMode(): boolean {
  return (process.env.DEMO_MODE ?? "true").toLowerCase() !== "false";
}

let running = false;
export function isRunning(): boolean {
  return running;
}

function act(
  agent: AgentAction["agent"],
  summary: string,
  opts: { detail?: string; via?: string; status?: AgentAction["status"] } = {},
): string {
  const incident = store.getIncident();
  return store.logAction({
    incidentId: incident?.id ?? "",
    agent,
    summary,
    detail: opts.detail ?? null,
    status: opts.status ?? "done",
    via: opts.via ?? null,
  });
}

/**
 * Runs a full reconstruction. Safe to call once at a time; a second call while
 * one is in flight is rejected rather than interleaving two state machines.
 */
export async function runReconstruction(): Promise<void> {
  if (running) throw new Error("A reconstruction is already running");
  const incident = store.getIncident();
  if (!incident) throw new Error("No case is open");

  const participants = store.getState().witnesses;
  if (participants.length === 0) throw new Error("This case has no participants to interview");

  running = true;
  const startedAt = new Date().toISOString();
  store.setReconstruction({
    phase: "dialing",
    startedAt,
    completedAt: null,
    progress: 2,
    message: "Opening case and placing calls",
    error: null,
  });
  store.setReport(null);

  try {
    act("orchestrator", `Reconstruction started for ${incident.referenceId || incident.title}`, {
      detail: `${participants.length} participants queued for interview.`,
      via: demoMode() ? "demo simulator" : "live",
    });

    // Cognee builds a real graph, which takes tens of seconds. Start it now
    // and collect it later rather than making the operator watch a spinner:
    // the interviews are the interesting part and do not depend on it.
    const memory = seedMemory(incident, participants);

    await interviewAll(incident, participants);
    const claims = await extractAll(incident);
    const sources = await researchContext(incident);
    await processEvidenceItems();
    // Collect the case graph before reconciling, and say so — the label must
    // not still read "researching" while we are actually waiting on Cognee.
    store.setReconstruction({ progress: 70, message: "Waiting for the case graph" });
    await memory;
    await reconcileAll(incident, claims, sources);
    await writeReport(incident);

    store.setReconstruction({
      phase: "complete",
      completedAt: new Date().toISOString(),
      progress: 100,
      message: "Reconstruction complete",
    });
    act("orchestrator", "Reconstruction complete", {
      detail: "Report generated. Review contradictions and the recommended next action.",
    });
  } catch (err) {
    const message = (err as Error).message;
    store.setReconstruction({ phase: "failed", error: message, message: `Failed: ${message}` });
    act("orchestrator", "Reconstruction failed", { detail: message, status: "failed" });
    throw err;
  } finally {
    running = false;
  }
}

// ---------------------------------------------------------------------- memory

async function seedMemory(incident: Incident, participants: Witness[]): Promise<void> {
  const id = act("memory", "Writing the case file into Cognee", { status: "running" });
  const dataset = `blackbox_${incident.referenceId || incident.id}`.replace(/[^a-z0-9_]/gi, "_");

  const docs = [
    `CASE ${incident.referenceId}: ${incident.title}. Type: ${incident.type}. ` +
      `Location: ${incident.location}. Reported time: ${incident.approximateTime}. ` +
      `${incident.description}`,
    `PRIOR CASE FILE held by ${incident.openedBy}: ${incident.knownContext}`,
    ...participants.map(
      (p) => `PARTICIPANT ${p.displayName} — role ${p.role}, ${p.descriptor}. ` +
        `Approach: ${p.approach ?? "not recorded"}.`,
    ),
  ];

  const res = await brain.ingest(dataset, docs);
  if (res?.ok) {
    store.finishAction(id, "done", `${res.documents} documents ingested into the case graph.`);
    act("memory", "Case graph ready", { via: "cognee" });
  } else {
    store.finishAction(
      id,
      "done",
      `Cognee unavailable (${res?.detail ?? "brain service not reachable"}). ` +
        `Reconstruction continues on local state; no graph memory this run.`,
    );
  }
}

// ------------------------------------------------------------------ interviews

async function interviewAll(incident: Incident, participants: Witness[]): Promise<void> {
  store.setReconstruction({
    phase: "interviewing",
    progress: 10,
    message: "Interviewing participants",
  });

  // Sequential, so the operator can actually watch each card move.
  for (const [index, p] of participants.entries()) {
    await interviewOne(incident, p, index, participants.length);
  }
}

async function interviewOne(
  incident: Incident,
  participant: Witness,
  index: number,
  total: number,
): Promise<void> {
  const { seedStatementFor } = await import("./callProvider.ts");
  const statement = seedStatementFor(participant.displayName);

  store.updateWitness(participant.id, { callStatus: "dialing" });
  const callId = act("interviewer", `Calling ${participant.displayName}`, {
    detail: `${participant.descriptor}. Consent and recording notice given on connect.`,
    status: "running",
    via: demoMode() ? "demo call simulator" : "guava",
  });
  await sleep(PACE.betweenCalls);

  store.updateWitness(participant.id, { callStatus: "ringing" });
  await sleep(PACE.ring);

  const interview = store.startInterview(participant.id, `call_${participant.id}`);
  store.updateWitness(participant.id, {
    callStatus: "interviewing",
    consentStatus: "granted",
  });
  store.finishAction(callId, "done", "Connected. Consent granted, recording notice acknowledged.");

  // The opening ask is always the same: an uninterrupted account.
  const turns: TranscriptTurn[] = [
    {
      speaker: "agent",
      text:
        "This is an automated interviewer from BlackBox collecting a recorded statement " +
        `about the incident at ${incident.location}. Please describe, in your own words, ` +
        "what you saw and heard.",
      at: new Date().toISOString(),
    },
  ];
  store.setTranscript(interview.id, [...turns]);

  // Stream the account so the transcript panel fills in live.
  for (const line of statement) {
    await sleep(PACE.perUtterance);
    turns.push({ speaker: "witness", text: line, at: new Date().toISOString() });
    store.setTranscript(interview.id, [...turns]);
  }

  turns.push({
    speaker: "agent",
    text: "Thank you. That has been recorded for the investigation.",
    at: new Date().toISOString(),
  });
  store.setTranscript(interview.id, [...turns]);

  store.updateWitness(participant.id, { callStatus: "processing" });
  store.completeInterview(interview.id, {
    completionStatus: "completed",
    summaryConfirmed: true,
    structuredSummary: statement.join(" "),
  });
  await sleep(PACE.afterInterview);
  store.updateWitness(participant.id, { callStatus: "completed" });

  act("interviewer", `Interview complete — ${participant.displayName}`, {
    detail: `${statement.length} statement segments captured.`,
  });
  store.setReconstruction({
    progress: 10 + Math.round(((index + 1) / total) * 35),
    message: `Interviewed ${index + 1} of ${total}`,
  });
}

// --------------------------------------------------------------------- claims

async function extractAll(incident: Incident): Promise<Claim[]> {
  store.setReconstruction({ phase: "extracting", progress: 50, message: "Extracting claims" });
  const claims: Claim[] = [];

  for (const interview of store.usableInterviews()) {
    const w = store.getWitness(interview.witnessId);
    const id = act("claim_analyst", `Extracting claims from ${w?.displayName ?? "participant"}`, {
      status: "running",
    });
    const got = extractClaims(interview, incident, interview.witnessId);
    claims.push(...got);
    const reportable = got.filter((c) => c.category !== "narrative").length;
    store.finishAction(
      id,
      "done",
      `${reportable} claims, each linked to the exact words that produced it.`,
    );
    await sleep(PACE.step);
  }
  return claims;
}

// -------------------------------------------------------------------- context

async function researchContext(incident: Incident): Promise<ExternalSource[]> {
  store.setReconstruction({
    phase: "researching",
    progress: 62,
    message: "Retrieving public context",
  });

  const id = act("evidence_researcher", "Searching public sources for corroborating context", {
    status: "running",
    via: brightdata.brightDataConfigured() ? "brightdata:mcp" : "demo fixtures",
  });

  const queries = bb204Queries(incident.location, incident.approximateTime);
  const plan: brightdata.ResearchRequest[] = [
    { query: queries[0], category: "weather", relevance: "Visibility and road conditions at the reported time.", bearing: "context" },
    { query: queries[1], category: "traffic_signal", relevance: "Whether crossing approaches can show green simultaneously.", bearing: "challenges" },
    { query: queries[2], category: "street_layout", relevance: "Approach geometry and crosswalk positions.", bearing: "supports" },
    { query: queries[3], category: "camera", relevance: "Possible private cameras overlooking the approaches.", bearing: "supports" },
    { query: queries[4], category: "road_closure", relevance: "Any signal fault or closure on the incident date.", bearing: "context" },
  ];

  let sources: Omit<ExternalSource, "id">[] = [];
  if (brightdata.brightDataConfigured()) {
    try {
      sources = await brightdata.research(plan, incident.id);
    } catch (err) {
      console.warn("[reconstruction] Bright Data failed:", (err as Error).message);
    }
  }

  const live = sources.length > 0;
  if (!live) {
    // Labelled fixtures — the UI shows `demo_fixture` on every one.
    sources = BB204_EXTERNAL_FIXTURES.map((f) => ({
      ...f,
      incidentId: incident.id,
      relatedClaimIds: [],
      retrievedAt: new Date().toISOString(),
    }));
  }

  const saved = sources.map((s) => store.addExternalSource(s));
  store.finishAction(
    id,
    "done",
    live
      ? `${saved.length} live public sources retrieved via Bright Data.`
      : `${saved.length} demo fixtures loaded — no BRIGHTDATA_API_TOKEN configured. Each is labelled in the evidence panel.`,
  );
  await sleep(PACE.step);
  return saved;
}

// ------------------------------------------------------------------- evidence

async function processEvidenceItems(): Promise<void> {
  const items = store.getState().evidence.filter((e) => !e.processedAt);
  if (items.length === 0) return;

  for (const item of items) {
    const id = act("sandbox", `Processing ${item.filename} in an isolated sandbox`, {
      status: "running",
    });
    const result = await processEvidence(item);
    store.updateEvidence(item.id, {
      extracted: result.output,
      processedAt: new Date().toISOString(),
      processedBy: result.via,
    });
    store.finishAction(
      id,
      "done",
      result.via === "docker"
        ? "Executed in a network-isolated, read-only container with all capabilities dropped."
        : `No container runtime available — ran through the restricted local path instead${
            result.error ? ` (${result.error})` : ""
          }.`,
    );
    await sleep(240);
  }
}

// ---------------------------------------------------------------- reconcile

async function reconcileAll(
  incident: Incident,
  claims: Claim[],
  sources: ExternalSource[],
): Promise<void> {
  store.setReconstruction({
    phase: "reconciling",
    progress: 74,
    message: "Reconciling accounts against each other and the public record",
  });

  const id = act("contradiction_analyst", "Comparing every account against every other", {
    status: "running",
  });

  const witnesses = store.getState().witnesses;
  const deterministic = reconcile(claims, witnesses, incident);
  let result = { claims, ...deterministic };
  let engine = "rules engine";

  if (llmConfigured()) {
    try {
      const llm = await analyzeWithLLM(incident, witnesses, store.usableInterviews());
      if (llm) {
        result = mergeAnalyses({ claims, ...deterministic }, llm);
        engine = `openai:${llm.model} + rules`;
      }
    } catch (err) {
      console.warn("[reconstruction] LLM analysis failed:", (err as Error).message);
    }
  }

  const classified = classify(result.claims, result.findings, sources);
  store.applyAnalysis(classified, result.findings, result.timeline, engine);

  const contradictions = result.findings.filter((f) => f.type === "contradiction").length;
  const agreements = result.findings.filter((f) => f.type === "agreement").length;
  store.finishAction(
    id,
    "done",
    `${agreements} corroborated points, ${contradictions} incompatible sets. ` +
      `Analysis engine: ${engine}.`,
  );

  // The loop closes here: each unresolved conflict becomes the next question.
  const followUps: FollowUpQuestion[] = result.findings
    .filter((f) => f.type === "open_question" && f.witnessPrompt)
    .map((f, i) => ({
      id: `fup_${i}_${f.id.slice(-4)}`,
      incidentId: incident.id,
      question: f.title,
      witnessPrompt: f.witnessPrompt ?? null,
      targetParticipantIds: f.involvedWitnessIds,
      reason: f.explanation,
      sourceFindingId: f.id,
      priority: f.askPriority ?? 5,
      status: "open" as const,
    }))
    .sort((a, b) => a.priority - b.priority);
  store.setFollowUps(followUps);

  act("contradiction_analyst", `${followUps.length} follow-up questions generated`, {
    detail:
      "Each is phrased so it can be asked without revealing what another participant said.",
  });
  await sleep(PACE.step);
}

/**
 * Assigns each claim a classification from the fixed vocabulary, plus the
 * corroborating / conflicting / external links behind it. Nothing here decides
 * truth — it records how each claim stands against the other accounts.
 */
function classify(
  claims: Claim[],
  findings: { type: string; sourceClaimIds: string[] }[],
  sources: ExternalSource[],
): Claim[] {
  const corroborated = new Map<string, Set<string>>();
  const conflicting = new Map<string, Set<string>>();
  const link = (map: Map<string, Set<string>>, a: string, b: string) => {
    if (a === b) return;
    const set = map.get(a) ?? new Set<string>();
    set.add(b);
    map.set(a, set);
  };

  for (const f of findings) {
    const ids = f.sourceClaimIds;
    for (const a of ids) {
      for (const b of ids) {
        if (f.type === "agreement") link(corroborated, a, b);
        else if (f.type === "contradiction") link(conflicting, a, b);
      }
    }
  }

  const challengers = sources.filter((s) => s.bearing === "challenges").map((s) => s.id);
  const supporters = sources.filter((s) => s.bearing === "supports").map((s) => s.id);
  const inconsistent = new Set(
    findings
      .filter((f) => f.type === "contradiction")
      .flatMap((f) => ("title" in f && /two different values/i.test(String(f.title)) ? f.sourceClaimIds : [])),
  );

  return claims.map((c) => {
    const corr = [...(corroborated.get(c.id) ?? [])];
    const conf = [...(conflicting.get(c.id) ?? [])];

    let classification: Claim["classification"];
    let confidence: number;

    if (inconsistent.has(c.id)) {
      classification = "internally_inconsistent";
      confidence = 40;
    } else if (conf.length > 0) {
      // A signal-state claim contradicted by the corridor timing record is
      // contradicted by external evidence, not merely by another person.
      const externallyChallenged = c.subject === "traffic_light" && challengers.length > 0;
      classification = externallyChallenged
        ? "contradicted_by_external_evidence"
        : "contradicted_by_another_claim";
      confidence = 35;
    } else if (corr.length > 0) {
      classification = "independently_corroborated";
      confidence = c.certainty === "high" ? 88 : 74;
    } else if (supporters.length > 0 && c.category === "location") {
      classification = "supported_by_external_evidence";
      confidence = 70;
    } else if (c.certainty === "low") {
      classification = "requires_follow_up";
      confidence = 38;
    } else {
      classification = "unresolved";
      confidence = 50;
    }

    return {
      ...c,
      classification,
      analysisConfidence: confidence,
      corroboratingClaimIds: corr,
      conflictingClaimIds: conf,
      externalEvidenceIds: classification === "contradicted_by_external_evidence" ? challengers : [],
    };
  });
}

// --------------------------------------------------------------------- report

async function writeReport(incident: Incident): Promise<void> {
  store.setReconstruction({ phase: "reporting", progress: 88, message: "Writing the report" });
  const id = act("report_agent", "Generating the source-grounded reconstruction", {
    status: "running",
  });

  const s = store.getState();
  const payload = {
    case: {
      reference: incident.referenceId,
      title: incident.title,
      location: incident.location,
      reportedTime: incident.approximateTime,
      priorFile: incident.knownContext,
    },
    participants: s.witnesses.map((w) => ({
      name: w.displayName,
      role: w.role,
      descriptor: w.descriptor,
      approach: w.approach,
    })),
    findings: s.findings.map((f) => ({
      type: f.type,
      title: f.title,
      explanation: f.explanation,
      involves: f.involvedWitnessIds.map(
        (i) => s.witnesses.find((w) => w.id === i)?.displayName ?? i,
      ),
    })),
    timeline: s.timeline.map((t) => ({ label: t.label, confidence: t.confidence })),
    externalSources: s.externalSources.map((x) => ({
      title: x.title,
      url: x.url,
      bearing: x.bearing,
      relevance: x.relevance,
      provider: x.provider,
    })),
    openQuestions: s.followUps.map((f) => f.question),
  };

  const res = await brain.generateReport(payload);
  const report = res?.ok && res.report ? fromStrands(incident, res.report, res.provider) : localReport(incident);

  store.setReport(report);
  store.finishAction(
    id,
    "done",
    res?.ok
      ? `Written by the Strands Report Agent (${res.provider}).`
      : `Strands unavailable (${res?.detail ?? "brain service not reachable"}). ` +
        `Report assembled locally from the reconciled findings.`,
  );
}

function fromStrands(
  incident: Incident,
  r: brain.StrandsReport,
  provider?: string,
): ReconstructionReport {
  return {
    id: `rep_${crypto.randomUUID().slice(0, 8)}`,
    incidentId: incident.id,
    generatedAt: new Date().toISOString(),
    summary: r.summary,
    established: r.established,
    disputed: r.disputed,
    unresolved: r.unresolved,
    recommendedNextAction: r.recommended_next_action,
    confidence: Math.max(0, Math.min(100, r.confidence)),
    confidenceBasis: r.confidence_basis,
    markdown: toMarkdown(incident, r, provider ?? "strands"),
  };
}

/** Deterministic report, used whenever the agent layer is unavailable. */
function localReport(incident: Incident): ReconstructionReport {
  const s = store.getState();
  const name = (id: string) => s.witnesses.find((w) => w.id === id)?.displayName ?? id;
  const pick = (t: string) => s.findings.filter((f) => f.type === t);

  const established = pick("agreement").map(
    (f) => `${f.title} — corroborated by ${f.involvedWitnessIds.map(name).join(" and ")}.`,
  );
  const disputed = pick("contradiction").map((f) => `${f.title} — ${f.explanation}`);
  const unresolved = pick("open_question").map((f) => f.title);

  const r: brain.StrandsReport = {
    summary:
      `${s.witnesses.length} participants were interviewed about ${incident.title} at ` +
      `${incident.location}. ${established.length} points are corroborated by two or more ` +
      `independent accounts and ${disputed.length} sets of statements cannot all be true. ` +
      `Responsibility is not established by this reconstruction and is not assigned here.`,
    established,
    disputed,
    unresolved,
    recommended_next_action:
      s.followUps[0]?.question ??
      "Obtain the municipal signal-timing log for the intersection covering the reported time.",
    confidence: Math.max(
      25,
      Math.min(85, 40 + established.length * 6 - disputed.length * 5),
    ),
    confidence_basis:
      `Derived from ${established.length} corroborated points against ${disputed.length} ` +
      `unresolved conflicts, with no independent recording yet obtained.`,
  };

  return {
    id: `rep_${crypto.randomUUID().slice(0, 8)}`,
    incidentId: incident.id,
    generatedAt: new Date().toISOString(),
    summary: r.summary,
    established: r.established,
    disputed: r.disputed,
    unresolved: r.unresolved,
    recommendedNextAction: r.recommended_next_action,
    confidence: r.confidence,
    confidenceBasis: r.confidence_basis,
    markdown: toMarkdown(incident, r, "rules engine"),
  };
}

function toMarkdown(incident: Incident, r: brain.StrandsReport, engine: string): string {
  const s = store.getState();
  const bullets = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`).join("\n") : "- None.");

  return [
    `# BlackBox Reconstruction — ${incident.referenceId}`,
    "",
    `**${incident.title}**`,
    "",
    `| | |`,
    `|---|---|`,
    `| Location | ${incident.location} |`,
    `| Reported time | ${incident.approximateTime} |`,
    `| Opened by | ${incident.openedBy} |`,
    `| Participants interviewed | ${s.witnesses.filter((w) => w.callStatus === "completed").length} |`,
    `| Generated | ${new Date().toLocaleString()} |`,
    `| Analysis | ${engine} |`,
    "",
    "## Summary",
    "",
    r.summary,
    "",
    "## Established (corroborated by two or more independent accounts)",
    "",
    bullets(r.established),
    "",
    "## Disputed (these accounts cannot all be true)",
    "",
    bullets(r.disputed),
    "",
    "## Unresolved",
    "",
    bullets(r.unresolved),
    "",
    "## Recommended next action",
    "",
    r.recommended_next_action,
    "",
    `## Confidence: ${r.confidence}%`,
    "",
    r.confidence_basis,
    "",
    "## Sources",
    "",
    s.externalSources.length
      ? s.externalSources
          .map((x) => `- [${x.title}](${x.url}) — ${x.bearing}; retrieved ${new Date(x.retrievedAt).toLocaleString()} via \`${x.provider}\``)
          .join("\n")
      : "- No external sources retrieved.",
    "",
    "---",
    "",
    "BlackBox reports what witnesses agree on, where their accounts are incompatible, and what",
    "remains unknown. It does not determine fault, and an inconsistent recollection is not",
    "evidence of dishonesty. Every statement above traces to a named speaker and their exact words.",
    "",
  ].join("\n");
}
