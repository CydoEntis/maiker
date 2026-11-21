import { Button } from '@/components/ui/button'
import { StepBody } from './AddBodies'
import { CopyLine } from './StatusBlock'

type Props = {
  /** The host's one sentence for why it could not sign in and what to do; the terminal app says the same. */
  message: string
  /** The command that sentence asks for, from the host (the platform's own key-copy line), when there is one. */
  command: string | null
  /** What ssh said about it, when it said anything. */
  said: string | null
  onCopy: (command: string) => void
  /** Goes through the checklist again from the top. */
  onTryAgain: () => void
}

/**
 * The machine would not sign this computer in. Maiker uses the person's normal ssh setup, so the step is the host's sentence, the
 * command it names to copy, and **Try again**. Nothing is run here and no password is asked for.
 */
export function KeyStep({ message, command, said, onCopy, onTryAgain }: Props) {
  return (
    <StepBody text={message}>
      {said !== null && said !== '' && <p className="m-0 w-full text-[13px] text-(--muted)">SSH said: {said}</p>}
      {command !== null && <CopyLine text={command} label="the command" onCopy={onCopy} />}
      <Button variant="needs" autoFocus onClick={onTryAgain}>Try again</Button>
    </StepBody>
  )
}
