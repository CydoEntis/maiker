import { MARK_OUTLINES, MARK_VIEW_BOX } from '@/components/ui/maiker-mark'

/** How long the opening lasts before the setup window is up; the drawing's own keyframes (onboarding.css) fit inside it. */
export const OPENING_MS = 2300

/** The Maiker mark drawing itself: stroke in the text colour, then the fill, then it rises away once `gone`. */
export function OnboardingMark({ gone }: { gone: boolean }) {
  return (
    <svg className="mx-onb-mark" viewBox={MARK_VIEW_BOX} aria-hidden="true" data-gone={gone}>
      {MARK_OUTLINES.map((outline) => <path key={outline} d={outline} />)}
    </svg>
  )
}
