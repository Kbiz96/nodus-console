import { useState } from "react";
import { leadsDecide } from "../lib/data.ts";
import { LEAD_UNDO_MS, decide, type Lead, type LeadOverrides, type LeadStatus } from "../lib/leads.ts";
import { friendlyError } from "../lib/rules.ts";
import { toast } from "./Toast.tsx";

export function whoLabel(names: (string | null | undefined)[]): string {
  const n = names.length;
  if (n === 1) return names[0] || "1 person";
  if (n === 2 && names.every(Boolean)) return `${names[0]} and ${names[1]}`;
  return `${n} people`;
}

/**
 * Approve, dismiss or put back: on screen at once, then saved; approve and dismiss offer Undo for 6 seconds.
 * Shared by the signed-mandate cards and the Background BD queue.
 */
export function useLeadDecide(): { over: LeadOverrides; decideLeads: (rows: Lead[], status: LeadStatus, quiet?: boolean) => Promise<void> } {
  const [over, setOver] = useState<LeadOverrides>(new Map());
  const decideLeads = async (rows: Lead[], status: LeadStatus, quiet = false): Promise<void> => {
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return;
    const before = new Map(ids.map((id) => [id, over.has(id) ? over.get(id)! : rows.find((r) => r.id === id)!.status] as const));
    setOver((m) => decide(m, ids, status));
    try {
      await leadsDecide(ids, status);
    } catch (e) {
      setOver((m) => {
        const next = new Map(m);
        for (const [id, st] of before) next.set(id, st);
        return next;
      });
      toast(`That did not save: ${friendlyError(e)}`, false);
      return;
    }
    window.dispatchEvent(new Event("nodus-leads-changed"));
    if (quiet) return;
    if (status === "new") {
      toast(`Moved back to new leads: ${whoLabel(rows.map((r) => r.name))}.`);
      return;
    }
    const verb = status === "approved" ? "Approved" : "Dismissed";
    toast(`${verb} ${rows.length === 1 ? rows[0].name : `${rows.length} leads`}.`, true, {
      ms: LEAD_UNDO_MS,
      actions: [{ label: "Undo", primary: true, run: () => void decideLeads(rows.map((r) => ({ ...r, status })), "new", true).then(() => toast("Undone.")) }],
    });
  };
  return { over, decideLeads };
}
