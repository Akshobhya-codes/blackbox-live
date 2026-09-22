// The BlackBox Expert: application logic that steers Guava's Dialog System.
//
// Guava runs the conversation. This file owns identification, interview state,
// required fields, consent, provenance capture, and when reconciliation fires.
//
// Inbound flow, in two tasks:
//   1. identify_witness  — who is calling, and consent to record
//   2. witness_interview — an interview tailored to that person: a full
//      statement if they are new, or the case's outstanding questions if we
//      already hold one from them.

import * as guava from "@guava-ai/guava-sdk";
import { store } from "./store.ts";
import { maskPhone } from "./normalize.ts";
import { ensureIncident } from "./demo.ts";
import type { Incident, TranscriptTurn } from "./types.ts";

const TASK_IDENTIFY = "identify_witness";
const TASK_INTERVIEW = "witness_interview";

/** Follow-up questions per call, so the interview stays inside two minutes. */
const MAX_QUESTIONS_NEW = 3;
const MAX_QUESTIONS_FOLLOWUP = 3;

interface CallState {
  witnessId?: string;
  interviewId?: string;
  followUp: boolean;
  /** Speech captured before we know who is talking. */
  buffer: TranscriptTurn[];
  questionKeys: Map<string, string>;
}

const activeCalls = new Map<string, CallState>();

export const agent = new guava.Agent({
  name: "Ava",
  organization: "BlackBox Incident Intake",
  purpose:
    "Conduct a neutral, independent, recorded witness interview about a single incident, " +
    "without suggesting answers or revealing what any other witness has said.",
});

// ---------------------------------------------------------------------------
// Task 1 — identification
// ---------------------------------------------------------------------------

function identifyChecklist(incident: Incident) {
  const roster = store
    .getState()
    .witnesses.map((w) => w.displayName)
    .filter(Boolean);

  return [
    guava.Say(
      "Hello. This is an automated AI interviewer from BlackBox. " +
        `I am collecting a witness statement for case ${incident.referenceId || "on file"}, ` +
        `regarding an incident at ${incident.location}. ` +
        "This call is recorded for the investigation record. I am not a human " +
        "investigator and I cannot give advice.",
    ),
    guava.Field({
      key: "witness_identity",
      fieldType: "text",
      question:
        "To begin, please tell me which witness you are on this case, or your name. " +
        "For example, you might say Witness A.",
      description:
        roster.length > 0
          ? `Identify the caller. Witnesses expected on this case: ${roster.join(", ")}. ` +
            "Accept a label such as 'Witness A' or a personal name. Do not read the list out " +
            "unless the caller asks who is expected. Record exactly what they say."
          : "Identify the caller by name or witness label. Record exactly what they say.",
      required: true,
    }),
    guava.Field({
      key: "consent_confirmed",
      fieldType: "multiple_choice",
      choices: ["yes", "no"],
      question: "Do I have your consent to record this interview?",
      description: "Explicit consent to proceed with a recorded interview.",
      required: true,
    }),
  ];
}

// ---------------------------------------------------------------------------
// Task 2 — the interview itself
// ---------------------------------------------------------------------------

const BASE_FIELDS = () => [
  guava.Field({
    key: "observer_location",
    fieldType: "text",
    question: "Where were you when you first noticed something unusual?",
    description:
      "The witness's own physical position. Do not suggest a location, even if one is known.",
    required: true,
  }),
  guava.Field({
    key: "first_observation",
    fieldType: "text",
    question: "Please describe, in your own words, what you first noticed.",
    description:
      "The witness's opening account, in their own words. Let them speak without interruption.",
    required: true,
  }),
  guava.Field({
    key: "sequence_after",
    fieldType: "text",
    question: "What happened next?",
    description:
      "The order of events after the first observation. Ask only open questions such as " +
      "'what happened next'. Never propose an order.",
    required: true,
  }),
  guava.Field({
    key: "objects_and_vehicles",
    fieldType: "text",
    question: "What people, vehicles, or equipment did you see, and how would you describe them?",
    description:
      "Descriptions including appearance and colour. Never name a colour or vehicle type " +
      "yourself — ask the witness to describe it.",
    required: true,
  }),
  guava.Field({
    key: "sounds_alarms_smells",
    fieldType: "text",
    question: "What did you hear or smell, if anything?",
    description:
      "Sounds, alarms, smells, smoke, or hazards the witness personally detected. " +
      "Accept 'nothing' as a complete answer and record it as such.",
    required: true,
  }),
  guava.Field({
    key: "injuries_or_danger",
    fieldType: "text",
    question: "Was anyone injured or in immediate danger, as far as you saw?",
    description: "Injuries or immediate danger. A short answer is fine.",
    required: false,
  }),
];

