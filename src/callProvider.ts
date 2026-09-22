// Voice provider abstraction.
//
// Interviews are conducted by whichever provider is configured. The demo
// simulator is not a lesser path — it drives the same interview script, the
// same state transitions and the same downstream pipeline as a real call, so
// what a judge watches is the real system with the audio layer swapped out.
//
// Guava is wired in because the existing agent in this repo already implements
// the interview: consent, an open-ended first question, neutral follow-ups, and
// a read-back. When credentials are present, calls are placed for real.

import { BB204_PARTICIPANTS } from "./cases/bb204.ts";

export type ProviderKind = "demo" | "guava";

export function activeProvider(): ProviderKind {
  // Live by default. A configured Guava number means real calls; the
  // simulator is only for running without a phone line, and has to be asked
  // for explicitly with DEMO_MODE=true.
  const forced = (process.env.DEMO_MODE ?? "false").toLowerCase() === "true";
  if (forced) return "demo";
  return process.env.GUAVA_AGENT_NUMBER?.trim() ? "guava" : "demo";
}

export function providerDetail(): string {
  switch (activeProvider()) {
    case "guava":
      return `Guava voice agent on ${process.env.GUAVA_AGENT_NUMBER}`;
    default:
      return "Deterministic call simulator (DEMO_MODE)";
  }
}

/**
 * The interview an agent conducts. Kept here rather than in the simulator so
 * the real and simulated paths cannot drift apart.
 */
export const INTERVIEW_PROTOCOL = {
  disclosure:
    "This is an automated AI interviewer from BlackBox. I am collecting a recorded " +
    "statement for an incident investigation. I am not a human investigator and I " +
    "cannot give advice.",
  consent: "Do I have your consent to record this interview?",
  opening: "Please describe, in your own words, what you saw and heard.",
  neutralFollowUps: [
    "Where were you when you first noticed something?",
    "What happened immediately before that?",
    "What happened next?",
    "What did you personally see or hear, as opposed to what you worked out afterwards?",
    "Which parts are you certain about, and which are estimates?",
    "Was anyone injured or in immediate danger?",
    "Is there anything important I did not ask about?",
  ],
  /** Read back, then record whether they confirmed or corrected it. */
  readBack:
    "Let me read back the key points so you can correct anything I have wrong.",
} as const;

/**
 * The deterministic statement for a seeded participant.
 *
 * Only used by the simulator. A live call returns whatever the person actually
 * says; nothing here is ever attributed to a real caller.
 */
export function seedStatementFor(displayName: string): string[] {
  const match = BB204_PARTICIPANTS.find(
    (p) => p.displayName.toLowerCase() === displayName.trim().toLowerCase(),
  );
  if (match) return match.statement;

  // An unseeded participant still gets a plausible, clearly generic account so
  // an investigator-created case does not dead-end mid-demo.
  return [
    "I was nearby when it happened.",
    "I heard the impact and looked over straight away.",
    "I did not have a clear view of the signal.",
    "I could not say how fast either vehicle was going.",
  ];
}

export interface PlacedCall {
  ok: boolean;
  provider: ProviderKind;
  detail: string;
}

/**
 * Places a real outbound call when a live provider is configured.
 *
 * In demo mode this deliberately does nothing and says so — the simulator owns
 * the interview instead. Loading the Guava agent is dynamic because the SDK
 * throws at construction without credentials.
 */
export async function placeCall(witnessId: string): Promise<PlacedCall> {
  const provider = activeProvider();
  if (provider === "demo") {
    return {
      ok: false,
      provider,
      detail:
        "DEMO_MODE is on, so no real call was placed. Set DEMO_MODE=false with a " +
        "GUAVA_AGENT_NUMBER to dial for real.",
    };
  }

  try {
    const agent = await import("./agent.ts");
    await agent.placeOutboundCall(witnessId);
    return { ok: true, provider: "guava", detail: "Outbound call placed via Guava." };
  } catch (err) {
    return { ok: false, provider: "guava", detail: (err as Error).message };
  }
}
