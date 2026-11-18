/**
 * Links from one document to another. The chat's markdown reader keeps only web addresses, so a link to a
 * neighbouring `.md` file is handed to it as an address on a name that cannot be reached (`.invalid`), which it
 * draws as a link button; the viewer catches the click before the reader's own handler and opens the file in
 * itself. Nothing is ever fetched from that name.
 */
export const DOCUMENT_HOST = 'document.invalid'
// The target rides in the query: a path would have its `..` folded away by the address parser.
const PREFIX = `https://${DOCUMENT_HOST}/?to=`

/** A relative path to a markdown file, with an optional anchor or query: no scheme, not an anchor alone, not rooted. */
const DOCUMENT_TARGET = /^(?![a-z][a-z0-9+.-]*:)(?![#/\\])[^\s<>"()]+?\.(?:md|markdown|mdx)(?:[#?][^\s<>"()]*)?$/i
const LINK = /\]\(([^)\s]*)\)/g
const FENCE = /^\s{0,3}(```+|~~~+)/

/** `split` with a capture group puts the matches at the odd places. */
const CODE_PARTS = 2
const CODE_PART = 1

function routeLine(line: string): string {
  // Inline code is left as written: only the stretches between backtick runs hold links.
  return line.split(/(`+[^`]*`+)/).map((part, index) => (index % CODE_PARTS === CODE_PART ? part : part.replace(LINK, (whole, target: string) => (DOCUMENT_TARGET.test(target) ? `](${PREFIX}${encodeURIComponent(target)})` : whole)))).join('')
}

/** `source` with every link to a relative markdown file (outside code) turned into a document address. */
export function routeDocumentLinks(source: string): string {
  let fence: string | null = null
  return source.split('\n').map((line) => {
    const marker = FENCE.exec(line)?.[1]
    if (marker !== undefined) {
      if (fence === null) fence = marker
      else if (marker.startsWith(fence.charAt(0)) && marker.length >= fence.length) fence = null
      return line
    }
    return fence === null ? routeLine(line) : line
  }).join('\n')
}

/** The relative target a document address stands for, or null for any other address. */
export function documentTargetOf(href: string): string | null {
  if (!href.startsWith(PREFIX)) return null
  try {
    return decodeURIComponent(href.slice(PREFIX.length))
  } catch {
    return null
  }
}
