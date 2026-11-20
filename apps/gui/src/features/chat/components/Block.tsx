import type { HTMLAttributes, ReactNode } from 'react'
import { Icon } from '@/features/workspace/components/glyphs'

/**
 * The chat's block (design: command, diff and code blocks): a hairline box on the well with a 34px head that
 * opens and closes it. The corners come from the radius tokens, so a block never
 * sets its own. One a request waits on has an amber border; a failed one says so in its head's red words, never with an edge.
 */
type BlockProps = Omit<HTMLAttributes<HTMLElement>, 'className'> & {
  waiting?: boolean
  className?: string
  children: ReactNode
}

export function Block({ waiting = false, className = '', children, ...rest }: BlockProps) {
  const state = `${waiting ? ' is-waiting' : ''}${className === '' ? '' : ` ${className}`}`
  return <section data-fold="" className={`mx-block${state}`} {...rest}>{children}</section>
}

type BlockHeadProps = {
  open: boolean
  onToggle: () => void
  /** What the head says, to the right of the chevron. */
  children: ReactNode
  /** Buttons after the toggle (Copy, Open), outside it so a button never sits inside a button. */
  actions?: ReactNode
  title?: string
}

/** The head: a chevron that turns when the block is open, what the block is, and its actions. */
export function BlockHead({ open, onToggle, children, actions, title }: BlockHeadProps) {
  return (
    <div className={`mx-block-head${open ? ' is-open' : ''}`}>
      <button type="button" className="mx-block-toggle" aria-expanded={open} {...(title === undefined ? {} : { title })} onClick={onToggle}>
        <span className={`mx-caret-wrap${open ? ' is-open' : ''}`} aria-hidden="true"><Icon name="caret" /></span>
        {children}
      </button>
      {actions}
    </div>
  )
}
