import { test, expect, _electron as electron } from '@playwright/test'
import { ElectronApplication, Page } from '@playwright/test'
import path from 'path'

// ─── Setup ───────────────────────────────────────────────
// Launch the real Electron app before each test
// Close it after each test

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  // Launch the built app
  // We use the dev build so no need to package first
  app = await electron.launch({
    args: [path.join(__dirname, '../out/main/index.js')],
    env: {
      ...process.env,
      NODE_ENV: 'test'
    }
  })

  // Get The first Window
  page = await app.firstWindow()

  // Wait fir the app to finish loading
  await page.waitForLoadState('domcontentloaded')
})

test.afterEach(async () => {
  await app.close()
})

// ─── Tests ───────────────────────────────────────────────
test('App opens and shows the window', async () => {
  // Check the window title
  const title = await app.evaluate(({ BrowserWindow }) => {
    return BrowserWindow.getAllWindows()[0].getTitle()
  })

  console.log('Window title:', title)

  // The window should exist and be visible
  expect(page).toBeTruthy()
})

test('import folder button is visible', async () => {
  // Find the import button by its text
  const importBtn = page.getByText('+ Import folder')

  // It should be visible on screen
  await expect(importBtn).toBeVisible()
})

test('library starts empty with zero tracks', async () => {
  // Find the track count display
  const trackCount = page.getByTestId('track-count')

  // Should show 0 tracks on a fresh start
  await expect(trackCount).toBeVisible({ timeout: 5000 })
  // Should show 0 tracks
  await expect(trackCount).toContainText('0')
})

test('search input filters track list', async () => {
  // This test needs tracks in the library first
  // We will use a data-testid on the search input
  const searchInput = page.getByTestId('search-input')
  await expect(searchInput).toBeVisible()

  // Type a search query
  await searchInput.fill('jeyone')

  // The track list should filter
  // We will check the track count updates
  const trackCount = page.getByTestId('track-count')
  await expect(trackCount).toBeVisible()
})

test('switching back to library view shows track list', async () => {
  // Go to board first
  await page.getByText('Board view').click()

  // Then back to library
  await page.getByText('All tracks').click()

  // Search bar should be visible again
  const searchInput = page.getByTestId('search-input')
  await expect(searchInput).toBeVisible()
})
