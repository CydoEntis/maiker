import { type Dispatch, type SetStateAction, useCallback } from 'react'
import { toast } from '@/lib/toast'
import { useLatest } from '@/lib/useLatest'
import { guardDrafts, inPane } from '@/features/documents/draftGuard'
import { repoTree } from '@/features/inspect/api'
import type { LookAt } from '@/features/inspect/FilesTab'
import type { RepoSurfaceKind } from '@/features/inspect/panelTabs'
import { readmeOf } from '@/features/documents/documentPaths'
import { movePanes } from './components/paneTransition'
import { documentPaneReplaced, type Layout, MAX_PANES, openDocumentBeside } from './model/layout'
import type { SessionView } from './model/session'
import { makeId } from './makeId'

export type ReadmePlace = 'beside' | 'files'

/** The window's ways to open a markdown file of a session's checkout: in a pane beside the chat, or in the Files panel. */
export function useDocuments({ layout, setLayout, focusedSession, repoPaneOf, showSessionById, setLookAt, openSurface }: {
  layout: Layout
  setLayout: Dispatch<SetStateAction<Layout>>
  focusedSession: SessionView | undefined
  repoPaneOf: (session: SessionView) => number | null
  showSessionById: (sessionId: string) => void
  setLookAt: Dispatch<SetStateAction<LookAt | null>>
  /** Opens the side panel on a session's Files or Changes. */
  openSurface: (sessionId: string, kind: RepoSurfaceKind) => void
}) {
  const layoutNow = useLatest(() => layout)
  /**
   * Shows `path` in a pane next to the one showing `sessionId`; said in words when the window is full. A document pane
   * that holds an unsaved draft asks before another file takes its place. The file is read by the daemon of the
   * session's own machine (ADR 0014).
   */
  const openDocument = useCallback((sessionId: string, path: string) => {
    const open = () => {
      const next = openDocumentBeside(layoutNow(), sessionId, path, makeId)
      if (next === null) {
        toast.info(`A window holds ${String(MAX_PANES)} panes at most. Close one to open this beside the chat.`)
        return
      }
      movePanes(() => { setLayout(next) })
    }
    const replaced = documentPaneReplaced(layoutNow(), sessionId, path)
    if (replaced === null) open()
    else guardDrafts(inPane(replaced.id), open)
  }, [layoutNow, setLayout])

  /** The focused session's README, beside the chat or in the Files panel. */
  const openReadme = useCallback((place: ReadmePlace) => {
    const session = focusedSession
    const term = session === undefined ? null : repoPaneOf(session)
    if (session === undefined || term === null) {
      toast.info('Open a session first.')
      return
    }
    void repoTree(term, null, session.machine)
      .then((entries) => {
        const name = readmeOf(entries.filter((entry) => !entry.is_directory).map((entry) => entry.name))
        if (name === null) { toast.info('This project has no README.md.'); return }
        if (place === 'beside') { openDocument(session.id, name); return }
        showSessionById(session.id)
        setLookAt({ path: name, key: Date.now() })
        openSurface(session.id, 'files')
      })
      .catch((error: unknown) => { toast.failed('Could not look for the README', error) })
  }, [focusedSession, repoPaneOf, openDocument, showSessionById, setLookAt, openSurface])

  return { openDocument, openReadme }
}
