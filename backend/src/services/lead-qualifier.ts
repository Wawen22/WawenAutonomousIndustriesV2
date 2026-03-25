// ============================================================
// WAI – Lead Qualifier (T133 Lead Generation Engine)
// LLM scoring (0–100) + personalized outreach draft generation.
// ============================================================

import { runAgent } from './llm.js'
import { log } from './logger.js'
import type { LeadFinding } from '../types/index.js'

export interface QualifyResult {
  score: number
  outreach_subject: string
  outreach_draft: string
}

const FALLBACK: QualifyResult = {
  score: 50,
  outreach_subject: '',
  outreach_draft: '',
}

export async function qualifyLead(
  companyName: string,
  website: string | null,
  sector: string,
  location: string,
  findings: LeadFinding[],
  contactEmail: string | null,
): Promise<QualifyResult> {
  const findingLines = findings
    .map((f) => `- [${f.severity.toUpperCase()}] ${f.type}: ${f.description}`)
    .join('\n')

  const systemPrompt = `You are WAI's lead qualification and outreach specialist.
WAI is an autonomous AI agency that builds websites, web apps, automations, and marketing systems for SMBs.

Given audit findings about a potential client, return ONLY a JSON object with no markdown, no explanation:
{ "score": <0-100>, "subject": "<email subject>", "email": "<email body under 130 words>" }

Score factors:
- 0-30: minor issues, contact info missing
- 31-60: moderate issues, some contact info
- 61-80: serious issues (slow site / no HTTPS), has contact email
- 81-100: no website at all OR multiple critical issues + has email

Email rules:
- Open with ONE specific finding (proof we analyzed their actual site)
- Offer a concrete result ("we can bring your mobile score above 90 in 2 weeks")
- CTA: a 15-minute call or "interested? reply to this email"
- Under 130 words
- Sound human, helpful, not salesy
- Do NOT mention AI, "autonomous", or "WAI"
- Write in Italian if business appears Italian (location contains Italian city names like Milano, Roma, Torino, etc.), English otherwise`

  const userPrompt = `Company: ${companyName}
Website: ${website ?? 'none'}
Sector: ${sector}
Location: ${location}
Has contact email: ${contactEmail ? 'yes' : 'no'}

Audit findings:
${findingLines || '- No specific issues found'}`

  try {
    const result = await runAgent(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      {
        agentId: 'ceo',
        captureMemory: false,
      },
    )

    const raw = result.content?.trim() ?? ''

    // Try direct JSON parse first
    try {
      const parsed = JSON.parse(raw) as { score?: number; subject?: string; email?: string }
      const score = typeof parsed.score === 'number' ? Math.max(0, Math.min(100, parsed.score)) : 50
      return {
        score,
        outreach_subject: parsed.subject ?? '',
        outreach_draft: parsed.email ?? '',
      }
    } catch {
      // Regex fallback — extract JSON object from LLM response
      const match = raw.match(/\{[\s\S]*\}/)
      if (match) {
        try {
          const parsed = JSON.parse(match[0]) as { score?: number; subject?: string; email?: string }
          const score = typeof parsed.score === 'number' ? Math.max(0, Math.min(100, parsed.score)) : 50
          return {
            score,
            outreach_subject: parsed.subject ?? '',
            outreach_draft: parsed.email ?? '',
          }
        } catch {
          // fall through
        }
      }
    }

    log.warn({ companyName, raw }, 'LeadQualifier: could not parse LLM response, using fallback')
    return FALLBACK
  } catch (err) {
    log.error({ err, companyName }, 'LeadQualifier: LLM call failed, using fallback')
    return FALLBACK
  }
}
