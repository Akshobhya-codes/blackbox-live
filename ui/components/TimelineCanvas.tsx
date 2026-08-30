import { useMemo } from "react";
import { EventIcon } from "../icons";
import type { Chip, EventRow, WitnessMeta } from "../lib/model";
import type { Finding } from "../lib/types";

// Fixed drawing grid so the SVG overlay and the DOM chips agree on coordinates
// without measuring anything. The spine sits left of centre because the right
// half carries the label, the badge cluster, and the detail card.
export const CANVAS_W = 900;
export const ROW_H = 116;
export const TOP = 58;
export const SPINE_X = 400;
export const NODE_R = 23;

const LEFT_PILL_EDGE = 214; // right edge of left-hand pills (max width 190 → from 24)
const TIME_RIGHT = 330; // timestamps right-aligned here, in the gap before the node
const TIME_W = 100;
const TICK_X = 348; // small marker between timestamp and node
const LABEL_X = 438;
const LABEL_W = 134;
const FAN_X = 578; // badge connectors fan out from just past the label
const BADGE_X = 594;
const BADGE_STEP = 26;
const PILL_GAP = 30;
const CARD_X = 470;

export type Phase = "idle" | "enter" | "merge" | "separate" | "conflict" | "done";
const PHASE_ORDER: Phase[] = ["idle", "enter", "merge", "separate", "conflict", "done"];
const at = (p: Phase) => PHASE_ORDER.indexOf(p);

const STROKE: Record<string, string> = {
  corroborated: "#35c46b",
  contradiction: "#ff5f56",
  single: "#e0a231",
};

function rowY(i: number): number {
  return TOP + i * ROW_H;
}

/** Everything the renderer needs about one row, computed once. */
interface Placed {
  row: EventRow;
  y: number;
  pills: { chip: Chip; x: number; y: number }[];
  badges: { chip: Chip; x: number; y: number }[];
}

function placeRow(row: EventRow, i: number): Placed {
  const y = rowY(i);

  const badgeChips = row.chips.filter((c) => c.kind === "badge");
  // Corroborated badges sit on the event line; single-source drops below it,
  // which is what makes an uncorroborated account read as an aside.
  const line0 = badgeChips.filter((c) => c.cls !== "single");
  const line1 = badgeChips.filter((c) => c.cls === "single");

  const badges = [
    ...line0.map((chip, n) => ({ chip, x: BADGE_X + n * BADGE_STEP, y })),
    ...line1.map((chip, n) => ({ chip, x: BADGE_X + n * BADGE_STEP, y: y + 26 })),
  ];

  // Right-hand pills start clear of whatever badges the row already has.
  const rightPillX = line0.length > 0 ? BADGE_X + line0.length * BADGE_STEP + 20 : 600;

  const pillChips = row.chips.filter((c) => c.kind === "pill");
  const countOn = (side: "left" | "right") =>
    pillChips.filter((c) => c.side === side).length;

  const pills = pillChips.map((chip) => {
    const count = countOn(chip.side);
    return {
      chip,
      x: chip.side === "left" ? LEFT_PILL_EDGE : rightPillX,
      y: y + (chip.slot - (count - 1) / 2) * PILL_GAP,
    };
  });

  return { row, y, pills, badges };
}

interface Props {
  rows: EventRow[];
  meta: Map<string, WitnessMeta>;
  findings: Finding[];
  phase: Phase;
  selectedEventId: string | null;
  hoveredEventId: string | null;
  selectedWitnessId: string | null;
  onHoverEvent: (id: string | null) => void;
  onSelectEvent: (id: string | null) => void;
  onOpenContradiction: (findingId: string) => void;
}

