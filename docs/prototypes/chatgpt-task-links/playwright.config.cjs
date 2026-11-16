'use strict';

const path = require('node:path');
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: 'demo.spec.cjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30000,
  reporter: 'line',
  outputDir: path.resolve(__dirname, '../../../.tmp/task-links-test-results'),
  use: {
    baseURL: 'http://127.0.0.1:4178',
    browserName: 'chromium',
    channel: 'chrome',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node serve.cjs',
    cwd: __dirname,
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: !process.env.CI,
  },
});
