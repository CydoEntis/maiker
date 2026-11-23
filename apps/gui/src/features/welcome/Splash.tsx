import { useEffect, useState } from 'react'
import { MARK_OUTLINES, MARK_VIEW_BOX } from '@/components/ui/maiker-mark'
import './splash.css'

/** The least time the splash stays, so the mark finishes drawing instead of flicking past; splash.css fits inside it. */
export const SPLASH_LEAST_MS = 900
/** The most it waits for the service: past this the app shows itself, and its own notice says the service is not there. */
export const SPLASH_MOST_MS = 4000
/** How long it fades out; `--t-slow` in material.css. */
export const SPLASH_OUT_MS = 260

/**
 * The start screen: the window's ground with the Maiker mark drawing itself, held until the session list first arrives
 * (`ready`), then faded away. It never takes focus and is hidden from screen readers; the app under it is already there.
 */
export function Splash({ ready, reducedMotion }: { ready: boolean; reducedMotion: boolean }) {
  const [gone, setGone] = useState(false)
  const [drawn, setDrawn] = useState(false)
  const [waitedOut, setWaitedOut] = useState(false)
  useEffect(() => {
    const draw = setTimeout(() => { setDrawn(true) }, reducedMotion ? 0 : SPLASH_LEAST_MS)
    const most = setTimeout(() => { setWaitedOut(true) }, SPLASH_MOST_MS)
    return () => { clearTimeout(draw); clearTimeout(most) }
  }, [reducedMotion])
  const leave = drawn && (ready || waitedOut)
  useEffect(() => {
    if (!leave) return
    const fade = setTimeout(() => { setGone(true) }, reducedMotion ? 0 : SPLASH_OUT_MS)
    return () => { clearTimeout(fade) }
  }, [leave, reducedMotion])
  if (gone) return null
  return (
    <div className="mx-splash" aria-hidden="true" data-leaving={leave}>
      <svg className="mx-splash-mark" viewBox={MARK_VIEW_BOX}>
        {MARK_OUTLINES.map((outline) => <path key={outline} d={outline} />)}
      </svg>
    </div>
  )
}
