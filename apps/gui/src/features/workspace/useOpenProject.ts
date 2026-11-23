import { useCallback, useState } from 'react'
import { LOCAL_MACHINE } from '@/api/machines'
import type { PaletteStart } from '@/features/open-project/OpenProjectPalette'
import { useWorkspace } from './workspaceContext'

/**
 * What the Open a project palette is shown for, null while it is not shown: where it starts, and whether the folder it
 * takes gets a session (the New session draft opens on it) or is opened as a project alone, kept in the sidebar.
 */
export type OpenProjectRequest = { start: PaletteStart; purpose: 'session' | 'project' }

/** The level `open()` starts on: the Git URL field, the GitHub list, or this computer's folders. */
export type OpenProjectFrom = 'url' | 'github' | 'folder'

const startOf = (from: OpenProjectFrom): PaletteStart => (from === 'folder' ? { kind: 'folder', machine: LOCAL_MACHINE } : { kind: from })

/** The request that opens a project and starts a session in it, from one of the palette's levels. */
export function sessionRequestFrom(from: OpenProjectFrom): OpenProjectRequest {
  return { start: startOf(from), purpose: 'session' }
}

/**
 * The request that opens a folder of `machine` as a project, starting nothing: the palette browsing that machine, in
 * `folder` when one is given and where browsing starts there when not.
 */
export function projectRequestFor(machine: number, folder?: string): OpenProjectRequest {
  return { start: { kind: 'folder', machine, folder }, purpose: 'project' }
}

/** The request the sidebar's Open a project button makes: every source, and the project alone. */
export const PROJECT_FROM_SOURCES: OpenProjectRequest = { start: { kind: 'sources' }, purpose: 'project' }

/** The request every Add a remote machine control makes: the palette on its New machine level, the folder then browsed opened as a project alone. */
export const ADD_MACHINE: OpenProjectRequest = { start: { kind: 'machine' }, purpose: 'project' }

/** The window's one Open a project state: `useWorkspaceState` owns it, `WorkspaceDialogs` shows it. */
export function useOpenProjectState() {
  return useState<OpenProjectRequest | null>(null)
}

/**
 * The way to show Open a project from anywhere inside the window. `open()` starts on the Git URL field, `open('github')`
 * and `open('folder')` on the other levels, and the project it brings in gets a session. `openAt(machine, folder)` shows
 * the folder browser in a folder of a machine and opens what is chosen as a project alone: what the first-run setup ends
 * with, in the projects folder. `addMachine()` starts on the New machine level, and a folder then browsed there gets a
 * session like `open()`'s: what the New session draft's machine list asks for. `close()` hides it.
 */
export function useOpenProject(): { open: (from?: OpenProjectFrom) => void; openAt: (machine: number, folder?: string) => void; addMachine: () => void; close: () => void; isOpen: boolean } {
  const { openProject, setOpenProject } = useWorkspace()
  const open = useCallback((from: OpenProjectFrom = 'url') => { setOpenProject(sessionRequestFrom(from)) }, [setOpenProject])
  const openAt = useCallback((machine: number, folder?: string) => { setOpenProject(projectRequestFor(machine, folder)) }, [setOpenProject])
  const addMachine = useCallback(() => { setOpenProject({ start: { kind: 'machine' }, purpose: 'session' }) }, [setOpenProject])
  const close = useCallback(() => { setOpenProject(null) }, [setOpenProject])
  return { open, openAt, addMachine, close, isOpen: openProject !== null }
}
