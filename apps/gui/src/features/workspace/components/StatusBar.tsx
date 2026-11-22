import { useState, type ReactNode } from 'react'
import { APP_NAME } from '@/brand'
import { MaikerMark } from '@/components/ui/maiker-mark'
import type { AgentUsage } from '@/features/usage/agentLimits'
import { UsageMeter } from '@/features/usage/UsageMeter'
import { UsagePopover } from '@/features/usage/UsagePopover'
import { AppIcon } from './glyphs'
import './status-bar.css'

type Props = {
  /** The running version; absent until the app has read it. */
  version: string | null
  /** The update button, which draws nothing while there is nothing to update. */
  update: ReactNode
  /** One entry per agent that has reported a limit. */
  usages: readonly AgentUsage[]
  /** The agent of the session in focus, whose meter is lit. */
  currentAgent: string | null
  /** The commands palette's key, as the platform writes it; empty when it has none. */
  commandsKeys: string
  /** The shortcut sheet's key, likewise. */
  shortcutsKeys: string
  onOpenCommands: () => void
  onOpenShortcuts: () => void
  onOpenUsage: () => void
}

/** The mark beside the version, at the size the design draws it in the foot. */
const MARK_WIDTH = 12
const MARK_HEIGHT = 10

/** A key and what it opens: the way to the command palette and to the shortcut sheet, for someone who has not learnt the key. */
function Hint({ keys, label, onOpen }: { keys: string; label: string; onOpen: () => void }) {
  return (
    <button type="button" className="mx-status-hint" onClick={onOpen}>
      {keys !== '' && <kbd>{keys}</kbd>}
      {label}
    </button>
  )
}

/** The window's foot: the mark, the version and its update at the left; every limit of each agent (its 5-hour and weekly ones), then the Commands and Shortcuts hints at the right. */
export function StatusBar({ version, update, usages, currentAgent, commandsKeys, shortcutsKeys, onOpenCommands, onOpenShortcuts, onOpenUsage }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <footer className="mx-status-bar" aria-label="Status bar">
      <span className="mx-status-version">
        <MaikerMark width={MARK_WIDTH} height={MARK_HEIGHT} decorative />
        {version === null ? APP_NAME : `${APP_NAME} ${version}`}
      </span>
      {update}
      <span className="mx-status-fill" />
      {usages.length > 0 && (
        <>
          <UsagePopover usages={usages} open={open} onOpenChange={setOpen} onOpenAll={() => { setOpen(false); onOpenUsage() }}>
            <span className="mx-status-meters" role="group" aria-label="Usage limits">
              {usages.flatMap((usage) => usage.items.map((item, at) => (
                <UsageMeter
                  key={`${usage.agent}:${item.window ?? 'context'}`}
                  item={item}
                  graded
                  className={`mx-status-meter${usage.agent === currentAgent ? ' is-current' : ''}`}
                  // The agent's mark leads its first meter only, so its limits read as one group.
                  lead={at === 0 ? <AppIcon process={usage.agent} size={14} /> : undefined}
                  openLabel="Show usage limits"
                  onOpen={() => { setOpen(true) }}
                />
              )))}
            </span>
          </UsagePopover>
          <span className="mx-status-sep" aria-hidden="true" />
        </>
      )}
      <Hint keys={commandsKeys} label="Commands" onOpen={onOpenCommands} />
      <Hint keys={shortcutsKeys} label="Shortcuts" onOpen={onOpenShortcuts} />
    </footer>
  )
}
