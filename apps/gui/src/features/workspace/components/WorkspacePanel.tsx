import { useState } from 'react'
import type { ClosedSession } from '@/api/daemon'
import { nowSeconds } from '../model/newChatHost'
import type { SessionView } from '../model/session'
import { savedOf, useSavedWorkspace, workspaceRows, type WorkspaceFor } from '../model/workspacePanel'
import { useWorkspaceWorktrees } from '../useWorkspaceWorktrees'
import { WorkspacePanelDialog } from './WorkspacePanelDialog'

type Props = {
  target: WorkspaceFor
  sessions: readonly SessionView[]
  /** Every session of the window, on any project: a worktree one of them runs in cannot be removed. */
  windowSessions: readonly SessionView[]
  /** An Open is under way, or another session is starting. */
  opening: boolean
  /** Opens saved sessions again (`useRecentSessions().openSaved`), naming the project in its toast. */
  onOpen: (saved: readonly ClosedSession[], where: string) => void
  /** Ends sessions of the window, asking first (`useClosing().closeSessions`). */
  onClose: (sessionIds: readonly string[]) => void
  onCancel: () => void
}

/**
 * A project's Workspace panel: its sessions in the window as they change, its saved set, read once as it opens, and its
 * worktrees, each with its standing as it arrives.
 */
export function WorkspacePanel({ target, sessions, windowSessions, opening, onOpen, onClose, onCancel }: Props) {
  const { read, retry } = useSavedWorkspace(target.project.folder)
  const worktrees = useWorkspaceWorktrees(target.project.folder, windowSessions)
  const [now] = useState(nowSeconds)
  return (
    <WorkspacePanelDialog
      name={target.name}
      rows={workspaceRows(sessions, savedOf(read))}
      saved={read}
      worktrees={worktrees.read}
      now={now}
      opening={opening}
      onOpen={(saved) => { onOpen(saved, target.name) }}
      onClose={onClose}
      onRemove={worktrees.remove}
      onRetry={retry}
      onRetryWorktrees={worktrees.retry}
      onCancel={onCancel}
    />
  )
}
