// Where to put an opportunity on the map, without any outside geocoding service. Pure functions only.
// Opportunities carry a country (ISO-2) and sometimes a region ("Clark, NV", "NY", "North Yorkshire").
// Precision, best first: US state, UK place, country. Points that share a spot are spread in a small
// sunflower pattern so they do not sit on top of each other.

export type Precision = "state" | "place" | "country";

export interface Country {
  iso2: string;
  num: string; // ISO 3166-1 numeric, as used by the world-atlas outlines
  name: string;
  lat: number;
  lon: number;
  spread?: number; // degrees; how far points placed only by country are spread
}

// [iso2, numeric, name, lat, lon, spread]
const C: [string, string, string, number, number, number?][] = [
  ["US", "840", "United States", 39.5, -98.5, 5.5],
  ["CA", "124", "Canada", 54, -100, 5],
  ["MX", "484", "Mexico", 23.6, -102.5, 3],
  ["GB", "826", "United Kingdom", 53, -1.8, 1],
  ["IE", "372", "Ireland", 53.2, -8.1, 0.7],
  ["FI", "246", "Finland", 63, 26, 1.6],
  ["SE", "752", "Sweden", 61.5, 15.5, 1.8],
  ["NO", "578", "Norway", 61, 9, 1.4],
  ["DK", "208", "Denmark", 56, 9.5, 0.6],
  ["IS", "352", "Iceland", 64.9, -18.6, 0.8],
  ["DE", "276", "Germany", 51.1, 10.4, 1.4],
  ["FR", "250", "France", 46.6, 2.4, 1.6],
  ["NL", "528", "Netherlands", 52.2, 5.5, 0.4],
  ["BE", "056", "Belgium", 50.6, 4.6, 0.4],
  ["LU", "442", "Luxembourg", 49.8, 6.1, 0.15],
  ["CH", "756", "Switzerland", 46.8, 8.2, 0.5],
  ["AT", "040", "Austria", 47.6, 14.1, 0.7],
  ["ES", "724", "Spain", 40.2, -3.6, 1.6],
  ["PT", "620", "Portugal", 39.6, -8, 0.6],
  ["IT", "380", "Italy", 42.8, 12.5, 1.2],
  ["MT", "470", "Malta", 35.9, 14.4, 0.1],
  ["PL", "616", "Poland", 52.1, 19.4, 1.2],
  ["CZ", "203", "Czechia", 49.8, 15.5, 0.6],
  ["SK", "703", "Slovakia", 48.7, 19.7, 0.4],
  ["HU", "348", "Hungary", 47.2, 19.4, 0.6],
  ["SI", "705", "Slovenia", 46.1, 14.8, 0.25],
  ["HR", "191", "Croatia", 45.1, 15.2, 0.4],
  ["RO", "642", "Romania", 45.9, 25, 1],
  ["BG", "100", "Bulgaria", 42.7, 25.2, 0.7],
  ["GR", "300", "Greece", 39.1, 22, 0.8],
  ["RS", "688", "Serbia", 44, 20.8, 0.5],
  ["EE", "233", "Estonia", 58.7, 25.5, 0.4],
  ["LV", "428", "Latvia", 56.9, 24.6, 0.4],
  ["LT", "440", "Lithuania", 55.3, 23.9, 0.4],
  ["UA", "804", "Ukraine", 49, 31.4, 1.5],
  ["CY", "196", "Cyprus", 35, 33.2, 0.2],
  ["TR", "792", "Türkiye", 39, 35.2, 1.6],
  ["AE", "784", "United Arab Emirates", 24.2, 54.6, 0.5],
  ["SA", "682", "Saudi Arabia", 24, 45, 2.2],
  ["QA", "634", "Qatar", 25.3, 51.2, 0.2],
  ["KW", "414", "Kuwait", 29.3, 47.6, 0.25],
  ["BH", "048", "Bahrain", 26, 50.55, 0.08],
  ["OM", "512", "Oman", 21, 57, 1],
  ["IQ", "368", "Iraq", 33, 43.7, 1.2],
  ["JO", "400", "Jordan", 31.2, 36.5, 0.5],
  ["EG", "818", "Egypt", 26.8, 30.8, 1.6],
  ["IL", "376", "Israel", 31.4, 35, 0.3],
  ["IR", "364", "Iran", 32.5, 54.3, 2],
  ["MA", "504", "Morocco", 31.8, -7.1, 1.2],
  ["ZA", "710", "South Africa", -29, 24.7, 2],
  ["NG", "566", "Nigeria", 9.1, 8.7, 1.6],
  ["KE", "404", "Kenya", 0.2, 37.9, 1.2],
  ["IN", "356", "India", 22, 79, 3],
  ["PK", "586", "Pakistan", 30, 69.4, 1.6],
  ["SG", "702", "Singapore", 1.35, 103.82, 0.06],
  ["MY", "458", "Malaysia", 4.2, 102, 1],
  ["ID", "360", "Indonesia", -2.5, 118, 3],
  ["TH", "764", "Thailand", 15.1, 101, 1.2],
  ["VN", "704", "Vietnam", 16, 106.3, 1.2],
  ["PH", "608", "Philippines", 12.9, 121.8, 1.2],
  ["CN", "156", "China", 35, 103.8, 4],
  ["HK", "344", "Hong Kong", 22.35, 114.15, 0.06],
  ["TW", "158", "Taiwan", 23.7, 121, 0.4],
  ["JP", "392", "Japan", 36.5, 138.5, 1.6],
  ["KR", "410", "South Korea", 36.4, 127.9, 0.6],
  ["AU", "036", "Australia", -25.7, 134.5, 4],
  ["NZ", "554", "New Zealand", -41.5, 172.5, 1.2],
  ["BR", "076", "Brazil", -10.8, -52.9, 4],
  ["AR", "032", "Argentina", -35.4, -65.2, 2.5],
  ["CL", "152", "Chile", -35.7, -71.5, 1.5],
  ["CO", "170", "Colombia", 4.6, -74.3, 1.6],
  ["RU", "643", "Russia", 58, 60, 5],
  ["KZ", "398", "Kazakhstan", 48, 67, 3],
];

