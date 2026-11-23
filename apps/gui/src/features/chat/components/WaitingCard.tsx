import type { ReactNode } from 'react'
import { cardVariants } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type Props = {
  /** The card's accessible name. */
  label: string
  title: ReactNode
  /** Quiet words at the right of the head: the agent's name, "1 of 3", "Plan mode". */
  aside?: ReactNode
  children?: ReactNode
  /** The body has no padding of its own, for a well (a command, a menu) that sits flush in the card. */
  flush?: boolean
  /** The answers as a column (`AnswerList`), under the detail. */
  answers?: ReactNode
  /** Buttons that are not answers to pick between (Back and Next, Cancel, Show terminal), or a note where no answer can be sent. */
  foot?: ReactNode
  /** `neutral` is for a card the agent is not blocked on (the reply tray): the same card with a quiet mark instead of the amber `!`. */
  tone?: 'needs' | 'neutral'
}

/**
 * Something the agent is waiting on the person for, a card on the floating surface directly above the message box
 * (the design's needs-you card): a head with the one amber `!`, what is asked and who asks, the detail, and the
 * answers. The cards stack in the order they were asked, the agent's own question nearest the box.
 */
export function WaitingCard({ label, title, aside, children, flush = false, answers, foot, tone = 'needs' }: Props) {
  return (
    <section
      role={tone === 'neutral' ? 'group' : undefined}
      aria-label={label}
      data-float=""
      className={cn(cardVariants({ tone: 'none' }), 'mx-waiting', tone === 'neutral' && 'is-neutral')}
    >
      <div className="mx-waiting-head">
        <span className="mx-waiting-bang" aria-hidden="true">{tone === 'neutral' ? '↩' : '!'}</span>
        <span className="mx-waiting-title">{title}</span>
        <span className="mx-spacer" />
        {aside !== undefined && <span className="mx-waiting-aside">{aside}</span>}
      </div>
      {children !== undefined && children !== null && children !== false && <div className={flush ? 'mx-waiting-body is-flush' : 'mx-waiting-body'}>{children}</div>}
      {answers}
      {foot !== undefined && foot !== null && foot !== false && <div className="mx-waiting-foot">{foot}</div>}
    </section>
  )
}
