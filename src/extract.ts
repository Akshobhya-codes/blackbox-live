// Turns one witness's account into normalized, source-linked claims.
// Every claim keeps the exact words that produced it — provenance is not optional.

import {
  COLORS,
  COLOR_ALIASES,
  DIRECTIONS,
  DIRECTION_ALIASES,
  ENTITIES,
  EVENTS,
  PLACE_PATTERNS,
  entityLabel,
  eventLabel,
} from "./lexicon.ts";
import {
  certaintyOf,
  excerpt,
  findMentions,
  formatClock,
  isNegatedBefore,
  negatedMentions,
  parseClockTime,
  splitIntoSegments,
  type Segment,
} from "./normalize.ts";
import type { Claim, Incident, Interview } from "./types.ts";

interface SourceUnit {
  text: string;
  field: string | null;
}

/** Field keys whose free-text answers carry observational content. */
const NARRATIVE_FIELDS = [
  "first_observation",
  "sequence_after",
  "objects_and_vehicles",
  "sounds_alarms_smells",
  "injuries_or_danger",
  "certainty_notes",
  "observer_location",
  "additional_details",
];

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

function collectUnits(interview: Interview): {
  orderingText: string;
  units: SourceUnit[];
} {
  const witnessTurns = interview.transcript
    .filter((t) => t.speaker === "witness")
    .map((t) => t.text.trim())
    .filter(Boolean);

  const fieldUnits: SourceUnit[] = [];
  for (const [key, value] of Object.entries(interview.fields)) {
    // Answers to the case's outstanding questions carry as much signal as the
    // opening narrative, so followup_* is treated the same way.
    if (!NARRATIVE_FIELDS.includes(key) && !key.startsWith("followup_")) continue;
    if (typeof value === "string" && value.trim().length > 2) {
      fieldUnits.push({ text: value.trim(), field: key });
    }
  }

  // Ordering is inferred from the witness's own uninterrupted narration when we
  // have it; field answers are the fallback for text-only / test sessions.
  const orderingText =
    witnessTurns.length > 0
      ? witnessTurns.map(ensureTerminator).join(" ")
      : fieldUnits.map((u) => ensureTerminator(u.text)).join(" ");

  const units: SourceUnit[] = [
    ...witnessTurns.map((text) => ({ text, field: null })),
    ...fieldUnits,
  ];

  return { orderingText, units };
}

