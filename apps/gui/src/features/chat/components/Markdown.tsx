import { memo, useContext, useId, useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Fold } from '@/components/ui/fold'
import { CodeChip } from '@/components/ui/tag'
import { HighlightedLine } from '@/components/HighlightedLine'
import { fileTag } from '@/features/inspect/fileTag'
import { extensionForLanguage } from '@/lib/highlight'
import { followLink } from '../followLink'
import { listBullets, parseMarkdown, parseInline, safeHref, type Block, type Inline, type TableAlign } from '../markdown'
import { codeExtension, tableCsv, tableHtml, tableMarkdown } from '../exportBlock'
import { numericColumns } from '../tableColumns'
import { OpenFileContext } from '../openFile'
import { saveBlock } from '../saveBlock'
import { TypeTag, typeTone } from '@/components/ui/tag'
import { Block as BlockBox, BlockHead } from './Block'
import { CopyButton } from './CopyButton'
import type { Askable } from '../plainQuestions'

/**
 * Renders the agent's markdown as React elements (never as HTML; see `markdown.ts`). A link is
 * a button, not an anchor: an anchor would navigate the webview away from the app. Choosing a link
 * opens it in the person's own browser, through the host; outside the desktop app, where there is
 * no host to ask, it copies the address.
 */

// A path with a file name whose type is known, and a line number after it or not: `src/tax.js`, `src/tax.js:42`.
const FILE_NAME = /^((?:[\w@.-]+[\\/])*[\w@.-]+\.[A-Za-z0-9]+)(?::(\d+))?$/

const LINK_CLASS = 'cursor-pointer border-0 bg-transparent p-0 text-left text-(--link) underline decoration-[color-mix(in_oklab,var(--link)_45%,transparent)] underline-offset-2 hover:decoration-(--link)'

/** A link the reader chooses to open in their own browser. */
function LinkButton({ href, children }: { href: string; children: ReactNode }) {
  return <button type="button" title={`${href} (click to open in your browser)`} className={LINK_CLASS} onClick={() => { followLink(href) }}>{children}</button>
}

/**
 * Inline code. A web address opens like a link, still set as code: agents often quote the address to visit that way.
 * A file's name stays code with no icon, so a sentence that names files reads straight through; it is tinted in its type's
 * colour (a setting) and, where the chat can open files, is a button that opens the file (and its line).
 */
function InlineCode({ text }: { text: string }) {
  const open = useContext(OpenFileContext)
  const href = /^https?:\/\//i.test(text.trim()) ? safeHref(text) : null
  if (href !== null) return <LinkButton href={href}><CodeChip className="text-(--link)">{text}</CodeChip></LinkButton>
  const named = FILE_NAME.exec(text)
  const path = named?.[1]
  const tag = path === undefined ? null : fileTag(path)
  if (path === undefined || tag === null) return <CodeChip>{text}</CodeChip>
  // The name is the badge: its type's colour is set here and drawn by `[data-file-colours]` (a setting).
  const chip = <CodeChip className="mx-file-name" style={{ '--tone': typeTone(tag) } as CSSProperties}>{text}</CodeChip>
  if (open === null) return chip
  const line = named?.[2] === undefined ? null : Number(named[2])
  return <button type="button" title={`Open ${path}`} className="cursor-pointer border-0 bg-transparent p-0 text-left hover:underline" onClick={() => { open(path, line) }}>{chip}</button>
}

function Inlines({ nodes }: { nodes: readonly Inline[] }): ReactNode {
  return nodes.map((node, index): ReactNode => {
    switch (node.kind) {
      case 'text':
        return node.text
      case 'code':
        return <InlineCode key={index} text={node.text} />
      case 'strong':
        return <strong key={index} className="font-semibold text-fg"><Inlines nodes={node.children} /></strong>
      case 'em':
        return <em key={index}><Inlines nodes={node.children} /></em>
      case 'link':
        return <LinkButton key={index} href={node.href}><Inlines nodes={node.children} /></LinkButton>
    }
  })
}

