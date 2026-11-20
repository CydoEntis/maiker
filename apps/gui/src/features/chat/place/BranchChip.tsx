import { useState } from 'react'
import { checkoutRemoteBranch, createFolderBranch, loadFolderBranches, localBranches, localNameOf, switchFolderBranch, untrackedRemoteBranches, type FolderBranchList } from '@/api/folderGit'
import { errorMessage } from '@/lib/error-message'
import { toast } from '@/lib/toast'
import { Icon } from '@/features/workspace/components/glyphs'
import { InlineName } from '@/features/workspace/components/InlineName'
import { ChipMenu, type ChipItem } from '@/features/workspace/components/NewChatMenus'
import { branchNameError } from '@/features/workspace/model/branchName'
import { PlaceHead } from './PlaceHead'

const WIDTH = 320
const NAME_MAX = 100

type Props = {
  folder: string
  machine: number
  branch: string
  project: string
  /** The worktree's name, when the session works in one. */
  worktreeName: string | null
}

type Read = { kind: 'idle' } | { kind: 'loading' } | { kind: 'listed'; list: FolderBranchList | null } | { kind: 'failed'; why: string }

/**
 * The row under the box's branch chip: the folder's branches on this computer or another machine, found or switched by
 * search, made from the one it is on, or taken from the remote. Every switch ends in a toast.
 */
export function BranchChip({ folder, machine, branch, project, worktreeName }: Props) {
  const [open, setOpen] = useState(false)
  const [read, setRead] = useState<Read>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)
  const [naming, setNaming] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  // The branch after a switch made here, until the session's own reading catches up with it.
  const [moved, setMoved] = useState<{ from: string; now: string } | null>(null)
  const shown = moved?.from === branch ? moved.now : branch

  const load = () => {
    setRead({ kind: 'loading' })
    loadFolderBranches(machine, folder).then(
      (list) => { setRead({ kind: 'listed', list }) },
      (error: unknown) => { setRead({ kind: 'failed', why: errorMessage(error, 'The branches could not be read') }) },
    )
  }
  const change = (next: boolean) => {
    setOpen(next)
    if (next) load()
    else { setNaming(false); setNameError(null) }
  }
  const go = (failed: string, act: () => Promise<string>, said: (name: string) => string) => {
    if (busy) return
    setBusy(true)
    act()
      .then((name) => { setMoved({ from: branch, now: name }); toast.success(said(name), { context: project }) })
      .catch((error: unknown) => { toast.failed(failed, error, { context: project }) })
      .finally(() => { setBusy(false) })
  }
  const create = (name: string) => { go(`Could not create ${name}`, () => createFolderBranch(machine, folder, name), (made) => `Created ${made} and switched to it`) }
  const commitName = (name: string) => {
    if (name === '') { setNaming(false); return }
    const refused = branchNameError(name)
    if (refused !== null) { setNameError(refused); return }
    setOpen(false)
    setNaming(false)
    create(name)
  }

  const list = read.kind === 'listed' ? read.list : null
  const inTree = new Set((list?.worktrees ?? []).flatMap((tree) => (tree.branch === null ? [] : [tree.branch])))
  const local: ChipItem[] = (list === null ? [] : localBranches(list)).map((entry) => ({
    key: entry.name,
    label: entry.name,
    mono: true,
    icon: <Icon name={inTree.has(entry.name) ? 'worktree' : 'branch'} size={13} />,
    ...(inTree.has(entry.name) && entry.name !== shown ? { sub: 'in another worktree' } : {}),
    checked: entry.name === shown,
    disabled: busy || (inTree.has(entry.name) && entry.name !== shown),
    onPick: () => { if (entry.name !== shown) go(`Could not switch to ${entry.name}`, () => switchFolderBranch(machine, folder, entry.name), (now) => `Switched to ${now}`) },
  }))
  const remote: ChipItem[] = (list === null ? [] : untrackedRemoteBranches(list)).map((entry) => ({
    key: `remote:${entry.name}`,
    label: entry.name,
    mono: true,
    icon: <Icon name="branch" size={13} />,
    checked: false,
    disabled: busy,
    onPick: () => { go(`Could not check out ${entry.name}`, () => checkoutRemoteBranch(machine, folder, entry.name), (now) => `Checked out ${now}, tracking ${entry.name}`) },
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
      header={<PlaceHead mono main={shown} sub={worktreeName === null ? `Branch in ${project}` : `Worktree ${worktreeName} · ${project}`} />}
      search="Find or switch branch"
      sections={sections}
      fromQuery={fromQuery}
      queryError={branchNameError}
      extra={read.kind === 'failed' ? <p role="alert" className="mx-chip-refused"><span>{read.why}</span></p> : read.kind === 'loading' ? <p className="mx-chip-none" role="status">Reading branches…</p> : undefined}
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
