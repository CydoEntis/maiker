/**
 * How quotes travel inside a message. The daemon's send is text, so a quote is an ordinary Markdown blockquote with
 * one attribution line the agent can read as it is:
 *
 *     > Quote from Claude:
 *     > 1. Which branch should this target?
 *
 *     main, please.
 *
 * A message is a run of quotes and words, in order: a quote sits above the words that reply to it, and a quick reply
 * to several questions is several such pairs. `buildQuoteMessage` is the one place that writes the format and
 * `parseQuoteMessage` the one that reads it back, so a sent message shows stubs and not `>` lines. Only a block of the
 * exact shape counts: text that merely looks like a quote stays plain text.
 */

/** The most quotes one message carries, and the strip above the message box holds. */
export const MAX_QUOTES = 5

/** The longest quote the agent is sent, in characters: a selection can be a whole page, and the agent has the page. */
export const QUOTE_TEXT_LIMIT = 800
const WHO_LIMIT = 40
const ELLIPSIS = '…'
const FALLBACK_WHO = 'message'

/** Whose words a quote holds, and the words, as the strip and the stub show them. */
export type Quote = { readonly who: string; readonly text: string }

export type MessageSegment =
  | ({ readonly kind: 'quote' } & Quote)
  | { readonly kind: 'words'; readonly text: string }

const HEADER = /^> Quote from ([^\n:]{1,40}):$/
/** A line of the person's own words that reads as a header (or as an escaped one), so it must not turn into a quote. */
const HEADER_LOOKALIKE = /^(\\*)> Quote from [^\n:]{1,40}:$/
const ESCAPED_LOOKALIKE = /^\\(\\*> Quote from [^\n:]{1,40}:)$/

const normalised = (text: string) => text.replace(/\r\n/g, '\n')

/** A name that fits the header line: no line break or colon, and not longer than the parser reads. */
export function whoOf(name: string): string {
  const who = name.replace(/[\n:\s]+/g, ' ').trim().slice(0, WHO_LIMIT).trim()
  return who === '' ? FALLBACK_WHO : who
}

/** The quoted words as they are sent: blank lines at the ends dropped, the line ends made plain, a very long text cut. */
export function quotedText(text: string): string {
  const trimmed = normalised(text).replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '')
  return trimmed.length > QUOTE_TEXT_LIMIT ? `${trimmed.slice(0, QUOTE_TEXT_LIMIT).trimEnd()}${ELLIPSIS}` : trimmed
}

function quoteBlock({ who, text }: Quote): string {
  const lines = quotedText(text).split('\n').map((line) => (line.trim() === '' ? '>' : `> ${line.trimEnd()}`))
  return [`> Quote from ${whoOf(who)}:`, ...lines].join('\n')
}

function escapedWords(text: string): string {
  return normalised(text).split('\n').map((line) => (HEADER_LOOKALIKE.test(line) ? `\\${line}` : line)).join('\n')
}

/** The text of a message made of quotes and words, in order, with a blank line between them. A quote with no words is left out. */
export function buildQuoteMessage(segments: readonly MessageSegment[]): string {
  const parts: string[] = []
  for (const segment of segments) {
    if (segment.kind === 'quote') {
      if (quotedText(segment.text) !== '') parts.push(quoteBlock(segment))
    } else {
      const words = escapedWords(segment.text).replace(/^(?:[ \t]*\n)+/, '').trimEnd()
      if (words !== '') parts.push(words)
    }
  }
  return parts.join('\n\n')
}

/** The line that starts a quote: the header, at the start of the message or after a blank line, with a quoted line under it. */
function startsQuote(lines: readonly string[], at: number): boolean {
  const line = lines[at]
  return line !== undefined && HEADER.test(line) && (at === 0 || lines[at - 1]?.trim() === '') && (lines[at + 1]?.startsWith('>') ?? false)
}

const QUOTE_MARK = '> '
const unquoted = (line: string) => (line.startsWith(QUOTE_MARK) ? line.slice(QUOTE_MARK.length) : line.slice(1))

/**
 * A sent message as its quotes and words in order, or null when it holds no quote of the exact shape (the message is
 * then shown as it is).
 */
export function parseQuoteMessage(raw: string): MessageSegment[] | null {
  const lines = normalised(raw).split('\n')
  const segments: MessageSegment[] = []
  let words: string[] = []
  let found = false
  const flush = () => {
    const text = words.join('\n').replace(/^(?:[ \t]*\n)+/, '').trimEnd()
    if (text !== '') segments.push({ kind: 'words', text })
    words = []
  }
  let at = 0
  while (at < lines.length) {
    if (startsQuote(lines, at)) {
      flush()
      found = true
      let end = at + 1
      while (end < lines.length && lines[end]?.startsWith('>') === true) end += 1
      const who = HEADER.exec(lines[at] ?? '')?.[1] ?? FALLBACK_WHO
      segments.push({ kind: 'quote', who, text: lines.slice(at + 1, end).map(unquoted).join('\n') })
      at = end
      continue
    }
    const line = lines[at] ?? ''
    words.push(ESCAPED_LOOKALIKE.exec(line)?.[1] ?? line)
    at += 1
  }
  flush()
  return found ? segments : null
}

/** One line of a quote for a stub or a strip row: its words with the line breaks and runs of spaces made single, cut at `max`. */
export function excerptOf(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}${ELLIPSIS}` : line
}

/** Whether two quotes are the same words from the same speaker, so a second one is ignored. */
export function sameQuote(a: Quote, b: Quote): boolean {
  return a.who === b.who && a.text.replace(/\s+/g, ' ').trim() === b.text.replace(/\s+/g, ' ').trim()
}
