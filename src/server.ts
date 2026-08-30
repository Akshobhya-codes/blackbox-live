// BlackBox API + dashboard host.
//
// One process runs everything: the HTTP API, the static dashboard, the SSE
// stream, and the Guava Expert. No tunnel, no broker, no second terminal.

import "dotenv/config";
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { store } from "./store.ts";
import { llmConfigured } from "./llm.ts";
import { createDemoIncident, ensureIncident, simulateInterview, splitAccount } from "./demo.ts";
import { isPlausiblePhone, maskPhone, toE164 } from "./normalize.ts";
import { CASE_TYPES } from "./types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);

// ---------------------------------------------------------------------------
// Guava is loaded dynamically: the SDK throws at construction when no
// credentials are present, and a missing key must never stop the dashboard.
// ---------------------------------------------------------------------------
type AgentModule = typeof import("./agent.ts");
let agentModule: AgentModule | null = null;
let agentError: string | null = null;

async function loadAgent(): Promise<void> {
  try {
    agentModule = await import("./agent.ts");
    agentModule.startInboundListener();
  } catch (err) {
    agentError = (err as Error).message;
    console.warn(
      "\n[server] Guava agent NOT started — phone calling is disabled.\n" +
        `         reason: ${agentError}\n` +
        "         fix: run `guava login`, or set GUAVA_API_KEY, then restart.\n" +
        "         The dashboard, reconciliation, and simulation still work.\n",
    );
  }
}

function guavaStatus() {
  return {
    ready: agentModule !== null,
    error: agentError,
    agentNumber: agentModule?.agentNumber() ?? process.env.GUAVA_AGENT_NUMBER ?? null,
    inbound: Boolean(agentModule && agentModule.agentNumber()),
  };
}

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(resolve(__dirname, "..", "public")));

// ---------------------------------------------------------------------------
// Read model — phone numbers are masked before they ever leave the server.
// ---------------------------------------------------------------------------
function viewState() {
  const s = store.getState();
  return {
    incident: s.incidents[0] ?? null,
    witnesses: s.witnesses.map((w) => ({
      ...w,
      phoneNumber: undefined,
      phoneMasked: w.phoneNumber ? maskPhone(w.phoneNumber) : null,
      hasPhone: Boolean(w.phoneNumber),
    })),
    interviews: s.interviews.map((i) => ({
      ...i,
      simulated: i.fields.simulated === true,
    })),
    claims: s.claims.filter((c) => c.category !== "narrative"),
    findings: s.findings,
    timeline: s.timeline,
    reconciliation: s.reconciliation,
    guava: guavaStatus(),
  };
}

app.get("/api/state", (_req, res) => {
  res.json(viewState());
});

// ---------------------------------------------------------------------------
// Live updates
// ---------------------------------------------------------------------------
app.get("/api/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`data: ${JSON.stringify({ type: "snapshot", state: viewState() })}\n\n`);

  const onChange = (evt: { reason: string }) => {
    res.write(`data: ${JSON.stringify({ type: "update", reason: evt.reason, state: viewState() })}\n\n`);
  };
  store.on("change", onChange);

  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);
  req.on("close", () => {
    clearInterval(heartbeat);
    store.off("change", onChange);
  });
});

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
app.post("/api/incident/demo", (_req, res) => {
  const incident = createDemoIncident();
  res.json({ incident });
});

app.get("/api/case-types", (_req, res) => {
  res.json({ caseTypes: CASE_TYPES });
});

/**
 * Opens a new case with whatever the agency already holds, and optionally
 * registers the witnesses expected to give a statement. Callers who identify
 * themselves as one of those witnesses are matched to the roster.
 */
app.post("/api/incident", (req, res) => {
  const b = req.body ?? {};
  const title = String(b.title ?? "").trim();
  if (title.length < 3) return res.status(400).json({ error: "A case title is required" });

  const roster: { displayName: string; phoneNumber: string }[] = Array.isArray(b.witnesses)
    ? b.witnesses
        .map((w: { displayName?: string; phoneNumber?: string }) => ({
          displayName: String(w?.displayName ?? "").trim(),
          phoneNumber: String(w?.phoneNumber ?? "").trim(),
        }))
        .filter((w: { displayName: string }) => w.displayName.length > 0)
    : [];

  for (const w of roster) {
    if (w.phoneNumber && !isPlausiblePhone(w.phoneNumber)) {
      return res.status(400).json({ error: `Invalid phone number for ${w.displayName}` });
    }
  }

  store.reset();
  const incident = store.createIncident({
    title,
    type: String(b.type ?? "Police investigation").trim(),
    location: String(b.location ?? "").trim(),
    approximateTime: String(b.approximateTime ?? "").trim(),
    description: String(b.description ?? "").trim(),
    referenceId: String(b.referenceId ?? "").trim(),
    openedBy: String(b.openedBy ?? "").trim(),
    knownContext: String(b.knownContext ?? "").trim(),
  });

  for (const w of roster) store.addWitness(incident.id, w.displayName, w.phoneNumber);

  res.json({ incident, witnesses: roster.length });
});