/**
 * Builds the interview.
 *
 * `questions` are the case's outstanding open questions, already laundered into
 * witness-safe phrasing — they never reveal what another witness reported.
 */
function interviewChecklist(followUp: boolean, questions: { key: string; prompt: string }[]) {
  const followUps = questions.map((q) =>
    guava.Field({
      key: q.key,
      fieldType: "text",
      question: q.prompt,
      description:
        "An outstanding question on this case. Ask it exactly as written. It is deliberately " +
        "open — do not add detail, do not hint at an expected answer, and accept 'I don't know' " +
        "or 'I didn't notice' as a complete answer.",
      required: false,
    }),
  );

  if (followUp) {
    return [
      guava.Say(
        "Thank you. I already have your earlier statement on file, so I only have a few " +
          "follow-up questions.",
      ),
      ...followUps,
      "Briefly summarise only the new information they have just given, in one sentence.",
      guava.Field({
        key: "summary_confirmed",
        fieldType: "multiple_choice",
        choices: ["accurate", "needs correction"],
        question: "Is that accurate, or would you like to correct anything?",
        description: "Whether the witness confirmed the read-back.",
        required: true,
      }),
    ];
  }

  return [
    ...BASE_FIELDS(),
    ...followUps,
    guava.Field({
      key: "certainty_notes",
      fieldType: "text",
      question: "Which parts are you certain about, and which parts are estimates?",
      description: "Separates direct observation from estimation or hearsay.",
      required: false,
    }),
    "Briefly summarise the key facts back to the witness in two or three sentences, using only " +
      "what they actually said. Do not add detail they did not give.",
    guava.Field({
      key: "summary_confirmed",
      fieldType: "multiple_choice",
      choices: ["accurate", "needs correction"],
      question: "Is that summary accurate, or would you like to correct anything?",
      description: "Whether the witness confirmed the read-back summary.",
      required: true,
    }),
  ];
}

const OBJECTIVE = (incident: Incident, followUp: boolean) =>
  `Take an independent witness statement for case ${incident.referenceId || "on file"}: ` +
  `"${incident.title}" at ${incident.location}, reported around ${incident.approximateTime}. ` +
  `${followUp ? "This is a FOLLOW-UP call with someone who has already given a statement. Keep it under 90 seconds." : "Work through the checklist one question at a time. Keep the whole call under two minutes."} ` +
  `Be calm, concise, and strictly neutral.\n\n` +
  (incident.knownContext
    ? `Background already held by investigators — for your context ONLY. Never recite it, ` +
      `never use it to prompt, correct, or contradict the witness, and never let them hear it:\n` +
      `${incident.knownContext}\n\n`
    : "") +
  `Hard rules:\n` +
  `- Never state or hint at what any other witness said. Every interview is independent.\n` +
  `- Never ask a leading question and never assume a disputed fact. Ask "what colour was it", ` +
  `never "was it blue".\n` +
  `- Do not challenge, correct, or express doubt about the account. Record what they say.\n` +
  `- If the witness is unsure, record the uncertainty rather than pressing for a firm answer.\n` +
  `- Let the witness interrupt and speak freely; do not talk over them.\n` +
  `- If asked what others reported, say you cannot share other statements during an ` +
  `independent interview.`;

// ---------------------------------------------------------------------------
// Witness identification
// ---------------------------------------------------------------------------

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/** Matches what the caller said against the witnesses expected on this case. */
export function matchWitness<T extends { id: string; displayName: string }>(
  spoken: string,
  roster: T[],
): T | undefined {
  const said = normalizeName(spoken);
  if (!said) return undefined;

  const exact = roster.find((w) => normalizeName(w.displayName) === said);
  if (exact) return exact;

  // "witness a", "this is witness a", "a" — pull the label out and compare.
  const letter = /(?:^|\bwitness\s+)([a-z0-9])\b/.exec(said)?.[1];
  if (letter) {
    const byLabel = roster.find((w) => {
      const n = normalizeName(w.displayName);
      return n === `witness ${letter}` || n.endsWith(` ${letter}`);
    });
    if (byLabel) return byLabel;
  }

  return roster.find(
    (w) => said.includes(normalizeName(w.displayName)) || normalizeName(w.displayName).includes(said),
  );
}

