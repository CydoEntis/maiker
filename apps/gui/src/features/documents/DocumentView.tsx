import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { LOCAL_MACHINE } from '@/api/machines'
import { IconButton } from '@/components/ui/icon-button'
import { Segmented, SegmentedItem } from '@/components/ui/radio-group'
import { machineLabel } from '@/data/machineNicknames'
import { Markdown } from '@/features/chat/components/Markdown'
import { CodeView } from '@/features/inspect/CodeView'
import { commentHint } from '@/features/inspect/patchLines'
import { PatchView, type PatchComments } from '@/features/inspect/PatchView'
import { Icon } from '@/features/workspace/components/glyphs'
import { askAboutDrafts, registerDraft, type DraftHandle, type DraftOwner } from './draftGuard'
import { documentTargetOf, routeDocumentLinks } from './documentLinks'
import { PREVIEW_BESIDE_MIN_PX, type FileAsk, type FileMode, isDirty, isFileMode, mayOverwrite, modesOffered, needsConfirmToLeave, shownMode } from './documentEdit'
import { isMarkdownPath, resolveDocumentLink } from './documentPaths'
import { dominantEnding, toDisk, toEditable } from './lineEndings'
import { modeKey, rememberedMode, rememberMode } from './modeMemory'
import { daemonDocumentIO, type DocumentIO, useDocument } from './useDocument'
import './documents.css'

const MODE_LABEL: Record<FileMode, string> = { preview: 'Preview', changes: 'Changes', file: 'File', edit: 'Edit' }
const BARS = 10

const TARGET_ATTRIBUTE = 'data-document-target'

