import { IconPhone, IconX } from "../icons";
import { confidenceFor, opposingSides, type WitnessMeta } from "../lib/model";
import type { Claim, Finding } from "../lib/types";

interface Props {
  finding: Finding | null;
  findings: Finding[];
  claims: Claim[];
  meta: Map<string, WitnessMeta>;
  canCall: boolean;
  engine: string;
  reconStatus: string;
  eventTime: string | null;
  inboundNumber: string | null;
  onClose: () => void;
  onSelectFinding: (id: string) => void;
  onStartCall: () => void;
  onAskNext: (findingId: string) => void;
}

export default function DetailPanel({
  finding,
  findings,
  claims,
  meta,
  canCall,
  engine,
  reconStatus,
  eventTime,
  inboundNumber,
  onClose,
  onSelectFinding,
  onStartCall,
  onAskNext,
}: Props) {
  if (!finding) {
    return (
      <OverviewPanel
        findings={findings}
        onSelectFinding={onSelectFinding}
        canCall={canCall}
        engine={engine}
        reconStatus={reconStatus}
        inboundNumber={inboundNumber}
        onStartCall={onStartCall}
        onAskNext={onAskNext}
      />
    );
  }

  const sides = opposingSides(finding, claims);

  return (
    <aside className="dpanel">
      <div className="dpanel-head">
        <span className="dpanel-kind contradiction">CONTRADICTION</span>
        <button className="icon-btn small" onClick={onClose} title="Close">
          <IconX />
        </button>
      </div>

      <div className="dpanel-event">
        <span>EVENT</span>
        <i />
        <span className="mono">{eventTime ?? finding.title}</span>
      </div>

      <div className="vs-grid">
        {sides.slice(0, 2).map((side, i) => {
          const m = meta.get(side.witnessId);
          const cls: "corroborated" | "contradiction" = i === 0 ? "contradiction" : "corroborated";
          const pct = confidenceFor(side.certainty, cls);
          return (
            <div key={side.witnessId} className={`vs-card ${i === 0 ? "conflict" : ""}`}>
              <div className="vs-who">
                <span
                  className="wavatar sm"
                  style={{ background: `${m?.color}22`, color: m?.color, borderColor: `${m?.color}66` }}
                >
                  {m?.letter}
                </span>
                <div>
                  <div className="vs-name">{m?.name}</div>
                  <div className="vs-role">{m?.role}</div>
                </div>
              </div>

              <div className="vs-statement">{side.statement}</div>

              <div className="vs-conf-key">Confidence</div>
              <div className={`vs-pct ${cls}`}>{pct}%</div>
              <div className="tl-bar">
                <div className={`tl-bar-fill ${cls === "contradiction" ? "disputed" : "corroborated"}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
        {sides.length >= 2 && <div className="vs-badge">VS</div>}
      </div>

      <div className="src-grid">
        {sides.slice(0, 2).map((side) => (
          <div key={side.witnessId} className="src-cell">
            <div className="src-key">Source excerpt</div>
            <q>{side.excerpt}</q>
            <div className="src-foot mono">certainty: {side.certainty} · Transcribed</div>
          </div>
        ))}
      </div>

      <div className="dpanel-expl">{finding.explanation}</div>

      {finding.followUpQuestion && (
        <div className="ask">
          <div className="ask-key">ASK NEXT</div>
          <div className="ask-q">{finding.followUpQuestion}</div>
          <button className="btn-outline" onClick={() => onAskNext(finding.id)}>
            Ask next
          </button>
          {!finding.witnessPrompt && (
            <div className="dpanel-hint">
              Cannot be asked as worded — it would reveal another account.
            </div>
          )}
        </div>
      )}

      <div className="dpanel-foot">
        <button className="btn-outline wide" onClick={onStartCall}>
          <IconPhone /> {canCall ? "Start witness call" : "Take a witness call"}
        </button>
        {!canCall && inboundNumber && (
          <div className="dpanel-hint">
            Outbound needs a witness phone number. Inbound is live — have them call{" "}
            <strong>{inboundNumber}</strong>.
          </div>
        )}
      </div>
    </aside>
  );
}

function OverviewPanel({
  findings,
  onSelectFinding,
  canCall,
  engine,
  reconStatus,
  inboundNumber,
  onStartCall,
  onAskNext,
}: {
  findings: Finding[];
  onSelectFinding: (id: string) => void;
  canCall: boolean;
  engine: string;
  reconStatus: string;
  inboundNumber: string | null;
  onStartCall: () => void;
  onAskNext: (findingId: string) => void;
}) {
  const group = (t: Finding["type"]) => findings.filter((f) => f.type === t);
  const contradictions = group("contradiction");
  const agreements = group("agreement");
  const uniques = group("unique_claim");
  const questions = group("open_question");

  return (
    <aside className="dpanel">
      <div className="dpanel-head">
        <span className="dpanel-kind">FINDINGS</span>
        <span className={`engine-pill ${reconStatus}`}>
          {reconStatus === "processing" ? "analysing…" : engine}
        </span>
      </div>

      <div className="score-row">
        <Score n={agreements.length} label="Agreed" kind="corroborated" />
        <Score n={contradictions.length} label="Conflicts" kind="contradiction" />
        <Score n={uniques.length} label="Single" kind="single" />
        <Score n={questions.length} label="Open Qs" kind="neutral" />
      </div>

      {contradictions.length > 0 && (
        <Section title="Contradictions" kind="contradiction">
          {contradictions.map((f) => (
            <button key={f.id} className="fitem contradiction" onClick={() => onSelectFinding(f.id)}>
              <div className="fitem-title">{f.title}</div>
              {f.followUpQuestion && <div className="fitem-q">{f.followUpQuestion}</div>}
            </button>
          ))}
        </Section>
      )}

      {agreements.length > 0 && (
        <Section title="Corroborated" kind="corroborated">
          {agreements.map((f) => (
            <div key={f.id} className="fitem agreement">
              <div className="fitem-title">{f.title}</div>
            </div>
          ))}
        </Section>
      )}

      {uniques.length > 0 && (
        <Section title="Single source" kind="single">
          {uniques.map((f) => (
            <div key={f.id} className="fitem unique">
              <div className="fitem-title">{f.title}</div>
            </div>
          ))}
        </Section>
      )}

      {questions.length > 0 && (
        <Section title="Open questions" kind="neutral">
          {questions.map((f) => (
            <div key={f.id} className="fitem question">
              <div className="fitem-title">{f.title}</div>
              {f.witnessPrompt && (
                <div className="will-ask">
                  <span className="will-ask-tag">ASKS ON NEXT CALL</span>
                  <span className="will-ask-q">“{f.witnessPrompt}”</span>
                  <button className="pin-btn" onClick={() => onAskNext(f.id)}>
                    Ask this first
                  </button>
                </div>
              )}
            </div>
          ))}
        </Section>
      )}

      {findings.length === 0 && (
        <div className="dpanel-empty">
          Findings appear once an interview has been reconciled.
        </div>
      )}

      <div className="dpanel-foot">
        <button className="btn-outline wide" onClick={onStartCall}>
          <IconPhone /> {canCall ? "Start witness call" : "Take a witness call"}
        </button>
        {!canCall && inboundNumber && (
          <div className="dpanel-hint">
            Inbound line is live — have the witness call <strong>{inboundNumber}</strong>.
          </div>
        )}
      </div>
    </aside>
  );
}

function Score({ n, label, kind }: { n: number; label: string; kind: string }) {
  return (
    <div className={`score ${kind}`}>
      <div className="score-n">{n}</div>
      <div className="score-l">{label}</div>
    </div>
  );
}

function Section({
  title,
  kind,
  children,
}: {
  title: string;
  kind: string;
  children: React.ReactNode;
}) {
  return (
    <div className="fsection">
      <div className={`fsection-head ${kind}`}>
        <i />
        {title}
      </div>
      <div className="fsection-body">{children}</div>
    </div>
  );
}
