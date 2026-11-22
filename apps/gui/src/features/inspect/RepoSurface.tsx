import { useState } from 'react'
import { LOCAL_MACHINE } from '@/api/machines'
import { ChangesTab, type TurnScope } from './ChangesTab'
import type { ChangeActions } from './CommitBar'
import type { FileActions } from './fileMenu'
import { FilesTab } from './FilesTab'
import type { RepoSurfaceKind } from './panelTabs'
import { ReferencesTab } from './ReferencesTab'

type Props = {
  kind: RepoSurfaceKind
  /** The daemon's pane number every repository question is about. */
  term: number
  /** The machine the session is on (0: this computer), whose daemon answers. */
  machine?: number
  /** The branch the session's checkout is on. */
  branch?: string
  /** Opens a file in the file pane, and what its right-click menu does. */
  files: FileActions
  /** The Changes surface's commit area: Commit, the remote button and Create PR, run where the checkout is. */
  changeActions?: ChangeActions
  /** The turn a chat's changes row asked about, for Changes. */
  turnScope?: TurnScope
  onNotice: (text: string) => void
}

function FilesSurface({ term, machine, files }: { term: number; machine: number; files: FileActions }) {
  const [references, setReferences] = useState(false)
  // Another machine's folders are listed (its Markdown documents open, ADR 0014); its references stay there.
  if (machine !== LOCAL_MACHINE) return <FilesTab term={term} machine={machine} files={files} />
  if (!references) return <FilesTab term={term} machine={machine} files={files} onReferences={() => { setReferences(true) }} />
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
export function RepoSurface({ kind, term, machine = LOCAL_MACHINE, branch, files, changeActions, turnScope, onNotice }: Props) {
  if (kind === 'files') return <FilesSurface term={term} machine={machine} files={files} />
  return <ChangesTab term={term} machine={machine} {...(branch !== undefined ? { branch } : {})} files={files} {...(changeActions ? { actions: changeActions } : {})} {...(turnScope ? { scope: turnScope } : {})} onNotice={onNotice} />
}
