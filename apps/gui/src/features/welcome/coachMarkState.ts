import { useSyncExternalStore } from 'react'

/*
 * The side-panel tip that follows the first run. It is offered once per computer: the flag is stored when the tip
 * first shows, so closing the app with it up does not bring it back. Whether it is up now is kept here, outside the
 * workspace state, because the first run offers it and the title bar draws it and nothing else reads it.
 */

const KEY = 'maiker.gui.sidePanelTip.v1'

let showing = false
const listeners = new Set<() => void>()

function set(next: boolean): void {
  if (showing === next) return
  showing = next
  for (const listener of listeners) listener()
}

function seenBefore(): boolean {
  try {
    return localStorage.getItem(KEY) !== null
  } catch {
    // Storage is unavailable: a tip on every launch would be worse than none.
    return true
  }
}

/** Shows the tip, unless it was ever shown before. */
export function offerCoachMark(): void {
  if (seenBefore()) return
  try {
    localStorage.setItem(KEY, '1')
  } catch (error) {
    console.warn('Could not remember that the side panel tip was shown', error)
  }
  set(true)
}

export function dismissCoachMark(): void {
  set(false)
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Whether the tip is up. */
export function useCoachMark(): boolean {
  return useSyncExternalStore(subscribe, () => showing)
}
