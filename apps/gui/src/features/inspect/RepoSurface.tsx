import { useState } from 'react'
import { LOCAL_MACHINE } from '@/api/machines'
import { ChangesTab, type TurnScope } from './ChangesTab'
import type { ChangeActions } from './CommitBar'
import { FilesTab, type DocumentLauncher, type LookAt } from './FilesTab'
import type { RepoSurfaceKind } from './panelTabs'
import type { PatchComments } from './PatchView'
import { ReferencesTab } from './ReferencesTab'

type Props = {
  kind: RepoSurfaceKind
  /** The daemon's pane number every repository question is about. */
  term: number
  /** The machine the session is on (0: this computer): its daemon answers Changes, and Files opens only what can be read from here. */
  machine?: number
  /** That machine's name, for those words; null on this computer. */
  machineName?: string | null
  /** The branch the session's checkout is on. */
  branch?: string
  lookAt: LookAt | null
  /** Opens a markdown file beside the chat (Files offers it), and names the checkout. */
  documents?: DocumentLauncher
  /** The agent a comment on a diff line goes to; absent for a shell, which has nobody to tell. */
  comments?: Omit<PatchComments, 'path' | 'sent' | 'onSent'>
  /** The Changes surface's commit area: Commit, the remote button and Create PR, run where the checkout is. */
  changeActions?: ChangeActions
  /** The turn a chat's changes row asked about, for Changes. */
  turnScope?: TurnScope
  onNotice: (text: string) => void
}

function FilesSurface({ term, machine, machineName, lookAt, documents }: { term: number; machine: number; machineName: string | null; lookAt: LookAt | null; documents?: DocumentLauncher | undefined }) {
  const [references, setReferences] = useState(false)
  // Another machine's files list and open as Markdown documents only (ADR 0014); its references stay there.
  if (machine !== LOCAL_MACHINE) return <FilesTab term={term} machine={machine} machineName={machineName} lookAt={lookAt} documents={documents} />
  if (!references) return <FilesTab term={term} machine={machine} lookAt={lookAt} documents={documents} onReferences={() => { setReferences(true) }} />
  return (
    <div className="mx-inspect-body">
      <nav className="mx-inspect-crumbs" aria-label="Where you are">
        <button type="button" onClick={() => { setReferences(false) }}>Files</button>
        <span aria-hidden="true">›</span>
        <span>References</span>
      </nav>
      <ReferencesTab term={term} />
    </div>
  )
}

/** The body of the side panel's Files or Changes surface: both read the session's repository through one of its panes. */
export function RepoSurface({ kind, term, machine = LOCAL_MACHINE, machineName = null, branch, lookAt, documents, comments, changeActions, turnScope, onNotice }: Props) {
  if (kind === 'files') return <FilesSurface term={term} machine={machine} machineName={machineName} lookAt={lookAt} documents={documents} />
  return <ChangesTab term={term} machine={machine} {...(branch !== undefined ? { branch } : {})} {...(comments ? { comments } : {})} {...(changeActions ? { actions: changeActions } : {})} {...(turnScope ? { scope: turnScope } : {})} onNotice={onNotice} />
}
