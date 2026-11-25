import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { ModalBody, ModalFoot, ModalHead } from '@/components/ui/modal'
import { RestartServiceButton } from '@/features/updates/RestartServiceButton'
import { rowWhen, rowWhere, tickableWorktrees, worktreeWhen, worktreeWhere, type SavedRead, type WorkspaceRow, type WorktreeRow, type WorktreesRead } from '../model/workspacePanel'
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

/** A worktree's row: a tick for a linked one, none for the main checkout, which is the project and never removed. */
function WorktreeItem({ row, ticked, onToggle }: { row: WorktreeRow; ticked: boolean; onToggle: () => void }) {
  const why = !row.main && row.standing.kind === 'failed' ? row.standing.why : undefined
  const text = (
    <>
      <span className="mx-workspace-mark"><Icon name={row.main ? 'repo' : 'worktree'} size={16} strokeWidth={1.8} /></span>
      <span className="mx-recent-text">
        <span className="mx-recent-title">{row.name}</span>
        <span className="mx-recent-where" title={why}>{worktreeWhere(row)}</span>
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
      <label className="mx-recent-row mx-workspace-row" title={row.path}>
        <input type="checkbox" data-bare checked={ticked} onChange={onToggle} />
        {text}
      </label>
    </li>
  )
}

type WorktreesProps = { name: string; read: WorktreesRead; ticked: ReadonlySet<string>; onToggle: (key: string) => void; onRetry: () => void }

/** The project's worktrees, the main checkout first; nothing at all for a folder outside git. */
function WorktreesSection({ name, read, ticked, onToggle, onRetry }: WorktreesProps) {
  if (read.kind === 'not-a-repo') return null
  return (
    <section className="mx-workspace-section" aria-label="Worktrees">
      <div className="mx-workspace-head">
        <h3 className="mx-import-folder">Worktrees</h3>
      </div>
      {read.kind === 'loading' && <p role="status">Looking for the worktrees of {name}…</p>}
      {read.kind === 'failed' && (
        <p role="status">
          Could not read the worktrees of {name}.{' '}
          <button type="button" className="mx-text-button" onClick={onRetry}>Try again</button>
        </p>
      )}
      {read.kind === 'listed' && (
        <ul className="mx-recent-list" aria-label="Worktrees">
          {read.rows.map((row) => <WorktreeItem key={row.key} row={row} ticked={ticked.has(row.key)} onToggle={() => { onToggle(row.key) }} />)}
        </ul>
      )}
    </section>
  )
}

function WorkspaceBody({ name, rows, saved, worktrees, now, onRetry, onRetryWorktrees, onCancel }: Props) {
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
        <WorktreesSection name={name} read={worktrees} ticked={ticked} onToggle={toggle} onRetry={onRetryWorktrees} />
      </ModalBody>
      <ModalFoot left={tickable.length > 0 ? <span className="mx-workspace-count" role="status">{`${String(tickedCount)} of ${String(tickable.length)} ticked`}</span> : undefined}>
        <Button type="button" variant="ghost" size="lg" onClick={onCancel}>Done</Button>
      </ModalFoot>
    </>
  )
}
