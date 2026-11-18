import { HOVER_CARD_DELAY_MS, placeHoverCard, type Box, type CardPlace } from './hoverCard'

/** How long the card stays mounted after the pointer leaves a row: entering another row within it shows the card at once. */
export const HOVER_CARD_WARM_MS = 250

export type HoverState = {
  /** The session the card is about and where it stands; null when no card is mounted. */
  target: { id: string; place: CardPlace } | null
  /** Shown, or kept mounted and hidden while it is warm. */
  open: boolean
  /** It came up from nothing, so it fades in; a warm card swaps its content and place without a fade. */
  cold: boolean
}

const CLOSED: HoverState = { target: null, open: false, cold: true }

type Timers = { set: (run: () => void, ms: number) => number; clear: (id: number) => void }
const BROWSER_TIMERS: Timers = { set: (run, ms) => window.setTimeout(run, ms), clear: (id) => { window.clearTimeout(id) } }

/**
 * The card beside a row the pointer rests on, as a small store outside React: a hover changes it, not the sidebar's
 * state, so the rows do not draw again for it. The first card waits `HOVER_CARD_DELAY_MS` under a resting pointer; after
 * it, moving to another row within `HOVER_CARD_WARM_MS` shows the card there at once, without the delay or the fade.
 * The card's place is worked out here once, from the row's box when it is shown.
 */
export class HoverController {
  private state: HoverState = CLOSED
  private readonly listeners = new Set<() => void>()
  private showTimer: number | null = null
  private warmTimer: number | null = null

  private readonly size: () => { width: number; height: number }
  private readonly timers: Timers

  constructor(
    size: () => { width: number; height: number } = () => ({ width: window.innerWidth, height: window.innerHeight }),
    timers: Timers = BROWSER_TIMERS,
  ) {
    this.size = size
    this.timers = timers
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot = (): HoverState => this.state

  /** The pointer or focus came to a row. `box` is read only when the card is shown. */
  enter(id: string, box: () => Box): void {
    this.cancelShow()
    if (this.state.target !== null) {
      // Warm: the card is still mounted (hidden or on another row), so it moves to this row now.
      this.cancelWarm()
      this.show(id, box(), false)
      return
    }
    this.showTimer = this.timers.set(() => {
      this.showTimer = null
      this.show(id, box(), true)
    }, HOVER_CARD_DELAY_MS)
  }

  /** The pointer left, a click, a menu or a scroll: hide the card now and unmount it when it has stayed warm long enough. */
  leave(): void {
    this.cancelShow()
    if (this.state.target === null || !this.state.open) return
    this.set({ ...this.state, open: false })
    this.cancelWarm()
    this.warmTimer = this.timers.set(() => {
      this.warmTimer = null
      this.set(CLOSED)
    }, HOVER_CARD_WARM_MS)
  }

  /** The owner went away: nothing may fire after it. */
  dispose(): void {
    this.cancelShow()
    this.cancelWarm()
    this.listeners.clear()
  }

  private show(id: string, box: Box, cold: boolean): void {
    const { width, height } = this.size()
    this.set({ target: { id, place: placeHoverCard(box, width, height) }, open: true, cold: this.state.target === null ? cold : this.state.cold })
  }

  private set(next: HoverState): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }

  private cancelShow(): void {
    if (this.showTimer !== null) this.timers.clear(this.showTimer)
    this.showTimer = null
  }

  private cancelWarm(): void {
    if (this.warmTimer !== null) this.timers.clear(this.warmTimer)
    this.warmTimer = null
  }
}
