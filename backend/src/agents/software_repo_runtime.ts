import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'

import { getModelForAgent } from '../config/models.js'
import { createGitHubRepo, isGitHubConfigured } from '../services/github.js'
import { runAgent, type ChatMessage } from '../services/llm.js'
import { log, recordEvent, recordRun } from '../services/logger.js'
import { getSpecialModelOverride } from '../services/model-routing-policy.js'
import type { Task, TaskType } from '../types/index.js'

const execFileAsync = promisify(execFile)

// ── Agentic Loop ─────────────────────────────────────────────────────────────
const MAX_AGENTIC_ITERATIONS = 40

const EXEC_ALLOWED_COMMANDS = new Set([
  'npm', 'npx', 'pnpm', 'pnpx', 'yarn', 'bun', 'bunx',
  'node', 'git', 'tsc', 'vite', 'next', 'eslint', 'prettier',
  'mkdir', 'cp', 'mv', 'rm', 'chmod', 'touch', 'ls',
])

export type AgentLoopActionType = 'exec_command' | 'create_file' | 'edit_file' | 'read_file' | 'done'

export interface AgentLoopAction {
  type: AgentLoopActionType
  command?: string    // exec_command: executable only, e.g. "npm"
  args?: string[]     // exec_command: arguments, e.g. ["install"]
  cwd?: string        // exec_command: relative to repoPath, defaults to "."
  path?: string       // create_file | edit_file | read_file: relative to repoPath
  content?: string    // create_file only
  oldText?: string    // edit_file only
  newText?: string    // edit_file only
  reason?: string
  summary?: string    // done only
  result?: 'success' | 'partial' | 'blocked'  // done only
  blockers?: string[] // done only
}

interface AgentLoopStep {
  iteration: number
  action: AgentLoopAction
  output: string
  durationMs: number
  error?: string
}
// ─────────────────────────────────────────────────────────────────────────────

const MAX_REPO_FILE_BYTES = 120_000
const MAX_TOTAL_CONTEXT_BYTES = 220_000
const MAX_TRACKED_FILES_IN_CONTEXT = 160
const MAX_HINTS_TO_RESOLVE = 10
const MAX_REPO_EDITS = 10
const IGNORED_REPO_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  'out',
  '.turbo',
  '.vercel',
  '.cache',
])

export interface RepoInspection {
  repoPath: string
  branch: string | null
  trackedFiles: string[]
  trackedFilesSample: string[]
  gitStatusShort: string[]
  topLevelEntries: string[]
  packageSummaries: PackageScriptSummary[]
}

interface PackageScriptSummary {
  relativeDir: string
  manager: PackageManager
  scripts: string[]
}

interface RepoFileSnapshot {
  requestedPath: string
  resolvedPath: string
  content: string
}

type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun'
type RepoEditType = 'create_file' | 'replace_in_file'
type RepoCommandName = 'install' | 'typecheck' | 'build' | 'test' | 'custom'
type RepoCommandStatus = 'passed' | 'failed' | 'skipped'

interface RepoEditPlan {
  summary: string
  warnings: string[]
  blockers: string[]
  edits: RepoEdit[]
  shellCommands?: RepoShellCommand[]
}

interface RepoShellCommand {
  command: string
  cwd?: string
  reason: string
  blocking?: boolean
}

interface RepoEdit {
  type: RepoEditType
  path: string
  content?: string
  oldText?: string
  newText?: string
  reason?: string
}

export interface RepoCommandResult {
  name: RepoCommandName
  command: string
  relativeDir: string
  status: RepoCommandStatus
  blocking: boolean
  summary: string
  stdoutExcerpt: string
  stderrExcerpt: string
}

export interface RepoExecutionResult {
  repoPath: string
  branch: string | null
  summary: string
  inspectionWarnings: string[]
  warnings: string[]
  blockers: string[]
  plannedFiles: string[]
  resolvedFiles: string[]
  touchedFiles: string[]
  appliedEditCount: number
  commands: RepoCommandResult[]
  gitStatusBefore: string[]
  gitStatusAfter: string[]
  diffFiles: string[]
}

interface PackageManifest {
  dir: string
  relativeDir: string
  manager: PackageManager
  scripts: Partial<Record<RepoCommandName, string>>
}

export interface RepoQaAssessment {
  repoPath: string
  branch: string | null
  gitStatusShort: string[]
  diffFiles: string[]
  commands: RepoCommandResult[]
  warnings: string[]
  blockingIssues: string[]
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  extraEnv?: Record<string, string>
): Promise<{ stdout: string; stderr: string; durationMs: number }> {
  const startMs = Date.now()
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd,
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024 * 4,
    ...(extraEnv ? { env: { ...process.env, ...extraEnv } } : {}),
  })

  return {
    stdout: String(stdout ?? ''),
    stderr: String(stderr ?? ''),
    durationMs: Date.now() - startMs,
  }
}

async function runGit(
  repoPath: string,
  args: string[],
  timeoutMs = 30_000
): Promise<{ stdout: string; stderr: string; durationMs: number }> {
  return runCommand('git', ['-C', repoPath, ...args], repoPath, timeoutMs)
}

function shortenOutput(value: string, maxLength = 1200): string {
  const trimmed = value.trim()
  if (trimmed.length <= maxLength) return trimmed
  return `${trimmed.slice(0, maxLength)}…`
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function toRelativeRepoPath(repoPath: string, targetPath: string): string {
  const rel = relative(repoPath, targetPath).replace(/\\/g, '/')
  return rel.length > 0 ? rel : '.'
}

function ensurePathInsideRepo(repoPath: string, candidatePath: string): string {
  const absolutePath = resolve(repoPath, candidatePath)
  const rel = relative(repoPath, absolutePath)

  if (rel === '' || (!rel.startsWith('..') && !rel.includes('../'))) {
    return absolutePath
  }

  throw new Error(`Path escapes repo root: ${candidatePath}`)
}

async function getGitBranch(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await runGit(repoPath, ['symbolic-ref', '--short', 'HEAD'])
    return stdout.trim() || null
  } catch {
    return null
  }
}

async function getGitStatusShort(repoPath: string): Promise<string[]> {
  try {
    const { stdout } = await runGit(repoPath, ['status', '--short'])
    return stdout.split('\n').map((line) => line.trimEnd()).filter(Boolean)
  } catch {
    return []
  }
}

async function getTrackedFiles(repoPath: string): Promise<string[]> {
  try {
    // Include both committed files AND untracked (but non-ignored) files.
    // This ensures that files written by a previous dev_general run (but not yet
    // committed) are visible to subsequent agents and don't trigger bootstrap mode.
    const [{ stdout: committed }, { stdout: untracked }] = await Promise.all([
      runGit(repoPath, ['ls-files']),
      runGit(repoPath, ['ls-files', '--others', '--exclude-standard']),
    ])
    const all = new Set([
      ...committed.split('\n').map((l) => l.trim()).filter(Boolean),
      ...untracked.split('\n').map((l) => l.trim()).filter(Boolean),
    ])
    return Array.from(all).sort()
  } catch {
    return []
  }
}

async function listTopLevelEntries(repoPath: string): Promise<string[]> {
  const entries = await readdir(repoPath, { withFileTypes: true })
  return entries
    .slice(0, 30)
    .map((entry) => `${entry.isDirectory() ? 'dir' : 'file'}:${entry.name}`)
}

function detectPackageManagerFromDir(dir: string, manifest: Record<string, unknown>): PackageManager {
  const packageManagerField = typeof manifest['packageManager'] === 'string' ? manifest['packageManager'] : ''
  if (packageManagerField.startsWith('pnpm@')) return 'pnpm'
  if (packageManagerField.startsWith('yarn@')) return 'yarn'
  if (packageManagerField.startsWith('bun@')) return 'bun'
  if (packageManagerField.startsWith('npm@')) return 'npm'
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(dir, 'bun.lockb')) || existsSync(join(dir, 'bun.lock'))) return 'bun'
  return 'npm'
}

async function discoverPackageManifests(
  repoPath: string,
  currentDir = repoPath,
  depth = 0
): Promise<PackageManifest[]> {
  if (depth > 3) return []

  const manifests: PackageManifest[] = []
  const entries = await readdir(currentDir, { withFileTypes: true })

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_REPO_DIRS.has(entry.name)) continue
      manifests.push(...await discoverPackageManifests(repoPath, join(currentDir, entry.name), depth + 1))
      continue
    }

    if (entry.name !== 'package.json') continue

    const packageJsonPath = join(currentDir, entry.name)
    try {
      const parsed = JSON.parse(await readFile(packageJsonPath, 'utf-8')) as Record<string, unknown>
      const scriptsRecord =
        typeof parsed['scripts'] === 'object' && parsed['scripts'] !== null
          ? (parsed['scripts'] as Record<string, unknown>)
          : {}

      const scripts: Partial<Record<RepoCommandName, string>> = {}
      for (const key of ['typecheck', 'build', 'test'] as const) {
        if (typeof scriptsRecord[key] === 'string') {
          scripts[key] = scriptsRecord[key]
        }
      }

      manifests.push({
        dir: currentDir,
        relativeDir: toRelativeRepoPath(repoPath, currentDir),
        manager: detectPackageManagerFromDir(currentDir, parsed),
        scripts,
      })
    } catch (error) {
      log.warn({ error, packageJsonPath }, 'Failed to parse package.json while inspecting repo')
    }
  }

  return manifests
}