export const COUNTRIES: Record<string, Country> = Object.fromEntries(
  C.map(([iso2, num, name, lat, lon, spread]) => [iso2, { iso2, num, name, lat, lon, spread }]),
);

// [abbr, name, lat, lon]
const S: [string, string, number, number][] = [
  ["AL", "Alabama", 32.8, -86.8], ["AK", "Alaska", 64.7, -152], ["AZ", "Arizona", 34.3, -111.7],
  ["AR", "Arkansas", 34.9, -92.4], ["CA", "California", 37.2, -119.5], ["CO", "Colorado", 39, -105.5],
  ["CT", "Connecticut", 41.6, -72.7], ["DE", "Delaware", 39, -75.5], ["DC", "District of Columbia", 38.9, -77],
  ["FL", "Florida", 28.6, -82.4], ["GA", "Georgia", 32.7, -83.4], ["HI", "Hawaii", 20.8, -156.3],
  ["ID", "Idaho", 44.4, -114.6], ["IL", "Illinois", 40, -89.2], ["IN", "Indiana", 39.9, -86.3],
  ["IA", "Iowa", 42.1, -93.5], ["KS", "Kansas", 38.5, -98.4], ["KY", "Kentucky", 37.5, -85.3],
  ["LA", "Louisiana", 31.1, -92], ["ME", "Maine", 45.4, -69.2], ["MD", "Maryland", 39, -76.8],
  ["MA", "Massachusetts", 42.3, -71.8], ["MI", "Michigan", 44.3, -85.4], ["MN", "Minnesota", 46.3, -94.3],
  ["MS", "Mississippi", 32.7, -89.7], ["MO", "Missouri", 38.4, -92.5], ["MT", "Montana", 47, -109.6],
  ["NE", "Nebraska", 41.5, -99.8], ["NV", "Nevada", 39.3, -116.6], ["NH", "New Hampshire", 43.7, -71.6],
  ["NJ", "New Jersey", 40.2, -74.7], ["NM", "New Mexico", 34.4, -106.1], ["NY", "New York", 42.9, -75.5],
  ["NC", "North Carolina", 35.6, -79.4], ["ND", "North Dakota", 47.5, -100.5], ["OH", "Ohio", 40.3, -82.8],
  ["OK", "Oklahoma", 35.6, -97.5], ["OR", "Oregon", 43.9, -120.6], ["PA", "Pennsylvania", 40.9, -77.8],
  ["RI", "Rhode Island", 41.7, -71.5], ["SC", "South Carolina", 33.9, -80.9], ["SD", "South Dakota", 44.4, -100.2],
  ["TN", "Tennessee", 35.9, -86.4], ["TX", "Texas", 31.5, -99.3], ["UT", "Utah", 39.3, -111.7],
  ["VT", "Vermont", 44.1, -72.7], ["VA", "Virginia", 37.5, -78.8], ["WA", "Washington", 47.4, -120.5],
  ["WV", "West Virginia", 38.6, -80.6], ["WI", "Wisconsin", 44.6, -89.9], ["WY", "Wyoming", 43, -107.5],
  ["PR", "Puerto Rico", 18.2, -66.5],
];
export const US_STATES: Record<string, { name: string; lat: number; lon: number }> = Object.fromEntries(
  S.map(([a, name, lat, lon]) => [a, { name, lat, lon }]),
);
const STATE_BY_NAME: Record<string, string> = Object.fromEntries(S.map(([a, name]) => [name.toLowerCase(), a]));

