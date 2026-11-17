import type { FactoryChat } from '../factoryChats'

type Props = {
  /** Chats in this project that already report runs; empty when none does. */
  others: readonly FactoryChat[]
  onOpenOther: (id: string) => void
  onOpenTickets: () => void
  onBack: () => void
}

/**
 * The Work view of a chat that runs no factory: where one already runs in this project, what a factory is to Maitty (any
 * workflow that takes `/factory run` and reports its runs), and how work reaches it (Tickets › Send to Factory). It
 * names no factory: Maitty knows none by name, and the person brings their own.
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
          <span className="mx-work-part-title">{others.length > 0 ? 'Or run one here' : 'No factory has run here yet'}</span>
          <span className="mx-work-text">A factory is any workflow that takes tickets with <code>/factory run</code> and reports its runs with <code>maitty workflow report</code>. Once one reports from this chat, its runs show here as a board.</span>
          <span className="mx-work-text">To hand it work, open Tickets, tick the tickets to build, and choose Send to Factory.</span>
          <button type="button" className="mx-work-button is-primary" onClick={onOpenTickets}>Open Tickets</button>
        </div>
      </div>
    </section>
  )
}
