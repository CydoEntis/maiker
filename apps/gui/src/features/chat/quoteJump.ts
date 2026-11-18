import type { ChatRow } from './chatRows'
import { parseAttachmentMessage } from './attachmentMessage'
import { parseQuoteMessage } from './quoteMessage'
import { rowText } from './chatSearch'

/** Where the words of a quote came from, found again from the words: the quote is plain text, so nothing else names the message. */

/** The marks Markdown puts round words, which a selection of the drawn text does not carry. */
const MARKS = /[*_`#>]/g
const FIRST_WORDS = 48

const flat = (text: string) => text.replace(MARKS, '').replace(/\s+/g, ' ').trim().toLowerCase()

/** What a row says in its own words: a message the person sent without the quotes and files it carried, so a quote of a quote does not match its carrier. */
function sayingOf(row: ChatRow): string {
  const text = rowText(row)
  if (row.kind !== 'user' && row.kind !== 'echo') return text
  const words = parseAttachmentMessage(text)?.text ?? text
  const segments = parseQuoteMessage(words)
  return segments === null ? words : segments.flatMap((segment) => (segment.kind === 'words' ? [segment.text] : [])).join('\n')
}

/**
 * The key of the nearest row above `from` that holds the quoted words: all of them, else the words up to the first line
 * break, else the start of them. Null when no earlier row does (it was edited or is gone).
 */
export function quoteSourceRow(rows: readonly ChatRow[], text: string, from: string): string | null {
  const at = rows.findIndex((row) => row.key === from)
  const above = at < 0 ? rows : rows.slice(0, at)
  const wanted = [flat(text), flat(text.split('\n').find((line) => flat(line) !== '') ?? ''), flat(text).slice(0, FIRST_WORDS)]
  for (const needle of wanted) {
    if (needle === '') continue
    for (let index = above.length - 1; index >= 0; index -= 1) {
      const row = above[index]
      if (row !== undefined && flat(sayingOf(row)).includes(needle)) return row.key
    }
  }
  return null
}
