import { useCallback, useState } from 'react'
import { asksFirst, type ConfirmAsk, type ConfirmKind, type SkippedConfirms } from './confirm'

/** Asks `ask` and runs `run` on a yes, or runs it at once when the person said not to be asked about this kind again. */
export type Confirm = (ask: ConfirmAsk, run: () => void) => void

/** The question on screen, for `ConfirmDialog`; null while nothing is asked. */
export type PendingConfirm = {
  ask: ConfirmAsk
  /** The person's answer. `dontAskAgain` counts only with a yes: a cancelled question is asked again. */
  answer: (confirmed: boolean, dontAskAgain: boolean) => void
}

/**
 * One confirm for its owner: `confirm` to ask, `pending` to draw. `skipped` and `onSkip` are the remembered choice, kept
 * by whoever holds the settings.
 */
export function useConfirm(skipped: SkippedConfirms, onSkip: (kind: ConfirmKind) => void): { confirm: Confirm; pending: PendingConfirm | null } {
  const [asking, setAsking] = useState<{ ask: ConfirmAsk; run: () => void } | null>(null)
  const confirm = useCallback<Confirm>((ask, run) => {
    if (asksFirst(skipped, ask.kind)) setAsking({ ask, run })
    else run()
  }, [skipped])
  const pending: PendingConfirm | null = asking === null ? null : {
    ask: asking.ask,
    answer: (confirmed, dontAskAgain) => {
      setAsking(null)
      if (!confirmed) return
      if (dontAskAgain) onSkip(asking.ask.kind)
      asking.run()
    },
  }
  return { confirm, pending }
}
