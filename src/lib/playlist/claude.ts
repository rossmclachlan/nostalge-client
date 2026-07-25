import type { JSONOutputFormat, TextBlockParam } from '@anthropic-ai/sdk/resources/messages'
import type { RunFailure } from './types'

/**
 * The only file that talks to the Anthropic API.
 *
 * The client is a static site on GitHub Pages, so there is no server to hold a
 * secret: the key is the user's own, typed into their own browser and kept in
 * localStorage. `dangerouslyAllowBrowser` is required — without it the SDK
 * constructor throws in a browser — and it is what makes the SDK send the
 * `anthropic-dangerous-direct-browser-access` header that unlocks CORS.
 *
 * If this ever needs to serve more than one person, point `callJson` at a small
 * proxy that holds the key instead. Nothing outside this file would change.
 *
 * The SDK is a large dependency, so it is imported dynamically: it stays out of
 * the precached app shell and only downloads when someone builds a playlist.
 */

const KEY = 'nostalge:anthropic-key:v1'

export const MODEL = 'claude-opus-5'

/** Thinking is on by default on this model; leaving it alone is deliberate. */
const MAX_TOKENS = 16_000

export function loadKey(): string {
  if (typeof localStorage === 'undefined') return ''
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveKey(key: string): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(KEY, key.trim())
  } catch {
    // Private mode / quota — the run will just report a missing key.
  }
}

export function clearKey(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}

export function hasKey(): boolean {
  return loadKey() !== ''
}

export type JsonResult =
  | { ok: true; data: unknown }
  | { ok: false; failure: RunFailure }

interface CallOptions {
  /** Stable across a session — carries the cache breakpoint. */
  system: string
  prompt: string
  schema: JSONOutputFormat['schema']
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
}

/**
 * One structured-output call. Never throws: every failure comes back as a
 * `RunFailure` the UI can render as a quiet card.
 */
export async function callJson({
  system,
  prompt,
  schema,
  effort,
}: CallOptions): Promise<JsonResult> {
  const apiKey = loadKey()
  if (!apiKey) return { ok: false, failure: 'no_key' }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, failure: 'offline' }
  }

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })

    // The whole system prompt is the cached prefix: it only changes when the
    // library re-syncs, so every later run in a session reads it back cheaply.
    const systemBlocks: TextBlockParam[] = [
      { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
    ]

    const message = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemBlocks,
      output_config: { effort, format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: prompt }],
    })

    // Check the stop reason before reading content — a refusal can carry an
    // empty content array.
    if (message.stop_reason === 'refusal') return { ok: false, failure: 'refused' }

    const text = message.content.find((b) => b.type === 'text')?.text
    if (!text) return { ok: false, failure: 'unknown' }

    if (import.meta.env.DEV) {
      const { cache_read_input_tokens: read, input_tokens: fresh } = message.usage
      console.debug(`[playlist] ${effort} · cache read ${read ?? 0} · fresh ${fresh}`)
    }

    return { ok: true, data: JSON.parse(text) as unknown }
  } catch {
    // Bad key, rate limit, dropped connection, malformed JSON — all the same
    // to the listener, and none of them should surface as a stack trace.
    return { ok: false, failure: 'unknown' }
  }
}
