// Compares independent witness accounts and produces findings + a timeline.
//
// Design rule: BlackBox never asserts what actually happened or who is lying.
// It reports what is corroborated, what genuinely conflicts, what only one
// person said, and what an investigator should ask next.

import { EVENTS, EXCLUSIVE_PREDICATES, entityLabel, eventLabel, eventNoun } from "./lexicon.ts";
import { formatClock, parseClockTime } from "./normalize.ts";
import { detectJointImpossibilities } from "./jointRules.ts";
import type { Claim, Finding, Incident, TimelineEvent, Witness } from "./types.ts";

/** Clock times inside this window are treated as the same reported time. */
const TIME_AGREEMENT_TOLERANCE_MIN = 5;
/** Beyond this, two reported times are genuinely incompatible. */
const TIME_CONFLICT_THRESHOLD_MIN = 15;

const EVENT_KEYS = new Set(EVENTS.map((e) => e.key));

/**
 * Open sensory prompts, safe to read to a witness who has not mentioned the
 * detail. They ask the whole category rather than the specific thing another
 * witness reported, so nothing is suggested to the person answering.
 */
const SAFE_PROMPTS: Record<string, string> = {
  chemical_smell: "Did you notice any unusual smells or odours at any point?",
  smoke: "Did you see any smoke or haze in the area?",
  fire: "Did you see any fire or flames?",
  spill: "Did you see any liquid, spill, or leak on the ground?",
  shouting: "Did you hear anyone shouting or calling out?",
  alarm: "Did you hear any alarm or siren?",
  collision: "Did you see any vehicle or equipment make contact with anything?",
  rack_collapse: "Did you see anything fall, collapse, or come down?",
  evacuation: "Did you see anyone leaving or clearing the area?",
  injury: "Did you see anyone injured or in difficulty?",
  horn: "Did you hear a horn or any warning sound?",
  braking: "Did you hear any braking, skidding, or tyres?",
  steam: "Did you see any steam, smoke, or vapour?",
  pedestrian_present: "Did you see anyone on foot in or near the crossing?",
  airbag: "Did you notice whether any airbags deployed?",
};

