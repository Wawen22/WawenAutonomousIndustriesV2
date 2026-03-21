import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { log } from './logger.js'

export interface ScreenshotResult {
  ok: boolean
  path?: string
  error?: string
}

/**
 * Captures a screenshot of a given URL and saves it to the specified output path.
 * Uses Playwright (Chromium) in headless mode.
 */
export async function captureScreenshot(
  url: string,
  outputPath: string
): Promise<ScreenshotResult> {
  log.info({ url, outputPath }, 'Capturing screenshot')

  let browser
  try {
    // Ensure the output directory exists
    await mkdir(dirname(outputPath), { recursive: true })

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    })

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    })

    const page = await context.newPage()

    // Navigate with a reasonable timeout (30s)
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 30000,
    })

    // Wait a bit more for any final animations or transitions
    await page.waitForTimeout(1000)

    await page.screenshot({
      path: outputPath,
      type: 'png',
      fullPage: false, // Initial request says "scattare uno screenshot della pagina", standard viewport is usually enough for a quick preview
    })

    log.info({ url, outputPath }, 'Screenshot captured successfully')
    return { ok: true, path: outputPath }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log.error({ url, outputPath, err: errorMessage }, 'Failed to capture screenshot')
    return { ok: false, error: errorMessage }
  } finally {
    if (browser) {
      await browser.close().catch(() => {})
    }
  }
}
