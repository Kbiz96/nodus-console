// Global map of opportunities. Loaded only when opened (MapLibre is large).
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Map as MLMap,
  Marker,
  NavigationControl,
  AttributionControl,
  setWorkerUrl,
  type GeoJSONSource,
  type StyleSpecification,
  type ExpressionSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { feature, mesh } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { FeatureCollection, Geometry } from "geojson";
import world from "world-atlas/countries-110m.json";
import usAtlas from "us-atlas/states-10m.json";
import { supabase, must } from "../lib/supabase.ts";
import { useLoad } from "../lib/useLoad.ts";
import { fmtDate, fmtMW, fmtNumber } from "../lib/format.ts";
import { COUNTRIES, REGION_BOUNDS, REGION_GROUPS, mandateCountries, mwOf, placeAll, regionGroup, type Precision, type RegionGroup } from "../lib/geo.ts";
import { GATES, GATE_LABEL, LINES, LINE_COLOUR, LINE_LABEL, SIDE_LABEL, lineColour, linesParam, parseLines } from "../lib/labels.ts";
import { ExtLink, GateBadge, LineBadge, Loading, ErrorBox, useTitle } from "../components/ui.tsx";
import { Icon } from "../components/Brand.tsx";

setWorkerUrl(workerUrl);

interface MapOpp {
  id: string;
  line: string;
  side: string;
  title: string;
  country: string | null;
  region: string | null;
  credibility: number | null;
  gate: string;
  created_at: string;
  organisation_id: string | null;
  mw: unknown;
}
interface MandateRow { id: string; label: string; line: string; side: string; criteria: unknown; kind: string | null; holder: string | null }

