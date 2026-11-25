import { useEffect, useRef, useState, type RefObject } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { ModalBody, ModalFoot, ModalHead } from '@/components/ui/modal'
import { RestartServiceButton } from '@/features/updates/RestartServiceButton'
import type { ClosedSession } from '@/api/daemon'
import type { WorktreesRemoved } from '@/features/worktrees/api'
import { explainError } from '@/lib/error-message'
import { closeTargets, openTargets, removalCheck, removalItems, removedWords, rowWhen, rowWhere, tickableWorktrees, worktreeWhen, worktreeWhere, type RemovalCheck, type SavedRead, type WorkspaceRow, type WorktreeRow, type WorktreesRead } from '../model/workspacePanel'
import { AppIcon, Icon } from './glyphs'
import { windowRoot } from './windowRoot'

type Props = {
  /** What the project's heading calls it. */
  name: string
  /** Every row: the project's sessions in the window, then its saved set (`workspaceRows`). */
  rows: readonly WorkspaceRow[]
  /** How the saved set's read went: the rows above hold none of it until it is listed. */
  saved: SavedRead
  /** The project's worktrees, each with its standing as far as it is read (`useWorkspaceWorktrees`). */
  worktrees: WorktreesRead
  /** When the panel opened (unix seconds): each row's age counts from it. */
  now: number
  /** An Open is under way, or another session is starting: Open and Open everything wait for it. */
  opening: boolean
  /** Opens these saved sessions again, one after another (`useRecentSessions().openSaved`). */
  onOpen: (saved: readonly ClosedSession[]) => void
  /** Ends these sessions of the window, asking first as Close project does (`useClosing().closeSessions`). */
  onClose: (sessionIds: readonly string[]) => void
  /** Removes these worktrees with this computer's daemon and reads them again; resolves to what went and what stayed. */
  onRemove: (items: readonly { path: string; force: boolean }[]) => Promise<WorktreesRemoved>
  onRetry: () => void
  onRetryWorktrees: () => void
  onCancel: () => void
}

/**
 * A project's workspace: its agent sessions running in the window and the ones open when it was last closed, and its
 * worktrees, each with a tick, nothing ticked at first. Nothing starts, stops or is removed from here until an action is
 * pressed.
 */
