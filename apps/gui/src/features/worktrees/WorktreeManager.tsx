import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SkeletonLines } from '@/components/ui/skeleton'
import { Tag } from '@/components/ui/tag'
import { useState } from 'react'
import type { RepoWorktree } from '@/features/inspect/api'
import { messageOf } from '@/features/inspect/useRepoQuery'
import { mergeWorktree, recreateWorktree, removeWorktrees, worktreeOverlaps, worktreeStanding } from './api'
import { ageWords, lossOfRemoving, mergeBlock, overlapWords, standingTag, standingTone, standingWords } from './worktreeAdvice'

/** How long the daemon is given to remove a worktree before the list is read again. */
const REMOVE_SETTLE_MS = 1500

type RowProps = { entry: RepoWorktree; /** The main checkout's folder, where a missing worktree is made again from. */ main: string | null; machine: number; onChanged: () => void }

function WorktreeRow({ entry, main, machine, onChanged }: RowProps) {
  const standing = useQuery({ queryKey: ['worktree-standing', machine, entry.path], queryFn: () => worktreeStanding(main ?? entry.path, entry.path, machine), retry: false })
  const client = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [sure, setSure] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['worktree-standing', machine, entry.path] })
    onChanged()
  }
  const run = (work: () => Promise<string | null>) => {
    setBusy(true)
    setNote(null)
    work()
      .then((said) => { setNote(said) })
      .catch((error: unknown) => { setNote(messageOf(error)) })
      .finally(() => { setBusy(false); setSure(false); refresh() })
  }
  if (standing.isError) return <li className="mx-wt-row"><strong>{entry.branch}</strong><span className="mx-wt-age">{messageOf(standing.error)}</span></li>
  if (!standing.data) return <li className="mx-wt-row"><strong>{entry.branch}</strong><SkeletonLines label="Reading" lines={1} className="inline-flex w-24 align-middle" /></li>
  const data = standing.data
  if (data.missing) {
    return (
      <li className="mx-wt-row">
        <strong title={entry.path}>{entry.branch}</strong>
        <span className="mx-wt-tag"><Tag tone="err">{standingTag(data)}</Tag></span>
        <span className="mx-wt-actions">
          <Button type="button" variant="ghost" size="sm" disabled={busy || main === null || entry.branch.startsWith('(')} title={entry.branch.startsWith('(') ? 'It was on no branch, so there is nothing to make it from.' : `Makes ${entry.branch} again at ${entry.path}`} onClick={() => { if (main !== null) run(() => recreateWorktree(main, entry.path, entry.branch, machine)) }}>Recreate</Button>
        </span>
        {note !== null && <small role="status" className="mx-wt-more">{note}</small>}
      </li>
    )
  }
  const loss = lossOfRemoving(data)
  const blocked = mergeBlock(data)
  const remove = () => {
    run(async () => {
      await removeWorktrees([{ path: entry.path, force: data.dirty > 0 }], machine)
      // The daemon removes it in the background and leaves one something still runs in.
      await new Promise((settle) => { window.setTimeout(settle, REMOVE_SETTLE_MS) })
      return 'Asked the service to remove it. If it is still listed, something is running in it: close that first.'
    })
  }
  return (
    <li className={sure ? 'mx-wt-row is-asking' : 'mx-wt-row'}>
      <strong title={entry.path}>{entry.branch}</strong>
      <span className="mx-wt-tag"><Tag tone={standingTone(data)}>{standingTag(data)}</Tag></span>
      <span className="mx-wt-age" title={standingWords(data)}>{ageWords(data)}</span>
      <span className="mx-wt-actions">
        <Button type="button" variant="ghost" size="sm" disabled={busy || blocked !== null} title={blocked ?? `Merge ${entry.branch} into the main checkout's branch (no fast-forward)`} onClick={() => { run(() => mergeWorktree(entry.path, machine)) }}>Merge</Button>
        {!sure && <Button type="button" variant="ghost" size="sm" disabled={busy} title="Removes the folder; the branch stays unless it is merged. Close what runs in it first" onClick={() => { if (loss === null) remove(); else setSure(true) }}>Remove</Button>}
      </span>
      {sure && (
        <span className="mx-wt-more">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { setSure(false) }}>Keep</Button>
          <Button type="button" variant="danger" size="sm" disabled={busy} onClick={remove}>{`Lose ${loss ?? 'nothing'}? Remove`}</Button>
        </span>
      )}
      {note !== null && <small role="status" className="mx-wt-more">{note}</small>}
    </li>
  )
}

type Props = { worktrees: readonly RepoWorktree[]; machine: number; repoName: string; onChanged: () => void }

/** The project's other worktrees, folded away until asked for: one line each with name, status, age and Merge / Remove (shown on hover or focus in a column of their own, so they never cover the text). */
export function WorktreeManager({ worktrees, machine, repoName, onChanged }: Props) {
  const [open, setOpen] = useState(false)
  const linked = worktrees.filter((entry) => !entry.main)
  const main = worktrees.find((entry) => entry.main)?.path ?? null
  // Two checkouts that changed one file only meet as a conflict at merge time; saying so now is cheaper.
  const overlaps = useQuery({
    queryKey: ['worktree-overlaps', machine, worktrees.map((entry) => entry.path)],
    queryFn: () => worktreeOverlaps(worktrees.map((entry) => ({ name: entry.branch, path: entry.path })), machine),
    enabled: linked.length > 0,
    retry: false,
  })
  if (linked.length === 0) return null
  return (
    <section className="mx-wt-list" aria-label="Existing worktrees">
      <button type="button" className="mx-wt-list-head" aria-expanded={open} onClick={() => { setOpen((now) => !now) }}>
        <ChevronRight aria-hidden="true" size={12} className="mx-wt-chevron" />
        <span>Existing worktrees</span>
        <span className="mx-wt-count">{linked.length}</span>
      </button>
      <p className="mx-wt-hint">Other worktrees of {repoName}</p>
      {(overlaps.data ?? []).length > 0 && (
        <p className="mx-wt-overlap" role="status">
          {overlapWords(overlaps.data ?? [])}
        </p>
      )}
      {open && (
        <ul className="mx-wt-rows">
          {linked.map((entry) => <WorktreeRow key={entry.path} entry={entry} main={main} machine={machine} onChanged={onChanged} />)}
        </ul>
      )}
    </section>
  )
}
