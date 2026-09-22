import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  TONE_COLOR,
  buildRows,
  type Bubble,
  type EventRow,
  type ParticipantMeta,
} from "../lib/view";
import type { AppState, Finding } from "../lib/types";

// A fixed drawing grid keeps the SVG connectors and the DOM bubbles in exact
// agreement without measuring anything at runtime.
const W = 940;
const ROW_H = 132;
const TOP = 70;
const SPINE = 392;
const NODE_R = 24;
const LEFT_EDGE = 236;
const RIGHT_EDGE = 560;
const GAP = 34;

const ICONS: Record<string, string> = {
  collision: "M3 17h2l2-5h10l2 5h2M7 12l1-4h8l1 4M6 20a1.5 1.5 0 100-3 1.5 1.5 0 000 3M18 20a1.5 1.5 0 100-3 1.5 1.5 0 000 3",
  horn: "M4 10v4h3l9 4V6l-9 4H4M19 10.5v3",
  braking: "M12 3a9 9 0 100 18 9 9 0 000-18M8 12h8",
  traffic_light: "M9 3h6v18H9zM12 7h.01M12 12h.01M12 17h.01",
  steam: "M6 17h11a3.5 3.5 0 00.3-7 5 5 0 00-9.6-1.3A3.6 3.6 0 006 17z",
  alarm: "M18 8a6 6 0 10-12 0c0 6-2 7-2 7h16s-2-1-2-7M10.5 19a2 2 0 003 0",
  default: "M12 4 2.5 20h19L12 4zM12 10v4M12 17h.01",
};

function rowY(i: number): number {
  return TOP + i * ROW_H;
}

function bubbleY(row: EventRow, b: Bubble, i: number): number {
  const n = row.bubbles.filter((x) => x.side === b.side).length;
  return rowY(i) + (b.slot - (n - 1) / 2) * GAP;
}

interface Props {
  state: AppState;
  meta: Map<string, ParticipantMeta>;
  focusParticipant: string | null;
  onOpenContradiction: (f: Finding) => void;
}

