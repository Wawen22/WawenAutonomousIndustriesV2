import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import { promisify } from 'node:util'
import { log } from './logger.js'

const execFileAsync = promisify(execFile)

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  '.vercel',
  '.netlify',
  '.next',
  '.turbo',
  'coverage',
])

interface RepoFile {
  relativePath: string
  absolutePath: string
  content: Buffer
}

export interface GitPushResult {
  ok: boolean
  error?: string
}

async function runGit(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
    })
    return stdout.trim()
  } catch (error) {
    const stderr =
      typeof error === 'object' && error !== null && 'stderr' in error
        ? String(error.stderr ?? '').trim()
        : ''
    throw new Error(stderr || (error instanceof Error ? error.message : 'Unknown git error'))
  }
}

function parseGitHubOwnerRepo(remoteUrl: string): string | null {
  const normalized = remoteUrl.trim().replace(/\.git$/, '')
  const httpsMatch = normalized.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)$/i)
  if (httpsMatch?.[1]) return httpsMatch[1]

  const sshMatch = normalized.match(/^git@github\.com:([^/]+\/[^/]+)$/i)
  if (sshMatch?.[1]) return sshMatch[1]

  return null
}

function sanitizeProjectName(projectName: string): string {
  return projectName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'wai-project'
}

function shouldIgnorePath(pathName: string): boolean {
  return pathName.split('/').some((segment) => IGNORED_DIRS.has(segment))
}

async function collectRepoFiles(rootPath: string, currentPath: string = rootPath): Promise<RepoFile[]> {
  const entries = await readdir(currentPath, { withFileTypes: true })
  const files: RepoFile[] = []

  for (const entry of entries) {
    const absolutePath = join(currentPath, entry.name)
    const repoRelativePath = relative(rootPath, absolutePath).replaceAll('\\', '/')
    if (shouldIgnorePath(repoRelativePath)) continue

    if (entry.isDirectory()) {
      files.push(...await collectRepoFiles(rootPath, absolutePath))
      continue
    }

    if (!entry.isFile()) continue

    files.push({
      relativePath: repoRelativePath,
      absolutePath,
      content: await readFile(absolutePath),
    })
  }

  return files
}

function shouldInlineAsUtf8(file: RepoFile): boolean {
  if (file.content.length === 0) return true
  return !file.content.includes(0)
}

function toVercelFile(file: RepoFile): { file: string; data: string; encoding?: 'base64' } {
  if (shouldInlineAsUtf8(file)) {
    return {
      file: file.relativePath,
      data: file.content.toString('utf-8'),
    }
  }

  return {
    file: file.relativePath,
    data: file.content.toString('base64'),
    encoding: 'base64',
  }
}

function sha1(buffer: Buffer): string {
  return createHash('sha1').update(buffer).digest('hex')
}

async function fetchJson<T>(input: string, init: RequestInit): Promise<T> {
  const response = await fetch(input, init)
  const text = await response.text()

  if (!response.ok) {
    throw new Error(text || `HTTP ${response.status}`)
  }

  return JSON.parse(text) as T
}

export async function pushToGitHub(repoLocalPath: string): Promise<GitPushResult> {
  const githubToken = process.env['GITHUB_TOKEN']?.trim()
  if (!githubToken) {
    const error = 'GITHUB_TOKEN not configured'
    log.warn({ repoLocalPath }, error)
    return { ok: false, error }
  }

  if (!existsSync(repoLocalPath)) {
    return { ok: false, error: `Repo path not found: ${repoLocalPath}` }
  }

  try {
    const remoteUrl = await runGit(['remote', 'get-url', 'origin'], repoLocalPath)
    const ownerRepo = parseGitHubOwnerRepo(remoteUrl)
    if (!ownerRepo) {
      return { ok: false, error: `Origin remote is not a GitHub URL: ${remoteUrl}` }
    }

    const tokenizedRemote = `https://x-access-token:${githubToken}@github.com/${ownerRepo}.git`
    await runGit(['remote', 'set-url', 'origin', tokenizedRemote], repoLocalPath)
    await runGit(['push', 'origin', 'main', '--force-with-lease'], repoLocalPath)
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown git push error'
    log.warn({ repoLocalPath, err: message }, 'Git push failed')
    return { ok: false, error: message }
  }
}

