/** Which files open as documents, and where a link inside one goes. Pure: nothing here touches a disk. */

const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdx'] as const

export function isMarkdownPath(path: string): boolean {
  const lower = path.toLowerCase()
  return MARKDOWN_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

/** The first readme among a folder's file names, or null. A markdown one wins over a bare `README`. */
export function readmeOf(names: readonly string[]): string | null {
  return names.find((name) => /^readme\.(md|markdown|mdx)$/i.test(name)) ?? null
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i

/**
 * The project path a link written in the document `from` points to, when it points at another markdown
 * file inside the project; null for anything else (a web address, an anchor, a file outside the
 * project, a file of another kind). A `#section` or `?query` after the path is dropped.
 */
export function resolveDocumentLink(from: string, target: string): string | null {
  const raw = target.trim()
  if (raw === '' || raw.startsWith('#') || raw.startsWith('/') || raw.startsWith('\\') || SCHEME.test(raw) || raw.includes('\\')) return null
  let decoded: string
  try {
    decoded = decodeURIComponent(raw.split('#')[0]?.split('?')[0] ?? '')
  } catch {
    return null
  }
  if (decoded === '' || decoded.includes('\0')) return null
  const parts = from.split('/').slice(0, -1)
  for (const part of decoded.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else {
      parts.push(part)
    }
  }
  const path = parts.join('/')
  return isMarkdownPath(path) && !path.split('/').includes('.git') ? path : null
}
