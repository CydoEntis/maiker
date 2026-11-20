import { modelWords } from '@/features/chat/modelName'
import { ContextMeter } from '@/features/usage/UsageMeter'
import { agentName } from '../model/agentMessage'
import type { SessionView } from '../model/session'
import { AppIcon } from './glyphs'

const FULL = 100

/** An agent's terminal pane foot: its mark and `Agent · Model` at the left, how full its context is at the right. Each part shows only when the agent said it. */
export function PaneFooter({ session }: { session: Pick<SessionView, 'process' | 'usage' | 'agentModel'> }) {
  const context = session.usage.context
  const model = modelWords(session.agentModel)
  return (
    <footer className="mx-pane-foot" aria-label="Agent">
      <AppIcon process={session.process} size={14} />
      <span className="mx-pane-foot-name">{model === null ? agentName(session.process) : `${agentName(session.process)} · ${model}`}</span>
      {context !== null && <ContextMeter percent={Math.min(FULL, Math.max(0, Math.round(context)))} />}
    </footer>
  )
}
