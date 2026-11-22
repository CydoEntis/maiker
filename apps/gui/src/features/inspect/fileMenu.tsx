import { useState, type MouseEvent, type ReactNode } from 'react'
import type { FileSource, SnapshotSpan } from '@/features/documents/documentEdit'
import { MenuPopup, type MenuEntry } from '@/features/workspace/components/MenuPopup'

/** What the Files and Changes surfaces do with a file; the window gives them, since a file opens in a pane of its own. */
export type FileActions = {
  /** The file the file pane shows, so its row reads as picked; null when none is open. */
  openPath: string | null
  /** Opens the file in the file pane, as its source opens it; `asChanges` asks for its diff whatever the source. */
  onOpen: (path: string, source: FileSource, how?: { asChanges?: boolean; range?: SnapshotSpan }) => void
  onCopyPath: (path: string) => void
  onCopyRelativePath: (path: string) => void
  /** Shows the file in this computer's file manager; absent for a file on another machine, which has none here. */
  onReveal?: ((path: string) => void) | undefined
  /** Where the menu mounts, so it reads the theme's colours. */
  menuRoot: HTMLElement | null
}

/** What the menu needs to know about the file it is for. */
export type MenuFile = { path: string; changed: boolean; deleted: boolean; range?: SnapshotSpan | undefined }

/**
 * A file's right-click menu. An entry that does not apply is left out: Open changes for an unchanged file, Open and
 * Reveal for a deleted one (nothing is left to read or show), Reveal for a file on another machine.
 */
export function fileMenu(file: MenuFile, source: FileSource, actions: FileActions): MenuEntry[] {
  const { path, range } = file
  const how = range === undefined ? {} : { range }
  const reveal = actions.onReveal
  return [
    ...(file.deleted ? [] : [{ label: 'Open', run: () => { actions.onOpen(path, source, how) } }]),
    ...(file.changed ? [{ label: 'Open changes', run: () => { actions.onOpen(path, source, { ...how, asChanges: true }) } }] : []),
    'separator',
    { label: 'Copy path', run: () => { actions.onCopyPath(path) } },
    { label: 'Copy relative path', run: () => { actions.onCopyRelativePath(path) } },
    ...(reveal !== undefined && !file.deleted ? [{ label: 'Reveal in file manager', run: () => { reveal(path) } }] : []),
  ]
}

/** The menu of the file that was right-clicked, for a list of files: `open` goes on a row, `popup` beside the list. */
export function useFileMenu(source: FileSource, actions: FileActions): { open: (event: MouseEvent, file: MenuFile) => void; popup: ReactNode } {
  const [menu, setMenu] = useState<{ file: MenuFile; at: { x: number; y: number } } | null>(null)
  const open = (event: MouseEvent, file: MenuFile) => {
    event.preventDefault()
    setMenu({ file, at: { x: event.clientX, y: event.clientY } })
  }
  const popup = menu === null ? null : (
    <MenuPopup key={`${String(menu.at.x)},${String(menu.at.y)}`} title={menu.file.path} at={menu.at} items={fileMenu(menu.file, source, actions)} portalContainer={actions.menuRoot} onClose={() => { setMenu(null) }} />
  )
  return { open, popup }
}
