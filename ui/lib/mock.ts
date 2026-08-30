// Preview data — shown ONLY when no interview has been recorded yet, and always
// badged "PREVIEW" in the UI. The moment a real call lands, this is replaced by
// reconciled data from the backend. Never used to dress up a live demo.

import type { AppState, Claim, Finding, TimelineEvent } from "./types";

const INC = "inc_preview";

function claim(
  id: string,
  witnessId: string,
  category: string,
  subject: string,
  predicate: string,
  object: string,
  displayObject: string,
  sourceExcerpt: string,
  certainty: Claim["certainty"] = "high",
): Claim {
  return {
    id,
    incidentId: INC,
    witnessId,
    category,
    subject,
    predicate,
    object,
    displayObject,
    normalizedTime: null,
    certainty,
    sourceExcerpt,
    sourceField: null,
  };
}

const claims: Claim[] = [
  // Truck arrival
  claim("c1", "w_a", "presence", "truck_arrival", "observed", "present", "Truck arrives", "The truck pulled into the dock just before it all started."),
  claim("c2", "w_b", "presence", "truck_arrival", "observed", "present", "Truck arrives", "A delivery truck had just backed in."),
  claim("c3", "w_c", "presence", "truck_arrival", "observed", "present", "Truck arrives", "I came from the other bay, I think a truck was there.", "medium"),

  // Forklift movement
  claim("c4", "w_a", "presence", "collision", "observed", "present", "Forklift movement", "The forklift came out of the warehouse and swung round."),
  claim("c5", "w_b", "presence", "collision", "observed", "present", "Forklift movement", "I was driving the forklift out toward bay seven."),
  claim("c6", "w_c", "presence", "collision", "observed", "present", "Forklift movement", "I only caught the tail end of it.", "low"),

  // Alarm — the disputed one
  claim("c7", "w_a", "temporal_order", "alarm", "before", "collision", "Alarm → impact", "I heard the alarm go off—high pitched—then the whole rack came down."),
  claim("c8", "w_c", "temporal_order", "alarm", "before", "collision", "Alarm → impact", "The alarm was already going when I got there, I'm fairly sure.", "medium"),
  claim("c9", "w_b", "temporal_order", "collision", "before", "alarm", "Impact → alarm", "The crash happened, then a second later the alarm went off.", "medium"),

  // Rack collapse
  claim("c10", "w_a", "presence", "rack_collapse", "observed", "present", "Rack collapse", "The rack came down across the aisle."),
  claim("c11", "w_b", "presence", "rack_collapse", "observed", "present", "Rack collapse", "I felt it go and saw the uprights buckle."),
  claim("c12", "w_c", "presence", "rack_collapse", "observed", "present", "Rack collapse", "I heard the crash from the next bay over.", "medium"),

  // Injury
  claim("c13", "w_a", "presence", "injury", "observed", "present", "Injured worker", "There was someone on the ground by the pallets."),
  claim("c14", "w_b", "presence", "injury", "observed", "present", "Injured worker", "I saw a worker down and stopped the machine."),

  // Radio
  claim("c15", "w_a", "presence", "radio", "observed", "present", "Radio call", "I called it in on channel two straight away."),
  claim("c16", "w_b", "presence", "radio", "observed", "present", "Radio call", "I got on the radio for help."),
  claim("c17", "w_c", "presence", "radio", "observed", "present", "Radio call", "I heard the radio call come through.", "medium"),
];

const timeline: TimelineEvent[] = [
  ev("t1", "truck_arrival", "Truck arrives at loading dock", "09:54:20", ["w_a", "w_b"], "corroborated", ["c1", "c2", "c3"], 0),
  ev("t2", "collision", "Forklift exits warehouse", "09:54:45", ["w_a", "w_b"], "corroborated", ["c4", "c5", "c6"], 1),
  ev("t3", "alarm", "Alarm sounds", "09:55:10", ["w_a", "w_b", "w_c"], "disputed", ["c7", "c8", "c9"], 2),
  ev("t4", "rack_collapse", "Storage rack collapses", "09:55:40", ["w_a", "w_b"], "corroborated", ["c10", "c11", "c12"], 3),
  ev("t5", "injury", "Injured worker on ground", "09:56:15", ["w_a", "w_b"], "corroborated", ["c13", "c14"], 4),
  ev("t6", "radio", "Radio call for assistance", "09:56:50", ["w_a", "w_b"], "corroborated", ["c15", "c16", "c17"], 5),
];

