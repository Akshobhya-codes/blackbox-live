import { motion } from "framer-motion";
import { opposingSides, type ParticipantMeta } from "../lib/view";
import type { AppState, Finding } from "../lib/types";

interface Props {
  state: AppState;
  meta: Map<string, ParticipantMeta>;
  selected: Finding | null;
  onSelect: (f: Finding | null) => void;
  onAskNext: (id: string) => void;
}

export default function Contradictions({ state, meta, selected, onSelect, onAskNext }: Props) {
  const contradictions = state.findings.filter((f) => f.type === "contradiction");
  const active = selected ?? contradictions[0] ?? null;

  if (contradictions.length === 0) {
    return (
      <div className="tl-empty">
        <div className="tl-empty-title">No contradictions found</div>
        <div className="tl-empty-sub">
          Either the accounts are consistent, or the reconstruction has not run yet.
        </div>
      </div>
    );
  }

  return (
    <div className="contra-wrap">
      <div className="contra-list">
        {contradictions.map((f) => (
          <button
            key={f.id}
            className={`contra-item${active?.id === f.id ? " active" : ""}`}
            onClick={() => onSelect(f)}
          >
            <div className="contra-item-title">{f.title}</div>
            <div className="contra-item-who">
              {f.involvedWitnessIds
                .map((id) => meta.get(id)?.name)
                .filter(Boolean)
                .join(" · ")}
            </div>
          </button>
        ))}
      </div>

      {active && <ContradictionDetail finding={active} state={state} meta={meta} onAskNext={onAskNext} />}
    </div>
  );
}

function ContradictionDetail({
  finding,
  state,
  meta,
  onAskNext,
}: {
  finding: Finding;
  state: AppState;
  meta: Map<string, ParticipantMeta>;
  onAskNext: (id: string) => void;
}) {
  const sides = opposingSides(finding, state.claims);
  const followUp = state.followUps.find((f) => f.sourceFindingId === finding.id);
  const resolving = state.externalSources.filter((s) => s.bearing === "challenges" || s.bearing === "supports");

  return (
    <motion.div
      className="contra-detail"
      key={finding.id}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="cannot-banner">
        <span className="cannot-title">These accounts cannot all be true.</span>
        <span className="cannot-sub">
          BlackBox does not determine which account is mistaken, and does not treat an
          inconsistent recollection as a dishonest one.
        </span>
      </div>

      <div className="vs-grid">
        {sides.map((side, i) => {
          const m = meta.get(side.participantId);
          const tone = i === 0 ? "bad" : "good";
          return (
            <motion.div
              key={side.claimId}
              className={`vs-card ${tone}`}
              initial={{ opacity: 0, x: i === 0 ? -20 : 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 + i * 0.1 }}
            >
              <div className="vs-who">
                <span className="avatar" style={{ background: `${m?.color}22`, color: m?.color, borderColor: `${m?.color}66` }}>
                  {m?.initials}
                </span>
                <div>
                  <div className="vs-name">{m?.name}</div>
                  <div className="vs-role">{m?.descriptor || m?.role}</div>
                </div>
              </div>

              <div className="vs-statement">{side.statement}</div>

              <div className="vs-conf-label">Analysis confidence</div>
              <div className={`vs-pct ${tone}`}>{side.confidence}%</div>
              <div className="bar">
                <div className={`bar-fill ${tone}`} style={{ width: `${side.confidence}%` }} />
              </div>

              <div className="src-key">Source excerpt</div>
              <q className="src-quote">{side.excerpt}</q>
              <div className="src-foot">
                <span>stated certainty: {side.certainty}</span>
                <AudioStub label={m?.name ?? "segment"} />
              </div>
            </motion.div>
          );
        })}
        {sides.length >= 2 && <div className="vs-badge">VS</div>}
      </div>

      <div className="why">
        <div className="why-key">WHY THESE CONFLICT</div>
        <p>{finding.explanation}</p>
      </div>

      {followUp?.witnessPrompt && (
        <div className="ask">
          <div className="ask-key">BEST QUESTION TO RESOLVE IT</div>
          <div className="ask-q">{followUp.witnessPrompt}</div>
          <div className="ask-note">
            Phrased so it can be asked without revealing what anyone else said.
          </div>
          <button className="btn-primary" onClick={() => onAskNext(followUp.id)}>
            Ask this on the next call
          </button>
        </div>
      )}

      {resolving.length > 0 && (
        <div className="resolve">
          <div className="why-key">EVIDENCE THAT COULD SETTLE IT</div>
          <ul>
            {resolving.slice(0, 3).map((s) => (
              <li key={s.id}>
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.title}
                </a>
                <span className="muted"> — {s.relevance}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </motion.div>
  );
}

/**
 * Playback control for a recorded segment.
 *
 * Demo interviews are simulated and carry no real audio, so this is disabled
 * and says so rather than presenting a dead play button.
 */
function AudioStub({ label }: { label: string }) {
  return (
    <button className="audio-stub" disabled title={`No recording captured for ${label} in demo mode`}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
        <path d="M8 5v14l11-7z" />
      </svg>
      no recording (demo)
    </button>
  );
}
