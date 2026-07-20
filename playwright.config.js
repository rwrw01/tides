const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: 1,
  workers: 2, // niet alle tests tegelijk op de echte API's (429-risico)
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:8080',
    ...devices['iPhone 13'],
    browserName: 'chromium',
    screenshot: 'only-on-failure',
    // de app-SW claimt pagina's (clients.claim); fetches lopen dan buiten
    // page.route om en de Open-Meteo-stubs vallen weg. Blokkeren dus;
    // SW-gedrag test apart met een fetch-shim (tests/e2e.spec.js, Offline).
    serviceWorkers: 'block',
  },
  webServer: {
    command: 'python3 -m http.server 8080',
    port: 8080,
    reuseExistingServer: true,
  },
});
