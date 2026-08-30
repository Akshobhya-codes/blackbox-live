import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TopBar from "./components/TopBar";
import WitnessRail from "./components/WitnessRail";
import DetailPanel from "./components/DetailPanel";
import NewCaseForm from "./components/NewCaseForm";
import TimelineCanvas, { type Phase } from "./components/TimelineCanvas";
import {
  IconChevron,
  IconGear,
  IconGraph,
  IconList,
  IconPeople,
  IconReplay,
  IconWave,
  IconX,
} from "./icons";
import { post, subscribe } from "./lib/api";
import { MOCK_STATE } from "./lib/mock";
import { buildRows, hasRealData, witnessMeta } from "./lib/model";
import type { AppState } from "./lib/types";

const EMPTY: AppState = {
  incident: null,
  witnesses: [],
  interviews: [],
  claims: [],
  findings: [],
  timeline: [],
  reconciliation: { status: "idle", lastRunAt: null, error: null, engine: "deterministic" },
  guava: { ready: false, error: null, agentNumber: null, inbound: false },
};

const DEMO_A =
  "I was near Loading Dock B. I saw a blue forklift reverse into the rack. " +
  "The rack started falling, and then the alarm went off. I think it happened " +
  "around 8:12. I did not see any smoke.";
const DEMO_B =
  "I heard the alarm first. Then I looked over and saw the rack falling near the " +
  "loading dock. The forklift looked yellow to me. A few seconds later I noticed " +
  "a chemical smell.";

