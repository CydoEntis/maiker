import { useContext } from 'react'
import { X } from 'lucide-react'
import { ChatActionsContext } from '../chatActions'
import { excerptOf, type Quote } from '../quoteMessage'
import type { DraftQuote } from '../composerStore'

/** How much of a quote one line shows; the line itself is cut by the layout, so this only keeps a very long text out of the page. */
const STUB_EXCERPT = 240
/** How much of a quote a remove button's name repeats. */
const NAME_EXCERPT = 40

/**
 * One quote above the words that reply to it, in a sent message: a 2px left edge, who it quotes, and one line of what
 * was said. Choosing it goes to the message it came from (and opens the folded block that holds it); where the chat
 * has nowhere to go (a helper's chat) it is only read.
 */
export function QuoteStub({ quote, from }: { quote: Quote; from: string }) {
  const actions = useContext(ChatActionsContext)
  const line = excerptOf(quote.text, STUB_EXCERPT)
  const body = (
    <>
      <span className="mx-quote-who">{quote.who}</span>
      <span className="mx-quote-line" dir="auto">{line}</span>
    </>
  )
  if (actions === null) return <div className="mx-quote-stub">{body}</div>
  return (
    <button type="button" className="mx-quote-stub" title="Go to the message this quotes" aria-label={`Quoted from ${quote.who}: ${line}. Go to it`} onClick={() => { actions.jump(quote.text, from) }}>{body}</button>
  )
}

/**
 * The strip above the message box: the words waiting to be quoted in the next message, a row each (who, one line), with
 * a × per row and Clear. Rows are the same height whatever they hold, so adding one only adds a row.
 */
export function QuoteStrip({ quotes, onRemove, onClear }: { quotes: readonly DraftQuote[]; onRemove: (id: string) => void; onClear: () => void }) {
  if (quotes.length === 0) return null
  return (
    <div className="mx-quote-strip" data-fold="" role="group" aria-label="Quotes for your next message">
      <ul className="mx-quote-list">
        {quotes.map((quote) => (
          <li key={quote.id} className="mx-quote-row">
            <span className="mx-quote-who">{quote.who}</span>
            <span className="mx-quote-line" dir="auto" title={quote.text}>{excerptOf(quote.text, STUB_EXCERPT)}</span>
            <button type="button" className="mx-quote-x" aria-label={`Remove the quote from ${quote.who}: ${excerptOf(quote.text, NAME_EXCERPT)}`} title="Remove this quote" onClick={() => { onRemove(quote.id) }}><X size={13} aria-hidden="true" /></button>
          </li>
        ))}
      </ul>
      {/* Its room is kept with one quote, so the second does not move the first. */}
      <button type="button" className={`mx-quote-clear${quotes.length > 1 ? '' : ' is-idle'}`} tabIndex={quotes.length > 1 ? 0 : -1} aria-hidden={quotes.length > 1 ? undefined : true} onClick={onClear}>Clear</button>
    </div>
  )
}
