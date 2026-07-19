// Non-happy-flow tests: falende API's, trage responses, corrupte opslag,
// geweigerde permissies. Doel: de app degradeert netjes, crasht nooit en
// blijft bedienbaar. Alle externe bronnen worden hier per test gemanipuleerd.
const { test, expect } = require('@playwright/test');

function seaFixture(big){
  const start = new Date(); start.setHours(0,0,0,0); start.setDate(start.getDate()-1);
  const pad = x => String(x).padStart(2,'0');
  const amp = big ? 1.7 : 0.08, amp2 = big ? 0.55 : 0.03;
  const time=[], vals=[], wave=[], sst=[];
  for (let i=0;i<72;i++){ const d=new Date(start.getTime()+i*3600e3);
    time.push(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`);
    vals.push(+(amp*Math.cos(2*Math.PI*i/12.4206)+amp2*Math.cos(2*Math.PI*i/12)).toFixed(3));
    wave.push(1.2); sst.push(13.4); }
  return { utc_offset_seconds: 7200,
    hourly: { time, sea_level_height_msl: vals, wave_height: wave, sea_surface_temperature: sst } };
}
function wxFixture(){
  const start = new Date(); start.setHours(0,0,0,0);
  const pad = x => String(x).padStart(2,'0');
  const time=[], temp=[], prec=[], cloud=[], code=[];
  for (let i=0;i<168;i++){ const d=new Date(start.getTime()+i*3600e3);
    time.push(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`);
    temp.push(15); prec.push(0); cloud.push(40); code.push(2); }
  const dtime=[];
  for (let k=0;k<7;k++){ const d=new Date(start.getTime()+k*86400e3);
    dtime.push(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`); }
  return { utc_offset_seconds: 7200,
    current: { temperature_2m: 18, apparent_temperature: 17, dew_point_2m: 12, precipitation: 0,
               weather_code: 2, wind_speed_10m: 10, wind_direction_10m: 200, wind_gusts_10m: 20 },
    hourly: { time, temperature_2m: temp, precipitation: prec, cloud_cover: cloud, weather_code: code },
    daily: { time: dtime, weather_code: [2,2,2,2,2,2,2],
             temperature_2m_max: [20,20,20,20,20,20,20], temperature_2m_min: [10,10,10,10,10,10,10],
             precipitation_sum: [0,0,0,0,0,0,0], precipitation_probability_max: [0,0,0,0,0,0,0] } };
}
const wxOk = page => page.route('**://api.open-meteo.com/**', r => r.fulfill({ json: wxFixture() }));
const seaOk = page => page.route('**://marine-api.open-meteo.com/**', r => r.fulfill({ json: seaFixture(true) }));

test.describe('Non-happy flows', () => {

  test.beforeEach(async ({ page }) => {
    // plaatsnamen deterministisch uit: hier testen we degradatie, geen geocoding
    await page.route('**://nominatim.openstreetmap.org/**', r =>
      r.fulfill({ json: { error: 'Unable to geocode' } }));
  });

  test('geocoding plat → coördinaten blijven gewoon staan', async ({ page }) => {
    await seaOk(page); await wxOk(page);
    await page.route('**://nominatim.openstreetmap.org/**', r => r.abort('failed'));
    await page.goto('/app/index.html');
    await page.evaluate(() => selectLocation(52.115, 4.24));
    await expect(page.locator('#data')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#locName')).toHaveText(/52\.12°N/);
  });

  test('getij-API geeft 500 → duidelijke fout, app blijft bedienbaar', async ({ page }) => {
    await wxOk(page);
    await page.route('**://marine-api.open-meteo.com/**', r => r.fulfill({ status: 500, body: 'boom' }));
    await page.goto('/app/index.html');
    await page.evaluate(() => selectLocation(52.115, 4.24));
    await expect(page.locator('#hint')).toHaveText(/HTTP 500/, { timeout: 20_000 });
    await expect(page.locator('#hint')).toHaveClass(/err/);
    // weer werkt onafhankelijk door, en de UI blijft bedienbaar
    await expect(page.locator('#wx')).toBeVisible({ timeout: 15_000 });
    await page.click('#cfgBtn');
    await expect(page.locator('#cfgList .cfg-row')).toHaveCount(3);
  });

  test('weer-API plat → getij blijft gewoon werken', async ({ page }) => {
    await seaOk(page);
    await page.route('**://api.open-meteo.com/**', r => r.abort('failed'));
    await page.goto('/app/index.html');
    await page.evaluate(() => selectLocation(52.115, 4.24));
    await expect(page.locator('#data')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#wxHint')).toHaveText(/⚠️/, { timeout: 20_000 });
    await expect(page.locator('#wx')).toBeHidden();
  });

  test('kapotte JSON van het weermodel → nette melding, geen crash', async ({ page }) => {
    await seaOk(page);
    await page.route('**://api.open-meteo.com/**', r => r.fulfill({ json: { rommel: true } }));
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto('/app/index.html');
    await page.evaluate(() => selectLocation(52.115, 4.24));
    await expect(page.locator('#wxHint')).toHaveText(/Onvolledige weerdata/, { timeout: 20_000 });
    await expect(page.locator('#data')).toBeVisible({ timeout: 20_000 });
    expect(errors).toEqual([]);
  });

  test('trage respons + snelle pin-wissel → laatste pin wint (race)', async ({ page }) => {
    await wxOk(page);
    await page.route('**://marine-api.open-meteo.com/**', async r => {
      const lat = parseFloat(new URL(r.request().url()).searchParams.get('latitude'));
      if (lat > 50){ // eerste pin: groot getij, maar traag
        await new Promise(res => setTimeout(res, 3000));
        return r.fulfill({ json: seaFixture(true) });
      }
      return r.fulfill({ json: seaFixture(false) }); // tweede pin: minigetij, snel
    });
    await page.goto('/app/index.html');
    await page.evaluate(() => selectLocation(52.115, 4.24)); // traag
    await page.evaluate(() => selectLocation(43.66, 7.25));  // snel, moet winnen
    await expect(page.locator('#pill')).toHaveText(/vrijwel geen getij|microtidaal/, { timeout: 15_000 });
    await page.waitForTimeout(3500); // trage respons komt binnen — mag niets overschrijven
    await expect(page.locator('#pill')).toHaveText(/vrijwel geen getij|microtidaal/);
    await expect(page.locator('#locName')).toHaveText(/43\.66/);
  });

  test('radar zonder frames → offline-melding, geen crash', async ({ page }) => {
    await seaOk(page); await wxOk(page);
    await page.route('**://api.rainviewer.com/**', r => r.fulfill({ json: { radar: { past: [] } } }));
    await page.goto('/app/index.html');
    await page.click('#radarBtn');
    await expect(page.locator('#radarTime')).toHaveText(/offline/, { timeout: 15_000 });
  });

  test('Lorenz-atlas onbereikbaar → Bortle n.b.', async ({ page }) => {
    await seaOk(page); await wxOk(page);
    await page.route('**://djlorenz.github.io/**', r => r.abort('failed'));
    await page.goto('/app/index.html');
    await page.evaluate(() => selectLocation(52.115, 4.24));
    await expect(page.locator('#nxBortle')).toHaveText('n.b.', { timeout: 20_000 });
    await expect(page.locator('#nxBortleS')).toHaveText(/atlas niet beschikbaar/);
  });

  test('corrupte localStorage → app start gewoon op', async ({ page }) => {
    await seaOk(page); await wxOk(page);
    await page.addInitScript(() => {
      localStorage.setItem('tidepin', '{kapot json');
      localStorage.setItem('panelcfg', '["geen","object"]');
      localStorage.setItem('wxmodel', 'niet-bestaand-model');
      localStorage.setItem('wxrange', 'xyz');
    });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto('/app/index.html');
    await expect(page.locator('#hint')).toHaveText(/Tik op de kaart/);
    await expect(page.locator('#dots .dot')).toHaveCount(3);
    expect(errors).toEqual([]);
  });

  test('opgeslagen pin met onzin-coördinaten wordt genegeerd', async ({ page }) => {
    await seaOk(page); await wxOk(page);
    await page.addInitScript(() => localStorage.setItem('tidepin', JSON.stringify({ lat: 999, lon: 5 })));
    await page.goto('/app/index.html');
    await expect(page.locator('#hint')).toHaveText(/Tik op de kaart/);
  });

  test('geolocatie geweigerd → duidelijke melding', async ({ page, context }) => {
    await seaOk(page); await wxOk(page);
    // geen grantPermissions: de prompt wordt automatisch geweigerd
    await page.goto('/app/index.html');
    await page.click('#locBtn');
    await expect(page.locator('#hint')).toHaveText(/Locatie niet beschikbaar/, { timeout: 15_000 });
  });
});
