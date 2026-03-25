// ============================================================
// WAI – Lead Harvester (T133 Lead Generation Engine)
// Discovers businesses, audits their websites, qualifies leads,
// deduplicates, and saves to DB.
// ============================================================

import { log } from './logger.js'
import { scrapeUrl } from './scraper.js'
import { auditWebsite } from './website-auditor.js'
import { qualifyLead } from './lead-qualifier.js'
import {
  getLeads,
  saveLead,
  startHarvestRun,
  completeHarvestRun,
  failHarvestRun,
} from './leads.js'
import type { Lead, LeadFinding } from '../types/index.js'

export interface HarvestConfig {
  query: string      // e.g. 'ristoranti', 'dentisti', 'parrucchieri'
  location: string   // e.g. 'Milano', 'Roma, Italy'
  limit?: number     // default: 10, max: 20
  sector?: string    // for tagging, defaults to query
  existingRunId?: string  // if pre-created by the caller (e.g. API route returning runId early)
}

interface BusinessCandidate {
  name: string
  website: string | null
  phone: string | null
  address: string | null
}

// ---------------------------------------------------------------------------
// Discovery: Google Places API (if key is set) or Google Search scraping
// ---------------------------------------------------------------------------

async function discoverViaPlacesApi(
  query: string,
  location: string,
  limit: number,
): Promise<BusinessCandidate[]> {
  const apiKey = process.env['GOOGLE_PLACES_API_KEY']
  if (!apiKey) return []

  try {
    const textQuery = `${query} ${location}`
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(textQuery)}&key=${apiKey}`
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return []

    const json = (await res.json()) as {
      results?: Array<{
        name?: string
        formatted_address?: string
        formatted_phone_number?: string
        website?: string
      }>
    }

    const results = json.results?.slice(0, limit) ?? []
    const candidates: BusinessCandidate[] = []

    for (const r of results) {
      candidates.push({
        name: r.name ?? 'Unknown',
        website: r.website ?? null,
        phone: r.formatted_phone_number ?? null,
        address: r.formatted_address ?? null,
      })
    }
    return candidates
  } catch (err) {
    log.warn({ err }, 'LeadHarvester: Google Places API failed, falling back to scrape')
    return []
  }
}

async function discoverViaScrape(
  query: string,
  location: string,
  limit: number,
): Promise<BusinessCandidate[]> {
  try {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(`${query} ${location} sito web`)}&num=${limit * 2}`
    const scraped = await scrapeUrl(searchUrl)
    if (!scraped.ok || !scraped.markdown) return []

    // Extract URLs from markdown — look for http(s) links
    const urlMatches = scraped.markdown.match(/https?:\/\/[^\s\)\"\']+/g) ?? []
    const businessUrls = urlMatches
      .filter(
        (u) =>
          !u.includes('google.') &&
          !u.includes('gstatic.') &&
          !u.includes('youtube.') &&
          !u.includes('maps.') &&
          !u.includes('facebook.') &&
          !u.includes('instagram.') &&
          !u.includes('yelp.') &&
          !u.includes('tripadvisor.'),
      )
      .slice(0, limit)

    return businessUrls.map((url) => ({
      name: new URL(url).hostname.replace(/^www\./, ''),
      website: url,
      phone: null,
      address: location,
    }))
  } catch (err) {
    log.warn({ err }, 'LeadHarvester: scrape discovery failed')
    return []
  }
}

// ---------------------------------------------------------------------------
// Deduplication helpers
// ---------------------------------------------------------------------------

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return url.toLowerCase()
  }
}

async function isDuplicate(candidate: BusinessCandidate, location: string): Promise<boolean> {
  const existing = await getLeads({ limit: 500 })

  if (candidate.website) {
    const domain = extractDomain(candidate.website)
    if (existing.some((l) => l.website && extractDomain(l.website) === domain)) {
      return true
    }
  }

  // Name + location match
  const nameLower = candidate.name.toLowerCase()
  const locLower = location.toLowerCase()
  if (
    existing.some(
      (l) =>
        l.company_name.toLowerCase() === nameLower &&
        (l.location?.toLowerCase() ?? '') === locLower,
    )
  ) {
    return true
  }

  return false
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export async function harvestLeads(config: HarvestConfig): Promise<Lead[]> {
  const limit = Math.min(config.limit ?? 10, 20)
  const sector = config.sector ?? config.query

  // Use existing run ID if caller pre-created it (for non-blocking API routes)
  let runId = config.existingRunId
  if (!runId) {
    const run = await startHarvestRun('website_audit', config.query, config.location)
    runId = run.id
  }
  log.info({ runId, query: config.query, location: config.location, limit }, 'LeadHarvester: started')

  try {
    // 1. Discover businesses
    let candidates: BusinessCandidate[] = []

    if (process.env['GOOGLE_PLACES_API_KEY']) {
      candidates = await discoverViaPlacesApi(config.query, config.location, limit)
    }

    if (candidates.length === 0) {
      candidates = await discoverViaScrape(config.query, config.location, limit)
    }

    candidates = candidates.slice(0, limit)
    log.info({ count: candidates.length }, 'LeadHarvester: discovered candidates')

    // 2. Audit each site in chunks of 3 with 500ms between chunks
    const chunkSize = 3
    const savedLeads: Lead[] = []

    for (let i = 0; i < candidates.length; i += chunkSize) {
      const chunk = candidates.slice(i, i + chunkSize)

      const chunkResults = await Promise.all(
        chunk.map(async (candidate) => {
          try {
            // Dedup check
            if (await isDuplicate(candidate, config.location)) {
              log.info({ name: candidate.name }, 'LeadHarvester: skipping duplicate')
              return null
            }

            let findings: LeadFinding[]
            let contactEmail: string | null = null
            let contactPhone: string | null = null

            if (!candidate.website) {
              // No website — immediate findings
              findings = [
                {
                  type: 'missing_website',
                  severity: 'high',
                  description: 'No website found — completely invisible online',
                },
              ]
            } else {
              const audit = await auditWebsite(candidate.website)
              findings = audit.findings
              contactEmail = audit.contactInfo.email
              contactPhone = audit.contactInfo.phone ?? candidate.phone
            }

            // 3. Qualify
            const qualification = await qualifyLead(
              candidate.name,
              candidate.website,
              sector,
              config.location,
              findings,
              contactEmail,
            )

            // Apply -10 penalty if no contact email found
            const score = contactEmail
              ? qualification.score
              : Math.max(0, qualification.score - 10)

            // 4. Save
            const saved = await saveLead({
              source: 'website_audit',
              status: 'qualified',
              company_name: candidate.name,
              website: candidate.website,
              phone: candidate.phone ?? contactPhone,
              location: config.location,
              sector,
              score,
              findings,
              contact_email: contactEmail,
              outreach_subject: qualification.outreach_subject,
              outreach_draft: qualification.outreach_draft,
            })

            return saved
          } catch (err) {
            log.error({ err, name: candidate.name }, 'LeadHarvester: failed to process candidate')
            return null
          }
        }),
      )

      for (const r of chunkResults) {
        if (r) savedLeads.push(r)
      }

      // Rate limit: 500ms between chunks (except last)
      if (i + chunkSize < candidates.length) {
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }

    await completeHarvestRun(runId, savedLeads.length)
    log.info({ runId, saved: savedLeads.length }, 'LeadHarvester: completed')
    return savedLeads
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await failHarvestRun(runId, msg)
    log.error({ err, runId }, 'LeadHarvester: failed')
    throw err
  }
}
