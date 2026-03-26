import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  DAILY_FOUNDER_BRIEF_AUTOMATION_CAPABILITY_ID,
  WEEKLY_LEAD_HARVEST_AUTOMATION_CAPABILITY_ID,
} from '../config/capabilities.js'
import { ensurePersonalProfile } from './personal-context.js'
import { executePersonalAssistantQuickAction } from './personal-assistant-actions.js'
import { log, recordCapabilityEvent, recordEvent } from './logger.js'
import { sendFounderNotification } from './notification-router.js'
import { getPersonalWorkspacePath } from './workspace.js'

const DEFAULT_OWNER_SLUG = 'neb'
const DEFAULT_DAILY_BRIEF_TIME = normalizeScheduleLocalTime(
  process.env['FOUNDER_DAILY_BRIEF_LOCAL_TIME'] ?? '08:30',
)
const DEFAULT_AUTOMATION_INTERVAL_MS = parsePositiveInt(
  process.env['FOUNDER_AUTOMATION_INTERVAL_MS'],
  60_000,
)

// Tracks the last date follow-up cycle ran (in-memory, resets on restart — intentional)
let lastFollowupRunDate: string | undefined = undefined
// Tracks the last date reply-check cycle ran
let lastReplyCheckRunDate: string | undefined = undefined

export type PersonalAutomationRunStatus =
  | 'idle'
  | 'running'
  | 'success'
  | 'error'

export type WeekDay = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'

export interface HarvestSector {
  query: string    // e.g. 'ristoranti'
  location: string // e.g. 'Milano'
  limit?: number   // default 10
}

interface DailyFounderBriefAutomationPersisted {
  enabled: boolean
  scheduleLocalTime: string
  timezone: string
  status: PersonalAutomationRunStatus
  lastRunAt?: string
  lastSuccessAt?: string
  lastError?: string
  lastOutputPath?: string
  lastAttemptLocalDate?: string
}

interface WeeklyLeadHarvestAutomationPersisted {
  enabled: boolean
  scheduleDay: WeekDay
  scheduleLocalTime: string
  timezone: string
  sectors: HarvestSector[]
  status: PersonalAutomationRunStatus
  lastRunAt?: string
  lastSuccessAt?: string
  lastError?: string
  lastLeadsFound?: number
  lastAttemptWeekKey?: string // 'YYYY-Www' format
}

interface PersonalAutomationPersistedState {
  dailyFounderBrief: DailyFounderBriefAutomationPersisted
  weeklyLeadHarvest: WeeklyLeadHarvestAutomationPersisted
}

export interface DailyFounderBriefAutomationStatus {
  id: 'daily_founder_brief'
  label: string
  enabled: boolean
  scheduleLocalTime: string
  timezone: string
  status: PersonalAutomationRunStatus
  lastRunAt?: string
  lastSuccessAt?: string
  lastError?: string
  lastOutputPath?: string
  nextPlannedRunLabel?: string
}

export interface WeeklyLeadHarvestAutomationStatus {
  id: 'weekly_lead_harvest'
  label: string
  enabled: boolean
  scheduleDay: WeekDay
  scheduleLocalTime: string
  timezone: string
  sectors: HarvestSector[]
  status: PersonalAutomationRunStatus
  lastRunAt?: string
  lastSuccessAt?: string
  lastError?: string
  lastLeadsFound?: number
  nextPlannedRunLabel?: string
}

export interface PersonalAutomationStatus {
  dailyFounderBrief: DailyFounderBriefAutomationStatus
  weeklyLeadHarvest: WeeklyLeadHarvestAutomationStatus
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function normalizeScheduleLocalTime(value: string): string {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!match) {
    return '08:30'
  }