// UK councils, counties and cities that the engine's UK sources use.
const UK: [string, number, number][] = [
  ["north yorkshire", 54.2, -1.4], ["west yorkshire", 53.75, -1.65], ["south yorkshire", 53.45, -1.35],
  ["east riding of yorkshire", 53.85, -0.6], ["hillingdon", 51.53, -0.45], ["lincolnshire", 53.1, -0.2],
  ["birmingham", 52.48, -1.9], ["slough", 51.51, -0.59], ["south gloucestershire", 51.53, -2.47],
  ["broxbourne", 51.72, -0.03], ["county durham", 54.68, -1.75], ["durham", 54.68, -1.75],
  ["tower hamlets", 51.515, -0.03], ["reigate and banstead", 51.25, -0.2], ["trafford", 53.43, -2.33],
  ["hounslow", 51.47, -0.37], ["dacorum", 51.77, -0.55], ["ealing", 51.51, -0.31], ["west london", 51.51, -0.33],
  ["gloucester", 51.86, -2.24], ["gloucestershire", 51.85, -2.2], ["west midlands", 52.48, -1.95],
  ["stoke-on-trent", 53.0, -2.18], ["islington", 51.54, -0.1], ["swansea", 51.62, -3.94],
  ["north northamptonshire", 52.4, -0.7], ["west northamptonshire", 52.23, -1.0], ["blaby", 52.57, -1.17],
  ["central bedfordshire", 52.0, -0.47], ["harborough", 52.48, -0.92], ["cheshire west and chester", 53.2, -2.75],
  ["cheshire east", 53.15, -2.35], ["croydon", 51.37, -0.1], ["chesterfield", 53.24, -1.42],
  ["vale of white horse", 51.63, -1.45], ["milton keynes", 52.04, -0.76], ["nottinghamshire", 53.1, -1.0],
  ["nottingham", 52.95, -1.15], ["devon", 50.7, -3.8], ["runnymede", 51.4, -0.53], ["wychavon", 52.1, -2.05],
  ["north kesteven", 53.05, -0.5], ["south kesteven", 52.85, -0.5], ["shropshire", 52.6, -2.75],
  ["portsmouth", 50.8, -1.09], ["tyne and wear", 54.97, -1.6], ["wyre forest", 52.39, -2.25],
  ["northumberland", 55.2, -2.0], ["welwyn hatfield", 51.77, -0.2], ["london", 51.507, -0.128],
  ["greater london", 51.507, -0.128], ["city of london", 51.515, -0.09], ["manchester", 53.48, -2.24],
  ["greater manchester", 53.48, -2.3], ["leeds", 53.8, -1.55], ["sheffield", 53.38, -1.47],
  ["liverpool", 53.41, -2.98], ["merseyside", 53.42, -2.9], ["newcastle upon tyne", 54.97, -1.61],
  ["bristol", 51.45, -2.59], ["cardiff", 51.48, -3.18], ["newport", 51.58, -3.0], ["glasgow", 55.86, -4.25],
  ["edinburgh", 55.95, -3.19], ["aberdeen", 57.15, -2.1], ["belfast", 54.6, -5.93], ["kent", 51.2, 0.7],
  ["essex", 51.75, 0.55], ["surrey", 51.25, -0.4], ["hertfordshire", 51.8, -0.25], ["berkshire", 51.45, -1.0],
  ["thurrock", 51.5, 0.35], ["redcar and cleveland", 54.58, -1.05], ["middlesbrough", 54.57, -1.23],
  ["hartlepool", 54.69, -1.21], ["stockton-on-tees", 54.57, -1.32], ["lancashire", 53.8, -2.6],
  ["cumbria", 54.6, -3.0], ["norfolk", 52.65, 1.0], ["suffolk", 52.2, 1.0], ["cambridgeshire", 52.3, 0.05],
  ["oxfordshire", 51.8, -1.3], ["wiltshire", 51.3, -1.9], ["somerset", 51.1, -3.0], ["cornwall", 50.4, -4.9],
  ["dorset", 50.8, -2.3], ["hampshire", 51.05, -1.3], ["derbyshire", 53.1, -1.6], ["leicestershire", 52.7, -1.1],
  ["staffordshire", 52.85, -2.05], ["warwickshire", 52.3, -1.55], ["worcestershire", 52.2, -2.2],
  ["barking and dagenham", 51.54, 0.13], ["havering", 51.57, 0.18], ["enfield", 51.65, -0.08],
  ["newham", 51.53, 0.03], ["greenwich", 51.48, 0.0], ["southwark", 51.5, -0.08], ["brent", 51.56, -0.27],
  ["barnet", 51.62, -0.2], ["scotland", 56.8, -4.2], ["wales", 52.3, -3.7], ["northern ireland", 54.65, -6.7],
];
const UK_PLACES: Record<string, [number, number]> = Object.fromEntries(UK.map(([k, lat, lon]) => [k, [lat, lon]]));

