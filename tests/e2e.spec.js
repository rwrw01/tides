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

  test('satelliet-toggle wisselt naar Esri-tegels', async ({ page }) => {
    await page.waitForFunction(
      () => document.querySelectorAll('#map img.leaflet-tile-loaded').length >= 1,
      null, { timeout: 25_000 });
    await page.click('#layerBtn');
    await page.waitForFunction(
      () => [...document.querySelectorAll('#map img.leaflet-tile')].some(i => i.src.includes('arcgisonline')),
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

  test('service worker registreert', async ({ page }) => {
    const ok = await page.evaluate(() =>
      navigator.serviceWorker.register('./sw.js').then(r => !!r, () => false));
    expect(ok).toBeTruthy();
  });
});
