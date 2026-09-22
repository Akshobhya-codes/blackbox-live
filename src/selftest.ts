// Proves the reconciliation engine works on the demo scenario without any phone
// call, database, or network. Run with: npm run selftest
//
// These transcripts stand in for what the voice agent captures. Nothing here is
// wired into the dashboard — the live app always reconciles real interview data.

import { extractClaims } from "./extract.ts";
import { reconcile } from "./reconcile.ts";
import type { Claim, Incident, Interview, Witness } from "./types.ts";

const incident: Incident = {
  id: "inc_test",
  title: "Loading Dock Collision",
  type: "Industrial / warehouse safety",
  location: "Warehouse 14, Loading Dock B",
  approximateTime: "8:12 PM",
  description: "A forklift collided with a storage rack, causing part of the rack to collapse.",
  status: "open",
  createdAt: new Date().toISOString(),
  referenceId: "WS-2026-0829",
  openedBy: "Site Safety Office",
  knownContext: "Alarm log records an activation at 20:12. Rack section B4 confirmed damaged.",
};

const witnessA: Witness = mkWitness("wit_a", "Witness A");
const witnessB: Witness = mkWitness("wit_b", "Witness B");

function mkWitness(id: string, displayName: string): Witness {
  return {
    id,
    incidentId: incident.id,
    displayName,
    phoneNumber: "+15550000000",
    callStatus: "completed",
    consentStatus: "granted",
    interviewStartedAt: new Date().toISOString(),
    interviewCompletedAt: new Date().toISOString(),
    lastError: null,
    role: "witness",
    descriptor: "",
  };
}

function mkInterview(witnessId: string, utterances: string[]): Interview {
  return {
    id: `int_${witnessId}`,
    witnessId,
    incidentId: incident.id,
    callId: `call_${witnessId}`,
    transcript: utterances.map((text) => ({
      speaker: "witness" as const,
      text,
      at: new Date().toISOString(),
    })),
    fields: {},
    structuredSummary: "",
    completionStatus: "completed",
    summaryConfirmed: true,
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    terminationReason: "bot-hangup",
  };
}

const interviewA = mkInterview("wit_a", [
  "I was near Loading Dock B.",
  "I saw a blue forklift reverse into the rack.",
  "The rack started falling, and then the alarm went off.",
  "I think it happened around 8:12.",
  "I did not see any smoke.",
]);

const interviewB = mkInterview("wit_b", [
  "I heard the alarm first.",
  "Then I looked over and saw the rack falling near the loading dock.",
  "The forklift looked yellow to me.",
  "A few seconds later I noticed a chemical smell.",
]);

const claims: Claim[] = [
  ...extractClaims(interviewA, incident, witnessA.id),
  ...extractClaims(interviewB, incident, witnessB.id),
];

const { findings, timeline } = reconcile(claims, [witnessA, witnessB], incident);

// ---------------------------------------------------------------- reporting
const byType = (t: string) => findings.filter((f) => f.type === t);

console.log(`\n=== CLAIMS EXTRACTED: ${claims.length} ===`);
for (const c of claims) {
  const who = c.witnessId === "wit_a" ? "A" : "B";
  console.log(
    `  [${who}] ${c.category.padEnd(15)} ${c.subject}.${c.predicate} = ${c.object}  (${c.certainty})`,
  );
}

for (const type of ["agreement", "contradiction", "unique_claim", "open_question"] as const) {
  const list = byType(type);
  console.log(`\n=== ${type.toUpperCase().replace("_", " ")} (${list.length}) ===`);
  for (const f of list) {
    console.log(`  • ${f.title}`);
    if (f.type !== "open_question") console.log(`      ${f.explanation}`);
  }
}

console.log(`\n=== TIMELINE (${timeline.length}) ===`);
for (const e of timeline) {
  console.log(
    `  ${e.rank}. ${e.label.padEnd(30)} [${e.confidence}] sources=${e.supportingWitnessIds.length}${e.approximateTime ? ` @ ${e.approximateTime}` : ""}`,
  );
}

// ------------------------------------------------------------------ asserts
interface Check {
  name: string;
  ok: boolean;
}
const has = (t: string, re: RegExp) => byType(t).some((f) => re.test(f.title));

const checks: Check[] = [
  { name: "contradiction: alarm vs rack collapse ordering", ok: has("contradiction", /Disputed sequence.*(Alarm|rack)/i) },
  { name: "contradiction: forklift colour blue vs yellow", ok: has("contradiction", /Conflicting color.*Forklift/i) },
  { name: "agreement: forklift involved", ok: has("agreement", /Forklift involved/i) },
  { name: "agreement: storage rack involved", ok: has("agreement", /Storage rack involved/i) },
  { name: "agreement: rack collapse corroborated", ok: has("agreement", /rack collapses/i) },
  { name: "agreement: loading dock location", ok: has("agreement", /Loading Dock/i) },
  { name: "unique: chemical smell (B only)", ok: has("unique_claim", /chemical smell/i) },
  { name: "unique: explicitly no smoke (A only)", ok: has("unique_claim", /not observing smoke|no smoke/i) },
  { name: "open question: alarm before/after ordering", ok: has("open_question", /before or after/i) },
  { name: "open question: lighting / colour", ok: has("open_question", /lighting conditions/i) },
  { name: "no false contradiction on smoke", ok: !has("contradiction", /smoke/i) },
  { name: "timeline built from observed events", ok: timeline.length >= 3 },
  { name: "every finding carries source claims", ok: findings.filter((f) => f.type !== "open_question").every((f) => f.sourceClaimIds.length > 0) },
];

console.log("\n=== CHECKS ===");
let failed = 0;
for (const c of checks) {
  console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name}`);
  if (!c.ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
process.exit(failed === 0 ? 0 : 1);
