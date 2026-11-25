import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { ModalBody, ModalFoot, ModalHead } from '@/components/ui/modal'
import { RestartServiceButton } from '@/features/updates/RestartServiceButton'
import type { ClosedSession } from '@/api/daemon'
import { openTargets, rowWhen, rowWhere, type SavedRead, type WorkspaceRow } from '../model/workspacePanel'
import { AppIcon } from './glyphs'
import { windowRoot } from './windowRoot'

type Props = {
  /** What the project's heading calls it. */
  name: string
  /** Every row: the project's sessions in the window, then its saved set (`workspaceRows`). */
  rows: readonly WorkspaceRow[]
  /** How the saved set's read went: the rows above hold none of it until it is listed. */
  saved: SavedRead
  /** When the panel opened (unix seconds): each row's age counts from it. */
  now: number
  /** An Open is under way, or another session is starting: Open and Open everything wait for it. */
  opening: boolean
  /** Opens these saved sessions again, one after another (`useRecentSessions().openSaved`). */
  onOpen: (saved: readonly ClosedSession[]) => void
  onRetry: () => void
  onCancel: () => void
}

/**
 * A project's workspace: its agent sessions running in the window and the ones open when it was last closed, each with a
 * tick, nothing ticked at first. Nothing starts, stops or is removed from here until an action is pressed.
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

function WorkspaceBody({ name, rows, saved, now, opening, onOpen, onRetry, onCancel }: Props) {
  // Keys of the ticked rows. A row that leaves the list (a session that ends and is closed) simply stops counting.
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = (key: string) => {
    setTicked((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }
  const chosen = rows.filter((row) => ticked.has(row.key))
  const empty = rows.length === 0 && saved.kind === 'listed'
  // Open starts only closed rows: a running one ticked beside them is left as it is.
  const toOpen = openTargets(chosen)
  const closedRows = openTargets(rows)
  // Either Open sends every ticked closed row, so those are unticked and the ticks left are the ones nothing was done to.
  const open = (list: readonly ClosedSession[]) => {
    onOpen(list)
    setTicked(new Set(chosen.filter((row) => row.state !== 'closed').map((row) => row.key)))
  }
  return (
    <>
      <ModalBody>
        {rows.length > 0 && <p>The agent sessions of {name} on this computer: the ones running now, and the ones open when it was last closed.</p>}
        <SavedLine read={saved} onRetry={onRetry} />
        {empty && <p role="status">No sessions here yet. The ones you start in {name}, and the ones open when it is closed, show here.</p>}
        {rows.length > 0 && (
          <section className="mx-workspace-section" aria-label="Sessions">
            <div className="mx-workspace-head">
              <h3 className="mx-import-folder">Sessions</h3>
              <button type="button" className="mx-text-button" disabled={chosen.length === rows.length} onClick={() => { setTicked(new Set(rows.map((row) => row.key))) }}>Select all</button>
              <button type="button" className="mx-text-button" disabled={chosen.length === 0} onClick={() => { setTicked(new Set()) }}>Select none</button>
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
      </ModalBody>
      <ModalFoot left={rows.length > 0 ? <span className="mx-workspace-count" role="status">{`${String(chosen.length)} of ${String(rows.length)} ticked`}</span> : undefined}>
        <Button type="button" variant="ghost" size="lg" onClick={onCancel}>Done</Button>
        <Button type="button" variant="ghost" size="lg" disabled={closedRows.length === 0 || opening} onClick={() => { open(closedRows) }}>Open everything</Button>
        <Button type="button" variant="primary" size="lg" disabled={toOpen.length === 0 || opening} onClick={() => { open(toOpen) }}>{openLabel(toOpen.length, opening)}</Button>
      </ModalFoot>
    </>
  )
}
