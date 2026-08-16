import { useState } from 'react'
import { clearKey, hasKey, saveKey } from '@/lib/playlist/gemini'

/**
 * Key entry. The client is a static site with no server to hold a secret, so
 * the listener's own key lives in their own browser's localStorage and goes
 * straight to the Gemini API.
 */
export function KeyGate({ onSaved }: { onSaved: () => void }) {
  const [value, setValue] = useState('')
  const stored = hasKey()

  const save = () => {
    if (value.trim() === '') return
    saveKey(value)
    setValue('')
    onSaved()
  }

  const forget = () => {
    clearKey()
    onSaved()
  }

  return (
    <div className="flyer aged tilt-l mx-auto mt-8 max-w-sm p-5">
      <p className="label text-riso-red mb-1">One-time setup</p>
      <h3 className="stamp-title text-[2rem] leading-[0.85]">
        {stored ? 'Change the key' : 'A Gemini key'}
      </h3>
      <p className="mt-2 text-sm text-ink-2">
        Playlist-making runs against the Gemini API. There is no server here to
        hold a key, so yours is kept in this browser only and sent straight to
        Google — never anywhere else.
      </p>

      <label className="label mt-4 block text-ink-3" htmlFor="anthropic-key">
        API key
      </label>
      <input
        id="anthropic-key"
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
        placeholder="AIza…"
        className="mt-1 w-full border-[1.5px] border-ink bg-paper px-2 py-1.5 text-sm text-ink placeholder:text-ink-3 focus:outline-none"
      />

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={save}
          disabled={value.trim() === ''}
          className="btn-press bg-riso-olive px-3 py-1.5 text-sm text-paper disabled:opacity-40"
        >
          Save
        </button>
        {stored && (
          <button onClick={forget} className="btn-press px-3 py-1.5 text-sm">
            Forget it
          </button>
        )}
      </div>

      <p className="mt-3 text-xs text-ink-3">
        Keys come from aistudio.google.com — an API key, billed separately from
        any Gemini subscription. Around 2¢ per playlist.
      </p>
    </div>
  )
}
