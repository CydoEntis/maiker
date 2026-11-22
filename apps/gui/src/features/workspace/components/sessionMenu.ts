import type { SessionView } from '../model/session'
import { isShell, rowTitle } from '../model/sidebar'
import type { MenuEntry } from './MenuPopup'
import type { SidebarProps } from './Sidebar'

/** What the list that opens the menu adds to it. */
type MenuExtras = {
  /** Renames where the name is shown; without it Rename asks the window, which has a dialog for it. */
  onRename?: () => void
  /** The keys of New worktree, as the binding table writes them. */
  worktreeHint?: string
}

/**
 * A session's right-click menu, the same in the full list and in the rail: its name, then Rename, New worktree, Open
 * worktree…, Copy path and, after a divider, Close session. That is the whole list; anything else a session can do is
 * in its pane's menu or the command palette.
 */
export function sessionMenuEntries(props: SidebarProps, session: SessionView, closeHint: string, extras: MenuExtras = {}): MenuEntry[] {
  // A worktree is made from a repository, so a session that has not gone into one yet cannot start it or list them.
  const noWorktree = !props.online || session.repoRoot === null
  return [
    { heading: rowTitle(session) },
    { label: 'Rename', hint: 'F2', run: extras.onRename ?? (() => { props.onRenameSession(session.id) }) },
    { label: 'New worktree', ...(extras.worktreeHint === undefined ? {} : { hint: extras.worktreeHint }), disabled: noWorktree || props.onNewWorktree === undefined, run: () => { props.onNewWorktree?.(session.id) } },
    { label: 'Open worktree…', disabled: noWorktree || props.onOpenWorktree === undefined, run: () => { props.onOpenWorktree?.(session.id) } },
    { label: 'Copy path', run: () => { props.onCopyPath(session.id) } },
    'separator',
    // Closing stops what runs in it, so it asks first.
    { label: isShell(session) ? 'Close shell…' : 'Close session…', hint: closeHint, danger: true, disabled: !props.online, run: () => { props.onEndSession(session.id) } },
  ]
}
