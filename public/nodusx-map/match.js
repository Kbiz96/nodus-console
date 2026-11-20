// Shared NodusX matching rules, extracted from the internal match map (index.html). Used by the console home.
const GEO=[[/mid-south|memphis|tennessee/i,35.15,-90.05,"North America"],[/northeast|boston|massachusetts/i,42.36,-71.06,"North America"],[/south asia|sri lanka|colombo/i,6.93,79.85,"Asia"],[/se europe|south-east europe|southeast europe|skopje|macedonia|serbia|belgrade/i,42.9,21.4,"Europe"],[/south of france|nice|france/i,43.7,7.1,"Europe"],[/spain|madrid|barcelona/i,40.4,-3.7,"Europe"],[/poland|warsaw/i,52.2,21.0,"Europe"],[/oslo|stockholm/i,59.6,14.5,"Europe"],[/northern virginia/i,38.9,-77.6,"North America"],[/pittsburgh/i,40.4,-80.0,"North America"],[/pennsylvania/i,40.9,-77.8,"North America"],[/north carolina/i,35.6,-79.4,"North America"],[/florida/i,27.8,-81.7,"North America"],[/texas/i,31,-99,"North America"],[/california/i,36.8,-119.4,"North America"],[/ohio/i,40.3,-82.8,"North America"],[/arizona/i,34.2,-111.6,"North America"],[/missouri/i,38.4,-92.5,"North America"],[/\bus\b|usa|united states/i,39.5,-98.5,"North America"],[/canada/i,50,-100,"North America"],
 [/saudi/i,24.0,45.0,"Middle East"],[/uae|dubai|abu dhabi/i,24.4,54.4,"Middle East"],[/gcc/i,25.3,51.2,"Middle East"],[/middle east|mena/i,26.0,47.0,"Middle East"],
 [/uk or eu/i,51.5,-0.5,"Europe"],[/\buk\b|united kingdom|london/i,52.5,-1.5,"Europe"],[/nordic|norway|sweden|finland|denmark|iceland/i,61,15,"Europe"],[/ireland/i,53.3,-7.7,"Europe"],[/netherlands|amsterdam/i,52.37,4.9,"Europe"],[/germany/i,51,10.4,"Europe"],[/\beu\b|europe/i,49.5,8,"Europe"],
 [/kazakhstan|astana/i,51.17,71.45,"Asia"],[/vietnam|da nang/i,16.05,108.2,"Asia"],[/india/i,21.5,78.8,"Asia"],[/malaysia/i,3.2,101.6,"Asia"],[/thailand/i,13.4,101,"Asia"],[/japan/i,36,138,"Asia"],[/singapore/i,1.35,103.8,"Asia"],[/brazil/i,-15.8,-47.9,"South America"]];
const geo=s=>{for(const [re,la,lo,reg] of GEO) if(re.test(s||"")) return {pin:[la,lo],region:reg};if(/\b(any|global|worldwide|flexible)\b/i.test(s||""))return {pin:null,region:"Global"};return null};
const famOf=s=>{const u=String(s||"").toUpperCase();if(/RUBIN/.test(u))return "Vera Rubin";if(/RTX\s*PRO\s*6000/.test(u))return "RTX PRO 6000";const m=u.match(/GB300|GB200|B300|B200|H200|H100|A100|L40S|MI3\d\dX?/);return m?m[0]:""};
const MN=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function liveOf(r){const s=(r.timing||"")+" "+(r.rfs||"");
  let m=s.match(/Q([1-4])\s*(20\d\d)/i);if(m)return `${m[2]}-${String((+m[1]-1)*3+1).padStart(2,"0")}`;
  m=s.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+(20\d\d)/i);if(m)return `${m[2]}-${String(MN.findIndex(x=>x.toLowerCase()===m[1].toLowerCase().slice(0,3))+1).padStart(2,"0")}`;
  if(/now|urgent/i.test(s))return "2026-11";if(/\b12m\b|12 months/i.test(s))return "2027-11";if(/\b24m\b/i.test(s))return "2028-11";
  m=s.match(/(20\d\d)/);if(m)return `${m[1]}-06`;return null}