function ev(
  id: string,
  eventKey: string,
  label: string,
  approximateTime: string,
  supportingWitnessIds: string[],
  confidence: TimelineEvent["confidence"],
  sourceClaimIds: string[],
  rank: number,
): TimelineEvent {
  return { id, incidentId: INC, label, eventKey, approximateTime, supportingWitnessIds, confidence, sourceClaimIds, rank };
}

const findings: Finding[] = [
  {
    id: "f1",
    incidentId: INC,
    type: "contradiction",
    title: "Disputed sequence: Alarm sounds vs Forklift impact",
    explanation:
      "Witness A and Witness C placed the alarm before the impact. Witness B placed them in the opposite order. Both accounts are recorded as given; neither is treated as correct.",
    involvedWitnessIds: ["w_a", "w_c", "w_b"],
    sourceClaimIds: ["c7", "c8", "c9"],
    followUpQuestion: "Did the alarm begin before or after the rack collapsed?",
  },
  agree("f2", "Truck arrival at the loading dock", ["w_a", "w_b"], ["c1", "c2"]),
  agree("f3", "Forklift movement out of the warehouse", ["w_a", "w_b"], ["c4", "c5"]),
  agree("f4", "Storage rack collapses", ["w_a", "w_b"], ["c10", "c11"]),
  agree("f5", "Injured worker on the ground", ["w_a", "w_b"], ["c13", "c14"]),
  agree("f6", "Radio call for assistance", ["w_a", "w_b"], ["c15", "c16"]),
  uniq("f7", "Witness C arrived from another bay", "w_c", ["c3"]),
  uniq("f8", "Witness C heard the crash rather than seeing it", "w_c", ["c12"]),
  {
    id: "f9",
    incidentId: INC,
    type: "open_question",
    title: "Did the alarm begin before or after the rack collapsed?",
    explanation: "Generated from an unresolved conflict: disputed alarm sequence.",
    involvedWitnessIds: ["w_a", "w_b", "w_c"],
    sourceClaimIds: ["c7", "c9"],
  },
  {
    id: "f10",
    incidentId: INC,
    type: "open_question",
    title: "Was anyone else in the aisle when the rack came down?",
    explanation: "Not established by any completed interview.",
    involvedWitnessIds: ["w_a", "w_b"],
    sourceClaimIds: ["c13"],
  },
];

function agree(id: string, title: string, ws: string[], cs: string[]): Finding {
  return {
    id,
    incidentId: INC,
    type: "agreement",
    title,
    explanation: "Reported independently by two witnesses. Corroborated, not verified.",
    involvedWitnessIds: ws,
    sourceClaimIds: cs,
  };
}

function uniq(id: string, title: string, w: string, cs: string[]): Finding {
  return {
    id,
    incidentId: INC,
    type: "unique_claim",
    title,
    explanation:
      "Reported by one witness only. Absence of corroboration is not evidence of inaccuracy.",
    involvedWitnessIds: [w],
    sourceClaimIds: cs,
  };
}

export const MOCK_STATE: AppState = {
  incident: {
    id: INC,
    title: "Loading Dock Collision",
    type: "Industrial / warehouse safety",
    location: "Northview Warehouse · Bay 7B",
    approximateTime: "09:55 AM",
    description: "A forklift collided with a storage rack, causing part of the rack to collapse.",
    status: "active",
    createdAt: new Date().toISOString(),
    referenceId: "PD-2026-4471",
    openedBy: "Northview PD · Traffic & Safety",
    knownContext: "",
  },
  witnesses: [
    wit("w_a", "Witness A", "Dock Supervisor", "live"),
    wit("w_b", "Witness B", "Forklift Operator", "live"),
    wit("w_c", "Witness C", "Maintenance Tech", "completed"),
  ],
  interviews: [],
  claims,
  findings,
  timeline,
  reconciliation: { status: "ready", lastRunAt: new Date().toISOString(), error: null, engine: "preview" },
  guava: { ready: false, error: null, agentNumber: null, inbound: false },
};

function wit(id: string, displayName: string, role: string, callStatus: "live" | "completed") {
  return {
    id,
    incidentId: INC,
    displayName,
    role,
    phoneMasked: "+1 (•••) •••-••47",
    hasPhone: true,
    callStatus,
    consentStatus: "granted" as const,
    interviewStartedAt: new Date().toISOString(),
    interviewCompletedAt: callStatus === "completed" ? new Date().toISOString() : null,
    lastError: null,
  };
}
