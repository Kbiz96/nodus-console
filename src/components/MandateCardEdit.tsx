import { useState, type FormEvent } from "react";
import { mandateCardUpdate } from "../lib/data.ts";
import { CARD_FIELDS, CONFIDENCES, CONFIDENCE_LABEL, MANDATE_KINDS, MANDATE_KIND_LABEL } from "../lib/crm.ts";
import { friendlyError } from "../lib/rules.ts";

export interface MandateCardRow {
  id: string;
  kind: string | null;
  holder: string | null;
  confidence: string | null;
  to_ask: string | null;
  card: Record<string, unknown> | null;
}

function str(v: unknown): string {
  return v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
}

export function ConfidenceBadge({ value }: { value: string | null }) {
  if (!value) return null;
  return <span className={`badge conf-${value}`}>{CONFIDENCE_LABEL[value] ?? value}</span>;
}

/** The mandate card (from the old HQ): shown read-only, with an Edit button that opens the form. */
export default function MandateCardEdit({ m, onSaved }: { m: MandateCardRow; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const card = m.card ?? {};
  const filled = CARD_FIELDS.filter((f) => str(card[f.key]).trim());

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const get = (k: string) => String(fd.get(k) ?? "").trim();
    // Keep any other keys already on the card; set or clear the seven known ones.
    const next: Record<string, unknown> = { ...card };
    for (const f of CARD_FIELDS) {
      const v = get(`card_${f.key}`);
      if (v) next[f.key] = v;
      else delete next[f.key];
    }
    setPending(true);
    setError(null);
    try {
      await mandateCardUpdate(m.id, {
        kind: get("kind") || null,
        holder: get("holder") || null,
        confidence: get("confidence") || null,
        to_ask: get("to_ask") || null,
        card: next,
      });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setPending(false);
    }
  };

  if (!editing) {
    return (
      <div className="stack-xs mandate-card">
        {(m.holder || filled.length > 0 || m.to_ask) && (
          <dl className="facts small">
            {m.holder && <div><dt>Holder (internal)</dt><dd>{m.holder}</dd></div>}
            {filled.map((f) => <div key={f.key}><dt>{f.label}</dt><dd>{str(card[f.key])}</dd></div>)}
            {m.to_ask && <div><dt>To ask</dt><dd>{m.to_ask}</dd></div>}
          </dl>
        )}
        <div>
          <button className="btn small ghost" type="button" onClick={() => setEditing(true)}>Edit card</button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="stack mandate-card">
      <div className="grid-2">
        <label className="field">
          <span>Kind</span>
          <select name="kind" defaultValue={m.kind ?? ""}>
            <option value="">—</option>
            {MANDATE_KINDS.map((k) => <option key={k} value={k}>{MANDATE_KIND_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Confidence</span>
          <select name="confidence" defaultValue={m.confidence ?? ""}>
            <option value="">—</option>
            {CONFIDENCES.map((c) => <option key={c} value={c}>{CONFIDENCE_LABEL[c]}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Holder (internal name)</span>
          <input name="holder" defaultValue={m.holder ?? ""} maxLength={200} />
        </label>
        {CARD_FIELDS.map((f) => (
          <label key={f.key} className="field">
            <span>{f.label}</span>
            <input name={`card_${f.key}`} defaultValue={str(card[f.key])} maxLength={500} />
          </label>
        ))}
      </div>
      <label className="field">
        <span>To ask</span>
        <small>What you still need to find out from them.</small>
        <textarea name="to_ask" rows={2} defaultValue={m.to_ask ?? ""} />
      </label>
      {error && <p className="error small" role="alert">{error}</p>}
      <div className="action-row">
        <button className="btn primary small" type="submit" disabled={pending}>{pending ? "Saving…" : "Save card"}</button>
        <button className="btn ghost small" type="button" disabled={pending} onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </form>
  );
}
