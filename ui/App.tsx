import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Timeline from "./components/Timeline";
import Contradictions from "./components/Contradictions";
import {
  ActivityFeed,
  EvidenceView,
  Overview,
  ParticipantRail,
  ReportView,
  TranscriptModal,
} from "./components/Panels";
import { post, subscribe } from "./lib/api";
import { counts, participantMeta } from "./lib/view";
import { EMPTY_STATE, type AppState, type Finding, type IntegrationStatus, type Participant } from "./lib/types";
import "./styles.css";

type Tab = "overview" | "timeline" | "contradictions" | "evidence" | "report";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "timeline", label: "Timeline" },
  { id: "contradictions", label: "Contradictions" },
  { id: "evidence", label: "Evidence" },
  { id: "report", label: "Final Report" },
];

export default function App() {
  const [state, setState] = useState<AppState>(EMPTY_STATE);
  const [connected, setConnected] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [focus, setFocus] = useState<string | null>(null);
  const [selected, setSelected] = useState<Finding | null>(null);
  const [transcript, setTranscript] = useState<Participant | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [toast, setToast] = useState<{ text: string; err?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribe(setState, setConnected), []);

  const loadHealth = useCallback(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setIntegrations(d.integrations ?? []))
      .catch(() => setIntegrations([]));
  }, []);
  useEffect(loadHealth, [loadHealth]);

  const meta = useMemo(() => participantMeta(state.participants), [state.participants]);
  const c = useMemo(() => counts(state), [state]);
  const phase = state.reconstruction.phase;
  const live = !["idle", "complete", "failed"].includes(phase);

  const notify = (text: string, err = false) => {
    setToast({ text, err });
    window.setTimeout(() => setToast(null), 4200);
  };

  // Jump to the payoff the moment the reconstruction lands on a conflict.
  useEffect(() => {
    if (phase === "reconciling" && tab === "overview") setTab("timeline");
    if (phase === "complete" && c.contradictions > 0 && tab === "timeline") {
      const t = window.setTimeout(() => setTab("contradictions"), 1200);
      return () => window.clearTimeout(t);
    }
  }, [phase, c.contradictions]); // eslint-disable-line react-hooks/exhaustive-deps

  const launch = async () => {
    setBusy(true);
    try {
      await post("/api/reconstruct");
      setTab("timeline");
      notify("Reconstruction started");
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    setSelected(null);
    setFocus(null);
    try {
      await post("/api/demo/reset");
      setTab("overview");
      notify("Demo reset");
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  const askNext = async (id: string) => {
    try {
      const r = await post<{ question: string }>(`/api/followups/${id}/prioritise`);
      notify(`Queued for the next call: “${r.question}”`);
    } catch (e) {
      notify((e as Error).message, true);
    }
  };

  const inc = state.incident;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          BLACK<span>BOX</span>
        </div>

        <div className="case">
          {inc?.referenceId && <span className="case-ref">{inc.referenceId}</span>}
          <span className="case-title">{inc?.title ?? "No case open"}</span>
          <span className={`case-status ${phase}`}>{phase.toUpperCase()}</span>
          {state.demoMode && <span className="chip demo">DEMO MODE</span>}
        </div>

        <div className="top-meta">
          <Meta label="Location" value={inc?.location ?? "—"} />
          <Meta label="Incident time" value={inc?.approximateTime ?? "—"} />
          <Meta label="Interviewed" value={`${c.interviewed}/${state.participants.length}`} />
          <Meta
            label="Confidence"
            value={state.report ? `${state.report.confidence}%` : "—"}
            tone={state.report ? "good" : undefined}
          />
        </div>

        <div className="top-actions">
          <button className="btn-launch" onClick={launch} disabled={busy || live}>
            {live ? "Reconstructing…" : "Launch Reconstruction"}
          </button>
          <button className="btn-ghost" onClick={reset} disabled={busy || live}>
            Reset Demo
          </button>
          <span className={`link-dot ${connected ? "on" : "off"}`} title={connected ? "live" : "disconnected"} />
        </div>
      </header>

      {live && (
        <div className="progress">
          <motion.div
            className="progress-fill"
            animate={{ width: `${state.reconstruction.progress}%` }}
            transition={{ duration: 0.5 }}
          />
          <span className="progress-text">{state.reconstruction.message}</span>
        </div>
      )}

      <div className="body">
        <ParticipantRail
          state={state}
          meta={meta}
          focus={focus}
          onFocus={setFocus}
          onTranscript={setTranscript}
        />

        <main className="stage">
          <nav className="tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`tab${tab === t.id ? " active" : ""}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                {t.id === "contradictions" && c.contradictions > 0 && (
                  <span className="tab-badge bad">{c.contradictions}</span>
                )}
                {t.id === "timeline" && state.timeline.length > 0 && (
                  <span className="tab-badge">{state.timeline.length}</span>
                )}
              </button>
            ))}
            <div className="tabs-spacer" />
            <span className="engine-note">{state.reconciliation.engine}</span>
          </nav>

          <div className="stage-body">
            <AnimatePresence mode="wait">
              <motion.div
                key={tab}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="tab-panel"
              >
                {tab === "overview" && <Overview state={state} meta={meta} />}
                {tab === "timeline" && (
                  <Timeline
                    state={state}
                    meta={meta}
                    focusParticipant={focus}
                    onOpenContradiction={(f) => {
                      setSelected(f);
                      setTab("contradictions");
                    }}
                  />
                )}
                {tab === "contradictions" && (
                  <Contradictions
                    state={state}
                    meta={meta}
                    selected={selected}
                    onSelect={setSelected}
                    onAskNext={askNext}
                  />
                )}
                {tab === "evidence" && <EvidenceView state={state} />}
                {tab === "report" && <ReportView state={state} />}
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="legend">
            <span><i className="lg good" />Corroborated</span>
            <span><i className="lg bad" />Contradiction</span>
            <span><i className="lg warn dotted" />Uncertain / single source</span>
            <span><i className="lg neutral" />Timeline</span>
            {focus && (
              <button className="clear-focus" onClick={() => setFocus(null)}>
                Clear participant focus
              </button>
            )}
          </div>
        </main>

        <div className="right">
          <ActivityFeed state={state} />
          <div className="integrations">
            <div className="feed-head"><span>INTEGRATIONS</span></div>
            {integrations.map((i) => (
              <div key={i.name} className="integ" title={i.detail}>
                <span className={`chip ${i.mode}`}>{i.mode}</span>
                <span className="integ-name">{i.name}</span>
              </div>
            ))}
            {integrations.length === 0 && <div className="muted pad small">checking…</div>}
          </div>
        </div>
      </div>

      {transcript && (
        <TranscriptModal
          participant={transcript}
          state={state}
          meta={meta}
          onClose={() => setTranscript(null)}
        />
      )}

      <AnimatePresence>
        {toast && (
          <motion.div
            className={`toast${toast.err ? " err" : ""}`}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
          >
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Meta({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="meta">
      <div className="meta-l">{label}</div>
      <div className={`meta-v ${tone ?? ""}`}>{value}</div>
    </div>
  );
}
