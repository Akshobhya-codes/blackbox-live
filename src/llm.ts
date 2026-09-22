// OpenAI analysis backbone.
//
// The model reads the independent witness transcripts and produces claims,
// findings, and a timeline. Everything it returns is validated against a schema
// before it is allowed anywhere near the dashboard; on any failure the caller
// falls back to the deterministic engine. Malformed model output is never trusted.

import * as z from "zod";
import type { Claim, Finding, Incident, Interview, TimelineEvent, Witness } from "./types.ts";

const DEFAULT_MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-4o";
const FALLBACK_MODEL = "gpt-4o-mini";
// Kept deliberately tight: on a flaky venue network a slow model must degrade
// to the rules engine in seconds, not stall a live reconstruction for minutes.
const TIMEOUT_MS = 20_000;

export function llmConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

// ---------------------------------------------------------------------------
// Validation — the contract we hold the model to.
// ---------------------------------------------------------------------------

const ClaimZ = z.object({
  id: z.string().min(1),
  witnessId: z.string().min(1),
  category: z.enum([
    "entity",
    "attribute",
    "temporal_order",
    "time_point",
    "presence",
    "location",
    "injury",
    "narrative",
  ]),
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1),
  displayObject: z.string().min(1),
  certainty: z.enum(["high", "medium", "low"]),
  sourceExcerpt: z.string().min(3),
});

const FindingZ = z.object({
  type: z.enum(["agreement", "contradiction", "unique_claim", "open_question"]),
  title: z.string().min(3),
  explanation: z.string().min(3),
  involvedWitnessIds: z.array(z.string()),
  sourceClaimIds: z.array(z.string()),
  followUpQuestion: z.string().nullable(),
  witnessPrompt: z.string().nullable(),
});

const TimelineZ = z.object({
  label: z.string().min(2),
  eventKey: z.string().min(2),
  approximateTime: z.string().nullable(),
  supportingWitnessIds: z.array(z.string()),
  confidence: z.enum(["corroborated", "single_source", "disputed"]),
  sourceClaimIds: z.array(z.string()),
});

const AnalysisZ = z.object({
  claims: z.array(ClaimZ),
  findings: z.array(FindingZ),
  timeline: z.array(TimelineZ),
});

