const BASE_URL = process.env['PINCHTAB_BASE_URL']?.trim() || 'http://127.0.0.1:9867'
const TOKEN = process.env['PINCHTAB_TOKEN']?.trim() || ''

const HEALTH_TIMEOUT_MS = 800
const OP_TIMEOUT_MS = 30_000

export interface PinchTabResult {
  ok: boolean
  data?: unknown
  error?: string
}

function buildHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (TOKEN) h['Authorization'] = `Bearer ${TOKEN}`
  return h
}

async function ptFetch(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
  timeoutMs = OP_TIMEOUT_MS,
): Promise<PinchTabResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, timeoutMs)
  try {
    const url = BASE_URL + path
    const init: RequestInit = {
      method,
      headers: buildHeaders(),
      signal: controller.signal,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }
    const res = await fetch(url, init)
    const text = await res.text()
    let data: unknown
    try {
      data = text ? JSON.parse(text) : {}
    } catch {
      data = text // plain-text responses (e.g. /snapshot compact format)
    }
    if (!res.ok) return { ok: false, error: `HTTP ${String(res.status)}: ${res.statusText}`, data }
    return { ok: true, data }
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: name === 'AbortError' ? 'timeout' : msg }
  } finally {
    clearTimeout(timer)
  }
}

/** Returns true if PinchTab is reachable AND the default browser instance is ready. */
export async function isPinchTabAvailable(): Promise<boolean> {
  const result = await ptFetch('GET', '/health', undefined, HEALTH_TIMEOUT_MS)
  if (!result.ok) return false

  // Also verify the default browser instance is in a ready state.
  // The health endpoint returns { status: "ok", defaultInstance: { status: "ready"|"error"|... } }.
  // A non-ready instance causes all /navigate calls to return 503 "instance not ready".
  const data = result.data as Record<string, unknown>
  const instance = data?.['defaultInstance'] as Record<string, unknown> | undefined
  // Valid operational states: 'ready' or 'running'. Anything else (error, starting, stopping) means not usable.
  if (instance && typeof instance['status'] === 'string') {
    const s = instance['status']
    if (s !== 'ready' && s !== 'running') return false
  }

  return true
}

export async function browserNavigate(
  url: string,
  opts?: { timeout?: number; blockImages?: boolean; newTab?: boolean },
): Promise<PinchTabResult> {
  const body: Record<string, unknown> = { url }
  if (opts?.timeout !== undefined) body['timeout'] = opts.timeout
  if (opts?.blockImages !== undefined) body['blockImages'] = opts.blockImages
  if (opts?.newTab !== undefined) body['newTab'] = opts.newTab
  return ptFetch('POST', '/navigate', body)
}

export async function browserSnapshot(opts?: {
  filter?: 'interactive' | 'all'
  format?: 'json' | 'text' | 'compact'
  maxTokens?: number
}): Promise<PinchTabResult> {
  const params = new URLSearchParams()
  if (opts?.filter) params.set('filter', opts.filter)
  if (opts?.format) params.set('format', opts.format)
  if (opts?.maxTokens !== undefined) params.set('maxTokens', String(opts.maxTokens))
  const qs = params.toString()
  return ptFetch('GET', `/snapshot${qs ? `?${qs}` : ''}`)
}

// scrollY and waitNav are real PinchTab API fields (see PinchTab plugin cli.py lines 225-230)
export async function browserAction(
  kind: 'click' | 'type' | 'press' | 'fill' | 'hover' | 'select' | 'scroll',
  opts: { ref?: string; text?: string; value?: string; key?: string; scrollY?: number; waitNav?: boolean },
): Promise<PinchTabResult> {
  const body: Record<string, unknown> = { kind }
  if (opts.ref) body['ref'] = opts.ref
  if (opts.text !== undefined) body['text'] = opts.text
  if (opts.value !== undefined) body['value'] = opts.value
  if (opts.key) body['key'] = opts.key
  if (opts.scrollY !== undefined) body['scrollY'] = opts.scrollY
  if (opts.waitNav) body['waitNav'] = true
  return ptFetch('POST', '/action', body)
}

export async function browserText(opts?: { mode?: 'readability' | 'raw' }): Promise<PinchTabResult> {
  const qs = opts?.mode ? `?mode=${opts.mode}` : ''
  return ptFetch('GET', `/text${qs}`)
}

export async function browserScreenshot(): Promise<PinchTabResult> {
  return ptFetch('GET', '/screenshot')
}
