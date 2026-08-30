import { IconClock, IconDoc, IconKebab, IconPin, IconShare } from "../icons";
import type { AppState } from "../lib/types";

interface Props {
  state: AppState;
  connected: boolean;
  preview: boolean;
}

export default function TopBar({ state, connected, preview }: Props) {
  const inc = state.incident;
  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const date = now.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });

  const guava = state.guava;
  const guavaState = !connected
    ? { cls: "err", text: "Disconnected" }
    : guava.inbound
      ? { cls: "ok", text: `Line live · ${guava.agentNumber}` }
      : guava.ready
        ? { cls: "warn", text: "Guava ready · no number" }
        : { cls: "err", text: "Guava offline" };

  return (
    <header className="topbar">
      <div className="brand">
        BLACK<span>BOX</span>
      </div>

      <div className="topbar-incident">
        {inc?.referenceId && <span className="case-ref mono">{inc.referenceId}</span>}
        <span className="topbar-title">{inc?.title ?? "No incident"}</span>
        <span className={`chip-status ${inc?.status ?? "open"}`}>
          {(inc?.status ?? "open").toUpperCase()}
        </span>
        {preview && <span className="chip-preview">PREVIEW DATA</span>}
      </div>

      <div className="topbar-right">
        <div className="topbar-meta">
          <IconClock />
          <span className="mono">{time}</span>
          <span className="muted">{date}</span>
        </div>
        <div className="topbar-sep" />
        <div className="topbar-meta">
          <IconPin />
          <span>{inc?.location ?? "—"}</span>
        </div>
        <div className="topbar-sep" />
        <div className={`guava-pill ${guavaState.cls}`}>
          <span className="dot" />
          <span className="mono">{guavaState.text}</span>
        </div>
        <button className="icon-btn" title="Case file">
          <IconDoc />
        </button>
        <button className="icon-btn" title="Export">
          <IconShare />
        </button>
        <button className="icon-btn" title="More">
          <IconKebab />
        </button>
      </div>
    </header>
  );
}
