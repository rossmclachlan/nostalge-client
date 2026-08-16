import type { RunFailure } from './types'

/**
 * The only file that talks to the model API.
 *
 * The client is a static site on GitHub Pages, so there is no server to hold a
 * secret: the key is the user's own, typed into their own browser and kept in
 * localStorage. The Google GenAI SDK ships a browser build (its `browser`
 * export condition), so no special opt-in is needed and the node-only
 * dependencies never reach the bundle.
 *
 * If this ever needs to serve more than one person, point `callJson` at a small
 * proxy that holds the key instead. Nothing outside this file would change.
 *
 * The SDK is imported dynamically so it stays out of the precached app shell
 * and only downloads when someone actually builds a playlist.
 */

const KEY = 'nostalge:gemini-key:v1'

/** Left behind by the Anthropic version of this feature. */
const LEGACY_KEY = 'nostalge:anthropic-key:v1'

export const MODEL = 'gemini-3.7-flash'

/** Bounded JSON out; generous so a long tracklist is never truncated. */
const MAX_OUTPUT_TOKENS = 8192

export function loadKey(): string {
  if (typeof localStorage === 'undefined') return ''
  try {
    // Don't leave a stale Anthropic key sitting in storage.
    localStorage.removeItem(LEGACY_KEY)
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
  /** `detail` is the API's own words — shown small under the failure card. */
  | { ok: false; failure: RunFailure; detail?: string }

/**
 * Turn whatever the SDK threw into something the listener can act on.
 *
 * The SDK's ApiError carries an HTTP status; anything else (a TypeError from a
 * blocked fetch, a JSON parse failure) falls through as unknown.
 */
/**
 * Statuses worth trying again. A busy model is the common one: `gemini-3.7-flash`
 * is new enough to hit capacity limits, and a run makes two calls — losing the
 * planning and the dig to a blip that would clear in a second is a bad trade.
 *
 * 429 is deliberately *not* here. A rate limit means slow down, and retrying
 * into it makes things worse; that one surfaces immediately.
 */
const RETRYABLE = new Set([500, 502, 503, 504])
const MAX_ATTEMPTS = 3

const statusOf = (err: unknown): number | undefined =>
  typeof err === 'object' && err !== null ? (err as { status?: number }).status : undefined

function classify(err: unknown): { failure: RunFailure; detail?: string } {
  const status = statusOf(err)
  const message = err instanceof Error ? err.message : String(err)

  // 400 covers both a malformed request and an invalid key; the message is the
  // only way to tell, and getting the key wrong is far more likely here.
  if (status === 400 && /api[ _]?key/i.test(message)) return { failure: 'bad_key', detail: message }
  if (status === 401 || status === 403) return { failure: 'bad_key', detail: message }
  if (status === 404) return { failure: 'bad_model', detail: message }
  if (status === 429) return { failure: 'rate_limited', detail: message }
  if (status !== undefined && RETRYABLE.has(status)) return { failure: 'busy', detail: message }
  return { failure: 'unknown', detail: message }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** How hard to let the model think. Maps to Gemini's thinking levels. */
export type Effort = 'minimal' | 'low' | 'medium' | 'high'

interface CallOptions {
  /** Stable across a session — sent as the system instruction. */
  system: string
  prompt: string
  /** Standard JSON Schema. Gemini supports type/enum/items/properties/
   *  required/additionalProperties/description, which is all we use. */
  schema: Record<string, unknown>
  effort: Effort
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
    // Pulled from the dynamic import so the enum doesn't drag the SDK into the
    // main bundle the way a top-level value import would.
    const { GoogleGenAI, ThinkingLevel } = await import('@google/genai')
    const ai = new GoogleGenAI({ apiKey })

    const LEVELS = {
      minimal: ThinkingLevel.MINIMAL,
      low: ThinkingLevel.LOW,
      medium: ThinkingLevel.MEDIUM,
      high: ThinkingLevel.HIGH,
    } as const

    const request = {
      model: MODEL,
      contents: prompt,
      config: {
        systemInstruction: system,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        // `responseJsonSchema` takes standard JSON Schema; `responseSchema`
        // must be omitted when it is set, and the mime type is required.
        responseMimeType: 'application/json',
        responseJsonSchema: schema,
        thinkingConfig: { thinkingLevel: LEVELS[effort] },
      },
    }

    // Ride out a busy model rather than losing the whole run to it. Backoff is
    // jittered so two stages of the same run don't retry in lockstep.
    let response
    for (let attempt = 1; ; attempt++) {
      try {
        response = await ai.models.generateContent(request)
        break
      } catch (err) {
        const status = statusOf(err)
        if (attempt >= MAX_ATTEMPTS || status === undefined || !RETRYABLE.has(status)) throw err
        const backoff = 700 * 2 ** (attempt - 1) + Math.random() * 300
        console.warn(`[playlist] ${status} from the model, retrying in ${Math.round(backoff)}ms`)
        await wait(backoff)
      }
    }

    // A blocked prompt or a safety stop yields no text rather than throwing.
    const blocked = response.promptFeedback?.blockReason
    if (blocked) return { ok: false, failure: 'refused' }

    const text = response.text
    if (!text) {
      const finish = response.candidates?.[0]?.finishReason
      // MAX_TOKENS here means the JSON was cut off mid-object.
      return { ok: false, failure: finish === 'SAFETY' ? 'refused' : 'unknown' }
    }

    if (import.meta.env.DEV) {
      const u = response.usageMetadata
      console.debug(
        `[playlist] ${effort} · in ${u?.promptTokenCount ?? 0}` +
          ` · cached ${u?.cachedContentTokenCount ?? 0}` +
          ` · out ${u?.candidatesTokenCount ?? 0}` +
          ` · thoughts ${u?.thoughtsTokenCount ?? 0}`,
      )
    }

    return { ok: true, data: JSON.parse(text) as unknown }
  } catch (err) {
    // Never rethrow — but never swallow silently either. The console line is
    // unconditional: this runs in a deployed static site with no server logs,
    // so it is the only way to see what actually happened.
    console.error('[playlist] request failed', err)
    return { ok: false, ...classify(err) }
  }
}
