import { cn } from '@/lib/cn'
import type { PlaylistRun } from '@/lib/playlist/run'
import type { RunFailure } from '@/lib/playlist/types'
import { KeyGate } from './KeyGate'

/**
 * The build, made visible. The plan and the size of the dig are shown on
 * purpose — seeing which crates were pulled is half of trusting the result.
 */

const FAILURES: Record<RunFailure, { title: string; body: string }> = {
  no_key: { title: '', body: '' }, // handled separately — renders KeyGate
  no_data: {
    title: 'Empty shelves',
    body: 'Nothing is cached yet. Hit refresh while you are on the home network, then try again.',
  },
  offline: {
    title: 'No signal',
    body: 'Making a playlist needs the network. Saved ones still open fine.',
  },
  refused: {
    title: 'Declined',
    body: 'That request came back refused. Try describing the mood a different way.',
  },
  empty: {
    title: 'Nothing in the crates',
    body: 'No records matched that. Try something broader, or a different corner of the collection.',
  },
  bad_key: {
    title: 'Key rejected',
    body: 'Google turned the key down. Check it was copied whole, that the Generative Language API is enabled on that project, and that the key has no HTTP-referrer restriction blocking this site.',
  },
  bad_model: {
    title: 'No such model',
    body: 'That model is not available to this key. It may not have rolled out to your account yet.',
  },
  rate_limited: {
    title: 'Too many at once',
    body: 'The key hit its rate limit. Wait a moment and try again.',
  },
  busy: {
    title: 'The studio is packed',
    body: "The model is under load at Google's end — nothing wrong with your key or your connection. It was already retried a couple of times; give it a minute and go again.",
  },
  unknown: {
    title: 'Could not reach the studio',
    body: 'The request did not get through. Check the key and the connection, then try again.',
  },
}

const STEPS = [
  { stage: 'planning', label: 'Reading the brief' },
  { stage: 'digging', label: 'Pulling records' },
  { stage: 'sequencing', label: 'Setting the order' },
] as const

export function RunPanel({ run, onKeyChange }: { run: PlaylistRun; onKeyChange: () => void }) {
  const { stage, plan, found, failure } = run

  if (stage === 'failed' && failure === 'no_key') {
    return <KeyGate onSaved={onKeyChange} />
  }

  if (stage === 'failed' && failure) {
    const { title, body } = FAILURES[failure]
    return (
      <div className="flyer aged tilt-r mt-6 p-5">
        <h3 className="stamp-title text-[1.75rem] leading-[0.9]">{title}</h3>
        <p className="mt-2 text-sm text-ink-2">{body}</p>
        {/* The API's own words. Ugly, but this is a static site with no server
            logs — without it a failure is undiagnosable from the outside. */}
        {run.failureDetail && (
          <p className="mt-3 border-t-[1.5px] border-ink pt-2 font-mono text-[0.7rem] leading-snug text-ink-3">
            {run.failureDetail}
          </p>
        )}
        <button onClick={run.reset} className="btn-press mt-4 px-3 py-1.5 text-sm">
          Try again
        </button>
      </div>
    )
  }

  const active = STEPS.findIndex((s) => s.stage === stage)
  if (active === -1) return null

  return (
    <div className="flyer tilt-l mt-6 p-5">
      <p className="label text-riso-red mb-3">Digging</p>
      <ol className="space-y-2">
        {STEPS.map((step, i) => {
          const done = i < active
          const now = i === active
          return (
            <li
              key={step.stage}
              className={cn(
                'flex items-baseline gap-2 text-sm',
                done && 'text-ink-3',
                now && 'text-ink',
                !done && !now && 'text-ink-3 opacity-50',
              )}
            >
              <span className="label w-4">{done ? '✓' : now ? '•' : ''}</span>
              <span>
                {step.label}
                {now && '…'}
                {step.stage === 'digging' && done && ` — ${found} tracks`}
              </span>
            </li>
          )
        })}
      </ol>

      {plan && (
        <p className="mt-4 border-t-[1.5px] border-ink pt-3 text-xs text-ink-2">
          {plan.intent}
        </p>
      )}
    </div>
  )
}
