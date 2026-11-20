import type { Ref } from 'react'

export const HEADING_ID = 'mx-onb-h'

/** The title and lead of a setup step. The title takes focus when the step opens, so a screen reader starts at the top. */
export function StepHead({ title, lead, headingRef }: { title: string; lead: string; headingRef: Ref<HTMLHeadingElement> }) {
  return (
    <div>
      <h2 id={HEADING_ID} tabIndex={-1} ref={headingRef} className="m-0 text-[22px] leading-tight font-semibold tracking-tight outline-none">{title}</h2>
      <p className="mt-1.5 mb-0 max-w-[60ch] text-sm leading-relaxed text-pretty text-(--fg2)">{lead}</p>
    </div>
  )
}