export default function Timeline({ state, meta, focusParticipant, onOpenContradiction }: Props) {
  const rows = useMemo(() => buildRows(state), [state]);
  const [hover, setHover] = useState<string | null>(null);
  const height = TOP + Math.max(rows.length, 1) * ROW_H + 30;

  if (rows.length === 0) {
    return (
      <div className="tl-empty">
        <div className="tl-empty-title">No timeline yet</div>
        <div className="tl-empty-sub">
          Press <strong>Launch Reconstruction</strong> — the timeline assembles itself from the
          interviews as they complete.
        </div>
      </div>
    );
  }

  return (
    <div className="tl-scroll">
      <div className="tl-canvas" style={{ width: W, height }}>
        <svg className="tl-svg" width={W} height={height} aria-hidden="true">
          <defs>
            <linearGradient id="spineGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6ea8fe" stopOpacity="0" />
              <stop offset="8%" stopColor="#6ea8fe" stopOpacity="0.9" />
              <stop offset="92%" stopColor="#6ea8fe" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#6ea8fe" stopOpacity="0" />
            </linearGradient>
            <filter id="soft" x="-70%" y="-70%" width="240%" height="240%">
              <feGaussianBlur stdDeviation="3" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <line
            x1={SPINE}
            y1={TOP - 44}
            x2={SPINE}
            y2={rowY(rows.length - 1) + 44}
            stroke="url(#spineGrad)"
            strokeWidth="2"
            filter="url(#soft)"
          />

          {rows.map((row, i) =>
            row.bubbles.map((b) => {
              const y = rowY(i);
              const by = bubbleY(row, b, i);
              const x = b.side === "left" ? LEFT_EDGE : RIGHT_EDGE;
              const d =
                b.side === "left"
                  ? `M ${x} ${by} C ${x + 70} ${by} ${SPINE - 72} ${y} ${SPINE - NODE_R - 6} ${y}`
                  : `M ${x} ${by} C ${x - 70} ${by} ${SPINE + 72} ${y} ${SPINE + NODE_R + 6} ${y}`;
              const dim = focusParticipant !== null && b.claim.witnessId !== focusParticipant;
              return (
                <motion.path
                  key={b.claim.id}
                  d={d}
                  fill="none"
                  stroke={TONE_COLOR[b.tone]}
                  strokeWidth={b.tone === "bad" ? 1.9 : 1.3}
                  strokeDasharray={b.tone === "warn" ? "3 4" : undefined}
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: dim ? 0.08 : 0.72 }}
                  transition={{ duration: 0.65, delay: i * 0.07, ease: "easeOut" }}
                />
              );
            }),
          )}

          {/* the conflict arc: drawn only between two genuinely opposed bubbles */}
          {rows.map((row, i) => {
            if (row.event.confidence !== "disputed") return null;
            const l = row.bubbles.find((b) => b.side === "left" && b.tone === "bad");
            const r = row.bubbles.find((b) => b.side === "right" && b.tone === "bad");
            if (!l || !r) return null;
            const ly = bubbleY(row, l, i);
            const ry = bubbleY(row, r, i);
            return (
              <motion.path
                key={`arc-${row.event.id}`}
                d={`M ${LEFT_EDGE} ${ly} C ${SPINE - 60} ${ly - 48} ${SPINE + 60} ${ry - 48} ${RIGHT_EDGE} ${ry}`}
                fill="none"
                stroke="#ff5f56"
                strokeWidth="1.8"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 0.95 }}
                transition={{ duration: 0.8, delay: 0.5 + i * 0.07 }}
                style={{ filter: "drop-shadow(0 0 6px rgba(255,95,86,0.6))" }}
              />
            );
          })}
        </svg>

        {rows.map((row, i) => {
          const y = rowY(i);
          const tone =
            row.event.confidence === "disputed"
              ? "#ff5f56"
              : row.event.confidence === "corroborated"
                ? "#3ad6c8"
                : "#f0a94c";
          return (
            <div key={row.event.id}>
              <div className="tl-time" style={{ top: y - 9, left: 60, width: 150 }}>
                {row.event.approximateTime ?? `STEP ${i + 1}`}
              </div>

              <motion.button
                className={`tl-node ${row.event.confidence}`}
                style={{
                  top: y - NODE_R,
                  left: SPINE - NODE_R,
                  width: NODE_R * 2,
                  height: NODE_R * 2,
                  borderColor: tone,
                  color: tone,
                }}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: i * 0.08, type: "spring", stiffness: 260, damping: 18 }}
                whileHover={{ scale: 1.12 }}
                onClick={() => row.contradiction && onOpenContradiction(row.contradiction)}
                title={row.event.label}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d={ICONS[row.event.eventKey] ?? ICONS.default} />
                </svg>
              </motion.button>

              {row.event.confidence === "disputed" && (
                <span className="tl-ring" style={{ top: y - NODE_R - 12, left: SPINE - NODE_R - 12, width: (NODE_R + 12) * 2, height: (NODE_R + 12) * 2 }} />
              )}

              <div className="tl-label" style={{ top: y - 20, left: SPINE + 44, width: 120 }}>
                {row.event.label}
                <div className="tl-sub">
                  {row.event.confidence === "disputed"
                    ? "disputed"
                    : `${row.event.supportingWitnessIds.length} source${row.event.supportingWitnessIds.length === 1 ? "" : "s"}`}
                </div>
              </div>

              {row.bubbles.map((b) => {
                const m = meta.get(b.claim.witnessId);
                const by = bubbleY(row, b, i);
                const dim = focusParticipant !== null && b.claim.witnessId !== focusParticipant;
                const style =
                  b.side === "left"
                    ? { top: by - 15, right: W - LEFT_EDGE }
                    : { top: by - 15, left: RIGHT_EDGE };
                return (
                  <motion.button
                    key={b.claim.id}
                    className={`tl-bubble ${b.tone}${dim ? " dim" : ""}`}
                    style={style}
                    initial={{ opacity: 0, x: b.side === "left" ? -18 : 18 }}
                    animate={{ opacity: dim ? 0.18 : 1, x: 0 }}
                    transition={{ delay: 0.15 + i * 0.07, duration: 0.4 }}
                    onMouseEnter={() => setHover(b.claim.id)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => row.contradiction && onOpenContradiction(row.contradiction)}
                  >
                    <span className="tl-dot" style={{ background: m?.color }}>
                      {m?.initials}
                    </span>
                    <span className="tl-bubble-label">{b.label}</span>
                  </motion.button>
                );
              })}

              <AnimatePresence>
                {row.bubbles
                  .filter((b) => b.claim.id === hover)
                  .map((b) => {
                    const m = meta.get(b.claim.witnessId);
                    const by = bubbleY(row, b, i);
                    return (
                      <motion.div
                        key={`tip-${b.claim.id}`}
                        className="tl-tip"
                        style={{
                          top: by + 22,
                          left: b.side === "left" ? 40 : RIGHT_EDGE,
                        }}
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                      >
                        <div className="tl-tip-head">
                          <span className="tl-dot sm" style={{ background: m?.color }}>
                            {m?.initials}
                          </span>
                          <strong>{m?.name}</strong>
                          <span className="muted">{row.event.approximateTime ?? row.event.label}</span>
                        </div>
                        <q>{b.claim.sourceExcerpt}</q>
                        <div className="tl-tip-foot">
                          <span className={`pill ${b.tone}`}>
                            {b.claim.classification?.replace(/_/g, " ") ?? "unclassified"}
                          </span>
                          <span className="muted">
                            stated certainty: {b.claim.certainty} · analysis{" "}
                            {b.claim.analysisConfidence ?? "—"}%
                          </span>
                        </div>
                      </motion.div>
                    );
                  })}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}
