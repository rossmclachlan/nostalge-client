import { useState } from 'react'
import { signIn, signOut } from '@/lib/pb'
import { useAuth } from '@/lib/useAuth'

const MESSAGES = {
  rejected: "That email and password weren't accepted.",
  unreachable: "Couldn't reach the NAS. Try again from home or the tailnet.",
} as const

/**
 * Shown when the server answers but there's no usable session. The cached
 * library stays on screen below it; signing in just lets the next sync run.
 */
export function SignInGate({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<keyof typeof MESSAGES | null>(null)

  const ready = email.trim() !== '' && password !== '' && !busy

  const submit = async () => {
    if (!ready) return
    setBusy(true)
    setError(null)
    const result = await signIn(email, password)
    setBusy(false)
    if (result === 'ok') {
      setPassword('')
      onSignedIn()
    } else {
      setError(result)
    }
  }

  return (
    <form
      className="flyer aged tilt-l mx-auto mb-6 mt-2 max-w-sm p-5"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <p className="label text-riso-red mb-1">Members only</p>
      <h3 className="stamp-title text-[2rem] leading-[0.85]">Sign in</h3>
      <p className="mt-2 text-sm text-ink-2">
        The NAS answered, but it only shows the collection to signed-in
        listeners. What's already on this device stays put either way.
      </p>

      <label className="label mt-4 block text-ink-3" htmlFor="signin-email">
        Email
      </label>
      <input
        id="signin-email"
        type="email"
        autoComplete="username"
        spellCheck={false}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="mt-1 w-full border-[1.5px] border-ink bg-paper px-2 py-1.5 text-sm text-ink placeholder:text-ink-3 focus:outline-none"
      />

      <label className="label mt-3 block text-ink-3" htmlFor="signin-password">
        Password
      </label>
      <input
        id="signin-password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="mt-1 w-full border-[1.5px] border-ink bg-paper px-2 py-1.5 text-sm text-ink placeholder:text-ink-3 focus:outline-none"
      />

      {error && (
        <p role="alert" className="mt-3 text-sm text-riso-red">
          {MESSAGES[error]}
        </p>
      )}

      <button
        type="submit"
        disabled={!ready}
        className="btn-press mt-3 bg-riso-olive px-3 py-1.5 text-sm text-paper disabled:opacity-40"
      >
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}

/** "signed in as … · sign out", for the sync status panel. Renders nothing when signed out. */
export function SignedInAs() {
  const email = useAuth()
  if (email === '') return null
  return (
    <p className="label mt-2 text-ink-3">
      signed in as {email} ·{' '}
      <button onClick={signOut} className="underline underline-offset-2">
        sign out
      </button>
    </p>
  )
}
