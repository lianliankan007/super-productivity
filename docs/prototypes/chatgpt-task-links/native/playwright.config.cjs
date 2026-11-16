'use strict';
const path = require('node:path');
const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: __dirname,
  testMatch: 'native.spec.cjs',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90000,
  reporter: 'line',
  outputDir: path.resolve(__dirname, '../../../../.tmp/native-demo-test-results'),
  use: {
    baseURL: 'http://127.0.0.1:4179',
    channel: 'chrome',
    headless: true,
    locale: 'zh-CN',
    viewport: { width: 1600, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node serve.cjs',
    cwd: __dirname,
    url: 'http://127.0.0.1:4179/native/',
    reuseExistingServer: !process.env.CI,
  },
});