export default function TimelineCanvas({
  rows,
  meta,
  findings,
  phase,
  selectedEventId,
  hoveredEventId,
  selectedWitnessId,
  onHoverEvent,
  onSelectEvent,
  onOpenContradiction,
}: Props) {
  const height = TOP + Math.max(rows.length, 1) * ROW_H + 20;
  const p = at(phase);
  const settled = phase === "idle" || phase === "done";

  const placed = useMemo(() => rows.map(placeRow), [rows]);

  const links = useMemo(() => {
    const out: {
      key: string;
      d: string;
      cls: string;
      witnessId: string;
      visible: boolean;
      delay: number;
      dashed: boolean;
    }[] = [];

    placed.forEach(({ row, y, pills, badges }, i) => {
      const show = (chip: Chip) =>
        settled ? true : chip.cls === "contradiction" ? p >= at("separate") : p >= at("merge");

      for (const { chip, x, y: cy } of pills) {
        const d =
          chip.side === "left"
            ? `M ${x} ${cy} C ${x + 74} ${cy} ${SPINE_X - 76} ${y} ${SPINE_X - NODE_R - 5} ${y}`
            : `M ${x} ${cy} C ${x - 74} ${cy} ${SPINE_X + 76} ${y} ${SPINE_X + NODE_R + 5} ${y}`;
        out.push({
          key: `${row.id}-${chip.claimId}`,
          d,
          cls: chip.cls,
          witnessId: chip.witnessId,
          visible: show(chip),
          delay: i * 55,
          dashed: chip.cls === "single",
        });
      }

      for (const { chip, x, y: by } of badges) {
        const d = `M ${FAN_X} ${y} C ${FAN_X + 8} ${y} ${x - 14} ${by} ${x - 6} ${by}`;
        out.push({
          key: `${row.id}-${chip.claimId}`,
          d,
          cls: chip.cls,
          witnessId: chip.witnessId,
          visible: show(chip),
          delay: i * 55,
          dashed: chip.cls === "single",
        });
      }
    });
    return out;
  }, [placed, settled, p]);

  // The red arc drawn directly between the two halves of a contradiction.
  const conflicts = useMemo(() => {
    const out: { key: string; d: string; visible: boolean }[] = [];
    for (const { row, pills } of placed) {
      if (row.confidence !== "disputed") continue;
      const left = pills.find((q) => q.chip.side === "left" && q.chip.cls === "contradiction");
      const right = pills.find((q) => q.chip.side === "right" && q.chip.cls === "contradiction");
      if (!left || !right) continue;
      out.push({
        key: `cf-${row.id}`,
        d: `M ${left.x} ${left.y} C ${SPINE_X - 60} ${left.y - 44} ${SPINE_X + 60} ${right.y - 44} ${right.x} ${right.y}`,
        visible: settled ? true : p >= at("conflict"),
      });
    }
    return out;
  }, [placed, settled, p]);

  if (rows.length === 0) {
    return (
      <div className="tl-empty">
        <div className="tl-empty-title">No reconstructed timeline yet</div>
        <div className="tl-empty-sub">
          Complete a witness interview — the timeline builds itself from the call.
        </div>
      </div>
    );
  }

  return (
    <div className="tl-scroll">
      <div className="tl-canvas" style={{ width: CANVAS_W, height }}>
        <svg className="tl-svg" width={CANVAS_W} height={height} aria-hidden="true">
          <defs>
            <linearGradient id="spine" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4f9cf9" stopOpacity="0" />
              <stop offset="10%" stopColor="#63a9fb" stopOpacity="0.95" />
              <stop offset="90%" stopColor="#63a9fb" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#4f9cf9" stopOpacity="0" />
            </linearGradient>
            <filter id="glow" x="-70%" y="-70%" width="240%" height="240%">
              <feGaussianBlur stdDeviation="3" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <line
            x1={SPINE_X}
            y1={TOP - 40}
            x2={SPINE_X}
            y2={rowY(rows.length - 1) + 40}
            stroke="url(#spine)"
            strokeWidth="2"
            filter="url(#glow)"
          />

          {/* timestamp tick + its lead-in to the node */}
          {placed.map(({ row, y }) => (
            <g key={`tick-${row.id}`} opacity="0.55">
              <line
                x1={TICK_X}
                y1={y}
                x2={SPINE_X - NODE_R - 6}
                y2={y}
                stroke="#2c3646"
                strokeWidth="1"
              />
              <circle cx={TICK_X} cy={y} r="2.5" fill="#4f9cf9" />
            </g>
          ))}

          {links.map((l) => {
            const dim = selectedWitnessId !== null && l.witnessId !== selectedWitnessId;
            return (
              <path
                key={l.key}
                d={l.d}
                className={`tl-link ${l.cls}${l.visible ? " on" : ""}${dim ? " dim" : ""}`}
                stroke={STROKE[l.cls]}
                strokeDasharray={l.dashed ? "3 4" : undefined}
                style={{ transitionDelay: `${l.delay}ms` }}
                fill="none"
              />
            );
          })}

          {conflicts.map((c) => (
            <path
              key={c.key}
              d={c.d}
              className={`tl-conflict${c.visible ? " on" : ""}`}
              pathLength={1}
              fill="none"
            />
          ))}

          {/* radar rings around the focused node */}
          {placed.map(({ row, y }) => {
            const open = selectedEventId === row.id || hoveredEventId === row.id;
            if (!open) return null;
            const tone =
              row.confidence === "disputed"
                ? "#ff5f56"
                : row.confidence === "corroborated"
                  ? "#35c46b"
                  : "#4f9cf9";
            return (
              <g key={`rings-${row.id}`} className="tl-rings">
                <circle cx={SPINE_X} cy={y} r={NODE_R + 11} stroke={tone} opacity="0.4" fill="none" />
                <circle cx={SPINE_X} cy={y} r={NODE_R + 23} stroke={tone} opacity="0.22" fill="none" />
                <circle cx={SPINE_X} cy={y} r={NODE_R + 36} stroke={tone} opacity="0.1" fill="none" />
              </g>
            );
          })}
        </svg>

        {placed.map(({ row, y, pills, badges }, i) => {
          const open = selectedEventId === row.id || hoveredEventId === row.id;
          return (
            <div key={row.id}>
              <div
                className={`tl-time${open ? " active" : ""}`}
                style={{ top: y - 9, left: TIME_RIGHT - TIME_W, width: TIME_W }}
              >
                {row.time ?? `STEP ${row.step}`}
              </div>

              <button
                className={`tl-node ${row.confidence}${open ? " open" : ""}`}
                style={{ top: y - NODE_R, left: SPINE_X - NODE_R, width: NODE_R * 2, height: NODE_R * 2 }}
                onMouseEnter={() => onHoverEvent(row.id)}
                onMouseLeave={() => onHoverEvent(null)}
                onClick={() => {
                  if (row.contradictionId) onOpenContradiction(row.contradictionId);
                  onSelectEvent(selectedEventId === row.id ? null : row.id);
                }}
                aria-label={`${row.label} — ${row.confidence}`}
              >
                <EventIcon eventKey={row.eventKey} size={20} />
              </button>

              <div className="tl-label" style={{ top: y - 18, left: LABEL_X, width: LABEL_W }}>
                {row.label}
              </div>

              {badges.map(({ chip, x, y: by }) => {
                const w = meta.get(chip.witnessId);
                const dim = selectedWitnessId !== null && chip.witnessId !== selectedWitnessId;
                const visible = settled ? true : p >= at("enter");
                return (
                  <button
                    key={chip.claimId}
                    className={`tl-badge ${chip.cls}${dim ? " dim" : ""}${visible ? " on" : ""}`}
                    style={{
                      top: by - 10,
                      left: x,
                      borderColor: chip.cls === "single" ? "#e0a231" : (w?.color ?? "#8695a8"),
                      color: w?.color ?? "#8695a8",
                      transitionDelay: `${i * 55}ms`,
                    }}
                    title={`${w?.name}: ${chip.excerpt}`}
                    onClick={() => chip.findingId && onOpenContradiction(chip.findingId)}
                  >
                    {w?.letter ?? "?"}
                  </button>
                );
              })}

              {pills.map(({ chip, x, y: cy }) => {
                const w = meta.get(chip.witnessId);
                const dim = selectedWitnessId !== null && chip.witnessId !== selectedWitnessId;
                const visible = settled ? true : p >= at("enter");
                const shift =
                  !settled && chip.cls === "contradiction" && p >= at("separate")
                    ? chip.side === "left"
                      ? -14
                      : 14
                    : 0;

                const style: React.CSSProperties =
                  chip.side === "left"
                    ? { top: cy - 14, right: CANVAS_W - x, transform: `translateX(${shift}px)` }
                    : { top: cy - 14, left: x, transform: `translateX(${shift}px)` };

                return (
                  <button
                    key={chip.claimId}
                    className={`tl-chip ${chip.cls}${dim ? " dim" : ""}${visible ? " on" : ""}`}
                    style={{ ...style, transitionDelay: `${i * 55}ms` }}
                    title={`${w?.name}: ${chip.excerpt}`}
                    onClick={() => chip.findingId && onOpenContradiction(chip.findingId)}
                  >
                    <span className="tl-chip-dot" style={{ background: w?.color ?? "#8695a8" }}>
                      {w?.letter ?? "?"}
                    </span>
                    <span className="tl-chip-label">{chip.label}</span>
                  </button>
                );
              })}

              {open && <NodeCard row={row} meta={meta} y={y} findings={findings} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NodeCard({
  row,
  meta,
  y,
  findings,
}: {
  row: EventRow;
  meta: Map<string, WitnessMeta>;
  y: number;
  findings: Finding[];
}) {
  const confidence =
    row.confidence === "corroborated"
      ? Math.min(94, 72 + (row.supportingWitnessIds.length - 2) * 8)
      : row.confidence === "disputed"
        ? 48
        : 45;

  const primary = row.chips[0];
  const primaryWitness = primary ? meta.get(primary.witnessId) : undefined;
  const finding = row.contradictionId
    ? findings.find((f) => f.id === row.contradictionId)
    : undefined;

  return (
    <div className="tl-card" style={{ top: y - 44, left: CARD_X }}>
      <div className="tl-card-head">
        <span className="mono">{row.time ?? `STEP ${row.step}`}</span>
        <span className="tl-card-kind">EVENT CLAIM</span>
      </div>
      <div className="tl-card-title">{finding ? finding.title : row.label}</div>

      <div className="tl-card-row">
        <span className="tl-card-key">SUPPORTED BY</span>
        <span className="tl-card-badges">
          {row.supportingWitnessIds.map((id) => {
            const w = meta.get(id);
            return (
              <span key={id} className="badge" style={{ background: w?.color ?? "#8695a8" }}>
                {w?.letter ?? "?"}
              </span>
            );
          })}
        </span>
      </div>

      <div className="tl-card-row">
        <span className="tl-card-key">CONFIDENCE</span>
        <span className={`tl-card-pct ${row.confidence}`}>{confidence}%</span>
      </div>
      <div className="tl-bar">
        <div className={`tl-bar-fill ${row.confidence}`} style={{ width: `${confidence}%` }} />
      </div>

      {primary && (
        <>
          <div className="tl-card-key mt">
            SOURCE EXCERPT ({primaryWitness?.name.toUpperCase() ?? "WITNESS"})
          </div>
          <q className="tl-card-quote">{primary.excerpt}</q>
          <div className="tl-card-foot">
            <span className="mono">certainty: {primary.certainty}</span>
            <span>Transcribed</span>
          </div>
        </>
      )}
    </div>
  );
}
