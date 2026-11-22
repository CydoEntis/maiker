import { useState, type MouseEvent } from 'react'
import { SkeletonLines } from '@/components/ui/skeleton'
import { LOCAL_MACHINE } from '@/api/machines'
import { repoDiff, repoDiffRange, repoSnapshots, repoStatus, type RepoDiff } from './api'
import { changeKind } from './changeKind'
import { ChangesBar } from './ChangesBar'
import { CommitBar, type ChangeActions } from './CommitBar'
import { type FileActions, useFileMenu } from './fileMenu'
import { RepoError } from './RepoError'
import { turnRange, type MissingSnapshot, type SnapshotRange, type TurnSpan } from './turnRange'
import { messageOf, useRepoQuery } from './useRepoQuery'

export const CHANGES_REFRESH_MS = 4000

type ChangedFile = RepoDiff['files'][number]
/** A path as its folder (with the trailing slash) and its name. */
function splitPath(path: string): { folder: string; name: string } {
  const cut = path.lastIndexOf('/') + 1
  return { folder: path.slice(0, cut), name: path.slice(cut) }
}

/** A turn whose changes are asked for instead of the whole working tree; `turn` is null when its times are unknown. */
export type TurnScope = { turn: TurnSpan | null; onAllChanges: () => void }

/**
 * The diff to list: the working tree against HEAD, or, for a turn, the diff between the snapshots around it. A turn
 * whose snapshots cannot be picked falls back to the working tree and says why.
 */
function useScopedDiff(term: number, scope: TurnScope | undefined, machine: number) {
  const local = machine === LOCAL_MACHINE
  // The daemon's snapshots are read on this computer only, so a turn on another machine shows its working tree.
  const turn = local ? scope?.turn ?? null : null
  // Keyed by the turn: a list read before a later turn ended would not hold that turn's end snapshot.
  const snapshots = useRepoQuery(term, ['snapshots', 'turn', turn?.startedAtMs, turn?.endedAtMs], () => repoSnapshots(term), false, turn !== null)
  const picked = turn !== null && snapshots.data ? turnRange(snapshots.data, turn) : null
  const range = picked !== null && 'from' in picked ? picked : null
  const query = useRepoQuery(
    term,
    range ? ['range', range.from, range.to] : ['diff', ...(local ? [] : [machine])],
    () => (range ? repoDiffRange(term, range.from, range.to) : repoDiff(term, null, machine)),
    range ? false : CHANGES_REFRESH_MS,
  )
  const waiting = turn !== null && (snapshots.isPending || snapshots.isFetching)
  if (scope === undefined || waiting || range !== null) return { query, waiting, range, shown: range === null ? 'tree' as const : 'turn' as const, why: null }
  const why = local ? fallbackReason(turn, snapshots.isError ? snapshots.error : null, picked) : "a turn's changes are only read on this computer"
  return { query, waiting, range, shown: 'tree' as const, why }
}

/** Why a turn's changes row shows the whole working tree instead. */
function fallbackReason(turn: TurnSpan | null, error: unknown, picked: MissingSnapshot | SnapshotRange | null): string {
  if (turn === null) return 'this turn has no times to find its snapshots by'
  if (error !== null) return `couldn't read the snapshots: ${messageOf(error)}`
  return picked !== null && 'missing' in picked && picked.missing === 'after' ? 'no snapshot from after this turn is kept' : 'no snapshot from before this turn is kept'
}

function ScopeLine({ shown, why, onAllChanges }: { shown: 'tree' | 'turn'; why: string | null; onAllChanges: () => void }) {
  if (shown === 'tree') return <p className="mx-changes-scope">Whole working tree · {why}</p>
  return (
    <div className="mx-changes-scope">
      <h3>This turn's changes</h3>
      <button type="button" className="mx-inspect-action" onClick={onAllChanges}>All changes</button>
    </div>
  )
}

type Props = {
  term: number
  /** The machine the pane is on (0: this computer), whose daemon is asked. */
  machine?: number
  /** The branch the checkout is on, shown above the files. */
  branch?: string
  /** Opens a changed file's diff in the file pane, and the file's right-click menu. */
  files: FileActions
  /** The commit bar: Commit, the remote button and Create PR, run where the checkout is. */
  actions?: ChangeActions
  /** A turn's changes row opened the tab: show what that turn changed. */
  scope?: TurnScope
  onNotice: (text: string) => void
}