const ALIGN: Record<'left' | 'center' | 'right', string> = { left: 'text-left', center: 'text-center', right: 'text-right whitespace-nowrap' }
const alignClass = (align: TableAlign | undefined) => ALIGN[align ?? 'left']
/** A column's class: the alignment the table gave it, or right and mono for a column of figures it left alone. */
const columnClass = (align: TableAlign | undefined, figures: boolean | undefined) => ((align ?? null) === null && figures === true ? `${ALIGN.right} mx-md-num` : alignClass(align))

/** Headings 1 to 6 as the design sizes them: 22, 18, 16, 14.5, 13 and 12 (the last in capitals, muted). */
const HEADING_SIZE = [
  'mt-2 text-[22px] leading-[1.3] font-[650] tracking-[-.01em] text-fg',
  'mt-2 text-[18px] leading-[1.3] font-[650] tracking-[-.01em] text-fg',
  'mt-1 text-[16px] leading-[1.3] font-[650] text-fg',
  'mt-1 text-[14.5px] leading-[1.3] font-[650] text-fg',
  'mt-1 text-[13px] leading-[1.3] font-semibold text-fg',
  'mt-1 text-[12px] leading-[1.3] font-semibold uppercase tracking-[.04em] text-(--muted)',
] as const

const CODE_FOLD_LINES = 24
/** A block only a few lines past the fold is shown whole: a button that reveals three lines is noise. */
const CODE_FOLD_SLACK = 6

/** The fence languages that are a patch: each line is coloured by its sign, as the chat's own edit diffs are. */
const DIFF_LANGUAGES: ReadonlySet<string> = new Set(['diff', 'patch', 'udiff'])

/** How a patch line reads: added, removed, a hunk or file head, or context. */
function diffLineKind(line: string): '' | ' is-add' | ' is-del' | ' is-hunk' {
  if (line.startsWith('@@') || line.startsWith('+++') || line.startsWith('---')) return ' is-hunk'
  if (line.startsWith('+')) return ' is-add'
  if (line.startsWith('-')) return ' is-del'
  return ''
}

/** One line of a code block with its number. A reply being typed changes only its last line, so the lines above are not coloured again. */
const CodeLine = memo(function CodeLine({ line, number, hint, diff }: { line: string; number: number; hint: string; diff: boolean }) {
  const kind = diff ? diffLineKind(line) : ''
  return <span className={`code-line${kind}`}><span className="mx-code-num" aria-hidden="true">{number}</span><span className="mx-code-text">{diff ? line : <HighlightedLine line={line} path={hint} />}</span>{'\n'}</span>
})

/** A fenced code block (design: CodeBlock): a head with its type tag and language, Copy and Save, and numbered lines under it; folded past its first lines when it is long, and closable from its chevron. */
function CodeBlock({ language, text }: { language: string; text: string }) {
  const lines = text.split('\n')
  const folds = lines.length > CODE_FOLD_LINES + CODE_FOLD_SLACK
  // A block that was short when it first showed was watched being written: it stays whole as it grows, instead of
  // folding away under the reader the moment it passes the fold. Only one that arrives long starts folded.
  const [all, setAll] = useState(() => !folds)
  const [open, setOpen] = useState(true)
  const diff = DIFF_LANGUAGES.has(language.toLowerCase())
  const shown = folds && !all ? lines.slice(0, CODE_FOLD_LINES) : lines
  const hint = `code.${extensionForLanguage(language)}`
  const tag = fileTag(hint)
  return (
    <BlockBox>
      <BlockHead
        open={open}
        onToggle={() => { setOpen((current) => !current) }}
        actions={(
          <>
            <CopyButton text={text} failed="Could not copy the code" />
            <button type="button" className="mx-block-action" title="Save as a file in your export folder" onClick={() => { saveBlock(language === '' ? 'code' : language, codeExtension(language), text) }}>Save</button>
          </>
        )}
      >
        {tag !== null && <TypeTag tag={tag} />}
        <span className="mx-block-title">{language === '' ? 'code' : language}</span>
      </BlockHead>
      {open && (
        <>
          <pre className="mx-code-body" aria-label={language === '' ? 'Code' : `Code, ${language}`}>
            <code>{shown.map((line, index) => <CodeLine key={index} line={line} number={index + 1} hint={hint} diff={diff} />)}</code>
          </pre>
          {folds && <Fold open={all} onToggle={() => { setAll((current) => !current) }} more={`Show ${String(lines.length - CODE_FOLD_LINES)} more lines`} less="Show less" />}
        </>
      )}
    </BlockBox>
  )
}

