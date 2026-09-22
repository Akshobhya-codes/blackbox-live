# BlackBox

**Autonomous incident reconstruction.** BlackBox interviews everyone involved in an incident,
reconciles their accounts against each other and against the public record, and builds a
source-traceable timeline showing what agrees, what conflicts, and what to do next.

It does not decide who is at fault, and it never treats an inconsistent recollection as a
dishonest one. It shows investigators exactly where the truth still needs to be found.

---

## Run it

```bash
npm install
npm start          # builds the UI, serves the dashboard + API on :3000
```

Open **http://localhost:3000** and press **Launch Reconstruction**. That is the whole demo —
it runs in about 50 seconds with no credentials at all.

To enable the Python sponsor integrations (Cognee + Strands):

```bash
python -m venv brain/.venv
brain\.venv\Scripts\pip install -r brain/requirements.txt   # Windows
# brain/.venv/bin/pip install -r brain/requirements.txt     # macOS / Linux
npm run brain                                               # separate terminal
```

Or run everything together:

```bash
npm run dev        # UI watch + API + brain service
```

Copy `.env.example` to `.env` for keys. **Every one is optional.**

---

## What the demo does

Case **BB-204 — Harrison & 4th Collision**, seeded on boot. Four participants:

| | Role | Account |
|---|---|---|
| Maya Chen | Driver, black Tesla, northbound | had a green light, heard no horn |
| Ethan Brooks | Driver, white Honda, westbound | also had a green light, sounded his horn |
| Daniel Ortiz | Pedestrian, SE corner | signal was yellow — *or maybe red* |
| Priya Shah | Employee, cafe | heard the horn first, could not see the signal |

Press **Launch Reconstruction** and the interface comes alive: participant cards move through
dialing → ringing → interviewing → processing → complete, transcripts stream in, claims appear
as bubbles on the timeline, matching claims cluster, and contradictions link with a red arc.

The payoff lands on the Contradictions tab:

> ### These accounts cannot all be true.

Both drivers remember a green light. Individually each statement is unremarkable — and a naive
comparison calls it *agreement*, because both literally said "green". Only the interlock of a
signalled intersection makes the pair impossible. BlackBox states that the set cannot all hold,
names both drivers, cites their exact words, and stops there. It does not pick one.

---

## How it decides things

Two engines run on every reconstruction and their results are merged.

**1. Rules engine** (`src/extract.ts`, `src/reconcile.ts`, `src/jointRules.ts`) — deterministic,
instant, and the source of truth on vocabulary it knows. It extracts claims from what each
person actually said, keeping the exact words behind every one.

**2. OpenAI analyst** (`src/llm.ts`) — `gpt-4o` with structured JSON output, for the messy real
speech no lexicon anticipates.

Where they disagree, the rules engine wins on questions it was designed to answer. Everything
the model returns is validated before display: strict JSON schema → Zod → **every cited excerpt
must literally appear in that participant's transcript**, or the claim is dropped. The model
cannot invent evidence.

### Joint impossibility

Most contradiction logic compares two claims and asks whether the values differ. That misses the
sharpest class of conflict: claims that are each plausible alone but cannot all hold together.
`jointRules.ts` detects these — currently conflicting right-of-way (two drivers on crossing
approaches who each recall green) and internal inconsistency (one person giving two values for
the same exclusive attribute). Adding a rule is adding a function.

### Classification

Every claim lands in one of seven states, and the vocabulary deliberately contains nothing
resembling deception:

`Independently corroborated` · `Supported by external evidence` · `Internally inconsistent` ·
`Contradicted by another claim` · `Contradicted by external evidence` · `Unresolved` ·
`Requires follow-up`

### The loop

Interview → extract claims → update the case graph → compare → find the gap → generate the next
question → repeat. Follow-ups are **laundered before they are ever spoken**: the dashboard may
ask you *"Did any other witness observe a chemical smell?"*, but the agent asks the participant
*"Did you notice any unusual smells?"* — because the first phrasing tells them what someone else
reported. A regex backstop rejects any prompt that references another participant.

---

## Integrations — what is real

The dashboard shows each of these as **live** or **demo** at all times, and the activity feed
records which path actually served each step. Nothing is claimed that did not happen.

