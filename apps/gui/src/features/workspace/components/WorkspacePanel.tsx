import { useState } from 'react'
import { nowSeconds } from '../model/newChatHost'
import type { SessionView } from '../model/session'
import { savedOf, useSavedWorkspace, workspaceRows, type WorkspaceFor } from '../model/workspacePanel'
import { WorkspacePanelDialog } from './WorkspacePanelDialog'

/** A project's Workspace panel: its sessions in the window as they change, and its saved set, read once as it opens. */
export function WorkspacePanel({ target, sessions, onCancel }: { target: WorkspaceFor; sessions: readonly SessionView[]; onCancel: () => void }) {
  const { read, retry } = useSavedWorkspace(target.project.folder)
  const [now] = useState(nowSeconds)
  return <WorkspacePanelDialog name={target.name} rows={workspaceRows(sessions, savedOf(read))} saved={read} now={now} onRetry={retry} onCancel={onCancel} />
}
