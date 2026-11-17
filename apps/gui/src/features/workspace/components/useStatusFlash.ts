import { useLayoutEffect, useRef, type RefObject } from 'react'
import type { SessionStatus, SessionView } from '../model/session'

const FLASH_CLASS = 'is-flashing'

/**
 * A row whose status just changed is tinted with the accent for a moment, so the eye finds it where
 * it landed: in the status list it has just moved to another section. Rows are found by `data-flip`,
 * as `useFlip` finds them; the tint fades to whatever the row's own ground is, and nothing is tinted
 * when motion is reduced or on the first paint. The tint is an overlay (`.mx-row.is-flashing::after`, sidebar.css) that
 * fades by opacity alone: animating the row's own background and ring would repaint it at every frame.
 */
export function useStatusFlash(container: RefObject<HTMLElement | null>, sessions: readonly SessionView[], reduced: boolean): void {
  const previous = useRef(new Map<string, SessionStatus>())
  useLayoutEffect(() => {
    const was = previous.current
    previous.current = new Map(sessions.map((session) => [session.id, session.status]))
    const root = container.current
    if (root === null || reduced || was.size === 0) return
    const changed = new Set(sessions.filter((session) => was.has(session.id) && was.get(session.id) !== session.status).map((session) => session.id))
    if (changed.size === 0) return
    for (const wrap of Array.from(root.querySelectorAll<HTMLElement>('[data-flip]'))) {
      if (!changed.has(wrap.dataset.flip ?? '')) continue
      const row = wrap.querySelector<HTMLElement>('.mx-row')
      if (row === null) continue
      // A second change while the first still shows starts the fade again.
      row.classList.remove(FLASH_CLASS)
      // Reading the box makes the browser see the class gone, so adding it again restarts the animation.
      row.getBoundingClientRect()
      row.classList.add(FLASH_CLASS)
      row.addEventListener('animationend', () => { row.classList.remove(FLASH_CLASS) }, { once: true })
    }
  }, [container, sessions, reduced])
}
