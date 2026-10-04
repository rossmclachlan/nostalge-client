import { useEffect, useState } from 'react'
import { onAuthChange, signedInEmail } from './pb'

/**
 * The signed-in email, or '' when signed out. Re-renders on sign-in, sign-out
 * and when a sync finds the session has been revoked.
 */
export function useAuth(): string {
  const [email, setEmail] = useState(signedInEmail)
  useEffect(() => onAuthChange(() => setEmail(signedInEmail())), [])
  return email
}
