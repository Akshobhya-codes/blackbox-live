# BLACKBOX

**Every witness has a piece. BlackBox builds the timeline.**

BlackBox independently interviews witnesses by phone, reconstructs what happened, and
exposes agreements, contradictions, and unanswered questions in an auditable incident
timeline.

Built on **Guava** — the hosted Dialog System runs the conversation; the BlackBox Expert
owns incident state, required fields, provenance, and reconciliation.

---

## Run it

```bash
npm install
cp .env.example .env   # add GUAVA_API_KEY, GUAVA_AGENT_NUMBER, OPENAI_API_KEY
npm run dev            # builds the UI, watches it, and runs the API + Guava Expert
```

Open **http://localhost:3000**.

`npm start` does the same without file watching (it builds the UI first, then serves).
`guava login` works instead of `GUAVA_API_KEY` — the SDK falls back to CLI credentials.

To take real calls, set a number you own and restart:

```bash
guava numbers buy    # or: https://app.goguava.ai/dashboard/phone-numbers
# put it in .env as GUAVA_AGENT_NUMBER=+1...
```

## Test without a phone

```bash
npm run selftest     # reconciliation engine vs. the demo scenario (13 checks)
npm run chat         # type as a witness in the terminal — drives the real Expert
npm run roleplay     # an LLM plays the witness end to end (add `-- --b` for Witness B)
```

All of these write to the same store, so the dashboard updates exactly as on a real call.
The **Text Dry-Run** button does the same from the browser; anything recorded that way is
labelled `SIMULATED` in the UI.

---

## Demo script

1. **Create Demo Incident** — "Loading Dock Collision", Warehouse 14, Dock B, ~8:12 PM.
2. **Add Witness** ×2 with real phone numbers (masked everywhere on the dashboard).
3. **Call Witness** — or have them dial the BlackBox number. Each interview is independent;
   the agent never repeats what another witness said.
4. Watch witness state go `queued → ringing → live → completed`.
5. After the second interview, the dashboard shows:
   - **Contradictions** — disputed alarm/collapse ordering; forklift colour blue vs yellow
   - **Agreements** — forklift involved, rack collapsed, loading dock, ~8:12 PM
   - **Unique claims** — chemical smell (one witness); explicitly no smoke (the other)
   - **Open questions** — neutral follow-ups generated from each conflict
6. **Show sources** on any finding → the verbatim excerpt that produced it.

---

## Architecture

```
Guava Dialog System  ──ws──►  BlackBox Expert (src/agent.ts)
                                    │  speech events, task fields
                                    ▼
                              store (src/store.ts)
                                    │
                    extract.ts ─► reconcile.ts
                                    │
                       Express API + SSE (src/server.ts)
                                    ▼
                              dashboard (public/)
```

| File | Role |
|---|---|
| `src/agent.ts` | Guava Expert: interview task, fields, consent, transcript capture |
| `src/lexicon.ts` | Domain vocabulary — entities, events, markers (data, not logic) |
| `src/extract.ts` | Account → normalized, source-linked claims |
| `src/reconcile.ts` | Claims → agreements, contradictions, unique claims, questions, timeline |
| `src/store.ts` | In-memory state + JSON snapshot, no native deps |
| `src/server.ts` | API, SSE, static host; loads Guava lazily so a missing key never blocks the UI |

## How reconciliation works

**Two engines run on every interview and their results are merged.**

1. **Rules engine** (`extract.ts` + `reconcile.ts`) — instant, deterministic, exhaustive on
   vocabulary it knows. Puts findings on screen the moment a call ends.
2. **OpenAI analyst** (`llm.ts`) — `gpt-4o` with structured JSON output, generalises to messy
   real speech no lexicon anticipates.

Everything the model returns is validated before it is shown:

- parsed against a strict JSON schema, then a Zod schema
- witness ids must be real; claim references must resolve
- **every cited excerpt must actually appear in that witness's transcript** — ungrounded
  quotes are dropped, so the model cannot invent evidence
- a contradiction with no follow-up question is rejected

If the model is slow, unavailable, or returns anything untrustworthy, the deterministic result
simply stands. The dashboard shows which engines produced the current findings
(`openai:gpt-4o + rules`, or `deterministic`).

The rules engine works like this — nothing hardcoded for the demo:

- **Event order** from narrative markers ("first", "and then", "a few seconds later") and
  explicit cues ("the alarm went off *after* the rack fell"). Reversed orderings across two
  witnesses = contradiction.
- **Attributes** (colour, direction) bound to the nearest entity in the clause. Different
  values on an exclusive attribute = contradiction.
- **Presence vs. absence** — "I saw no smoke" is recorded as an explicit absence claim.
  Silence from another witness is *not* a contradiction; it is an uncorroborated claim.
- **Times** normalized to minutes; ≤5 min apart agrees, >15 min conflicts, in between is
  flagged as estimation uncertainty rather than a conflict.

Every finding links back to the claim and the verbatim excerpt that produced it.

## Design position

BlackBox is an **investigator support system, not a truth machine.** It never asserts who is
lying or what objectively happened. Agreements are labelled *corroborated, not verified*.
Contradictions record both accounts as given. Absence of corroboration is explicitly stated
not to be evidence of inaccuracy.
