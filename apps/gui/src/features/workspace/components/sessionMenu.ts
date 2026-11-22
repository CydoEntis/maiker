import type { SessionView } from '../model/session'
import { isShell } from '../model/sidebar'
import type { MenuEntry } from './MenuPopup'
import type { SidebarProps } from './Sidebar'

/**
 * A session's right-click menu, the same in the full list and in the rail. Rename, Open in a new pane, Copy folder path
 * and, after a divider, Close session come first; the rest of what a session can do follows a second divider.
 */
export function sessionMenuEntries(props: SidebarProps, session: SessionView, closeHint: string): MenuEntry[] {
  const agent = !isShell(session)
  const other = session.id !== props.focusedId
  return [
    { label: 'Rename', hint: 'F2', run: () => { props.onRenameSession(session.id) } },
    { label: 'Open in a new pane', disabled: !other, run: () => { props.onSplitSession(session.id, 'right') } },
    { label: 'Copy folder path', run: () => { props.onCopyPath(session.id) } },
    'separator',
    // Closing an agent stops it; a plain shell has nothing running to lose.
    { label: agent ? 'Close session' : 'Close shell', hint: closeHint, danger: true, disabled: !props.online, run: () => { props.onEndSession(session.id) } },
    'separator',
    { label: 'Open', run: () => { props.onShowSession(session.id) } },
    ...(other ? [{ label: 'Open in split down', run: () => { props.onSplitSession(session.id, 'down') } }] : []),
    ...(agent ? [{ label: 'Show changes', run: () => { props.onShowChanges(session.id) } }] : []),
    // A worktree is made from a repository, so a session that has not gone into one yet cannot start it or list them.
    ...(props.onNewWorktree === undefined ? [] : [{ label: 'New worktree…', disabled: !props.online || session.repoRoot === null, run: () => { props.onNewWorktree?.(session.id) } }]),
    ...(props.onOpenWorktree === undefined ? [] : [{ label: 'Open worktree…', disabled: !props.online || session.repoRoot === null, run: () => { props.onOpenWorktree?.(session.id) } }]),
    ...(session.machineName === null ? [] : [{ label: 'Rename machine…', run: () => { props.onRenameMachine(session.machineName ?? '') } }]),
    ...(session.machineName === null ? [] : [{ label: 'Get a file…', disabled: !props.online, run: () => { props.onGetFile(session.id) } }]),
    // A finished agent stays marked done until you look; this makes it idle without opening it.
    ...(session.status === 'done' ? [{ label: 'Mark as done', disabled: !props.online, run: () => { props.onMarkDone(session.id) } }] : []),
  ]
}