function FileRow({ file, current, ticked, onTick, onPick, onMenu }: { file: ChangedFile; current: boolean; ticked: boolean | null; onTick: () => void; onPick: () => void; onMenu: (event: MouseEvent) => void }) {
  const kind = changeKind(file.patch)
  const { folder, name } = splitPath(file.path)
  return (
    <div className="mx-changes-line">
      {ticked !== null && <input type="checkbox" className="mx-changes-tick" aria-label={`Commit ${file.path}`} checked={ticked} onChange={onTick} />}
    <button type="button" className={`mx-changes-row${current ? ' is-current' : ''}`} aria-current={current ? 'true' : undefined} title={file.path} onClick={onPick} onContextMenu={onMenu}>
      <span className={`mx-changes-letter is-${kind.tone}`} title={kind.word}>{kind.letter}</span>
      <span className="mx-changes-name">
        <b>{name}</b>
        {folder !== '' && <small>{folder.slice(0, -1)}</small>}
      </span>
      <span className="mx-changes-count">
        {file.additions > 0 && <span className="is-add">+{file.additions}</span>}
        {file.deletions > 0 && <span className="is-remove">−{file.deletions}</span>}
      </span>
    </button>
    </div>
  )
}

/** The session's uncommitted changes: the changed files with the commit under them. A file's diff opens in the file pane. */
export function ChangesTab({ term, machine = LOCAL_MACHINE, branch, files: fileActions, actions: treeActions, scope, onNotice }: Props) {
  // Each machine numbers its own panes, so another machine's answers are kept under its number too.
  const elsewhere = machine === LOCAL_MACHINE ? [] : [machine]
  const { query, waiting, range, shown, why } = useScopedDiff(term, scope, machine)
  const menu = useFileMenu('changes', fileActions)
  // A commit takes the working tree, so it is not offered beside one turn's changes.
  const actions = shown === 'turn' ? undefined : treeActions
  // How far the branch is from its upstream, for the remote button; without it (an error, no upstream) the branch reads as level.
  const status = useRepoQuery(term, ['status', ...elsewhere], () => repoStatus(term, machine), CHANGES_REFRESH_MS)
  // Files unticked, so left out of the commit; every changed file starts ticked.
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(() => new Set())
  if (waiting || query.isPending) return <SkeletonLines label="Reading changes" lines={5} className="mx-inspect-note" />
  if (query.isError) return <RepoError error={query.error} tab="changes" onRetry={() => { void query.refetch() }} retrying={query.isFetching} />
  const { files } = query.data
  const chosen = files.filter((file) => !skipped.has(file.path))
  const everything = chosen.length === files.length
  const tick = (path: string) => { setSkipped((current) => { const next = new Set(current); if (!next.delete(path)) next.add(path); return next }) }
  // A file of one turn's changes opens as that turn's diff, so the pane shows what the row counted.
  const how = range === null ? {} : { range }
  const ticked = actions ? (everything ? 'all' : chosen.length === 0 ? 'none' : 'some') : null
  const tickAll = () => { setSkipped(everything ? new Set(files.map((file) => file.path)) : new Set()) }
  const reread = () => { void query.refetch(); void status.refetch() }
  return (
    <div className="mx-changes">
      <ChangesBar term={term} machine={machine} branch={status.data?.branch ?? branch} ahead={status.data?.ahead ?? 0} behind={status.data?.behind ?? 0} actions={treeActions} onChanged={reread} onNotice={onNotice} />
      {scope && <ScopeLine shown={shown} why={why} onAllChanges={scope.onAllChanges} />}
      {files.length > 0 ? (
        <>
          <div className="mx-changes-all">
            {ticked !== null && <input type="checkbox" className="mx-changes-tick" aria-label="Commit every changed file" checked={ticked === 'all'} ref={(box) => { if (box) box.indeterminate = ticked === 'some' }} onChange={tickAll} />}
            <span className="mx-changes-all-count">{files.length} changed</span>
            <span className="mx-changes-count">
              {query.data.additions > 0 && <span className="is-add">+{query.data.additions}</span>}
              {query.data.deletions > 0 && <span className="is-remove">−{query.data.deletions}</span>}
            </span>
          </div>
          <ul className="mx-changes-list" aria-label="Changed files">
            {files.map((file) => (
              <li key={file.path}>
                <FileRow
                  file={file}
                  current={file.path === fileActions.openPath}
                  ticked={actions ? !skipped.has(file.path) : null}
                  onTick={() => { tick(file.path) }}
                  onPick={() => { fileActions.onOpen(file.path, 'changes', how) }}
                  onMenu={(event) => { menu.open(event, { path: file.path, changed: true, deleted: changeKind(file.patch).letter === 'D', range: range ?? undefined }) }}
                />
              </li>
            ))}
            {query.data.truncated && <li className="mx-inspect-note">Showing {files.length} of {query.data.total_files} files.</li>}
          </ul>
        </>
      ) : (
        <div className="mx-changes-none">
          <strong>{shown === 'turn' ? 'This turn left the files as they were' : 'No changes yet'}</strong>
          <span>Files the agent edits show up here. Pick one to read its diff beside the chat.</span>
        </div>
      )}
      {menu.popup}
      {actions && <CommitBar {...actions} files={files.length} chosen={chosen} everything={everything} onChanged={reread} onNotice={onNotice} />}
    </div>
  )
}
