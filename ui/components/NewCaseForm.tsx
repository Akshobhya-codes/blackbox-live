import { useState } from "react";
import { post } from "../lib/api";

export const CASE_TYPES = [
  "Police investigation",
  "Insurance claim",
  "Workplace safety incident",
  "Traffic collision",
  "Public transport incident",
  "Healthcare incident",
  "Compliance / internal investigation",
];

interface Draft {
  title: string;
  type: string;
  referenceId: string;
  openedBy: string;
  location: string;
  approximateTime: string;
  description: string;
  knownContext: string;
}

/** Starting points so a case can be opened in seconds during an active callout. */
const TEMPLATES: { name: string; draft: Draft }[] = [
  {
    name: "Traffic collision",
    draft: {
      title: "Intersection Collision — 4th & Harrison",
      type: "Traffic collision",
      referenceId: "PD-2026-4471",
      openedBy: "Northview PD · Traffic Division",
      location: "4th Street & Harrison Avenue, northbound approach",
      approximateTime: "7:40 PM",
      description:
        "Two vehicles collided at a signalled intersection. One driver reported injuries. " +
        "Signal phase at the time of impact is disputed.",
      knownContext:
        "911 call logged 19:41. Two vehicles: a silver sedan northbound and a white van " +
        "westbound. Signal controller log shows a phase change at 19:39:52. Both drivers " +
        "transported for assessment; neither has given a formal statement. No CCTV recovered yet. " +
        "Point of impact and which vehicle had a green signal are not established.",
    },
  },
  {
    name: "Warehouse incident",
    draft: {
      title: "Loading Dock Collision",
      type: "Workplace safety incident",
      referenceId: "WS-2026-0829",
      openedBy: "Site Safety Office",
      location: "Warehouse 14, Loading Dock B",
      approximateTime: "8:12 PM",
      description:
        "A forklift collided with a storage rack, causing part of the rack to collapse and " +
        "triggering an alarm.",
      knownContext:
        "Automated alarm log records an activation at 20:12. Forklift unit 7 was signed out to " +
        "the evening shift. No injuries reported to the site nurse. Rack section B4 confirmed " +
        "damaged. The order of events and the vehicle involved are not established.",
    },
  },
  {
    name: "Insurance claim",
    draft: {
      title: "Slip and Fall — Aisle 6",
      type: "Insurance claim",
      referenceId: "CLM-2026-77218",
      openedBy: "Meridian Insurance · Claims",
      location: "Retail store, Aisle 6, near the chilled section",
      approximateTime: "2:15 PM",
      description:
        "A customer fell in a store aisle and is claiming injury. The presence and duration of " +
        "a floor hazard is disputed.",
      knownContext:
        "Claim filed three days after the incident. Store cleaning log shows a scheduled mop at " +
        "13:50. A wet-floor sign is visible in one photograph, position unclear. Claimant reports " +
        "a knee injury. Store manager disputes that any spill was present. CCTV covers the aisle " +
        "entrance but not the fall location.",
    },
  },
];

const BLANK: Draft = {
  title: "",
  type: "Police investigation",
  referenceId: "",
  openedBy: "",
  location: "",
  approximateTime: "",
  description: "",
  knownContext: "",
};

interface Props {
  onDone: (title: string) => void;
  onError: (message: string) => void;
}

export default function NewCaseForm({ onDone, onError }: Props) {
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [witnesses, setWitnesses] = useState([
    { displayName: "Witness A", phoneNumber: "" },
    { displayName: "Witness B", phoneNumber: "" },
  ]);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof Draft) => (e: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, [k]: e.target.value }));

  const setWitness = (i: number, k: "displayName" | "phoneNumber", v: string) =>
    setWitnesses((ws) => ws.map((w, n) => (n === i ? { ...w, [k]: v } : w)));

  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await post("/api/incident", {
            ...draft,
            witnesses: witnesses.filter((w) => w.displayName.trim()),
          });
          onDone(draft.title);
        } catch (err) {
          onError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="tpl-row">
        <span className="hint">Start from</span>
        {TEMPLATES.map((t) => (
          <button
            key={t.name}
            type="button"
            className="btn-sm"
            onClick={() => setDraft(t.draft)}
          >
            {t.name}
          </button>
        ))}
        <button type="button" className="btn-sm" onClick={() => setDraft(BLANK)}>
          Blank
        </button>
      </div>

      <div className="grid2">
        <label>
          Case title
          <input value={draft.title} onChange={set("title")} required placeholder="Intersection Collision" />
        </label>
        <label>
          Case type
          <select value={draft.type} onChange={set("type")}>
            {CASE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid2">
        <label>
          Reference number
          <input value={draft.referenceId} onChange={set("referenceId")} placeholder="PD-2026-4471" />
        </label>
        <label>
          Opened by
          <input value={draft.openedBy} onChange={set("openedBy")} placeholder="Northview PD" />
        </label>
      </div>

      <div className="grid2">
        <label>
          Location
          <input value={draft.location} onChange={set("location")} placeholder="4th & Harrison" />
        </label>
        <label>
          Approximate time
          <input value={draft.approximateTime} onChange={set("approximateTime")} placeholder="7:40 PM" />
        </label>
      </div>

      <label>
        Incident description
        <textarea rows={2} value={draft.description} onChange={set("description")} />
      </label>

      <label>
        What investigators already hold
        <span className="hint">
          Reports, logs, CCTV, prior statements. Used as background for the agent only — it is
          never read to a witness, so it cannot contaminate their account.
        </span>
        <textarea
          rows={5}
          value={draft.knownContext}
          onChange={set("knownContext")}
          placeholder="911 call logged 19:41. Signal controller log shows a phase change at 19:39:52…"
        />
      </label>

      <div className="roster">
        <div className="hint">
          Witnesses expected to give a statement. A caller who identifies themselves as one of
          these is matched to the roster automatically.
        </div>
        {witnesses.map((w, i) => (
          <div className="grid2" key={i}>
            <input
              value={w.displayName}
              onChange={(e) => setWitness(i, "displayName", e.target.value)}
              placeholder={`Witness ${String.fromCharCode(65 + i)}`}
            />
            <input
              value={w.phoneNumber}
              onChange={(e) => setWitness(i, "phoneNumber", e.target.value)}
              placeholder="+1415… (optional)"
            />
          </div>
        ))}
        <button
          type="button"
          className="btn-sm"
          onClick={() =>
            setWitnesses((ws) => [
              ...ws,
              { displayName: `Witness ${String.fromCharCode(65 + ws.length)}`, phoneNumber: "" },
            ])
          }
        >
          Add witness
        </button>
      </div>

      <button className="btn-outline" type="submit" disabled={busy}>
        {busy ? "Opening case…" : "Open case"}
      </button>
    </form>
  );
}