async function safe<T>(fn: () => Promise<T> | T): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

agent.onCallReceived(async () => ({ action: "accept" }));

agent.onCallStart(async (call) => {
  const incident = ensureIncident();
  activeCalls.set(call.id, { followUp: false, buffer: [], questionKeys: new Map() });

  try {
    await call.setTask({
      taskId: TASK_IDENTIFY,
      objective:
        `Find out which witness is calling about case ${incident.referenceId || "on file"} ` +
        `("${incident.title}"), and obtain consent to record. Be brief and neutral. ` +
        `Do not discuss the incident itself yet.`,
      checklist: identifyChecklist(incident),
      completionCriteria: "The caller has identified themselves and answered the consent question.",
    });
    console.log(`[agent] inbound call ${call.id} — identifying caller`);
  } catch (err) {
    console.error("[agent] onCallStart failed:", err);
    await safe(() => call.sendInstruction("Apologise briefly and ask who is calling."));
  }
});

agent.onTaskComplete(TASK_IDENTIFY, async (call) => {
  const state = activeCalls.get(call.id);
  if (!state) return;
  const incident = ensureIncident();

  const spoken = String((await safe(() => call.getField("witness_identity"))) ?? "").trim();
  const consent = String((await safe(() => call.getField("consent_confirmed"))) ?? "").toLowerCase();
  const declined = consent.startsWith("n");

  // Match against the roster; fall back to the caller's number, then create.
  const roster = store.getState().witnesses;
  let witness = matchWitness(spoken, roster);

  if (!witness) {
    const info = call.callInfo;
    if (info.call_type === "pstn" && info.from_number) {
      witness = store.findWitnessByPhone(info.from_number);
    }
  }
  if (!witness) {
    const label = spoken.length > 1 ? spoken : `Caller ${roster.length + 1}`;
    witness = store.addWitness(
      incident.id,
      label,
      call.callInfo.call_type === "pstn" ? (call.callInfo.from_number ?? "") : "",
    );
    console.log(`[agent] new witness created from call: "${label}"`);
  } else {
    console.log(`[agent] caller identified as ${witness.displayName} (said: "${spoken}")`);
  }

  const prior = store.getInterviewByWitness(witness.id);
  const followUp = Boolean(prior && prior.transcript.some((t) => t.speaker === "witness"));
  const interview = followUp
    ? store.startFollowUp(witness.id, call.id)
    : store.startInterview(witness.id, call.id);

  state.witnessId = witness.id;
  state.interviewId = interview.id;
  state.followUp = followUp;

  // Flush anything said before we knew who was speaking.
  for (const turn of state.buffer) store.appendTurn(interview.id, turn);
  state.buffer = [];

  store.updateWitness(witness.id, {
    consentStatus: declined ? "declined" : "granted",
    phoneNumber:
      witness.phoneNumber ||
      (call.callInfo.call_type === "pstn" ? (call.callInfo.from_number ?? "") : ""),
  });
  store.setInterviewFields(interview.id, { witness_identity: spoken, consent_confirmed: consent });

  if (declined) {
    store.completeInterview(interview.id, {
      completionStatus: "partial",
      terminationReason: "consent-declined",
    });
    await safe(() => call.hangup("Understood. No statement will be recorded. Goodbye."));
    return;
  }

  // Outstanding questions this person has not already answered, in safe form.
  const askable = store.askableQuestions(witness.id);
  const limit = followUp ? MAX_QUESTIONS_FOLLOWUP : MAX_QUESTIONS_NEW;
  const questions = askable.slice(0, limit).map((f, i) => {
    const key = `followup_${i + 1}`;
    state.questionKeys.set(key, f.id);
    return { key, prompt: f.witnessPrompt! };
  });

  console.log(
    `[agent] ${witness.displayName}: ${followUp ? "follow-up" : "first"} interview, ` +
      `${questions.length} outstanding question(s) queued` +
      (witness.phoneNumber ? ` — ${maskPhone(witness.phoneNumber)}` : ""),
  );

  await call.setTask({
    taskId: TASK_INTERVIEW,
    objective: OBJECTIVE(incident, followUp),
    checklist: interviewChecklist(followUp, questions),
    completionCriteria:
      "All required fields are collected and the witness has responded to the read-back.",
  });
});

