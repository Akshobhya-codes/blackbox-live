// Regression test for the seeded BB-204 case.
//
// Runs the real extraction and reconciliation pipeline over the demo statements
// and asserts the findings an investigator should see. No network, no LLM — if
// this passes, the core demo is sound even with every integration offline.

import { extractClaims } from "./extract.ts";
import { reconcile } from "./reconcile.ts";
import { BB204_CASE, BB204_PARTICIPANTS } from "./cases/bb204.ts";
import type { Claim, Incident, Interview, Witness } from "./types.ts";

const incident: Incident = {
  id: "inc_bb204",
  status: "open",
  createdAt: new Date().toISOString(),
  ...BB204_CASE,
};

const witnesses: Witness[] = BB204_PARTICIPANTS.map((p, i) => ({
  id: `wit_${i}`,
  incidentId: incident.id,
  displayName: p.displayName,
  phoneNumber: p.phoneNumber,
  callStatus: "completed",
  consentStatus: "granted",
  interviewStartedAt: new Date().toISOString(),
  interviewCompletedAt: new Date().toISOString(),
  lastError: null,
  role: p.role,
  descriptor: p.descriptor,
  approach: p.approach,
}));

const claims: Claim[] = [];
witnesses.forEach((w, i) => {
  const interview: Interview = {
    id: `int_${i}`,
    witnessId: w.id,
    incidentId: incident.id,
    callId: `call_${i}`,
    transcript: BB204_PARTICIPANTS[i].statement.map((text) => ({
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
  claims.push(...extractClaims(interview, incident, w.id));
});

const { findings, timeline } = reconcile(claims, witnesses, incident);
const byType = (t: string) => findings.filter((f) => f.type === t);
const has = (t: string, re: RegExp) => byType(t).some((f) => re.test(f.title));
const nameOf = (id: string) => witnesses.find((w) => w.id === id)?.displayName ?? id;

for (const type of ["contradiction", "agreement", "unique_claim", "open_question"] as const) {
  const list = byType(type);
  console.log(`\n=== ${type.toUpperCase().replace("_", " ")} (${list.length}) ===`);
  for (const f of list) {
    console.log(`  • ${f.title}`);
    if (type === "contradiction") {
      console.log(`      involving: ${f.involvedWitnessIds.map(nameOf).join(", ")}`);
    }
  }
}

console.log(`\n=== TIMELINE (${timeline.length}) ===`);
for (const e of timeline) {
  console.log(`  ${e.rank}. ${e.label.padEnd(28)} [${e.confidence}]`);
}

const checks: { name: string; ok: boolean }[] = [
  {
    name: "HEADLINE: 'These accounts cannot all be true' (both drivers green)",
    ok: has("contradiction", /cannot all be true/i),
  },
  {
    name: "joint rule names both drivers, not the pedestrian",
    ok: (() => {
      const f = byType("contradiction").find((x) => /cannot all be true/i.test(x.title));
      if (!f) return false;
      const names = f.involvedWitnessIds.map(nameOf);
      return (
        names.includes("Maya Chen") &&
        names.includes("Ethan Brooks") &&
        !names.includes("Daniel Ortiz")
      );
    })(),
  },
  {
    name: "green light is NOT reported as an agreement",
    ok: !byType("agreement").some((f) => /green/i.test(f.title)),
  },
  {
    name: "internally inconsistent: Daniel's yellow vs red",
    ok: has("contradiction", /two different values/i),
  },
  { name: "horn presence disputed (Maya vs the others)", ok: has("contradiction", /horn/i) },
  { name: "agreement: Tesla colour corroborated", ok: has("agreement", /tesla.*black|black.*tesla/i) },
  { name: "agreement: Honda colour corroborated", ok: has("agreement", /honda.*white|white.*honda/i) },
  { name: "agreement: collision corroborated", ok: has("agreement", /collision|impact/i) },
  {
    name: "time spread treated as uncertainty, not contradiction",
    ok: has("open_question", /estimation uncertainty/i) && !has("contradiction", /times differ/i),
  },
  { name: "timeline has at least 3 events", ok: timeline.length >= 3 },
  {
    name: "every non-question finding cites source claims",
    ok: findings
      .filter((f) => f.type !== "open_question")
      .every((f) => f.sourceClaimIds.length > 0),
  },
  {
    name: "no finding accuses anyone of lying",
    ok: !findings.some((f) =>
      /\b(lying|lied|liar|deceptive|dishonest|fabricat)/i.test(`${f.title} ${f.explanation}`),
    ),
  },
];

console.log("\n=== CHECKS ===");
let failed = 0;
for (const c of checks) {
  console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name}`);
  if (!c.ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} passed   (${claims.length} claims)\n`);
process.exit(failed === 0 ? 0 : 1);