async function inspectRepo(repoPath: string): Promise<RepoInspection> {
  const [branch, trackedFiles, gitStatusShort, topLevelEntries, manifests] = await Promise.all([
    getGitBranch(repoPath),
    getTrackedFiles(repoPath),
    getGitStatusShort(repoPath),
    listTopLevelEntries(repoPath),
    discoverPackageManifests(repoPath),
  ])

  return {
    repoPath,
    branch,
    trackedFiles,
    trackedFilesSample: trackedFiles.slice(0, MAX_TRACKED_FILES_IN_CONTEXT),
    gitStatusShort,
    topLevelEntries,
    packageSummaries: manifests.map((manifest) => ({
      relativeDir: manifest.relativeDir,
      manager: manifest.manager,
      scripts: Object.keys(manifest.scripts),
    })),
  }
}

function formatPackageSummaries(items: PackageScriptSummary[]): string {
  if (items.length === 0) return 'No package.json scripts discovered.'
  return items
    .map((item) => {
      const dirLabel = item.relativeDir === '.' ? './' : item.relativeDir
      const scripts = item.scripts.length > 0 ? item.scripts.join(', ') : 'no tracked scripts'
      return `- ${dirLabel} [${item.manager}] => ${scripts}`
    })
    .join('\n')
}

export async function buildRepoContext(repoLocalPath?: string): Promise<string> {
  if (!repoLocalPath || !existsSync(repoLocalPath)) return ''

  const inspection = await inspectRepo(repoLocalPath)
  const lines: string[] = [
    `Repository path: ${inspection.repoPath}`,
    `Current branch: ${inspection.branch ?? 'unknown'}`,
    inspection.topLevelEntries.length > 0
      ? `Top-level entries: ${inspection.topLevelEntries.join(', ')}`
      : 'Top-level entries: unavailable',
    inspection.gitStatusShort.length > 0
      ? `Git status: ${inspection.gitStatusShort.join(' | ')}`
      : 'Git status: clean',
    `Package scripts:\n${formatPackageSummaries(inspection.packageSummaries)}`,
  ]

  if (inspection.trackedFilesSample.length > 0) {
    lines.push(`Tracked files sample:\n${inspection.trackedFilesSample.join('\n')}`)
  }

  for (const relativePath of ['README.md', 'package.json', 'pnpm-workspace.yaml', 'tsconfig.json']) {
    const absolutePath = join(repoLocalPath, relativePath)
    if (!existsSync(absolutePath)) continue

    try {
      const content = await readFile(absolutePath, 'utf-8')
      lines.push(`## ${relativePath}\n${content.slice(0, 3500)}`)
    } catch {
      // Best effort only.
    }
  }

  return lines.join('\n\n')
}

function resolveRequestedPath(
  trackedFiles: string[],
  requestedPath: string
): string | null {
  const normalized = requestedPath.trim().replace(/^\.?\//, '').replace(/\\/g, '/')
  if (!normalized) return null

  if (trackedFiles.includes(normalized)) {
    return normalized
  }

  const exactSuffixMatches = trackedFiles.filter((item) => item.endsWith(`/${normalized}`) || item === normalized)
  if (exactSuffixMatches.length === 1) {
    return exactSuffixMatches[0]!
  }

  const basename = normalized.split('/').at(-1)
  if (!basename) return null

  const basenameMatches = trackedFiles.filter((item) => item.split('/').at(-1) === basename)
  if (basenameMatches.length === 1) {
    return basenameMatches[0]!
  }

  return null
}

async function loadRepoFiles(
  repoPath: string,
  trackedFiles: string[],
  requestedPaths: string[]
): Promise<{ files: RepoFileSnapshot[]; warnings: string[] }> {
  const files: RepoFileSnapshot[] = []
  const warnings: string[] = []
  let totalBytes = 0

  for (const requestedPath of requestedPaths.slice(0, MAX_HINTS_TO_RESOLVE)) {
    const resolvedPath = resolveRequestedPath(trackedFiles, requestedPath) ?? requestedPath.trim().replace(/^\.?\//, '')
    const absolutePath = ensurePathInsideRepo(repoPath, resolvedPath)

    if (!existsSync(absolutePath)) {
      warnings.push(`Requested repo file not found: ${requestedPath}`)
      continue
    }

    try {
      const content = await readFile(absolutePath, 'utf-8')
      const bytes = Buffer.byteLength(content, 'utf-8')
      if (bytes > MAX_REPO_FILE_BYTES) {
        warnings.push(`Skipped large file during repo execution planning: ${resolvedPath}`)
        continue
      }

      if (totalBytes + bytes > MAX_TOTAL_CONTEXT_BYTES) {
        warnings.push('Repo execution context truncated because the selected files are too large.')
        break
      }

      totalBytes += bytes
      files.push({
        requestedPath,
        resolvedPath,
        content,
      })
    } catch {
      warnings.push(`Could not read repo file: ${resolvedPath}`)
    }
  }

  return { files, warnings }
}

function parseRepoEditPlan(raw: string): RepoEditPlan | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
    const edits = Array.isArray(parsed['edits'])
      ? parsed['edits']
          .map((item): RepoEdit | null => {
            if (typeof item !== 'object' || item === null) return null
            const edit = item as Record<string, unknown>
            if (
              (edit['type'] !== 'create_file' && edit['type'] !== 'replace_in_file') ||
              typeof edit['path'] !== 'string'
            ) {
              return null
            }

            if (edit['type'] === 'create_file') {
              if (typeof edit['content'] !== 'string') return null
              return {
                type: 'create_file',
                path: edit['path'],
                content: edit['content'],
                ...(typeof edit['reason'] === 'string' ? { reason: edit['reason'] } : {}),
              }
            }

            if (typeof edit['oldText'] !== 'string' || typeof edit['newText'] !== 'string') {
              return null
            }

            return {
              type: 'replace_in_file',
              path: edit['path'],
              oldText: edit['oldText'],
              newText: edit['newText'],
              ...(typeof edit['reason'] === 'string' ? { reason: edit['reason'] } : {}),
            }
          })
          .filter((item): item is RepoEdit => item !== null)
      : []

    const shellCommands = Array.isArray(parsed['shellCommands'])
      ? parsed['shellCommands']
          .map((item): RepoShellCommand | null => {
            if (typeof item !== 'object' || item === null) return null
            const cmd = item as Record<string, unknown>
            if (typeof cmd['command'] !== 'string' || typeof cmd['reason'] !== 'string') {
              return null
            }
            return {
              command: cmd['command'],
              reason: cmd['reason'],
              ...(typeof cmd['cwd'] === 'string' ? { cwd: cmd['cwd'] } : {}),
              blocking: typeof cmd['blocking'] === 'boolean' ? cmd['blocking'] : true,
            }
          })
          .filter((item): item is RepoShellCommand => item !== null)
      : []

    if (typeof parsed['summary'] !== 'string') {
      return null
    }

    return {
      summary: parsed['summary'],
      warnings: sanitizeStringArray(parsed['warnings']),
      blockers: sanitizeStringArray(parsed['blockers']),
      edits,
      shellCommands,
    }
  } catch {
    return null
  }
}