agent.onCallerSpeech(async (call, event) => {
  const state = activeCalls.get(call.id);
  if (!state || !event.utterance.trim()) return;
  const turn: TranscriptTurn = {
    speaker: "witness",
    text: event.utterance,
    at: new Date().toISOString(),
    utteranceId: event.utterance_id,
  };
  if (state.interviewId) store.appendTurn(state.interviewId, turn);
  else state.buffer.push(turn);
});

agent.onAgentSpeech(async (call, event) => {
  const state = activeCalls.get(call.id);
  if (!state || !event.utterance.trim()) return;
  const turn: TranscriptTurn = {
    speaker: "agent",
    text: event.utterance,
    at: new Date().toISOString(),
  };
  if (state.interviewId) store.appendTurn(state.interviewId, turn);
  else state.buffer.push(turn);
});

agent.onQuestion(async (_call, question) => {
  const q = question.toLowerCase();
  if (/other witness|someone else|anyone else say|what did .* say|who else/.test(q)) {
    return (
      "I'm not able to share what any other witness has said. Each interview is taken " +
      "independently so that accounts stay separate."
    );
  }
  if (/who are you|are you (a )?(human|robot|ai|bot)|recorded|recording/.test(q)) {
    return (
      "I'm an AI interviewer from BlackBox. This is an incident interview and it is " +
      "being recorded for the investigation record."
    );
  }
  if (/case|investigation|why|what.*about/.test(q)) {
    const incident = ensureIncident();
    return (
      `I'm collecting witness statements about an incident at ${incident.location}, ` +
      `reported around ${incident.approximateTime}. I can only record your own account.`
    );
  }
  return (
    "I'm only able to collect your account of what happened. An investigator will follow up " +
    "if anything further is needed."
  );
});

agent.onTaskComplete(TASK_INTERVIEW, async (call) => {
  const state = activeCalls.get(call.id);
  if (!state?.interviewId || !state.witnessId) return;

  const fields = await collectFields(call, [...state.questionKeys.keys()]);
  store.setInterviewFields(state.interviewId, fields);

  const confirmed = String(fields.summary_confirmed ?? "").toLowerCase().startsWith("acc");
  const name = typeof fields.witness_identity === "string" ? fields.witness_identity.trim() : "";

  const current = store.getWitness(state.witnessId);
  store.updateWitness(state.witnessId, {
    displayName:
      current?.displayName && current.displayName.startsWith("Caller") && name.length > 1
        ? name
        : (current?.displayName ?? "Witness"),
  });

  store.completeInterview(state.interviewId, {
    completionStatus: "completed",
    summaryConfirmed: confirmed,
    structuredSummary: summarize(fields),
  });

  runReconciliationSafely();
  await safe(() =>
    call.hangup("Thank you. Your statement has been recorded for the investigation. Goodbye."),
  );
});

agent.onSessionEnd(async (call, event) => {
  const state = activeCalls.get(call.id);
  activeCalls.delete(call.id);
  if (!state?.interviewId || !state.witnessId) {
    console.log(`[agent] call ended before identification (${event.termination_reason})`);
    return;
  }

  const interview = store.getInterviewByWitness(state.witnessId);
  if (!interview || interview.completionStatus !== "in_progress") return;

  // Dropped mid-interview: keep whatever they did tell us. A partial statement
  // is still evidence.
  const fields = await collectFields(call, [...state.questionKeys.keys()]);
  store.setInterviewFields(interview.id, fields);

  const gotSomething = interview.transcript.some((t) => t.speaker === "witness");
  store.completeInterview(interview.id, {
    completionStatus: gotSomething ? "partial" : "failed",
    terminationReason: event.termination_reason,
    structuredSummary: summarize(fields),
  });
  store.updateWitness(state.witnessId, {
    callStatus:
      event.termination_reason === "voicemail"
        ? "no_answer"
        : gotSomething
          ? "incomplete"
          : "failed",
    lastError: gotSomething ? null : `Call ended: ${event.termination_reason}`,
  });

  if (gotSomething) runReconciliationSafely();
  console.log(`[agent] session ended (${event.termination_reason}) call=${call.id}`);
});

