import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { switchBranch } from '@/api/daemon'
import { LOCAL_MACHINE } from '@/api/machines'
import { Icon } from '@/features/workspace/components/glyphs'
import { repoBranches, syncRemote, type SyncAction } from './api'
import type { ChangeActions } from './CommitBar'
import { remoteAction } from './remoteAction'
import { messageOf, useRepoQuery } from './useRepoQuery'

/** Where the menus mount: the app root, so they take the theme's colours. */
const menuRoot = () => document.querySelector<HTMLElement>('.mx-app')

/** What each remote choice does, as the split button's menu says it. */
function remoteChoices(ahead: number, behind: number): readonly { action: SyncAction; label: string; sub: string }[] {
  const commits = (count: number) => `${String(count)} commit${count === 1 ? '' : 's'}`
  return [
    { action: 'pull', label: 'Pull', sub: behind > 0 ? `Bring in ${commits(behind)} from origin` : 'Bring in what is new on origin' },
    { action: 'push', label: 'Push', sub: ahead > 0 ? `Send ${commits(ahead)} to origin` : 'Send this branch to origin' },
    { action: 'fetch', label: 'Fetch', sub: 'Check origin without changing your files' },
  ]
}

function BranchButton({ term, branch, folder, onNotice }: { term: number; branch: string; folder: string | null; onNotice: (text: string) => void }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  // Only a checkout on this computer can be switched from here; elsewhere the branch is just named.
  const branches = useRepoQuery(term, ['branches'], () => repoBranches(term), false, folder !== null)
  if (folder === null) return <span className="mx-changes-branch" title={`Branch ${branch}`}><Icon name="branch" size={11} />{branch}</span>
  const move = (name: string) => {
    setBusy(true)
    switchBranch(folder, name, false)
      .then(() => { onNotice(`Now on ${name}`); return queryClient.invalidateQueries({ queryKey: ['repo', term] }) })
      .catch((error: unknown) => { onNotice(messageOf(error)) })
      .finally(() => { setBusy(false) })
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="mx-changes-branch is-button" disabled={busy} title="Switch branch"><Icon name="branch" size={11} />{branch}<span aria-hidden="true">▾</span></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent container={menuRoot()} aria-label="Branches" align="start" className="mx-changes-menu">
        {(branches.data ?? [{ name: branch, current: true }]).map((entry) => (
          <DropdownMenuItem key={entry.name} className="mx-changes-menu-item" disabled={entry.current} onSelect={() => { move(entry.name) }}>
            <span className="mx-changes-menu-name">{entry.name}</span>
            {entry.current && <span className="mx-changes-menu-check" aria-label="current">✓</span>}
          </DropdownMenuItem>
        ))}
        <p className="mx-changes-menu-note">Switching changes where the agent's next edits go.</p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type Props = {
  term: number
  machine: number
  branch?: string | undefined
  ahead: number
  behind: number
  /** Where the checkout is, for the remote button; absent, there is none. */
  actions?: ChangeActions | undefined
  onChanged: () => void
  onNotice: (text: string) => void
}

/**
 * The Changes view's top bar (layout 2h): the branch (a menu of the others, for a checkout on this computer), how far it
 * is from its upstream, and the remote as a split button: the one move that fits now, with Pull, Push and Fetch beside it.
 */
export function ChangesBar({ term, machine, branch, ahead, behind, actions, onChanged, onNotice }: Props) {
  const [busy, setBusy] = useState<SyncAction | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const remote = remoteAction(ahead, behind)
  const sync = (action: SyncAction) => {
    if (!actions) return
    setBusy(action)
    setFailure(null)
    syncRemote(actions.folder, action, actions.machine, actions.term)
      .then((said) => { onNotice(said); onChanged() })
      .catch((error: unknown) => { setFailure(messageOf(error)) })
      .finally(() => { setBusy(null) })
  }
  const folder = actions !== undefined && machine === LOCAL_MACHINE && actions.term === undefined ? actions.folder : null
  return (
    <>
      <div className="mx-changes-bar">
        {branch !== undefined && branch !== '' && <BranchButton term={term} branch={branch} folder={folder} onNotice={onNotice} />}
        <span className="mx-spacer" />
        {(ahead > 0 || behind > 0) && <span className="mx-changes-sync" title="Commits ahead of and behind origin">↑{ahead} ↓{behind}</span>}
        {actions && (
          <span className="mx-split">
            <button type="button" className="mx-split-main" disabled={busy !== null || remote.blocked !== null} title={remote.blocked ?? remote.title} onClick={() => { sync(remote.action) }}>
              {busy !== null ? `${busy === 'pull' ? 'Pulling' : busy === 'push' ? 'Pushing' : 'Fetching'}…` : remote.label}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="mx-split-more" disabled={busy !== null} aria-label="More remote actions">▾</button>
              </DropdownMenuTrigger>
              <DropdownMenuContent container={menuRoot()} aria-label="Remote" align="end" className="mx-changes-menu">
                {remoteChoices(ahead, behind).map((choice) => (
                  <DropdownMenuItem key={choice.action} className="mx-changes-menu-item is-two-line" onSelect={() => { sync(choice.action) }}>
                    <span className="mx-changes-menu-name">{choice.label}</span>
                    <span className="mx-changes-menu-sub">{choice.sub}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        )}
      </div>
      {failure !== null && <p className="mx-commit-error" role="alert">{failure}</p>}
    </>
  )
}
