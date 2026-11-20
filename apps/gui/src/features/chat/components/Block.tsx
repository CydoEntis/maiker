import type { HTMLAttributes, ReactNode } from 'react'
import { Icon } from '@/features/workspace/components/glyphs'

/**
 * The chat's block (design: command, diff and code blocks): a hairline box on the well with a 34px head that
 * opens and closes it. The corners come from the radius tokens, so a block never
 * sets its own. A failed one wears a 2px red edge; one a request waits on, an amber border.
 */
type BlockProps = Omit<HTMLAttributes<HTMLElement>, 'className'> & {
  failed?: boolean
  waiting?: boolean
  className?: string
  children: ReactNode
}

export function Block({ failed = false, waiting = false, className = '', children, ...rest }: BlockProps) {
  const state = `${failed ? ' is-failed' : ''}${waiting ? ' is-waiting' : ''}${className === '' ? '' : ` ${className}`}`
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
