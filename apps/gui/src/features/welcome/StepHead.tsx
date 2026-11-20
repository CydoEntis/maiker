import type { Ref } from 'react'

export const HEADING_ID = 'mx-onb-h'

/** The title and lead of a setup step. The title takes focus when the step opens, so a screen reader starts at the top. */
export function StepHead({ title, lead, headingRef }: { title: string; lead: string; headingRef: Ref<HTMLHeadingElement> }) {
  return (
    <div className="flex flex-col gap-2.5">
      <h2 id={HEADING_ID} tabIndex={-1} ref={headingRef} className="m-0 text-[22px] leading-tight font-semibold tracking-tight outline-none">{title}</h2>
      <p className="m-0 max-w-[60ch] text-sm leading-normal text-pretty text-(--muted)">{lead}</p>
    </div>
  )
}
