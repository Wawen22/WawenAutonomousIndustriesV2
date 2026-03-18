import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'

import { getModelForAgent } from '../config/models.js'
import { runAgent } from '../services/llm.js'
import { log, recordEvent, recordRun } from '../services/logger.js'
import type { Task, TaskType } from '../types/index.js'

const execFileAsync = promisify(execFile)

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
type RepoCommandName = 'install' | 'typecheck' | 'build' | 'test'
type RepoCommandStatus = 'passed' | 'failed' | 'skipped'

interface RepoEditPlan {
  summary: string
  warnings: string[]
  blockers: string[]
  edits: RepoEdit[]
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
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; durationMs: number }> {
  const startMs = Date.now()
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd,
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024 * 4,
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

    if (typeof parsed['summary'] !== 'string') {
      return null
    }

    return {
      summary: parsed['summary'],
      warnings: sanitizeStringArray(parsed['warnings']),
      blockers: sanitizeStringArray(parsed['blockers']),
      edits,
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
        if (existsSync(absolutePath)) {
          blockers.push(`Refused to create already existing file: ${relativePath}`)
          continue
        }

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

  try {
    const { stdout, stderr, durationMs } = await runCommand(
      command,
      args,
      cwd,
      name === 'test' ? 600_000 : 300_000
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
    const durationMs =
      typeof error === 'object' && error !== null && 'killed' in error
        ? 300_000
        : 0

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
        blockingIssues.push(`Dependency install failed in ${manifest.relativeDir}.`)
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
- If the repo context is insufficient, leave edits empty and explain blockers.`

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

  const editResult = await runAgent(
    [
      { role: 'system', content: editSystemPrompt },
      { role: 'user', content: editUserMessage },
    ],
    {
      agentId,
      taskId: task.id,
      taskType,
      requiresComplex: agentId === 'dev_general_1' || agentId === 'dev_saas_1',
      tools: ['file_system', 'shell'],
    }
  )

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
  ]
  const warnings = [
    ...filesBefore.warnings,
    ...parsedPlan.warnings,
    ...applyResult.warnings,
    ...checkResult.warnings,
  ]

  if (applyResult.touchedFiles.length === 0) {
    warnings.push('No repo files were changed during this execution step.')
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
    commands: checkResult.commands,
    gitStatusBefore,
    gitStatusAfter,
    diffFiles,
  }
}

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

export interface WorkspaceRepoInitResult {
  repoPath: string
  alreadyExisted: boolean
  committed: boolean
  warnings: string[]
}

export async function initWorkspaceRepo(options: {
  workspaceAbsPath: string
  projectName: string
  projectType: string
}): Promise<WorkspaceRepoInitResult> {
  const { workspaceAbsPath, projectName, projectType } = options
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

  return { repoPath, alreadyExisted: false, committed, warnings }
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
