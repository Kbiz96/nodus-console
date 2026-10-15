import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { mandateSave } from "../lib/data.ts";
import { buildCriteria } from "../lib/filters.ts";
import { LINES, LINE_LABEL } from "../lib/labels.ts";
import { friendlyError } from "../lib/rules.ts";

export interface MandateInitial {
  id?: string;
  label?: string;
  line?: string;
  side?: string;
  capital_circle?: boolean;
  active?: boolean;
  criteria?: Record<string, unknown> | null;
}

function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}
function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

export default function MandateForm({ initial, onSaved }: { initial: MandateInitial; onSaved: (id: string) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = initial.criteria ?? {};
  const wanted = arr(c.lines);
  const editing = Boolean(initial.id);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const get = (k: string) => String(fd.get(k) ?? "");
    const label = get("label").trim().slice(0, 200);
    const built = buildCriteria({
      label,
      line: get("line"),
      side: get("side"),
      targetSide: get("target_side"),
      lines: fd.getAll("lines").map(String),
      countries: get("countries"),
      mwMin: get("mw_min"),
      mwMax: get("mw_max"),
      amountMin: get("amount_min_usd"),
      amountMax: get("amount_max_usd"),
      keywords: get("keywords"),
      notes: get("notes"),
    });
    if ("error" in built) {
      setError(built.error);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const id = await mandateSave({
        id: initial.id ?? null,
        label,
        line: get("line"),
        side: get("side"),
        criteria: built.criteria,
        capitalCircle: fd.get("capital_circle") === "on",
        active: initial.active ?? true,
      });
      if (!editing) form.reset();
      onSaved(id);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="card stack mandate-form" key={initial.id ?? "new"}>
      <h2>{editing ? `Edit “${initial.label}”` : "Add a mandate"}</h2>

      <label className="field">
        <span>Name</span>
        <small>What you call this client. It can be anonymous, e.g. “Investor A”.</small>
        <input name="label" required maxLength={200} defaultValue={initial.label ?? ""} />
      </label>

      <div className="grid-2">
        <label className="field">
          <span>Main line</span>
          <small>The business line this mandate mainly belongs to.</small>
          <select name="line" required defaultValue={initial.line ?? "critical_power"}>
            {LINES.map((l) => <option key={l} value={l}>{LINE_LABEL[l]}</option>)}
          </select>
        </label>
        <label className="field">
          <span>They are</span>
          <small>Whether this client has something to offer, or needs something.</small>
          <select name="side" required defaultValue={initial.side ?? "need"}>
            <option value="need">Looking for something (need)</option>
            <option value="supply">Offering something (supply)</option>
          </select>
        </label>
      </div>

      <fieldset className="field">
        <legend>Lines they want to see</legend>
        <small>Opportunities from these lines will be checked against this mandate. None ticked means the main line only.</small>
        <div className="checks">
          {LINES.map((l) => (
            <label key={l} className="check">
              <input type="checkbox" name="lines" value={l} defaultChecked={wanted.includes(l)} />
              <span>{LINE_LABEL[l]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="field">
        <span>They are looking for</span>
        <small>Which kind of opportunity to match them with.</small>
        <select name="target_side" required defaultValue={str(c.target_side) || (initial.side === "supply" ? "need" : "supply")}>
          <option value="supply">Things on offer (supply)</option>
          <option value="need">People who need something (need)</option>
        </select>
      </label>

      <label className="field">
        <span>Countries</span>
        <small>Two-letter country codes separated by commas, e.g. GB, US, AE. Leave blank for anywhere.</small>
        <input name="countries" defaultValue={arr(c.countries).join(", ")} placeholder="GB, US" autoCapitalize="characters" />
      </label>

      <div className="grid-2">
        <label className="field">
          <span>Smallest size (MW)</span>
          <small>Ignore anything smaller than this.</small>
          <input name="mw_min" type="number" min="0" step="any" inputMode="decimal" defaultValue={str(c.mw_min)} />
        </label>
        <label className="field">
          <span>Largest size (MW)</span>
          <small>Ignore anything bigger than this.</small>
          <input name="mw_max" type="number" min="0" step="any" inputMode="decimal" defaultValue={str(c.mw_max)} />
        </label>
        <label className="field">
          <span>Smallest amount (US$)</span>
          <small>For capital: the smallest cheque or raise of interest.</small>
          <input name="amount_min_usd" type="number" min="0" step="any" inputMode="numeric" defaultValue={str(c.amount_min_usd)} />
        </label>
        <label className="field">
          <span>Largest amount (US$)</span>
          <small>For capital: the largest cheque or raise of interest.</small>
          <input name="amount_max_usd" type="number" min="0" step="any" inputMode="numeric" defaultValue={str(c.amount_max_usd)} />
        </label>
      </div>

      <label className="field">
        <span>Keywords</span>
        <small>Words separated by commas; at least one must appear in an opportunity, e.g. turbine, H100, brownfield.</small>
        <input name="keywords" defaultValue={arr(c.keywords).join(", ")} />
      </label>

      <label className="field">
        <span>Notes</span>
        <small>Anything else worth remembering about what they want. Not used for matching.</small>
        <textarea name="notes" rows={3} defaultValue={str(c.notes)} />
      </label>

      <label className="check">
        <input type="checkbox" name="capital_circle" defaultChecked={Boolean(initial.capital_circle)} />
        <span>Nodus Capital Circle — first look (these matches get a small boost so they appear first)</span>
      </label>

      {error && <p className="error" role="alert">{error}</p>}
      <div className="action-row">
        <button className="btn primary" type="submit" disabled={pending}>{pending ? "Saving…" : editing ? "Save changes" : "Add mandate"}</button>
        {editing && <Link className="btn ghost" to="/mandates">Cancel</Link>}
      </div>
    </form>
  );
}
