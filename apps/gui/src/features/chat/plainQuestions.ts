import { parseMarkdown, type Block, type Inline } from './markdown'

/**
 * The questions an agent asks in its ordinary message text, for quick replies. This is a reader of finished
 * Markdown, never of a message still being written, of the structured question card, or of the person's own words.
 * It is conservative on purpose: a missed question costs a click on the message box, a false one puts a Reply
 * button on a sentence that asked nothing. Headings, code, tables, quotes and diffs are never read.
 */

/** One question the agent asked, and where it stands in the message's blocks. */
export type Askable = {
  /** Stable for the same message text: the block, and the item in it (or the numbered part of a paragraph). */
  readonly key: string
  readonly block: number
  /** The index of the list item, or null for a paragraph (and for a numbered part of one). */
  readonly item: number | null
  /** The number or label the agent gave it ("1.", "Q3:", "a)"), or empty when it gave none. */
  readonly label: string
  /** The question without its label, as plain text. */
  readonly text: string
  /** It reads as a yes-or-no question, so Yes and No are offered. */
  readonly yesNo: boolean
}

/** The most questions read from one message. */
export const MAX_ASKABLES = 40
/** A paragraph longer than this is prose that happens to end in a question mark, not a question put to the person. */
const PARAGRAPH_LIMIT = 500
const MIN_WORDS = 2
/** A paragraph is read as a run of numbered questions when it numbers at least this many, one after the other. */
const MIN_INLINE_NUMBERED = 2

const CLOSERS = /^[)\]"'”’»*_`\s]*$/
/** What may follow the last question mark and still be the question's own: a note in brackets, or after a dash. */
const NOTE_AFTER = /^[)\]"'”’»*_`\s]*(?:[([]|[—–]|\s-\s)/

const LABEL = /^(?:(Q\s?\d+\s?[:.)])|(\(?[a-zA-Z]\))|(\d+[.)])|(#\d+[:.)]?))\s+(?=\S)/
/** Questions that ask nothing of the person: the headline of the next paragraph. */
const RHETORICAL = /^(?:why|what|how|when)\s+(?:this|it|that|these|those|all this)\s+(?:matters|works|happens|helps|is important|is useful|is needed)\??$/i

const YES_NO_START = /^(?:should|do|does|did|is|are|was|were|can|could|will|would|want|shall|have|has|may|might|must|ok|okay)\b/i

const URL_TEXT = /\bhttps?:\/\/\S+/g

/** The words of some inlines: code kept, for the person to read. */
function plainOf(nodes: readonly Inline[]): string {
  return nodes.map((node) => ('children' in node ? plainOf(node.children) : node.text)).join('')
}

/** What decides whether it is a question: the words without code and links, which carry question marks that mean nothing here. */
function askingOf(nodes: readonly Inline[]): string {
  const without = nodes.map((node) => {
    if (node.kind === 'code') return ' '
    return 'children' in node ? askingOf(node.children) : node.text
  }).join('')
  return without.replace(URL_TEXT, ' ')
}

/** Whether the text puts a question: it ends with one, or one ends it before a note ("Which one? (default: main)"). */
function endsAsQuestion(asking: string): boolean {
  const text = asking.trim()
  const mark = text.lastIndexOf('?')
  if (mark < 0) return false
  const after = text.slice(mark + 1)
  return CLOSERS.test(after) || NOTE_AFTER.test(after)
}

function wordsIn(text: string): number {
  return text.split(/\s+/).filter((word) => word !== '').length
}

function labelAndText(raw: string): { label: string; text: string } {
  const text = raw.replace(/\s+/g, ' ').trim()
  const match = LABEL.exec(text)
  if (match === null) return { label: '', text }
  const label = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? '').replace(/\s+/g, '')
  return { label, text: text.slice(match[0].length).trim() }
}

function isYesNo(text: string): boolean {
  if (/\bor not\b/i.test(text)) return true
  return YES_NO_START.test(text) && !/\sor\s/i.test(text)
}

function askableOf(key: string, block: number, item: number | null, labelled: string, nodes: readonly Inline[], given: string): Askable | null {
  if (!endsAsQuestion(askingOf(nodes))) return null
  const { label, text } = labelAndText(labelled)
  if (wordsIn(text) < MIN_WORDS || RHETORICAL.test(text.replace(/[*_`]/g, '').trim())) return null
  return { key, block, item, label: label === '' ? given : label, text, yesNo: isYesNo(text) }
}

/** A paragraph that numbers its questions inline ("1. Which? 2. Should I?") as the separate questions it holds, or null. */
function numberedParts(text: string): string[] | null {
  const marks = [...text.matchAll(/(?:^|\s)(\d+)[.)]\s+(?=\S)/g)]
  const first = Number(marks[0]?.[1])
  if (marks.length < MIN_INLINE_NUMBERED || marks.some((mark, index) => Number(mark[1]) !== first + index)) return null
  // A mark takes the space before its number, so a part starts at the number itself.
  const startOf = (mark: RegExpExecArray | RegExpMatchArray) => (mark.index ?? 0) + (/^\s/.test(mark[0]) ? 1 : 0)
  const starts = marks.map(startOf)
  return starts.map((start, index) => text.slice(start, starts[index + 1] ?? text.length).trim())
}

function fromParagraph(block: number, nodes: readonly Inline[]): Askable[] {
  // One bold line alone is a heading in all but name ("**Why this matters?**").
  if (nodes.length === 1 && nodes[0]?.kind === 'strong') return []
  const text = plainOf(nodes)
  if (text.length > PARAGRAPH_LIMIT) return []
  const parts = numberedParts(text.replace(/\s+/g, ' '))
  if (parts !== null) {
    return parts.flatMap((part, index) => {
      const found = askableOf(`${String(block)}.p${String(index)}`, block, null, part, [{ kind: 'text', text: part }], '')
      return found === null ? [] : [found]
    })
  }
  const found = askableOf(String(block), block, null, text, nodes, '')
  return found === null ? [] : [found]
}

function fromList(block: number, list: Extract<Block, { kind: 'list' }>): Askable[] {
  return list.items.flatMap((nodes, item) => {
    const given = list.ordered ? `${String((list.start ?? 1) + item)}.` : ''
    const found = askableOf(`${String(block)}.${String(item)}`, block, item, plainOf(nodes), nodes, given)
    return found === null ? [] : [found]
  })
}

/** The questions a finished message asks in plain text, in order; empty when it asks none. */
export function askablesOf(markdown: string): readonly Askable[] {
  const found = parseMarkdown(markdown).flatMap((block, index): Askable[] => {
    if (block.kind === 'paragraph') return fromParagraph(index, block.inlines)
    if (block.kind === 'list') return fromList(index, block)
    return []
  })
  return found.slice(0, MAX_ASKABLES)
}

/** A question as it is quoted back to the agent: its label and its words. */
export function askedText(asked: Askable): string {
  return asked.label === '' ? asked.text : `${asked.label} ${asked.text}`
}
