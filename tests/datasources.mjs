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

if (rainviewerTile) {
  let status = '❌', detail = '';
  try {
    const res = await fetch(rainviewerTile, { signal: AbortSignal.timeout(15000) });
    const buf = await res.arrayBuffer();
    if (res.ok && buf.byteLength > 100) { status = '✅'; detail = buf.byteLength + ' B'; }
    else detail = 'HTTP ' + res.status + ', ' + buf.byteLength + ' B';
  } catch (e) { detail = e.message; }
  rows.push({ name: 'RainViewer radartegel', critical: false, status, detail });
}

let md = '## Databronnen-smoketest\n\n| Bron | Status | Detail | Kritiek |\n|---|---|---|---|\n';
for (const r of rows) md += `| ${r.name} | ${r.status} | ${r.detail} | ${r.critical ? 'ja' : 'nee'} |\n`;
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);

if (criticalFail > 0) { console.error(criticalFail + ' kritieke bron(nen) kapot'); process.exit(1); }
