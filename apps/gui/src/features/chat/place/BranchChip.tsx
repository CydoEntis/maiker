import { useEffect, useState } from 'react'
import { checkoutRemoteBranch, createFolderBranch, loadFolderBranches, localBranches, localNameOf, switchFolderBranch, untrackedRemoteBranches, type FolderBranchList } from '@/api/folderGit'
import { errorMessage } from '@/lib/error-message'
import { toast } from '@/lib/toast'
import { Icon } from '@/features/workspace/components/glyphs'
import { InlineName } from '@/features/workspace/components/InlineName'
import { ChipMenu, type ChipItem } from '@/features/workspace/components/NewChatMenus'
import { branchNameError } from '@/features/workspace/model/branchName'
import { PlaceHead } from './PlaceHead'
import type { BranchPicking } from './picking'
import { WorkInSwitch } from './WorkInSwitch'

const WIDTH = 320
const NAME_MAX = 100

type Props = {
  folder: string
  machine: number
  branch: string
  project: string
  /** The worktree's name, when the session works in one. */
  worktreeName: string | null
  /** Given for a draft: a pick is kept for the start instead of switching the folder now. */
  picking?: BranchPicking | undefined
}

type Read = { kind: 'idle' } | { kind: 'listed'; list: FolderBranchList | null } | { kind: 'failed'; why: string }

/**
 * The row under the box's branch chip: the folder's branches on this computer or another machine, found or switched by
 * search, made from the one it is on, or taken from the remote. Every switch ends in a toast.
 */
export function BranchChip({ folder, machine, branch, project, worktreeName, picking }: Props) {
  const [openOwn, setOpenOwn] = useState(false)
  const open = picking?.open ?? openOwn
  const setOpen = (next: boolean) => { setOpenOwn(next); picking?.onOpenChange(next) }
  const [read, setRead] = useState<Read>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)
  const [naming, setNaming] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  // The branch after a switch made here, until the session's own reading catches up with it.
  const [moved, setMoved] = useState<{ from: string; now: string } | null>(null)
  const shown = moved?.from === branch ? moved.now : branch

  const change = (next: boolean) => {
    setOpen(next)
    if (!next) { setRead({ kind: 'idle' }); setNaming(false); setNameError(null) }
  }
  // The branches are read each time the menu opens, from the chip or from outside.
  useEffect(() => {
    if (!open) return undefined
    let live = true
    loadFolderBranches(machine, folder).then(
      (list) => { if (live) setRead({ kind: 'listed', list }) },
      (error: unknown) => { if (live) setRead({ kind: 'failed', why: errorMessage(error, 'The branches could not be read') }) },
    )
    return () => { live = false }
  }, [open, folder, machine])
  const go = (failed: string, act: () => Promise<string>, said: (name: string) => string) => {
    if (busy) return
    setBusy(true)
    act()
      .then((name) => { setMoved({ from: branch, now: name }); toast.success(said(name), { context: project }) })
      .catch((error: unknown) => { toast.failed(failed, error, { context: project }) })
      .finally(() => { setBusy(false) })
  }
  const create = (name: string) => {
    if (picking !== undefined) picking.onPick(name, true)
    else go(`Could not create ${name}`, () => createFolderBranch(machine, folder, name), (made) => `Created ${made} and switched to it`)
  }
  const commitName = (name: string) => {
    if (name === '') { setNaming(false); return }
    const refused = branchNameError(name)
    if (refused !== null) { setNameError(refused); return }
    setOpen(false)
    setNaming(false)
    create(name)
  }

  const list = read.kind === 'listed' ? read.list : null
  // A draft works in the folder's own checkout, so the branch that checkout is on is not "in another worktree".
  const inTree = new Set((list?.worktrees ?? []).flatMap((tree) => (tree.branch === null || (picking !== undefined && tree.main) ? [] : [tree.branch])))
  const local: ChipItem[] = (list === null ? [] : localBranches(list)).map((entry) => ({
    key: entry.name,
    label: entry.name,
    mono: true,
    icon: <Icon name={inTree.has(entry.name) ? 'worktree' : 'branch'} size={13} />,
    ...(inTree.has(entry.name) && entry.name !== shown ? { sub: 'in another worktree' } : {}),
    ...(picking?.busy.has(entry.name) === true ? { sub: `In use by “${picking.busy.get(entry.name) ?? ''}”`, right: <span className="mx-nc-in-use">in use</span> } : {}),
    checked: entry.name === shown,
    disabled: busy || (inTree.has(entry.name) && entry.name !== shown),
    onPick: () => { if (picking !== undefined) { setOpen(false); picking.onPick(entry.name, false) } else if (entry.name !== shown) go(`Could not switch to ${entry.name}`, () => switchFolderBranch(machine, folder, entry.name), (now) => `Switched to ${now}`) },
  }))
  const remote: ChipItem[] = (list === null ? [] : untrackedRemoteBranches(list)).map((entry) => ({
    key: `remote:${entry.name}`,
    label: entry.name,
    mono: true,
    icon: <Icon name="branch" size={13} />,
    checked: false,
    disabled: busy,
    onPick: () => { if (picking !== undefined) { setOpen(false); picking.onPick(localNameOf(entry.name), false) } else go(`Could not check out ${entry.name}`, () => checkoutRemoteBranch(machine, folder, entry.name), (now) => `Checked out ${now}, tracking ${entry.name}`) },
  }))
  const exists = (name: string) => local.some((item) => item.key === name) || remote.some((item) => localNameOf(item.label) === name)
  const fromQuery = (query: string): ChipItem | null => (
    branchNameError(query) !== null || exists(query) || list === null
      ? null
      : { key: 'create', label: `Create branch ${query}`, mono: true, icon: <Icon name="plus" size={13} />, checked: false, onPick: () => { create(query) } }
  )
  const sections = [
    ...(local.length === 0 ? [] : [{ heading: 'Local', items: local }]),
    ...(remote.length === 0 ? [] : [{ heading: 'Remote', items: remote }]),
  ]
  return (
    <ChipMenu
      title={`Branch ${shown}`}
      summary={shown}
      chevron={false}
      triggerClass="mx-place-chip is-branch"
      width={WIDTH}
      open={open}
      onOpenChange={change}
      icon={<span className="mx-place-icon is-branch"><Icon name="branch" size={12} /></span>}
      label={<span className="mx-place-text is-mono">{shown}</span>}
      header={<PlaceHead mono main={shown} sub={picking?.worktree === true ? `New worktree · ${project}` : worktreeName === null ? `Branch in ${project}` : `Worktree ${worktreeName} · ${project}`} />}
      search="Find or switch branch"
      sections={sections}
      fromQuery={fromQuery}
      queryError={branchNameError}
      below={picking === undefined ? undefined : <WorkInSwitch worktree={picking.worktree} onWorktree={picking.onWorktree} />}
      extra={read.kind === 'failed' ? <p role="alert" className="mx-chip-refused"><span>{read.why}</span></p> : open && read.kind === 'idle' ? <p className="mx-chip-none" role="status">Reading branches…</p> : undefined}
      footer={naming ? (
        <>
          <InlineName value="" placeholder="new-branch-name" label="New branch name" maxLength={NAME_MAX} onCommit={commitName} onCancel={() => { setNaming(false); setNameError(null) }} />
          {nameError !== null && <p role="alert" className="mx-chip-refused">{nameError}</p>}
        </>
      ) : (
        <button type="button" className="mx-chip-action" disabled={busy} onClick={() => { setNaming(true) }}><Icon name="plus" size={12} />New branch from <span className="mx-chip-mono">{shown}</span>…</button>
      )}
    />
  )
}
