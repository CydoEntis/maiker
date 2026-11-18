/**
 * A file keeps the line endings it came with. The editor works on `\n` only (a textarea turns every
 * ending into one), so the text is made editable on the way in and put back on the way out.
 */

export type LineEnding = '\n' | '\r\n'

const CRLF = /\r\n/g
const LF_ONLY = /(?<!\r)\n/g

/** The ending most lines of `text` use; a text with no line break is `\n`. A tie goes to `\n`. */
export function dominantEnding(text: string): LineEnding {
  const crlf = text.match(CRLF)?.length ?? 0
  const lf = text.match(LF_ONLY)?.length ?? 0
  return crlf > lf ? '\r\n' : '\n'
}

/** `text` with every ending as `\n`: what the editor shows and edits. */
export function toEditable(text: string): string {
  return text.replace(CRLF, '\n')
}

/** `edited` (endings `\n`) written with `ending`. The trailing newline is whatever the edit left. */
export function toDisk(edited: string, ending: LineEnding): string {
  return ending === '\n' ? edited : edited.replace(/\n/g, '\r\n')
}
