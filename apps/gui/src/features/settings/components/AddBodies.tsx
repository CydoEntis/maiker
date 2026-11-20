import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { unreachableAdvice, unreachableKind } from '../model/unreachable'

/** A step's own room: a sentence, then its buttons, the main fix first. */
export function StepBody({ text, children }: { text: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <p className="m-0 text-xs text-(--fg2)">{text}</p>
      {children !== undefined && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

type NoAnswerProps = { message: string; host: string; port: number | null; onRetry: () => void; onEdit: () => void }

/** The machine could not be reached: the plain reasons (address, power, SSH port), ssh's own words behind Details, and the two ways on. */
export function NoAnswerBody({ message, host, port, onRetry, onEdit }: NoAnswerProps) {
  const kind = unreachableKind(message)
  return (
    <div className="flex flex-col gap-2.5">
      <StepBody text={kind === 'other' ? message : unreachableAdvice(kind, host, port)}>
        <Button variant="needs" autoFocus onClick={onRetry}>Try again</Button>
        <Button variant="soft" onClick={onEdit}>Edit the address</Button>
      </StepBody>
      {kind !== 'other' && (
        <details className="text-xs text-(--muted)">
          <summary className="cursor-pointer">Details</summary>
          <pre className="mt-1.5 mb-0 font-(family-name:--mono) whitespace-pre-wrap">{message}</pre>
        </details>
      )}
    </div>
  )
}

/** The helper being put on the machine: a bar that fills as the host reports each stage, and what is being copied. */
export function HelperProgressBody({ text, percent }: { text: string; percent: number | null }) {
  return (
    <div className="flex flex-col gap-2">
      <Progress label="Setting up the Maiker helper" {...(percent === null ? {} : { value: percent })} />
      <p className="m-0 text-xs text-(--muted)">{text}</p>
    </div>
  )
}
