import { copyText } from '@/lib/clipboard'
import { toast } from '@/lib/toast'
import { errorMessage } from '@/lib/error-message'
import type { FactoryChat } from '../factoryChats'

/** What a person types in a Claude chat to install Maiker Factory, one example of a factory Work shows. */
const FACTORY_INSTALL = ['/plugin marketplace add CydoEntis/maiker-factory', '/plugin install maiker@factory', '/factory setup'] as const

type Props = {
  /** Chats in this project that already report runs; empty when none does. */
  others: readonly FactoryChat[]
  onOpenOther: (id: string) => void
  onOpenTickets: () => void
  onBack: () => void
}

function copy(text: string): void {
  copyText(text).then(() => { toast.success('Copied') }, (error: unknown) => { toast.error(errorMessage(error, 'Could not copy')) })
}

/**
 * The Work view of a chat that runs no factory: where one already runs in this project, how to set one up (Maiker
 * Factory's three commands, each with Copy), and how work reaches it (Tickets › Send to Factory). Nothing here types
 * into the chat; the person runs the commands.
 */
export function WorkSetup({ others, onOpenOther, onOpenTickets, onBack }: Props) {
  return (
    <section className="mx-board" aria-label="Work">
      <div className="mx-board-bar">
        <span className="mx-board-title">Work</span>
        <span className="mx-board-summary">No factory runs in this chat</span>
        <span className="mx-spacer" />
        <button type="button" className="mx-work-button" onClick={onBack}>Back to the chat</button>
      </div>
      <div className="mx-work-setup">
        {others.length > 0 && (
          <div className="mx-work-part">
            <span className="mx-work-part-title">A factory already runs in this project</span>
            {others.map((other) => (
              <button key={other.id} type="button" className="mx-work-other" onClick={() => { onOpenOther(other.id) }}>
                <span className="mx-work-other-name">{other.label}</span><span className="mx-work-dim">{other.sub}</span><span className="mx-spacer" /><span className="mx-work-dim">Open Work ›</span>
              </button>
            ))}
          </div>
        )}
        <div className="mx-work-part">
          <span className="mx-work-part-title">Set up a software factory</span>
          <span className="mx-work-text">A factory takes tickets and works each one through its steps. Work shows its runs here as a board. Maiker Factory is one; any workflow that reports with <code>maitty workflow report</code> shows the same way.</span>
          <ol className="mx-work-steps">
            <li><span className="mx-work-text">In a Claude chat of this project, type each of these:</span></li>
            {FACTORY_INSTALL.map((line) => (
              <li key={line} className="mx-work-command">
                <code>{line}</code>
                <button type="button" className="mx-work-button" aria-label={`Copy ${line}`} onClick={() => { copy(line) }}>Copy</button>
              </li>
            ))}
            <li><span className="mx-work-text">Then open Tickets, tick the tickets to build, and choose Send to Factory.</span></li>
          </ol>
          <button type="button" className="mx-work-button is-primary" onClick={onOpenTickets}>Open Tickets</button>
        </div>
      </div>
    </section>
  )
}
