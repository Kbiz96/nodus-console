import { Link, useParams } from "react-router-dom";
import { supabase, must } from "../lib/supabase.ts";
import { MATCH_CARD_COLS } from "../lib/data.ts";
import { isUuid } from "../lib/filters.ts";
import { useLoad } from "../lib/useLoad.ts";
import type { MatchCardRow } from "../lib/types.ts";
import MatchCard from "../components/MatchCard.tsx";
import { ErrorBox, Loading, NotFound, useTitle } from "../components/ui.tsx";

export default function MatchDetail() {
  const { id = "" } = useParams();
  useTitle("Match");
  const { data, error, loading, reload } = useLoad(async () => {
    if (!isUuid(id)) return null;
    const r = await supabase.from("v_match_cards").select(MATCH_CARD_COLS).eq("id", id).maybeSingle();
    return must(r) as unknown as MatchCardRow | null;
  }, id);
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return <NotFound what="match" />;
  return (
    <div className="stack">
      <p><Link to="/matches">← All matches</Link></p>
      <MatchCard m={data} onChanged={reload} />
    </div>
  );
}