function ensureTerminator(text: string): string {
  return /[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;
}

export function extractClaims(
  interview: Interview,
  incident: Incident,
  witnessId: string,
): Claim[] {
  const { orderingText, units } = collectUnits(interview);
  const claims: Claim[] = [];
  const push = (c: Omit<Claim, "id" | "incidentId" | "witnessId">) => {
    claims.push({
      id: newId("clm"),
      incidentId: incident.id,
      witnessId,
      ...c,
    });
  };

  const pmBias = /p\.?m\.?|evening|night/i.test(incident.approximateTime);

  // --- Per-unit extraction: entities, attributes, presence, location, time ---
  for (const unit of units) {
    for (const seg of splitIntoSegments(unit.text)) {
      const certainty = certaintyOf(seg.text);
      const entityMentions = findMentions(seg.text, ENTITIES);
      const eventMentions = findMentions(seg.text, EVENTS);
      const negSet = negatedMentions(seg.text, eventMentions);

      for (const em of entityMentions) {
        push({
          category: "entity",
          subject: em.key,
          predicate: "involved",
          object: "true",
          displayObject: entityLabel(em.key),
          normalizedTime: null,
          temporalRelation: null,
          certainty,
          sourceExcerpt: excerpt(seg.raw),
          sourceField: unit.field,
        });
      }

      // Colors and directions bind to the nearest entity in the same clause.
      pushAttribute(seg, entityMentions, COLORS, COLOR_ALIASES, "color", certainty, unit, push);
      pushAttribute(
        seg,
        entityMentions,
        DIRECTIONS,
        DIRECTION_ALIASES,
        "direction",
        certainty,
        unit,
        push,
      );

      // Observed vs explicitly-not-observed.
      for (const ev of eventMentions) {
        const absent = negSet.has(ev.index);
        push({
          category: "presence",
          subject: ev.key,
          predicate: "observed",
          object: absent ? "absent" : "present",
          displayObject: absent ? `No ${eventLabel(ev.key).toLowerCase()}` : eventLabel(ev.key),
          normalizedTime: null,
          temporalRelation: null,
          certainty,
          sourceExcerpt: excerpt(seg.raw),
          sourceField: unit.field,
        });
      }

      // Place matching is two-level: the base place supports corroboration
      // ("the loading dock" ≈ "Loading Dock B"), while the identifier is a
      // separate exclusive attribute so "Dock A" vs "Dock B" still conflicts.
      const suppressed = new Set<string>();
      for (const place of PLACE_PATTERNS) {
        if (suppressed.has(place.key)) continue;
        const m = new RegExp(place.re.source).exec(seg.text);
        if (!m) continue;
        place.supersedes?.forEach((k) => suppressed.add(k));

        const specifier = m[1]?.trim();
        const display = specifier ? `${place.label} ${specifier.toUpperCase()}` : place.label;

        push({
          category: "location",
          subject: "observer",
          predicate: "located_at",
          object: place.key,
          displayObject: display,
          normalizedTime: null,
          temporalRelation: null,
          certainty,
          sourceExcerpt: excerpt(seg.raw),
          sourceField: unit.field,
        });

        if (specifier) {
          push({
            category: "attribute",
            subject: place.key,
            predicate: "place_id",
            object: specifier.toLowerCase(),
            displayObject: display,
            normalizedTime: null,
            temporalRelation: null,
            certainty,
            sourceExcerpt: excerpt(seg.raw),
            sourceField: unit.field,
          });
        }
      }

      const minutes = parseClockTime(seg.text, pmBias);
      if (minutes !== null) {
        push({
          category: "time_point",
          subject: "incident",
          predicate: "occurred_at",
          object: String(minutes),
          displayObject: formatClock(minutes),
          normalizedTime: minutes,
          temporalRelation: null,
          certainty,
          sourceExcerpt: excerpt(seg.raw),
          sourceField: unit.field,
        });
      }

      if (/\binjur\w*|\bhurt\b|\bbleed\w*|\bambulance\b|\bparamedic\w*/.test(seg.text)) {
        const absent = isNegatedBefore(seg.text, seg.text.search(/\binjur|\bhurt\b/));
        push({
          category: "injury",
          subject: "persons",
          predicate: "injured",
          object: absent ? "none_reported" : "reported",
          displayObject: absent ? "No injuries reported" : "Possible injury reported",
          normalizedTime: null,
          temporalRelation: null,
          certainty,
          sourceExcerpt: excerpt(seg.raw),
          sourceField: unit.field,
        });
      }
    }
  }

  // --- Temporal ordering from the narrative flow ---
  claims.push(
    ...extractTemporalOrder(orderingText, incident.id, witnessId).map((c) => ({
      ...c,
      id: newId("clm"),
    })),
  );

  return dedupe(claims);
}

function pushAttribute(
  seg: Segment,
  entityMentions: { key: string; index: number }[],
  vocabulary: string[],
  aliases: Record<string, string>,
  predicate: string,
  certainty: Claim["certainty"],
  unit: SourceUnit,
  push: (c: Omit<Claim, "id" | "incidentId" | "witnessId">) => void,
): void {
  if (entityMentions.length === 0) return;
  for (const word of vocabulary) {
    const m = new RegExp(`\\b${word}\\b`).exec(seg.text);
    if (!m) continue;
    // Bind to whichever entity sits closest to the descriptor.
    const nearest = entityMentions.reduce((best, cur) =>
      Math.abs(cur.index - m.index) < Math.abs(best.index - m.index) ? cur : best,
    );
    const canonical = aliases[word] ?? word;
    push({
      category: "attribute",
      subject: nearest.key,
      predicate,
      object: canonical,
      displayObject: `${entityLabel(nearest.key)} — ${predicate}: ${canonical}`,
      normalizedTime: null,
      temporalRelation: null,
      certainty,
      sourceExcerpt: excerpt(seg.raw),
      sourceField: unit.field,
    });
  }
}

/**
 * Derives "X happened before Y" claims two ways:
 *  1. explicit cues inside a clause ("the alarm went off after the rack fell")
 *  2. the order the witness narrated events in ("... and then ...")
 */
function extractTemporalOrder(
  orderingText: string,
  incidentId: string,
  witnessId: string,
): Omit<Claim, "id">[] {
  const segments = splitIntoSegments(orderingText);
  if (segments.length === 0) return [];

  const out: Omit<Claim, "id">[] = [];
  const seen = new Set<string>();

  const emit = (
    earlier: string,
    later: string,
    sourceExcerpt: string,
    certainty: Claim["certainty"],
  ) => {
    if (earlier === later) return;
    const key = `${earlier}->${later}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      incidentId,
      witnessId,
      category: "temporal_order",
      subject: earlier,
      predicate: "before",
      object: later,
      displayObject: `${eventLabel(earlier)} → ${eventLabel(later)}`,
      normalizedTime: null,
      temporalRelation: "before",
      certainty,
      sourceExcerpt,
      sourceField: null,
    });
  };

  // Pairs the speaker ordered explicitly. Narrative position must not later
  // contradict them: mentioning the impact early and the horn late does not mean
  // the impact happened first, and the speaker already told us which came first.
  const explicitPairs = new Set<string>();

  // (1) Explicit before/after inside a single clause takes priority.
  for (const seg of segments) {
    const mentions = findMentions(seg.text, EVENTS).filter(
      (m) => !isNegatedBefore(seg.text, m.index),
    );
    if (mentions.length < 2) continue;
    const cueRe = /\b(before|after)\b/g;
    let cue: RegExpExecArray | null;
    while ((cue = cueRe.exec(seg.text)) !== null) {
      const left = [...mentions].reverse().find((m) => m.index < cue!.index);
      const right = mentions.find((m) => m.index > cue!.index);
      if (!left || !right) continue;
      if (cue[1] === "before") emit(left.key, right.key, excerpt(seg.raw), certaintyOf(seg.text));
      else emit(right.key, left.key, excerpt(seg.raw), certaintyOf(seg.text));
    }
  }

  // (1b) Adjacency across a progression marker: "I heard a horn, then the crash".
  // Saying "X, then Y" states a sequence just as plainly as "X before Y", so it
  // carries the same weight. Without this, an event merely *mentioned* earlier
  // for reference ("at the moment of impact") outranks the speaker's own
  // explicit ordering and manufactures a contradiction against them.
  for (let i = 0; i < segments.length - 1; i++) {
    const next = segments[i + 1];
    if (!next.startsWithProgression) continue;

    const here = findMentions(segments[i].text, EVENTS);
    const hereNeg = negatedMentions(segments[i].text, here);
    const left = here.filter((m) => !hereNeg.has(m.index)).pop();

    const there = findMentions(next.text, EVENTS);
    const thereNeg = negatedMentions(next.text, there);
    const right = there.filter((m) => !thereNeg.has(m.index))[0];

    if (!left || !right || left.key === right.key) continue;
    explicitPairs.add([left.key, right.key].sort().join("|"));
    emit(
      left.key,
      right.key,
      excerpt(segments[i].raw + " " + next.raw, 220),
      certaintyOf(segments[i].text + " " + next.text),
    );
  }
  // (2) Narrative order: first mention of each event defines its step.
  const firstAt = new Map<string, { step: number; seg: Segment }>();
  for (const seg of segments) {
    for (const m of findMentions(seg.text, EVENTS)) {
      if (isNegatedBefore(seg.text, m.index)) continue; // "I saw no smoke" is not an event
      if (!firstAt.has(m.key)) firstAt.set(m.key, { step: seg.step, seg });
    }
  }

  const ordered = [...firstAt.entries()].sort((a, b) => a[1].step - b[1].step);

  // Record where each event sat in this witness's narration, normalized to
  // 0..1 so accounts of different lengths stay comparable. The timeline uses
  // this to order events that no witness explicitly sequenced.
  if (ordered.length > 0) {
    const minStep = ordered[0][1].step;
    const maxStep = ordered[ordered.length - 1][1].step;
    const span = maxStep - minStep;
    for (const [key, at] of ordered) {
      out.push({
        incidentId,
        witnessId,
        category: "narrative",
        subject: key,
        predicate: "narrative_position",
        object: (span === 0 ? 0 : (at.step - minStep) / span).toFixed(3),
        displayObject: `Narrated at position ${ordered.findIndex(([k]) => k === key) + 1} of ${ordered.length}`,
        normalizedTime: null,
        temporalRelation: null,
        certainty: "high",
        sourceExcerpt: excerpt(at.seg.raw),
        sourceField: null,
      });
    }
  }

  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      const [earlierKey, earlier] = ordered[i];
      const [laterKey, later] = ordered[j];
      if (earlier.step === later.step) continue; // same beat — no order asserted
      if (explicitPairs.has([earlierKey, laterKey].sort().join("|"))) continue;
      emit(
        earlierKey,
        laterKey,
        excerpt(`${earlier.seg.raw} … ${later.seg.raw}`, 220),
        certaintyOf(`${earlier.seg.text} ${later.seg.text}`),
      );
    }
  }

  return out;
}

function dedupe(claims: Claim[]): Claim[] {
  const seen = new Set<string>();
  const out: Claim[] = [];
  for (const c of claims) {
    const key = `${c.witnessId}|${c.category}|${c.subject}|${c.predicate}|${c.object}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
