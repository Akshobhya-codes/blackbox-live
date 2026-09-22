import { useState } from "react";
import { motion } from "framer-motion";
import { post } from "../lib/api";
import type { AppState } from "../lib/types";

interface Props {
  state: AppState;
  onOpenCase: (id: string) => void;
  onNotify: (text: string, err?: boolean) => void;
  onRefresh: () => void;
}

export default function CaseLibrary({ state, onOpenCase, onNotify, onRefresh }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const importLive = async () => {
    setBusy("import");
    try {
      const r = await post<{ created: number; found: number }>("/api/cases/import", { limit: 6 });
      onNotify(
        r.created > 0
          ? `Imported ${r.created} live case${r.created === 1 ? "" : "s"} from DataSF`
          : `No new cases — all ${r.found} already in the library`,
      );
      onRefresh();
    } catch (e) {
      onNotify((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string, ref: string) => {
    if (!confirm(`Delete case ${ref}? Its statements and findings go with it.`)) return;
    setBusy(id);
    try {
      await post(`/api/cases/${id}`, undefined, "DELETE");
      onNotify("Case deleted");
      onRefresh();
    } catch (e) {
      onNotify((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="library">
      <div className="lib-head">
        <div>
          <h2>Case library</h2>
          <div className="muted small">
            {state.cases.length} case{state.cases.length === 1 ? "" : "s"} on file
          </div>
        </div>
        <div className="lib-actions">
          <button className="btn-sm" onClick={() => setShowNew((v) => !v)}>
            {showNew ? "Cancel" : "New case"}
          </button>
          <button className="btn-primary" onClick={importLive} disabled={busy === "import"}>
            {busy === "import" ? "Importing…" : "Import live SF cases"}
          </button>
        </div>
      </div>

      {showNew && (
        <NewCaseForm
          onDone={(ref) => {
            setShowNew(false);
            onNotify(`Case ${ref} opened`);
            onRefresh();
          }}
          onError={(m) => onNotify(m, true)}
        />
      )}

      <div className="lib-grid">
        {state.cases.map((c) => (
          <motion.div
            key={c.id}
            className={`lib-card${c.active ? " active" : ""}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="lib-top">
              <span className="case-ref">{c.referenceId}</span>
              {c.active && <span className="chip live">OPEN</span>}
              {c.contradictions > 0 && (
                <span className="chip challenges">{c.contradictions} conflict{c.contradictions === 1 ? "" : "s"}</span>
              )}
            </div>
            <div className="lib-title">{c.title}</div>
            <div className="lib-meta">
              {c.location} · {c.approximateTime}
            </div>
            <div className="lib-meta muted">
              {c.participants} participant{c.participants === 1 ? "" : "s"} · {c.openedBy}
            </div>
            <div className="lib-btns">
              <button
                className="btn-sm accent"
                onClick={() => onOpenCase(c.id)}
                disabled={c.active}
              >
                {c.active ? "Currently open" : "Open case"}
              </button>
              <button
                className="btn-sm danger"
                onClick={() => remove(c.id, c.referenceId)}
                disabled={busy === c.id}
              >
                Delete
              </button>
            </div>
          </motion.div>
        ))}
        {state.cases.length === 0 && (
          <div className="muted">No cases yet. Import live SF cases or create one.</div>
        )}
      </div>
    </div>
  );
}

const TEMPLATES = [
  { label: "Traffic collision", type: "Traffic collision", openedBy: "SFPD Traffic Collision Investigation Unit" },
  { label: "Workplace incident", type: "Workplace safety incident", openedBy: "Site Safety Office" },
  { label: "Insurance claim", type: "Insurance claim", openedBy: "Claims Investigation" },
];

function NewCaseForm({
  onDone,
  onError,
}: {
  onDone: (ref: string) => void;
  onError: (m: string) => void;
}) {
  const [f, setF] = useState({
    title: "",
    type: TEMPLATES[0].type,
    referenceId: "",
    openedBy: TEMPLATES[0].openedBy,
    location: "",
    approximateTime: "",
    description: "",
    knownContext: "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  return (
    <form
      className="form lib-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await post("/api/case", f);
          onDone(f.referenceId || f.title);
        } catch (err) {
          onError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="tpl-row">
        <span className="hint">Template</span>
        {TEMPLATES.map((t) => (
          <button
            key={t.label}
            type="button"
            className="btn-sm"
            onClick={() => setF((p) => ({ ...p, type: t.type, openedBy: t.openedBy }))}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid2">
        <label>
          Case title
          <input value={f.title} onChange={set("title")} required placeholder="Intersection collision" />
        </label>
        <label>
          Reference
          <input value={f.referenceId} onChange={set("referenceId")} placeholder="BB-205" />
        </label>
      </div>
      <div className="grid2">
        <label>
          Location
          <input value={f.location} onChange={set("location")} placeholder="4th & Harrison, San Francisco" />
        </label>
        <label>
          Approximate time
          <input value={f.approximateTime} onChange={set("approximateTime")} placeholder="8:42 PM" />
        </label>
      </div>
      <label>
        What is known so far
        <span className="hint">
          Reports, logs, prior statements. Background for the agent only — never read to a
          participant.
        </span>
        <textarea rows={3} value={f.knownContext} onChange={set("knownContext")} />
      </label>
      <button className="btn-outline" type="submit" disabled={busy}>
        {busy ? "Opening…" : "Open case"}
      </button>
    </form>
  );
}