export function WorkspacePanelDialog(props: Props) {
  const dialog = useRef<HTMLDivElement>(null)
  const title = `Workspace · ${props.name}`
  return (
    <Dialog open onOpenChange={(open) => { if (!open) props.onCancel() }}>
      <DialogContent unstyled asChild container={windowRoot()} aria-describedby={undefined} onOpenAutoFocus={(event) => { event.preventDefault(); dialog.current?.focus() }}>
        <div
          ref={dialog}
          tabIndex={-1}
          aria-label={title}
          className="mx-rename mx-modal mx-recent mx-workspace"
          onKeyDown={(event) => {
            // Radix closes on Escape; this keeps the key from reaching the app's own handlers.
            if (event.key === 'Escape') event.stopPropagation()
          }}
        >
          <ModalHead title={title} onClose={props.onCancel} />
          <WorkspaceBody {...props} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** The line about the saved set while it is not listed; null once it is. */
function SavedLine({ read, onRetry }: { read: SavedRead; onRetry: () => void }) {
  if (read.kind === 'loading') return <p role="status">Looking for the sessions open when this project was last closed…</p>
  if (read.kind === 'older') return <p role="status">The Maiker service needs a restart to show the sessions open when this project was last closed. <RestartServiceButton /></p>
  if (read.kind === 'failed') {
    return (
      <p role="status">
        Could not read the sessions open when this project was last closed.{' '}
        <button type="button" className="mx-text-button" onClick={onRetry}>Try again</button>
      </p>
    )
  }
  return null
}

/** The Open button's words: how many it opens, so a person sees which of the ticked rows it starts before pressing it. */
function openLabel(count: number, opening: boolean): string {
  if (opening) return 'Opening…'
  return count === 0 ? 'Open' : `Open ${String(count)}`
}

/** The Close button's words, counting what it ends, as Open's do. */
function closeLabel(count: number): string {
  return count === 0 ? 'Close' : `Close ${String(count)}`
}

/**
 * The Close button's accessible name: its words and what they close, so it is not a second "Close" beside the panel's
 * own × (which closes the panel), and still starts with what it shows.
 */
function closeName(count: number): string {
  return `${closeLabel(count)} ticked ${count === 1 ? 'session' : 'sessions'}`
}

/** The Remove button's words, counting the ticked worktrees it asks about, as Close's count its sessions. */
function removeLabel(count: number): string {
  return count === 0 ? 'Remove' : `Remove ${String(count)}`
}

/** Its accessible name: what it removes, since its words are kept short to fit the foot. */
function removeName(count: number): string {
  return `${removeLabel(count)} ticked ${count === 1 ? 'worktree' : 'worktrees'}`
}

/** The line the Worktrees section shows after a removal: how it went, or why it could not be asked. */
type RemovalNote = { readonly text: string; readonly failed: boolean }

/**
 * A worktree's row: a tick for a linked one, none for the main checkout, which is the project and never removed. A
 * linked one a session runs in shows its tick off. `refused` is the daemon's reason for keeping it at the last removal.
 */
function WorktreeItem({ row, ticked, refused, onToggle }: { row: WorktreeRow; ticked: boolean; refused: string | undefined; onToggle: () => void }) {
  const why = !row.main && row.standing.kind === 'failed' ? row.standing.why : undefined
  const text = (
    <>
      <span className="mx-workspace-mark"><Icon name={row.main ? 'repo' : 'worktree'} size={16} strokeWidth={1.8} /></span>
      <span className="mx-recent-text">
        <span className="mx-recent-title">{row.name}</span>
        <span className="mx-recent-where" title={why}>{worktreeWhere(row)}</span>
        {refused !== undefined && <span className="mx-workspace-refused">{`Not removed: ${refused}`}</span>}
      </span>
      <span className="mx-recent-when">{worktreeWhen(row)}</span>
    </>
  )
  if (row.main) {
    return (
      <li>
        <div className="mx-recent-row mx-workspace-row is-fixed" title={row.path}>
          <span className="mx-workspace-notick" aria-hidden="true" />
          {text}
        </div>
      </li>
    )
  }
  return (
    <li>
      <label className={row.running ? 'mx-recent-row mx-workspace-row is-fixed' : 'mx-recent-row mx-workspace-row'} title={row.running ? `${row.path}\nClose the session running in it first.` : row.path}>
        <input type="checkbox" data-bare checked={ticked && !row.running} disabled={row.running} onChange={onToggle} />
        {text}
      </label>
    </li>
  )
}

type WorktreesProps = {
  name: string
  read: WorktreesRead
  ticked: ReadonlySet<string>
  /** The daemon's reason for each worktree it kept at the last removal, by folder. */
  refused: ReadonlyMap<string, string>
  note: RemovalNote | null
  /** Takes focus when Remove's question goes back to the list, so focus stays where the person was working. */
  sectionRef: RefObject<HTMLElement | null>
  onToggle: (key: string) => void
  onRetry: () => void
}

/** The project's worktrees, the main checkout first; nothing at all for a folder outside git. */
function WorktreesSection({ name, read, ticked, refused, note, sectionRef, onToggle, onRetry }: WorktreesProps) {
  if (read.kind === 'not-a-repo') return null
  return (
    <section ref={sectionRef} tabIndex={-1} className="mx-workspace-section" aria-label="Worktrees">
      <div className="mx-workspace-head">
        <h3 className="mx-import-folder">Worktrees</h3>
      </div>
      {note !== null && <p role="status" className={note.failed ? 'mx-workspace-refused' : undefined}>{note.text}</p>}
      {read.kind === 'loading' && <p role="status">Looking for the worktrees of {name}…</p>}
      {read.kind === 'failed' && (
        <p role="status">
          Could not read the worktrees of {name}.{' '}
          <button type="button" className="mx-text-button" onClick={onRetry}>Try again</button>
        </p>
      )}
      {read.kind === 'listed' && (
        <ul className="mx-recent-list" aria-label="Worktrees">
          {read.rows.map((row) => <WorktreeItem key={row.key} row={row} ticked={ticked.has(row.key)} refused={refused.get(row.path)} onToggle={() => { onToggle(row.key) }} />)}
        </ul>
      )}
    </section>
  )
}

type RemoveStepProps = {
  /** The ticked worktrees, each with what removing it would lose (`removalCheck`). */
  checks: readonly RemovalCheck[]
  removing: boolean
  onBack: () => void
  onRemove: (items: readonly { path: string; force: boolean }[]) => void
}

/**
 * Remove's question, in the panel: each ticked worktree by its branch, its folder and where it stands. One that loses
 * nothing goes as it is; one that would lose something has a tick of its own saying what, in the worktree manager's
 * words for its second press, and goes only with it ticked. The tick holds for the loss it named: when the standing
 * changes meanwhile, it is asked again.
 */
function RemoveWorktreesStep({ checks, removing, onBack, onRemove }: RemoveStepProps) {
  const question = useRef<HTMLHeadingElement>(null)
  useEffect(() => { question.current?.focus() }, [])
  // Each confirmed worktree's key, with the loss its tick named.
  const [sure, setSure] = useState<ReadonlyMap<string, string>>(() => new Map())
  const confirm = (key: string, loss: string) => {
    setSure((current) => {
      const next = new Map(current)
      if (next.get(key) === loss) next.delete(key)
      else next.set(key, loss)
      return next
    })
  }
  const items = removalItems(checks, sure)
  const asksMore = checks.some((check) => check.loss !== null)
  return (
    <>
      <ModalBody>
        <h3 ref={question} tabIndex={-1} className="mx-workspace-question">{checks.length === 1 ? 'Remove this worktree?' : `Remove these ${String(checks.length)} worktrees?`}</h3>
        <p>Each folder is deleted for good. A branch stays unless its work is already merged.</p>
        <ul className="mx-recent-list" aria-label="Worktrees to remove">
          {checks.map(({ row, loss }) => (
            <li key={row.key} className="mx-workspace-removing">
              <span className="mx-recent-text">
                <span className="mx-recent-title">{row.name}</span>
                <span className="mx-recent-where mx-workspace-path">{row.path}</span>
                <span className="mx-recent-where">{worktreeWhere(row)}</span>
              </span>
              {loss === null
                ? <span className="mx-recent-when">loses nothing</span>
                : (
                  <label className="mx-workspace-lose">
                    <input type="checkbox" data-bare checked={sure.get(row.key) === loss} disabled={removing} onChange={() => { confirm(row.key, loss) }} />
                    <span>{`Lose ${loss}? Remove it too`}</span>
                  </label>
                )}
            </li>
          ))}
        </ul>
        {asksMore && <p className="mx-workspace-count">One whose loss is not ticked stays.</p>}
      </ModalBody>
      <ModalFoot>
        <Button type="button" variant="ghost" size="lg" disabled={removing} onClick={onBack}>Keep them</Button>
        <Button type="button" variant="danger" size="lg" disabled={items.length === 0 || removing} aria-label={removing ? undefined : removeName(items.length)} onClick={() => { onRemove(items) }}>
          {removing ? 'Removing…' : removeLabel(items.length)}
        </Button>
      </ModalFoot>
    </>
  )
}

function WorkspaceBody({ name, rows, saved, worktrees, now, opening, onOpen, onClose, onRemove, onRetry, onRetryWorktrees, onCancel }: Props) {
  // Keys of the ticked rows. A row that leaves the list (a session that ends and is closed) simply stops counting.
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = (key: string) => {
    setTicked((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }
  // Select all and the count cover every row a tick can go on, sessions and linked worktrees alike.
  const tickable = [...rows.map((row) => row.key), ...tickableWorktrees(worktrees).map((row) => row.key)]
  const tickedCount = tickable.filter((key) => ticked.has(key)).length
  const empty = rows.length === 0 && saved.kind === 'listed'
  // The ticked session rows. Open and Close act on these only: a ticked worktree is Remove worktree's.
  const chosen = rows.filter((row) => ticked.has(row.key))
  // Open starts only closed rows: a running one ticked beside them is left as it is.
  const toOpen = openTargets(chosen)
  const closedRows = openTargets(rows)
  // Close ends only sessions in the window: a closed row ticked beside them has nothing to end.
  const toClose = closeTargets(chosen)
  // Either Open sends every ticked closed row, so those are unticked and the ticks left are the ones nothing was done to.
  const open = (list: readonly ClosedSession[]) => {
    onOpen(list)
    const closedKeys = new Set(rows.filter((row) => row.state === 'closed').map((row) => row.key))
    setTicked((current) => new Set([...current].filter((key) => !closedKeys.has(key))))
  }
  // The ticked worktrees no session runs in: Remove's. A tick on one a session has since started in does not count.
  const toRemove = tickableWorktrees(worktrees).filter((row) => ticked.has(row.key))
  const [asking, setAsking] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [refused, setRefused] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [note, setNote] = useState<RemovalNote | null>(null)
  const section = useRef<HTMLElement>(null)
  const [refocus, setRefocus] = useState(false)
  useEffect(() => {
    if (!asking && refocus) section.current?.focus()
  }, [asking, refocus])
  const back = () => { setAsking(false); setRefocus(true) }
  // What was sent is unticked, kept or not, so the ticks left are the ones nothing was done to, as Open leaves them.
  const remove = (items: readonly { path: string; force: boolean }[]) => {
    setRemoving(true)
    setNote(null)
    const paths = new Set(items.map((item) => item.path))
    const sent = new Set(toRemove.filter((row) => paths.has(row.path)).map((row) => row.key))
    onRemove(items)
      .then((outcome) => {
        setRefused(new Map(outcome?.kept.map((kept) => [kept.path, kept.why])))
        setNote({ text: removedWords(outcome), failed: false })
      })
      .catch((error: unknown) => {
        const { title, reason } = explainError(error, 'Could not remove the worktrees')
        setNote({ text: `${title}. ${reason}`, failed: true })
      })
      .finally(() => {
        setRemoving(false)
        setTicked((current) => new Set([...current].filter((key) => !sent.has(key))))
        back()
      })
  }
  if (asking) return <RemoveWorktreesStep checks={toRemove.map(removalCheck)} removing={removing} onBack={back} onRemove={remove} />
  return (
    <>
      <ModalBody>
        {rows.length > 0 && <p>The agent sessions of {name} on this computer: the ones running now, and the ones open when it was last closed.</p>}
        <SavedLine read={saved} onRetry={onRetry} />
        {empty && <p role="status">No sessions here yet. The ones you start in {name}, and the ones open when it is closed, show here.</p>}
        {tickable.length > 0 && (
          <div className="mx-workspace-picks">
            <button type="button" className="mx-text-button" disabled={tickedCount === tickable.length} onClick={() => { setTicked(new Set(tickable)) }}>Select all</button>
            <button type="button" className="mx-text-button" disabled={tickedCount === 0} onClick={() => { setTicked(new Set()) }}>Select none</button>
          </div>
        )}
        {rows.length > 0 && (
          <section className="mx-workspace-section" aria-label="Sessions">
            <div className="mx-workspace-head">
              <h3 className="mx-import-folder">Sessions</h3>
            </div>
            <ul className="mx-recent-list" aria-label="Sessions">
              {rows.map((row) => (
                <li key={row.key}>
                  <label className="mx-recent-row mx-workspace-row" title={row.name}>
                    <input type="checkbox" data-bare checked={ticked.has(row.key)} onChange={() => { toggle(row.key) }} />
                    <AppIcon process={row.agent} size={20} />
                    <span className="mx-recent-text">
                      <span className="mx-recent-title">{row.name}</span>
                      <span className="mx-recent-where">{rowWhere(row)}</span>
                    </span>
                    <span className={`mx-recent-when is-${row.state}`}>{rowWhen(row, now)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        )}
        <WorktreesSection name={name} read={worktrees} ticked={ticked} refused={refused} note={note} sectionRef={section} onToggle={toggle} onRetry={onRetryWorktrees} />
      </ModalBody>
      <ModalFoot left={tickable.length > 0 ? <span className="mx-workspace-count" role="status">{`${String(tickedCount)} of ${String(tickable.length)} ticked`}</span> : undefined}>
        <Button type="button" variant="ghost" size="lg" onClick={onCancel}>Done</Button>
        <Button type="button" variant="danger" size="lg" disabled={toRemove.length === 0} aria-label={removeName(toRemove.length)} onClick={() => { setAsking(true) }}>{removeLabel(toRemove.length)}</Button>
        <Button type="button" variant="danger" size="lg" disabled={toClose.length === 0} aria-label={closeName(toClose.length)} onClick={() => { onClose(toClose) }}>{closeLabel(toClose.length)}</Button>
        <Button type="button" variant="ghost" size="lg" disabled={closedRows.length === 0 || opening} onClick={() => { open(closedRows) }}>Open everything</Button>
        <Button type="button" variant="primary" size="lg" disabled={toOpen.length === 0 || opening} onClick={() => { open(toOpen) }}>{openLabel(toOpen.length, opening)}</Button>
      </ModalFoot>
    </>
  )
}
