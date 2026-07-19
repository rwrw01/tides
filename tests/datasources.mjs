// Databronnen-smoketest: controleert elke externe bron rechtstreeks.
// Draait in CI (vol internet). Kritieke bronnen laten de job falen,
// informatieve bronnen (radar, satelliet) alleen rapporteren.
import fs from 'node:fs';

const checks = [
  { name: 'CARTO Voyager-tegel', critical: true, type: 'image',
    url: 'https://a.basemaps.cartocdn.com/rastertiles/voyager/6/32/21.png' },
  { name: 'CARTO Voyager retina (@2x)', critical: true, type: 'image',
    url: 'https://a.basemaps.cartocdn.com/rastertiles/voyager/6/32/21@2x.png' },
  { name: 'CARTO Dark Matter-tegel', critical: true, type: 'image',
    url: 'https://a.basemaps.cartocdn.com/dark_all/6/32/21.png' },
  { name: 'Esri satelliet-tegel', critical: false, type: 'image',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/6/21/32' },
  { name: 'Leaflet via unpkg', critical: true, type: 'text',
    url: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js' },
  { name: 'Open-Meteo getij — Scheveningen (zee)', critical: true, type: 'json',
    url: 'https://marine-api.open-meteo.com/v1/marine?latitude=52.115&longitude=4.24&hourly=sea_level_height_msl&past_days=1&forecast_days=2&timezone=auto&cell_selection=sea',
    validate: j => {
      const v = (j.hourly?.sea_level_height_msl || []).filter(x => x !== null);
      return v.length > 50 ? 'ok, ' + v.length + ' uurwaarden' : 'te weinig data: ' + v.length;
    } },
  { name: 'Open-Meteo getij — Praag (binnenland)', critical: false, type: 'json',
    url: 'https://marine-api.open-meteo.com/v1/marine?latitude=50.08&longitude=14.43&hourly=sea_level_height_msl&past_days=1&forecast_days=2&timezone=auto&cell_selection=sea',
    validate: j => {
      const v = (j.hourly?.sea_level_height_msl || []).filter(x => x !== null);
      return 'levert ' + v.length + ' uurwaarden (app toont dan zachte melding)';
    } },
  { name: 'Open-Meteo weer — Scheveningen (best match)', critical: true, type: 'json',
    url: 'https://api.open-meteo.com/v1/forecast?latitude=52.115&longitude=4.24&current=temperature_2m&hourly=cloud_cover&daily=temperature_2m_max&forecast_days=7&timezone=auto',
    validate: j => {
      const ok = j.current && j.current.temperature_2m !== null &&
        (j.daily?.temperature_2m_max || []).filter(x => x !== null).length === 7 &&
        (j.hourly?.cloud_cover || []).filter(x => x !== null).length > 100;
      return ok ? 'ok: current + 7 dagen + bewolking' : 'te weinig data: ' + JSON.stringify(j).slice(0, 120);
    } },
  { name: 'Open-Meteo weer — model ECMWF expliciet', critical: false, type: 'json',
    url: 'https://api.open-meteo.com/v1/forecast?latitude=52.115&longitude=4.24&current=temperature_2m&daily=temperature_2m_max&forecast_days=7&timezone=auto&models=ecmwf_ifs025',
    validate: j => {
      const n = (j.daily?.temperature_2m_max || []).filter(x => x !== null).length;
      return 'levert ' + n + '/7 dagen';
    } },
  { name: 'Open-Meteo weer — model KNMI expliciet', critical: false, type: 'json',
    url: 'https://api.open-meteo.com/v1/forecast?latitude=52.115&longitude=4.24&current=temperature_2m&daily=temperature_2m_max&forecast_days=7&timezone=auto&models=knmi_seamless',
    validate: j => {
      const n = (j.daily?.temperature_2m_max || []).filter(x => x !== null).length;
      return 'levert ' + n + '/7 dagen (kort bereik is verwacht)';
    } },
  { name: 'RainViewer weather-maps.json', critical: false, type: 'json',
    url: 'https://api.rainviewer.com/public/weather-maps.json',
    validate: j => {
      const n = j.radar?.past?.length || 0;
      return n > 0 ? 'ok, ' + n + ' frames · host=' + j.host : 'GEEN frames — API vermoedelijk gestopt';
    } },
];

let rainviewerTile = null;
const rows = [];
let criticalFail = 0;

for (const c of checks) {
  let status = '❌', detail = '';
  try {
    const res = await fetch(c.url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      detail = 'HTTP ' + res.status;
    } else if (c.type === 'image') {
      const buf = await res.arrayBuffer();
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('image') && buf.byteLength > 500) { status = '✅'; detail = ct + ', ' + buf.byteLength + ' B'; }
      else detail = 'geen bruikbare afbeelding (' + ct + ', ' + buf.byteLength + ' B)';
    } else if (c.type === 'json') {
      const j = await res.json();
      detail = c.validate ? c.validate(j) : 'ok';
      status = detail.startsWith('GEEN') || detail.startsWith('te weinig') ? '❌' : '✅';
      if (c.name.startsWith('RainViewer') && j.radar?.past?.length) {
        const f = j.radar.past[j.radar.past.length - 1];
        rainviewerTile = j.host + f.path + '/256/6/32/21/2/1_1.png';
      }
    } else {
      const t = await res.text();
      if (t.length > 1000) { status = '✅'; detail = t.length + ' bytes'; } else detail = 'te kort antwoord';
    }
  } catch (e) {
    detail = e.name === 'TimeoutError' ? 'timeout' : e.message;
  }
  if (status === '❌' && c.critical) criticalFail++;
  rows.push({ ...c, status, detail });
}

// Zoom-probe: RainViewer ondersteunt tegels t/m z7. De app clampt op
// maxNativeZoom 8 met 512px-tegels en zoomOffset -1 (= tegel-z 7).
// Deze probe slaat alarm zodra dat maximum verandert.
if (rainviewerTile) {
  const tileAt = (lat, lon, z) => {
    const n = 2 ** z;
    const x = Math.floor((lon + 180) / 360 * n);
    const la = lat * Math.PI / 180;
    const y = Math.floor((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * n);
    return { x, y };
  };
  const basePath = rainviewerTile.split('/256/')[0];
  const sizes = [];
  for (const z of [6, 7, 8]) {
    const { x, y } = tileAt(52.11, 4.24, z);
    let detail = '', ok = false;
    try {
      const res = await fetch(`${basePath}/512/${z}/${x}/${y}/2/1_1.png`, { signal: AbortSignal.timeout(15000) });
      const buf = await res.arrayBuffer();
      sizes[z] = buf.byteLength;
      detail = 'HTTP ' + res.status + ', ' + buf.byteLength + ' B';
      ok = res.ok && buf.byteLength > 100;
    } catch (e) { detail = e.message; }
    // z6 en z7 moeten echte tegels zijn (kritiek); z8 is informatief —
    // levert RainViewer daar ooit wél echte data, dan kan de clamp omhoog.
    const critical = z <= 7;
    const status = ok ? '✅' : '❌';
    if (!ok && critical) criticalFail++;
    rows.push({ name: `RainViewer radartegel z${z} (512px)`, critical, status, detail });
  }
  // placeholder-detectie: als z8 exact even groot is als z7 is dat verdacht,
  // maar de echte bewaking is de e2e-test die de URL-zoom clampt.
}

// Eenmalige probe voor de Bortle-decoder: haal het decodeer-JS van de
// Lorenz-lichtvervuilingsatlas op (sandbox kan deze host niet bereiken).
let lorenz = '';
try {
  const r = await fetch('https://djlorenz.github.io/astronomy/lp/overlay/dark.html', { signal: AbortSignal.timeout(15000) });
  const t = await r.text();
  const i = t.indexOf('binary_tiles');
  lorenz = i >= 0 ? t.slice(Math.max(0, i - 2200), i + 2800)
                  : '(geen "binary_tiles" in dark.html; lengte=' + t.length + ')';
} catch (e) { lorenz = 'probe mislukt: ' + e.message; }
console.log('\n### Lorenz-atlas probe\n```\n' + lorenz + '\n```\n');

let md = '## Databronnen-smoketest\n\n| Bron | Status | Detail | Kritiek |\n|---|---|---|---|\n';
for (const r of rows) md += `| ${r.name} | ${r.status} | ${r.detail} | ${r.critical ? 'ja' : 'nee'} |\n`;
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);

if (criticalFail > 0) { console.error(criticalFail + ' kritieke bron(nen) kapot'); process.exit(1); }
