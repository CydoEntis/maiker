import type { ChatRow } from './chatRows'
import { MODE_FACTS, modeLabel } from './chatMeta'
import { usageItems, type SessionUsage } from './usageStrip'

/**
 * What the window itself says for a command that Claude Code or Codex would draw in its terminal (`/status`,
 * `/permissions`, `/copy`, `/export`): built from what the chat already holds, so nothing is asked of the agent and
 * nothing is typed into it. Pure, so each card can be tested without a window.
 */

const NOT_REPORTED = 'not reported yet'
const AGENT_NAMES: Readonly<Record<string, string>> = { claude: 'Claude', codex: 'Codex' }

/** The agent's name as a person says it; an agent not listed is shown as it was written. */
export const agentName = (agent: string): string => AGENT_NAMES[agent] ?? agent

export type StatusFacts = {
  readonly agent: string
  readonly model: string | null
  readonly effort: string | null
  /** The permission mode as the agent's file or screen wrote it. */
  readonly mode: string | null
  readonly folder: string | null
  readonly usage: SessionUsage | undefined
  /** Seconds since the epoch, for how long until a limit starts over. */
  readonly now: number
  readonly working: boolean
  readonly online: boolean
}

/** A folder or model as inline code, with no way to end the code early. */
const code = (text: string): string => `\`${text.replaceAll('`', "'")}\``

/** The session's state as the chat knows it: the agent, its model and effort, the mode, the folder, its limits. */
export function statusCard(facts: StatusFacts): string {
  const model = facts.model === null ? NOT_REPORTED : `${code(facts.model)}${facts.effort === null ? '' : `, effort ${facts.effort}`}`
  const lines = [
    `- **Agent:** ${agentName(facts.agent)}`,
    `- **Model:** ${model}`,
    `- **Permissions:** ${modeLabel(facts.mode) ?? NOT_REPORTED}`,
    `- **Folder:** ${facts.folder === null ? NOT_REPORTED : code(facts.folder)}`,
    `- **Now:** ${facts.online ? (facts.working ? 'working' : 'waiting for you') : 'the daemon is offline'}`,
  ]
  if (facts.usage !== undefined) {
    for (const item of usageItems(facts.usage, facts.now, true)) {
      const used = item.percent === null ? NOT_REPORTED : `${String(item.percent)}% used${item.resetsIn === null ? '' : `, starts over in ${item.resetsIn}`}`
      lines.push(`- **${item.label}:** ${used}`)
    }
  }
  return lines.join('\n')
}

/** The modes a chat can pick and what each does, with the current one marked. It only says; picking is the shield button's. */
export function permissionsCard(agent: string, mode: string | null, modes: readonly string[]): string {
  const rows = modes.map((key) => {
    const facts = MODE_FACTS[key]
    const current = key === mode ? ' (now)' : ''
    return `- **${modeLabel(key) ?? key}**${current}: ${facts?.what ?? ''}`.trimEnd()
  })
  return [
    `${agentName(agent)} is set to **${modeLabel(mode) ?? NOT_REPORTED}**. The modes it can be set to:`,
    ...rows,
    'Pick one with the shield button next to the message box. Maitty never changes it for you.',
  ].join('\n')
}

/** The agent's last message as the person read it; null when it has said nothing yet. */
export function lastReply(rows: readonly ChatRow[]): string | null {
  const last = rows.findLast((row) => row.kind === 'agent')
  return last?.kind === 'agent' ? last.paragraphs.join('\n\n') : null
}

/** The conversation as a Markdown file: what the person said and what the agent answered, in order. Steps and thoughts are left out. */
export function transcriptMarkdown(rows: readonly ChatRow[], agent: string): string | null {
  const parts: string[] = []
  for (const row of rows) {
    if (row.kind === 'user') parts.push(`## You\n\n${row.event.text}`)
    else if (row.kind === 'agent') parts.push(`## ${agentName(agent)}\n\n${row.paragraphs.join('\n\n')}`)
  }
  return parts.length === 0 ? null : `${parts.join('\n\n')}\n`
}
