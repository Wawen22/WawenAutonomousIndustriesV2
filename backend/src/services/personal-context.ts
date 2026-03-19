// ============================================================
// WAI – Personal Context Service
// Persists founder-centric profile/context in workspace/personal/neb.
// ============================================================

import { mkdir, readFile, readdir, stat, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import {
  createPersonalWorkspace,
  getPersonalOutputPath,
  getPersonalWorkspacePath,
} from './workspace.js'

export interface PersonalProfile {
  ownerSlug: string
  displayName: string
  role: string
  primaryEmail: string | null
  timezone: string
  preferredLanguage: string
  assistantStyle: string
  priorities: string[]
}

export interface PersonalDocumentSummary {
  name: string
  relativePath: string
  modifiedAt: string
  sizeBytes: number
}

export interface PersonalContext {
  profile: PersonalProfile
  workspacePath: string
  outputPath: string
  recentDocuments: PersonalDocumentSummary[]
  connectors: {
    email: boolean
    telegram: boolean
  }
}

const DEFAULT_OWNER_SLUG = 'neb'

function getProfilePath(ownerSlug: string): string {
  return join(getPersonalWorkspacePath(ownerSlug), 'profile.json')
}

function defaultProfile(ownerSlug: string = DEFAULT_OWNER_SLUG): PersonalProfile {
  return {
    ownerSlug,
    displayName: 'Neb',
    role: 'Founder of WAI',
    primaryEmail: null,
    timezone: 'Europe/Rome',
    preferredLanguage: 'it',
    assistantStyle: 'direct, concise, execution-oriented',
    priorities: [
      'Protect focus and reduce repetitive work',
      'Turn ideas into executable plans',
      'Keep WAI operational and compounding',
    ],
  }
}

function sanitizeOwnerSlug(ownerSlug: string | undefined): string {
  const normalized = ownerSlug?.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-') ?? DEFAULT_OWNER_SLUG
  return normalized || DEFAULT_OWNER_SLUG
}

export async function ensurePersonalProfile(ownerSlug: string = DEFAULT_OWNER_SLUG): Promise<PersonalProfile> {
  const slug = sanitizeOwnerSlug(ownerSlug)
  await createPersonalWorkspace(slug)
  const profilePath = getProfilePath(slug)

  if (!existsSync(profilePath)) {
    const profile = defaultProfile(slug)
    await writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`, 'utf-8')
    return profile
  }

  try {
    const raw = await readFile(profilePath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<PersonalProfile>
    return { ...defaultProfile(slug), ...parsed, ownerSlug: slug }
  } catch {
    const profile = defaultProfile(slug)
    await writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`, 'utf-8')
    return profile
  }
}

export async function updatePersonalProfile(
  updates: Partial<PersonalProfile>,
  ownerSlug: string = DEFAULT_OWNER_SLUG
): Promise<PersonalProfile> {
  const slug = sanitizeOwnerSlug(ownerSlug)
  const existing = await ensurePersonalProfile(slug)
  const profile: PersonalProfile = {
    ...existing,
    ...updates,
    ownerSlug: slug,
    priorities: Array.isArray(updates.priorities) ? updates.priorities.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : existing.priorities,
  }

  await writeFile(getProfilePath(slug), `${JSON.stringify(profile, null, 2)}\n`, 'utf-8')
  return profile
}

export async function listPersonalDocuments(ownerSlug: string = DEFAULT_OWNER_SLUG, limit = 12): Promise<PersonalDocumentSummary[]> {
  const slug = sanitizeOwnerSlug(ownerSlug)
  const outputPath = getPersonalOutputPath(slug)
  await mkdir(outputPath, { recursive: true })

  const entries = await readdir(outputPath, { withFileTypes: true })
  const docs = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const absolutePath = join(outputPath, entry.name)
        const fileStat = await stat(absolutePath)
        return {
          name: entry.name,
          relativePath: `workspace/personal/${slug}/output/${entry.name}`,
          modifiedAt: fileStat.mtime.toISOString(),
          sizeBytes: fileStat.size,
        }
      })
  )

  return docs
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    .slice(0, limit)
}

export async function getPersonalContext(ownerSlug: string = DEFAULT_OWNER_SLUG): Promise<PersonalContext> {
  const slug = sanitizeOwnerSlug(ownerSlug)
  const profile = await ensurePersonalProfile(slug)
  const recentDocuments = await listPersonalDocuments(slug)

  return {
    profile,
    workspacePath: `workspace/personal/${slug}`,
    outputPath: `workspace/personal/${slug}/output`,
    recentDocuments,
    connectors: {
      email: Boolean(process.env['RESEND_API_KEY'] && process.env['RESEND_FROM_EMAIL']),
      telegram: Boolean(process.env['TELEGRAM_BOT_TOKEN'] && process.env['TELEGRAM_FOUNDER_CHAT_ID']),
    },
  }
}

export async function formatPersonalContextForPrompt(ownerSlug: string = DEFAULT_OWNER_SLUG): Promise<string> {
  const context = await getPersonalContext(ownerSlug)
  const profile = context.profile
  const lines = [
    'Personal founder context:',
    `- display_name: ${profile.displayName}`,
    `- role: ${profile.role}`,
    `- timezone: ${profile.timezone}`,
    `- preferred_language: ${profile.preferredLanguage}`,
    `- assistant_style: ${profile.assistantStyle}`,
    `- primary_email: ${profile.primaryEmail ?? 'not_configured'}`,
    `- priorities: ${profile.priorities.join(' | ')}`,
    `- personal_workspace: ${context.workspacePath}`,
    `- personal_output: ${context.outputPath}`,
    `- connectors: email=${context.connectors.email ? 'ready' : 'missing'} telegram=${context.connectors.telegram ? 'ready' : 'missing'}`,
  ]

  if (context.recentDocuments.length > 0) {
    lines.push('- recent_personal_documents:')
    for (const doc of context.recentDocuments.slice(0, 5)) {
      lines.push(`  - ${doc.name} (${doc.relativePath})`)
    }
  } else {
    lines.push('- recent_personal_documents: none')
  }

  return lines.join('\n')
}
