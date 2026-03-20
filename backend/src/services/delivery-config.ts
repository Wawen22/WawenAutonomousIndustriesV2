import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getProjectById, updateProjectMetadata } from './supabase.js'
import { getWorkspaceRoot } from './workspace.js'
import type { DeliveryConfig, DeliveryDeployProvider, Project } from '../types/index.js'

export type DeliveryConfigPatch = Partial<DeliveryConfig>

const DELIVERY_CONFIG_DIR = join(getWorkspaceRoot(), 'system')
const DELIVERY_CONFIG_PATH = join(DELIVERY_CONFIG_DIR, 'delivery-config.json')

export const DELIVERY_CONFIG_DEFAULTS: DeliveryConfig = {
  gitPush: true,
  autoDeploy: true,
  deployProvider: 'vercel',
  requireFounderApproval: false,
  clientEmailOnDelivery: false,
  autoInvoice: false,
}

function isDeployProvider(value: unknown): value is DeliveryDeployProvider {
  return value === 'vercel' || value === 'netlify' || value === null
}

function normalizePatch(input: unknown): DeliveryConfigPatch {
  if (typeof input !== 'object' || input === null) {
    return {}
  }

  const record = input as Record<string, unknown>
  const patch: DeliveryConfigPatch = {}

  if (typeof record['gitPush'] === 'boolean') patch.gitPush = record['gitPush']
  if (typeof record['autoDeploy'] === 'boolean') patch.autoDeploy = record['autoDeploy']
  if (isDeployProvider(record['deployProvider'])) patch.deployProvider = record['deployProvider']
  if (typeof record['requireFounderApproval'] === 'boolean') {
    patch.requireFounderApproval = record['requireFounderApproval']
  }
  if (typeof record['clientEmailOnDelivery'] === 'boolean') {
    patch.clientEmailOnDelivery = record['clientEmailOnDelivery']
  }
  if (typeof record['autoInvoice'] === 'boolean') patch.autoInvoice = record['autoInvoice']

  return patch
}

export function sanitizeDeliveryConfigPatch(input: unknown): DeliveryConfigPatch {
  return normalizePatch(input)
}

function mergeDeliveryConfig(base: DeliveryConfig, patch: DeliveryConfigPatch): DeliveryConfig {
  return {
    ...base,
    ...patch,
  }
}

async function ensureDeliveryConfigDirectory(): Promise<void> {
  await mkdir(DELIVERY_CONFIG_DIR, { recursive: true })
}

async function writeDefaultsFile(config: DeliveryConfig): Promise<void> {
  await ensureDeliveryConfigDirectory()
  await writeFile(DELIVERY_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf-8')
}

function extractProjectDeliveryPatch(project: Project): DeliveryConfigPatch {
  return normalizePatch(project.metadata['delivery_config'])
}

export async function getGlobalDeliveryDefaults(): Promise<DeliveryConfig> {
  await ensureDeliveryConfigDirectory()

  if (!existsSync(DELIVERY_CONFIG_PATH)) {
    await writeDefaultsFile(DELIVERY_CONFIG_DEFAULTS)
    return DELIVERY_CONFIG_DEFAULTS
  }

  try {
    const raw = await readFile(DELIVERY_CONFIG_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    const merged = mergeDeliveryConfig(DELIVERY_CONFIG_DEFAULTS, normalizePatch(parsed))
    await writeDefaultsFile(merged)
    return merged
  } catch {
    await writeDefaultsFile(DELIVERY_CONFIG_DEFAULTS)
    return DELIVERY_CONFIG_DEFAULTS
  }
}

export async function getDeliveryConfig(projectId: string): Promise<DeliveryConfig> {
  const project = await getProjectById(projectId)
  if (!project) {
    throw new Error(`Project ${projectId} not found`)
  }

  const defaults = await getGlobalDeliveryDefaults()
  return mergeDeliveryConfig(defaults, extractProjectDeliveryPatch(project))
}

export async function updateProjectDeliveryConfig(
  projectId: string,
  patch: DeliveryConfigPatch,
): Promise<DeliveryConfig> {
  const project = await getProjectById(projectId)
  if (!project) {
    throw new Error(`Project ${projectId} not found`)
  }

  const defaults = await getGlobalDeliveryDefaults()
  const currentProjectPatch = extractProjectDeliveryPatch(project)
  const nextProjectPatch = mergeDeliveryConfig(
    mergeDeliveryConfig(defaults, currentProjectPatch),
    normalizePatch(patch),
  )

  const nextMetadata: Record<string, unknown> = {
    ...project.metadata,
    delivery_config: nextProjectPatch,
  }

  await updateProjectMetadata(projectId, nextMetadata)
  return nextProjectPatch
}