export const REGION_GROUPS = ["Nordics", "Europe", "UK", "GCC", "USA", "Other"] as const;
export type RegionGroup = (typeof REGION_GROUPS)[number];
const NORDICS = new Set(["FI", "SE", "NO", "DK", "IS"]);
const GCC = new Set(["AE", "SA", "QA", "KW", "BH", "OM"]);
const EUROPE = new Set([
  "IE", "DE", "FR", "NL", "BE", "LU", "CH", "AT", "ES", "PT", "IT", "MT", "PL", "CZ", "SK", "HU", "SI", "HR", "RO",
  "BG", "GR", "RS", "EE", "LV", "LT", "UA", "CY", "LI", "MC", "AD", "SM", "AL", "BA", "ME", "MK", "MD", "XK",
]);

/** Which of the five Nodus regions (or Other) a country belongs to. */
export function regionGroup(country: string | null | undefined): RegionGroup {
  const c = (country ?? "").toUpperCase();
  if (c === "GB" || c === "UK") return "UK";
  if (c === "US") return "USA";
  if (NORDICS.has(c)) return "Nordics";
  if (GCC.has(c)) return "GCC";
  if (EUROPE.has(c)) return "Europe";
  return "Other";
}

/** Map view for each region: [[west, south], [east, north]]. */
export const REGION_BOUNDS: Record<Exclude<RegionGroup, "Other">, [[number, number], [number, number]]> = {
  Nordics: [[4, 54], [32, 71.5]],
  Europe: [[-11, 35], [32, 60]],
  UK: [[-8.5, 49.8], [2, 59]],
  GCC: [[34, 15], [60, 31]],
  USA: [[-125, 24], [-66, 50]],
};

