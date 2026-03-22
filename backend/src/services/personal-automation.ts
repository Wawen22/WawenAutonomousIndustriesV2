import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DAILY_FOUNDER_BRIEF_AUTOMATION_CAPABILITY_ID } from '../config/capabilities.js'
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

export type PersonalAutomationRunStatus =
  | 'idle'
  | 'running'
  | 'success'
  | 'error'

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

interface PersonalAutomationPersistedState {
  dailyFounderBrief: DailyFounderBriefAutomationPersisted
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

export interface PersonalAutomationStatus {
  dailyFounderBrief: DailyFounderBriefAutomationStatus
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
    const merged: PersonalAutomationPersistedState = {
      dailyFounderBrief: {
        ...defaultPersistedState(profile.timezone).dailyFounderBrief,
        ...(parsed.dailyFounderBrief ?? {}),
      },
    }

    if (merged.dailyFounderBrief.timezone !== profile.timezone) {
      merged.dailyFounderBrief.timezone = profile.timezone
      await writePersistedState(ownerSlug, merged)
    }

    return merged
  } catch {
    const initial = defaultPersistedState(profile.timezone)
    await writePersistedState(ownerSlug, initial)
    return initial
  }
}

function toAutomationStatus(state: PersonalAutomationPersistedState): PersonalAutomationStatus {
  const item = state.dailyFounderBrief

  return {
    dailyFounderBrief: {
      id: 'daily_founder_brief',
      label: 'Daily Founder Brief',
      enabled: item.enabled,
      scheduleLocalTime: item.scheduleLocalTime,
      timezone: item.timezone,
      status: item.status,
      ...(item.lastRunAt ? { lastRunAt: item.lastRunAt } : {}),
      ...(item.lastSuccessAt ? { lastSuccessAt: item.lastSuccessAt } : {}),
      ...(item.lastError ? { lastError: item.lastError } : {}),
      ...(item.lastOutputPath ? { lastOutputPath: item.lastOutputPath } : {}),
      ...(item.enabled
        ? {
            nextPlannedRunLabel: getNextPlannedRunLabel(
              item.scheduleLocalTime,
              item.timezone,
              item.lastAttemptLocalDate,
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

export async function runFounderAutomationCycle(
  ownerSlug: string = DEFAULT_OWNER_SLUG,
): Promise<void> {
  const state = await ensurePersistedState(ownerSlug)
  const item = state.dailyFounderBrief

  if (!item.enabled || item.status === 'running') {
    return
  }

  const now = new Date()
  const currentDateKey = getDateTimeParts(now, item.timezone).dateKey
  if (item.lastAttemptLocalDate === currentDateKey) {
    return
  }

  if (!hasReachedScheduledTime(now, item.scheduleLocalTime, item.timezone)) {
    return
  }

  await runDailyFounderBriefAutomationNow('scheduled', ownerSlug)
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
