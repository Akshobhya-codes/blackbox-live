// Test the interview without a phone line.
//
//   npm run chat      — type as the witness in the terminal
//   npm run roleplay  — an LLM plays the witness end to end
//   npm run webrtc    — browser mic session via the Guava debug page
//
// All three drive the same Expert and write to the same store, so the dashboard
// updates exactly as it does on a real call.

import "dotenv/config";
import { agent, runReconciliationSafely } from "./agent.ts";

const args = process.argv.slice(2);

const ROLEPLAY_WITNESS_A =
  "You are a warehouse worker giving a witness statement about an incident you saw. " +
  "Keep answers short and natural, one or two sentences. Your account: you were near " +
  "Loading Dock B, you saw a blue forklift reverse into the storage rack, the rack " +
  "started falling and then the alarm went off, it was around 8:12 PM, and you did not " +
  "see any smoke. Nobody appeared to be injured. Do not volunteer details you were not asked for.";

const ROLEPLAY_WITNESS_B =
  "You are a warehouse worker giving a witness statement about an incident you saw. " +
  "Keep answers short and natural, one or two sentences. Your account: you heard the alarm " +
  "first, then you looked over and saw the rack falling near the loading dock, the forklift " +
  "looked yellow to you, and a few seconds later you noticed a chemical smell. You are not " +
  "sure about the exact time. Do not volunteer details you were not asked for.";

async function main() {
  if (args.includes("--chat")) {
    console.log("Starting terminal interview. Answer as a witness. Ctrl+C to quit.\n");
    await agent.chat();
    runReconciliationSafely();
    return;
  }

  if (args.includes("--roleplay")) {
    const which = args.includes("--b") ? ROLEPLAY_WITNESS_B : ROLEPLAY_WITNESS_A;
    console.log(`Running automated roleplay as Witness ${args.includes("--b") ? "B" : "A"}…\n`);
    const session = await agent.roleplay(which);
    console.log("\n--- TRANSCRIPT ---");
    console.log(await session.getTranscript());
    runReconciliationSafely();
    return;
  }

  if (args.includes("--webrtc")) {
    console.log("Opening a WebRTC session — use https://app.goguava.ai/debug-webrtc\n");
    await agent.listenWebrtc();
    return;
  }

  console.log("Usage: npm run chat | npm run roleplay [-- --b] | npm run webrtc");
  process.exit(1);
}

main().catch((err) => {
  console.error("\n[agent-cli] failed:", err instanceof Error ? err.message : err);
  console.error("If this is an auth error, run `guava login` or set GUAVA_API_KEY.\n");
  process.exit(1);
});