/** JSON Schema handed to OpenAI structured outputs (strict mode). */
const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["claims", "findings", "timeline"],
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "witnessId",
          "category",
          "subject",
          "predicate",
          "object",
          "displayObject",
          "certainty",
          "sourceExcerpt",
        ],
        properties: {
          id: { type: "string" },
          witnessId: { type: "string" },
          category: {
            type: "string",
            enum: [
              "entity",
              "attribute",
              "temporal_order",
              "time_point",
              "presence",
              "location",
              "injury",
              "narrative",
            ],
          },
          subject: { type: "string" },
          predicate: { type: "string" },
          object: { type: "string" },
          displayObject: { type: "string" },
          certainty: { type: "string", enum: ["high", "medium", "low"] },
          sourceExcerpt: { type: "string" },
        },
      },
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "type",
          "title",
          "explanation",
          "involvedWitnessIds",
          "sourceClaimIds",
          "followUpQuestion",
          "witnessPrompt",
        ],
        properties: {
          type: {
            type: "string",
            enum: ["agreement", "contradiction", "unique_claim", "open_question"],
          },
          title: { type: "string" },
          explanation: { type: "string" },
          involvedWitnessIds: { type: "array", items: { type: "string" } },
          sourceClaimIds: { type: "array", items: { type: "string" } },
          followUpQuestion: { type: ["string", "null"] },
          witnessPrompt: { type: ["string", "null"] },
        },
      },
    },
    timeline: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "label",
          "eventKey",
          "approximateTime",
          "supportingWitnessIds",
          "confidence",
          "sourceClaimIds",
        ],
        properties: {
          label: { type: "string" },
          eventKey: { type: "string" },
          approximateTime: { type: ["string", "null"] },
          supportingWitnessIds: { type: "array", items: { type: "string" } },
          confidence: {
            type: "string",
            enum: ["corroborated", "single_source", "disputed"],
          },
          sourceClaimIds: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SYSTEM = `You are the analysis engine inside BlackBox, an incident reconstruction tool for investigators.

You are given independent witness statements about a single incident. Each witness was interviewed separately and never heard the others' accounts.

Your job is to reconstruct what can be established, and to be precise about what cannot.

ABSOLUTE RULES
- You never decide who is lying or what objectively happened. You are not a truth machine.
- Corroboration is not proof. Describe agreed items as "corroborated", never as "confirmed" or "true".
- Every claim and every finding MUST cite a sourceExcerpt copied VERBATIM from that witness's transcript. Never paraphrase an excerpt. Never invent one.
- Only use witnessId values that were given to you.

WHAT COUNTS AS A CONTRADICTION
- Genuinely incompatible statements about the same thing at the same time: reversed event order ("alarm before impact" vs "impact before alarm"), incompatible exclusive attributes ("blue forklift" vs "yellow forklift"), or presence vs explicit absence ("I saw no smoke" vs "there was heavy smoke there").
- MISSING INFORMATION IS NOT A CONTRADICTION. If one witness mentions a chemical smell and another simply never discusses smell, that is a unique_claim, not a contradiction.
- Approximate times within 5 minutes of each other agree. More than 15 minutes apart is a contradiction. In between, raise an open_question about estimation uncertainty rather than calling it a conflict.
- Differences that vantage point, lighting, or distance could plausibly explain are still contradictions, but say so in the explanation.

FINDING TYPES — be thorough. Investigators read all four lists.
- agreement: the same thing reported independently by two or more witnesses. Emit one for EVERY object, event, location, and time that two or more witnesses both described — including things they agree on while disagreeing about details. Two witnesses who dispute the forklift's colour still AGREE a forklift was involved: that is an agreement finding AND a contradiction finding.
- contradiction: genuinely incompatible accounts. MUST include a neutral followUpQuestion that could resolve it.
- unique_claim: reported by exactly one witness where others were silent. State that absence of corroboration is not evidence of inaccuracy.
- open_question: what an investigator should ask next. Emit one for every contradiction, one for each single-source sensory or hazard detail ("Did any other witness detect the chemical smell?"), and any material fact no interview established. Neutral and non-leading. Aim for at least three when you have two or more witnesses.

FOLLOW-UP QUESTIONS must never assume a disputed fact. Ask "What colour was the forklift?", never "Was the forklift blue?". Ask "Did the alarm sound before or after the rack collapsed?", never "The alarm was after the crash, correct?".

witnessPrompt — THE MOST IMPORTANT FIELD FOR WITNESS SAFETY
Set this only when the question can be read aloud to a witness on a live call without revealing anything another witness said. It is what our voice agent actually asks.
- "title" is written for the investigator and may reference other witnesses. "witnessPrompt" must NOT.
- A question about a disputed detail is safe, because it asks for their own account without saying anyone disagreed: witnessPrompt "What colour was the forklift, and what were the lighting conditions where you were standing?"
- A question about something only one person reported is NOT safe in specific form. "Did any other witness observe a chemical smell?" would tell the next witness that a smell was reported. Widen it to the whole category instead: witnessPrompt "Did you notice any unusual smells or odours at any point?"
- If no phrasing can avoid leaking, set witnessPrompt to null. Null is always an acceptable answer here.
- Never name another witness, never say "another witness said", never quote someone else.

CLAIMS
- Use short snake_case canonical keys for subject and object so that claims from different witnesses match each other. Prefer these where they fit: forklift, rack, alarm, truck, pallet, person, door, collision, rack_collapse, chemical_smell, smoke, fire, spill, shouting, evacuation.
- categories: entity (predicate "involved"), attribute (predicate e.g. "color"), temporal_order (predicate "before", object = the later event), time_point (predicate "occurred_at"), presence (predicate "observed", object "present" or "absent"), location (predicate "located_at"), injury.
- certainty: "high" for direct confident observation, "medium" when hedged ("I think", "looked like", "around"), "low" for hearsay or explicit uncertainty.

TIMELINE
- Order events as the combined accounts suggest. confidence is "corroborated" (2+ witnesses), "single_source" (1), or "disputed" (witnesses conflict on its position or existence).
- approximateTime only when a witness actually gave a time; otherwise null. Format it as a clock time such as "8:12 PM".
- Every timeline entry must be a concrete, observable event someone described (a collision, a collapse, an alarm, a smell). Never emit vague containers like "the incident occurred".
- Include single-source events too — a smell only one witness noticed still belongs on the timeline, marked single_source.`;

function buildUserPrompt(
  incident: Incident,
  witnesses: Witness[],
  interviews: Interview[],
): string {
  const blocks = interviews.map((interview) => {
    const witness = witnesses.find((w) => w.id === interview.witnessId);
    const lines = interview.transcript
      .filter((t) => t.speaker === "witness")
      .map((t) => `  - "${t.text.replace(/"/g, "'")}"`)
      .join("\n");

    const fields = Object.entries(interview.fields)
      .filter(([k, v]) => k !== "simulated" && typeof v === "string" && v.trim())
      .map(([k, v]) => `  ${k}: ${String(v).replace(/\s+/g, " ").trim()}`)
      .join("\n");

    return [
      `WITNESS ${witness?.displayName ?? "Unknown"} (witnessId: ${interview.witnessId})`,
      `status: ${interview.completionStatus}`,
      lines ? `verbatim statements:\n${lines}` : "verbatim statements: (none captured)",
      fields ? `structured answers:\n${fields}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  });

  return `CASE
reference: ${incident.referenceId || "(none)"}
opened by: ${incident.openedBy || "(unspecified)"}
title: ${incident.title}
type: ${incident.type}
location: ${incident.location}
approximate time on record: ${incident.approximateTime}
description: ${incident.description}
${
  incident.knownContext
    ? `\nPRIOR CASE FILE (already held by investigators — background only; it is NOT witness testimony and must never be cited as a witness excerpt):\n${incident.knownContext}\n`
    : ""
}
${blocks.join("\n\n")}

Analyse these independent statements. Return claims, findings, and a timeline.
Remember: silence from one witness is never a contradiction, and every excerpt must be copied verbatim from the statements above.`;
}

// ---------------------------------------------------------------------------
// Call
// ---------------------------------------------------------------------------

interface AnalysisResult {
  claims: Claim[];
  findings: Finding[];
  timeline: TimelineEvent[];
  model: string;
}

async function callOpenAI(model: string, userPrompt: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userPrompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "incident_analysis", strict: true, schema: RESPONSE_SCHEMA },
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenAI ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string; refusal?: string } }[];
    };
    const message = data.choices?.[0]?.message;
    if (message?.refusal) throw new Error(`model refused: ${message.refusal}`);
    if (!message?.content) throw new Error("empty completion");
    return JSON.parse(message.content);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs the OpenAI analysis. Returns null whenever the result cannot be trusted,
 * which tells the caller to use the deterministic engine instead.
 */
export async function analyzeWithLLM(
  incident: Incident,
  witnesses: Witness[],
  interviews: Interview[],
): Promise<AnalysisResult | null> {
  if (!llmConfigured() || interviews.length === 0) return null;

  const userPrompt = buildUserPrompt(incident, witnesses, interviews);
  const models = [DEFAULT_MODEL, FALLBACK_MODEL].filter((m, i, a) => a.indexOf(m) === i);

  for (const model of models) {
    try {
      const raw = await callOpenAI(model, userPrompt);
      const parsed = AnalysisZ.safeParse(raw);
      if (!parsed.success) {
        console.warn(`[llm] ${model} failed schema validation:`, parsed.error.issues.slice(0, 3));
        continue;
      }
      const mapped = mapAnalysis(parsed.data, incident, witnesses, interviews);
      if (!mapped) {
        console.warn(`[llm] ${model} output failed provenance checks`);
        continue;
      }
      console.log(
        `[llm] ${model} → ${mapped.claims.length} claims, ${mapped.findings.length} findings`,
      );
      return { ...mapped, model };
    } catch (err) {
      console.warn(`[llm] ${model} failed:`, (err as Error).message);
    }
  }
  return null;
}

/**
 * Converts validated model output into our records, and enforces the rules the
 * schema cannot: real witness ids, resolvable claim references, and excerpts
 * that actually appear in that witness's transcript.
 */
function mapAnalysis(
  data: z.infer<typeof AnalysisZ>,
  incident: Incident,
  witnesses: Witness[],
  interviews: Interview[],
): Omit<AnalysisResult, "model"> | null {
  const validWitnessIds = new Set(witnesses.map((w) => w.id));

  // Transcript text per witness, normalized, for the provenance check.
  const corpus = new Map<string, string>();
  for (const interview of interviews) {
    const text = [
      ...interview.transcript.filter((t) => t.speaker === "witness").map((t) => t.text),
      ...Object.values(interview.fields).filter((v): v is string => typeof v === "string"),
    ]
      .join(" ")
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ");
    corpus.set(interview.witnessId, text);
  }

  const idMap = new Map<string, string>();
  const claims: Claim[] = [];

  for (const c of data.claims) {
    if (!validWitnessIds.has(c.witnessId)) continue;
    if (!excerptIsGrounded(c.sourceExcerpt, corpus.get(c.witnessId) ?? "")) {
      console.warn(`[llm] dropped ungrounded excerpt for ${c.witnessId}: "${c.sourceExcerpt}"`);
      continue;
    }
    const id = `clm_${crypto.randomUUID().slice(0, 8)}`;
    idMap.set(c.id, id);
    claims.push({
      id,
      incidentId: incident.id,
      witnessId: c.witnessId,
      category: c.category,
      subject: canonical(c.subject),
      predicate: canonicalPredicate(c.predicate),
      object: canonical(c.object),
      displayObject: c.displayObject,
      normalizedTime: null,
      temporalRelation: c.category === "temporal_order" ? "before" : null,
      certainty: c.certainty,
      sourceExcerpt: c.sourceExcerpt,
      sourceField: null,
    });
  }

  if (claims.length === 0) return null;

  const findings: Finding[] = [];
  for (const f of data.findings) {
    const sourceClaimIds = f.sourceClaimIds.map((i) => idMap.get(i)).filter((x): x is string => Boolean(x));
    // A finding with no surviving source is unauditable; drop it.
    if (f.type !== "open_question" && sourceClaimIds.length === 0) continue;
    // Our own hard rule, regardless of what the model decided.
    if (f.type === "contradiction" && !f.followUpQuestion) continue;

    findings.push({
      id: `fnd_${crypto.randomUUID().slice(0, 8)}`,
      incidentId: incident.id,
      type: f.type,
      title: f.title,
      explanation: f.explanation,
      involvedWitnessIds: f.involvedWitnessIds.filter((w) => validWitnessIds.has(w)),
      sourceClaimIds,
      ...(f.followUpQuestion ? { followUpQuestion: f.followUpQuestion } : {}),
      ...(f.witnessPrompt && isWitnessSafe(f.witnessPrompt)
        ? { witnessPrompt: f.witnessPrompt }
        : {}),
    });
  }

  // Guarantees the model cannot be trusted to meet on its own: every
  // contradiction must leave the investigator with a question to ask.
  for (const f of findings.filter((x) => x.type === "contradiction")) {
    const q = f.followUpQuestion;
    if (!q) continue;
    const exists = findings.some(
      (x) => x.type === "open_question" && x.title.trim().toLowerCase() === q.trim().toLowerCase(),
    );
    if (exists) continue;
    findings.push({
      id: `fnd_${crypto.randomUUID().slice(0, 8)}`,
      incidentId: incident.id,
      type: "open_question",
      title: q,
      explanation: `Generated from an unresolved conflict: ${f.title}.`,
      involvedWitnessIds: f.involvedWitnessIds,
      sourceClaimIds: f.sourceClaimIds,
    });
  }

  const witnessesHeard = new Set(claims.map((c) => c.witnessId)).size;
  if (witnessesHeard < 2) {
    findings.push({
      id: `fnd_${crypto.randomUUID().slice(0, 8)}`,
      incidentId: incident.id,
      type: "open_question",
      title: "Additional independent witness accounts are required for corroboration",
      explanation:
        "Only one interview has been completed. No claim in this incident is currently corroborated by a second source.",
      involvedWitnessIds: witnesses.map((w) => w.id),
      sourceClaimIds: [],
    });
  }

  const timeline: TimelineEvent[] = data.timeline.map((t, i) => ({
    id: `tl_${crypto.randomUUID().slice(0, 8)}`,
    incidentId: incident.id,
    label: t.label,
    eventKey: t.eventKey,
    approximateTime: t.approximateTime,
    supportingWitnessIds: t.supportingWitnessIds.filter((w) => validWitnessIds.has(w)),
    confidence: t.confidence,
    sourceClaimIds: t.sourceClaimIds.map((x) => idMap.get(x)).filter((x): x is string => Boolean(x)),
    rank: i,
  }));

  return { claims, findings, timeline };
}

/**
 * Aligns the model's vocabulary with the rules engine's.
 *
 * The model says "sedan" where the lexicon says "car". Without this the two
 * engines describe the same conflict twice and both appear on the dashboard.
 */
const CANON: Record<string, string> = {
  sedan: "car", vehicle: "car", automobile: "car", hatchback: "car",
  lorry: "truck", trailer: "truck", minivan: "van",
  shelf: "rack", shelving: "rack", racking: "rack", storage_rack: "rack",
  forklift_truck: "forklift", lift_truck: "forklift", pallet_jack: "forklift",
  siren: "alarm", buzzer: "alarm", fire_alarm: "alarm",
  smell: "chemical_smell", odour: "chemical_smell", odor: "chemical_smell", fumes: "chemical_smell",
  crash: "collision", impact: "collision", crash_impact: "collision",
  collapse: "rack_collapse", rack_fall: "rack_collapse",
  traffic_signal: "traffic_light", signal: "traffic_light", light: "traffic_light",
  stoplight: "traffic_light", horn_sound: "horn", honk: "horn",
  vapour: "steam", vapor: "steam",
  pedestrian: "pedestrian_present", crosswalk: "pedestrian_present",
  colour: "color",
};

/**
 * Predicates the model reaches for that mean the same thing as ours. Without
 * this, "signal state" and "signal colour" look like two separate disputes and
 * the board shows the same conflict twice.
 */
const CANON_PREDICATE: Record<string, string> = {
  state: "color",
  colour: "color",
  signal_state: "color",
  light_state: "color",
  appearance: "color",
  sequence: "before",
  order: "before",
  preceded: "before",
  occurred: "occurred_at",
  time: "occurred_at",
};

function canonicalPredicate(value: string): string {
  const key = value.trim().toLowerCase().replace(/s+/g, "_");
  return CANON_PREDICATE[key] ?? key;
}

function canonical(value: string): string {
  const key = value.trim().toLowerCase().replace(/\s+/g, "_");
  return CANON[key] ?? key;
}

/**
 * Last line of defence before a question is spoken to a witness.
 *
 * The prompt already forbids leaking other accounts, but a model instruction is
 * not a guarantee and the cost of being wrong is a contaminated statement. Any
 * phrasing that points at another witness is rejected outright.
 */
const LEAKY = [
  /\bother witness/i,
  /\banother witness/i,
  /\bwitness\s+[a-z0-9]\b/i,
  /\bsomeone else\b/i,
  /\banyone else\b/i,
  /\bany other\b/i,
  /\bothers?\s+(said|report|describ|mention|claim)/i,
  /\bwas (it )?(reported|described|mentioned) by\b/i,
  /\baccording to\b/i,
];

function isWitnessSafe(prompt: string): boolean {
  return prompt.trim().length > 8 && !LEAKY.some((re) => re.test(prompt));
}

/**
 * A cited excerpt has to be traceable to what the witness actually said.
 * Compared on a normalized word run so punctuation and casing don't matter.
 */
function excerptIsGrounded(excerpt: string, corpus: string): boolean {
  if (!corpus) return false;
  const norm = excerpt.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (norm.length < 3) return false;
  if (corpus.includes(norm)) return true;

  // Allow light trimming at the edges: require a solid run of consecutive words.
  const words = norm.split(" ");
  const need = Math.min(6, Math.max(3, Math.floor(words.length * 0.6)));
  for (let i = 0; i + need <= words.length; i++) {
    if (corpus.includes(words.slice(i, i + need).join(" "))) return true;
  }
  return false;
}
