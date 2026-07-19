// Echte end-to-end tests: draaien in CI (GitHub Actions) met vol internet,
// dus tegen de echte kaart-, radar- en getijden-API's. iPhone-viewport.
const { test, expect } = require('@playwright/test');

test.describe('Getijden-app (live databronnen)', () => {
  test.beforeEach(async ({ page }) => {
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

  test('lagenmenu: OpenWeatherMap-overlay laadt tegels (key geldig)', async ({ page }) => {
    await page.click('#layerBtn');
    await page.click('#ovSeg button[data-ov="clouds_new"]');
    await page.click('#layerDone');
    // leaflet-tile-loaded verschijnt alleen bij een geslaagde download → valideert ook de API-key
    await page.waitForFunction(
      () => [...document.querySelectorAll('#map img.leaflet-tile-loaded')].some(i => i.src.includes('tile.openweathermap.org')),
      null, { timeout: 25_000 });
  });

  test('getij op zee: Scheveningen toont data', async ({ page }) => {
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
    await expect(page.locator('#dots .dot')).toHaveCount(4);
    await page.click('#cfgBtn');
    await expect(page.locator('#cfgList .cfg-row')).toHaveCount(4);
    await page.click('#cfgList .cfg-row[data-id="hemel"] button[data-act="toggle"]');
    await expect(page.locator('#dots .dot')).toHaveCount(3);
    await page.click('#cfgList .cfg-row[data-id="hemel"] button[data-act="toggle"]');
    await page.click('#cfgDone');
    await expect(page.locator('#cfgSheet')).toBeHidden();
  });

  test('weer-paneel: actueel + 7 dagen (live API)', async ({ page }) => {
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

  test('nachthemel: 7 nachten met sterrenkijk-score', async ({ page }) => {
    await page.evaluate(() => selectLocation(52.115, 4.24));
    await expect(page.locator('#nx')).toBeVisible({ timeout: 25_000 });
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
