import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { switchBranch } from '@/api/daemon'
import { toast } from '@/lib/toast'
import { Icon } from '@/features/workspace/components/glyphs'
import { ChipMenu, type ChipItem } from '@/features/workspace/components/NewChatMenus'
import { useFolderBranches } from '@/features/workspace/model/newChatHost'

/** Where a running chat's folder can be moved to, and how. */
export type BranchMenuSpec = {
  /** The session's own folder (a worktree's, not the repository's). */
  folder: string
  /** Opens the dialog that makes a worktree for this session's repository; absent where it cannot. */
  onNewWorktree?: (() => void) | undefined
  /** Why the move cannot happen now; the row stays but is off, and says why. */
  newWorktreeBlocked?: string | undefined
}

/**
 * The branch crumb of a chat's pane header (layout 2h): it opens, under the header, **Branch in <project>** with the
 * folder's branches, the current one ticked. Picking another switches the folder's branch, so the agent's next edits go
 * there; work already done stays on its branch.
 */
export function BranchMenu({ spec, branch, worktree, project }: { spec: BranchMenuSpec; branch: string; worktree: boolean; project: string }) {
  const queryClient = useQueryClient()
  const [read, reload] = useFolderBranches(spec.folder)
  const [busy, setBusy] = useState(false)
  const inTree = useMemo(() => new Set((read?.worktrees ?? []).flatMap((tree) => (tree.branch === null ? [] : [tree.branch]))), [read])
  const move = (name: string) => {
    if (busy || name === branch) return
    setBusy(true)
    switchBranch(spec.folder, name, false)
      // The branch chip shows the new branch, so the switch needs no toast.
      .then(() => { reload(); return queryClient.invalidateQueries({ queryKey: ['conversations'] }) })
      .catch((error: unknown) => { toast.failed(`Could not switch to ${name}`, error) })
      .finally(() => { setBusy(false) })
  }
  const rows: ChipItem[] = (read?.branches ?? [{ name: branch, when: null }]).map((entry) => ({
    key: entry.name,
    label: entry.name,
    ...(entry.name === branch ? { sub: 'This chat is on it' } : inTree.has(entry.name) ? { sub: 'worktree' } : {}),
    icon: <Icon name={inTree.has(entry.name) ? 'worktree' : 'branch'} size={13} />,
    checked: entry.name === branch,
    disabled: busy || (inTree.has(entry.name) && entry.name !== branch),
    onPick: () => { move(entry.name) },
  }))
  return (
    <ChipMenu
      title="Change branch"
      summary={branch}
      side="bottom"
      variant="crumb"
      heading={`Branch in ${project}`}
      width={300}
      label={<span className={`mx-crumb-branch${worktree ? ' is-worktree' : ''}`}>{branch}</span>}
      icon={<span className={`mx-crumb-branch-icon${worktree ? ' is-worktree' : ''}`}><Icon name={worktree ? 'worktree' : 'branch'} size={12} /></span>}
      sections={[{ heading: `Branch in ${project}`, items: rows }]}
      footer={(
        <>
          {spec.onNewWorktree !== undefined && <button type="button" className="mx-chip-action" onClick={spec.onNewWorktree} disabled={spec.newWorktreeBlocked !== undefined} title={spec.newWorktreeBlocked}><Icon name="worktree" size={12} />Move to a new worktree…</button>}
          <p className="mx-chip-note">Switching changes where the agent's next edits go. Work already done stays on its branch.</p>
        </>
      )}
    />
  )
}
