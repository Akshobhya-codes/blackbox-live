// BlackBox API + dashboard host.
//
// One process serves the HTTP API, the static dashboard, the SSE stream, and
// the reconstruction orchestrator. Phone numbers are masked on the way out and
// never reach the browser in full.

import "dotenv/config";
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { store } from "./store.ts";
import { seedDemoCase, ensureCase } from "./cases/seed.ts";
import { isRunning, runReconstruction } from "./reconstruction.ts";
import { activeProvider, placeCall, providerDetail } from "./callProvider.ts";
import { isDockerAvailable } from "./adapters/sandbox.ts";
import { brightDataConfigured } from "./adapters/brightdata.ts";
import * as brain from "./adapters/brain.ts";
import { llmConfigured } from "./llm.ts";
import { isPlausiblePhone, maskPhone } from "./normalize.ts";
import { CASE_TYPES, type IntegrationStatus, type ParticipantRole } from "./types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const DEMO_MODE = (process.env.DEMO_MODE ?? "true").toLowerCase() !== "false";

const app = express();
app.use(express.json({ limit: "4mb" }));
app.use(express.static(resolve(__dirname, "..", "public")));

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------
function viewState() {
  const s = store.getState();
  return {
    demoMode: DEMO_MODE,
    incident: s.incidents[0] ?? null,
    participants: s.witnesses.map((w) => ({
      ...w,
      phoneNumber: undefined,
      phoneMasked: w.phoneNumber ? maskPhone(w.phoneNumber) : null,
      hasPhone: Boolean(w.phoneNumber),
    })),
    interviews: s.interviews,
    // Narrative-position claims are internal ordering evidence, not findings.
    claims: s.claims.filter((c) => c.category !== "narrative"),
    findings: s.findings,
    timeline: s.timeline,
    evidence: s.evidence,
    externalSources: s.externalSources,
    agentActions: s.agentActions.slice(-120),
    followUps: s.followUps,
    report: s.report,
    reconstruction: s.reconstruction,
    reconciliation: s.reconciliation,
  };
}

app.get("/api/state", (_req, res) => res.json(viewState()));

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
    res.write(
      `data: ${JSON.stringify({ type: "update", reason: evt.reason, state: viewState() })}\n\n`,
    );
  };
  store.on("change", onChange);

  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);
  req.on("close", () => {
    clearInterval(heartbeat);
    store.off("change", onChange);
  });
});

// ---------------------------------------------------------------------------
// Integration status — what is genuinely live vs a labelled fallback
// ---------------------------------------------------------------------------
app.get("/api/health", async (_req, res) => {
  const b = await brain.health();
  const docker = await isDockerAvailable();

  const integrations: IntegrationStatus[] = [
    {
      name: "Cognee",
      mode: b.cognee.mode,
      detail: b.reachable ? b.cognee.detail : "brain service not running (npm run brain)",
    },
    {
      name: "Strands",
      mode: b.strands.mode,
      detail: b.reachable ? b.strands.detail : "brain service not running (npm run brain)",
    },
    {
      name: "Bright Data",
      mode: brightDataConfigured() ? "live" : "demo",
      detail: brightDataConfigured()
        ? "MCP server via npx @brightdata/mcp"
        : "no BRIGHTDATA_API_TOKEN — labelled demo fixtures in use",
    },
    {
      name: "Docker Sandbox",
      mode: docker ? "live" : "demo",
      detail: docker
        ? "containerised: no network, read-only root, all capabilities dropped"
        : "no Docker daemon — restricted local processing, labelled on each item",
    },
    {
      name: "Voice",
      mode: activeProvider() === "guava" ? "live" : "demo",
      detail: providerDetail(),
    },
    {
      name: "LLM analysis",
      mode: llmConfigured() ? "live" : "demo",
      detail: llmConfigured()
        ? `openai:${process.env.OPENAI_MODEL ?? "gpt-4o"} cross-checked against the rules engine`
        : "no OPENAI_API_KEY — deterministic rules engine only",
    },
  ];

  res.json({ ok: true, demoMode: DEMO_MODE, integrations, uptime: process.uptime() });
});

