import { type Dispatch, type SetStateAction, useCallback } from 'react'
import { toast } from '@/lib/toast'
import { useLatest } from '@/lib/useLatest'
import { guardDrafts, inPane } from '@/features/documents/draftGuard'
import type { FileAsk } from '@/features/documents/documentEdit'
import { repoLocate } from '@/features/inspect/api'
import { guardLocal } from '@/lib/localOnly'
import { movePanes } from './components/paneTransition'
import { documentPaneReplaced, type Layout, MAX_PANES, openDocumentBeside } from './model/layout'
import type { SessionView } from './model/session'
import { makeId } from './makeId'

/** The window's ways to open a file of a session's checkout in the file pane, the card beside the session's own pane. */
export function useDocuments({ layout, setLayout, showSessionById }: {
  layout: Layout
  setLayout: Dispatch<SetStateAction<Layout>>
  showSessionById: (sessionId: string) => void
}) {
  const layoutNow = useLatest(() => layout)
  /**
   * Shows `path` in the file pane next to the pane showing `sessionId`; said in words when the window is full. A file
   * pane that holds an unsaved draft asks before another file takes its place. The file is read by the daemon of the
   * session's own machine (ADR 0014). `ask` is how to open it: as its diff, at a line.
   */
  const openDocument = useCallback((sessionId: string, path: string, ask?: FileAsk) => {
    const open = () => {
      const next = openDocumentBeside(layoutNow(), sessionId, path, makeId, ask)
      if (next === null) {
        toast.info(`A window holds ${String(MAX_PANES)} panes at most. Close one to open this file.`)
        return
      }
      movePanes(() => { setLayout(next) })
    }
    const replaced = documentPaneReplaced(layoutNow(), sessionId, path)
    if (replaced === null) open()
    else guardDrafts(inPane(replaced.id), open)
  }, [layoutNow, setLayout])

  /** Cmd/Ctrl-click on a file name in a pane's output: find it in that pane's repository, then open it at its line. */
  const openPath = useCallback((session: SessionView, path: string, line?: number) => {
    // The name is looked up in this computer's checkouts; a pane of another machine has none here.
    const refusal = guardLocal(session, 'path-links')
    if (refusal !== null) {
      toast.info(refusal)
      return
    }
    void repoLocate(session.pane, path)
      .then((relative) => {
        showSessionById(session.id)
        openDocument(session.id, relative, { mode: 'file', ...(line === undefined ? {} : { line }), key: Date.now() })
      })
      .catch((error: unknown) => { toast.failed('Could not open that file', error) })
  }, [openDocument, showSessionById])

  return { openDocument, openPath }
}