app.post("/api/witness", (req, res) => {
  const { displayName, phoneNumber } = req.body ?? {};
  const name = String(displayName ?? "").trim();
  const phone = String(phoneNumber ?? "").trim();

  if (name.length < 1) return res.status(400).json({ error: "displayName is required" });
  if (phone && !isPlausiblePhone(phone)) {
    return res.status(400).json({ error: "phoneNumber must be a valid number, e.g. +14155550123" });
  }

  const incident = ensureIncident();
  const witness = store.addWitness(incident.id, name, phone);
  res.json({ witnessId: witness.id, phoneMasked: phone ? maskPhone(toE164(phone)) : null });
});

app.post("/api/witness/:id/call", async (req, res) => {
  const witness = store.getWitness(req.params.id);
  if (!witness) return res.status(404).json({ error: "unknown witness" });
  if (!agentModule) {
    return res.status(503).json({
      error: "Guava agent is not connected. Run `guava login` or set GUAVA_API_KEY, then restart.",
    });
  }
  try {
    await agentModule.placeOutboundCall(witness.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

app.post("/api/reconcile", async (_req, res) => {
  try {
    const result = await store.runReconciliationSmart();
    res.json({
      ok: true,
      engine: result.engine,
      counts: {
        claims: result.claims.length,
        findings: result.findings.length,
        timeline: result.timeline.length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * Records a witness account from text instead of speech. Used to rehearse the
 * dashboard without spending a call; results are labelled "simulated" in the UI.
 */
app.post("/api/simulate", async (req, res) => {
  const { displayName, account, followUp } = req.body ?? {};
  const name = String(displayName ?? "").trim();
  const text = String(account ?? "").trim();
  if (!name || text.length < 10) {
    return res.status(400).json({ error: "displayName and a non-trivial account are required" });
  }
  const { witnessId } = simulateInterview(name, splitAccount(text), Boolean(followUp));
  try {
    const result = await store.runReconciliationSmart();
    res.json({ ok: true, witnessId, engine: result.engine });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/reset", (_req, res) => {
  store.reset();
  createDemoIncident();
  res.json({ ok: true });
});

/**
 * Moves a question to the front of the queue, so the next witness who calls in
 * is asked it first. This is the "Ask next" action on the dashboard — it works
 * without outbound dialling, which matters when only inbound is available.
 */
app.post("/api/findings/:id/ask-next", (req, res) => {
  const finding = store.getState().findings.find((f) => f.id === req.params.id);
  if (!finding) return res.status(404).json({ error: "unknown finding" });

  const prompt = finding.witnessPrompt ?? finding.followUpQuestion;
  if (!prompt) {
    return res.status(400).json({
      error: "This question cannot be put to a witness without revealing another account.",
    });
  }
  store.queueQuestion(finding.id);
  res.json({ ok: true, prompt });
});

/** Clears the case entirely, ready to open a fresh one. */
app.post("/api/incident/delete", (_req, res) => {
  store.reset();
  res.json({ ok: true });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    guava: guavaStatus(),
    llm: {
      configured: llmConfigured(),
      model: process.env.OPENAI_MODEL ?? "gpt-4o",
    },
    uptime: process.uptime(),
  });
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
ensureIncident();

const server = app.listen(PORT, () => {
  console.log(`\n  BLACKBOX  ·  http://localhost:${PORT}`);
  console.log(`  "Every witness has a piece. BlackBox builds the timeline."\n`);
  void loadAgent();
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `\n  Port ${PORT} is already in use — BlackBox is probably running in another terminal.\n` +
        `  Close it, or start this one on a different port:\n` +
        `      PowerShell:  $env:PORT=3001; npm run dev\n`,
    );
  } else {
    console.error("[server] failed to start:", err.message);
  }
  process.exit(1);
});

process.on("unhandledRejection", (err) => {
  console.error("[server] unhandled rejection:", err);
});
