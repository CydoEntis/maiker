import { FolderOpen, GitBranch, Monitor, Shield } from 'lucide-react'
import { usageItems, type SessionUsage } from '@/features/chat/usageStrip'
import { DANGER_MODES, modeLabel, modelLabel } from '@/features/chat/chatMeta'
import { nowSeconds } from '@/features/workspace/model/newChatHost'
import { HINT_AGENTS, type HintAgent, type TerminalBarFacts } from './terminalBar'

const PERCENT = 100
const GLYPH_SIZE = 13
const BRANCH_GLYPH_SIZE = 12
/** The meter's ring, square as the window's corners are: a path round a 12px box, starting at the top middle. */
const RING_SQUARE = 'M6 1H11V11H1V1H6'
/** The same ring under Rounded corners. */
const RING_ROUND = 'M6 1A5 5 0 1 1 6 11A5 5 0 1 1 6 1'

/** The short name a meter wears beside its figure. */
const meterName = (item: { window: string | null }): string => (item.window === null ? 'Ctx' : item.window === 'week' ? 'Wk' : item.window)

/**
 * The 38px bar under an agent's terminal: where it runs (machine, project, branch, a worktree tag) at the left, and
 * its usage meters, model and permission mode at the right. Only read here: where a session runs is set when it
 * starts, and its model and mode are changed in the agent's own terminal. It uses the chat's meter styles
 * (`mx-usage*`), so the two rows read alike; it can be unified with the chat's `SessionBar` later.
 */
export function TerminalBar({ facts, onOpenUsage }: { facts: TerminalBarFacts; onOpenUsage?: () => void }) {
  const where = [facts.machine, facts.project, facts.branch === null ? null : `on ${facts.branch}${facts.worktree ? ', in its own worktree' : ''}`].filter((part) => part !== null).join(' · ')
  return (
    <div className="mx-tbar" role="group" aria-label="Session details">
      <span className="mx-tbar-where" title={`${where}. Set when the session started.`}>
        <Monitor size={GLYPH_SIZE} aria-hidden="true" />
        {facts.machine !== null && <span className="mx-tbar-machine">{facts.machine}</span>}
        <FolderOpen size={GLYPH_SIZE} aria-hidden="true" />
        <span className="mx-tbar-project">{facts.project}</span>
        {facts.branch !== null && (
          <>
            <span className="mx-tbar-sep" aria-hidden="true">/</span>
            <span className={`mx-tbar-branch${facts.worktree ? ' is-worktree' : ''}`}>
              <GitBranch size={BRANCH_GLYPH_SIZE} aria-hidden="true" />
              <span className="mx-tbar-branch-name">{facts.branch}</span>
              {facts.worktree && <span className="mx-tbar-tag">worktree</span>}
            </span>
          </>
        )}
      </span>
      <span className="mx-tbar-spacer" />
      <TerminalMeters usage={facts.usage} always={facts.contextAlways} onOpen={onOpenUsage} />
      <span className="mx-tbar-model" title="The model, from the agent's own file. Change it in the terminal with /model.">{modelLabel(facts.model) ?? facts.agent}</span>
      {facts.mode !== null && <ModeMark mode={facts.mode} />}
    </div>
  )
}

function ModeMark({ mode }: { mode: string }) {
  const name = modeLabel(mode) ?? mode
  return (
    <span className={`mx-tbar-mode${DANGER_MODES.includes(mode) ? ' is-danger' : ''}`} role="img" aria-label={`Permission mode: ${name}`} title={`Permissions: ${name}. Cycle it in the terminal with Shift+Tab.`}>
      <Shield size={GLYPH_SIZE} />
    </span>
  )
}

function TerminalMeters({ usage, always, onOpen }: { usage: SessionUsage; always: boolean; onOpen: (() => void) | undefined }) {
  const items = usageItems(usage, nowSeconds(), always)
  if (items.length === 0) return null
  return (
    <span className="mx-usage" role="group" aria-label="Usage">
      {items.map((item) => {
        const said = item.window === null ? `How much of its memory is used: ${String(item.percent)}%` : item.resetsIn === null ? `${item.label}: ${String(item.percent)}% used` : `${item.label}: ${String(item.percent)}% used · resets in ${item.resetsIn}`
        const dash = `${String(item.percent)} ${String(PERCENT)}`
        const meter = (
          <>
            <span className="mx-usage-name">{meterName(item)}</span>
            <svg className="mx-usage-ring" role="meter" aria-label={item.label} aria-valuemin={0} aria-valuemax={PERCENT} aria-valuenow={item.percent} width="12" height="12" viewBox="0 0 12 12">
              <path d={RING_SQUARE} className="mx-usage-track mx-usage-sq" />
              <path d={RING_SQUARE} className="mx-usage-fill mx-usage-sq" pathLength={PERCENT} strokeDasharray={dash} />
              <path d={RING_ROUND} className="mx-usage-track mx-usage-round" />
              <path d={RING_ROUND} className="mx-usage-fill mx-usage-round" pathLength={PERCENT} strokeDasharray={dash} />
            </svg>
            <span className="mx-usage-figure">{`${String(item.percent)}%`}</span>
          </>
        )
        return onOpen === undefined
          ? <span key={item.key} className={`mx-usage-item is-${item.tone}`} title={said}>{meter}</span>
          : <button key={item.key} type="button" className={`mx-usage-item is-${item.tone}`} title={`${said} · Open Usage & cost`} onClick={onOpen}>{meter}</button>
      })}
    </span>
  )
}

/**
 * What a plain shell gets in place of the bar: it has no agent, so there is no session to describe. It says how a
 * session starts here, and offers the agents one click away; Maiker turns the shell into a session by itself once
 * it sees the agent run.
 */
export function ShellHint({ onStart, disabled }: { onStart: (agent: HintAgent) => void; disabled: boolean }) {
  return (
    <div className="mx-shint">
      <span>A plain shell. Start an agent here:</span>
      {HINT_AGENTS.map((agent) => (
        <button key={agent} type="button" className="mx-shint-agent" disabled={disabled} onClick={() => { onStart(agent) }}>{agent}</button>
      ))}
      <span className="mx-shint-note">Maiker spots it and gives this terminal its own row and live status.</span>
    </div>
  )
}
