import { useState } from 'react'
import { LOCAL_MACHINE } from '@/api/machines'
import { type FileChange, DocumentView } from '@/features/documents/DocumentView'
import { repoDiff, repoDiffRange, type RepoDiff } from '@/features/inspect/api'
import { changeKind } from '@/features/inspect/changeKind'
import { CHANGES_REFRESH_MS } from '@/features/inspect/ChangesTab'
import type { SentComment } from '@/features/inspect/PatchView'
import { useRepoQuery } from '@/features/inspect/useRepoQuery'
import { agentName, sendAgentMessage } from '../model/agentMessage'
import { focusPane, type Arrangement, type PaneDocument, type PaneSlot } from '../model/layout'
import type { SessionView } from '../model/session'
import { isShell, projectOf } from '../model/sidebar'
import { useWorkspace } from '../workspaceContext'

type ChangedFile = RepoDiff['files'][number]

/**
 * The foot's line while a diff shows: the branch, how much the file changed, and against what. The diff is the working
 * tree against the last commit (or one turn's two snapshots), so that is what it says.
 */
function changeLineOf(branch: string | null, file: ChangedFile, ofTurn: boolean): string {
  const counts = [file.additions > 0 ? `+${String(file.additions)}` : '', file.deletions > 0 ? `−${String(file.deletions)}` : ''].filter((count) => count !== '').join(' ')
  const what = ofTurn ? `${counts} in this turn` : `${counts} against the last commit`
  return branch === null || branch === '' ? what.trim() : `${branch} · ${what.trim()}`
}

/** The file of a session's checkout, with its diff read through the same question the Changes surface asks. */
function SessionFile({ term, session, pane, doc }: { term: number; session: SessionView; pane: PaneSlot; doc: PaneDocument }) {
  const { closePaneById, openDocument } = useWorkspace()
  // Comments sent on diffs in this pane, by file: a comment stays pinned on its line while other files are read.
  const [sent, setSent] = useState<ReadonlyMap<string, readonly SentComment[]>>(() => new Map())
  const range = doc.ask?.range
  // Each machine numbers its own panes, so another machine's answers are kept under its number too.
  const elsewhere = session.machine === LOCAL_MACHINE ? [] : [session.machine]
  const diff = useRepoQuery(
    term,
    range ? ['range', range.from, range.to] : ['diff', ...elsewhere],
    () => (range ? repoDiffRange(term, range.from, range.to) : repoDiff(term, null, session.machine)),
    range ? false : CHANGES_REFRESH_MS,
  )
  const file = diff.data?.files.find((entry) => entry.path === doc.path)
  const change: FileChange | null = file === undefined ? null : { patch: file.patch, binary: file.binary, deleted: changeKind(file.patch).letter === 'D' }
  const path = doc.path
  return (
    <DocumentView
      key={path}
      term={term}
      machine={session.machine}
      machineName={session.machineName}
      path={path}
      root={`${session.machineName ?? ''}${session.repoRoot ?? session.cwd}`}
      project={projectOf(session)}
      change={change}
      changeLine={file === undefined ? undefined : changeLineOf(session.branch, file, range !== undefined)}
      ask={doc.ask}
      // A shell has nobody to tell about a line.
      comments={isShell(session) ? undefined : {
        path,
        agent: agentName(session.process),
        onSend: (message) => sendAgentMessage(session, message),
        sent: sent.get(path) ?? [],
        onSent: (comment) => { setSent((current) => new Map(current).set(path, [...(current.get(path) ?? []), comment])) },
      }}
      owner={{ paneId: pane.id, sessionId: pane.sessionId }}
      onOpenPath={(next) => { openDocument(pane.sessionId, next) }}
      onClose={() => { closePaneById(pane.id) }}
    />
  )
}

/**
 * The file pane: one file of a session's checkout in a card of its own, beside the session it belongs to. It reads and
 * saves through that session's daemon pane; closing the pane takes only the pane out, never the file or the session.
 */
export function DocPane({ shown, pane, kept }: { shown: Arrangement; pane: PaneSlot; kept: boolean }) {
  const { paneSessions, repoPaneOf, setLayout, outsidePanes } = useWorkspace()
  const session = paneSessions.get(pane.sessionId)
  const doc = pane.doc
  if (session === undefined || doc === undefined) return null
  const term = repoPaneOf(session)
  const focused = pane.id === shown.focus && !kept && !outsidePanes
  const multi = shown.panes.length > 1
  return (
    <section
      className={`mx-pane is-doc${multi ? ' is-card' : ''}${focused && multi ? ' is-focused' : ''}`}
      aria-label={`File pane, ${doc.path}${focused ? ', focused' : ''}`}
      data-pane={pane.id}
      onMouseDown={() => { setLayout((current) => focusPane(current, pane.id)) }}
    >
      {term === null
        ? <p className="mx-docview-note is-error" role="alert">This file cannot be read while its session is not here.</p>
        : <SessionFile term={term} session={session} pane={pane} doc={doc} />}
    </section>
  )
}
