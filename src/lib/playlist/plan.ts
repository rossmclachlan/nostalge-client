import { callJson } from './gemini'
import { normalisePlan } from './normalise'
import { PLAN_SCHEMA } from './schema'
import { PLANNER_TASTE } from './taste'
import type { PlaylistPlan, RunFailure } from './types'

/** Stage one: the listener's sentence becomes a query over the collection. */
export async function planPlaylist(
  prompt: string,
  digest: string,
): Promise<{ ok: true; plan: PlaylistPlan } | { ok: false; failure: RunFailure }> {
  const result = await callJson({
    system: `${PLANNER_TASTE}\n\n${digest}`,
    prompt: `Build a query for this request:\n\n"${prompt}"`,
    schema: PLAN_SCHEMA,
    // Small, bounded output and the listener is waiting — this does not need
    // deep deliberation, and the curator does the taste work.
    effort: 'low',
  })

  if (!result.ok) return result
  return { ok: true, plan: normalisePlan(result.data) }
}