export default function App() {
  const [live, setLive] = useState<AppState>(EMPTY);
  const [connected, setConnected] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [selectedWitnessId, setSelectedWitnessId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [modal, setModal] = useState<
    null | "witness" | "dryrun" | "newcase" | { transcript: string }
  >(null);
  const [toast, setToast] = useState<{ text: string; err?: boolean } | null>(null);

  const timers = useRef<number[]>([]);
  const lastSignature = useRef<string>("");

  useEffect(() => subscribe(setLive, setConnected), []);

  const preview = !hasRealData(live);
  const state = preview ? MOCK_STATE : live;

  const meta = useMemo(
    () => witnessMeta(state.witnesses, state.interviews),
    [state.witnesses, state.interviews],
  );
  const rows = useMemo(() => buildRows(state), [state]);

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);

  const reconstruct = useCallback(() => {
    clearTimers();
    setPhase("enter");
    const seq: [Phase, number][] = [
      ["merge", 900],
      ["separate", 1700],
      ["conflict", 2400],
      ["done", 3300],
    ];
    for (const [p, delay] of seq) {
      timers.current.push(window.setTimeout(() => setPhase(p), delay));
    }
  }, [clearTimers]);

  useEffect(() => clearTimers, [clearTimers]);

  // Replay the reconstruction whenever an interview actually finishes.
  useEffect(() => {
    const signature = live.interviews.map((i) => `${i.id}:${i.completionStatus}`).join("|");
    if (lastSignature.current && signature !== lastSignature.current && !preview) {
      reconstruct();
    }
    lastSignature.current = signature;
  }, [live.interviews, preview, reconstruct]);

  const notify = (text: string, err = false) => {
    setToast({ text, err });
    window.setTimeout(() => setToast(null), 4200);
  };

  const action = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      notify(ok);
    } catch (err) {
      notify((err as Error).message, true);
    }
  };

  const selectedFinding =
    state.findings.find((f) => f.id === selectedFindingId && f.type === "contradiction") ?? null;

  // Only contradictions get the side-by-side panel; clicking anything else
  // should leave the overview alone rather than blanking it.
  const openFinding = (id: string) => {
    if (state.findings.find((f) => f.id === id)?.type === "contradiction") {
      setSelectedFindingId(id);
    }
  };

  const callWitness = (id: string) => {
    if (preview) return notify("Preview data — add a real witness to place a call", true);
    void action(() => post(`/api/witness/${id}/call`), "Calling witness…");
  };

  const callableWitness = state.witnesses.find((w) => w.hasPhone && w.callStatus !== "live");

  const transcriptWitnessId = typeof modal === "object" && modal ? modal.transcript : null;
  const transcriptInterview = transcriptWitnessId
    ? state.interviews.find((i) => i.witnessId === transcriptWitnessId)
    : null;

  return (
    <div className="app">
      <TopBar state={state} connected={connected} preview={preview} />

      <div className="body">
        <nav className="iconrail">
          <button className="rail-btn active" title="Timeline graph">
            <IconGraph />
          </button>
          <button className="rail-btn" title="Findings list">
            <IconList />
          </button>
          <button className="rail-btn" title="Witnesses">
            <IconPeople />
          </button>
          <button className="rail-btn" title="Audio">
            <IconWave />
          </button>
          <div className="rail-spacer" />
          <button className="rail-btn" title="Settings">
            <IconGear />
          </button>
          <button className="rail-btn" title="Expand">
            <IconChevron />
          </button>
        </nav>

        <WitnessRail
          witnesses={state.witnesses}
          interviews={state.interviews}
          meta={meta}
          selectedWitnessId={selectedWitnessId}
          onSelect={setSelectedWitnessId}
          onCall={callWitness}
          onTranscript={(id) => setModal({ transcript: id })}
          onAdd={() => setModal("witness")}
        />

        <main className="stage">
          <div className="stage-head">
            <span className="stage-title">INCIDENT TIMELINE</span>
            <div className="stage-actions">
              <button className="btn-sm accent" onClick={reconstruct}>
                <IconReplay /> Reconstruct timeline
              </button>
              <button
                className="btn-sm"
                onClick={() => action(() => post("/api/reconcile"), "Reconciled")}
              >
                Reconcile
              </button>
              <button className="btn-sm" onClick={() => setModal("dryrun")}>
                Text dry-run
              </button>
              <button className="btn-sm accent" onClick={() => setModal("newcase")}>
                New case
              </button>
              <button
                className="btn-sm danger"
                onClick={() => {
                  if (!confirm("Delete this case? All witnesses, statements, and findings are cleared."))
                    return;
                  setSelectedFindingId(null);
                  setSelectedWitnessId(null);
                  setSelectedEventId(null);
                  void action(() => post("/api/incident/delete"), "Case deleted");
                }}
              >
                Delete case
              </button>
            </div>
          </div>

          <TimelineCanvas
            rows={rows}
            meta={meta}
            findings={state.findings}
            phase={phase}
            selectedEventId={selectedEventId}
            hoveredEventId={hoveredEventId}
            selectedWitnessId={selectedWitnessId}
            onHoverEvent={setHoveredEventId}
            onSelectEvent={setSelectedEventId}
            onOpenContradiction={openFinding}
          />

          <div className="legend">
            <span>
              <i className="lg green" />
              Corroborated
            </span>
            <span>
              <i className="lg red" />
              Contradiction
            </span>
            <span>
              <i className="lg amber dotted" />
              Uncertain / Single source
            </span>
            <span>
              <i className="lg blue" />
              Timeline
            </span>
            {selectedWitnessId && (
              <button className="clear-focus" onClick={() => setSelectedWitnessId(null)}>
                Clear witness focus
              </button>
            )}
          </div>
        </main>

        <DetailPanel
          finding={selectedFinding}
          findings={state.findings}
          claims={state.claims}
          meta={meta}
          canCall={Boolean(callableWitness) && !preview}
          engine={preview ? "preview" : state.reconciliation.engine}
          reconStatus={state.reconciliation.status}
          eventTime={
            selectedFinding
              ? (rows.find((r) => r.contradictionId === selectedFinding.id)?.time ?? null)
              : null
          }
          inboundNumber={state.guava.agentNumber}
          onClose={() => setSelectedFindingId(null)}
          onSelectFinding={openFinding}
          onAskNext={(id) =>
            action(
              () => post<{ prompt: string }>(`/api/findings/${id}/ask-next`),
              "Queued — Ava asks this first on the next call",
            )
          }
          onStartCall={() => {
            if (preview) return notify("Preview data — open a real case first", true);
            if (!callableWitness) {
              return notify(
                state.guava.agentNumber
                  ? `Inbound is live — have the witness call ${state.guava.agentNumber}`
                  : "No witness with a phone number, and no inbound line configured",
                !state.guava.agentNumber,
              );
            }
            void action(
              () => post(`/api/witness/${callableWitness.id}/call`),
              `Calling ${callableWitness.displayName}…`,
            );
          }}
        />
      </div>

      {/* ------------------------------------------------------------ modals */}
      {modal === "newcase" && (
        <Modal title="Open a new case" onClose={() => setModal(null)}>
          <NewCaseForm
            onDone={(title) => {
              setModal(null);
              setSelectedFindingId(null);
              setSelectedWitnessId(null);
              notify(`Case opened — ${title}`);
            }}
            onError={(m) => notify(m, true)}
          />
        </Modal>
      )}

      {modal === "witness" && (
        <Modal title="Add Witness" onClose={() => setModal(null)}>
          <WitnessForm
            onDone={() => {
              setModal(null);
              notify("Witness added");
            }}
            onError={(m) => notify(m, true)}
          />
        </Modal>
      )}

      {modal === "dryrun" && (
        <Modal title="Text dry-run (no call)" onClose={() => setModal(null)}>
          <DryRunForm
            onDone={() => {
              setModal(null);
              notify("Account recorded and reconciled");
            }}
            onError={(m) => notify(m, true)}
          />
        </Modal>
      )}

      {transcriptInterview && (
        <Modal
          title={`Transcript — ${state.witnesses.find((w) => w.id === transcriptWitnessId)?.displayName ?? ""}`}
          onClose={() => setModal(null)}
        >
          <div className="transcript">
            {transcriptInterview.transcript.map((t, i) => (
              <div key={i} className={`turn ${t.speaker}`}>
                <div className="turn-spk">{t.speaker === "agent" ? "BLACKBOX" : "WITNESS"}</div>
                <div className="turn-txt">{t.text}</div>
              </div>
            ))}
            {transcriptInterview.transcript.length === 0 && (
              <div className="dpanel-empty">No transcript captured.</div>
            )}
          </div>
        </Modal>
      )}

      {toast && <div className={`toast${toast.err ? " err" : ""}`}>{toast.text}</div>}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>{title}</span>
          <button className="icon-btn small" onClick={onClose}>
            <IconX />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function WitnessForm({ onDone, onError }: { onDone: () => void; onError: (m: string) => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await post("/api/witness", { displayName: name, phoneNumber: phone });
          onDone();
        } catch (err) {
          onError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Display name or alias
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Witness A" required />
      </label>
      <label>
        Phone number <span className="hint">masked everywhere on the dashboard</span>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+14155550123" />
      </label>
      <button className="btn-outline" type="submit" disabled={busy}>
        {busy ? "Adding…" : "Add witness"}
      </button>
    </form>
  );
}

function DryRunForm({ onDone, onError }: { onDone: () => void; onError: (m: string) => void }) {
  const [name, setName] = useState("");
  const [account, setAccount] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await post("/api/simulate", { displayName: name, account });
          onDone();
        } catch (err) {
          onError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="hint block">
        Records an account as text instead of speech so the dashboard can be rehearsed without
        spending a call. Results are labelled <strong>SIMULATED</strong>.
      </p>
      <label>
        Display name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Witness A" required />
      </label>
      <label>
        Account
        <textarea rows={5} value={account} onChange={(e) => setAccount(e.target.value)} required />
      </label>
      <div className="row">
        <button
          type="button"
          className="btn-sm"
          onClick={() => {
            setName("Witness A");
            setAccount(DEMO_A);
          }}
        >
          Fill Witness A
        </button>
        <button
          type="button"
          className="btn-sm"
          onClick={() => {
            setName("Witness B");
            setAccount(DEMO_B);
          }}
        >
          Fill Witness B
        </button>
      </div>
      <button className="btn-outline" type="submit" disabled={busy}>
        {busy ? "Recording…" : "Record account"}
      </button>
    </form>
  );
}
