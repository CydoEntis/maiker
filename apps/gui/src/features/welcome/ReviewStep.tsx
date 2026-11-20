import type { Ref } from 'react'
import { Button } from '@/components/ui/button'
import { StepHead } from './StepHead'

export type ReviewRow = { key: string; label: string; value: string; mono?: boolean; onChange: () => void }

/** Step 5: what Maiker will start with, each line with a way back to change it. */
export function ReviewStep({ headingRef, rows }: { headingRef: Ref<HTMLHeadingElement>; rows: readonly ReviewRow[] }) {
  return (
    <>
      <StepHead headingRef={headingRef} title="You’re all set" lead="Here’s how Maiker will start. Everything can be changed later in Settings." />
      <ul aria-label="Your choices" className="m-0 flex list-none flex-col p-0 shadow-[inset_0_0_0_1px_var(--line)]">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-3 border-b border-(--line) px-3 py-2.5 last:border-b-0">
            <span className="w-32 flex-none text-xs text-(--dim)">{row.label}</span>
            <span className={row.mono === true ? 'min-w-0 flex-1 truncate font-(family-name:--mono) text-xs' : 'min-w-0 flex-1 truncate text-[13px]'}>{row.value}</span>
            <Button size="sm" variant="ghost" aria-label={`Change ${row.label.toLowerCase()}`} onClick={row.onChange}>Change</Button>
          </li>
        ))}
      </ul>
    </>
  )
}
