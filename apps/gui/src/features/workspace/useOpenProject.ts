import { useCallback, useState } from 'react'
import { LOCAL_MACHINE } from '@/api/machines'
import type { OpenProjectTab } from '@/features/open-project/OpenProjectDialog'
import { useWorkspace } from './workspaceContext'

/**
 * What is shown to open a project, null while nothing is. The Open a project dialog (this computer) opens on `tab`, for a
 * session started in the project or for the project alone; another machine's folder is chosen in the folder picker
 * opened on that machine, and that opens the project alone.
 */
export type OpenProjectRequest =
  | { kind: 'dialog'; tab: OpenProjectTab; purpose: 'session' | 'project' }
  | { kind: 'pick'; machine: number }

/** The request that opens a folder of `machine` as a project, starting nothing: the dialog on this computer, else the picker. */
export function projectRequestFor(machine: number): OpenProjectRequest {
  return machine === LOCAL_MACHINE ? { kind: 'dialog', tab: 'folder', purpose: 'project' } : { kind: 'pick', machine }
}

/** The window's one Open a project state: `useWorkspaceState` owns it, `WorkspaceDialogs` shows it. */
export function useOpenProjectState() {
  return useState<OpenProjectRequest | null>(null)
}

/**
 * The way to show Open a project from anywhere inside the window: `open()` starts on Clone from URL, `open('github')` and
 * `open('folder')` on the other tabs, and the project it brings in gets a session; `close()` hides it.
 */
export function useOpenProject(): { open: (tab?: OpenProjectTab) => void; close: () => void; isOpen: boolean } {
  const { openProject, setOpenProject } = useWorkspace()
  const open = useCallback((tab: OpenProjectTab = 'url') => { setOpenProject({ kind: 'dialog', tab, purpose: 'session' }) }, [setOpenProject])
  const close = useCallback(() => { setOpenProject(null) }, [setOpenProject])
  return { open, close, isOpen: openProject !== null }
}
