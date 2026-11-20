import { ContextMeter } from '@/features/usage/UsageMeter'
import { agentName } from '../model/agentMessage'
import type { SessionView } from '../model/session'
import { AppIcon } from './glyphs'

const FULL = 100

/** An agent's terminal pane foot: its mark and name at the left, how full its context is at the right when it said. */
export function PaneFooter({ session }: { session: Pick<SessionView, 'process' | 'usage'> }) {
  const context = session.usage.context
  return (
    <footer className="mx-pane-foot" aria-label="Agent">
      <AppIcon process={session.process} size={14} />
      <span className="mx-pane-foot-name">{agentName(session.process)}</span>
      {context !== null && <ContextMeter percent={Math.min(FULL, Math.max(0, Math.round(context)))} />}
    </footer>
  )
}
