// Seeds and resets the demo case.

import { store } from "../store.ts";
import {
  BB204_CASE,
  BB204_EVIDENCE,
  BB204_PARTICIPANTS,
} from "./bb204.ts";
import type { Incident } from "../types.ts";

/** Wipes everything and lays down a clean BB-204, ready to reconstruct. */
export function seedDemoCase(): Incident {
  store.reset();
  const incident = store.createIncident(BB204_CASE);

  for (const p of BB204_PARTICIPANTS) {
    store.addWitness(incident.id, p.displayName, p.phoneNumber, p.role, p.descriptor, p.approach);
  }
  for (const e of BB204_EVIDENCE) {
    store.addEvidence(e, incident.id);
  }

  store.logAction({
    incidentId: incident.id,
    agent: "orchestrator",
    summary: `Case ${incident.referenceId} opened`,
    detail:
      `${BB204_PARTICIPANTS.length} participants and ${BB204_EVIDENCE.length} evidence items ` +
      `on file. Ready to reconstruct.`,
    status: "done",
    via: null,
  });

  return incident;
}

/** Any call path needs a case to attach to. */
export function ensureCase(): Incident {
  return store.getIncident() ?? seedDemoCase();
}
