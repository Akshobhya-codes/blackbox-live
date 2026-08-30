// The rehearsed demo incident, plus the text-mode fallback used to dry-run the
// dashboard without burning a phone call.

import { store } from "./store.ts";
import type { Incident, Interview } from "./types.ts";

export const DEMO_INCIDENT = {
  title: "Loading Dock Collision",
  type: "Workplace safety incident",
  location: "Warehouse 14, Loading Dock B",
  approximateTime: "8:12 PM",
  description:
    "A forklift collided with a storage rack, causing part of the rack to collapse and " +
    "triggering an alarm. Witnesses are being interviewed independently.",
  referenceId: "WS-2026-0829",
  openedBy: "Site Safety Office",
  knownContext:
    "Automated alarm log records an activation at 20:12. Forklift unit 7 was signed out to " +
    "the evening shift. No injuries reported to the site nurse. Rack section B4 is confirmed " +
    "damaged. The order of events and the vehicle involved are not established.",
};

/** Every call path needs an incident to attach to; create one on demand. */
export function ensureIncident(): Incident {
  return store.getIncident() ?? store.createIncident(DEMO_INCIDENT);
}

export function createDemoIncident(): Incident {
  store.reset();
  return store.createIncident(DEMO_INCIDENT);
}

/**
 * Records a witness account supplied as text rather than speech.
 *
 * This exists so the dashboard can be rehearsed and debugged without a phone
 * line. Interviews created this way are flagged `simulated` and the UI labels
 * them as such — they are never presented as real calls.
 */
export function simulateInterview(
  displayName: string,
  utterances: string[],
  followUp = false,
): { witnessId: string; interviewId: string } {
  const incident = ensureIncident();
  // Reuse the roster entry if this name is already expected on the case,
  // rather than creating a second copy of the same person.
  const existing = store
    .getState()
    .witnesses.find(
      (w) => w.displayName.trim().toLowerCase() === displayName.trim().toLowerCase(),
    );
  const witness = existing ?? store.addWitness(incident.id, displayName, "");
  const callId = `sim_${crypto.randomUUID().slice(0, 8)}`;
  // A follow-up adds to the statement on file instead of replacing it.
  const interview = followUp
    ? store.startFollowUp(witness.id, callId)
    : store.startInterview(witness.id, callId);

  for (const text of utterances) {
    if (!text.trim()) continue;
    store.appendTurn(interview.id, {
      speaker: "witness",
      text: text.trim(),
      at: new Date().toISOString(),
    });
  }

  store.setInterviewFields(interview.id, {
    witness_name: displayName,
    consent_confirmed: "yes",
    summary_confirmed: "accurate",
    simulated: true,
  });
  store.completeInterview(interview.id, {
    completionStatus: "completed",
    summaryConfirmed: true,
    structuredSummary: interview.transcript
      .filter((t) => t.speaker === "witness")
      .map((t) => t.text)
      .join(" "),
    terminationReason: "simulated",
  });
  store.updateWitness(witness.id, { consentStatus: "granted" });

  return { witnessId: witness.id, interviewId: interview.id };
}

/** Splits a pasted account into sentence-sized utterances. */
export function splitAccount(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isSimulated(interview: Interview): boolean {
  return interview.fields.simulated === true;
}