const PAGE = 1000;
async function pageAll<T>(fetch: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>, cap = 20000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < cap; from += PAGE) {
    const rows = must(await fetch(from, from + PAGE - 1)) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

async function load() {
  const [opps, links, mandates] = await Promise.all([
    pageAll<MapOpp>((a, b) =>
      supabase.from("opportunities").select("id,line,side,title,country,region,credibility,gate,created_at,organisation_id,mw:specs->mw").order("id").range(a, b),
    ),
    pageAll<{ supply_opportunity_id: string | null; need_opportunity_id: string | null }>((a, b) =>
      supabase.from("matches").select("supply_opportunity_id,need_opportunity_id").neq("status", "rejected").order("id").range(a, b),
    ),
    supabase.from("mandates").select("id,label,line,side,criteria,kind,holder").eq("active", true).limit(500).then((r) => must(r) as MandateRow[]),
  ]);
  const matchCount = new Map<string, number>();
  for (const l of links) {
    for (const id of [l.supply_opportunity_id, l.need_opportunity_id]) if (id) matchCount.set(id, (matchCount.get(id) ?? 0) + 1);
  }
  const placed = placeAll(opps);
  return { opps, placed, matchCount, mandates, unplaced: opps.length - placed.length };
}

const WEEK = 7 * 24 * 3600e3;
const PRECISION_TEXT: Record<Precision, string> = {
  state: "Placed at the centre of its US state; the exact site is not known.",
  place: "Placed at its UK council or county.",
  country: "Placed in its country only; the exact site is not known.",
};

// ---------- base map, drawn from bundled outlines (no keys, no outside style) ----------

const topo = world as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
const countries = feature(topo, topo.objects.countries) as unknown as FeatureCollection<Geometry, { name: string; num: string }>;
for (const f of countries.features) f.properties = { name: f.properties?.name ?? "", num: String(f.id ?? "") };
// Borders and coasts as lines (drawing polygon outlines would also draw tile-clip edges near the poles).
const borderLines = mesh(topo, topo.objects.countries);
const usTopo = usAtlas as unknown as Topology<{ states: GeometryCollection }>;
const stateLines = mesh(usTopo, usTopo.objects.states, (a, b) => a !== b);

function baseStyle(): StyleSpecification {
  return {
    version: 8,
    projection: { type: "globe" },
    sources: {
      carto: {
        type: "raster",
        tiles: ["a", "b", "c", "d"].map((s) => `https://${s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png`),
        tileSize: 256,
        maxzoom: 18,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
      },
      countries: { type: "geojson", data: countries, attribution: "Natural Earth" },
      states: { type: "geojson", data: stateLines },
      borders: { type: "geojson", data: borderLines },
    },
    layers: [
      { id: "ocean", type: "background", paint: { "background-color": "#091110" } },
      { id: "land", type: "fill", source: "countries", paint: { "fill-color": "#122120", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 3, 1, 5, 0.25] } },
      {
        id: "streets",
        type: "raster",
        source: "carto",
        minzoom: 2.5,
        paint: { "raster-opacity": ["interpolate", ["linear"], ["zoom"], 2.5, 0, 4.5, 0.85], "raster-saturation": -0.5, "raster-contrast": 0.08 },
      },
      { id: "mandate-fill", type: "fill", source: "countries", filter: ["in", ["get", "num"], ["literal", []]], paint: { "fill-color": "#76B2A5", "fill-opacity": 0.2 } },
      { id: "borders", type: "line", source: "borders", paint: { "line-color": "rgba(118,178,165,0.32)", "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.4, 5, 0.9] } },
      { id: "mandate-line", type: "line", source: "countries", filter: ["in", ["get", "num"], ["literal", []]], paint: { "line-color": "#A9D3C8", "line-width": 1.1, "line-opacity": 0.75 } },
      { id: "state-lines", type: "line", source: "states", minzoom: 2.2, paint: { "line-color": "rgba(118,178,165,0.2)", "line-width": 0.5 } },
    ],
  };
}

const COLOUR: ExpressionSpecification = ["match", ["get", "line"], ...LINES.flatMap((l) => [l, LINE_COLOUR[l]]), "#9EC5B8"] as unknown as ExpressionSpecification;
const RADIUS: ExpressionSpecification = ["interpolate", ["linear"], ["coalesce", ["get", "mw"], 0], 0, 3.6, 10, 5, 50, 7.5, 200, 11, 1000, 16];

function addDataLayers(map: MLMap) {
  map.addSource("opps", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
    cluster: true,
    clusterRadius: 42,
    clusterMaxZoom: 5,
    clusterProperties: Object.fromEntries(LINES.map((l) => [l, ["+", ["case", ["==", ["get", "line"], l], 1, 0]]])),
  });
  map.addLayer({
    id: "opp-glow",
    type: "circle",
    source: "opps",
    filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "isNew"], 1]],
    paint: { "circle-color": COLOUR, "circle-radius": ["*", RADIUS, 2.6], "circle-blur": 1, "circle-opacity": 0.55 },
  });
  map.addLayer({
    id: "opp",
    type: "circle",
    source: "opps",
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": COLOUR,
      "circle-radius": RADIUS,
      "circle-opacity": ["case", ["==", ["get", "side"], "need"], 0.2, 0.9],
      "circle-stroke-color": COLOUR,
      "circle-stroke-width": ["case", ["==", ["get", "side"], "need"], 1.6, 0.6],
      "circle-stroke-opacity": 0.95,
    },
  });
  map.addLayer({
    id: "opp-sel",
    type: "circle",
    source: "opps",
    filter: ["==", ["get", "id"], ""],
    paint: { "circle-color": "rgba(0,0,0,0)", "circle-radius": ["+", RADIUS, 6], "circle-stroke-color": "#B5FFF0", "circle-stroke-width": 1.6 },
  });
}

function reduced(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}

// ---------- page ----------

