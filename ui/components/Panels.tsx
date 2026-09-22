import { AnimatePresence, motion } from "framer-motion";
import {
  AGENT_LABEL,
  classificationBreakdown,
  isActive,
  stageLabel,
  stageProgress,
  timeAgo,
  type ParticipantMeta,
} from "../lib/view";
import { CLASSIFICATION_LABELS, CLASSIFICATION_TONE } from "../lib/types";
import type { AppState, Finding, Participant } from "../lib/types";

// ---------------------------------------------------------------- participants

export function ParticipantRail({
  state,
  meta,
  focus,
  onFocus,
  onTranscript,
  onCall,
  onAdd,
}: {
  state: AppState;
  meta: Map<string, ParticipantMeta>;
  focus: string | null;
  onFocus: (id: string | null) => void;
  onTranscript: (p: Participant) => void;
  onCall: (id: string, name: string) => void;
  onAdd: () => void;
}) {
  return (
    <aside className="rail">
      <div className="rail-head">
        <span>PARTICIPANTS</span>
        <span className="count">{state.participants.length}</span>
        <button className="rail-add" onClick={onAdd} title="Add a witness to this case">
          +
        </button>
      </div>
      <div className="rail-list">
        {state.participants.map((p) => {
          const m = meta.get(p.id)!;
          const live = isActive(p.callStatus);
          const done = p.callStatus === "completed";
          const iv = state.interviews.find((i) => i.witnessId === p.id);
          return (
            <div
              key={p.id}
              className={`pcard${focus === p.id ? " focused" : ""}${live ? " live" : ""}`}
              style={focus === p.id ? { borderColor: m.color } : undefined}
              onClick={() => onFocus(focus === p.id ? null : p.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onFocus(focus === p.id ? null : p.id);
                }
              }}
            >
              <div className="pcard-top">
                <span
                  className="avatar"
                  style={{ background: `${m.color}22`, color: m.color, borderColor: `${m.color}66` }}
                >
                  {m.initials}
                </span>
                <div className="pcard-id">
                  <div className="pcard-name">{p.displayName}</div>
                  <div className="pcard-role">{p.descriptor || m.role}</div>
                </div>
              </div>

              <div className="pcard-stage">
                <span className={`stage-dot ${p.callStatus}`} style={live ? { background: m.color } : undefined} />
                <span className="stage-text">{stageLabel(p.callStatus)}</span>
                {live && (
                  <span className="wave">
                    {Array.from({ length: 7 }).map((_, i) => (
                      <i key={i} style={{ background: m.color, animationDelay: `${i * 95}ms` }} />
                    ))}
                  </span>
                )}
              </div>

              <div className="stage-bar">
                <motion.div
                  className="stage-bar-fill"
                  style={{ background: m.color }}
                  animate={{ width: `${stageProgress(p.callStatus)}%` }}
                  transition={{ duration: 0.5 }}
                />
              </div>

              <div className="pcard-actions">
                {p.hasPhone && !live && (
                  <button
                    className="pcard-btn call"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCall(p.id, p.displayName);
                    }}
                  >
                    {done ? "Call back" : "Call now"}
                  </button>
                )}
                {done && iv && (
                  <button
                    className="pcard-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onTranscript(p);
                    }}
                  >
                    Transcript
                  </button>
                )}
              </div>
              {p.phoneMasked && !done && <div className="pcard-phone">{p.phoneMasked}</div>}
              {p.lastError && <div className="pcard-err">{p.lastError}</div>}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

// ------------------------------------------------------------------ live feed

export function ActivityFeed({ state }: { state: AppState }) {
  const items = [...state.agentActions].reverse().slice(0, 40);
  return (
    <aside className="feed">
      <div className="feed-head">
        <span>AGENT ACTIVITY</span>
        <span className={`engine-pill ${state.reconstruction.phase}`}>
          {state.reconstruction.phase}
        </span>
      </div>
      <div className="feed-list">
        <AnimatePresence initial={false}>
          {items.map((a) => (
            <motion.div
              key={a.id}
              className={`feed-item ${a.status}`}
              initial={{ opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25 }}
            >
              <div className="feed-top">
                <span className="feed-agent">{AGENT_LABEL[a.agent] ?? a.agent}</span>
                <span className="feed-time">{timeAgo(a.at)}</span>
              </div>
              <div className="feed-summary">
                {a.status === "running" && <span className="spinner" />}
                {a.summary}
              </div>
              {a.detail && <div className="feed-detail">{a.detail}</div>}
              {a.via && <span className="feed-via">via {a.via}</span>}
            </motion.div>
          ))}
        </AnimatePresence>
        {items.length === 0 && <div className="muted pad">No activity yet.</div>}
      </div>
    </aside>
  );
}

// ------------------------------------------------------------------- overview

export function Overview({ state, meta }: { state: AppState; meta: Map<string, ParticipantMeta> }) {
  const agreements = state.findings.filter((f) => f.type === "agreement");
  const unique = state.findings.filter((f) => f.type === "unique_claim");
  const open = state.findings.filter((f) => f.type === "open_question");
  const breakdown = classificationBreakdown(state.claims);

  return (
    <div className="overview">
      <section className="ov-card">
        <h3>Case brief</h3>
        <p className="ov-desc">{state.incident?.description}</p>
        <div className="ov-known">
          <div className="why-key">HELD BY {state.incident?.openedBy?.toUpperCase()}</div>
          <p>{state.incident?.knownContext}</p>
          <div className="ov-note">
            Background only. It is never read to a participant, because doing so would
            contaminate their account.
          </div>
        </div>
      </section>

      {breakdown.length > 0 && (
        <section className="ov-card">
          <h3>How the claims stand</h3>
          <div className="class-list">
            {breakdown.map(([k, n]) => (
              <div key={k} className={`class-row ${CLASSIFICATION_TONE[k]}`}>
                <span className="class-n">{n}</span>
                <span className="class-label">{CLASSIFICATION_LABELS[k]}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="ov-card">
        <h3>Corroborated across accounts ({agreements.length})</h3>
        <ul className="plain good">
          {agreements.map((f) => (
            <li key={f.id}>
              {f.title}
              <span className="muted"> — {f.involvedWitnessIds.map((i) => meta.get(i)?.name).filter(Boolean).join(", ")}</span>
            </li>
          ))}
          {agreements.length === 0 && <li className="muted">Nothing corroborated yet.</li>}
        </ul>
      </section>

      <section className="ov-card">
        <h3>Reported by one participant only ({unique.length})</h3>
        <ul className="plain warn">
          {unique.map((f) => <li key={f.id}>{f.title}</li>)}
          {unique.length === 0 && <li className="muted">None.</li>}
        </ul>
        {unique.length > 0 && (
          <div className="ov-note">
            Absence of corroboration is not evidence of inaccuracy.
          </div>
        )}
      </section>

      <section className="ov-card">
        <h3>Still unanswered ({open.length})</h3>
        <ul className="plain neutral">
          {open.slice(0, 8).map((f) => <li key={f.id}>{f.title}</li>)}
          {open.length === 0 && <li className="muted">None.</li>}
        </ul>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------- evidence

export function EvidenceView({ state }: { state: AppState }) {
  return (
    <div className="evidence">
      <section>
        <h3>Case material ({state.evidence.length})</h3>
        <div className="ev-grid">
          {state.evidence.map((e) => (
            <div key={e.id} className="ev-card">
              <div className="ev-top">
                <span className={`ev-kind ${e.kind}`}>{e.kind}</span>
                {e.demo && <span className="chip demo">DEMO FILE</span>}
              </div>
              <div className="ev-name">{e.filename}</div>
              <div className="ev-desc">{e.description}</div>
              {e.processedAt ? (
                <div className="ev-proc">
                  <span className={`chip ${e.processedBy === "docker" ? "live" : "demo"}`}>
                    {e.processedBy === "docker" ? "SANDBOXED (docker)" : "LOCAL FALLBACK"}
                  </span>
                  {Array.isArray((e.extracted as { notes?: string[] })?.notes) &&
                    ((e.extracted as { notes: string[] }).notes ?? []).map((n, i) => (
                      <div key={i} className="ev-note">{n}</div>
                    ))}
                </div>
              ) : (
                <div className="muted small">Not yet processed.</div>
              )}
            </div>
          ))}
          {state.evidence.length === 0 && <div className="muted">No evidence uploaded.</div>}
        </div>
      </section>

      <section>
        <h3>Public sources ({state.externalSources.length})</h3>
        <div className="src-list">
          {state.externalSources.map((s) => (
            <div key={s.id} className={`src-card ${s.bearing}`}>
              <div className="src-top">
                <span className={`chip ${s.bearing}`}>{s.bearing}</span>
                <span className={`chip ${s.provider === "demo_fixture" ? "demo" : "live"}`}>
                  {s.provider}
                </span>
                <span className="muted small">{new Date(s.retrievedAt).toLocaleTimeString()}</span>
              </div>
              <a className="src-title" href={s.url} target="_blank" rel="noreferrer">
                {s.title}
              </a>
              <div className="src-url">{s.url}</div>
              <p className="src-snippet">{s.snippet}</p>
              <div className="src-rel">{s.relevance}</div>
            </div>
          ))}
          {state.externalSources.length === 0 && (
            <div className="muted">No public sources retrieved yet.</div>
          )}
        </div>
      </section>
    </div>
  );
}

// --------------------------------------------------------------------- report

export function ReportView({ state }: { state: AppState }) {
  const r = state.report;
  if (!r) {
    return (
      <div className="tl-empty">
        <div className="tl-empty-title">No report yet</div>
        <div className="tl-empty-sub">
          Run the reconstruction — the report is written from the reconciled findings.
        </div>
      </div>
    );
  }

  return (
    <div className="report">
      <div className="rep-head">
        <div>
          <div className="rep-ref">{state.incident?.referenceId}</div>
          <h2>{state.incident?.title}</h2>
        </div>
        <a className="btn-primary" href="/api/report.md" download>
          Download report
        </a>
      </div>

      <div className="rep-conf">
        <div className="rep-conf-n">{r.confidence}%</div>
        <div>
          <div className="rep-conf-l">Reconstruction confidence</div>
          <div className="muted small">{r.confidenceBasis}</div>
        </div>
      </div>

      <section className="ov-card">
        <h3>Summary</h3>
        <p>{r.summary}</p>
      </section>

      <div className="rep-cols">
        <section className="ov-card">
          <h3 className="good">Established</h3>
          <ul className="plain good">
            {r.established.map((x, i) => <li key={i}>{x}</li>)}
            {r.established.length === 0 && <li className="muted">None.</li>}
          </ul>
        </section>
        <section className="ov-card">
          <h3 className="bad">Disputed</h3>
          <ul className="plain bad">
            {r.disputed.map((x, i) => <li key={i}>{x}</li>)}
            {r.disputed.length === 0 && <li className="muted">None.</li>}
          </ul>
        </section>
        <section className="ov-card">
          <h3 className="warn">Unresolved</h3>
          <ul className="plain warn">
            {r.unresolved.map((x, i) => <li key={i}>{x}</li>)}
            {r.unresolved.length === 0 && <li className="muted">None.</li>}
          </ul>
        </section>
      </div>

      <section className="ov-card next">
        <div className="why-key">RECOMMENDED NEXT ACTION</div>
        <p className="next-action">{r.recommendedNextAction}</p>
      </section>

      <div className="ov-note">
        BlackBox reports what accounts agree on, where they are incompatible, and what remains
        unknown. It does not determine fault, and an inconsistent recollection is not evidence of
        dishonesty.
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ transcript

export function TranscriptModal({
  participant,
  state,
  meta,
  onClose,
}: {
  participant: Participant;
  state: AppState;
  meta: Map<string, ParticipantMeta>;
  onClose: () => void;
}) {
  const iv = state.interviews.find((i) => i.witnessId === participant.id);
  const m = meta.get(participant.id);
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>
            Transcript — {participant.displayName}
            <span className="muted"> · {participant.descriptor}</span>
          </span>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {(iv?.transcript ?? []).map((t, i) => (
            <div key={i} className={`turn ${t.speaker}`}>
              <div className="turn-spk" style={t.speaker === "witness" ? { color: m?.color } : undefined}>
                {t.speaker === "agent" ? "BLACKBOX" : participant.displayName.toUpperCase()}
              </div>
              <div className="turn-text">{t.text}</div>
            </div>
          ))}
          {!iv?.transcript.length && <div className="muted">No transcript captured.</div>}
        </div>
      </div>
    </div>
  );
}

export function ContradictionSummary({ findings }: { findings: Finding[] }) {
  return <span>{findings.length}</span>;
}
