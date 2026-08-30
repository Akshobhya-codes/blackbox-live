import { IconCheck, IconDoc, IconHeadset, IconPhone, IconPlus } from "../icons";
import type { WitnessMeta } from "../lib/model";
import type { Interview, Witness } from "../lib/types";

const LIVE_STATES = new Set(["live", "ringing"]);

interface Props {
  witnesses: Witness[];
  interviews: Interview[];
  meta: Map<string, WitnessMeta>;
  selectedWitnessId: string | null;
  onSelect: (id: string | null) => void;
  onCall: (id: string) => void;
  onTranscript: (id: string) => void;
  onAdd: () => void;
}

export default function WitnessRail({
  witnesses,
  interviews,
  meta,
  selectedWitnessId,
  onSelect,
  onCall,
  onTranscript,
  onAdd,
}: Props) {
  return (
    <aside className="wrail">
      <div className="wrail-head">
        <span>WITNESSES</span>
        <span className="wrail-count">{witnesses.length}</span>
        <button className="icon-btn small" onClick={onAdd} title="Add witness">
          <IconPlus />
        </button>
      </div>

      <div className="wrail-list">
        {witnesses.length === 0 && (
          <div className="wrail-empty">
            No witnesses yet. Add one, or have them call the BlackBox line.
          </div>
        )}

        {witnesses.map((w) => {
          const m = meta.get(w.id);
          const interview = interviews.find((i) => i.witnessId === w.id);
          const live = LIVE_STATES.has(w.callStatus);
          const done = w.callStatus === "completed";
          const selected = selectedWitnessId === w.id;

          return (
            <div
              key={w.id}
              className={`wcard${selected ? " selected" : ""}${live ? " live" : ""}`}
              style={selected ? { borderColor: m?.color, boxShadow: `0 0 0 1px ${m?.color}55` } : undefined}
              onClick={() => onSelect(selected ? null : w.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(selected ? null : w.id);
                }
              }}
            >
              <div className="wcard-top">
                <span className="wavatar" style={{ background: `${m?.color}22`, color: m?.color, borderColor: `${m?.color}66` }}>
                  {m?.letter}
                </span>
                <div className="wcard-id">
                  <div className="wcard-name">{w.displayName}</div>
                  <div className="wcard-role">{m?.role}</div>
                </div>
              </div>

              <div className="wcard-state">
                {live ? (
                  <>
                    <span className="live-dot" style={{ background: m?.color }} />
                    <span className="live-text" style={{ color: m?.color }}>
                      {w.callStatus === "ringing" ? "RINGING" : "LIVE"}
                    </span>
                    <span className="wave">
                      {Array.from({ length: 9 }).map((_, i) => (
                        <i key={i} style={{ background: m?.color, animationDelay: `${i * 90}ms` }} />
                      ))}
                    </span>
                  </>
                ) : done ? (
                  <>
                    <IconCheck />
                    <span className="done-text">COMPLETED</span>
                  </>
                ) : (
                  <span className={`state-text ${w.callStatus}`}>
                    {w.callStatus.replace("_", " ").toUpperCase()}
                  </span>
                )}
              </div>

              {done && interview && (
                <div className="wcard-dur mono">
                  {completedAt(interview)}
                  {duration(interview) ? ` · ${duration(interview)}` : ""}
                </div>
              )}

              {w.lastError && <div className="wcard-err">{w.lastError}</div>}

              <div className="wcard-actions">
                {live ? (
                  <button className="wbtn" onClick={(e) => stop(e)}>
                    <IconHeadset /> Open call
                  </button>
                ) : interview && interview.transcript.length > 0 ? (
                  <button
                    className="wbtn"
                    onClick={(e) => {
                      stop(e);
                      onTranscript(w.id);
                    }}
                  >
                    <IconDoc /> View transcript
                  </button>
                ) : w.hasPhone ? (
                  <button
                    className="wbtn"
                    onClick={(e) => {
                      stop(e);
                      onCall(w.id);
                    }}
                  >
                    <IconPhone /> Call witness
                  </button>
                ) : (
                  <div className="wcard-note">Awaiting inbound call</div>
                )}
              </div>

              {/* Masked number is only useful before the call connects. */}
              {w.phoneMasked && !live && !done && (
                <div className="wcard-phone mono">{w.phoneMasked}</div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function stop(e: React.MouseEvent) {
  e.stopPropagation();
}

function completedAt(interview: Interview): string {
  const at = interview.endedAt ?? interview.startedAt;
  const d = new Date(at);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function duration(interview: Interview): string {
  if (!interview.endedAt) return "";
  const ms = new Date(interview.endedAt).getTime() - new Date(interview.startedAt).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}