function norm(s: string): string {
  return s.toLowerCase().replace(/&/g, "and").replace(/\s+/g, " ").replace(/^city of (?!london)/, "").trim();
}

/** The US state named in a region such as "Clark, NV", "NY" or "Onondaga, New York". */
export function usState(region: string | null | undefined): string | null {
  if (!region) return null;
  const r = region.trim();
  const abbr = r.match(/(?:^|,\s*)([A-Z]{2})$/);
  if (abbr && US_STATES[abbr[1]]) return abbr[1];
  const tail = r.split(",").pop()?.trim().toLowerCase() ?? "";
  return STATE_BY_NAME[tail] ?? null;
}

export interface Placed {
  lat: number;
  lon: number;
  precision: Precision;
  key: string; // the spot this point shares with others
  spread: number; // degrees
  label: string; // where, in words
}

/** Where an opportunity goes before spreading, or null when it has no usable country. */
export function locate(country: string | null | undefined, region: string | null | undefined): Placed | null {
  const iso = (country ?? "").toUpperCase();
  if (iso === "US" || (!iso && usState(region))) {
    const st = usState(region);
    if (st) {
      const s = US_STATES[st];
      return { lat: s.lat, lon: s.lon, precision: "state", key: `US-${st}`, spread: 0.9, label: region ? `${region.trim()}` : s.name };
    }
  }
  if (iso === "GB" && region) {
    const p = UK_PLACES[norm(region)];
    if (p) return { lat: p[0], lon: p[1], precision: "place", key: `GB-${norm(region)}`, spread: 0.07, label: region.trim() };
  }
  const c = COUNTRIES[iso];
  if (!c) return null;
  return { lat: c.lat, lon: c.lon, precision: "country", key: iso, spread: c.spread ?? 0.8, label: region ? `${region.trim()}, ${c.name}` : c.name };
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/**
 * Spread points that share a spot as a sunflower: the i-th of n sits at radius spread·√(i/n) at the golden angle,
 * so a crowd fills a disc evenly and a lone point stays exactly on its spot. Longitude is widened by latitude
 * so discs stay round on the map.
 */
export function spreadPoint(p: Placed, i: number, n: number): [number, number] {
  if (n <= 1 || i === 0) return [p.lon, p.lat];
  const r = p.spread * Math.sqrt(i / Math.max(1, n - 1));
  const a = i * GOLDEN;
  const lat = p.lat + r * Math.sin(a);
  const lon = p.lon + (r * Math.cos(a)) / Math.max(0.2, Math.cos((p.lat * Math.PI) / 180));
  return [Math.max(-180, Math.min(180, lon)), Math.max(-85, Math.min(85, lat))];
}

/** Place a list of items (each with country and region), spreading crowds. Items with no country are left out. */
export function placeAll<T extends { id: string; country: string | null; region: string | null }>(
  items: T[],
): { item: T; lon: number; lat: number; place: Placed }[] {
  const located = items.map((item) => ({ item, place: locate(item.country, item.region) }));
  const groups = new Map<string, number>();
  for (const l of located) if (l.place) groups.set(l.place.key, (groups.get(l.place.key) ?? 0) + 1);
  // A stable order inside each crowd (by id), so a point does not jump about between visits.
  const sorted = located.filter((l) => l.place).sort((a, b) => (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0));
  const seen = new Map<string, number>();
  return sorted.map(({ item, place }) => {
    const p = place as Placed;
    const i = seen.get(p.key) ?? 0;
    seen.set(p.key, i + 1);
    const [lon, lat] = spreadPoint(p, i, groups.get(p.key) ?? 1);
    return { item, lon, lat, place: p };
  });
}

/** A number from specs->mw (which may be text), or null. */
export function mwOf(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^0-9.]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** ISO-2 codes from a mandate's criteria.countries, upper-cased and de-duplicated. */
export function mandateCountries(criteria: unknown): string[] {
  const c = (criteria as { countries?: unknown } | null)?.countries;
  if (!Array.isArray(c)) return [];
  return [...new Set(c.filter((x): x is string => typeof x === "string" && /^[A-Za-z]{2}$/.test(x)).map((x) => x.toUpperCase()))];
}