async function applyRepoEdits(
  repoPath: string,
  edits: RepoEdit[]
): Promise<{ touchedFiles: string[]; blockers: string[]; warnings: string[]; appliedEditCount: number }> {
  const touchedFiles = new Set<string>()
  const warnings: string[] = []
  const blockers: string[] = []
  let appliedEditCount = 0

  for (const edit of edits.slice(0, MAX_REPO_EDITS)) {
    const absolutePath = ensurePathInsideRepo(repoPath, edit.path)
    const relativePath = toRelativeRepoPath(repoPath, absolutePath)

    try {
      if (edit.type === 'create_file') {
        // If file already exists, overwrite it (agent knows what content it wants)
        await mkdir(dirname(absolutePath), { recursive: true })
        await writeFile(absolutePath, edit.content ?? '', 'utf-8')
        touchedFiles.add(relativePath)
        appliedEditCount += 1
        continue
      }

      if (!existsSync(absolutePath)) {
        blockers.push(`Cannot edit missing file: ${relativePath}`)
        continue
      }

      const currentContent = await readFile(absolutePath, 'utf-8')
      const oldText = edit.oldText ?? ''
      const newText = edit.newText ?? ''

      if (!oldText) {
        blockers.push(`Missing oldText for replace_in_file on ${relativePath}`)
        continue
      }

      const matches = currentContent.split(oldText).length - 1
      if (matches !== 1) {
        blockers.push(
          `Expected exactly one match while editing ${relativePath}, found ${matches}.`
        )
        continue
      }

      const updatedContent = currentContent.replace(oldText, newText)
      await writeFile(absolutePath, updatedContent, 'utf-8')
      touchedFiles.add(relativePath)
      appliedEditCount += 1
    } catch (error) {
      warnings.push(`Repo edit failed for ${relativePath}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return {
    touchedFiles: Array.from(touchedFiles),
    blockers,
    warnings,
    appliedEditCount,
  }
}

function chooseRelevantManifests(
  manifests: PackageManifest[],
  touchedFiles: string[]
): PackageManifest[] {
  if (manifests.length === 0) return []

  const touched = touchedFiles.map((file) => file.replace(/\\/g, '/'))
  const relevant = manifests.filter((manifest) => {
    if (manifest.relativeDir === '.') {
      return touched.some((file) => !file.includes('/'))
    }
    return touched.some((file) => file === manifest.relativeDir || file.startsWith(`${manifest.relativeDir}/`))
  })

  if (relevant.length > 0) {
    return relevant
  }

  const rootManifest = manifests.find((manifest) => manifest.relativeDir === '.')
  if (rootManifest) return [rootManifest]

  return manifests.slice(0, 3)
}

function dependenciesAvailable(repoPath: string, manifestDir: string): boolean {
  return existsSync(join(manifestDir, 'node_modules')) || existsSync(join(repoPath, 'node_modules'))
}

function installCommandForManager(manager: PackageManager): { command: string; args: string[] } {
  if (manager === 'pnpm') return { command: 'pnpm', args: ['install', '--frozen-lockfile'] }
  if (manager === 'yarn') return { command: 'yarn', args: ['install', '--immutable'] }
  if (manager === 'bun') return { command: 'bun', args: ['install', '--frozen-lockfile'] }
  return { command: 'npm', args: ['install'] }
}

function scriptCommandForManager(
  manager: PackageManager,
  script: RepoCommandName
): { command: string; args: string[]; label: string } {
  if (manager === 'pnpm') return { command: 'pnpm', args: [script], label: `pnpm ${script}` }
  if (manager === 'yarn') return { command: 'yarn', args: [script], label: `yarn ${script}` }
  if (manager === 'bun') return { command: 'bun', args: ['run', script], label: `bun run ${script}` }
  return { command: 'npm', args: ['run', script], label: `npm run ${script}` }
}

async function recordToolRun(
  agentId: string,
  taskType: TaskType,
  taskId: string | undefined,
  tools: string[],
  inputSummary: string,
  outputSummary: string,
  outcome: 'success' | 'failure' | 'partial',
  durationMs: number
): Promise<void> {
  const modelId = getModelForAgent({ agentId, taskType }).id
  await recordRun({
    agent_id: agentId,
    ...(taskId ? { task_id: taskId } : {}),
    model_id: modelId,
    input_summary: inputSummary.slice(0, 500),
    output_summary: outputSummary.slice(0, 500),
    tokens_input: 0,
    tokens_output: 0,
    tools_used: tools,
    outcome,
    duration_ms: durationMs,
  })
}

async function runRepoCommand(
  agentId: string,
  taskType: TaskType,
  taskId: string | undefined,
  manifest: PackageManifest,
  repoPath: string,
  name: RepoCommandName,
  command: string,
  args: string[],
  blocking: boolean
): Promise<RepoCommandResult> {
  const relativeDir = manifest.relativeDir
  const cwd = manifest.dir
  const commandLabel = [command, ...args].join(' ')
  const cmdStart = Date.now()

  // Build/typecheck/test must run with NODE_ENV=production so Next.js (and similar
  // frameworks) don't use development-mode React during static prerendering.
  const buildEnv = name !== 'install' ? { NODE_ENV: 'production' } : undefined

  try {
    const { stdout, stderr, durationMs } = await runCommand(
      command,
      args,
      cwd,
      name === 'install' ? 300_000 : 600_000,
      buildEnv
    )

    const summary = stdout.trim() || stderr.trim() || `${name} passed`
    await recordToolRun(
      agentId,
      taskType,
      taskId,
      ['shell', name],
      `${commandLabel} @ ${relativeDir}`,
      summary,
      'success',
      durationMs
    )
    await recordEvent('run_completed', {
      agentId,
      ...(taskId ? { taskId } : {}),
      payload: {
        repo_path: repoPath,
        cwd: relativeDir,
        command: commandLabel,
        command_type: name,
        summary: shortenOutput(summary, 300),
      },
    })

    return {
      name,
      command: commandLabel,
      relativeDir,
      status: 'passed',
      blocking,
      summary: shortenOutput(summary),
      stdoutExcerpt: shortenOutput(stdout),
      stderrExcerpt: shortenOutput(stderr),
    }
  } catch (error) {
    const stderr =
      typeof error === 'object' && error !== null && 'stderr' in error
        ? String(error.stderr ?? '')
        : ''
    const stdout =
      typeof error === 'object' && error !== null && 'stdout' in error
        ? String(error.stdout ?? '')
        : ''
    const message =
      stderr.trim() ||
      stdout.trim() ||
      (error instanceof Error ? error.message : `Command failed: ${commandLabel}`)
    const durationMs = Date.now() - cmdStart

    await recordToolRun(
      agentId,
      taskType,
      taskId,
      ['shell', name],
      `${commandLabel} @ ${relativeDir}`,
      message,
      'failure',
      durationMs
    )
    await recordEvent('run_failed', {
      agentId,
      ...(taskId ? { taskId } : {}),
      severity: blocking ? 'error' : 'warning',
      payload: {
        repo_path: repoPath,
        cwd: relativeDir,
        command: commandLabel,
        command_type: name,
        summary: shortenOutput(message, 300),
      },
    })

    return {
      name,
      command: commandLabel,
      relativeDir,
      status: 'failed',
      blocking,
      summary: shortenOutput(message),
      stdoutExcerpt: shortenOutput(stdout),
      stderrExcerpt: shortenOutput(stderr),
    }
  }
}

async function runRepoChecks(
  repoPath: string,
  manifests: PackageManifest[],
  touchedFiles: string[],
  agentId: string,
  taskType: TaskType,
  taskId?: string
): Promise<{ commands: RepoCommandResult[]; warnings: string[]; blockingIssues: string[] }> {
  const warnings: string[] = []
  const blockingIssues: string[] = []
  const commands: RepoCommandResult[] = []
  const relevantManifests = chooseRelevantManifests(manifests, touchedFiles)

  if (relevantManifests.length === 0) {
    warnings.push('No package.json scripts found for typecheck/build/test.')
    return { commands, warnings, blockingIssues }
  }

  for (const manifest of relevantManifests) {
    const availableScripts = Object.keys(manifest.scripts) as RepoCommandName[]
    if (availableScripts.length === 0) {
      warnings.push(`No typecheck/build/test scripts found in ${manifest.relativeDir}.`)
      continue
    }

    const requiresInstall = !dependenciesAvailable(repoPath, manifest.dir)
    if (requiresInstall) {
      const install = installCommandForManager(manifest.manager)
      commands.push(
        await runRepoCommand(
          agentId,
          taskType,
          taskId,
          manifest,
          repoPath,
          'install',
          install.command,
          install.args,
          true
        )
      )
      if (commands.at(-1)?.status === 'failed') {
        // Install failure → warning only. We couldn't verify the build, but this
        // does not prove the code is broken (common for static sites, network issues,
        // or projects with no build scripts). Hard blockers come only from script failures.
        warnings.push(`Dependency install failed in ${manifest.relativeDir} — build verification skipped.`)
        continue
      }
    }

    for (const script of ['typecheck', 'build', 'test'] as const) {
      if (!manifest.scripts[script]) {
        warnings.push(`Skipped ${script} in ${manifest.relativeDir}: script not present.`)
        continue
      }

      const runner = scriptCommandForManager(manifest.manager, script)
      const result = await runRepoCommand(
        agentId,
        taskType,
        taskId,
        manifest,
        repoPath,
        script,
        runner.command,
        runner.args,
        true
      )
      commands.push(result)

      if (result.status === 'failed') {
        blockingIssues.push(`${script} failed in ${manifest.relativeDir}.`)
      }
    }
  }

  return { commands, warnings, blockingIssues }
}

async function getDiffFiles(repoPath: string): Promise<string[]> {
  try {
    const { stdout } = await runGit(repoPath, ['diff', '--name-only'])
    return stdout.split('\n').map((line) => line.trim()).filter(Boolean)
  } catch {
    return []
  }
}

function repoFilesSection(files: RepoFileSnapshot[]): string {
  if (files.length === 0) return 'No repo files were loaded for editing.'

  return files
    .map(
      (file) => `## ${file.resolvedPath}\n\`\`\`\n${file.content}\n\`\`\``
    )
    .join('\n\n')
}

export async function executeRepoImplementation(options: {
  agentId: string
  task: Task
  taskType: TaskType
  repoLocalPath?: string
  projectName: string
  clientName: string
  projectType?: string
  taskDescription: string
  implementationTitle: string
  implementationSummary: string
  implementationApproach: string
  filesToTouch: string[]
  testingNotes: string[]
  architecturePlanContent?: string
  additionalContext?: string[]
}): Promise<RepoExecutionResult | null> {
  const {
    agentId,
    task,
    taskType,
    repoLocalPath,
    projectName,
    clientName,
    projectType,
    taskDescription,
    implementationTitle,
    implementationSummary,
    implementationApproach,
    filesToTouch,
    testingNotes,
    architecturePlanContent,
    additionalContext = [],
  } = options

  if (!repoLocalPath || !existsSync(repoLocalPath)) {
    return null
  }

  const inspection = await inspectRepo(repoLocalPath)
  const filesBefore = await loadRepoFiles(repoLocalPath, inspection.trackedFiles, filesToTouch)

  const isBootstrapRepo =
    inspection.trackedFiles.length <= 3 &&
    !inspection.trackedFiles.some((f) =>
      f === 'package.json' ||
      f === 'requirements.txt' ||
      f === 'index.html' ||
      f.startsWith('src/') ||
      f.startsWith('app/')
    )

  const editSystemPrompt = `You are ${agentId}, a software execution agent inside WAI (Wawen Autonomous Industries).
You must output ONLY a JSON object with this schema:
{
  "summary": "<what was implemented in the repo>",
  "warnings": ["<warning 1>", "<warning 2>"],
  "blockers": ["<blocking issue 1>", "<blocking issue 2>"],
  "edits": [
    {
      "type": "create_file",
      "path": "<repo-relative path>",
      "content": "<full file contents — complete, no placeholders>",
      "reason": "<why it was created>"
    },
    {
      "type": "replace_in_file",
      "path": "<repo-relative path>",
      "oldText": "<exact text copied from the provided current file contents>",
      "newText": "<replacement text>",
      "reason": "<why the replacement is needed>"
    }
  ],
  "shellCommands": [
    {
      "command": "<shell command to run, e.g., npm install package-name>",
      "reason": "<why this command is needed>",
      "cwd": "<optional repo-relative directory>",
      "blocking": true
    }
  ]
}

${isBootstrapRepo ? `## BOOTSTRAP MODE — CRITICAL INSTRUCTIONS
The repo currently contains only scaffold files (README.md, .gitignore). This is a FRESH BOOTSTRAP task.
You MUST create ALL the project files from scratch using "create_file" operations.
Do NOT try to replace_in_file on README.md or .gitignore — use create_file for every new file.
For a website project, create at minimum: index.html, style.css, and script.js (or equivalent).
For a Next.js/React project, create: package.json, tsconfig.json, next.config.js, tailwind.config.ts, src/app/page.tsx, src/app/layout.tsx, src/app/globals.css, postcss.config.js.
Write COMPLETE, WORKING file contents. No placeholders. No "TODO" comments.

` : ''}Constraints:
- Only use repo-relative paths.
- Never delete files.
- Use create_file for NEW files that do not exist yet in the repo.
- Use replace_in_file ONLY for files shown in "Current repo files selected for editing" — copy oldText exactly.
- Keep edits focused on the task.
- Write complete, production-quality file contents — not stubs or placeholders.
- If the repo context is insufficient, leave edits empty and explain blockers.
- SHELL COMMANDS: Use "shellCommands" to run ANY necessary terminal commands. 
  * If you add a library, run 'npm install <library>'.
  * If you need to build, run 'npm run build'.
  * These run AFTER file edits. Use them to maintain a WORKING environment.`

  const editUserMessage = [
    `Client: ${clientName}`,
    `Project: ${projectName}`,
    projectType ? `Project type: ${projectType}` : '',
    `Task title: ${task.title}`,
    `Task description: ${taskDescription}`,
    `Implementation title: ${implementationTitle}`,
    `Implementation summary: ${implementationSummary}`,
    `Implementation approach: ${implementationApproach}`,
    filesToTouch.length > 0 ? `Requested files to touch: ${filesToTouch.join(' | ')}` : '',
    testingNotes.length > 0 ? `Testing notes: ${testingNotes.join(' | ')}` : '',
    architecturePlanContent ? `\nArchitecture Plan:\n${architecturePlanContent.slice(0, 8000)}` : '',
    additionalContext.length > 0 ? `\nAdditional context:\n${additionalContext.join('\n')}` : '',
    `\nRepo inspection:\n- Branch: ${inspection.branch ?? 'unknown'}\n- Bootstrap mode: ${isBootstrapRepo ? 'YES — repo is empty/scaffold-only, create ALL project files from scratch' : 'NO — repo has real project files, modify existing'}\n- Git status: ${inspection.gitStatusShort.join(' | ') || 'clean'}\n- Package scripts:\n${formatPackageSummaries(inspection.packageSummaries)}\n- Tracked files (${inspection.trackedFiles.length} total):\n${inspection.trackedFilesSample.join('\n')}`,
    `\nCurrent repo files selected for editing:\n${repoFilesSection(filesBefore.files)}`,
    filesBefore.warnings.length > 0 ? `\nRepo file loading warnings:\n- ${filesBefore.warnings.join('\n- ')}` : '',
  ].filter(Boolean).join('\n')

  const specialOverrideModelId = await getSpecialModelOverride('repo_edit_planning')

  let editResult
  try {
    editResult = await runAgent(
      [
        { role: 'system', content: editSystemPrompt },
        { role: 'user', content: editUserMessage },
      ],
      {
        agentId,
        taskId: task.id,
        taskType,
        ...(specialOverrideModelId !== null && { modelOverride: specialOverrideModelId }),
        tools: ['file_system', 'shell'],
        captureMemory: false,
      }
    )
  } catch (error) {
    const overrideLabel = specialOverrideModelId ?? 'inherit-agent-assignment'
    throw new Error(
      `Repo edit planning failed for ${agentId} using ${overrideLabel}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error instanceof Error ? error : undefined }
    )
  }

  const parsedPlan = parseRepoEditPlan(editResult.content)
  if (!parsedPlan) {
    throw new Error(`Could not parse repo edit plan from ${agentId}: ${editResult.content.slice(0, 200)}`)
  }

  const gitStatusBefore = inspection.gitStatusShort
  const applyResult = await applyRepoEdits(repoLocalPath, parsedPlan.edits)

  // Auto-commit every successful write so subsequent agents see the files as tracked.
  // Non-fatal: files are already on disk even if the commit fails.
  if (applyResult.touchedFiles.length > 0) {
    try {
      await runGit(repoLocalPath, ['add', '-A'])
      const commitMsg = `feat(wai-agent): ${parsedPlan.summary.slice(0, 72)}`
      await runGit(repoLocalPath, ['commit', '-m', commitMsg])
    } catch {
      // silent — files on disk regardless of commit outcome
    }
  }

  // Execute custom shell commands
  const customCommandResults: RepoCommandResult[] = []
  for (const cmd of parsedPlan.shellCommands ?? []) {
    const [command, ...args] = cmd.command.split(' ')
    const cmdCwd = cmd.cwd ? join(repoLocalPath, cmd.cwd) : repoLocalPath
    const result = await runRepoCommand(
      agentId,
      taskType,
      task.id,
      {
        dir: cmdCwd,
        relativeDir: cmd.cwd || '.',
        manager: 'npm', // fallback, runRepoCommand uses it for labelling
        scripts: {}
      },
      repoLocalPath,
      'custom',
      command!,
      args,
      cmd.blocking ?? true
    )
    customCommandResults.push(result)
    if (result.status === 'failed' && result.blocking) {
      break
    }
  }

  const manifests = await discoverPackageManifests(repoLocalPath)
  const checkResult = await runRepoChecks(
    repoLocalPath,
    manifests,
    applyResult.touchedFiles,
    agentId,
    taskType,
    task.id
  )
  const gitStatusAfter = await getGitStatusShort(repoLocalPath)
  const diffFiles = await getDiffFiles(repoLocalPath)

  const blockers = [
    ...parsedPlan.blockers,
    ...applyResult.blockers,
    ...checkResult.blockingIssues,
    ...customCommandResults.filter(c => c.status === 'failed' && c.blocking).map(c => `Custom command failed: ${c.command}`)
  ]
  const warnings = [
    ...filesBefore.warnings,
    ...parsedPlan.warnings,
    ...applyResult.warnings,
    ...checkResult.warnings,
  ]

  if (applyResult.touchedFiles.length === 0 && customCommandResults.length === 0) {
    warnings.push('No repo files were changed and no commands were executed during this step.')
  }

  return {
    repoPath: repoLocalPath,
    branch: inspection.branch,
    summary: parsedPlan.summary,
    inspectionWarnings: filesBefore.warnings,
    warnings,
    blockers,
    plannedFiles: filesToTouch,
    resolvedFiles: filesBefore.files.map((file) => file.resolvedPath),
    touchedFiles: applyResult.touchedFiles,
    appliedEditCount: applyResult.appliedEditCount,
    commands: [...customCommandResults, ...checkResult.commands],
    gitStatusBefore,
    gitStatusAfter,
    diffFiles,
  }
}

// ── Agentic Loop helpers ─────────────────────────────────────────────────────

/** Extract the first complete JSON object from raw text using brace-depth tracking.
 *  Avoids the greedy-regex problem where /\{[\s\S]*\}/ spans multiple objects. */
function extractFirstJsonObject(raw: string): string | null {
  let depth = 0
  let start = -1
  let inString = false
  let escapeNext = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!
    if (escapeNext) { escapeNext = false; continue }
    if (ch === '\\' && inString) { escapeNext = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && start !== -1) return raw.slice(start, i + 1)
    }
  }
  return null
}

function parseAgentLoopAction(raw: string): AgentLoopAction | null {
  const jsonStr = extractFirstJsonObject(raw)
  if (!jsonStr) return null
  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>
    const validTypes: AgentLoopActionType[] = ['exec_command', 'create_file', 'edit_file', 'read_file', 'done']
    if (!validTypes.includes(parsed['type'] as AgentLoopActionType)) return null

    // Normalise exec_command: if the model put the full shell string in "command"
    // (e.g. "ls -la src/") instead of separating command + args, auto-split it.
    if (parsed['type'] === 'exec_command' && typeof parsed['command'] === 'string') {
      const fullCmd = (parsed['command'] as string).trim()
      const existingArgs = Array.isArray(parsed['args']) ? parsed['args'] as string[] : []
      if (fullCmd.includes(' ') && existingArgs.length === 0) {
        const parts = fullCmd.split(/\s+/).filter(Boolean)
        parsed['command'] = parts[0]
        parsed['args'] = parts.slice(1)
      }
    }

    return parsed as unknown as AgentLoopAction
  } catch {
    return null
  }
}

function buildAgentLoopSystemPrompt(agentRole: string, taskDescription: string, architecturePlan: string): string {
  return `You are ${agentRole}. Implement the assigned task by taking ONE action at a time and reacting to results.

## Your Task
${taskDescription}

## Architecture Plan
${architecturePlan || 'No architecture plan provided — use your best judgement.'}

## CRITICAL OUTPUT FORMAT
You MUST respond with EXACTLY ONE raw JSON object — no prose, no markdown, no code fences, no explanation before or after.
Any response that is not a single JSON object will be treated as an error and you will be asked to try again.

## Available Actions

exec_command — run a shell command. IMPORTANT: put the executable in "command" and all arguments in "args" as an array:
{"type":"exec_command","command":"npm","args":["install","recharts"],"cwd":".","reason":"install recharts"}
{"type":"exec_command","command":"ls","args":["src/app"],"cwd":".","reason":"inspect directory"}
{"type":"exec_command","command":"npx","args":["create-next-app@latest",".","--typescript","--tailwind","--eslint","--app","--yes"],"cwd":".","reason":"scaffold"}

create_file — create a new file (fails if file already exists):
{"type":"create_file","path":"src/index.ts","content":"export default {}","reason":"main entry point"}

edit_file — replace text in existing file (exact string match required):
{"type":"edit_file","path":"package.json","oldText":"\\"version\\": \\"0.0.0\\"","newText":"\\"version\\": \\"1.0.0\\"","reason":"update version"}

read_file — read a file to inspect current state:
{"type":"read_file","path":"package.json","reason":"check current dependencies"}

done — signal task completion:
{"type":"done","summary":"Implemented X. Build passes.","result":"success"}
or if blocked:
{"type":"done","summary":"Could not complete: reason.","result":"blocked","blockers":["specific reason"]}

## Rules
- ONE JSON action per turn — output ONLY the JSON object, absolutely nothing else
- exec_command: "command" must be a single executable (e.g. "npm"), put all flags/arguments in "args" array
- Allowed exec_command executables: npm, npx, pnpm, pnpx, yarn, bun, bunx, node, git, tsc, vite, next, eslint, prettier, mkdir, cp, mv, rm, chmod, touch, ls
- If a command fails, read the error and try to fix the issue before giving up
- Use read_file before edit_file if you need to verify current content
- create_file fails if the file already exists — read first, then use edit_file for existing files
- When done, output the done action with a concise summary of what was accomplished`
}

function buildAgentLoopUserMessage(
  repoState: string,
  history: AgentLoopStep[],
  iteration: number,
  maxIterations: number
): string {
  const historyText = history.length === 0
    ? 'No actions taken yet. Begin with your first action.'
    : history.map((step) => {
        const actionLabel = step.action.type === 'exec_command'
          ? `exec_command: ${step.action.command ?? ''} ${(step.action.args ?? []).join(' ')} (cwd: ${step.action.cwd ?? '.'})`
          : step.action.type === 'done'
          ? `done: ${step.action.result ?? 'unknown'}`
          : `${step.action.type}: ${step.action.path ?? ''}`
        return `[Step ${step.iteration}/${maxIterations}] ${actionLabel}\nResult:\n${step.output.slice(0, 1000)}${step.error ? `\nError: ${step.error}` : ''}`
      }).join('\n\n---\n\n')

  return `## Current Repository State\n${repoState}\n\n## Action History (${history.length} steps done, ${maxIterations - iteration + 1} remaining)\n${historyText}\n\nOutput your next action as JSON.`
}

export async function executeAgenticLoop(options: {
  task: Task
  repoPath: string
  agentId: string
  agentRole: string
  taskDescription: string
  architecturePlan: string
  maxIterations?: number
}): Promise<RepoExecutionResult> {
  const { task, repoPath, agentId, agentRole, taskDescription, architecturePlan } = options
  const maxIterations = options.maxIterations ?? MAX_AGENTIC_ITERATIONS
  const startMs = Date.now()

  const history: AgentLoopStep[] = []
  const allTouchedFiles = new Set<string>()
  const allCommands: RepoCommandResult[] = []
  const allWarnings: string[] = []
  const allBlockers: string[] = []

  const systemPrompt = buildAgentLoopSystemPrompt(agentRole, taskDescription, architecturePlan)
  const gitStatusBefore = await getGitStatusShort(repoPath)
  let consecutiveParseFailures = 0

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const repoState = await buildRepoContext(repoPath)
    const userMessage = buildAgentLoopUserMessage(repoState, history, iteration, maxIterations)

    let raw: string
    try {
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ]
      const result = await runAgent(messages, { agentId, taskType: task.type as TaskType })
      raw = result.content
    } catch (err) {
      allWarnings.push(`LLM call failed at iteration ${iteration}: ${err instanceof Error ? err.message : String(err)}`)
      break
    }

    const action = parseAgentLoopAction(raw)
    if (!action) {
      consecutiveParseFailures++
      allWarnings.push(`Iteration ${iteration}: could not parse agent action (failure ${consecutiveParseFailures}/3)`)
      if (consecutiveParseFailures >= 3) break
      // Inject a JSON reminder into history so the next turn knows to output JSON
      history.push({
        iteration,
        action: { type: 'read_file', path: '__system__' },
        output: 'SYSTEM ERROR: Your previous response was not valid JSON. You MUST respond with ONLY a single JSON object — no prose, no markdown fences, no explanation. Example: {"type":"create_file","path":"src/foo.ts","content":"export {}","reason":"create file"}',
        durationMs: 0,
      })
      continue
    }
    consecutiveParseFailures = 0

    const stepStart = Date.now()
    let output = ''
    let stepError: string | undefined

    // ── done ─────────────────────────────────────────────────────────────────
    if (action.type === 'done') {
      if (action.blockers?.length) allBlockers.push(...action.blockers)
      history.push({ iteration, action, output: action.summary ?? 'Done.', durationMs: Date.now() - stepStart })
      break
    }

    // ── exec_command ──────────────────────────────────────────────────────────
    if (action.type === 'exec_command') {
      const cmd = (action.command ?? '').trim()
      const args = action.args ?? []
      const cwdResolved = action.cwd ? resolve(repoPath, action.cwd) : repoPath

      if (!EXEC_ALLOWED_COMMANDS.has(cmd)) {
        output = `Command not allowed: "${cmd}". Allowed: ${Array.from(EXEC_ALLOWED_COMMANDS).join(', ')}`
        stepError = output
        allWarnings.push(output)
      } else {
        try {
          const cmdResult = await runCommand(cmd, args, cwdResolved, 600_000)
          const stdoutClean = cmdResult.stdout.trim()
          const stderrClean = cmdResult.stderr.trim()
          output = [
            stdoutClean ? `STDOUT:\n${stdoutClean}` : '',
            stderrClean ? `STDERR:\n${stderrClean}` : '',
          ].filter(Boolean).join('\n') || 'Command completed with no output.'

          allCommands.push({
            name: 'custom' as RepoCommandName,
            command: [cmd, ...args].join(' '),
            relativeDir: toRelativeRepoPath(repoPath, cwdResolved),
            status: 'passed',
            blocking: true,
            summary: shortenOutput(stdoutClean || stderrClean, 300),
            stdoutExcerpt: shortenOutput(stdoutClean),
            stderrExcerpt: shortenOutput(stderrClean, 300),
          })
        } catch (err) {
          const execErr = err as Record<string, unknown>
          const stderr = String(execErr['stderr'] ?? '')
          const stdout = String(execErr['stdout'] ?? '')
          output = `FAILED:\n${(stderr || stdout || String(err)).trim()}`
          stepError = shortenOutput(stderr || stdout, 200)
          allCommands.push({
            name: 'custom' as RepoCommandName,
            command: [cmd, ...args].join(' '),
            relativeDir: toRelativeRepoPath(repoPath, cwdResolved),
            status: 'failed',
            blocking: false,
            summary: stepError ?? 'failed',
            stdoutExcerpt: shortenOutput(stdout),
            stderrExcerpt: shortenOutput(stderr),
          })
        }
      }
    }

    // ── create_file ───────────────────────────────────────────────────────────
    if (action.type === 'create_file' && action.path) {
      const editResult = await applyRepoEdits(repoPath, [{
        type: 'create_file',
        path: action.path,
        content: action.content ?? '',
        ...(action.reason !== undefined ? { reason: action.reason } : {}),
      }])
      editResult.touchedFiles.forEach((f) => allTouchedFiles.add(f))
      allBlockers.push(...editResult.blockers)
      allWarnings.push(...editResult.warnings)
      output = editResult.blockers.length > 0
        ? `FAILED: ${editResult.blockers.join('; ')}`
        : `Created ${action.path} (${(action.content ?? '').split('\n').length} lines)`
      if (editResult.blockers.length > 0) stepError = editResult.blockers[0]
    }

    // ── edit_file ─────────────────────────────────────────────────────────────
    if (action.type === 'edit_file' && action.path) {
      const editResult = await applyRepoEdits(repoPath, [{
        type: 'replace_in_file',
        path: action.path,
        oldText: action.oldText ?? '',
        newText: action.newText ?? '',
        ...(action.reason !== undefined ? { reason: action.reason } : {}),
      }])
      editResult.touchedFiles.forEach((f) => allTouchedFiles.add(f))
      allBlockers.push(...editResult.blockers)
      allWarnings.push(...editResult.warnings)
      output = editResult.blockers.length > 0
        ? `FAILED: ${editResult.blockers.join('; ')}`
        : `Edited ${action.path}`
      if (editResult.blockers.length > 0) stepError = editResult.blockers[0]
    }

    // ── read_file ─────────────────────────────────────────────────────────────
    if (action.type === 'read_file' && action.path) {
      try {
        const absolutePath = ensurePathInsideRepo(repoPath, action.path)
        if (existsSync(absolutePath)) {
          const fileContent = await readFile(absolutePath, 'utf-8')
          output = fileContent.length > 4000
            ? `${fileContent.slice(0, 4000)}\n... [truncated — ${fileContent.length} chars total]`
            : fileContent
        } else {
          output = `File not found: ${action.path}`
          stepError = output
        }
      } catch (err) {
        output = `Error reading ${action.path}: ${err instanceof Error ? err.message : String(err)}`
        stepError = output
      }
    }

    history.push({
      iteration,
      action,
      output: output.slice(0, 1500),
      durationMs: Date.now() - stepStart,
      ...(stepError ? { error: stepError } : {}),
    })

    await recordEvent('agent_loop_step', {
      agentId,
      ...(task.id ? { taskId: task.id } : {}),
      payload: {
        iteration,
        action_type: action.type,
        path: action.path,
        command: action.command,
        status: stepError ? 'error' : 'ok',
        duration_ms: Date.now() - stepStart,
      },
    })
  }

  const gitStatusAfter = await getGitStatusShort(repoPath)
  const diffFiles = gitStatusAfter.filter((s) => !gitStatusBefore.includes(s))
  const lastDoneStep = [...history].reverse().find((s) => s.action.type === 'done')

  if (!lastDoneStep) {
    allWarnings.push(`Agent did not call "done" within ${maxIterations} iterations — treating as complete.`)
  }

  const summary = lastDoneStep?.action.summary
    ?? `Completed ${history.length} iterations, touched ${allTouchedFiles.size} files.`

  await recordToolRun(
    agentId,
    task.type as TaskType,
    task.id,
    ['shell', 'file_system'],
    taskDescription.slice(0, 500),
    summary,
    allBlockers.length > 0 ? 'partial' : 'success',
    Date.now() - startMs
  )

  return {
    repoPath,
    branch: await getGitBranch(repoPath),
    summary,
    inspectionWarnings: [],
    warnings: allWarnings,
    blockers: allBlockers,
    plannedFiles: [],
    resolvedFiles: [],
    touchedFiles: Array.from(allTouchedFiles),
    appliedEditCount: allTouchedFiles.size,
    commands: allCommands,
    gitStatusBefore,
    gitStatusAfter,
    diffFiles,
  }
}
// ─────────────────────────────────────────────────────────────────────────────

function commandStatusIcon(result: RepoCommandResult): string {
  if (result.status === 'passed') return 'PASS'
  if (result.status === 'failed') return 'FAIL'
  return 'SKIP'
}

export function renderRepoExecutionMarkdown(options: {
  title: string
  agentId: string
  task: Task
  projectName: string
  clientName: string
  execution: RepoExecutionResult
}): string {
  const { title, agentId, task, projectName, clientName, execution } = options
  const today = new Date().toISOString().split('T')[0]!
  const lines: string[] = [
    `# ${title}`,
    ``,
    `**Agent:** ${agentId}`,
    `**Client:** ${clientName}`,
    `**Project:** ${projectName}`,
    `**Date:** ${today}`,
    `**Source Task:** ${task.title}`,
    `**Repo:** ${execution.repoPath}`,
    `**Branch:** ${execution.branch ?? 'unknown'}`,
    ``,
    `---`,
    ``,
    `## Execution Summary`,
    ``,
    execution.summary,
    ``,
    `## Files`,
    ``,
    `**Planned files:** ${execution.plannedFiles.length > 0 ? execution.plannedFiles.join(', ') : 'none'}`,
    `**Resolved files:** ${execution.resolvedFiles.length > 0 ? execution.resolvedFiles.join(', ') : 'none'}`,
    `**Touched files:** ${execution.touchedFiles.length > 0 ? execution.touchedFiles.join(', ') : 'none'}`,
    `**Applied edits:** ${execution.appliedEditCount}`,
    ``,
    `## Commands`,
    ``,
  ]

  if (execution.commands.length === 0) {
    lines.push(`No typecheck/build/test commands were executed.`, ``)
  } else {
    lines.push(`| Check | Dir | Result | Notes |`, `|------|-----|--------|-------|`)
    for (const command of execution.commands) {
      lines.push(
        `| ${command.name} | ${command.relativeDir} | ${commandStatusIcon(command)} | ${command.summary.replace(/\n/g, ' ')} |`
      )
    }
    lines.push(``)
  }

  lines.push(`## Git Status`, ``)
  lines.push(`**Before:** ${execution.gitStatusBefore.length > 0 ? execution.gitStatusBefore.join(' | ') : 'clean'}`)
  lines.push(`**After:** ${execution.gitStatusAfter.length > 0 ? execution.gitStatusAfter.join(' | ') : 'clean'}`)
  lines.push(`**Diff files:** ${execution.diffFiles.length > 0 ? execution.diffFiles.join(', ') : 'none'}`)
  lines.push(``)

  if (execution.blockers.length > 0) {
    lines.push(`## Blocking Issues`, ``, ...execution.blockers.map((item) => `- ${item}`), ``)
  }

  if (execution.warnings.length > 0) {
    lines.push(`## Warnings`, ``, ...execution.warnings.map((item) => `- ${item}`), ``)
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// executeWorkspaceFileCreation
// Used when no git repo is configured (e.g. static HTML/CSS projects).
// The LLM generates actual file contents and we write them to
// workspace/{client}/{project}/output/.
// ---------------------------------------------------------------------------

interface WorkspaceFileItem {
  path: string
  content: string
}

interface WorkspaceCreationPlan {
  summary: string
  warnings: string[]
  blockers: string[]
  files: WorkspaceFileItem[]
}

// Parse marker-based format — avoids JSON escaping issues with large file contents:
//
//   === SUMMARY ===
//   <one-liner>
//
//   === FILE: index.html ===
//   <full file content>
//
//   === FILE: style.css ===
//   <full file content>
//
function parseWorkspaceCreationPlan(raw: string): WorkspaceCreationPlan {
  const files: WorkspaceFileItem[] = []
  let summary = ''
  const warnings: string[] = []

  // Extract summary
  const summaryMatch = raw.match(/===\s*SUMMARY\s*===\s*\n([\s\S]*?)(?===\s*FILE:|$)/)
  if (summaryMatch?.[1]) {
    summary = summaryMatch[1].trim()
  }

  // Extract each FILE block
  const filePattern = /===\s*FILE:\s*([^\s=]+)\s*===\s*\n([\s\S]*?)(?====\s*(?:FILE:|SUMMARY|WARNING)|$)/g
  let match: RegExpExecArray | null
  while ((match = filePattern.exec(raw)) !== null) {
    const path = match[1]?.trim()
    const content = match[2]?.trimEnd() ?? ''
    if (path && content) {
      files.push({ path, content })
    }
  }

  // Extract optional warnings
  const warningMatch = raw.match(/===\s*WARNING\s*===\s*\n([\s\S]*?)(?====|$)/)
  if (warningMatch?.[1]) {
    warnings.push(warningMatch[1].trim())
  }

  if (!summary && files.length === 0) {
    warnings.push('Could not parse any files from LLM response')
  }

  return { summary: summary || 'Files generated', warnings, blockers: [], files }
}

export interface WorkspaceCreationResult {
  outputDir: string
  touchedFiles: string[]
  summary: string
  warnings: string[]
  blockers: string[]
}

// Load files already written in output/ (to support follow-up "modify" tasks)
async function loadExistingOutputFiles(
  outputDir: string
): Promise<{ name: string; content: string }[]> {
  if (!existsSync(outputDir)) return []

  const READABLE_EXTS = new Set(['.html', '.css', '.js', '.ts', '.py', '.json', '.yaml', '.yml', '.md', '.txt', '.sh'])
  const MAX_OUTPUT_FILE_BYTES = 60_000
  const MAX_TOTAL_OUTPUT_BYTES = 180_000

  const entries = await readdir(outputDir, { withFileTypes: true })
  const result: { name: string; content: string }[] = []
  let totalBytes = 0

  for (const entry of entries) {
    if (!entry.isFile()) continue
    const ext = entry.name.lastIndexOf('.') >= 0 ? entry.name.slice(entry.name.lastIndexOf('.')) : ''
    if (!READABLE_EXTS.has(ext)) continue

    const absPath = join(outputDir, entry.name)
    try {
      const raw = await readFile(absPath, 'utf-8')
      const bytes = Buffer.byteLength(raw, 'utf-8')
      if (bytes > MAX_OUTPUT_FILE_BYTES) continue
      if (totalBytes + bytes > MAX_TOTAL_OUTPUT_BYTES) break
      totalBytes += bytes
      result.push({ name: entry.name, content: raw })
    } catch {
      // skip unreadable files
    }
  }

  return result
}

export async function executeWorkspaceFileCreation(options: {
  agentId: string
  task: Task
  taskType: TaskType
  workspaceAbsPath: string
  projectName: string
  clientName: string
  projectType?: string
  taskDescription: string
  implementationTitle: string
  implementationSummary: string
  implementationApproach: string
  filesToCreate: string[]
  architecturePlanContent?: string
  additionalContext?: string[]
  workspaceContext?: string
}): Promise<WorkspaceCreationResult> {
  const {
    agentId,
    task,
    taskType,
    workspaceAbsPath,
    projectName,
    clientName,
    projectType,
    taskDescription,
    implementationTitle,
    implementationSummary,
    implementationApproach,
    filesToCreate,
    architecturePlanContent,
    additionalContext = [],
    workspaceContext = '',
  } = options

  const outputDir = join(workspaceAbsPath, 'output')
  await mkdir(outputDir, { recursive: true })

  // Check for existing output files — if found, switch to "modify/extend" mode
  const existingOutputFiles = await loadExistingOutputFiles(outputDir)
  const isModifyMode = existingOutputFiles.length > 0

  const existingFilesSection = isModifyMode
    ? existingOutputFiles
        .map((f) => `=== EXISTING FILE: ${f.name} ===\n${f.content}`)
        .join('\n\n')
    : ''

  const systemPrompt = isModifyMode
    ? `You are ${agentId}, a software delivery agent inside WAI (Wawen Autonomous Industries).
EXISTING FILES are already present in the project output directory (provided below).
Your task: READ them carefully and MODIFY or EXTEND them to fulfil the new request.
You must output ALL files — both the ones you changed AND the ones you kept unchanged.

Output format — use EXACTLY this marker-based format (do NOT use JSON, do NOT use markdown code fences):

=== SUMMARY ===
<brief description of what was changed/added>

=== FILE: <filename> ===
<full file content — raw, no escaping>

=== FILE: <filename> ===
<full file content — raw, no escaping>

Rules:
- Output EVERY file that should exist after your changes (include unchanged files too).
- Modify only what the task requires. Preserve unrelated content.
- Write COMPLETE files. No placeholders, no "// TODO".
- Files will overwrite the existing ones on disk — output the complete final content.
- Use real content matching the client and project.
- Do NOT wrap content in JSON. Do NOT use markdown code fences. Raw text only.`
    : `You are ${agentId}, a software delivery agent inside WAI (Wawen Autonomous Industries).
Your task: generate the COMPLETE, REAL file contents for the deliverable described below.
You are writing ACTUAL files that will be saved to disk — not plans, not summaries.

Output format — use EXACTLY this marker-based format (do NOT use JSON, do NOT use markdown code fences):

=== SUMMARY ===
<brief description of what was created>

=== FILE: <filename> ===
<full file content — raw, no escaping>

=== FILE: <filename> ===
<full file content — raw, no escaping>

Rules:
- Decide yourself which files to create and how many, based on the project type and architecture plan.
- Write COMPLETE files. No placeholders, no "// TODO", no partial code.
- Files will be saved as-is to disk and must work immediately when opened.
- Use real content matching the client and project — no generic lorem ipsum unless no other info is available.
- Do NOT wrap content in JSON. Do NOT use markdown code fences. Raw text only.`

  const userMessage = [
    `Client: ${clientName}`,
    `Project: ${projectName}`,
    projectType ? `Project type: ${projectType}` : '',
    `Worker: ${agentId}`,
    `Task title: ${task.title}`,
    `Task description: ${taskDescription}`,
    `Implementation title: ${implementationTitle}`,
    `Implementation summary: ${implementationSummary}`,
    `Implementation approach: ${implementationApproach}`,
    filesToCreate.length > 0 ? `Files to create/modify: ${filesToCreate.join(', ')}` : '',
    architecturePlanContent ? `\nArchitecture Plan:\n${architecturePlanContent.slice(0, 8000)}` : '',
    workspaceContext ? `\nWorkspace context (existing deliverables/brief):\n${workspaceContext.slice(0, 4000)}` : '',
    additionalContext.length > 0 ? `\nAdditional context:\n${additionalContext.join('\n')}` : '',
    isModifyMode
      ? `\n\nEXISTING OUTPUT FILES (modify/extend these):\n${existingFilesSection.slice(0, 40000)}`
      : '',
    isModifyMode
      ? `\nNow output the complete modified/extended file set. Keep unchanged files intact, modify what's needed for the task.`
      : `\nNow generate the complete file contents. Write real, working, production-quality code.`,
  ].filter(Boolean).join('\n')

  const result = await runAgent(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    {
      agentId,
      taskId: task.id,
      taskType,
      requiresComplex: true,
      tools: ['file_system'],
      timeoutMs: 360_000, // 6 min — file generation produces large output
      captureMemory: false,
    }
  )

  const plan = parseWorkspaceCreationPlan(result.content)

  const touchedFiles: string[] = []
  const blockers: string[] = [...plan.blockers]

  // In modify mode allow more files (existing + new additions)
  const MAX_FILES = isModifyMode ? 20 : 12
  for (const file of plan.files.slice(0, MAX_FILES)) {
    const safePath = file.path.replace(/\.\./g, '').replace(/^\//, '')
    if (!safePath) continue

    const absPath = join(outputDir, safePath)
    // Prevent path traversal
    if (!absPath.startsWith(outputDir)) {
      blockers.push(`Refused path that escapes output dir: ${file.path}`)
      continue
    }

    try {
      await mkdir(dirname(absPath), { recursive: true })
      await writeFile(absPath, file.content, 'utf-8')
      touchedFiles.push(safePath)
    } catch (err) {
      plan.warnings.push(`Failed to write ${safePath}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const modeSuffix = isModifyMode ? ` [modify mode — ${existingOutputFiles.length} existing file(s) updated]` : ''

  return {
    outputDir,
    touchedFiles,
    summary: plan.summary + modeSuffix,
    warnings: plan.warnings,
    blockers,
  }
}

// ---------------------------------------------------------------------------
// initWorkspaceRepo
// Creates a fresh git repo inside workspace/{client}/{project}/repo/ when
// a project has no repo_local_path yet.  Returns the absolute repo path.
// ---------------------------------------------------------------------------

const GITIGNORE_BY_TYPE: Record<string, string> = {
  website: `# Website project
node_modules/
dist/
.cache/
.env
.env.local
*.log
.DS_Store
`,
  app: `# App project
node_modules/
dist/
build/
.cache/
.env
.env.local
*.log
.DS_Store
`,
  saas: `# SaaS project
node_modules/
dist/
build/
.turbo/
.cache/
.env
.env*.local
*.log
.DS_Store
`,
  automation: `# Automation / scripting project
__pycache__/
*.pyc
*.pyo
.venv/
venv/
node_modules/
dist/
.env
.env.local
*.log
.DS_Store
`,
  ai: `# AI project
__pycache__/
*.pyc
.venv/
venv/
node_modules/
.env
.env.local
models/
*.model
*.h5
*.log
.DS_Store
`,
}

const DEFAULT_GITIGNORE = `# WAI project
node_modules/
dist/
build/
.cache/
.env
.env.local
*.log
.DS_Store
`

function gitignoreForType(projectType: string): string {
  return GITIGNORE_BY_TYPE[projectType] ?? DEFAULT_GITIGNORE
}

async function writeTypeAwareStubs(repoPath: string, projectName: string, projectType: string): Promise<void> {
  if (projectType === 'website') {
    await writeFile(
      join(repoPath, 'index.html'),
      `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="${projectName}" />
  <title>${projectName}</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>

  <script src="script.js"></script>
</body>
</html>
`,
      'utf-8'
    )
    await writeFile(
      join(repoPath, 'style.css'),
      `/* ${projectName} – Styles */

/* Reset */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

/* Custom properties */
:root {
  --color-primary: #0066cc;
  --color-bg: #ffffff;
  --color-text: #1a1a1a;
  --font-sans: system-ui, -apple-system, sans-serif;
  --max-width: 1200px;
}

body {
  font-family: var(--font-sans);
  background-color: var(--color-bg);
  color: var(--color-text);
  line-height: 1.6;
}
`,
      'utf-8'
    )
    await writeFile(
      join(repoPath, 'script.js'),
      `// ${projectName} – Main script

document.addEventListener('DOMContentLoaded', () => {
  // Application logic here
})
`,
      'utf-8'
    )
    return
  }

  if (projectType === 'app' || projectType === 'saas') {
    await writeFile(
      join(repoPath, 'package.json'),
      JSON.stringify(
        {
          name: projectName.toLowerCase().replace(/\s+/g, '-'),
          version: '0.1.0',
          private: true,
          scripts: {
            dev: 'tsx watch src/index.ts',
            build: 'tsc --project tsconfig.json',
            typecheck: 'tsc --noEmit',
          },
          dependencies: {},
          devDependencies: {
            typescript: '^5.0.0',
            tsx: '^4.0.0',
          },
        },
        null,
        2
      ) + '\n',
      'utf-8'
    )
    await mkdir(join(repoPath, 'src'), { recursive: true })
    await writeFile(
      join(repoPath, 'src', 'index.ts'),
      `// ${projectName} – Entry point

export {}
`,
      'utf-8'
    )
    await writeFile(
      join(repoPath, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            strict: true,
            exactOptionalPropertyTypes: true,
            outDir: 'dist',
            rootDir: 'src',
            declaration: true,
            skipLibCheck: true,
          },
          include: ['src/**/*'],
          exclude: ['node_modules', 'dist'],
        },
        null,
        2
      ) + '\n',
      'utf-8'
    )
    return
  }

  if (projectType === 'marketing' || projectType === 'content') {
    await writeFile(
      join(repoPath, 'brief-template.md'),
      `# ${projectName} – Brief Template

## Obiettivo
<!-- Descrivi l'obiettivo principale del progetto -->

## Target audience
<!-- Chi è il pubblico di destinazione? -->

## Messaggi chiave
<!-- Quali sono i 3-5 messaggi principali da comunicare? -->

## Tono e stile
<!-- Formale / informale / tecnico / emozionale? -->

## Deliverable richiesti
<!-- Lista di output attesi -->

## Scadenze
<!-- Date importanti -->

## Note aggiuntive
<!-- Qualsiasi altra informazione rilevante -->
`,
      'utf-8'
    )
    return
  }
}

export interface WorkspaceRepoInitResult {
  repoPath: string
  alreadyExisted: boolean
  committed: boolean
  warnings: string[]
  repoUrl?: string
}

export async function initWorkspaceRepo(options: {
  workspaceAbsPath: string
  projectName: string
  projectType: string
  bootstrapCommand?: string
}): Promise<WorkspaceRepoInitResult> {
  const { workspaceAbsPath, projectName, projectType, bootstrapCommand } = options
  const repoPath = join(workspaceAbsPath, 'repo')
  const warnings: string[] = []

  // If repo already exists, just return it
  if (existsSync(join(repoPath, '.git'))) {
    return { repoPath, alreadyExisted: true, committed: false, warnings }
  }

  await mkdir(repoPath, { recursive: true })

  // git init -b main
  try {
    await runGit(repoPath, ['init', '-b', 'main'])
  } catch {
    // Older git versions don't support -b; fallback
    await runGit(repoPath, ['init'])
    try {
      await runGit(repoPath, ['checkout', '-b', 'main'])
    } catch {
      warnings.push('Could not rename default branch to main — using git default')
    }
  }

  // git config user (needed for commit)
  try {
    await runGit(repoPath, ['config', 'user.email', 'wai@wawen.io'])
    await runGit(repoPath, ['config', 'user.name', 'WAI Agent'])
  } catch {
    warnings.push('Could not set git config user — using system default')
  }

  // Write .gitignore
  const gitignorePath = join(repoPath, '.gitignore')
  await writeFile(gitignorePath, gitignoreForType(projectType), 'utf-8')

  // Write README.md
  const readmePath = join(repoPath, 'README.md')
  const today = new Date().toISOString().split('T')[0]!
  await writeFile(
    readmePath,
    `# ${projectName}\n\n> WAI (Wawen Autonomous Industries) — automated project scaffold\n> Created: ${today}\n`,
    'utf-8'
  )

  if (bootstrapCommand) {
    try {
      log.info({ repoPath, bootstrapCommand }, 'Executing bootstrap command')
      const [cmd, ...args] = bootstrapCommand.split(' ')
      await runCommand(cmd!, args, repoPath, 600_000)
    } catch (err) {
      warnings.push(
        `Bootstrap command failed: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  } else {
    // Write type-aware stub files
    await writeTypeAwareStubs(repoPath, projectName, projectType)
  }

  // Initial commit
  let committed = false
  try {
    await runGit(repoPath, ['add', '-A'])
    await runGit(repoPath, ['commit', '-m', 'chore: initial project scaffold'])
    committed = true
  } catch (err) {
    warnings.push(
      `Initial git commit failed: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  // Optionally create a GitHub remote repo and push initial commit
  let repoUrl: string | undefined
  if (committed && isGitHubConfigured()) {
    try {
      const ghRepo = await createGitHubRepo(projectName, { description: `WAI — ${projectName}` })
      const token = process.env['GITHUB_TOKEN']!.trim()
      const tokenizedUrl = `https://x-access-token:${token}@github.com/${ghRepo.fullName}.git`
      await runGit(repoPath, ['remote', 'add', 'origin', tokenizedUrl])
      await runGit(repoPath, ['push', '-u', 'origin', 'main'])
      repoUrl = ghRepo.htmlUrl
      log.info({ repoPath, repoUrl }, 'initWorkspaceRepo: GitHub remote created and initial commit pushed')
    } catch (err) {
      warnings.push(
        `GitHub remote setup failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  return {
    repoPath,
    alreadyExisted: false,
    committed,
    warnings,
    ...(repoUrl ? { repoUrl } : {}),
  }
}

export async function assessRepoForQa(options: {
  repoLocalPath?: string
  qaScope?: string[]
  task: Task
}): Promise<RepoQaAssessment | null> {
  const { repoLocalPath } = options
  void options.qaScope
  if (!repoLocalPath || !existsSync(repoLocalPath)) {
    return null
  }

  const inspection = await inspectRepo(repoLocalPath)
  const manifests = await discoverPackageManifests(repoLocalPath)
  const touchedFiles = await getDiffFiles(repoLocalPath)
  const checks = await runRepoChecks(repoLocalPath, manifests, touchedFiles, 'qa', 'support', options.task.id)

  const warnings = [...checks.warnings]
  const blockingIssues = [...checks.blockingIssues]

  if (inspection.gitStatusShort.length === 0 && touchedFiles.length === 0) {
    warnings.push('Repo has no detected changes relative to HEAD during QA review.')
  }

  return {
    repoPath: repoLocalPath,
    branch: inspection.branch,
    gitStatusShort: inspection.gitStatusShort,
    diffFiles: touchedFiles,
    commands: checks.commands,
    warnings,
    blockingIssues,
  }
}

export function renderRepoQaSummary(assessment: RepoQaAssessment): string {
  const lines: string[] = [
    `Repo path: ${assessment.repoPath}`,
    `Branch: ${assessment.branch ?? 'unknown'}`,
    `Git status: ${assessment.gitStatusShort.length > 0 ? assessment.gitStatusShort.join(' | ') : 'clean'}`,
    `Diff files: ${assessment.diffFiles.length > 0 ? assessment.diffFiles.join(', ') : 'none'}`,
    `Command results:`,
  ]

  if (assessment.commands.length === 0) {
    lines.push(`- No typecheck/build/test commands were executed.`)
  } else {
    for (const command of assessment.commands) {
      lines.push(
        `- ${command.name} @ ${command.relativeDir}: ${command.status.toUpperCase()} — ${command.summary}`
      )
    }
  }

  if (assessment.blockingIssues.length > 0) {
    lines.push(`Blocking issues:`)
    lines.push(...assessment.blockingIssues.map((item) => `- ${item}`))
  }

  if (assessment.warnings.length > 0) {
    lines.push(`Warnings:`)
    lines.push(...assessment.warnings.map((item) => `- ${item}`))
  }

  return lines.join('\n')
}