| | Status | Notes |
|---|---|---|
| **Cognee** | ✅ **live, verified — hosted tenant** | Runs against a hosted Cognee graph on `aws.cognee.ai` over its REST API (`add_text` → `cognify` → `recall`). Verified: ingest returns `{ok:true}` and recall answers *"Maya Chen was driving the black Tesla, and she was travelling northbound"* from the graph via `GRAPH_COMPLETION`. Falls back to the local `cognee` 1.6.0 SDK when no tenant is configured — that path is verified too, and the adapter introspects the installed module rather than guessing its API. |
| **Strands** `1.56.0` | ✅ **live, verified** | The Report Agent is a real `strands.Agent` on an OpenAI model provider with a Pydantic `structured_output_model`. Falls back to a deterministic local report if unavailable. |
| **Bright Data** | ✅ **live, verified** | MCP server over stdio (`npx @brightdata/mcp`). Retrieves live public context for the case. SERP is attempted first; where an account has scraping but no usable SERP zone, the plan falls back to `scrape_as_markdown` against named authoritative pages — still a live retrieval, and `provider` records which tool produced each source. |
| **Docker Sandbox** | ⚠️ local fallback | Evidence is processed in a container with `--network none --cap-drop ALL --read-only --no-new-privileges` and memory/CPU/pid caps. No Docker daemon on this machine, so the restricted local path runs instead — each evidence card shows which one executed. |
| **Voice** | ⚠️ simulator | `DEMO_MODE=true`. The simulator drives the same interview protocol, state machine and downstream pipeline as a real call; only the audio layer is swapped. A Guava provider is wired for `DEMO_MODE=false`. |
| **OpenAI** | ✅ live | Claim analysis, Cognee extraction, and the Report Agent. |

**Two Cognee paths.** With `COGNEE_API_URL` + `COGNEE_API_KEY` set, the brain service talks to a
hosted tenant — the graph is durable, shared, and inspectable in the Cognee dashboard. Without
them it falls back to the local SDK, so the project still runs with no Cognee account at all.

The local path has one trap worth recording: Cognee defaults its vector store inside
`site-packages`, and under a OneDrive-synced path containing spaces LanceDB cannot persist there,
so every `cognify` dies with an opaque IO error. The adapter relocates the store to
`~/.blackbox-cognee` before anything touches it — override with `COGNEE_STORAGE_DIR`.

---

## Architecture

```
Browser (React 19 + Vite + Framer Motion)
   │  SSE /api/stream — every state change pushed live
   ▼
Node / Express  ── src/server.ts
   ├── reconstruction.ts   state machine: dial → interview → extract → research → reconcile → report
   ├── extract.ts          transcript  → claims (provenance mandatory)
   ├── reconcile.ts        claims      → agreements / contradictions / open questions
   ├── jointRules.ts       "these cannot all be true"
   ├── llm.ts              OpenAI analyst, schema-validated, excerpt-grounded
   ├── callProvider.ts     demo simulator | Guava
   └── adapters/
        ├── brain.ts       → Python service
        ├── brightdata.ts  → MCP stdio client
        └── sandbox.ts     → Docker, hardened
                │
                ▼
Python / FastAPI ── brain/app.py
   ├── Cognee   persistent case graph
   └── Strands  Report Agent, Pydantic structured output
```

State lives in memory with a JSON snapshot (`data/blackbox.json`) — no database to stand up.

## Commands

| | |
|---|---|
| `npm start` | build UI + serve on :3000 |
| `npm run dev` | UI watch + API + brain together |
| `npm run brain` | Python service only |
| `npm test` | both regression suites |
| `npm run typecheck` | `tsc --noEmit` |

## Tests

```
npm test
  13/13  warehouse scenario  (src/selftest.ts)
  12/12  BB-204 scenario     (src/casetest.ts)
```

These run the real pipeline with no network and no LLM. They assert the headline finding
appears, that the green-light claims are **not** reported as agreement, that an 8-minute time
spread is filed as uncertainty rather than conflict, that every finding cites source claims, and
that **no finding accuses anyone of lying**.

## Safety

- Never equates inconsistency with deception, and never assigns fault.
- Vocal style and hesitation are never treated as signal.
- Raw testimony is immutable; interpretations are separate and traceable.
- Every conclusion links to a named speaker and their exact words.
- Confidence is confidence in the *reconstruction*, never in a person's honesty, and is always
  shown with its basis.
- Phone numbers are masked server-side and never reach the browser in full.
- All demo names, numbers (555 range), recordings and documents are fictional.
- Secrets live only in `.env`, which is gitignored.

## Known limits

- Demo interviews carry no audio, so playback controls render disabled and say `no recording
  (demo)` rather than presenting a dead button.
- Bright Data and Docker run on labelled fallbacks on this machine.
- The lexicon covers traffic and warehouse incidents; other domains lean on the OpenAI path
  until entries are added to `src/lexicon.ts`.
