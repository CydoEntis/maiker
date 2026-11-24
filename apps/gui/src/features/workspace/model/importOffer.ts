import { useEffect, useRef } from 'react'
import { importableChats } from '@/api/daemon'

const KEY = 'maiker.gui.import-offered.v1'

function offeredBefore(): boolean {
  try {
    return localStorage.getItem(KEY) !== null
  } catch {
    // Storage is unavailable (a private window): offering at every launch would be worse than never.
    return true
  }
}

function markOffered(): void {
  try {
    localStorage.setItem(KEY, '1')
  } catch (error) {
    console.warn('Could not remember that bringing in chats was offered', error)
  }
}

/**
 * Bring in your chats, offered once per install: when the window is first free (`free`: online, no dialog or welcome
 * up) and this computer holds Claude or Codex chats Maiker does not run. An older service, or a read that failed, is
 * asked again at the next launch; an empty list counts as offered.
 */
export function useImportOffer(free: boolean, open: () => void): void {
  const asked = useRef(false)
  useEffect(() => {
    if (!free || asked.current || offeredBefore()) return
    asked.current = true
    void (async () => {
      try {
        const list = await importableChats()
        if (list === null) return
        markOffered()
        if (list.length > 0) open()
      } catch (error) {
        console.warn('Could not look for chats to bring in', error)
      }
    })()
  }, [free, open])
}
