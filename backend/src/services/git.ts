// ============================================================
// WAI – Git Service
// Defensive helpers for repo parsing, linking, cloning, and init.
// ============================================================

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export function tokenizeCommandArgs(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaping = false

  for (const char of input) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }

    if (char === '\\') {
      escaping = true
      continue
    }

    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (escaping) current += '\\'
  if (quote) {
    throw new Error('Unclosed quote in command arguments.')
  }
  if (current) tokens.push(current)

  return tokens
}

export function looksLikeRepoUrl(value: string): boolean {
  return /^(https?:\/\/|git@|ssh:\/\/)/i.test(value)
}

async function runGit(args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    })
    return stdout.trim()
  } catch (error) {
    const stderr =
      typeof error === 'object' && error !== null && 'stderr' in error
        ? String(error.stderr ?? '').trim()
        : ''
    const message =
      stderr ||
      (error instanceof Error ? error.message : 'Unknown git error')

    throw new Error(message)
  }
}

export async function isDirectoryEmpty(path: string): Promise<boolean> {
  if (!existsSync(path)) return true
  const entries = await readdir(path)
  return entries.length === 0
}

export async function resolveGitRepository(
  candidatePath: string
): Promise<{
  rootPath: string
  currentBranch: string | null
  originUrl: string | null
}> {
  const rootPath = await runGit(['-C', candidatePath, 'rev-parse', '--show-toplevel'])
  const currentBranch = await getGitCurrentBranch(rootPath)
  const originUrl = await getGitRemoteUrl(rootPath)

  return {
    rootPath,
    currentBranch,
    originUrl,
  }
}

export async function cloneGitRepository(
  repoUrl: string,
  targetPath: string,
  branch?: string
): Promise<{
  rootPath: string
  currentBranch: string | null
  originUrl: string | null
}> {
  await mkdir(dirname(targetPath), { recursive: true })

  const args = ['clone']
  if (branch) {
    args.push('--branch', branch, '--single-branch')
  }
  args.push(repoUrl, targetPath)

  await runGit(args)
  return resolveGitRepository(targetPath)
}

export async function initGitRepository(
  targetPath: string,
  branch?: string,
  remoteUrl?: string
): Promise<{
  rootPath: string
  currentBranch: string | null
  originUrl: string | null
}> {
  await mkdir(targetPath, { recursive: true })
  await runGit(['init', targetPath])

  if (branch) {
    await runGit(['-C', targetPath, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`])
  }

  if (remoteUrl) {
    await runGit(['-C', targetPath, 'remote', 'add', 'origin', remoteUrl])
  }

  return resolveGitRepository(targetPath)
}

export async function addGitRemoteOrigin(
  repoPath: string,
  remoteUrl: string
): Promise<void> {
  await runGit(['-C', repoPath, 'remote', 'add', 'origin', remoteUrl])
}

async function getGitCurrentBranch(repoPath: string): Promise<string | null> {
  try {
    const branch = await runGit(['-C', repoPath, 'symbolic-ref', '--short', 'HEAD'])
    return branch || null
  } catch {
    return null
  }
}

async function getGitRemoteUrl(repoPath: string): Promise<string | null> {
  try {
    const remoteUrl = await runGit(['-C', repoPath, 'remote', 'get-url', 'origin'])
    return remoteUrl || null
  } catch {
    return null
  }
}
