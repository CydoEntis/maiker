import { useState } from 'react'
import { CopyDetails, FeedbackButton, ProblemLine } from '@/components/ui/feedback'
import { copyText } from '@/lib/clipboard'
import { errorMessage } from '@/lib/error-message'

/** The service's words for a chat it holds but will not continue until its agent is started again, as after a restart. */
const NEEDS_RESUME = /chat resume is disabled|history is incomplete/i
/** The service stopped the chat's agent because its saved past could not be read; starting it again may read it. */
const READ_FAILED = /saved conversation could not be read/i
/** The service refused the saved past for its length; no Reconnect can change that (`TOO_LONG` in the daemon). */
const TOO_LONG = /too long to open as a chat/i
const TOO_LONG_REASON = 'Its saved history is longer than Maiker can open as a chat (over 16 MB). Nothing was lost: the transcript is still on your computer and the agent’s own record is intact. Open this session in the agent’s terminal to carry on, or start a new chat.'

/**
 * The chat's own read when it failed. A chat the service stopped continuing (its history out of step with the agent,
 * as after a service restart) says so plainly and offers Reconnect, which starts its agent again and has the service
 * read the past back; anything else shows the service's reason. Either way the raw words are one Copy details away.
 */
export function ReadProblemLine({ error, onReconnect }: { error: string; onReconnect: (() => Promise<void>) | null }) {
  const [running, setRunning] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const tooLong = TOO_LONG.test(error)
  const explained = NEEDS_RESUME.test(error)
  const resumable = !tooLong && onReconnect !== null && (explained || READ_FAILED.test(error))
  const reconnect = () => {
    if (onReconnect === null) return
    setRunning(true)
    setFailure(null)
    onReconnect()
      .catch((cause: unknown) => { setFailure(errorMessage(cause, 'The service did not say why.')) })
      .finally(() => { setRunning(false) })
  }
  const reason = failure !== null
    ? `Reconnecting failed: ${failure}`
    : tooLong ? TOO_LONG_REASON
    : explained && resumable ? 'Maiker lost its place in this chat, usually because the service restarted. Reconnect reads it back from the agent’s own record.' : error
  return (
    <ProblemLine
      tone="error"
      running={running}
      title={running ? 'Reconnecting…' : tooLong ? 'This chat is too long to open' : explained && resumable ? 'This chat needs to reconnect' : 'Could not read this chat'}
      reason={reason}
      actions={(
        <>
          {resumable && <FeedbackButton kind="primary" onClick={reconnect}>Reconnect</FeedbackButton>}
          <CopyDetails text={failure === null ? error : `${error}\n${failure}`} copy={copyText} className="mx-fb-end" />
        </>
      )}
    />
  )
}
