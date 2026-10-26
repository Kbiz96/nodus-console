import { copyNow, enrichRequest } from "../lib/data.ts";
import { claudeLink } from "../lib/claude.ts";
import { enrichPrompt } from "../lib/mandates.ts";
import { friendlyError } from "../lib/rules.ts";
import { Icon } from "./Brand.tsx";
import { toast } from "./Toast.tsx";

type Opp = { id: string; title: string | null };

/**
 * "Enrich & draft": one click (a) asks the engine for decision makers through enrich_request, the same path as
 * the Enrich button, and (b) opens Claude with the instruction to enrich and draft first touches (also copied).
 * Nothing is sent: drafts land in the console for approval.
 */
export default function EnrichDraft({ opps, match, className = "btn primary", onAsked }: {
  opps: Opp[];
  /** For a match, ask for both sides in one request. */
  match?: string;
  className?: string;
  onAsked?: () => void;
}) {
  const real = opps.filter((o) => o.id);
  if (real.length === 0) return null;
  const prompt = enrichPrompt(real);
  const link = claudeLink(prompt);
  const click = () => {
    const copied = copyNow(prompt);
    const paste = !link.full && copied ? " The instruction is on your clipboard: paste it into the chat." : "";
    void (match ? enrichRequest({ match }) : enrichRequest({ opp: real[0].id })).then(
      (rs) => {
        const ok = rs.filter((r) => r.ok).length;
        const why = rs.find((r) => !r.ok)?.why;
        toast(
          ok > 0
            ? `Marked for enrichment${rs.length > 1 ? ` (${ok} of ${rs.length})` : ""}. Claude is drafting in the new tab.${paste}`
            : `Claude is drafting in the new tab.${paste} The engine did not queue it: ${why ?? "nothing to enrich"}`,
          ok > 0,
        );
        onAsked?.();
      },
      (e) => toast(`Claude is drafting in the new tab. Enrichment was not queued: ${friendlyError(e)}`, false),
    );
    if (!copied) toast("Opening Claude. If the box is empty, copy the instruction from the opportunity page.");
    else if (!link.full) toast("The instruction is too long for the link, so it is on your clipboard. Paste it into the new Nodus chat.");
  };
  return (
    <a className={className} href={link.url} target="_blank" rel="noopener noreferrer" onClick={click} title="Finds decision makers and drafts first touches for your approval. Nothing is sent.">
      <Icon.claude />Enrich &amp; draft
    </a>
  );
}
