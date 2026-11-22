import { MARK_OUTLINES, MARK_VIEW_BOX } from '@/components/ui/maiker-mark'

/** How long the mark takes to draw and fill before the window comes up; the keyframes in onboarding.css fit inside it. */
export const INTRO_MS = 1500
/** How long the still mark is held under reduced motion, where nothing draws. */
export const INTRO_STILL_MS = 600

/**
 * The Maiker mark drawing itself: the stroke in the text colour, then the fill by `fill-opacity`, then it rises away
 * once `gone`. Every animation runs once and ends; under reduced motion the mark is there whole from the start.
 */
export function IntroMark({ gone }: { gone: boolean }) {
  return (
    <svg className="mx-onb-mark" viewBox={MARK_VIEW_BOX} aria-hidden="true" data-gone={gone}>
      {MARK_OUTLINES.map((outline) => <path key={outline} d={outline} />)}
    </svg>
  )
}
