// Databronnen-smoketest: controleert elke externe bron rechtstreeks.
// Draait in CI (vol internet). Kritieke bronnen laten de job falen,
// informatieve bronnen (radar, satelliet) alleen rapporteren.
import fs from 'node:fs';

const checks = [
  { name: 'CARTO Voyager-tegel', critical: true, type: 'image',
    url: 'https://a.basemaps.cartocdn.com/rastertiles/voyager/6/32/21.png' },
  { name: 'CARTO Voyager retina (@2x)', critical: true, type: 'image',
    url: 'https://a.basemaps.cartocdn.com/rastertiles/voyager/6/32/21@2x.png' },
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
      return ok ? 'ok: current + 7 dagen + bewolking' : 'onvolledig: ' + JSON.stringify(j).slice(0, 120);
    } },
  { name: 'Open-Meteo weer — blend ICON-EU + ECMWF (app-standaard)', critical: true, type: 'json',
    url: 'https://api.open-meteo.com/v1/forecast?latitude=52.115&longitude=4.24&current=temperature_2m&hourly=temperature_2m,cloud_cover_low,cloud_cover_mid,cloud_cover_high,wind_speed_10m,wind_direction_10m,pressure_msl,precipitation_probability&daily=temperature_2m_max&forecast_days=7&timezone=auto&models=icon_eu,ecmwf_ifs025',
    validate: j => {
      const h = j.hourly || {};
      const icon = (h.temperature_2m_icon_eu || []).filter(x => x !== null).length;
      const ec = (h.temperature_2m_ecmwf_ifs025 || []).filter(x => x !== null).length;
      const druk = (h.pressure_msl_icon_eu || h.pressure_msl_ecmwf_ifs025 || []).filter(x => x !== null).length;
      // wolkenlagen voeden het meteogram; per laag volstaat één van beide modellen
      const laag = ['cloud_cover_low','cloud_cover_mid','cloud_cover_high'].map(k =>
        Math.max((h[k + '_icon_eu'] || []).filter(x => x !== null).length,
                 (h[k + '_ecmwf_ifs025'] || []).filter(x => x !== null).length));
      const wolk = Math.min(...laag);
      return icon > 50 && ec > 100 && druk > 50 && wolk > 50
        ? 'ok: icon ' + icon + 'u, ecmwf ' + ec + 'u, druk ' + druk + 'u, wolkenlagen ' + laag.join('/') + 'u'
        : 'onvolledig: icon=' + icon + ' ecmwf=' + ec + ' druk=' + druk + ' wolkenlagen=' + laag.join('/');
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
  { name: 'OpenWeatherMap overlay-tegel (bewolking, key-check)', critical: false, type: 'image',
    url: 'https://tile.openweathermap.org/map/clouds_new/6/32/21.png?appid=645b6d61fc5840fada8d370fc3d32896' },
  { name: 'Lorenz-atlas binaire tegel (NL: tegel 37,24)', critical: false, type: 'text',
    url: 'https://djlorenz.github.io/astronomy/binary_tiles/2024/binary_tile_37_24.dat.gz' },
  { name: 'Open-Meteo geocoding (zoeken: Scheveningen)', critical: false, type: 'json',
    url: 'https://geocoding-api.open-meteo.com/v1/search?name=Scheveningen&count=5&language=nl&format=json',
    validate: j => {
      const r = (j.results || [])[0];
      return r && typeof r.latitude === 'number' ? 'ok: ' + r.name + ' (' + r.latitude.toFixed(2) + ')' :
        'geen resultaten: ' + JSON.stringify(j).slice(0, 120);
    } },
  { name: 'Nominatim reverse geocoding (Scheveningen)', critical: false, type: 'json',
    url: 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=52.115&lon=4.24&zoom=10&accept-language=nl',
    validate: j => {
      const a = j.address || {};
      const naam = a.city || a.town || a.village || a.municipality || a.suburb || a.county;
      return naam ? 'ok: ' + naam : 'geen plaatsnaam in respons: ' + JSON.stringify(j).slice(0, 120);
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
    let res = null;
    for (let attempt = 0; attempt < 3; attempt++){
      try {
        res = await fetch(c.url, { signal: AbortSignal.timeout(15000) });
        if (res.ok || (res.status !== 429 && res.status < 500)) break;
      } catch (netErr) { if (attempt === 2) throw netErr; }
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    }
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
      status = detail.startsWith('GEEN') || detail.startsWith('te weinig') || detail.startsWith('onvolledig') ? '❌' : '✅';
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

// Probe voor de Bortle-decoder: vind compressed2full() en de resterende
// LP-zonegrenzen in de Lorenz-atlas (sandbox kan deze host niet bereiken).
let lorenz = '';
try {
  const base = 'https://djlorenz.github.io/astronomy/lp/overlay/';
  const r = await fetch(base + 'dark.html', { signal: AbortSignal.timeout(15000) });
  const t = await r.text();
  const bodies = [['dark.html', t]];
  for (const m of t.matchAll(/<script[^>]+src="([^"]+)"/g)){
    const u = m[1].startsWith('http') ? m[1] : base + m[1];
    if (!u.includes('djlorenz') && m[1].startsWith('http')) continue;
    try { const rr = await fetch(u, { signal: AbortSignal.timeout(15000) }); bodies.push([m[1], await rr.text()]); } catch(e){}
  }
  for (const [nm, body] of bodies){
    let i = body.indexOf('function compressed2full');
    if (i < 0) i = body.indexOf('compressed2full=');
    if (i >= 0) lorenz += '\n// compressed2full uit ' + nm + '\n' + body.slice(i, i + 900) + '\n';
    const z = body.indexOf("'5a'");
    if (z >= 0) lorenz += '\n// zones vanaf 5a uit ' + nm + '\n' + body.slice(z, z + 1700) + '\n';
  }
  if (!lorenz) lorenz = 'niets gevonden; scripts: ' +
    JSON.stringify([...t.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]));
} catch (e) { lorenz = 'probe mislukt: ' + e.message; }
console.log('\n### Lorenz-atlas probe v2\n```\n' + lorenz + '\n```\n');

let md = '## Databronnen-smoketest\n\n| Bron | Status | Detail | Kritiek |\n|---|---|---|---|\n';
for (const r of rows) md += `| ${r.name} | ${r.status} | ${r.detail} | ${r.critical ? 'ja' : 'nee'} |\n`;
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);

if (criticalFail > 0) { console.error(criticalFail + ' kritieke bron(nen) kapot'); process.exit(1); }