agent.onOutboundFailed(async (call, event) => {
  const state = activeCalls.get(call.id);
  console.error(`[agent] outbound failed: ${event.error_code} ${event.error_reason}`);
  if (state?.witnessId) {
    store.updateWitness(state.witnessId, {
      callStatus: "no_answer",
      lastError: `${event.error_reason} (code ${event.error_code})`,
    });
  }
  activeCalls.delete(call.id);
});

const FIELD_KEYS = [
  "witness_identity",
  "consent_confirmed",
  "observer_location",
  "first_observation",
  "sequence_after",
  "objects_and_vehicles",
  "sounds_alarms_smells",
  "injuries_or_danger",
  "certainty_notes",
  "summary_confirmed",
  "additional_details",
];

async function collectFields(
  call: guava.Call,
  extraKeys: string[],
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const key of [...FIELD_KEYS, ...extraKeys]) {
    const value = await safe(() => call.getField(key));
    if (value !== undefined && value !== null && String(value).trim() !== "") out[key] = value;
  }
  return out;
}

function summarize(fields: Record<string, unknown>): string {
  const parts = [
    fields.observer_location && `Position: ${fields.observer_location}`,
    fields.first_observation && `First noticed: ${fields.first_observation}`,
    fields.sequence_after && `Then: ${fields.sequence_after}`,
    fields.objects_and_vehicles && `Observed: ${fields.objects_and_vehicles}`,
    fields.sounds_alarms_smells && `Sensory: ${fields.sounds_alarms_smells}`,
    fields.injuries_or_danger && `Injuries: ${fields.injuries_or_danger}`,
    fields.additional_details && `Added: ${fields.additional_details}`,
  ].filter(Boolean);
  return parts.join(" · ");
}

/**
 * Fire-and-forget analysis. Runs OpenAI plus the rules engine, and must never
 * take down a live call.
 */
export function runReconciliationSafely(): void {
  // Deliberately not awaited: the caller is on a live phone line and must
  // never wait on analysis. The dashboard updates over SSE when it lands.
  import("./reconstruction.ts")
    .then((m) => m.analyzeCase())
    .then(() => console.log("[agent] case re-analysed after interview"))
    .catch((err) => {
      console.error("[agent] analysis failed:", err);
      store.setReconciliation({ status: "error", error: (err as Error).message });
    });
}

// ---------------------------------------------------------------------------
// Entrypoints
// ---------------------------------------------------------------------------

export function agentNumber(): string | null {
  const n = process.env.GUAVA_AGENT_NUMBER?.trim();
  return n && n.length > 3 ? n : null;
}

/**
 * Reaching this module at all means Guava authentication resolved — the SDK's
 * Client constructor throws otherwise (API key, deploy token, or `guava login`).
 */
export function guavaConfigured(): boolean {
  return true;
}

/** Starts the inbound listener in the background; never blocks the server. */
export function startInboundListener(): void {
  const number = agentNumber();
  if (!number) {
    console.warn(
      "[agent] GUAVA_AGENT_NUMBER not set — inbound calling is OFF. " +
        "Dashboard, chat mode, and simulation still work.",
    );
    return;
  }
  console.log(`[agent] listening for inbound calls on ${number}`);
  agent.listenPhone(number).catch((err) => {
    console.error("[agent] inbound listener stopped:", err);
  });
}

export async function placeOutboundCall(witnessId: string): Promise<void> {
  const witness = store.getWitness(witnessId);
  if (!witness) throw new Error("unknown witness");
  if (!witness.phoneNumber) throw new Error("witness has no phone number");
  const from = agentNumber();
  if (!from) throw new Error("GUAVA_AGENT_NUMBER must be set to place outbound calls");

  store.updateWitness(witnessId, { callStatus: "ringing", lastError: null });
  try {
    await agent.callPhone(from, witness.phoneNumber, { witnessId });
  } catch (err) {
    store.updateWitness(witnessId, { callStatus: "failed", lastError: (err as Error).message });
    throw err;
  }
}