type TableBlock = Extract<Block, { kind: 'table' }>

/**
 * A table (design: TableCard): a card like a code block's, its head row saying how many rows it has with Copy and Save
 * as, and the table under it with a rule below its head and between its rows. A column of figures sits right, in mono. Cells never wrap; a table wider than
 * the column scrolls sideways inside its own region, which the keyboard can reach.
 */
function TableCard({ block }: { block: TableBlock }) {
  const rows = block.rows.length
  const figures = numericColumns(block)
  return (
    <div className="mx-md-tablecard">
      <div className="mx-md-tableacts" role="group" aria-label="Copy or save this table">
        <span className="mx-md-tabletitle">{rows} {rows === 1 ? 'row' : 'rows'}</span>
        <span className="mx-spacer" />
        <CopyButton text={tableMarkdown(block)} failed="Could not copy the table" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="mx-block-action">Save as<ChevronDown className="size-3" aria-hidden="true" /></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" container={document.querySelector<HTMLElement>('.mx-app')} className="text-fg">
            <DropdownMenuItem title="Save as a Markdown file in your export folder" onSelect={() => { saveBlock('table', 'md', tableMarkdown(block)) }}>Markdown</DropdownMenuItem>
            <DropdownMenuItem title="Save as a CSV file in your export folder" onSelect={() => { saveBlock('table', 'csv', tableCsv(block)) }}>CSV</DropdownMenuItem>
            <DropdownMenuItem title="Save as an HTML page in your export folder" onSelect={() => { saveBlock('table', 'html', tableHtml(block)) }}>HTML</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div role="region" aria-label="Table" tabIndex={0} className="mx-md-table max-w-full overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {block.header.map((cell, column) => (
                <th key={column} scope="col" className={columnClass(block.align[column], figures[column])}><Inlines nodes={cell} /></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, at) => (
              <tr key={at}>
                {row.map((cell, column) => (
                  <td key={column} className={columnClass(block.align[column], figures[column])}><Inlines nodes={cell} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Whether two parsed values say the same thing: plain data only, as the parser makes it. */
function sameParsed(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const [left, right] = [a as Record<string, unknown>, b as Record<string, unknown>]
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every((key) => sameParsed(left[key], right[key]))
}

/**
 * One block. A reply that is being typed out is parsed again about forty times a second, and only its last block
 * differs each time: comparing a block's parse is far cheaper than rendering it again, so the ones above stay as
 * they are.
 */
type Replying = { readonly asked: readonly Askable[]; readonly onReply: (asked: Askable) => void }

/** A quiet Reply at the right edge of a question; its room is kept whether it shows or not. */
function ReplyButton({ asked, onReply }: { asked: Askable; onReply: (asked: Askable) => void }) {
  return <button type="button" className="mx-ask-reply" aria-label={asked.label === '' ? 'Reply to this question' : `Reply to question ${asked.label}`} onClick={() => { onReply(asked) }}>Reply</button>
}

/** How far a nested list entry is indented for each level, in pixels. */
const TASK_INDENT_PX = 18

/** A task entry's box: read-only, a tick when done. Its text names it for assistive tech. */
function TaskBox({ checked, labelledBy }: { checked: boolean; labelledBy: string }) {
  return (
    <span role="checkbox" aria-checked={checked} aria-readonly="true" aria-labelledby={labelledBy} className="mx-task-box" data-checked={checked ? '' : undefined}>
      <svg viewBox="0 0 12 12" aria-hidden="true" className="mx-task-tick"><path d="M2.5 6.4 5 8.8 9.6 3.4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </span>
  )
}

function ListView({ block, replying }: { block: Extract<Block, { kind: 'list' }>; replying?: Replying | undefined }) {
  const List = block.ordered ? 'ol' : 'ul'
  const base = useId()
  const bullets = listBullets(block)
  return (
    <List className="mx-md-list" role="list">
      {block.items.map((item, index) => {
        const mark = block.marks?.[index]
        const checked = mark?.checked ?? null
        const textId = `${base}-${String(index)}`
        return (
          <li key={index} data-bullet={checked === null ? (bullets[index] ?? '') : ''} data-task={checked === null ? undefined : ''} style={mark !== undefined && mark.level > 0 ? { marginInlineStart: `${String(mark.level * TASK_INDENT_PX)}px` } : undefined} className={replying?.asked.some((one) => one.item === index) === true ? 'has-reply' : undefined}>
            {checked !== null && <TaskBox checked={checked} labelledBy={textId} />}
            <span id={textId} className="mx-md-item"><Inlines nodes={item} /></span>
            {replying?.asked.filter((one) => one.item === index).map((one) => <ReplyButton key={one.key} asked={one} onReply={replying.onReply} />)}
          </li>
        )
      })}
    </List>
  )
}

const BlockView = memo(function BlockView({ block, replying }: { block: Block; replying?: Replying | undefined }) {
  switch (block.kind) {
    case 'paragraph': {
      const asked = replying?.asked[0]
      if (replying === undefined || asked === undefined) return <p className="m-0 whitespace-pre-wrap"><Inlines nodes={block.inlines} /></p>
      return <p className="m-0 whitespace-pre-wrap has-reply"><Inlines nodes={block.inlines} /><ReplyButton asked={asked} onReply={replying.onReply} /></p>
    }
    case 'heading':
      return <p role="heading" aria-level={block.level} className={`mb-0 ${HEADING_SIZE[block.level - 1] ?? HEADING_SIZE[3]}`}><Inlines nodes={block.inlines} /></p>
    case 'code':
      return <CodeBlock language={block.language} text={block.text} />
    case 'list':
      return <ListView block={block} replying={replying} />
    case 'quote': {
      // A note (design: Note): a well with a coloured left edge; text bold at its start is the lead beside the rest.
      const [first, ...rest] = block.inlines
      const lead = first?.kind === 'strong' ? first : null
      return (
        <div data-fold="" className="mx-md-quote">
          {lead !== null && <span className="mx-md-quote-lead"><Inlines nodes={lead.children} /></span>}
          <span className="mx-md-quote-text"><Inlines nodes={lead === null ? block.inlines : rest} /></span>
        </div>
      )
    }
    case 'rule':
      return <hr className="mx-md-rule" />
    case 'table':
      return <TableCard block={block} />
  }
}, (before, after) => sameParsed(before.block, after.block) && sameParsed(before.replying?.asked, after.replying?.asked) && before.replying?.onReply === after.replying?.onReply)

/** A message's text as markdown blocks, spaced like paragraphs. */
export const Markdown = memo(function Markdown({ text, className = '', asked, onReply }: { text: string; className?: string; /** The questions the message asks, each given a Reply (`plainQuestions.ts`). */ asked?: readonly Askable[]; onReply?: (asked: Askable) => void }) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {parseMarkdown(text).map((block, index) => {
        const here = asked?.filter((one) => one.block === index) ?? []
        return <BlockView key={index} block={block} replying={here.length === 0 || onReply === undefined ? undefined : { asked: here, onReply }} />
      })}
    </div>
  )
})

/** One line of text with inline markdown only (the lead sentence of a message). */
export const InlineMarkdown = memo(function InlineMarkdown({ text }: { text: string }) {
  return <Inlines nodes={parseInline(text)} />
})
