// ============================================================
// WAI – Company Automations
// Persists enable/config state for company-level automations.
// ============================================================

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { log } from './logger.js'

const STATE_PATH = join('workspace', 'system', 'company-automations.json')

export interface FinanceWeeklyAutomationState {
  enabled: boolean
  /** Day of week: 0=Sunday, 1=Monday, …, 6=Saturday */
  dayOfWeek: number
  /** ISO week key of the last sent report, e.g. "2026-W12" */
  lastSentWeekKey: string | null
}

export interface CompanyAutomationsState {
  financeWeeklyReport: FinanceWeeklyAutomationState
}

const DEFAULT_STATE: CompanyAutomationsState = {
  financeWeeklyReport: {
    enabled: true,
    dayOfWeek: 1, // Monday
    lastSentWeekKey: null,
  },
}

export async function getCompanyAutomations(): Promise<CompanyAutomationsState> {
  if (!existsSync(STATE_PATH)) {
    return structuredClone(DEFAULT_STATE)
  }
  try {
    const raw = await readFile(STATE_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<CompanyAutomationsState>
    const def = DEFAULT_STATE.financeWeeklyReport
    const persisted: Partial<FinanceWeeklyAutomationState> = parsed.financeWeeklyReport ?? {}
    return {
      financeWeeklyReport: {
        enabled: persisted.enabled ?? def.enabled,
        dayOfWeek: persisted.dayOfWeek ?? def.dayOfWeek,
        lastSentWeekKey: persisted.lastSentWeekKey ?? def.lastSentWeekKey,
      },
    }
  } catch {
    log.warn({ path: STATE_PATH }, 'Failed to parse company automations — using defaults')
    return structuredClone(DEFAULT_STATE)
  }
}

async function writeState(state: CompanyAutomationsState): Promise<void> {
  await mkdir(join('workspace', 'system'), { recursive: true })
  await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf-8')
}

export async function updateCompanyAutomations(patch: {
  financeWeeklyReport?: Partial<Pick<FinanceWeeklyAutomationState, 'enabled' | 'dayOfWeek'>>
}): Promise<CompanyAutomationsState> {
  const current = await getCompanyAutomations()
  if (patch.financeWeeklyReport) {
    if (typeof patch.financeWeeklyReport.enabled === 'boolean') {
      current.financeWeeklyReport.enabled = patch.financeWeeklyReport.enabled
    }
    if (typeof patch.financeWeeklyReport.dayOfWeek === 'number') {
      const d = patch.financeWeeklyReport.dayOfWeek
      current.financeWeeklyReport.dayOfWeek = Math.max(0, Math.min(6, Math.floor(d)))
    }
  }
  await writeState(current)
  log.info({ automations: current }, 'Company automations updated')
  return current
}

export async function markFinanceWeeklyReportSent(weekKey: string): Promise<void> {
  const current = await getCompanyAutomations()
  current.financeWeeklyReport.lastSentWeekKey = weekKey
  await writeState(current)
}