  const hours = Math.max(0, Math.min(23, Number.parseInt(match[1] ?? '8', 10)))
  const minutes = Math.max(0, Math.min(59, Number.parseInt(match[2] ?? '30', 10)))
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function getAutomationStatePath(ownerSlug: string): string {
  return join(getPersonalWorkspacePath(ownerSlug), 'automations.json')
}

function defaultPersistedState(timezone = 'Europe/Rome'): PersonalAutomationPersistedState {
  return {
    dailyFounderBrief: {
      enabled: false,
      scheduleLocalTime: DEFAULT_DAILY_BRIEF_TIME,
      timezone,
      status: 'idle',
    },
    weeklyLeadHarvest: {
      enabled: false,
      scheduleDay: 'monday',
      scheduleLocalTime: '09:00',
      timezone,
      sectors: [],
      status: 'idle',
    },
  }
}

function getDateTimeParts(now: Date, timeZone: string): {
  dateKey: string
  hour: number
  minute: number
} {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  const parts = formatter.formatToParts(now)
  const byType = new Map(parts.map((part) => [part.type, part.value]))
  const year = byType.get('year') ?? '1970'
  const month = byType.get('month') ?? '01'
  const day = byType.get('day') ?? '01'
  const hour = Number.parseInt(byType.get('hour') ?? '0', 10)
  const minute = Number.parseInt(byType.get('minute') ?? '0', 10)

  return {
    dateKey: `${year}-${month}-${day}`,
    hour,
    minute,
  }
}

function hasReachedScheduledTime(now: Date, scheduleLocalTime: string, timeZone: string): boolean {
  const [scheduleHour = 8, scheduleMinute = 30] = scheduleLocalTime
    .split(':')
    .map((value) => Number.parseInt(value, 10))
  const current = getDateTimeParts(now, timeZone)
  return current.hour > scheduleHour || (current.hour === scheduleHour && current.minute >= scheduleMinute)
}

function getNextPlannedRunLabel(
  scheduleLocalTime: string,
  timeZone: string,
  lastAttemptLocalDate: string | undefined,
  now = new Date(),
): string {
  const current = getDateTimeParts(now, timeZone)
  const shouldUseTomorrow =
    lastAttemptLocalDate === current.dateKey || hasReachedScheduledTime(now, scheduleLocalTime, timeZone)

  return `${shouldUseTomorrow ? 'Tomorrow' : 'Today'} at ${scheduleLocalTime} (${timeZone})`
}

function extractOutputPath(reply: string): string | undefined {
  const match = reply.match(/`(workspace\/personal\/[^`]+)`/)
  return match?.[1]
}

async function writePersistedState(
  ownerSlug: string,
  state: PersonalAutomationPersistedState,
): Promise<void> {
  const workspacePath = getPersonalWorkspacePath(ownerSlug)
  await mkdir(workspacePath, { recursive: true })
  await writeFile(
    getAutomationStatePath(ownerSlug),
    `${JSON.stringify(state, null, 2)}\n`,
    'utf-8',
  )
}

async function ensurePersistedState(ownerSlug: string = DEFAULT_OWNER_SLUG): Promise<PersonalAutomationPersistedState> {
  const profile = await ensurePersonalProfile(ownerSlug)
  const filePath = getAutomationStatePath(ownerSlug)

  if (!existsSync(filePath)) {
    const initial = defaultPersistedState(profile.timezone)
    await writePersistedState(ownerSlug, initial)
    return initial
  }

  try {
    const raw = await readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<PersonalAutomationPersistedState>
    const defaults = defaultPersistedState(profile.timezone)
    const merged: PersonalAutomationPersistedState = {
      dailyFounderBrief: {
        ...defaults.dailyFounderBrief,
        ...(parsed.dailyFounderBrief ?? {}),
      },
      weeklyLeadHarvest: {
        ...defaults.weeklyLeadHarvest,
        ...(parsed.weeklyLeadHarvest ?? {}),
      },
    }

    if (
      merged.dailyFounderBrief.timezone !== profile.timezone ||
      merged.weeklyLeadHarvest.timezone !== profile.timezone
    ) {
      merged.dailyFounderBrief.timezone = profile.timezone
      merged.weeklyLeadHarvest.timezone = profile.timezone
      await writePersistedState(ownerSlug, merged)
    }

    return merged
  } catch {
    const initial = defaultPersistedState(profile.timezone)
    await writePersistedState(ownerSlug, initial)
    return initial
  }
}

const WEEK_DAYS: WeekDay[] = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
]

function getISOWeekKey(date: Date, timeZone: string): string {
  // Returns 'YYYY-Www' using the local date's ISO week
  const parts = getDateTimeParts(date, timeZone)
  const localDate = new Date(`${parts.dateKey}T12:00:00Z`)
  const day = localDate.getUTCDay() || 7 // make Sunday = 7
  const thursday = new Date(localDate)
  thursday.setUTCDate(localDate.getUTCDate() - day + 4)
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1))
  const weekNum = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${thursday.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

function hasReachedWeeklySchedule(
  now: Date,
  scheduleDay: WeekDay,
  scheduleLocalTime: string,
  timeZone: string,
): boolean {
  const current = getDateTimeParts(now, timeZone)
  const localDate = new Date(`${current.dateKey}T12:00:00Z`)
  const dayIndex = localDate.getUTCDay() // 0=Sun, 1=Mon...
  const targetDayIndex = WEEK_DAYS.indexOf(scheduleDay)
  if (dayIndex !== targetDayIndex) return false
  return hasReachedScheduledTime(now, scheduleLocalTime, timeZone)
}

function getNextWeeklyRunLabel(
  scheduleDay: WeekDay,
  scheduleLocalTime: string,
  timeZone: string,
  lastAttemptWeekKey: string | undefined,
  now = new Date(),
): string {
  const currentWeekKey = getISOWeekKey(now, timeZone)
  const alreadyRanThisWeek = lastAttemptWeekKey === currentWeekKey
  const dayLabel = scheduleDay.charAt(0).toUpperCase() + scheduleDay.slice(1)

  if (alreadyRanThisWeek) {
    return `Next ${dayLabel} at ${scheduleLocalTime} (${timeZone})`
  }

  const current = getDateTimeParts(now, timeZone)
  const localDate = new Date(`${current.dateKey}T12:00:00Z`)
  const dayIndex = localDate.getUTCDay()
  const targetDayIndex = WEEK_DAYS.indexOf(scheduleDay)
  const isPastThisWeek =
    dayIndex > targetDayIndex ||
    (dayIndex === targetDayIndex && hasReachedScheduledTime(now, scheduleLocalTime, timeZone))

  return isPastThisWeek
    ? `Next ${dayLabel} at ${scheduleLocalTime} (${timeZone})`
    : `This ${dayLabel} at ${scheduleLocalTime} (${timeZone})`
}

function toAutomationStatus(state: PersonalAutomationPersistedState): PersonalAutomationStatus {
  const brief = state.dailyFounderBrief
  const harvest = state.weeklyLeadHarvest

  return {
    dailyFounderBrief: {
      id: 'daily_founder_brief',
      label: 'Daily Founder Brief',
      enabled: brief.enabled,
      scheduleLocalTime: brief.scheduleLocalTime,
      timezone: brief.timezone,
      status: brief.status,
      ...(brief.lastRunAt ? { lastRunAt: brief.lastRunAt } : {}),
      ...(brief.lastSuccessAt ? { lastSuccessAt: brief.lastSuccessAt } : {}),
      ...(brief.lastError ? { lastError: brief.lastError } : {}),
      ...(brief.lastOutputPath ? { lastOutputPath: brief.lastOutputPath } : {}),
      ...(brief.enabled
        ? {
            nextPlannedRunLabel: getNextPlannedRunLabel(
              brief.scheduleLocalTime,
              brief.timezone,
              brief.lastAttemptLocalDate,
            ),
          }
        : {}),
    },
    weeklyLeadHarvest: {
      id: 'weekly_lead_harvest',
      label: 'Weekly Lead Harvest',
      enabled: harvest.enabled,
      scheduleDay: harvest.scheduleDay,
      scheduleLocalTime: harvest.scheduleLocalTime,
      timezone: harvest.timezone,
      sectors: harvest.sectors,
      status: harvest.status,
      ...(harvest.lastRunAt ? { lastRunAt: harvest.lastRunAt } : {}),
      ...(harvest.lastSuccessAt ? { lastSuccessAt: harvest.lastSuccessAt } : {}),
      ...(harvest.lastError ? { lastError: harvest.lastError } : {}),
      ...(harvest.lastLeadsFound !== undefined ? { lastLeadsFound: harvest.lastLeadsFound } : {}),
      ...(harvest.enabled
        ? {
            nextPlannedRunLabel: getNextWeeklyRunLabel(
              harvest.scheduleDay,
              harvest.scheduleLocalTime,
              harvest.timezone,
              harvest.lastAttemptWeekKey,
            ),
          }
        : {}),
    },
  }
}

export async function getPersonalAutomationStatus(
  ownerSlug: string = DEFAULT_OWNER_SLUG,
): Promise<PersonalAutomationStatus> {
  const state = await ensurePersistedState(ownerSlug)
  return toAutomationStatus(state)
}

export async function updateDailyFounderBriefAutomation(
  input: {
    enabled?: boolean
    scheduleLocalTime?: string
  },
  ownerSlug: string = DEFAULT_OWNER_SLUG,
  source = 'dashboard',
): Promise<PersonalAutomationStatus> {
  const state = await ensurePersistedState(ownerSlug)
  const previousEnabled = state.dailyFounderBrief.enabled
  const previousSchedule = state.dailyFounderBrief.scheduleLocalTime

  if (typeof input.enabled === 'boolean') {
    state.dailyFounderBrief.enabled = input.enabled
  }

  if (typeof input.scheduleLocalTime === 'string' && input.scheduleLocalTime.trim()) {
    state.dailyFounderBrief.scheduleLocalTime = normalizeScheduleLocalTime(input.scheduleLocalTime)
  }

  await writePersistedState(ownerSlug, state)

  if (previousEnabled !== state.dailyFounderBrief.enabled) {
    await recordCapabilityEvent({
      capability_id: DAILY_FOUNDER_BRIEF_AUTOMATION_CAPABILITY_ID,
      event_type: state.dailyFounderBrief.enabled ? 'enabled' : 'disabled',
      actor_type: 'dashboard',
      actor_id: ownerSlug,
      source,
      summary: state.dailyFounderBrief.enabled
        ? 'Daily Founder Brief automation enabled.'
        : 'Daily Founder Brief automation disabled.',
      payload: {
        enabled: state.dailyFounderBrief.enabled,
        schedule_local_time: state.dailyFounderBrief.scheduleLocalTime,
        timezone: state.dailyFounderBrief.timezone,
      },
    })
  }

  if (previousSchedule !== state.dailyFounderBrief.scheduleLocalTime) {
    await recordCapabilityEvent({
      capability_id: DAILY_FOUNDER_BRIEF_AUTOMATION_CAPABILITY_ID,
      event_type: 'configured',
      actor_type: 'dashboard',
      actor_id: ownerSlug,
      source,
      summary: 'Daily Founder Brief automation schedule updated.',
      payload: {
        previous_schedule_local_time: previousSchedule,
        schedule_local_time: state.dailyFounderBrief.scheduleLocalTime,
        timezone: state.dailyFounderBrief.timezone,
      },
    })
  }

  return toAutomationStatus(state)
}

export async function runDailyFounderBriefAutomationNow(
  source: 'manual' | 'scheduled',
  ownerSlug: string = DEFAULT_OWNER_SLUG,
): Promise<PersonalAutomationStatus> {
  const state = await ensurePersistedState(ownerSlug)
  const timezone = state.dailyFounderBrief.timezone
  const now = new Date()
  const currentDateKey = getDateTimeParts(now, timezone).dateKey

  if (state.dailyFounderBrief.status === 'running') {
    return toAutomationStatus(state)
  }

  state.dailyFounderBrief.status = 'running'
  delete state.dailyFounderBrief.lastError
  await writePersistedState(ownerSlug, state)
  await recordCapabilityEvent({
    capability_id: DAILY_FOUNDER_BRIEF_AUTOMATION_CAPABILITY_ID,
    event_type: 'used',
    actor_type: source === 'manual' ? 'dashboard' : 'runtime',
    actor_id: ownerSlug,
    source: `personal-automation:${source}`,
    summary: `Daily Founder Brief automation started (${source}).`,
    payload: {
      trigger: source,
      schedule_local_time: state.dailyFounderBrief.scheduleLocalTime,
      timezone: state.dailyFounderBrief.timezone,
    },
  })

  try {
    const result = await executePersonalAssistantQuickAction(
      'daily_founder_brief',
      `automation:personal:${source}:daily_founder_brief`,
    )
    const outputPath = extractOutputPath(result.reply)
    const finishedAt = new Date().toISOString()

    state.dailyFounderBrief.status = 'success'
    state.dailyFounderBrief.lastRunAt = finishedAt
    state.dailyFounderBrief.lastSuccessAt = finishedAt
    state.dailyFounderBrief.lastAttemptLocalDate = currentDateKey
    delete state.dailyFounderBrief.lastError
    if (outputPath) {
      state.dailyFounderBrief.lastOutputPath = outputPath
    } else {
      delete state.dailyFounderBrief.lastOutputPath
    }
    await writePersistedState(ownerSlug, state)
    await recordCapabilityEvent({
      capability_id: DAILY_FOUNDER_BRIEF_AUTOMATION_CAPABILITY_ID,
      event_type: 'succeeded',
      actor_type: source === 'manual' ? 'dashboard' : 'runtime',
      actor_id: ownerSlug,
      source: `personal-automation:${source}`,
      summary: `Daily Founder Brief automation completed (${source}).`,
      payload: {
        trigger: source,
        ...(outputPath ? { output_path: outputPath } : {}),
      },
    })

    await recordEvent('founder_command', {
      agentId: 'ceo',
      payload: {
        command: 'automation_daily_founder_brief',
        source: 'automation',
        trigger: source,
        status: 'success',
        ...(outputPath ? { output_path: outputPath } : {}),
      },
    })

    const briefText = result.reply.trim()
    if (briefText) {
      const MAX_CHARS = 3_800
      const message =
        briefText.length > MAX_CHARS
          ? `${briefText.slice(0, MAX_CHARS)}\n\n…[brief completo nel workspace]`
          : briefText
      await sendFounderNotification(message).catch((err: unknown) => {
        log.warn({ err }, 'Failed to send daily brief notification — brief saved to workspace')
      })
    }

    return toAutomationStatus(state)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const finishedAt = new Date().toISOString()

    state.dailyFounderBrief.status = 'error'
    state.dailyFounderBrief.lastRunAt = finishedAt
    state.dailyFounderBrief.lastAttemptLocalDate = currentDateKey
    state.dailyFounderBrief.lastError = message
    await writePersistedState(ownerSlug, state)
    await recordCapabilityEvent({
      capability_id: DAILY_FOUNDER_BRIEF_AUTOMATION_CAPABILITY_ID,
      event_type: 'failed',
      actor_type: source === 'manual' ? 'dashboard' : 'runtime',
      actor_id: ownerSlug,
      source: `personal-automation:${source}`,
      summary: `Daily Founder Brief automation failed (${source}).`,
      payload: {
        trigger: source,
        error: message,
      },
    })

    await recordEvent('founder_command', {
      agentId: 'ceo',
      severity: 'warning',
      payload: {
        command: 'automation_daily_founder_brief',
        source: 'automation',
        trigger: source,
        status: 'error',
        error: message,
      },
    })

    throw err
  }
}

export async function updateWeeklyLeadHarvestAutomation(
  input: {
    enabled?: boolean
    scheduleDay?: WeekDay
    scheduleLocalTime?: string
    sectors?: HarvestSector[]
  },
  ownerSlug: string = DEFAULT_OWNER_SLUG,
  source = 'dashboard',
): Promise<PersonalAutomationStatus> {
  const state = await ensurePersistedState(ownerSlug)
  const prev = { ...state.weeklyLeadHarvest }

  if (typeof input.enabled === 'boolean') state.weeklyLeadHarvest.enabled = input.enabled
  if (typeof input.scheduleDay === 'string') state.weeklyLeadHarvest.scheduleDay = input.scheduleDay
  if (typeof input.scheduleLocalTime === 'string' && input.scheduleLocalTime.trim()) {
    state.weeklyLeadHarvest.scheduleLocalTime = normalizeScheduleLocalTime(input.scheduleLocalTime)
  }
  if (Array.isArray(input.sectors)) state.weeklyLeadHarvest.sectors = input.sectors

  await writePersistedState(ownerSlug, state)

  const changed = JSON.stringify(prev) !== JSON.stringify(state.weeklyLeadHarvest)
  if (changed) {
    await recordCapabilityEvent({
      capability_id: WEEKLY_LEAD_HARVEST_AUTOMATION_CAPABILITY_ID,
      event_type: state.weeklyLeadHarvest.enabled ? 'enabled' : 'configured',
      actor_type: 'dashboard',
      actor_id: ownerSlug,
      source,
      summary: `Weekly Lead Harvest automation updated (${source}).`,
      payload: {
        enabled: state.weeklyLeadHarvest.enabled,
        schedule_day: state.weeklyLeadHarvest.scheduleDay,
        schedule_local_time: state.weeklyLeadHarvest.scheduleLocalTime,
        sectors_count: state.weeklyLeadHarvest.sectors.length,
      },
    })
  }

  return toAutomationStatus(state)
}

export async function runWeeklyLeadHarvestNow(
  source: 'manual' | 'scheduled',
  ownerSlug: string = DEFAULT_OWNER_SLUG,
): Promise<PersonalAutomationStatus> {
  const state = await ensurePersistedState(ownerSlug)
  const item = state.weeklyLeadHarvest
  const now = new Date()
  const currentWeekKey = getISOWeekKey(now, item.timezone)

  if (item.status === 'running') return toAutomationStatus(state)

  item.status = 'running'
  delete item.lastError
  await writePersistedState(ownerSlug, state)
  await recordCapabilityEvent({
    capability_id: WEEKLY_LEAD_HARVEST_AUTOMATION_CAPABILITY_ID,
    event_type: 'used',
    actor_type: source === 'manual' ? 'dashboard' : 'runtime',
    actor_id: ownerSlug,
    source: `personal-automation:${source}`,
    summary: `Weekly Lead Harvest started (${source}).`,
    payload: { trigger: source, sectors: item.sectors },
  })

  try {
    const { harvestLeads } = await import('./lead-harvester.js')
    const allSaved: Awaited<ReturnType<typeof harvestLeads>> = []

    for (const sector of item.sectors) {
      const leads = await harvestLeads({
        query: sector.query,
        location: sector.location,
        limit: sector.limit ?? 10,
        sector: sector.query,
      })
      allSaved.push(...leads)
    }

    const finishedAt = new Date().toISOString()
    item.status = 'success'
    item.lastRunAt = finishedAt
    item.lastSuccessAt = finishedAt
    item.lastAttemptWeekKey = currentWeekKey
    item.lastLeadsFound = allSaved.length
    delete item.lastError
    await writePersistedState(ownerSlug, state)

    await recordCapabilityEvent({
      capability_id: WEEKLY_LEAD_HARVEST_AUTOMATION_CAPABILITY_ID,
      event_type: 'succeeded',
      actor_type: source === 'manual' ? 'dashboard' : 'runtime',
      actor_id: ownerSlug,
      source: `personal-automation:${source}`,
      summary: `Weekly Lead Harvest completed: ${allSaved.length} leads found (${source}).`,
      payload: { trigger: source, leads_found: allSaved.length },
    })
    await recordEvent('founder_command', {
      agentId: 'ceo',
      payload: { command: 'automation_weekly_lead_harvest', source: 'automation', trigger: source, status: 'success', leads_found: allSaved.length },
    })

    // Telegram digest
    if (allSaved.length > 0) {
      const highScore = allSaved.filter((l) => l.score >= 80)
      const midScore = allSaved.filter((l) => l.score >= 60 && l.score < 80)
      const topNames = highScore.slice(0, 3).map((l) => l.company_name).join(', ')
      const lines = [
        `🎯 Weekly Lead Harvest complete`,
        `Found ${allSaved.length} new lead${allSaved.length !== 1 ? 's' : ''} across ${item.sectors.length} sector${item.sectors.length !== 1 ? 's' : ''}`,
        highScore.length > 0 ? `🔴 High-score (80+): ${highScore.length}${topNames ? ` — ${topNames}` : ''}` : null,
        midScore.length > 0 ? `🟡 Mid-score (60–79): ${midScore.length}` : null,
        `Review & approve → Leads dashboard`,
      ].filter(Boolean).join('\n')
      await sendFounderNotification(lines).catch((err: unknown) => {
        log.warn({ err }, 'WeeklyLeadHarvest: failed to send Telegram digest')
      })
    } else {
      await sendFounderNotification(
        `🎯 Weekly Lead Harvest: no new leads found this week (${item.sectors.length} sector${item.sectors.length !== 1 ? 's' : ''} searched).`
      ).catch(() => {})
    }

    return toAutomationStatus(state)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const finishedAt = new Date().toISOString()
    item.status = 'error'
    item.lastRunAt = finishedAt
    item.lastAttemptWeekKey = currentWeekKey
    item.lastError = message
    await writePersistedState(ownerSlug, state)
    await recordCapabilityEvent({
      capability_id: WEEKLY_LEAD_HARVEST_AUTOMATION_CAPABILITY_ID,
      event_type: 'failed',
      actor_type: source === 'manual' ? 'dashboard' : 'runtime',
      actor_id: ownerSlug,
      source: `personal-automation:${source}`,
      summary: `Weekly Lead Harvest failed (${source}).`,
      payload: { trigger: source, error: message },
    })
    throw err
  }
}

// ---------------------------------------------------------------------------
// T137 — Gmail Reply Check Cycle
// Polls Gmail threads for sent leads; marks leads as 'replied' automatically.
// ---------------------------------------------------------------------------

export async function runReplyCheckCycle(
  ownerSlug: string = DEFAULT_OWNER_SLUG,
): Promise<number> {
  const { getLeads, updateLeadStatus } = await import('./leads.js')
  const { callGoogleWorkspaceMcpTool } = await import('./google-workspace-mcp.js')

  // Only check leads that were sent and have a thread_id
  const sentLeads = await getLeads({ status: 'sent' })
  const trackedLeads = sentLeads.filter((l) => l.thread_id)

  if (trackedLeads.length === 0) return 0

  let repliedCount = 0

  for (const lead of trackedLeads) {
    try {
      const result = await callGoogleWorkspaceMcpTool(
        'gmail_read_thread',
        { thread_id: lead.thread_id! },
        ownerSlug,
      )

      // Check for replies from external senders (not from the WAI outreach address)
      const sc = result.structuredContent
      const messages: unknown[] =
        sc && typeof sc === 'object' && 'messages' in sc && Array.isArray((sc as Record<string, unknown>)['messages'])
          ? ((sc as Record<string, unknown[]>)['messages'] ?? [])
          : []

      const outreachEmail = lead.contact_email?.toLowerCase()
      const hasReply = messages.length > 1 && messages.some((msg) => {
        if (!msg || typeof msg !== 'object') return false
        const from = ((msg as Record<string, unknown>)['from'] ?? '') as string
        // Reply present if any message is from the lead's contact email
        return outreachEmail ? from.toLowerCase().includes(outreachEmail) : false
      })

      if (hasReply) {
        await updateLeadStatus(lead.id, 'replied', { replied_at: new Date().toISOString() })
        log.info({ leadId: lead.id, company: lead.company_name }, 'ReplyCheckCycle: lead marked as replied')
        repliedCount++
      }
    } catch (err) {
      // Non-fatal — continue with next lead
      log.warn({ err, leadId: lead.id }, 'ReplyCheckCycle: thread check failed (non-fatal)')
    }
  }

  return repliedCount
}

export async function runFounderAutomationCycle(
  ownerSlug: string = DEFAULT_OWNER_SLUG,
): Promise<void> {
  const state = await ensurePersistedState(ownerSlug)
  const now = new Date()

  // Daily founder brief
  const brief = state.dailyFounderBrief
  if (brief.enabled && brief.status !== 'running') {
    const currentDateKey = getDateTimeParts(now, brief.timezone).dateKey
    if (
      brief.lastAttemptLocalDate !== currentDateKey &&
      hasReachedScheduledTime(now, brief.scheduleLocalTime, brief.timezone)
    ) {
      await runDailyFounderBriefAutomationNow('scheduled', ownerSlug)
    }
  }

  // Weekly lead harvest
  const harvest = state.weeklyLeadHarvest
  if (harvest.enabled && harvest.status !== 'running' && harvest.sectors.length > 0) {
    const currentWeekKey = getISOWeekKey(now, harvest.timezone)
    if (
      harvest.lastAttemptWeekKey !== currentWeekKey &&
      hasReachedWeeklySchedule(now, harvest.scheduleDay, harvest.scheduleLocalTime, harvest.timezone)
    ) {
      await runWeeklyLeadHarvestNow('scheduled', ownerSlug).catch((err: unknown) => {
        log.error({ err, ownerSlug }, 'Weekly lead harvest scheduled run failed')
      })
    }
  }

  // Daily Gmail reply check (runs once per day at 11:00 local time)
  const replyCheckHour = parseInt(process.env['REPLY_CHECK_HOUR'] ?? '11', 10)
  const replyCheckTimezone = state.dailyFounderBrief.timezone
  const replyCheckDateParts = getDateTimeParts(now, replyCheckTimezone)
  if (
    replyCheckDateParts.hour === replyCheckHour &&
    replyCheckDateParts.minute === 0 &&
    lastReplyCheckRunDate !== replyCheckDateParts.dateKey
  ) {
    lastReplyCheckRunDate = replyCheckDateParts.dateKey
    void (async () => {
      try {
        const replied = await runReplyCheckCycle()
        if (replied > 0) {
          await sendFounderNotification(
            `📨 Reply tracking: ${replied} lead${replied !== 1 ? 's' : ''} marcato${replied !== 1 ? 'i' : ''} come "replied" automaticamente`,
          ).catch(() => {})
        }
      } catch (err) {
        log.error({ err, ownerSlug }, 'runFounderAutomationCycle: reply check failed')
      }
    })()
  }

  // Daily lead follow-up cycle (runs once per day at 10:00 local time)
  const followupHour = parseInt(process.env['FOLLOWUP_HOUR'] ?? '10', 10)
  const followupTimezone = state.dailyFounderBrief.timezone
  const followupDateParts = getDateTimeParts(now, followupTimezone)
  if (
    followupDateParts.hour === followupHour &&
    followupDateParts.minute === 0 &&
    lastFollowupRunDate !== followupDateParts.dateKey
  ) {
    lastFollowupRunDate = followupDateParts.dateKey
    void (async () => {
      try {
        const { runFollowUpCycle } = await import('./lead-followup.js')
        const result = await runFollowUpCycle()
        if (result.sent > 0 || result.draftOnly > 0) {
          await sendFounderNotification(
            `📬 Follow-up cycle: ${result.sent} sent, ${result.draftOnly} draft, ${result.failed} failed (${result.processed} leads checked)`,
          ).catch(() => {})
        }
      } catch (err) {
        log.error({ err, ownerSlug }, 'runFounderAutomationCycle: follow-up cycle failed')
      }
    })()
  }
}

export function startFounderAutomationRuntime(
  ownerSlug: string = DEFAULT_OWNER_SLUG,
  intervalMs = DEFAULT_AUTOMATION_INTERVAL_MS,
): NodeJS.Timeout {
  log.info({ ownerSlug, intervalMs }, 'Starting founder automation runtime')

  void runFounderAutomationCycle(ownerSlug).catch((err: unknown) => {
    log.error({ err, ownerSlug }, 'Founder automation initial cycle failed')
  })

  return setInterval(() => {
    void runFounderAutomationCycle(ownerSlug).catch((err: unknown) => {
      log.error({ err, ownerSlug }, 'Founder automation cycle failed')
    })
  }, intervalMs)
}
