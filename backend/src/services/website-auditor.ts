// ============================================================
// WAI – Website Auditor (T133 Lead Generation Engine)
// PageSpeed API + scraper audit to build LeadFindings.
// ============================================================

import { scrapeUrl } from './scraper.js'
import { log } from './logger.js'
import type { LeadFinding } from '../types/index.js'

export interface WebsiteAuditResult {
  url: string
  isReachable: boolean
  isHttps: boolean
  mobileScore: number    // 0–100 from PageSpeed API, -1 if unavailable
  desktopScore: number
  findings: LeadFinding[]
  contactInfo: { email: string | null; phone: string | null }
  pageTitle: string | null
  metaDescription: string | null
}

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/
const PHONE_RE = /(?:\+?[\d\s\-().]{7,20})/

async function fetchPageSpeedScore(url: string, strategy: 'mobile' | 'desktop'): Promise<number> {
  try {
    const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}&fields=lighthouseResult.categories.performance`
    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return -1
    const json = (await res.json()) as Record<string, unknown>
    const score = (json as {
      lighthouseResult?: {
        categories?: {
          performance?: { score?: number }
        }
      }
    }).lighthouseResult?.categories?.performance?.score
    return score !== undefined && score !== null ? Math.round(score * 100) : -1
  } catch {
    return -1
  }
}

export async function auditWebsite(url: string): Promise<WebsiteAuditResult> {
  // 1. Reachability check
  let isReachable = false
  let finalUrl = url
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      redirect: 'follow',
    })
    isReachable = res.ok || res.status < 500
    finalUrl = res.url || url
  } catch {
    isReachable = false
  }

  const isHttps = url.startsWith('https://')

  // Defaults
  let mobileScore = -1
  let desktopScore = -1
  let pageTitle: string | null = null
  let metaDescription: string | null = null
  let contactEmail: string | null = null
  let contactPhone: string | null = null

  if (isReachable) {
    // 2. PageSpeed (parallel mobile + desktop)
    const [mobile, desktop] = await Promise.all([
      fetchPageSpeedScore(finalUrl, 'mobile'),
      fetchPageSpeedScore(finalUrl, 'desktop'),
    ])
    mobileScore = mobile
    desktopScore = desktop

    // 3. Scrape for contact info + title
    try {
      const scraped = await scrapeUrl(finalUrl)
      if (scraped.ok && scraped.markdown) {
        const emailMatch = scraped.markdown.match(EMAIL_RE)
        if (emailMatch) contactEmail = emailMatch[0]
        const phoneMatch = scraped.markdown.match(PHONE_RE)
        if (phoneMatch) contactPhone = phoneMatch[0].trim()
      }
      if (scraped.title) pageTitle = scraped.title
      if (scraped.excerpt) metaDescription = scraped.excerpt
    } catch (err) {
      log.warn({ err, url }, 'WebsiteAuditor: scrape failed, continuing')
    }
  }

  // 4. Build findings
  const findings: LeadFinding[] = []

  if (!isReachable) {
    findings.push({
      type: 'other',
      severity: 'high',
      description: 'Website not reachable — visitors cannot access the site',
    })
  } else {
    if (mobileScore >= 0 && mobileScore < 50) {
      findings.push({
        type: 'performance',
        severity: 'high',
        description: `Mobile performance score ${mobileScore}/100 — visitors likely abandoning the site on Google Search`,
      })
    } else if (mobileScore >= 50 && mobileScore < 75) {
      findings.push({
        type: 'performance',
        severity: 'medium',
        description: `Mobile performance score ${mobileScore}/100 — site is slow on mobile, impacting search rankings`,
      })
    }

    if (!isHttps) {
      findings.push({
        type: 'security',
        severity: 'high',
        description: 'Site not HTTPS — Google penalizes non-secure sites in rankings',
      })
    }

    if (!metaDescription) {
      findings.push({
        type: 'seo',
        severity: 'medium',
        description: 'Missing meta description — reduced click-through rates on Google results',
      })
    }

    if (!contactEmail && !contactPhone) {
      findings.push({
        type: 'ux',
        severity: 'low',
        description: 'No visible contact info — visitors cannot easily reach the business',
      })
    }
  }

  return {
    url: finalUrl,
    isReachable,
    isHttps,
    mobileScore,
    desktopScore,
    findings,
    contactInfo: { email: contactEmail, phone: contactPhone },
    pageTitle,
    metaDescription,
  }
}
