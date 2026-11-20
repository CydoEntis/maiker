import { Button } from '@/components/ui/button'
import { keySetupCommand, signInBanWords } from '../model/keyCommand'
import { StepBody } from './AddBodies'
import { CopyLine } from './StatusBlock'

const IS_WINDOWS = /windows/i.test(typeof navigator === 'undefined' ? '' : navigator.userAgent)

type Props = {
  /** How the machine is reached (`user@host` or an alias). */
  target: string
  port: number | null
  /** What ssh said about it, when it said anything (refused, timed out, host identity). */
  said: string | null
  onCopy: (command: string) => void
  /** Goes through the checklist again from the top. */
  onTryAgain: () => void
}

/**
 * The machine would not sign this computer in. SSH is set up outside Maiker for now: Maiker uses the person's normal ssh setup, so
 * the step says so in one plain screen, offers the platform's one-line key-copy command to copy, and **Try again** goes through the
 * checklist again. Nothing is run here and no password is asked for.
 */
export function KeyStep({ target, port, said, onCopy, onTryAgain }: Props) {
  const command = keySetupCommand(target, port, IS_WINDOWS)
  const ban = said === null ? null : signInBanWords(said)
  return (
    <StepBody
      text={
        <>
          Maiker couldn't sign in to {target}. Maiker uses your normal SSH setup, so set it up first: in a terminal run <code>ssh {target}</code> and make sure it logs in without asking for a password (copy your key with ssh-copy-id, or on Windows run the one-line command below). Then try again.
        </>
      }
    >
      {ban !== null && <p className="m-0 w-full text-[13px] text-(--fg2)">{ban}</p>}
      {ban === null && said !== null && said !== '' && <p className="m-0 w-full text-[13px] text-(--muted)">SSH said: {said}</p>}
      {command !== null && <CopyLine text={command} label="the key-copy command" onCopy={onCopy} />}
      <Button variant="needs" autoFocus onClick={onTryAgain}>Try again</Button>
    </StepBody>
  )
}
