import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Segmented, SegmentedItem } from '@/components/ui/radio-group'
import { Markdown } from '@/features/chat/components/Markdown'
import { askAboutDrafts, registerDraft, type DraftHandle, type DraftOwner } from './draftGuard'
import { documentTargetOf, routeDocumentLinks } from './documentLinks'
import { PREVIEW_BESIDE_MIN_PX, type DocumentMode, isDirty, isDocumentMode, mayOverwrite, modesOffered, needsConfirmToLeave, usableMode } from './documentEdit'
import { resolveDocumentLink } from './documentPaths'
import { dominantEnding, toDisk, toEditable } from './lineEndings'
import { modeKey, rememberedMode, rememberMode } from './modeMemory'
import { daemonDocumentIO, type DocumentIO, useDocument } from './useDocument'
import './documents.css'

const MODE_LABEL: Record<DocumentMode, string> = { drawn: 'Drawn', source: 'Source', edit: 'Edit' }
const BARS = 10

const TARGET_ATTRIBUTE = 'data-document-target'

/** What a click on a link button names: the target noted on it once its title was rewritten. */
function linkTargetOf(element: HTMLElement): string | null {
  return element.closest(`button[${TARGET_ATTRIBUTE}]`)?.getAttribute(TARGET_ATTRIBUTE) ?? null
}

type Props = {
  term: number
  machine: number
  /** The project path of the document, with `/`. */
  path: string
  /** Names the checkout, for remembering the mode chosen for this file. */
  root: string
  /** Another document of the project was asked for by a link inside this one. */
  onOpenPath: (path: string) => void
  /** Puts this document in a pane beside the chat; absent where it already is in one. */
  onOpenBeside?: (() => void) | undefined
  /** Closes this viewer (a pane). The caller asks first when a draft would be lost: `guardDrafts` knows of it. */
  onClose?: (() => void) | undefined
  /** Whether the heading names the file (a pane has no other title). */
  showName?: boolean
  /** Where this viewer lives, so closing that pane or session asks about its draft. */
  owner?: DraftOwner
  io?: DocumentIO
  /** The mode to open in, instead of the remembered one (a test or the gallery). */
  startMode?: DocumentMode
}

/**
 * One markdown file, three ways: Drawn (the chat's reader), Source (the text as written) and Edit (a plain text box,
 * with the drawn page beside it when there is room). The text of the file is untrusted: it is only ever drawn by the
 * chat's reader, which makes elements and never HTML. Saving goes through the daemon with the version that was read.
 */
