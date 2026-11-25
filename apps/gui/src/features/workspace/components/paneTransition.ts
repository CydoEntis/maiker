import { flushSync } from 'react-dom'

type Transitions = { startViewTransition?: (update: () => void) => { finished: Promise<unknown> } }

// Only the tab showing: a tab kept mounted behind it has panes too, and they do not move.
const NAMED = '.mx-panes:not(.is-kept) .mx-pane[data-session-id]'
/** There has to be a pane on screen to glide: the first pane of an empty window just appears. */
const MIN_PANES = 1

const panesNow = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>(NAMED))

/** Names each pane after its session, so the browser can tell which pane went where. */
function namePanes(): HTMLElement[] {
  const panes = panesNow()
  for (const pane of panes) pane.style.viewTransitionName = `pane-${pane.dataset.sessionId ?? ''}`
  return panes
}

const reducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.querySelector('.mx-app[data-motion="reduced"]') !== null

/**
 * Runs a change that moves panes (a swap, a split, a pane opening or closing, maximize) so they glide to their new places and sizes. The browser snapshots the panes before and after,
 * so the text inside never reflows in between: only pictures of the panes slide. Without View Transitions, or with
 * Reduce motion on, the change just happens. It glides on Linux too, by request: a swap by drag was reported to take the window
 * down on Hyprland in 0.72.0, so if that comes back, this is the first place to look.
 */
export function movePanes(update: () => void): void {
  void placePanes(update)
}

/**
 * `movePanes` for a caller that goes on once the panes are in their new places: it resolves when the glide is over, or
 * at once when there is none. The browser runs a glide's change a frame later, so whatever the caller does next (say a
 * start it is done with) would otherwise land while the old window is still drawn.
 */
export function placePanes(update: () => void): Promise<void> {
  const doc = document as Document & Transitions
  if (typeof doc.startViewTransition !== 'function' || reducedMotion() || panesNow().length < MIN_PANES) {
    update()
    return Promise.resolve()
  }
  namePanes()
  const transition = doc.startViewTransition(() => {
    flushSync(update)
    namePanes()
  })
  return transition.finished.then(() => undefined).finally(() => {
    for (const pane of panesNow()) pane.style.removeProperty('view-transition-name')
  })
}
