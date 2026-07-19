// E2E in CI (GitHub Actions, vol internet). Kaarttegels, radar, OWM-key en
// de Lorenz-atlas worden LIVE getest. Open-Meteo wordt gestubd: GitHub-runners
// delen IP-ranges die door Open-Meteo geregeld gethrottled worden (429),
// waardoor live-tests structureel flaky zijn; het API-contract wordt apart
// bewaakt door tests/datasources.mjs (1 call per bron, wekelijks + per push).
const { test, expect } = require('@playwright/test');

function marineFixture(url){
  const lat = parseFloat(url.searchParams.get('latitude'));
  const lon = parseFloat(url.searchParams.get('longitude'));
  const inland = (lat > 45 && lon > 10) || (Math.abs(lat) < 0.5 && Math.abs(lon) < 0.5); // Praag e.d.
  const start = new Date(); start.setHours(0,0,0,0); start.setDate(start.getDate()-1);
  const pad = x => String(x).padStart(2,'0');
  const time=[], vals=[], wave=[], sst=[];
  for (let i=0;i<72;i++){ const d=new Date(start.getTime()+i*3600e3);
    time.push(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`);
    vals.push(inland?null:+(1.7*Math.cos(2*Math.PI*i/12.4206)+0.55*Math.cos(2*Math.PI*i/12)).toFixed(3));
    wave.push(inland?null:+(1.1+0.7*Math.sin(i/5)).toFixed(2)); sst.push(inland?null:13.4); }
  return { utc_offset_seconds: 7200,
    hourly: { time, sea_level_height_msl: vals, wave_height: wave, sea_surface_temperature: sst } };
}
function forecastFixture(){
  const start = new Date(); start.setHours(0,0,0,0);
  const pad = x => String(x).padStart(2,'0');
  const time=[], temp=[], prec=[], cloud=[], code=[];
  for (let i=0;i<168;i++){ const d=new Date(start.getTime()+i*3600e3);
    time.push(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`);
    temp.push(+(15+8*Math.sin(2*Math.PI*(i-9)/24)).toFixed(1));
    prec.push(i%13===0?0.8:0); cloud.push(Math.round(50+45*Math.sin(i/7))); code.push(i%13===0?61:2); }
  const dtime=[], wmax=[], wmin=[], wcode=[], psum=[], pprob=[];
  for (let k=0;k<7;k++){ const d=new Date(start.getTime()+k*86400e3);
    dtime.push(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`);
    wmax.push(21+k%3); wmin.push(11+k%2); wcode.push([1,3,61,80,2,0,95][k]);
    psum.push([0,1.2,4,0,0,2.2,6][k]); pprob.push([5,40,80,10,0,60,90][k]); }
  return { utc_offset_seconds: 7200,
    current: { temperature_2m:18.4, apparent_temperature:17.2, dew_point_2m:12.1, precipitation:0,
               weather_code:2, wind_speed_10m:14, wind_direction_10m:230, wind_gusts_10m:33 },
    hourly: { time, temperature_2m:temp, precipitation:prec, cloud_cover:cloud, weather_code:code },
    daily: { time:dtime, weather_code:wcode, temperature_2m_max:wmax, temperature_2m_min:wmin,
             precipitation_sum:psum, precipitation_probability_max:pprob } };
}

test.describe('Getijden-app (UI; tegels/radar/atlas live, Open-Meteo gestubd)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**://marine-api.open-meteo.com/**', route =>
      route.fulfill({ json: marineFixture(new URL(route.request().url())) }));
    await page.route('**://api.open-meteo.com/**', route =>
      route.fulfill({ json: forecastFixture() }));
    // default: geen plaatsnaam, zodat coördinaat-asserts deterministisch blijven
    await page.route('**://nominatim.openstreetmap.org/**', route =>
      route.fulfill({ json: { error: 'Unable to geocode' } }));
    await page.goto('/app/index.html');
  });

  test('kaarttegels laden echt (CARTO)', async ({ page }) => {
    await expect(page.locator('#mapErr')).toBeHidden();
    await page.waitForFunction(
      () => document.querySelectorAll('#map img.leaflet-tile-loaded').length >= 4,
      null, { timeout: 25_000 });
    const src = await page.evaluate(() => document.querySelector('#map img.leaflet-tile-loaded').src);
    expect(src).toContain('basemaps.cartocdn.com');
  });

  test('kaart blijft licht in dark mode', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload();
    await page.waitForFunction(
      () => document.querySelectorAll('#map img.leaflet-tile-loaded').length >= 1,
      null, { timeout: 25_000 });
    const srcs = await page.evaluate(() =>
      [...document.querySelectorAll('#map img.leaflet-tile')].map(i => i.src));
    expect(srcs.some(s => s.includes('voyager'))).toBeTruthy();
    expect(srcs.some(s => s.includes('dark_all'))).toBeFalsy();
  });

  test('locaties: vastzetten, kiezen uit lijst, swipe-verwijderen', async ({ page }) => {
    await page.evaluate(() => selectLocation(52.115, 4.24));
    await expect(page.locator('#pinBtn')).toBeVisible({ timeout: 15_000 });
    await page.click('#pinBtn');
    await expect(page.locator('#pinBtn')).toHaveClass(/on/);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('savedlocs')).length)).toBe(1);
    // kiezen uit de lijst
    await page.evaluate(() => selectLocation(43.66, 7.25));
    await page.click('#listBtn');
    await expect(page.locator('#locList .loc-item')).toHaveCount(1);
    await page.click('#locList .loc-main');
    await expect(page.locator('#locSheet')).toBeHidden();
    await expect(page.locator('#locName')).toHaveText(/52\.12°N/, { timeout: 10_000 });
    // swipe naar links (iOS-patroon) en verwijderen
    await page.click('#listBtn');
    const box = await page.locator('#locList .loc-main').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 130, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect(page.locator('#locList .loc-main')).toHaveClass(/open/);
    await page.click('#locList .loc-del');
    await expect(page.locator('#locList .loc-item')).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('savedlocs')).length)).toBe(0);
  });

  test('lagenmenu: satelliet-basiskaart wisselt naar Esri-tegels', async ({ page }) => {
    await page.waitForFunction(
      () => document.querySelectorAll('#map img.leaflet-tile-loaded').length >= 1,
      null, { timeout: 25_000 });
    await page.click('#layerBtn');
    await page.click('#baseSeg button[data-base="sat"]');
    await page.click('#layerDone');
    await page.waitForFunction(
      () => [...document.querySelectorAll('#map img.leaflet-tile')].some(i => i.src.includes('arcgisonline')),
      null, { timeout: 25_000 });
  });

  test('lagenmenu: OpenWeatherMap-overlay laadt tegels (key geldig)', async ({ page, request }) => {
    // nieuwe OWM-keys hebben activatietijd; skip zolang de API 401 geeft
    const probe = await request.get('https://tile.openweathermap.org/map/clouds_new/6/32/21.png?appid=645b6d61fc5840fada8d370fc3d32896');
    test.skip(probe.status() === 401, 'OWM-key nog niet geactiveerd (401)');
    await page.click('#layerBtn');
    await page.click('#ovSeg button[data-ov="clouds_new"]');
    await page.click('#layerDone');
    // leaflet-tile-loaded verschijnt alleen bij een geslaagde download → valideert ook de API-key
    await page.waitForFunction(
      () => [...document.querySelectorAll('#map img.leaflet-tile-loaded')].some(i => i.src.includes('tile.openweathermap.org')),
      null, { timeout: 25_000 });
  });

  test('ver uitzoomen kan de kaart niet laten verdwalen', async ({ page }) => {
    // reproduceert de veldbug: ver uitpinchen richting open oceaan
    await page.evaluate(() => window._map.setView([0, -60], 1));
    await page.waitForTimeout(400);
    const st = await page.evaluate(() => ({ z: window._map.getZoom(), c: window._map.getCenter() }));
    expect(st.z).toBeGreaterThanOrEqual(4);          // minZoom geklemd
    expect(st.c.lat).toBeGreaterThan(20);            // teruggeduwd binnen Europa-grenzen
    expect(st.c.lng).toBeGreaterThan(-36);
    await page.evaluate(() => window._map.setZoom(6)); // kaart blijft bedienbaar
    expect(await page.evaluate(() => window._map.getZoom())).toBe(6);
  });

  test('locatieknop werkt, ook na ver uitzoomen', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 52.37, longitude: 4.90 });
    await page.evaluate(() => window._map.setView([0, -60], 1)); // eerst 'verdwalen'
    await page.click('#locBtn');
    await expect(page.locator('#locName')).toHaveText(/52\.37°N/, { timeout: 15_000 });
    // gebruikersgedrag: kaart moet naar de eigen positie springen en inzoomen
    await expect.poll(() => page.evaluate(() => window._map.getZoom()), { timeout: 8_000 }).toBeGreaterThanOrEqual(8);
    const c = await page.evaluate(() => window._map.getCenter());
    expect(Math.abs(c.lat - 52.37)).toBeLessThan(0.5);
    expect(Math.abs(c.lng - 4.90)).toBeLessThan(0.5);
  });

  test('sheet klapt in en uit via de grabber', async ({ page }) => {
    await page.click('#grab');
    await expect(page.locator('#sheet')).toHaveClass(/collapsed/);
    await page.click('#grab');
    await expect(page.locator('#sheet')).not.toHaveClass(/collapsed/);
  });

  test('getij-paneel toont watertemperatuur en golfhoogte', async ({ page }) => {
    await page.evaluate(() => selectLocation(52.115, 4.24));
    await expect(page.locator('#seaExtra')).toBeVisible({ timeout: 25_000 });
    await expect(page.locator('#sstNow')).toHaveText(/\d+,\d°|—/);
    await expect(page.locator('#wvNow')).toHaveText(/\d+,\d m|—/);
    // golf- en getijgrafiek delen dezelfde tijdas: nu-lijnen op gelijke x
    const diff = await page.evaluate(() => {
      const g = document.querySelector('#spark line[stroke="#ff3b30"]');
      const w = document.querySelector('#wvSpark line[stroke="#ff3b30"]');
      return g && w ? Math.abs(parseFloat(g.getAttribute('x1')) - parseFloat(w.getAttribute('x1'))) : 999;
    });
    expect(diff).toBeLessThan(1);
  });

  test('weer-paneel: Dag (per uur) en Week wisselen', async ({ page }) => {
    await page.evaluate(() => selectLocation(52.115, 4.24));
    await expect(page.locator('#wx')).toBeVisible({ timeout: 25_000 });
    await page.click('#rangeDag');
    await page.waitForFunction(() => document.querySelectorAll('#wxDays .wx-row').length >= 20, null, { timeout: 10_000 });
    await page.click('#rangeWeek');
    await expect(page.locator('#wxDays .wx-row')).toHaveCount(7, { timeout: 10_000 });
  });

  test('Bortle-klasse uit de Lorenz-atlas', async ({ page }) => {
    await page.evaluate(() => selectLocation(52.115, 4.24));
    await page.waitForFunction(() => {
      const t = document.getElementById('nxBortle').textContent;
      return t.startsWith('klasse') || t === 'n.b.';
    }, null, { timeout: 25_000 });
    await expect(page.locator('#nxBortle')).toHaveText(/klasse [1-9]|klasse 4–5/);
    await expect(page.locator('#nxBortleS')).toHaveText(/mag\/arcsec/);
  });

  test('plaatsnaam via reverse geocoding vervangt coördinaten', async ({ page }) => {
    await page.route('**://nominatim.openstreetmap.org/**', route => {
      const u = new URL(route.request().url());
      route.fulfill({ json: { lat: u.searchParams.get('lat'), lon: u.searchParams.get('lon'),
        address: { town: 'Teststad' } } });
    });
    await page.evaluate(() => selectLocation(52.115, 4.24));
    await expect(page.locator('#locName')).toHaveText('Teststad', { timeout: 15_000 });
  });

  test('getij op zee: Scheveningen toont data (gestubde API)', async ({ page }) => {
    await page.evaluate(() => selectLocation(52.115, 4.24));
    await expect(page.locator('#data')).toBeVisible({ timeout: 25_000 });
    await expect(page.locator('#hwT')).toHaveText(/\d{2}:\d{2}/);
    await expect(page.locator('#lwT')).toHaveText(/\d{2}:\d{2}/);
    await expect(page.locator('#pill')).toBeVisible();
    const spark = await page.locator('#spark path').count();
    expect(spark).toBeGreaterThan(0);
  });

  test('binnenland (Praag) blokkeert de app niet', async ({ page }) => {
    await page.evaluate(() => selectLocation(50.08, 14.43));
    await expect(page.locator('#hint')).toContainText(/getijdedata/i, { timeout: 25_000 });
    // geen harde foutstijl en de kaart blijft bedienbaar
    await expect(page.locator('#hint')).not.toHaveClass(/err/);
    await page.click('#layerBtn');
    await expect(page.locator('#layerSheet')).toBeVisible();
    await page.click('#layerDone');
    await expect(page.locator('#mapErr')).toBeHidden();
  });

  test('radarknop: laag met frames óf nette offline-melding', async ({ page }) => {
    await page.click('#radarBtn');
    await expect(page.locator('#radarBar')).toBeVisible();
    await page.waitForFunction(() => {
      const t = document.getElementById('radarTime').textContent;
      return /\d{2}:\d{2}/.test(t) || t.includes('offline');
    }, null, { timeout: 25_000 });
    const status = await page.locator('#radarTime').textContent();
    test.info().annotations.push({ type: 'radar-status', description: status });
    console.log('RADAR-STATUS:', status);
  });

  test('radar op hoog zoomniveau vraagt geen niet-bestaande tegels op', async ({ page }) => {
    // reproduceert de veldbug: ingezoomd (z9, Spaanse noordkust) gaf
    // "Zoom Level Not Supported"-tegels; de laag moet clampen op tegel-z 7
    await page.evaluate(() => window._map.setView([43.48, -4.92], 9));
    await page.click('#radarBtn');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('#map img.leaflet-tile')].some(i => i.src.includes('rainviewer')),
      null, { timeout: 25_000 });
    const zooms = await page.evaluate(() =>
      [...document.querySelectorAll('#map img.leaflet-tile')]
        .filter(i => i.src.includes('rainviewer'))
        .map(i => parseInt(i.src.split('/512/')[1], 10)));
    expect(zooms.length).toBeGreaterThan(0);
    for (const z of zooms) expect(z).toBeLessThanOrEqual(7);
  });

  test('astronomie-paneel: werkt ook zonder getijdedata (binnenland)', async ({ page }) => {
    await page.evaluate(() => selectLocation(50.08, 14.43)); // Praag
    await expect(page.locator('#astro')).toBeVisible({ timeout: 25_000 });
    await expect(page.locator('#sunrise')).toHaveText(/\d{2}:\d{2}/);
    await expect(page.locator('#sunset')).toHaveText(/\d{2}:\d{2}/);
    await expect(page.locator('#moonPhase')).not.toHaveText('–');
  });

  test('panelen: dots en instellingenmenu', async ({ page }) => {
    await expect(page.locator('#dots .dot')).toHaveCount(3);
    await page.click('#cfgBtn');
    await expect(page.locator('#cfgList .cfg-row')).toHaveCount(3);
    await page.click('#cfgList .cfg-row[data-id="hemel"] button[data-act="toggle"]');
    await expect(page.locator('#dots .dot')).toHaveCount(2);
    await page.click('#cfgList .cfg-row[data-id="hemel"] button[data-act="toggle"]');
    await page.click('#cfgDone');
    await expect(page.locator('#cfgSheet')).toBeHidden();
  });

  test('weer-paneel: actueel + 7 dagen (gestubde API)', async ({ page }) => {
    await page.evaluate(() => selectLocation(52.115, 4.24));
    await expect(page.locator('#wx')).toBeVisible({ timeout: 25_000 });
    await expect(page.locator('#wxTemp')).toHaveText(/-?\d+°/);
    await expect(page.locator('#wxDays .wx-row')).toHaveCount(7, { timeout: 15_000 });
    expect(await page.locator('#wxChart path').count()).toBeGreaterThan(0);
  });

  test('modelkiezer: ECMWF levert ook data', async ({ page }) => {
    await page.evaluate(() => selectLocation(52.115, 4.24));
    await expect(page.locator('#wx')).toBeVisible({ timeout: 25_000 });
    await page.selectOption('#wxModel', 'ecmwf_ifs025');
    await expect(page.locator('#wx')).toBeVisible({ timeout: 25_000 });
    await expect(page.locator('#wxTemp')).toHaveText(/-?\d+°/);
    await expect(page.locator('#wxHint')).toBeHidden();
  });

  test('hemel-paneel: sterrenkijk-index met 7 nachten', async ({ page }) => {
    await page.evaluate(() => selectLocation(52.115, 4.24));
    await expect(page.locator('#nx')).toBeVisible({ timeout: 35_000 });
    await expect(page.locator('#nxNights .nx-row')).toHaveCount(7, { timeout: 15_000 });
    await expect(page.locator('#nxTonight')).toHaveText(/\d+\/10|—/);
    await expect(page.locator('#nxDark')).toHaveText(/\d{2}:\d{2}–\d{2}:\d{2}/);
  });

  test('service worker registreert', async ({ page }) => {
    const ok = await page.evaluate(() =>
      navigator.serviceWorker.register('./sw.js').then(r => !!r, () => false));
    expect(ok).toBeTruthy();
  });
});