export async function deployToVercel(repoLocalPath: string, projectName: string): Promise<{ url: string } | null> {
  const vercelToken = process.env['VERCEL_TOKEN']?.trim()
  if (!vercelToken) {
    log.warn({ repoLocalPath }, 'VERCEL_TOKEN not configured — skipping Vercel deploy')
    return null
  }

  try {
    const files = await collectRepoFiles(repoLocalPath)
    const body = {
      name: sanitizeProjectName(projectName),
      files: files.map(toVercelFile),
      projectSettings: {},
      target: 'production',
    }

    const teamId = process.env['VERCEL_TEAM_ID']?.trim()
    const endpoint = new URL('https://api.vercel.com/v13/deployments')
    if (teamId) {
      endpoint.searchParams.set('teamId', teamId)
    }

    const response = await fetchJson<{ url?: string }>(endpoint.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${vercelToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.url) return null
    return {
      url: response.url.startsWith('http') ? response.url : `https://${response.url}`,
    }
  } catch (error) {
    log.warn(
      { repoLocalPath, projectName, err: error instanceof Error ? error.message : String(error) },
      'Vercel deploy failed'
    )
    return null
  }
}

interface NetlifySite {
  id: string
  name?: string
  ssl_url?: string
  url?: string
  deploy_url?: string
}

interface NetlifyDeploy {
  id: string
  url?: string
  ssl_url?: string
  deploy_url?: string
  deploy_ssl_url?: string
  required?: string[]
}

async function getOrCreateNetlifySite(token: string, projectName: string): Promise<NetlifySite> {
  const siteName = sanitizeProjectName(projectName)
  const sites = await fetchJson<NetlifySite[]>('https://api.netlify.com/api/v1/sites', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  const existing = sites.find((site) => site.name === siteName)
  if (existing) return existing

  return fetchJson<NetlifySite>('https://api.netlify.com/api/v1/sites', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: siteName }),
  })
}

export async function deployToNetlify(repoLocalPath: string, projectName: string): Promise<{ url: string } | null> {
  const netlifyToken = process.env['NETLIFY_TOKEN']?.trim()
  if (!netlifyToken) {
    log.warn({ repoLocalPath }, 'NETLIFY_TOKEN not configured — skipping Netlify deploy')
    return null
  }

  try {
    const site = await getOrCreateNetlifySite(netlifyToken, projectName)
    const files = await collectRepoFiles(repoLocalPath)
    const fileMap = Object.fromEntries(files.map((file) => [file.relativePath, sha1(file.content)]))

    const deploy = await fetchJson<NetlifyDeploy>(
      `https://api.netlify.com/api/v1/sites/${encodeURIComponent(site.id)}/deploys?title=${encodeURIComponent(basename(repoLocalPath))}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${netlifyToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          files: fileMap,
          async: true,
        }),
      },
    )

    const requiredPaths = Array.isArray(deploy.required) ? deploy.required : []
    const fileByRelativePath = new Map(files.map((file) => [file.relativePath, file]))

    for (const requiredPath of requiredPaths) {
      const file = fileByRelativePath.get(requiredPath)
      if (!file) continue

      const uploadUrl = new URL(
        `https://api.netlify.com/api/v1/deploys/${encodeURIComponent(deploy.id)}/files/${requiredPath
          .split('/')
          .map((segment) => encodeURIComponent(segment))
          .join('/')}`,
      )
      uploadUrl.searchParams.set('size', String(file.content.byteLength))

      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${netlifyToken}`,
          'Content-Type': 'application/octet-stream',
        },
        body: file.content as any,
      })

      if (!response.ok) {
        throw new Error(`Netlify file upload failed for ${requiredPath}: HTTP ${response.status}`)
      }
    }

    const url = deploy.deploy_ssl_url ?? deploy.ssl_url ?? deploy.deploy_url ?? deploy.url ?? site.ssl_url ?? site.deploy_url ?? site.url
    return url ? { url } : null
  } catch (error) {
    log.warn(
      { repoLocalPath, projectName, err: error instanceof Error ? error.message : String(error) },
      'Netlify deploy failed'
    )
    return null
  }
}