export default function MapView() {
  useTitle("Map");
  const { data, error, loading, reload } = useLoad(load, "map");
  const [sp, setSp] = useSearchParams();
  // Critical power is off by default (not a focus line right now); "lines=all" shows everything.
  const lineSet = useMemo(() => parseLines(sp.get("lines")), [sp]);
  const side = sp.get("side") === "supply" || sp.get("side") === "need" ? (sp.get("side") as string) : null;
  const group = (REGION_GROUPS as readonly string[]).includes(sp.get("region") ?? "") ? (sp.get("region") as RegionGroup) : null;
  const minMw = Number(sp.get("mw")) > 0 ? Number(sp.get("mw")) : null;
  const gate = (GATES as readonly string[]).includes(sp.get("gate") ?? "") ? sp.get("gate") : null;
  const showMandates = sp.get("mandates") !== "0";
  const [wide] = useState(() => window.innerWidth >= 900);
  const selId = sp.get("o");
  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    setSp(n, { replace: true });
  };
  const toggleLine = (l: string) => {
    const n = new Set(lineSet);
    if (n.has(l)) n.delete(l);
    else n.add(l);
    set("lines", linesParam(n));
  };

  const now = Date.now();
  // Everything but the region filter, so the legend can show counts for every region.
  const base = useMemo(() => {
    if (!data) return [];
    return data.placed.filter(({ item: o }) => {
      if (!lineSet.has(o.line)) return false;
      if (side && o.side !== side) return false;
      if (gate && o.gate !== gate) return false;
      if (minMw) {
        const mw = mwOf(o.mw);
        if (mw === null || mw < minMw) return false;
      }
      return true;
    });
  }, [data, lineSet, side, gate, minMw]);
  const shown = useMemo(() => (group ? base.filter((p) => regionGroup(p.item.country) === group) : base), [base, group]);
  const byRegion = useMemo(() => {
    const m = new Map<RegionGroup, number>(REGION_GROUPS.map((g) => [g, 0]));
    for (const p of base) m.set(regionGroup(p.item.country), (m.get(regionGroup(p.item.country)) ?? 0) + 1);
    return m;
  }, [base]);
  const byLine = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of shown) m.set(p.item.line, (m.get(p.item.line) ?? 0) + 1);
    return m;
  }, [shown]);
  const mandateGeo = useMemo(() => {
    const per = new Map<string, number>();
    for (const m of data?.mandates ?? []) for (const c of mandateCountries(m.criteria)) per.set(c, (per.get(c) ?? 0) + 1);
    return per;
  }, [data]);

  const geojson = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: shown.map(({ item: o, lon, lat }) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [lon, lat] },
        properties: {
          id: o.id,
          line: o.line,
          side: o.side,
          gate: o.gate,
          mw: mwOf(o.mw),
          isNew: now - Date.parse(o.created_at) < WEEK ? 1 : 0,
        },
      })),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown],
  );

  // ---- the map itself ----
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const selRef = useRef<(id: string) => void>(() => {});
  selRef.current = (id: string) => set("o", id);

  useEffect(() => {
    if (!box.current) return;
    let map: MLMap;
    try {
      map = new MLMap({
        container: box.current,
        style: baseStyle(),
        center: window.innerWidth < 900 ? [-22, 40] : [-35, 38],
        zoom: window.innerWidth < 900 ? 1.05 : 1.85,
        minZoom: 0.4,
        maxZoom: 14,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        renderWorldCopies: false,
      });
    } catch (e) {
      setMapError(`This browser could not draw the map (${e instanceof Error ? e.message : "WebGL is unavailable"}). The counts and filters still work.`);
      return;
    }
    mapRef.current = map;
    // Keep the globe clear of the filter panel on wide screens.
    if (window.innerWidth >= 900) map.setPadding({ left: 400, top: 0, right: 0, bottom: 0 });
    else map.setPadding({ left: 0, top: 0, right: 0, bottom: 0 });
    map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new AttributionControl({ compact: true }), "bottom-right");
    map.touchZoomRotate.disableRotation();
    map.on("error", () => {
      /* basemap tiles that fail to load are not fatal; the outlines still draw */
    });
    map.on("load", () => {
      addDataLayers(map);
      setReady(true);
    });
    map.on("click", "opp", (e) => {
      const id = e.features?.[0]?.properties?.id;
      if (typeof id === "string") selRef.current(id);
    });
    for (const layer of ["opp"]) {
      map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
    }

    // Cluster counts as HTML markers (no font server needed).
    const markers = new Map<number, Marker>();
    let onScreen = new Map<number, Marker>();
    const update = () => {
      if (!map.getSource("opps") || !map.isSourceLoaded("opps")) return;
      const next = new Map<number, Marker>();
      for (const f of map.querySourceFeatures("opps")) {
        const p = f.properties as Record<string, number> | null;
        if (!p?.cluster) continue;
        const id = p.cluster_id;
        if (next.has(id)) continue;
        let mk = markers.get(id);
        if (!mk) {
          const n = p.point_count;
          const top = LINES.map((l) => [l, Number(p[l]) || 0] as const).sort((a, b) => b[1] - a[1])[0][0];
          const el = document.createElement("button");
          el.type = "button";
          el.className = "cluster-marker";
          const size = Math.round(Math.min(58, 22 + Math.sqrt(n) * 3.2));
          el.style.width = el.style.height = `${size}px`;
          el.style.background = LINE_COLOUR[top] ?? "#76B2A5";
          el.textContent = n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
          el.setAttribute("aria-label", `${n} opportunities here. Zoom in`);
          const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
          el.addEventListener("click", async (ev) => {
            ev.stopPropagation();
            const src = map.getSource("opps") as GeoJSONSource;
            const z = await src.getClusterExpansionZoom(id);
            map.easeTo({ center: coords, zoom: Math.min(z + 0.2, 12), duration: reduced() ? 0 : 700 });
          });
          mk = new Marker({ element: el }).setLngLat(coords);
          markers.set(id, mk);
        }
        next.set(id, mk);
        if (!onScreen.has(id)) mk.addTo(map);
      }
      for (const [id, mk] of onScreen) if (!next.has(id)) mk.remove();
      onScreen = next;
    };
    map.on("render", update);
    map.on("sourcedata", (e) => {
      if (e.sourceId === "opps" && e.isSourceLoaded) {
        for (const mk of markers.values()) mk.remove();
        markers.clear();
        onScreen = new Map();
        update();
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("opps") as GeoJSONSource | undefined)?.setData(geojson);
  }, [ready, geojson]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const nums = showMandates ? [...mandateGeo.keys()].map((c) => COUNTRIES[c]?.num).filter(Boolean) : [];
    const f = ["in", ["get", "num"], ["literal", nums]] as unknown as ExpressionSpecification;
    map.setFilter("mandate-fill", f);
    map.setFilter("mandate-line", f);
  }, [ready, showMandates, mandateGeo]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setFilter("opp-sel", ["==", ["get", "id"], selId ?? ""]);
    // Bring the picked point into view, close enough that it is not inside a cluster.
    const p = selId ? data?.placed.find((x) => x.item.id === selId) : null;
    if (p) {
      const big = window.innerWidth >= 900;
      map.easeTo({
        center: [p.lon, p.lat],
        zoom: Math.max(map.getZoom(), 5.6),
        padding: big ? { left: 400, right: 420, top: 0, bottom: 0 } : { left: 0, right: 0, top: 0, bottom: 0 },
        duration: reduced() ? 0 : 700,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selId, data]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !group || group === "Other") return;
    const big = window.innerWidth >= 900;
    map.fitBounds(REGION_BOUNDS[group], {
      // on top of the map's own left padding for the filter panel
      padding: big ? { top: 40, bottom: 40, left: 20, right: selId ? 420 : 40 } : 16,
      duration: reduced() ? 0 : 900,
    });
    // Only when the region changes, not when a point is picked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, group]);

  const selected = selId ? data?.placed.find((p) => p.item.id === selId) ?? null : null;

  return (
    <div className="mapx">
      <div className="mapx-canvas" ref={box} aria-label="Map of opportunities" role="region" />

      <section className="map-hud map-head" aria-label="Map filters">
        <div className="section-head">
          <span className="eyebrow">Global opportunities</span>
          <h1>Map</h1>
          <p className="muted small">
            {data ? <><b className="mono">{fmtNumber(shown.length)}</b> of {fmtNumber(data.opps.length)} on the map. Filled dots offer something; rings are looking for something.</> : "Every opportunity the engine has found, by place."}
          </p>
        </div>
        <div className="chips" role="group" aria-label="Lines">
          {LINES.map((l) => (
            <button key={l} type="button" className="chip" aria-pressed={lineSet.has(l)} onClick={() => toggleLine(l)}>
              <i style={{ background: lineColour(l) }} />
              {LINE_LABEL[l]}
              <strong>{fmtNumber(byLine.get(l) ?? 0)}</strong>
            </button>
          ))}
        </div>
        <details className="map-more" open={wide}>
          <summary>More filters</summary>
        <div className="row">
          <div className="seg" role="group" aria-label="Side">
            <button type="button" aria-pressed={!side} onClick={() => set("side", null)}>Both</button>
            <button type="button" aria-pressed={side === "supply"} onClick={() => set("side", "supply")}>{SIDE_LABEL.supply}</button>
            <button type="button" aria-pressed={side === "need"} onClick={() => set("side", "need")}>{SIDE_LABEL.need}</button>
          </div>
        </div>
        <div className="row">
          <label className="field">
            <span>Region</span>
            <select value={group ?? ""} onChange={(e) => set("region", e.target.value || null)}>
              <option value="">Whole world</option>
              {REGION_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Gate</span>
            <select value={gate ?? ""} onChange={(e) => set("gate", e.target.value || null)}>
              <option value="">Any gate</option>
              {GATES.map((g) => <option key={g} value={g}>{GATE_LABEL[g]}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Min MW</span>
            <input type="number" inputMode="numeric" min={0} step={5} value={minMw ?? ""} placeholder="Any" onChange={(e) => set("mw", e.target.value && Number(e.target.value) > 0 ? e.target.value : null)} />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={showMandates} onChange={(e) => set("mandates", e.target.checked ? null : "0")} />
          <span>Highlight where live mandates are looking ({fmtNumber(mandateGeo.size)} {mandateGeo.size === 1 ? "country" : "countries"})</span>
        </label>
        </details>
      </section>

      {mapError && <p className="map-hud map-note" role="alert">{mapError}</p>}
      {Boolean(error) && !data && <div className="map-hud map-note"><ErrorBox error={error} onRetry={reload} /></div>}
      {loading && !data && <div className="map-hud map-note"><Loading what="Placing opportunities…" /></div>}

      {data && (
        <section className="map-hud map-legend" aria-label="Counts by region">
          <span className="eyebrow">By region</span>
          {REGION_GROUPS.map((g) => (
            <div key={g} className="reg">
              <button type="button" onClick={() => set("region", group === g ? null : g)} aria-pressed={group === g}>
                {group === g ? "▸ " : ""}{g}
              </button>
              <b>{fmtNumber(byRegion.get(g) ?? 0)}</b>
            </div>
          ))}
          <div className="scale" aria-hidden>
            <i style={{ width: 7, height: 7 }} /> 1 MW
            <i style={{ width: 15, height: 15 }} /> 50
            <i style={{ width: 26, height: 26 }} /> 500+
          </div>
          <span>Glow: found in the last 7 days</span>
          {data.unplaced > 0 && <span>{fmtNumber(data.unplaced)} with no country are not shown</span>}
        </section>
      )}

      {selected && (
        <aside className="map-hud map-panel" aria-label="Selected opportunity">
          <button type="button" className="btn ghost small close" onClick={() => set("o", null)} aria-label="Close">
            <Icon.close />
          </button>
          <OppPanel p={selected} matches={data?.matchCount.get(selected.item.id) ?? 0} />
        </aside>
      )}
    </div>
  );
}

function OppPanel({ p, matches }: { p: ReturnType<typeof placeAll<MapOpp>>[number]; matches: number }) {
  const o = p.item;
  const { data: ev } = useLoad(
    async () =>
      await supabase
        .from("opportunity_signals")
        .select("signals(title,source_url,retrieved_at)")
        .eq("opportunity_id", o.id)
        .limit(5)
        .then((r) => (must(r) as unknown as { signals: { title: string; source_url: string; retrieved_at: string } | null }[]).map((x) => x.signals).filter(Boolean)),
    o.id,
  );
  const mw = mwOf(o.mw);
  const isNew = Date.now() - Date.parse(o.created_at) < WEEK;
  return (
    <>
      <span className="eyebrow">{SIDE_LABEL[o.side] ?? o.side} {o.side === "supply" ? "on offer" : "wanted"}</span>
      <h2>{o.title}</h2>
      <div className="meta">
        <LineBadge line={o.line} />
        <GateBadge gate={o.gate} />
        {isNew && <span className="badge pill-good">New this week</span>}
      </div>
      <dl className="facts">
        <div><dt>Where</dt><dd>{p.place.label}</dd></div>
        <div><dt>Size</dt><dd className="mono">{mw ? fmtMW(mw) : "Not stated"}</dd></div>
        <div><dt>Credibility</dt><dd className="mono">{o.credibility === null ? "—" : `${fmtNumber(o.credibility)} / 100`}</dd></div>
        <div><dt>Matches</dt><dd className="mono">{fmtNumber(matches)}</dd></div>
        <div><dt>Found</dt><dd className="mono">{fmtDate(o.created_at)}</dd></div>
        <div><dt>Region</dt><dd>{regionGroup(o.country)}</dd></div>
      </dl>
      <p className="note small">{PRECISION_TEXT[p.place.precision]}</p>
      <div className="stack-xs">
        <span className="muted-head">Evidence</span>
        {ev === null ? (
          <span className="muted small">Loading…</span>
        ) : ev.length === 0 ? (
          <span className="muted small">No linked source yet.</span>
        ) : (
          ev.map((s, i) => s && <ExtLink key={i} url={s.source_url}>{s.title}</ExtLink>)
        )}
      </div>
      <div className="action-row">
        <Link to={`/opportunities/${o.id}`} className="btn primary small">Open opportunity</Link>
      </div>
    </>
  );
}
