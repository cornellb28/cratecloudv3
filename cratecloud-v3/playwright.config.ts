import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 30000, // 30 seconds per test
  retries: 0, // no retries while learning
  reporter: 'list', // clean terminal output
  use: {
    screenshot: 'only-on-failure', // save screenshots when tests fail
    video: 'retain-on-failure' // save video when tests fail
  }
})
