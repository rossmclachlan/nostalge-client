import { useState, useEffect } from 'react'
import { Download, X } from 'lucide-react'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (sessionStorage.getItem('install-dismissed')) {
      setDismissed(true)
      return
    }

    function handler(e: Event) {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }

    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  if (!deferredPrompt || dismissed) return null

  async function handleInstall() {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') {
      setDeferredPrompt(null)
    }
  }

  function handleDismiss() {
    setDismissed(true)
    sessionStorage.setItem('install-dismissed', '1')
  }

  return (
    <div className="fixed bottom-18 left-4 right-4 z-50 animate-in slide-in-from-bottom-4 duration-300 safe-bottom">
      <Alert className="border-primary/30 bg-card shadow-lg">
        <Download className="h-4 w-4 text-primary" />
        <AlertTitle className="flex items-center justify-between">
          <span>Install Nostalge</span>
          <Button variant="ghost" size="icon" className="h-6 w-6 -mr-1" onClick={handleDismiss}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-3">
          <span>Add to your home screen for the best experience.</span>
          <Button size="sm" className="shrink-0" onClick={handleInstall}>
            Install
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  )
}
