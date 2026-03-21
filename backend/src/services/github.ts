// ============================================================
// WAI – GitHub REST API client
// Wraps repo create, PR, and issue operations via REST API.
// Requires GITHUB_TOKEN + GITHUB_OWNER env vars.
// ============================================================

import { log } from './logger.js'

export interface GitHubRepoCreateResult {
  name: string
  fullName: string
  cloneUrl: string
  htmlUrl: string
  owner: string
  defaultBranch: string
}

export interface GitHubPrResult {
  number: number
  url: string
}

export interface GitHubIssueResult {
  number: number
  url: string
}

function getToken(): string | null {
  return process.env['GITHUB_TOKEN']?.trim() ?? null
}

function getOwner(): string | null {
  return process.env['GITHUB_OWNER']?.trim() ?? null
}

export function isGitHubConfigured(): boolean {
  return Boolean(getToken() && getOwner())
}

async function githubFetch<T>(path: string, init: RequestInit): Promise<T> {
  const token = getToken()
  if (!token) throw new Error('GITHUB_TOKEN not configured')

  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${text.slice(0, 300)}`)
  }

  return JSON.parse(text) as T
}

function sanitizeRepoName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100) || 'wai-project'
  )
}

interface GitHubApiRepo {
  name: string
  full_name: string
  clone_url: string
  html_url: string
  owner: { login: string }
  default_branch: string
}

export async function createGitHubRepo(
  projectName: string,
  options: { description?: string; isPrivate?: boolean } = {}
): Promise<GitHubRepoCreateResult> {
  const owner = getOwner()
  if (!owner) throw new Error('GITHUB_OWNER not configured')

  const repoName = sanitizeRepoName(projectName)

  const repo = await githubFetch<GitHubApiRepo>('/user/repos', {
    method: 'POST',
    body: JSON.stringify({
      name: repoName,
      description: options.description ?? `WAI — ${projectName}`,
      private: options.isPrivate ?? true,
      auto_init: false,
    }),
  })

  log.info({ repoName, htmlUrl: repo.html_url }, 'GitHub: repo created')

  return {
    name: repo.name,
    fullName: repo.full_name,
    cloneUrl: repo.clone_url,
    htmlUrl: repo.html_url,
    owner: repo.owner.login,
    defaultBranch: repo.default_branch,
  }
}

interface GitHubApiPr {
  number: number
  html_url: string
}

export async function createPullRequest(
  owner: string,
  repo: string,
  options: { title: string; body?: string; head: string; base?: string }
): Promise<GitHubPrResult> {
  const pr = await githubFetch<GitHubApiPr>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
    {
      method: 'POST',
      body: JSON.stringify({
        title: options.title,
        body: options.body ?? '',
        head: options.head,
        base: options.base ?? 'main',
      }),
    }
  )

  log.info({ owner, repo, prNumber: pr.number }, 'GitHub: PR created')

  return { number: pr.number, url: pr.html_url }
}

interface GitHubApiIssue {
  number: number
  html_url: string
}

export async function createIssue(
  owner: string,
  repo: string,
  options: { title: string; body?: string; labels?: string[] }
): Promise<GitHubIssueResult> {
  const issue = await githubFetch<GitHubApiIssue>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
    {
      method: 'POST',
      body: JSON.stringify({
        title: options.title,
        body: options.body ?? '',
        labels: options.labels ?? [],
      }),
    }
  )

  log.info({ owner, repo, issueNumber: issue.number }, 'GitHub: issue created')

  return { number: issue.number, url: issue.html_url }
}
