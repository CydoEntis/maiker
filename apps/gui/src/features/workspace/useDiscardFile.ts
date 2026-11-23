import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { discardAsk, type DiscardingFile } from '@/features/confirm/confirm'
import { askAboutDrafts, draftsMatching, ofSessions } from '@/features/documents/draftGuard'
import { discardFile } from '@/features/inspect/api'
import { toast } from '@/lib/toast'
import { filePaneShowing } from './model/filePane'
import type { SessionView } from './model/session'
import { useWorkspace } from './workspaceContext'

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/**
 * Discards one file's uncommitted changes in a session's checkout, after the window's confirm: git runs on this
 * computer for a session here, and the session's own machine is asked through its pane `term` otherwise. An unsaved
 * draft of that file in the editor is asked about first, the way a closing pane asks; keeping it calls the discard off.
 * Afterwards everything read from that repository is read again, and the file pane of a file that no longer exists closes.
 */
export function useDiscardFile(): (session: SessionView, term: number, file: DiscardingFile) => void {
  const { confirm, tab, closePaneById, flash } = useWorkspace()
  const queryClient = useQueryClient()
  return useCallback((session, term, file) => {
    const local = session.machineName === null
    const run = async () => {
      const drafts = draftsMatching(ofSessions(new Set([session.id]))).filter((draft) => draft.path === file.path)
      if (!(await askAboutDrafts(drafts))) return
      try {
        await discardFile(session.repoRoot ?? session.cwd, file.path, session.machine, local ? undefined : term)
      } catch (error) {
        toast.failed(`Could not discard the changes to ${nameOf(file.path)}`, error)
        return
      }
      // Changes, Files and an open file all read through this pane: ask again now, not at the next poll.
      void queryClient.invalidateQueries({ queryKey: ['repo', term] })
      const pane = file.change === 'new' ? filePaneShowing(tab, session.id, file.path) : null
      if (pane !== null) closePaneById(pane)
      flash(file.change === 'new' ? `Deleted ${nameOf(file.path)}` : `Discarded the changes to ${nameOf(file.path)}`)
    }
    confirm(discardAsk(file), () => { void run() })
  }, [confirm, tab, closePaneById, flash, queryClient])
}