export function DocumentView({ term, machine, path, root, onOpenPath, onOpenBeside, onClose, showName = true, owner, io = daemonDocumentIO, startMode }: Props) {
  const key = modeKey(root, path)
  const [chosen, setChosen] = useState<DocumentMode>(() => startMode ?? rememberedMode(key))
  const [draft, setDraft] = useState<string | null>(null)
  const [preview, setPreview] = useState(true)
  const [wide, setWide] = useState(false)
  const shell = useRef<HTMLElement>(null)
  const editor = useRef<HTMLTextAreaElement>(null)

  const editing = draft !== null
  const dirtyRef = useRef(false)
  const doc = useDocument({ term, machine, path, dirtyRef, io })
  const editable = toEditable(doc.text)
  const dirty = editing && isDirty(draft, editable)
  useEffect(() => { dirtyRef.current = dirty })
  // Opened straight into Edit (a test, the gallery): the draft starts when the text is there to start from.
  if (doc.phase === 'ready' && doc.canEdit && chosen === 'edit' && draft === null) setDraft(editable)
  const mode: DocumentMode = editing ? 'edit' : usableMode(chosen, doc.canEdit)

  // Whether the drawn page fits beside the text: measured, not guessed from the window.
  useEffect(() => {
    const node = shell.current
    if (node === null || typeof ResizeObserver === 'undefined') return undefined
    const watch = new ResizeObserver(([entry]) => { if (entry !== undefined) setWide(entry.contentRect.width >= PREVIEW_BESIDE_MIN_PX) })
    watch.observe(node)
    return () => { watch.disconnect() }
  }, [])

  // The link buttons of a document that names a neighbour carry its address in their title; show where they lead.
  useLayoutEffect(() => {
    for (const button of Array.from(shell.current?.querySelectorAll<HTMLElement>('button[title]') ?? [])) {
      const target = documentTargetOf((button.getAttribute('title') ?? '').split(' ')[0] ?? '')
      if (target === null) continue
      button.setAttribute(TARGET_ATTRIBUTE, target)
      button.setAttribute('title', `${target} (opens here)`)
    }
  })

  const pick = (next: DocumentMode) => {
    if (next === 'edit') {
      setDraft(editable)
      setChosen('edit')
      return
    }
    if (needsConfirmToLeave(mode, draft ?? '', editable)) {
      const asking = self.current === null ? Promise.resolve(true) : askAboutDrafts([self.current])
      void asking.then((goOn) => { if (goOn) leaveEdit(next) })
      return
    }
    setDraft(null)
    setChosen(next)
    rememberMode(key, next)
  }
  const leaveEdit = (next: DocumentMode) => { setDraft(null); setChosen(next); rememberMode(key, next) }
  const save = async (overwrite: boolean): Promise<boolean> => {
    if (draft === null) return true
    const saved = await doc.save(toDisk(draft, dominantEnding(doc.text)), overwrite)
    if (saved) setChosen('edit')
    return saved
  }
  const paneId = owner?.paneId ?? null
  const sessionId = owner?.sessionId ?? null
  const guardId = useId()
  const latest = useRef<{ save: () => Promise<boolean>; discard: () => void }>({ save: () => Promise.resolve(true), discard: () => { setDraft(null) } })
  useEffect(() => {
    latest.current = {
      save: () => (draft === null ? Promise.resolve(true) : save(false)),
      discard: () => { setDraft(null); setChosen('drawn') },
    }
  })
  // While a draft differs from the file, every way this viewer could go away asks first.
  const self = useRef<DraftHandle | null>(null)
  useEffect(() => {
    if (!dirty) return undefined
    const handle: DraftHandle = { path, owner: { paneId, sessionId }, save: () => latest.current.save(), discard: () => { latest.current.discard() } }
    self.current = handle
    return registerDraft(guardId, handle)
  }, [dirty, guardId, path, paneId, sessionId])
  const reload = () => { doc.settle(); doc.adoptBehind(); doc.reload(); setDraft(null); setChosen('drawn') }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      if (dirty && doc.step.kind !== 'saving') void save(false)
    } else if (event.key === 'Escape') {
      event.stopPropagation()
      pick('drawn')
    }
  }

  const clickInside = (event: React.MouseEvent) => {
    const target = event.target instanceof HTMLElement ? linkTargetOf(event.target) : null
    if (target === null) return
    // The reader's own handler would try to open an address in the browser; this one is ours.
    event.preventDefault()
    event.stopPropagation()
    const next = resolveDocumentLink(path, target)
    if (next !== null) onOpenPath(next)
  }

  const drawn = (text: string) => (
    <div className="mx-docview-drawn" onClickCapture={clickInside}>
      <Markdown text={routeDocumentLinks(text)} className="mx-docview-page" />
    </div>
  )
  const modes = modesOffered(doc.canEdit)
  const sideBySide = mode === 'edit' && wide && preview

  return (
    <section ref={shell} className="mx-docview" aria-label={`Document ${path}`}>
      <header className="mx-docview-bar">
        {showName && <h3 className="mx-docview-name" title={path}>{path}</h3>}
        {!showName && <span className="mx-docview-name is-quiet" />}
        {dirty && <span className="mx-docview-dirty" role="img" aria-label="Unsaved changes" title="Unsaved changes" />}
        {doc.phase === 'ready' && (
          <Segmented aria-label="How to show this file" value={mode} onValueChange={(value) => { if (isDocumentMode(value)) pick(value) }}>
            {modes.map((one) => <SegmentedItem key={one} value={one}>{MODE_LABEL[one]}</SegmentedItem>)}
          </Segmented>
        )}
        {mode === 'edit' && wide && <button type="button" className="mx-text-button" aria-pressed={preview} onClick={() => { setPreview((on) => !on) }}>Preview</button>}
        {mode === 'edit' && <button type="button" className="mx-text-button is-primary" disabled={!dirty || doc.step.kind === 'saving'} onClick={() => { void save(false) }}>{doc.step.kind === 'saving' ? 'Saving…' : 'Save'}</button>}
        {onOpenBeside !== undefined && <button type="button" className="mx-text-button" onClick={onOpenBeside}>Open beside the chat</button>}
        {onClose !== undefined && <button type="button" className="mx-text-button" aria-label={`Close ${path}`} onClick={onClose}>Close</button>}
      </header>

      {doc.phase === 'ready' && doc.readOnlyBecause !== null && (
        <p className="mx-docview-note" role="status">
          {doc.readOnlyBecause === 'older'
            ? `${machine === 0 ? 'This computer’s' : 'This machine’s'} service is older: restart it to edit.`
            : 'This file has characters that cannot be shown safely, so it is read only here.'}
        </p>
      )}
      {doc.phase === 'loading' && (
        <div aria-busy="true" className="mx-docview-wait"><p className="sr-only">Reading the file</p>{Array.from({ length: BARS }, (_, i) => <span key={i} aria-hidden="true" />)}</div>
      )}
      {doc.phase === 'error' && (
        <p className="mx-docview-note is-error" role="alert">{doc.error} <button type="button" className="mx-text-button" onClick={doc.reload}>Retry</button></p>
      )}
      {doc.step.kind === 'changed' && (
        <p className="mx-docview-note is-error" role="alert">
          This file changed on disk since you opened it. Nothing was saved.{' '}
          <button type="button" className="mx-text-button" onClick={reload}>Reload</button>{' '}
          <button type="button" className="mx-text-button" onClick={() => { if (mayOverwrite(doc.step, true)) void save(true) }}>Overwrite</button>
        </p>
      )}
      {doc.step.kind === 'failed' && (
        <p className="mx-docview-note is-error" role="alert">{doc.step.message} <button type="button" className="mx-text-button" onClick={() => { void save(false) }}>Retry</button></p>
      )}
      {doc.behind !== null && doc.step.kind !== 'changed' && (
        <p className="mx-docview-note" role="status">
          This file changed on disk while you were editing.{' '}
          <button type="button" className="mx-text-button" onClick={reload}>Reload</button>
        </p>
      )}

      {doc.phase === 'ready' && (
        <div className={`mx-docview-body${sideBySide ? ' is-beside' : ''}`}>
          {mode === 'drawn' && drawn(doc.text)}
          {mode === 'source' && <pre className="mx-docview-source" tabIndex={0} aria-label={`Source of ${path}`}>{doc.text}</pre>}
          {mode === 'edit' && draft !== null && (
            <>
              <textarea
                ref={editor}
                className="mx-docview-editor"
                aria-label={`Edit ${path}`}
                spellCheck={false}
                value={draft}
                onChange={(event) => { setDraft(event.target.value); doc.settle() }}
                onKeyDown={onKeyDown}
              />
              {sideBySide && <div className="mx-docview-preview" aria-label="Preview">{drawn(draft)}</div>}
            </>
          )}
        </div>
      )}

    </section>
  )
}

