import { useState, type ChangeEvent } from "react";
import { crmImport } from "../lib/data.ts";
import { checkHqExport, IMPORT_KEYS } from "../lib/crm.ts";
import { fmtNumber } from "../lib/format.ts";
import { friendlyError } from "../lib/rules.ts";
import { useTitle } from "../components/ui.tsx";

const KEY_LABEL: Record<string, string> = { contacts: "Contacts", deals: "Deals", actions: "Actions", outreach: "Outreach drafts", mandates: "Mandate cards" };

/**
 * One-off import of the old Nodus HQ export. The file is read in this browser and sent only to the database
 * function crm_import. It is never stored, uploaded anywhere else or logged.
 */
export default function Import() {
  useTitle("Import");
  const [parsed, setParsed] = useState<{ value: unknown; date: string | null; counts: Record<string, number>; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const choose = async (e: ChangeEvent<HTMLInputElement>) => {
    setParsed(null);
    setError(null);
    setResult(null);
    const file = e.target.files?.[0];
    if (!file) return;
    let value: unknown;
    try {
      value = JSON.parse(await file.text());
    } catch {
      setError("That file could not be read as JSON.");
      return;
    }
    const check = checkHqExport(value);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setParsed({ value, date: check.date, counts: check.counts, name: file.name });
  };

  const run = async () => {
    if (!parsed) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await crmImport(parsed.value));
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack-lg">
      <div className="section-head page-head-block">
        <span className="eyebrow">Setup</span>
        <h1>Import</h1>
        <p className="muted">One-off: brings your old HQ contacts, deals, actions, drafts and mandate cards into the console.</p>
      </div>
      <section className="card stack" style={{ maxWidth: 560 }}>
        <label className="field">
          <span>HQ export file (.json)</span>
          <small>Read in this browser and sent only to the Nodus database. Safe to run twice: existing records are updated, not duplicated.</small>
          <input type="file" accept="application/json,.json" onChange={choose} />
        </label>
        {parsed && (
          <>
            <p className="small">
              <strong>{parsed.name}</strong>
              {parsed.date && <span className="muted"> · exported {parsed.date}</span>}
            </p>
            <ul className="plain small">
              {IMPORT_KEYS.map((k) => <li key={k}>{KEY_LABEL[k]}: {fmtNumber(parsed.counts[k])}</li>)}
            </ul>
            <div className="action-row">
              <button className="btn primary" type="button" disabled={busy} onClick={run}>{busy ? "Importing…" : "Import now"}</button>
            </div>
          </>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        {result && (
          <div className="stack-xs" role="status">
            <p className="ok">Imported.</p>
            <ul className="plain small">
              {IMPORT_KEYS.map((k) => <li key={k}>{KEY_LABEL[k]}: {typeof result[k] === "number" || typeof result[k] === "string" ? fmtNumber(result[k] as number | string) : "—"}</li>)}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
