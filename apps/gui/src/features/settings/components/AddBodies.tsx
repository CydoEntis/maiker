import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { unreachableAdvice, unreachableKind } from '../model/unreachable'

/** The amber room under a step that needs the person: the one fix, the main answer first. */
export function NeedsBox({ children }: { children: ReactNode }) {
  return (
    <div data-slot="needs-box" className="mt-1.5 flex flex-wrap items-center gap-2 rounded-(--r-panel) bg-[color-mix(in_oklab,var(--needs)_6%,transparent)] px-3.5 py-3 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--needs)_40%,transparent)]">
      {children}
    </div>
  )
}

/** A step's own room: a sentence, then (for a step that needs the person) the amber box with its buttons. */
export function StepBody({ text, children }: { text: ReactNode; children?: ReactNode }) {
  return (
    <>
      <p className="m-0 text-[12.5px] leading-normal text-(--muted)">{text}</p>
      {children !== undefined && <NeedsBox>{children}</NeedsBox>}
    </>
  )
}

type NoAnswerProps = { message: string; host: string; port: number | null; onRetry: () => void; onEdit: () => void }

/** The machine could not be reached: the plain reasons (address, power, SSH port), ssh's own words behind Details, and the two ways on. */
export function NoAnswerBody({ message, host, port, onRetry, onEdit }: NoAnswerProps) {
  const kind = unreachableKind(message)
  return (
    <>
      <StepBody text={kind === 'other' ? message : unreachableAdvice(kind, host, port)}>
        <Button variant="needs" autoFocus onClick={onRetry}>Try again</Button>
        <Button variant="outline" onClick={onEdit}>Edit the address</Button>
      </StepBody>
      {kind !== 'other' && (
        <details className="text-xs text-(--muted)">
          <summary className="cursor-pointer">Details</summary>
          <pre className="mt-1.5 mb-0 font-(family-name:--mono) whitespace-pre-wrap">{message}</pre>
        </details>
      )}
    </>
  )
}

/** The helper being put on the machine: what is being copied, then a bar that fills as the host reports each stage. */
export function HelperProgressBody({ text, percent }: { text: string; percent: number | null }) {
  return (
    <>
      <p className="m-0 text-[12.5px] leading-normal text-(--muted)">{text}</p>
      <Progress label="Setting up the Maiker helper" className="h-[3px] max-w-80 rounded-(--r-badge)" {...(percent === null ? {} : { value: percent })} />
    </>
  )
}
