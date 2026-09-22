import { useState } from "react";
import { motion } from "framer-motion";
import { post } from "../lib/api";
import type { ParticipantMeta } from "../lib/view";
import type { AppState, FollowUpQuestion } from "../lib/types";

/**
 * What to ask each person next.
 *
 * Questions are assigned per participant because that is how an interview
 * actually works: the gap only Priya can fill is not the gap only Ethan can
 * fill. The list rebuilds after every statement, so one new account changes
 * what everyone else should be asked.
 */
export default function Questions({
  state,
  meta,
  onNotify,
  onCall,
  onAddWitness,
}: {
  state: AppState;
  meta: Map<string, ParticipantMeta>;
  onNotify: (text: string, err?: boolean) => void;
  onCall: (id: string, name: string) => void;
  onAddWitness: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const prioritise = async (q: FollowUpQuestion) => {
    setBusy(q.id);
    try {
      await post(`/api/followups/${q.id}/prioritise`);
      onNotify("Moved to the front of the queue");
    } catch (e) {
      onNotify((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  };

  const forParticipant = (id: string) =>
    state.followUps.filter((f) => f.targetParticipantIds.includes(id));

  // Questions with nobody to put them to yet — usually because the roster is
  // one person deep. Surfaced rather than hidden, so the gap is visible.
  const unassigned = state.followUps.filter((f) => f.targetParticipantIds.length === 0);

  if (state.followUps.length === 0) {
    return (
      <div className="tl-empty">
        <div className="tl-empty-title">No outstanding questions</div>
        <div className="tl-empty-sub">
          Questions appear as soon as the first statement is taken — every gap and every
          conflict produces one.
        </div>
      </div>
    );
  }

  return (
    <div className="questions">
      <div className="lib-head">
        <div>
          <h2>Questions to ask</h2>
          <div className="muted small">
            Rebuilt after every statement. Ranked by how much an answer would settle.
          </div>
        </div>
        <button className="btn-sm accent" onClick={onAddWitness}>
          + Add witness
        </button>
      </div>

      {state.participants.map((p) => {
        const qs = forParticipant(p.id);
        const m = meta.get(p.id)!;
        return (
          <motion.section
            key={p.id}
            className="q-block"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="q-head">
              <span
                className="avatar sm"
                style={{ background: `${m.color}22`, color: m.color, borderColor: `${m.color}66` }}
              >
                {m.initials}
              </span>
              <div className="q-who">
                <div className="q-name">{p.displayName}</div>
                <div className="q-role">{p.descriptor || m.role}</div>
              </div>
              <span className="q-count">{qs.length}</span>
              {p.hasPhone && (
                <button className="btn-sm accent" onClick={() => onCall(p.id, p.displayName)}>
                  Call &amp; ask
                </button>
              )}
            </div>

            {qs.length === 0 ? (
              <div className="muted small pad">
                Nothing outstanding for this participant right now.
              </div>
            ) : (
              <ol className="q-list">
                {qs.map((q) => (
                  <li key={q.id} className={q.priority <= 0 ? "pinned" : undefined}>
                    <div className="q-text">{q.witnessPrompt ?? q.question}</div>
                    <div className="q-why">{q.reason}</div>
                    <div className="q-actions">
                      {q.priority <= 0 ? (
                        <span className="chip live">ASKED FIRST</span>
                      ) : (
                        <button
                          className="pin-btn"
                          disabled={busy === q.id}
                          onClick={() => prioritise(q)}
                        >
                          Ask this first
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </motion.section>
        );
      })}

      {unassigned.length > 0 && (
        <section className="q-block">
          <div className="q-head">
            <div className="q-who">
              <div className="q-name">Waiting for another witness</div>
              <div className="q-role">
                Only one person has spoken to these, so there is nobody left to corroborate with
              </div>
            </div>
            <span className="q-count">{unassigned.length}</span>
          </div>
          <ol className="q-list">
            {unassigned.map((q) => (
              <li key={q.id}>
                <div className="q-text">{q.witnessPrompt ?? q.question}</div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

/** Adds a participant to the open case. */
export function AddWitnessForm({
  onDone,
  onError,
}: {
  onDone: (name: string) => void;
  onError: (m: string) => void;
}) {
  const [f, setF] = useState({
    displayName: "",
    phoneNumber: "",
    role: "witness",
    descriptor: "",
    approach: "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await post("/api/participant", f);
          onDone(f.displayName);
        } catch (err) {
          onError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid2">
        <label>
          Name
          <input value={f.displayName} onChange={set("displayName")} required placeholder="Maya Chen" />
        </label>
        <label>
          Phone
          <span className="hint">masked everywhere in the interface</span>
          <input value={f.phoneNumber} onChange={set("phoneNumber")} placeholder="+14155550142" />
        </label>
      </div>
      <div className="grid2">
        <label>
          Role
          <select value={f.role} onChange={set("role")}>
            {["driver", "passenger", "pedestrian", "witness", "employee", "first_responder", "other"].map(
              (r) => (
                <option key={r} value={r}>
                  {r.replace(/_/g, " ")}
                </option>
              ),
            )}
          </select>
        </label>
        <label>
          Descriptor
          <input value={f.descriptor} onChange={set("descriptor")} placeholder="Driver — black Tesla" />
        </label>
      </div>
      <label>
        Approach or vantage point
        <span className="hint">
          Taken from the case file, not from testimony. Two drivers on crossing approaches cannot
          both have had a green light — that check needs this.
        </span>
        <input value={f.approach} onChange={set("approach")} placeholder="northbound on 4th Street" />
      </label>
      <button className="btn-outline" type="submit" disabled={busy}>
        {busy ? "Adding…" : "Add witness"}
      </button>
    </form>
  );
}
