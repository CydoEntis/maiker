import { DocumentView } from '@/features/documents/DocumentView'
import { focusPane, type Arrangement, type PaneSlot } from '../model/layout'
import { useWorkspace } from '../workspaceContext'

/**
 * A markdown file in a pane of its own, beside the session it belongs to. It reads and saves through that session's
 * daemon pane; closing the pane takes only the pane out, never the file or the session.
 */
export function DocPane({ shown, pane, kept }: { shown: Arrangement; pane: PaneSlot; kept: boolean }) {
  const { paneSessions, repoPaneOf, closePaneById, openDocument, setLayout, outsidePanes } = useWorkspace()
  const session = paneSessions.get(pane.sessionId)
  const doc = pane.doc
  if (session === undefined || doc === undefined) return null
  const term = repoPaneOf(session)
  const focused = pane.id === shown.focus && !kept && !outsidePanes
  const multi = shown.panes.length > 1
  return (
    <section
      className={`mx-pane is-doc${multi ? ' is-card' : ''}${focused && multi ? ' is-focused' : ''}`}
      aria-label={`Document ${doc.path}${focused ? ', focused' : ''}`}
      data-pane={pane.id}
      onMouseDown={() => { setLayout((current) => focusPane(current, pane.id)) }}
    >
      {term === null ? (
        <p className="mx-docview-note is-error" role="alert">This file cannot be read while its session is not here.</p>
      ) : (
        <DocumentView
          key={doc.path}
          term={term}
          machine={session.machine}
          path={doc.path}
          root={`${session.machineName ?? ''}${session.repoRoot ?? session.cwd}`}
          owner={{ paneId: pane.id, sessionId: pane.sessionId }}
          onOpenPath={(path) => { openDocument(pane.sessionId, path) }}
          onClose={() => { closePaneById(pane.id) }}
        />
      )}
    </section>
  )
}