/** What a click on a link button names: the target noted on it once its title was rewritten. */
function linkTargetOf(element: HTMLElement): string | null {
  return element.closest(`button[${TARGET_ATTRIBUTE}]`)?.getAttribute(TARGET_ATTRIBUTE) ?? null
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** What a file's diff says: the patch, and whether there is a file left to read beside it. */
export type FileChange = { patch: string; binary: boolean; deleted: boolean }

type Props = {
  term: number
  machine: number
  /** The machine's name when the file is on another machine, for the words about what stays there. */
  machineName?: string | null
  /** The project path of the file, with `/`. */
  path: string
  /** Names the checkout, for remembering how this file is read. */
  root: string
  /** The project's name, before the file's in the header. */
  project?: string | undefined
  /** The file's diff, when it has one. */
  change?: FileChange | null
  /** The foot's line while the diff shows: the branch and how much changed. */
  changeLine?: string | undefined
  /** Lets a line of the diff be commented on, for an agent's session. */
  comments?: PatchComments | undefined
  /** How to open: the mode asked for (the diff, from Changes) and a line to show. */
  ask?: FileAsk | undefined
  /** Another document of the project was asked for by a link inside this one. */
  onOpenPath: (path: string) => void
  /** Closes this viewer (a pane). The caller asks first when a draft would be lost: `guardDrafts` knows of it. */
  onClose?: (() => void) | undefined
  /** Where this viewer lives, so closing that pane or session asks about its draft. */
  owner?: DraftOwner
  io?: DocumentIO
}

/**
 * One file of a checkout, in the modes it offers: Preview (markdown, drawn by the chat's reader), Changes (its diff),
 * File (its text, numbered and coloured) and Edit (a plain text box). The text of the file is untrusted: it is only
 * ever drawn as text or by the chat's reader, which makes elements and never HTML. Saving goes through the daemon with
 * the version that was read.
 */
export function DocumentView({ term, machine, machineName = null, path, root, project, change = null, changeLine, comments, ask, onOpenPath, onClose, owner, io = daemonDocumentIO }: Props) {
  const key = modeKey(root, path)
  const [chosen, setChosen] = useState<FileMode | null>(() => ask?.mode ?? rememberedMode(key))
  const [seenAsk, setSeenAsk] = useState(ask?.key)
  const [draft, setDraft] = useState<string | null>(null)
  const [preview, setPreview] = useState(true)
  const [wide, setWide] = useState(false)
  const shell = useRef<HTMLElement>(null)
  const editor = useRef<HTMLTextAreaElement>(null)

  const markdown = isMarkdownPath(path)
  // Another machine hands over its markdown documents only (ADR 0014), and a deleted file has no text left to read.
  const readable = (machine === LOCAL_MACHINE || markdown) && change?.deleted !== true
  const editing = draft !== null
  const dirtyRef = useRef(false)
  const doc = useDocument({ term, machine, path, dirtyRef, enabled: readable, io })
  const editable = toEditable(doc.text)
  const dirty = editing && isDirty(draft, editable)
  useEffect(() => { dirtyRef.current = dirty })
  // Opened straight into Edit (a test, the gallery): the draft starts when the text is there to start from.
  if (doc.phase === 'ready' && doc.canEdit && chosen === 'edit' && draft === null) setDraft(editable)
  // The same file asked for again (picked in Changes while it shows as text): adjusted while rendering, not in an effect.
  if (ask !== undefined && ask.key !== seenAsk) {
    setSeenAsk(ask.key)
    // A draft is never dropped by a click elsewhere: the file stays in its editor, whose mode buttons ask first.
    if (!dirty && ask.mode != null) { setDraft(null); setChosen(ask.mode) }
  }
  const modes = modesOffered({ markdown, changed: change !== null, readable, canEdit: doc.canEdit })
  const mode: FileMode | null = editing ? 'edit' : shownMode(chosen, modes)

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

  const pick = (next: FileMode) => {
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
    leaveEdit(next)
  }
  const leaveEdit = (next: FileMode) => { setDraft(null); setChosen(next); rememberMode(key, next) }
  /** Out of the editor, back to reading the file the way it is read by default. */
  const stopEditing = () => { setDraft(null); setChosen(null) }
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
      discard: stopEditing,
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
  const reload = () => { doc.settle(); doc.adoptBehind(); doc.reload(); stopEditing() }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      if (dirty && doc.step.kind !== 'saving') void save(false)
    } else if (event.key === 'Escape') {
      event.stopPropagation()
      pick(shownMode(null, modes) ?? 'file')
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
  const sideBySide = mode === 'edit' && markdown && wide && preview
  const name = nameOf(path)

  return (
    <section ref={shell} className="mx-docview" aria-label={`File ${path}`}>
      <header className="mx-docview-bar">
        <h3 className="mx-pane-title" title={path}>
          {project !== undefined && <><span className="mx-pane-project">{project}</span><span className="mx-pane-slash" aria-hidden="true">/</span></>}
          <span className="mx-pane-name">{name}</span>
        </h3>
        {dirty && <span className="mx-docview-dirty" role="img" aria-label="Unsaved changes" title="Unsaved changes" />}
        {mode !== null && modes.length > 1 && (
          <Segmented aria-label="How to show this file" value={mode} onValueChange={(value) => { if (isFileMode(value)) pick(value) }}>
            {modes.map((one) => <SegmentedItem key={one} value={one}>{MODE_LABEL[one]}</SegmentedItem>)}
          </Segmented>
        )}
        {mode === 'edit' && markdown && wide && <button type="button" className="mx-text-button" aria-pressed={preview} onClick={() => { setPreview((on) => !on) }}>Side by side</button>}
        {mode === 'edit' && <button type="button" className="mx-text-button is-primary" disabled={!dirty || doc.step.kind === 'saving'} onClick={() => { void save(false) }}>{doc.step.kind === 'saving' ? 'Saving…' : 'Save'}</button>}
        {onClose !== undefined && <IconButton label={`Close ${name}`} tip="Close file" onClick={onClose}><Icon name="close" /></IconButton>}
      </header>

      {mode === null && (
        <p className="mx-docview-note" role="status">
          {change?.deleted === true ? 'This file was deleted.' : `Only Markdown documents open from ${machineLabel(machineName) ?? 'another machine'}; its other files stay there.`}
        </p>
      )}
      {mode !== 'changes' && doc.phase === 'ready' && doc.readOnlyBecause !== null && (
        <p className="mx-docview-note" role="status">
          {doc.readOnlyBecause === 'older'
            ? `${machine === LOCAL_MACHINE ? 'This computer’s' : 'This machine’s'} service is older: restart it to edit.`
            : 'This file has characters that cannot be shown safely, so it is read only here.'}
        </p>
      )}
      {mode !== 'changes' && doc.phase === 'loading' && (
        <div aria-busy="true" className="mx-docview-wait"><p className="sr-only">Reading the file</p>{Array.from({ length: BARS }, (_, i) => <span key={i} aria-hidden="true" />)}</div>
      )}
      {mode !== 'changes' && doc.phase === 'error' && (
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

      <div className={`mx-docview-body${sideBySide ? ' is-beside' : ''}`}>
        {mode === 'changes' && change !== null && (change.binary
          ? <p className="mx-docview-note" role="status">Binary file; no diff to show.</p>
          : <PatchView key={path} patch={change.patch} path={path} comments={comments} />)}
        {doc.phase === 'ready' && mode === 'preview' && drawn(doc.text)}
        {doc.phase === 'ready' && mode === 'file' && <CodeView path={path} text={doc.text} target={ask?.line} />}
        {doc.phase === 'ready' && mode === 'edit' && draft !== null && (
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

      <footer className="mx-docview-foot">
        <span className="mx-docview-where" title={path}>{mode === 'changes' && changeLine !== undefined ? changeLine : path}</span>
        {mode === 'edit' && <span>{dirty ? 'Unsaved' : 'Saved'}</span>}
        {mode === 'changes' && comments !== undefined && change?.binary === false && <span>{commentHint(comments.sent.length)}</span>}
      </footer>
    </section>
  )
}
