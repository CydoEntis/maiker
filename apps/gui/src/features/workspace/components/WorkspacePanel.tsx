import { useState } from 'react'
import type { ClosedSession } from '@/api/daemon'
import { nowSeconds } from '../model/newChatHost'
import type { SessionView } from '../model/session'
import { savedOf, useSavedWorkspace, workspaceRows, type WorkspaceFor } from '../model/workspacePanel'
import { WorkspacePanelDialog } from './WorkspacePanelDialog'

type Props = {
  target: WorkspaceFor
  sessions: readonly SessionView[]
  /** An Open is under way, or another session is starting. */
  opening: boolean
  /** Opens saved sessions again (`useRecentSessions().openSaved`), naming the project in its toast. */
  onOpen: (saved: readonly ClosedSession[], where: string) => void
  onCancel: () => void
}

/** A project's Workspace panel: its sessions in the window as they change, and its saved set, read once as it opens. */
export function WorkspacePanel({ target, sessions, opening, onOpen, onCancel }: Props) {
  const { read, retry } = useSavedWorkspace(target.project.folder)
  const [now] = useState(nowSeconds)
  return (
    <WorkspacePanelDialog
      name={target.name}
      rows={workspaceRows(sessions, savedOf(read))}
      saved={read}
      now={now}
      opening={opening}
      onOpen={(saved) => { onOpen(saved, target.name) }}
      onRetry={retry}
      onCancel={onCancel}
    />
  )
}
