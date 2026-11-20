import { useCallback, useState } from 'react'
import type { OpenProjectTab } from '@/features/open-project/OpenProjectDialog'
import { useWorkspace } from './workspaceContext'

/** The Open a project dialog while it is shown: the tab it opened on. Null while it is closed. */
export type OpenProjectRequest = { tab: OpenProjectTab }

/** The window's one Open a project state: `useWorkspaceState` owns it, `WorkspaceDialogs` shows it. */
export function useOpenProjectState() {
  return useState<OpenProjectRequest | null>(null)
}

/**
 * The way to show Open a project from anywhere inside the window: `open()` starts on Clone from URL, `open('github')` and
 * `open('folder')` on the other tabs; `close()` hides it.
 */
export function useOpenProject(): { open: (tab?: OpenProjectTab) => void; close: () => void; isOpen: boolean } {
  const { openProject, setOpenProject } = useWorkspace()
  const open = useCallback((tab: OpenProjectTab = 'url') => { setOpenProject({ tab }) }, [setOpenProject])
  const close = useCallback(() => { setOpenProject(null) }, [setOpenProject])
  return { open, close, isOpen: openProject !== null }
}
