import { ATTACHMENT_HEADER, parseAttachmentMessage } from './attachmentMessage'
import { excerptOf, parseQuoteMessage } from './quoteMessage'

/**
 * A sent message as one plain line for places that have no room for the whole of it (a row's hover card).
 * The tags a paste is wrapped in and the block that names attached files are transport, not words: the
 * tags go, and the block becomes a short note ("1 image"). The daemon clips a long message, so the block
 * can arrive cut off anywhere, even inside its own header.
 */

const PASTE_TAG = /<\/?pasted_content\b[^>]*>/g
/** Shortest cut of the header still taken for it, so a person's own "Att" is not eaten. */
const MIN_HEADER_CUT = 8

/** The words of a message without the tags a paste is wrapped in. */
export function withoutPasteTags(text: string): string {
  return text.replace(PASTE_TAG, '')
}

/** The text before an attachment block that was cut short, and how many files it still named. */
function splitClippedBlock(message: string): { words: string; files: number } {
  const at = message.lastIndexOf(ATTACHMENT_HEADER.slice(0, MIN_HEADER_CUT))
  if (at < 0) return { words: message, files: 0 }
  const block = message.slice(at)
  const header = block.slice(0, ATTACHMENT_HEADER.length)
  // Only a cut header, or the header with its paths, is the block; anything else the person typed stays.
  if (!ATTACHMENT_HEADER.startsWith(header) && !block.startsWith(ATTACHMENT_HEADER)) return { words: message, files: 0 }
  const files = block.split('\n').filter((line) => line.startsWith('- /') || /^- [A-Za-z]:[\\/]/.test(line)).length
  return { words: message.slice(0, at), files }
}

function filesNote(files: readonly { kind: string }[] | number): string {
  if (typeof files === 'number') return files === 0 ? '' : files === 1 ? '1 file' : `${String(files)} files`
  if (files.length === 0) return ''
  const images = files.filter((file) => file.kind === 'image').length
  if (images === files.length) return images === 1 ? '1 image' : `${String(images)} images`
  return files.length === 1 ? '1 file' : `${String(files.length)} files`
}

/** How much of a quote a one-line preview keeps. */
const QUOTE_PREVIEW = 60

/** A message's quotes and words as one line: each quote as its first words in curly quotes, then what was said. */
function withQuotesShort(text: string): string {
  const segments = parseQuoteMessage(text)
  if (segments === null) return text
  return segments.map((segment) => (segment.kind === 'quote' ? `“${excerptOf(segment.text, QUOTE_PREVIEW)}”` : segment.text)).join(' ')
}

export function messagePreview(raw: string): string {
  const message = raw.replace(/\r\n/g, '\n')
  const parsed = parseAttachmentMessage(message)
  const split = parsed === null ? splitClippedBlock(message) : { words: parsed.text, files: 0 }
  const words = withQuotesShort(withoutPasteTags(split.words)).replace(/\s+/g, ' ').trim()
  const note = parsed === null ? filesNote(split.files) : filesNote(parsed.files)
  return [words, note === '' ? '' : `[${note}]`].filter((part) => part !== '').join(' ')
}
