import { chromium } from 'playwright'
import { Readability } from '@mozilla/readability'
import { JSDOM } from 'jsdom'
import TurndownService from 'turndown'
import { log } from './logger.js'

export interface ScrapeResult {
  ok: boolean
  url: string
  title?: string | undefined
  excerpt?: string | undefined
  markdown?: string | undefined
  error?: string | undefined
}

/**
 * Navigates to a URL via Playwright, extracts main content using Readability,
 * and converts it to Markdown using Turndown.
 */
export async function scrapeUrl(url: string): Promise<ScrapeResult> {
  log.info({ url }, 'Scraping URL for deep reading')

  let browser
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    })

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    })

    const page = await context.newPage()

    // Navigate with a reasonable timeout. 
    // Use 'domcontentloaded' instead of 'networkidle' to avoid hanging on trackers/ads.
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })

    // Give it a few seconds to let dynamic content/scripts settle
    await page.waitForTimeout(3000)

    const html = await page.content()
    const finalUrl = page.url()

    // Use JSDOM + Readability to extract main content
    const dom = new JSDOM(html, { url: finalUrl })
    const reader = new Readability(dom.window.document)
    const article = reader.parse()

    if (!article) {
      throw new Error('Could not parse content from the page (Readability failed)')
    }

    // Convert HTML to Markdown
    const turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced'
    })

    // Remove scripts, styles and other non-content elements that might remain
    turndownService.remove(['script', 'style', 'noscript', 'iframe', 'nav', 'footer'])

    const markdown = turndownService.turndown(article.content || '')

    log.info({ url, title: article.title }, 'URL scraped successfully')

    return {
      ok: true,
      url: finalUrl,
      title: article.title || undefined,
      excerpt: article.excerpt || undefined,
      markdown: markdown
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log.error({ url, err: errorMessage }, 'Failed to scrape URL')
    return {
      ok: false,
      url,
      error: errorMessage
    }
  } finally {
    if (browser) {
      await browser.close().catch(() => {})
    }
  }
}
