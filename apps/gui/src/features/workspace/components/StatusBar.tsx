import { useState, type ReactNode } from 'react'
import { APP_NAME } from '@/brand'
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
  onOpenCommands: () => void
  onOpenUsage: () => void
}

/** The window's foot: the version and its update at the left, each agent's tightest limit and the commands hint at the right. */
export function StatusBar({ version, update, usages, currentAgent, commandsKeys, onOpenCommands, onOpenUsage }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <footer className="mx-status-bar" aria-label="Status bar">
      <span className="mx-status-version">{version === null ? APP_NAME : `${APP_NAME} ${version}`}</span>
      {update}
      <span className="mx-status-fill" />
      {usages.length > 0 && (
        <UsagePopover usages={usages} open={open} onOpenChange={setOpen} onOpenAll={() => { setOpen(false); onOpenUsage() }}>
          <span className="mx-status-meters" role="group" aria-label="Usage limits">
            {usages.map((usage) => (
              <UsageMeter
                key={usage.agent}
                item={usage.tightest}
                graded
                bar
                className={`mx-status-meter${usage.agent === currentAgent ? ' is-current' : ''}`}
                lead={<AppIcon process={usage.agent} size={14} />}
                openLabel="Show usage limits"
                onOpen={() => { setOpen(true) }}
              />
            ))}
          </span>
        </UsagePopover>
      )}
      <span className="mx-status-sep" aria-hidden="true" />
      <button type="button" className="mx-status-commands" onClick={onOpenCommands}>
        {commandsKeys !== '' && <kbd>{commandsKeys}</kbd>}
        Commands
      </button>
    </footer>
  )
}
