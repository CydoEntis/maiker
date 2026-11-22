import { useState, type MouseEvent, type ReactNode } from 'react'
import type { DiscardingFile } from '@/features/confirm/confirm'
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
  /** Discards the file's uncommitted changes, after asking; absent where nothing can be discarded from. */
  onDiscard?: ((file: DiscardingFile) => void) | undefined
  /** Where the menu mounts, so it reads the theme's colours. */
  menuRoot: HTMLElement | null
}

/** What the menu needs to know about the file it is for. */
export type MenuFile = { path: string; changed: boolean; deleted: boolean; /** No commit has the file. */ added?: boolean; range?: SnapshotSpan | undefined }

/** How a changed file changed, as the question before a discard needs it. */
export function discardingOf(file: MenuFile): DiscardingFile {
  return { path: file.path, change: file.added === true ? 'new' : file.deleted ? 'deleted' : 'edited' }
}

/**
 * A file's right-click menu. An entry that does not apply is left out: Open changes and Discard changes for an
 * unchanged file, Open and Reveal for a deleted one (nothing is left to read or show), Reveal for a file on another
 * machine. Discard acts on the working tree, so it is not offered beside one turn's changes.
 */
export function fileMenu(file: MenuFile, source: FileSource, actions: FileActions): MenuEntry[] {
  const { path, range } = file
  const how = range === undefined ? {} : { range }
  const reveal = actions.onReveal
  const discard = actions.onDiscard
  return [
    ...(file.deleted ? [] : [{ label: 'Open', run: () => { actions.onOpen(path, source, how) } }]),
    ...(file.changed ? [{ label: 'Open changes', run: () => { actions.onOpen(path, source, { ...how, asChanges: true }) } }] : []),
    'separator',
    { label: 'Copy path', run: () => { actions.onCopyPath(path) } },
    { label: 'Copy relative path', run: () => { actions.onCopyRelativePath(path) } },
    ...(reveal !== undefined && !file.deleted ? [{ label: 'Reveal in file manager', run: () => { reveal(path) } }] : []),
    ...(discard !== undefined && file.changed && range === undefined ? ['separator' as const, { label: 'Discard changes…', danger: true, run: () => { discard(discardingOf(file)) } }] : []),
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
