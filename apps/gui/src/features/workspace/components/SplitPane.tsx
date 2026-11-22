import { useState } from 'react'
import { TerminalView } from '@/TerminalView'
import { IconButton } from '@/components/ui/icon-button'
import { toast } from '@/lib/toast'
import { useShortcutText, useTipWithKeys } from '@/features/shortcuts/platform'
import type { SessionView } from '../model/session'
import { projectOf } from '../model/sidebar'
import type { SplitDir } from '../model/splitTree'
import { splitName } from '../useSessionSplits'
import { useWorkspace } from '../workspaceContext'
import { Icon } from './glyphs'
import { MenuPopup, type MenuEntry } from './MenuPopup'
import { menuPoint } from './menuPoint'
import { focusTerminalFromPadding, isPaneMenuTarget } from './paneEvents'

/** Ctrl+L: a shell clears its screen and keeps what was typed. */
const CLEAR_SCREEN = '\x0c'

/**
 * One split of a session (handoff 6.2): a plain shell in the session's folder, as a card beside the session's own pane.
 * Its header is `project / Split n` with the folder on hover, then split right, split down and close; Maiker draws
 * nothing inside it. It belongs to `owner`: it is not in the sidebar and ends with that session.
 */
export function SplitPane({ slotId, owner, shell, number, focused, splitRefusal, onFocus, onSplit, onClose }: {
  /** The arrangement's pane this split is drawn in: what a session dropped on it lands on. */
  slotId: string
  owner: SessionView
  shell: SessionView
  number: number | undefined
  /** This split has the keys. */
  focused: boolean
  splitRefusal: string | null
  onFocus: () => void
  onSplit: (direction: SplitDir) => void
  onClose: () => void
}) {
  const { preferences, look, online, modalOpen, openPath, pasteImage, terminalHandles, root, sendTo, copyPathOf, dockFocused, panelFocused } = useWorkspace()
  const shortcutText = useShortcutText()
  const tip = useTipWithKeys()
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const name = splitName(number)
  const unsplittable = splitRefusal !== null
  const why = splitRefusal === null ? {} : { why: splitRefusal }
  const menuItems: MenuEntry[] = [
    { label: 'Split right', hint: shortcutText('split-right'), disabled: unsplittable, ...why, run: () => { onSplit('right') } },
    { label: 'Split down', hint: shortcutText('split-down'), disabled: unsplittable, ...why, run: () => { onSplit('down') } },
    'separator',
    { label: 'Clear', hint: 'Ctrl+L', disabled: !online, run: () => { void sendTo(shell, CLEAR_SCREEN).catch((error: unknown) => { toast.failed('Could not clear the screen', error) }) } },
    { label: 'Copy folder path', run: () => { copyPathOf(shell.id) } },
    'separator',
    { label: 'Close split', hint: shortcutText('close'), danger: true, run: onClose },
  ]
  return (
    <>
      <section
        className={`mx-pane is-terminal is-card${focused ? ' is-focused' : ''}`}
        aria-label={`${name}: ${shell.cwdLabel}${focused ? ', focused' : ''}`}
        data-session-id={shell.id}
        data-pane={slotId}
        onMouseDown={onFocus}
        onContextMenu={(event) => {
          if (!isPaneMenuTarget(event.target)) return
          event.preventDefault()
          setMenuAt(menuPoint(event, false))
        }}
      >
        <div className="mx-pane-head">
          <span className="mx-pane-title" title={shell.cwd}>
            <span className="mx-pane-project">{projectOf(owner)}</span>
            <span className="mx-pane-slash" aria-hidden="true">/</span>
            <span className="mx-pane-name">{name}</span>
          </span>
          <IconButton label="Split right" tip={splitRefusal ?? tip('Split right', 'split-right')} disabled={unsplittable} onClick={() => { onSplit('right') }}><Icon name="splitRight" /></IconButton>
          <IconButton label="Split down" tip={splitRefusal ?? tip('Split down', 'split-down')} disabled={unsplittable} onClick={() => { onSplit('down') }}><Icon name="splitDown" /></IconButton>
          <IconButton label="Close split" tip={tip('Close split', 'close')} onClick={onClose}><Icon name="close" /></IconButton>
        </div>
        <div className="mx-pane-body" onMouseDown={focusTerminalFromPadding}>
          <TerminalView
            key={shell.id}
            conversation={shell.conversation}
            desktop
            fontSize={preferences.terminalFontSize}
            look={look}
            label={`${name} shell in ${shell.cwdLabel}`}
            inputDisabled={!online}
            ended={shell.ended}
            focused={focused && !modalOpen && !dockFocused && !panelFocused}
            // Found in the session's repository and opened beside the session's pane: the split has no pane of the arrangement.
            onOpenPath={(path, line) => { openPath(owner, path, line) }}
            onPasteImage={(image) => { pasteImage(shell.id, image) }}
            onHandle={(handle) => {
              if (handle) terminalHandles.current.set(shell.id, handle)
              else terminalHandles.current.delete(shell.id)
            }}
          />
        </div>
      </section>
      {/* Beside the pane, not in it: a pane has `contain: paint`, which would place the menu's fixed anchor from the pane's corner. */}
      {menuAt && <MenuPopup key={`${String(menuAt.x)},${String(menuAt.y)}`} title={name} at={menuAt} items={menuItems} portalContainer={root} onClose={() => { setMenuAt(null) }} />}
    </>
  )
}