function specOf(p){const o={};const n=+p.nodes||0,per=+p.gpus_per_node||0;
  if(p.form_factor)o.ff=p.form_factor;if(n){if(p.unit==="rack")o.racks=n;else o.nodes=n}if(per)o.gpn=per;
  ["cpu","memory","fabric","frontend","cooling","tier","delivery","prepay"].forEach(k=>{if(p[k])o[k]=p[k]});
  if(p.local_storage||p.shared_storage||p.storage)o.storage=[p.local_storage&&p.local_storage+" per node",p.shared_storage&&p.shared_storage+" shared",p.storage].filter(Boolean).join("; ");
  if(p.power)o.power=p.power;if(p.power_kwh)o.power=(o.power?o.power+"; ":"")+(/^[\d.]+$/.test(p.power_kwh)?"$"+p.power_kwh+" per kWh":p.power_kwh);if(p.min_term)o.min_term=p.min_term;if(p.term)o.term=p.term;
  if(p.price){o.price=/^[\d.,]+$/.test(p.price)?"$"+p.price:p.price;o.priceUnit=p.price_unit||""}
  return o}
function fromBoard(r,i){
  const g=geo(r.market); if(!g) return null;
  const colo=r.kind==="capacity"&&r.mw&&!r.gpus;const live=liveOf(r);
  const fam=famOf(r.gpu_model);
  const type=colo?"colo":(/purchase|buy|hardware/i.test(r.deal||"")?"hardware":(r.kind==="capacity"&&/coloc/i.test(r.deal||"")&&!fam?"colo":"rental"));
  return {id:(r.side==="have"?"BL-":"RQ-")+String(i+1).padStart(2,"0"),side:r.side,type,family:fam||(r.gpu_model?"Any":""),
    qty:colo?Number(r.mw):Number(r.gpus||0),unit:colo?"MW":"GPUs",where:r.market,region:g.region,regions:[g.region],pins:g.pin?[g.pin]:[],
    start:r.timing||({now:"Now","12m":"Within 12 months","24m":"Within 24 months"}[r.rfs]||"To confirm"),term:r.deal||"",price:"On request",
    live,note:r.note||"",stage:r.stage||"",...specOf(r.spec||{}),status:r.verified?"Verified":"Screened",tender:/consortium|empanelment|tender/i.test(r.deal||"")};
}
function compatible(d,s){
  if(d.tender) return false;
  const dr=d.regions||[d.region],same=dr.includes("Global")||dr.some(r=>(s.regions||[s.region]).includes(r));
  if(d.type==="colo"||s.type==="colo"){ // space is location-bound
    const wantsSpace=d.type==="colo"||/colocation/i.test(d.term||"");
    return s.type==="colo"&&wantsSpace&&same&&(!d.qty||d.unit!=="MW"||s.qty>=d.qty);
  }
  if(d.type==="hardware"&&s.type!=="hardware") return false;
  if(d.family&&d.family!=="Any"&&s.family&&d.family.replace(/^HGX /,"")!==s.family) return false;
  if(d.qty&&s.qty<Math.min(d.qty*0.1,1000)) return false; // too small to matter to this buyer
  return true;
}
const fmt=n=>Number(n).toLocaleString("en-GB");
const kwLabel=mw=>mw<1?`${fmt(Math.round(mw*1000))} kW`:`${fmt(mw)} MW`;
const qtyLabel=x=>x.unit==="MW"?`${kwLabel(x.qty)} IT load`:!x.qty?`${x.family&&x.family!=="Any"?x.family:"GPU"} capacity, any size`:`${fmt(x.qty)} ${x.family&&x.family!=="Any"?x.family+" GPUs":"GPUs"}`;
export function computeMatches(rows){const S=[],D=[];
  rows.filter(r=>(r.kind==="gpu"||r.kind==="capacity")&&r.origin!=="public").forEach((r,i)=>{const x=fromBoard(r,i);if(!x)return;x.ref=r.ref;x.company=r.company;x.dbStatus=r.status;(x.side==="have"?S:D).push(x)});
  const pairs=[];D.forEach(d=>S.forEach(s=>{if(compatible(d,s))pairs.push([d,s])}));
  return {supply:S,demand:D,pairs,qtyLabel};}