export interface ReconciliationResult {
  findings: Finding[];
  timeline: TimelineEvent[];
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

export function reconcile(
  claims: Claim[],
  witnesses: Witness[],
  incident: Incident,
): ReconciliationResult {
  const nameOf = new Map(witnesses.map((w) => [w.id, w.displayName]));
  const name = (id: string) => nameOf.get(id) ?? "Unknown witness";
  const participating = new Set(claims.map((c) => c.witnessId));
  const multiWitness = participating.size >= 2;

  const findings: Finding[] = [];
  const disputedSubjects = new Set<string>();

  // Jointly-impossible sets are detected before anything else, because two
  // claims can agree on their literal value and still be impossible together:
  // two drivers each recalling a green light both literally say "green".
  const joint = detectJointImpossibilities(claims, witnesses, incident);
  const jointlySuppressed = new Set(joint.flatMap((j) => j.suppressTopics));
  for (const j of joint) {
    for (const cid of j.claimIds) {
      const c = claims.find((x) => x.id === cid);
      if (c) disputedSubjects.add(c.subject);
    }
    findings.push({
      id: newId("fnd"),
      incidentId: incident.id,
      type: "contradiction",
      title: j.title,
      explanation: j.explanation,
      involvedWitnessIds: j.witnessIds,
      sourceClaimIds: j.claimIds,
      followUpQuestion: j.followUpQuestion,
      witnessPrompt: j.followUpQuestion,
      askPriority: -1,
    });
  }

  // ---------------------------------------------------------------- grouping
  // Group by the thing being described, so we can ask: who said what about it?
  const groups = new Map<string, Claim[]>();
  for (const c of claims) {
    const key = `${c.category}|${c.subject}|${c.predicate}`;
    const list = groups.get(key);
    if (list) list.push(c);
    else groups.set(key, [c]);
  }

  for (const [, group] of groups) {
    const sample = group[0];
    // Narrative-position claims are internal ordering evidence, not findings.
    if (sample.category === "narrative") continue;

    const byWitness = new Map<string, Claim[]>();
    for (const c of group) {
      const list = byWitness.get(c.witnessId);
      if (list) list.push(c);
      else byWitness.set(c.witnessId, [c]);
    }

    // ------------------------------------------------------------ time point
    if (sample.category === "time_point") {
      const times = [...byWitness.entries()].map(([wid, cs]) => ({
        wid,
        claim: cs[0],
        minutes: cs[0].normalizedTime ?? 0,
      }));
      if (times.length >= 2) {
        const spread =
          Math.max(...times.map((t) => t.minutes)) - Math.min(...times.map((t) => t.minutes));
        if (spread > TIME_CONFLICT_THRESHOLD_MIN) {
          findings.push({
            id: newId("fnd"),
            incidentId: incident.id,
            type: "contradiction",
            title: `Reported times differ by ${spread} minutes`,
            explanation: times
              .map((t) => `${name(t.wid)} reported ${formatClock(t.minutes)}`)
              .join("; ") + ".",
            involvedWitnessIds: times.map((t) => t.wid),
            sourceClaimIds: times.map((t) => t.claim.id),
            followUpQuestion:
              "What was the approximate time when you first noticed something unusual, and what were you using to check the time?",
          });
        } else if (spread <= TIME_AGREEMENT_TOLERANCE_MIN) {
          findings.push({
            id: newId("fnd"),
            incidentId: incident.id,
            type: "agreement",
            title: `Approximate time reported as ${formatClock(times[0].minutes)}`,
            explanation: `Reported by ${times.map((t) => name(t.wid)).join(" and ")} within ${TIME_AGREEMENT_TOLERANCE_MIN} minutes of each other. Corroborated, not verified.`,
            involvedWitnessIds: times.map((t) => t.wid),
            sourceClaimIds: times.map((t) => t.claim.id),
          });
        } else {
          findings.push({
            id: newId("fnd"),
            incidentId: incident.id,
            type: "open_question",
            title: `Reported times differ by ${spread} minutes — within estimation uncertainty`,
            explanation: `${times.map((t) => `${name(t.wid)}: ${formatClock(t.minutes)}`).join("; ")}. Treated as uncertainty rather than a conflict.`,
            involvedWitnessIds: times.map((t) => t.wid),
            sourceClaimIds: times.map((t) => t.claim.id),
            followUpQuestion: "How confident are you in that time, and how did you check it?",
          });
        }
      } else {
        // Only one witness offered a time. If it lines up with the time on the
        // incident record we say so — while being explicit that a record match
        // is not corroboration by a second witness.
        const recorded = parseClockTime(incident.approximateTime, true);
        const reported = times[0].minutes;
        const matchesRecord =
          recorded !== null && Math.abs(recorded - reported) <= TIME_AGREEMENT_TOLERANCE_MIN;

        if (matchesRecord) {
          findings.push({
            id: newId("fnd"),
            incidentId: incident.id,
            type: "agreement",
            title: `Approximate time ${formatClock(reported)}`,
            explanation: `Reported by ${name(times[0].wid)} and consistent with the time on the incident record (${incident.approximateTime}). Not yet corroborated by a second witness.`,
            involvedWitnessIds: [times[0].wid],
            sourceClaimIds: [times[0].claim.id],
          });
        } else if (multiWitness) {
          pushUnique(findings, incident, sample, name, `Approximate time ${sample.displayObject}`);
        }
      }
      continue;
    }

    // ------------------------------------------------------ temporal ordering
    if (sample.category === "temporal_order") {
      // The reverse group tells us whether anyone ordered these the other way.
      const reverseKey = `temporal_order|${sample.object}|before`;
      const reverse = (groups.get(reverseKey) ?? []).filter((c) => c.object === sample.subject);
      const forwardWitnesses = [...new Set(group.map((c) => c.witnessId))];
      const reverseWitnesses = [...new Set(reverse.map((c) => c.witnessId))];
      const conflicting = reverseWitnesses.filter((w) => !forwardWitnesses.includes(w));

      if (conflicting.length > 0) {
        // Emit once per pair, not twice.
        if (sample.subject < sample.object) {
          disputedSubjects.add(sample.subject);
          disputedSubjects.add(sample.object);
          findings.push({
            id: newId("fnd"),
            incidentId: incident.id,
            type: "contradiction",
            title: `Disputed sequence: ${eventLabel(sample.subject)} vs ${eventLabel(sample.object)}`,
            explanation:
              `${forwardWitnesses.map(name).join(" and ")} placed "${eventLabel(sample.subject)}" before "${eventLabel(sample.object)}". ` +
              `${conflicting.map(name).join(" and ")} placed them in the opposite order. ` +
              `Both accounts are recorded as given; neither is treated as correct.`,
            involvedWitnessIds: [...forwardWitnesses, ...conflicting],
            sourceClaimIds: [...group.map((c) => c.id), ...reverse.map((c) => c.id)],
            followUpQuestion: `Did ${eventNoun(sample.subject)} happen before or after ${eventNoun(sample.object)}?`,
          });
        }
      } else if (forwardWitnesses.length >= 2) {
        findings.push({
          id: newId("fnd"),
          incidentId: incident.id,
          type: "agreement",
          title: `Sequence corroborated: ${eventLabel(sample.subject)} → ${eventLabel(sample.object)}`,
          explanation: `${forwardWitnesses.map(name).join(" and ")} independently described this order. Corroborated, not verified.`,
          involvedWitnessIds: forwardWitnesses,
          sourceClaimIds: group.map((c) => c.id),
        });
      }
      continue;
    }

    // ------------------------------------------------------------- presence
    if (sample.category === "presence") {
      const present = [...byWitness.entries()].filter(([, cs]) =>
        cs.some((c) => c.object === "present"),
      );
      const absent = [...byWitness.entries()].filter(([, cs]) =>
        cs.some((c) => c.object === "absent"),
      );

      if (present.length > 0 && absent.length > 0) {
        disputedSubjects.add(sample.subject);
        findings.push({
          id: newId("fnd"),
          incidentId: incident.id,
          type: "contradiction",
          title: `Disputed observation: ${eventLabel(sample.subject)}`,
          explanation:
            `${present.map(([w]) => name(w)).join(" and ")} reported observing it. ` +
            `${absent.map(([w]) => name(w)).join(" and ")} explicitly reported not observing it. ` +
            `Vantage point and timing may differ.`,
          involvedWitnessIds: [...present.map(([w]) => w), ...absent.map(([w]) => w)],
          sourceClaimIds: group.map((c) => c.id),
          followUpQuestion: `Was ${eventNoun(sample.subject)} present at the scene, and at what point did you notice it or confirm its absence?`,
        });
      } else if (present.length >= 2) {
        findings.push({
          id: newId("fnd"),
          incidentId: incident.id,
          type: "agreement",
          title: eventLabel(sample.subject),
          explanation: `Reported independently by ${present.map(([w]) => name(w)).join(" and ")}. Corroborated, not verified.`,
          involvedWitnessIds: present.map(([w]) => w),
          sourceClaimIds: group.map((c) => c.id),
        });
      } else if (multiWitness && byWitness.size === 1) {
        const only = group[0];
        pushUnique(
          findings,
          incident,
          only,
          name,
          only.object === "absent"
            ? `${name(only.witnessId)} explicitly reported not observing ${eventNoun(only.subject)}`
            : `${eventLabel(only.subject)} — reported by one witness only`,
        );
      }
      continue;
    }

    // ------------------------------------------------------------ attributes
    if (sample.category === "attribute") {
      const values = new Map<string, string[]>(); // value -> witnessIds
      for (const [wid, cs] of byWitness) {
        for (const c of cs) {
          const list = values.get(c.object);
          if (list) list.push(wid);
          else values.set(c.object, [wid]);
        }
      }

      const topicKey = sample.subject + "." + sample.predicate;
      if (
        values.size > 1 &&
        EXCLUSIVE_PREDICATES.has(sample.predicate) &&
        // superseded by a joint rule that states the problem precisely
        !jointlySuppressed.has(topicKey)
      ) {
        disputedSubjects.add(sample.subject);
        findings.push({
          id: newId("fnd"),
          incidentId: incident.id,
          type: "contradiction",
          title: `Conflicting ${sample.predicate}: ${entityLabel(sample.subject)}`,
          explanation:
            [...values.entries()]
              .map(([v, ws]) => `${ws.map(name).join(" and ")} described it as ${v}`)
              .join("; ") +
            ". Perception of this attribute can be affected by lighting and distance.",
          involvedWitnessIds: [...byWitness.keys()],
          sourceClaimIds: group.map((c) => c.id),
          followUpQuestion:
            sample.predicate === "color"
              ? `What ${sample.predicate} was the ${lower(entityLabel(sample.subject))}, and what were the lighting conditions where you were standing?`
              : `What ${sample.predicate} was the ${lower(entityLabel(sample.subject))} from where you were standing?`,
        });
      } else if (
        values.size === 1 &&
        !jointlySuppressed.has(sample.subject + "." + sample.predicate)
      ) {
        const [value, ws] = [...values.entries()][0];
        if (ws.length >= 2) {
          findings.push({
            id: newId("fnd"),
            incidentId: incident.id,
            type: "agreement",
            title: `${entityLabel(sample.subject)} ${sample.predicate}: ${value}`,
            explanation: `Described the same way by ${ws.map(name).join(" and ")}. Corroborated, not verified.`,
            involvedWitnessIds: ws,
            sourceClaimIds: group.map((c) => c.id),
          });
        } else if (multiWitness) {
          pushUnique(
            findings,
            incident,
            group[0],
            name,
            sample.predicate === "place_id"
              ? `${group[0].displayObject} — specific location given by one witness`
              : `${entityLabel(sample.subject)} ${sample.predicate} reported as ${value} by one witness`,
          );
        }
      }
      continue;
    }

    // ------------------------------------------------- entities, location, injury
    // Corroboration requires the same *value*, not merely the same topic:
    // "at the loading dock" and "in the warehouse" are not the same answer.
    const byValue = new Map<string, Claim[]>();
    for (const c of group) {
      const list = byValue.get(c.object);
      if (list) list.push(c);
      else byValue.set(c.object, [c]);
    }

    for (const [, valueClaims] of byValue) {
      const wids = [...new Set(valueClaims.map((c) => c.witnessId))];
      const label =
        sample.category === "entity"
          ? `${entityLabel(sample.subject)} involved`
          : valueClaims[0].displayObject;

      if (wids.length >= 2) {
        findings.push({
          id: newId("fnd"),
          incidentId: incident.id,
          type: "agreement",
          title: label,
          explanation: `Reported independently by ${wids.map(name).join(" and ")}. Corroborated, not verified.`,
          involvedWitnessIds: wids,
          sourceClaimIds: valueClaims.map((c) => c.id),
        });
      } else if (multiWitness && sample.category !== "entity") {
        pushUnique(findings, incident, valueClaims[0], name, label);
      }
    }
  }

  // ------------------------------------------------------------ open questions
  findings.push(...openQuestions(findings, claims, witnesses, incident, multiWitness));

  const timeline = buildTimeline(claims, incident, disputedSubjects);
  return { findings: rank(findings), timeline };
}

function pushUnique(
  findings: Finding[],
  incident: Incident,
  claim: Claim,
  name: (id: string) => string,
  title: string,
): void {
  findings.push({
    id: newId("fnd"),
    incidentId: incident.id,
    type: "unique_claim",
    title,
    explanation: `Reported only by ${name(claim.witnessId)}. No other interviewed witness addressed this. Absence of corroboration is not evidence of inaccuracy.`,
    involvedWitnessIds: [claim.witnessId],
    sourceClaimIds: [claim.id],
  });
}

function openQuestions(
  existing: Finding[],
  claims: Claim[],
  witnesses: Witness[],
  incident: Incident,
  multiWitness: boolean,
): Finding[] {
  const out: Finding[] = [];

  // Every contradiction earns a neutral, non-leading follow-up. These are safe
  // to speak aloud: they ask for the witness's own account of a disputed
  // dimension without revealing that anyone disagreed, or who.
  for (const f of existing) {
    if (f.type === "contradiction" && f.followUpQuestion) {
      f.witnessPrompt = f.followUpQuestion;
      out.push({
        id: newId("fnd"),
        incidentId: incident.id,
        type: "open_question",
        title: f.followUpQuestion,
        explanation: `Generated from an unresolved conflict: ${f.title}.`,
        involvedWitnessIds: f.involvedWitnessIds,
        sourceClaimIds: f.sourceClaimIds,
        witnessPrompt: f.followUpQuestion,
        askPriority: 0,
      });
    }
  }

  // Sensory / hazard details that only one person reported are worth chasing.
  for (const f of existing) {
    if (f.type !== "unique_claim") continue;
    const claim = claims.find((c) => c.id === f.sourceClaimIds[0]);
    if (!claim || !EVENT_KEYS.has(claim.subject)) continue;
    if (claim.object !== "present") continue;
    const noun = eventNoun(claim.subject);
    out.push({
      id: newId("fnd"),
      incidentId: incident.id,
      type: "open_question",
      title: `Did any other witness observe ${noun}?`,
      explanation: `Only one interviewed witness reported this.`,
      involvedWitnessIds: f.involvedWitnessIds,
      sourceClaimIds: f.sourceClaimIds,
      // Asked as an open sensory prompt so the next witness is never told
      // what the first one reported.
      witnessPrompt: SAFE_PROMPTS[claim.subject],
    });
    out.push({
      id: newId("fnd"),
      incidentId: incident.id,
      type: "open_question",
      title: `Was ${noun} present before or after the rest of the sequence?`,
      explanation: `Timing was not established for this single-source observation.`,
      involvedWitnessIds: f.involvedWitnessIds,
      sourceClaimIds: f.sourceClaimIds,
    });
  }

  // Anything only one person has told us is a gap to put to the next witness.
  // This runs even when just one interview exists — that is precisely when an
  // investigator most needs a list of things to go and ask about.
  const witnessesFor = new Map<string, Set<string>>();
  for (const c of claims) {
    const key = `${c.category}|${c.subject}|${c.predicate}`;
    const set = witnessesFor.get(key) ?? new Set<string>();
    set.add(c.witnessId);
    witnessesFor.set(key, set);
  }

  const seenGap = new Set<string>();
  for (const claim of claims) {
    const key = `${claim.category}|${claim.subject}|${claim.predicate}`;
    if ((witnessesFor.get(key)?.size ?? 0) > 1) continue; // already corroborated
    if (seenGap.has(key)) continue;

    let title: string | null = null;
    let prompt: string | undefined;
    let priority = 4;

    if (
      claim.category === "presence" &&
      claim.object === "present" &&
      EVENT_KEYS.has(claim.subject)
    ) {
      title = `Did any other witness observe ${eventNoun(claim.subject)}?`;
      prompt = SAFE_PROMPTS[claim.subject];
      priority = 3;
    } else if (claim.category === "attribute" && EXCLUSIVE_PREDICATES.has(claim.predicate)) {
      const thing = lower(entityLabel(claim.subject));
      title = `Can another witness describe the ${claim.predicate} of the ${thing}?`;
      priority = 1;
      prompt =
        claim.predicate === "color"
          ? `What colour was the ${thing}, and what were the lighting conditions where you were standing?`
          : claim.predicate === "direction"
            ? `Which direction was the ${thing} moving, from where you were standing?`
            : `How would you describe the ${claim.predicate} of the ${thing}?`;
    } else if (claim.category === "temporal_order") {
      title = `Can another witness place ${eventNoun(claim.subject)} relative to ${eventNoun(claim.object)}?`;
      prompt = `Did ${eventNoun(claim.subject)} happen before or after ${eventNoun(claim.object)}?`;
      priority = 2;
    }

    if (!title || !prompt) continue;
    seenGap.add(key);
    out.push({
      id: newId("fnd"),
      incidentId: incident.id,
      type: "open_question",
      title,
      explanation: "Reported by a single witness so far. Not yet corroborated.",
      involvedWitnessIds: [claim.witnessId],
      sourceClaimIds: [claim.id],
      witnessPrompt: prompt,
      askPriority: priority,
    });
  }

  if (!multiWitness) {
    out.push({
      id: newId("fnd"),
      incidentId: incident.id,
      type: "open_question",
      title: "Additional independent witness accounts are required for corroboration",
      explanation:
        "Only one interview has been completed. No claim in this incident is currently corroborated by a second source.",
      involvedWitnessIds: witnesses.map((w) => w.id),
      sourceClaimIds: [],
    });
  }

  // Dedupe by question text.
  const seen = new Set<string>();
  return out.filter((f) => {
    const k = f.title.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function buildTimeline(
  claims: Claim[],
  incident: Incident,
  disputed: Set<string>,
): TimelineEvent[] {
  const observed = claims.filter(
    (c) => c.category === "presence" && c.object === "present" && EVENT_KEYS.has(c.subject),
  );
  if (observed.length === 0) return [];

  const byEvent = new Map<string, Claim[]>();
  for (const c of observed) {
    const list = byEvent.get(c.subject);
    if (list) list.push(c);
    else byEvent.set(c.subject, [c]);
  }

  const orderClaims = claims.filter((c) => c.category === "temporal_order");
  // How many accounts place this event after something, minus how many place it
  // before something. Lower means earlier.
  const score = (key: string) =>
    orderClaims.filter((c) => c.object === key).length -
    orderClaims.filter((c) => c.subject === key).length;

  // When accounts genuinely conflict the scores tie. Fall back to where each
  // event sat in witnesses' narration, averaged across everyone who mentioned it.
  const positionClaims = claims.filter((c) => c.predicate === "narrative_position");
  const meanPosition = (key: string): number => {
    const values = positionClaims
      .filter((c) => c.subject === key)
      .map((c) => Number(c.object))
      .filter((n) => Number.isFinite(n));
    if (values.length === 0) return 0.5;
    return values.reduce((a, b) => a + b, 0) / values.length;
  };

  const times = claims
    .filter((c) => c.category === "time_point" && c.normalizedTime !== null)
    .map((c) => c.normalizedTime!)
    .sort((a, b) => a - b);
  const medianTime = times.length > 0 ? times[Math.floor(times.length / 2)] : null;

  const events = [...byEvent.entries()]
    .map(([key, cs]) => {
      const supporting = [...new Set(cs.map((c) => c.witnessId))];
      return {
        key,
        supporting,
        claims: cs,
        s: score(key),
        pos: meanPosition(key),
      };
    })
    .sort((a, b) => a.s - b.s || a.pos - b.pos || a.key.localeCompare(b.key));

  return events.map((e, i) => ({
    id: newId("tl"),
    incidentId: incident.id,
    label: eventLabel(e.key),
    eventKey: e.key,
    approximateTime: i === 0 && medianTime !== null ? formatClock(medianTime) : null,
    supportingWitnessIds: e.supporting,
    confidence: disputed.has(e.key)
      ? "disputed"
      : e.supporting.length >= 2
        ? "corroborated"
        : "single_source",
    sourceClaimIds: e.claims.map((c) => c.id),
    rank: i,
  }));
}

const TYPE_ORDER: Record<Finding["type"], number> = {
  contradiction: 0,
  agreement: 1,
  unique_claim: 2,
  open_question: 3,
};

function rank(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      TYPE_ORDER[a.type] - TYPE_ORDER[b.type] ||
      // Lower askPriority is more urgent. Joint impossibilities carry -1, so a
      // "these accounts cannot all be true" always leads its section and wins
      // topic deduplication against a weaker finding about the same thing.
      (a.askPriority ?? 5) - (b.askPriority ?? 5) ||
      a.title.localeCompare(b.title),
  );
}

function lower(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Cross-checking the two engines
// ---------------------------------------------------------------------------

export interface Analysis {
  claims: Claim[];
  findings: Finding[];
  timeline: TimelineEvent[];
}

/**
 * Unions the deterministic result with the LLM's.
 *
 * The rules engine is exhaustive and precisely worded on vocabulary it knows;
 * the model generalises to real, messy speech the lexicon has never seen.
 * Neither is dropped — a finding either engine reached is kept, deduplicated on
 * what it is actually about rather than on how it was phrased.
 */
export function mergeAnalyses(deterministic: Analysis, llm: Analysis): Analysis {
  const claims = [...deterministic.claims, ...llm.claims];
  const claimById = new Map(claims.map((c) => [c.id, c]));

  // Identity of a finding = its type plus the subject/predicate pairs it cites.
  const signature = (f: Finding): string => {
    if (f.type === "open_question") return `q:${f.title.trim().toLowerCase().replace(/[^a-z ]/g, "")}`;
    const topics = [
      ...new Set(
        f.sourceClaimIds
          .map((id) => claimById.get(id))
          .filter((c): c is Claim => Boolean(c))
          .map((c) => `${c.subject}.${c.predicate}`),
      ),
    ].sort();
    // Identity is the topic *and* who it concerns: one witness contradicting
    // himself about the signal is not the same finding as two drivers
    // contradicting each other about it.
    const who = [...new Set(f.involvedWitnessIds)].sort().join(",");
    return `${f.type}:${topics.join("|")}::${who}`;
  };

  const topicSet = (f: Finding): Set<string> =>
    new Set(
      f.sourceClaimIds
        .map((id) => claimById.get(id))
        .filter((c): c is Claim => Boolean(c))
        .map((c) => `${c.subject}.${c.predicate}`),
    );

  const all = [...deterministic.findings, ...llm.findings];

  // If one engine calls something corroborated while the other calls it
  // contradicted, the honest reading is "unresolved". Never show both.
  const disputedTopics = new Set<string>();
  for (const f of all) {
    if (f.type === "contradiction") for (const t of topicSet(f)) disputedTopics.add(t);
  }

  // Did the rules engine already rule that the reported times, while
  // different, sit inside normal estimation error?
  const timeRuledUncertain = deterministic.findings.some(
    (f) => f.type === "open_question" && /estimation uncertainty/i.test(f.title),
  );

  /** True when a finding is *only* about clock times. */
  const isPurelyTemporal = (f: Finding): boolean => {
    const cs = f.sourceClaimIds
      .map((id) => claimById.get(id))
      .filter((c): c is Claim => Boolean(c));
    return cs.length > 0 && cs.every((c) => c.category === "time_point");
  };

  // Participant sets the rules engine has already ruled on. Its wording is
  // precise and its rules are auditable, so where it has spoken it is
  // authoritative; the model's job is to cover ground the lexicon cannot,
  // not to restate the same dispute in looser language.
  const alreadyRuledParticipants = new Set(
    deterministic.findings
      .filter((f) => f.type === "contradiction")
      .map((f) => [...new Set(f.involvedWitnessIds)].sort().join(",")),
  );

  const seen = new Set<string>();
  const findings: Finding[] = [];
  const keptTerms: { type: string; terms: Set<string> }[] = [];

  // Deterministic first, so its wording wins on anything both engines found.
  for (const f of all) {
    if (f.type === "agreement" && [...topicSet(f)].some((t) => disputedTopics.has(t))) continue;

    // People estimate times badly; that is recall error, not an incompatible
    // pair of claims. Where the engine has already filed the spread as
    // uncertainty, a model-flagged time conflict is dropped — otherwise the
    // board asserts both readings of the same fact at once.
    if (f.type === "contradiction" && timeRuledUncertain && isPurelyTemporal(f)) continue;

    // A model conflict between exactly the people the engine has already
    // ruled on is a re-description of that ruling.
    if (
      f.type === "contradiction" &&
      llm.findings.includes(f) &&
      alreadyRuledParticipants.has([...new Set(f.involvedWitnessIds)].sort().join(","))
    ) {
      continue;
    }
    const key = signature(f);
    if (seen.has(key)) continue;

    // The two engines phrase the same point differently ("Did the alarm happen
    // before or after the rack collapsing?" vs "...sound before or after the
    // rack collapsed?"). Catch those on meaning, not wording.
    const terms = contentTerms(f.title);
    if (keptTerms.some((k) => k.type === f.type && overlaps(k.terms, terms, f.type))) continue;

    seen.add(key);
    keptTerms.push({ type: f.type, terms });
    findings.push(f);
  }

  // Ordering is where the rules engine is strongest; fall back to the model
  // only when the lexicon recognised nothing in the account.
  const timeline = deterministic.timeline.length > 0 ? deterministic.timeline : llm.timeline;

  return { claims, findings: rank(findings), timeline };
}

const STOPWORDS = new Set([
  "did", "do", "does", "the", "a", "an", "was", "were", "is", "are", "be", "been",
  "you", "your", "any", "other", "of", "to", "in", "on", "at", "it", "that", "this",
  "there", "and", "or", "for", "with", "from", "what", "when", "where", "who", "how",
  "why", "could", "would", "have", "has", "by", "as", "its",
  // Boilerplate shared by nearly every generated finding — it carries no
  // distinguishing meaning and would otherwise make unrelated items look alike.
  "witness", "witnesses", "observe", "observed", "report", "reported", "notice",
  "noticed", "anyone", "else", "one", "only", "someone",
]);

/** Meaning-bearing, lightly stemmed words from a finding title. */
function contentTerms(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
      .map((w) => w.replace(/(ing|ed|es|s)$/, "")),
  );
}

/**
 * True when two titles are saying the same thing in different words.
 *
 * Questions are matched loosely — the two engines habitually ask the same thing
 * with different verbs. Statements are matched strictly, because a short title
 * is often legitimately a subset of a longer, different one ("Alarm sounds" vs
 * "Sequence corroborated: rack collapse → alarm sounds").
 */
function overlaps(a: Set<string>, b: Set<string>, type: Finding["type"]): boolean {
  if (a.size === 0 || b.size === 0) return false;
  let shared = 0;
  for (const t of b) if (a.has(t)) shared++;

  // Same words, whatever the length — always the same finding.
  if (shared === a.size && shared === b.size) return true;

  const smaller = Math.min(a.size, b.size);
  const union = a.size + b.size - shared;

  if (type === "open_question") {
    if (smaller < 2) return false;
    // 0.8, not 0.65: questions differing by a single noun ("colour of the
    // traffic signal" vs "colour of the car") are different questions, and
    // dropping one loses a real line of enquiry.
    return shared / smaller >= 0.8 || shared / union >= 0.45;
  }

  // No containment test for statements: a short title is regularly a genuine
  // subset of a longer, different one, and the topic signature above already
  // catches the real cross-engine duplicates.
  if (smaller < 3) return false;
  return shared / union >= 0.6;
}