app.get("/api/case-types", (_req, res) => res.json({ caseTypes: CASE_TYPES }));

// ---------------------------------------------------------------------------
// Case management
// ---------------------------------------------------------------------------
app.post("/api/demo/reset", (_req, res) => {
  const incident = seedDemoCase();
  res.json({ ok: true, incident });
});

app.post("/api/case", (req, res) => {
  const b = req.body ?? {};
  const title = String(b.title ?? "").trim();
  if (title.length < 3) return res.status(400).json({ error: "A case title is required" });

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
  res.json({ ok: true, incident });
});

app.post("/api/participant", (req, res) => {
  const b = req.body ?? {};
  const name = String(b.displayName ?? "").trim();
  const phone = String(b.phoneNumber ?? "").trim();
  if (!name) return res.status(400).json({ error: "displayName is required" });
  if (phone && !isPlausiblePhone(phone)) {
    return res.status(400).json({ error: "phoneNumber must look like +14155550123" });
  }

  const incident = ensureCase();
  const w = store.addWitness(
    incident.id,
    name,
    phone,
    (String(b.role ?? "witness") as ParticipantRole) || "witness",
    String(b.descriptor ?? "").trim(),
    String(b.approach ?? "").trim() || undefined,
  );
  res.json({ ok: true, participantId: w.id });
});

app.post("/api/evidence", (req, res) => {
  const b = req.body ?? {};
  const filename = String(b.filename ?? "").trim();
  if (!filename) return res.status(400).json({ error: "filename is required" });

  const incident = ensureCase();
  const item = store.addEvidence(
    {
      kind: (b.kind ?? "other") as never,
      filename,
      sizeBytes: Number(b.sizeBytes ?? 0),
      uploadedAt: new Date().toISOString(),
      description: String(b.description ?? "").trim(),
      extracted: null,
      processedAt: null,
      processedBy: null,
      demo: false,
    },
    incident.id,
  );
  res.json({ ok: true, evidence: item });
});

// ---------------------------------------------------------------------------
// The main action
// ---------------------------------------------------------------------------
app.post("/api/reconstruct", (_req, res) => {
  if (isRunning()) return res.status(409).json({ error: "A reconstruction is already running" });
  if (!store.getIncident()) return res.status(400).json({ error: "No case is open" });

  // Fire and forget: the client follows progress over the SSE stream.
  runReconstruction().catch((err) => console.error("[reconstruct]", err));
  res.json({ ok: true, started: true });
});

app.post("/api/participant/:id/call", async (req, res) => {
  const w = store.getWitness(req.params.id);
  if (!w) return res.status(404).json({ error: "unknown participant" });
  const result = await placeCall(w.id);
  if (!result.ok) return res.status(400).json({ error: result.detail, provider: result.provider });
  res.json({ ...result, ok: true });
});

app.post("/api/followups/:id/prioritise", (req, res) => {
  const f = store.getState().followUps.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: "unknown follow-up" });
  const items = store
    .getState()
    .followUps.map((x) => (x.id === f.id ? { ...x, priority: -1, status: "queued" as const } : x))
    .sort((a, b) => a.priority - b.priority);
  store.setFollowUps(items);
  res.json({ ok: true, question: f.witnessPrompt ?? f.question });
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
app.get("/api/report.md", (_req, res) => {
  const report = store.getState().report;
  if (!report) return res.status(404).send("No report has been generated yet.");
  const ref = store.getIncident()?.referenceId || "case";
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="blackbox-${ref}.md"`);
  res.send(report.markdown);
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
const server = app.listen(PORT, () => {
  if (!store.getIncident()) seedDemoCase();
  console.log(`\n  BLACKBOX  ·  http://localhost:${PORT}`);
  console.log(`  Autonomous incident reconstruction`);
  console.log(`  demo mode: ${DEMO_MODE ? "on" : "off"} · voice: ${providerDetail()}\n`);
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `\n  Port ${PORT} is already in use — BlackBox may be running in another terminal.\n` +
        `  Close it, or:  $env:PORT=3001; npm run dev\n`,
    );
  } else {
    console.error("[server] failed to start:", err.message);
  }
  process.exit(1);
});
