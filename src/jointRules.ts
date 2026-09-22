// Joint impossibility detection.
//
// Most contradiction logic compares two claims about the same thing and asks
// whether the values differ. That misses the sharpest class of conflict: claims
// that are each perfectly plausible on their own but cannot all hold at once.
//
// The canonical case is two drivers on crossing approaches who each remember a
// green light. Neither statement is odd in isolation, and a value comparison
// sees them as *agreeing* — both said "green". Only the physical layout of a
// signalled intersection makes the conjunction impossible.
//
// BlackBox states that the set cannot all be true. It never decides which
// member is wrong, and never treats a mistaken recollection as a lie.

import { EXCLUSIVE_PREDICATES, entityLabel } from "./lexicon.ts";
import type { Claim, Incident, Witness } from "./types.ts";

export interface JointImpossibility {
  id: string;
  /** Which rule fired, for the audit trail. */
  rule: "conflicting_right_of_way" | "internally_inconsistent";
  title: string;
  explanation: string;
  claimIds: string[];
  witnessIds: string[];
  /**
   * `subject.predicate` topics that must NOT be reported as agreements.
   * Two drivers both saying "green" would otherwise read as corroboration.
   */
  suppressTopics: string[];
  /** External evidence that could actually settle it. */
  resolvingEvidence: string[];
  followUpQuestion: string;
}

/** Signal colours that mean "you may proceed". */
const GO_COLORS = new Set(["green"]);

function newId(): string {
  return `jnt_${crypto.randomUUID().slice(0, 8)}`;
}

export function detectJointImpossibilities(
  claims: Claim[],
  witnesses: Witness[],
  incident: Incident,
): JointImpossibility[] {
  const out: JointImpossibility[] = [];
  const witnessById = new Map(witnesses.map((w) => [w.id, w]));
  const nameOf = (id: string) => witnessById.get(id)?.displayName ?? "Unknown participant";

  out.push(...conflictingRightOfWay(claims, witnessById, nameOf, incident));
  out.push(...internallyInconsistent(claims, nameOf));
  return out;
}

/**
 * Two or more drivers approaching from different directions who each recall a
 * green signal. At a signalled intersection those phases are interlocked, so
 * the accounts cannot all be accurate.
 */
function conflictingRightOfWay(
  claims: Claim[],
  witnessById: Map<string, Witness>,
  nameOf: (id: string) => string,
  incident: Incident,
): JointImpossibility[] {
  const greenClaims = claims.filter(
    (c) =>
      c.subject === "traffic_light" &&
      c.predicate === "color" &&
      GO_COLORS.has(c.object.toLowerCase()),
  );
  if (greenClaims.length < 2) return [];

  // One claim per driver, and only from people actually driving — a pedestrian
  // describing a green light is reporting a different signal head entirely.
  const byDriver = new Map<string, Claim>();
  for (const c of greenClaims) {
    const w = witnessById.get(c.witnessId);
    if (!w || w.role !== "driver") continue;
    if (!byDriver.has(c.witnessId)) byDriver.set(c.witnessId, c);
  }
  if (byDriver.size < 2) return [];

  // Distinct approaches are what make it impossible. Same approach, same phase.
  const approaches = new Set(
    [...byDriver.keys()].map((id) => (witnessById.get(id)?.approach ?? "").toLowerCase().trim()),
  );
  if (approaches.size < 2) return [];

  const drivers = [...byDriver.keys()];
  const detail = drivers
    .map((id) => {
      const w = witnessById.get(id);
      return `${w?.displayName} (${w?.approach ?? "approach not recorded"})`;
    })
    .join(" and ");

  return [
    {
      id: newId(),
      rule: "conflicting_right_of_way",
      title: "These accounts cannot all be true",
      explanation:
        `${detail} each recall a green signal on their own approach. ` +
        `At a signalled intersection, crossing approaches are interlocked and cannot hold ` +
        `green at the same moment, so these recollections cannot all be accurate. ` +
        `BlackBox does not determine which account is mistaken — memory of signal state is ` +
        `commonly inaccurate under stress, and an honest witness can be wrong.`,
      claimIds: [...byDriver.values()].map((c) => c.id),
      witnessIds: drivers,
      suppressTopics: ["traffic_light.color"],
      resolvingEvidence: [
        "Signal controller phase log for the intersection at the time of the incident",
        "Traffic or transit camera footage covering the approaches",
        "Nearby business CCTV with a view of either signal head",
        `Any municipal signal-timing record for ${incident.location || "the intersection"}`,
      ],
      followUpQuestion:
        "Which signal head were you looking at, and what colour was it at the moment your " +
        "front wheels crossed the stop line?",
    },
  ];
}

/**
 * A single person giving two different values for the same exclusive attribute
 * — "it was yellow, actually it might have been red". This is uncertainty made
 * visible, not dishonesty, and it is reported as such.
 */
function internallyInconsistent(
  claims: Claim[],
  nameOf: (id: string) => string,
): JointImpossibility[] {
  const byWitnessTopic = new Map<string, Claim[]>();
  for (const c of claims) {
    if (c.category !== "attribute" || !EXCLUSIVE_PREDICATES.has(c.predicate)) continue;
    const key = `${c.witnessId}|${c.subject}|${c.predicate}`;
    const list = byWitnessTopic.get(key);
    if (list) list.push(c);
    else byWitnessTopic.set(key, [c]);
  }

  const out: JointImpossibility[] = [];
  for (const [key, group] of byWitnessTopic) {
    const values = [...new Set(group.map((c) => c.object))];
    if (values.length < 2) continue;

    const [witnessId, subject, predicate] = key.split("|");
    const thing = entityLabel(subject).toLowerCase();
    out.push({
      id: newId(),
      rule: "internally_inconsistent",
      title: `${nameOf(witnessId)} gave two different values for the ${thing} ${predicate}`,
      explanation:
        `Within one statement, ${nameOf(witnessId)} described the ${thing} ${predicate} as ` +
        `${values.join(" and then as ")}. The account is internally inconsistent on this point. ` +
        `This is recorded as expressed uncertainty, not as a discrepancy to be held against them.`,
      claimIds: group.map((c) => c.id),
      witnessIds: [witnessId],
      // Their own uncertainty should not be counted as corroborating anyone.
      suppressTopics: [`${subject}.${predicate}`],
      resolvingEvidence: [
        "An independent recording or log covering the same moment",
        "A second witness with an unobstructed view of the same detail",
      ],
      followUpQuestion:
        `Thinking back to that moment, how confident are you about the ${thing} ${predicate}, ` +
        `and is there anything that helps you place it?`,
    });
  }
  return out;
}
