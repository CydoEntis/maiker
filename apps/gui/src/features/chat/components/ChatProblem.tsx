import { useEffect, useState, type ReactNode } from 'react'
import { CopyDetails, FeedbackButton, ProblemLine, ScopedAlert } from '@/components/ui/feedback'
import { copyText } from '@/lib/clipboard'
import { useNow } from '@/lib/clock'
import { blocksChat, problemKey, problemWords, type ChatProblem } from '../problem'

/** How long a Restart or Try again shows the running light before the dialog asks again, if the problem has not gone. */
export const FIXING_GIVES_UP_MS = 20_000

type Fix = { label: string; running: string; run: () => void }

/** The one action that fixes a problem, and what the dialog says while it runs. */
function fixOf(problem: ChatProblem): Fix | null {
  switch (problem.kind) {
    case 'stopped': return problem.onRestart === null ? null : { label: 'Restart', running: `Restarting ${problem.agent}…`, run: problem.onRestart }
    case 'machine': return { label: 'Try again', running: `Reconnecting to ${problem.machine}…`, run: problem.onRetry }
    case 'interrupted': return { label: 'Restart', running: `Restarting ${problem.agent}…`, run: problem.onRestart }
    case 'context': return null
  }
}

/**
 * A chat's problem, said where it belongs: a stop (the agent exited, its machine went quiet, a restart cut its turn) as a
 * dialog over this chat only, which Not now turns into one line in the dock; a full context as that line from the start.
 * `alert` goes over the chat, `line` above everything else in the dock. Both are null when the chat has no problem.
 */
export function useChatProblem(problem: ChatProblem | null, summarize: () => string): { alert: ReactNode; line: ReactNode } {
  const now = useNow()
  const key = problem === null ? null : problemKey(problem)
  // The problem Not now put off, and the one whose fix is running: both by key, so a new problem is asked about afresh.
  const [putOff, setPutOff] = useState<string | null>(null)
  const [fixing, setFixing] = useState<string | null>(null)
  useEffect(() => {
    if (fixing === null) return undefined
    const timer = window.setTimeout(() => { setFixing(null) }, FIXING_GIVES_UP_MS)
    return () => { window.clearTimeout(timer) }
  }, [fixing])
  if (problem === null || key === null) return { alert: null, line: null }
  const words = problemWords(problem, now)
  const fix = fixOf(problem)
  const running = fixing === key
  const runFix = () => {
    if (fix === null) return
    setFixing(key)
    fix.run()
  }
  const copy = (large: boolean) => <CopyDetails text={words.details} copy={copyText} large={large} className="mx-fb-end" />

  if (!blocksChat(problem)) {
    const context = problem.kind === 'context' ? problem : null
    return {
      alert: null,
      line: (
        <ProblemLine
          tone="caution"
          title={words.title}
          reason={words.line}
          actions={context === null ? undefined : (
            <>
              <FeedbackButton kind="text" onClick={() => { context.onNewWithSummary(summarize()) }}>New session with summary</FeedbackButton>
              <FeedbackButton kind="primary" onClick={context.onCompact}>Compact</FeedbackButton>
            </>
          )}
        />
      ),
    }
  }

  if (putOff === key) {
    return {
      alert: null,
      line: (
        <ProblemLine
          tone="error"
          running={running}
          title={running && fix !== null ? fix.running : words.title}
          reason={words.line}
          actions={(
            <>
              {fix !== null && <FeedbackButton kind="primary" onClick={runFix}>{fix.label}</FeedbackButton>}
              {problem.kind === 'interrupted' && <FeedbackButton kind="text" onClick={problem.onDismiss}>Dismiss</FeedbackButton>}
              {copy(false)}
            </>
          )}
        />
      ),
    }
  }

  return {
    alert: (
      <ScopedAlert
        scope="chat"
        tone="error"
        running={running}
        title={running && fix !== null ? fix.running : words.title}
        reason={words.reason}
        onEscape={() => { setPutOff(key) }}
        actions={(
          <>
            {fix !== null && <FeedbackButton kind="primary" large onClick={runFix}>{fix.label}</FeedbackButton>}
            {problem.kind === 'stopped' && fix === null && <FeedbackButton kind="primary" large onClick={problem.onViewLog}>Show the terminal</FeedbackButton>}
            <FeedbackButton large onClick={() => { setPutOff(key) }}>Not now</FeedbackButton>
            {copy(true)}
          </>
        )}
      />
    ),
    line: null,
  }
}
