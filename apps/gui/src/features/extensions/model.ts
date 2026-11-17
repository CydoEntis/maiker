import type { ExtAgent, ExtKind, ExtScope, Extension } from '@/api/extensions'

/** What each kind is called on the page, and in the order the page lists them. */
export const KIND_ORDER: readonly ExtKind[] = ['Plugin', 'McpServer', 'Skill', 'Marketplace']
export const KIND_TITLE: Record<ExtKind, string> = { Plugin: 'Plugins', McpServer: 'MCP servers', Skill: 'Skills', Marketplace: 'Marketplaces' }
export const KIND_ONE: Record<ExtKind, string> = { Plugin: 'plugin', McpServer: 'MCP server', Skill: 'skill', Marketplace: 'marketplace' }
export const AGENTS: readonly ExtAgent[] = ['Claude', 'Codex']

/** Where a change applies, as a person says it. */
export const SCOPE_WORDS: Record<ExtScope, string> = { User: 'for you', Project: 'in this project', Local: 'in this project, only on this computer' }

/** What a change takes to be seen: both agents read their extensions when a session starts. */
export const NEXT_CHAT = 'A change shows up in the next chat you start. Chats already running keep what they started with.'

/**
 * The two things only an agent's own terminal does, in plain words with the exact command. Signing in to an MCP server
 * opens a browser and waits for it to come back; approving a project's shared servers is the agent asking its own user.
 */
export const TERMINAL_ONLY: readonly { title: string; words: string; command: string | null }[] = [
  { title: 'Signing in to an MCP server', words: 'A server that asks you to sign in in your browser needs a terminal to finish it. Run this, with the server\'s name:', command: 'claude mcp login <name>' },
  { title: 'Signing in to an MCP server in Codex', words: 'The same for Codex:', command: 'codex mcp login <name>' },
  { title: 'A project\'s shared servers', words: 'Servers a project lists in its .mcp.json wait for your approval, and Claude Code asks you the first time it starts in that project. Start Claude Code there and answer it. This window cannot approve them for you.', command: null },
]

/** The items of one agent and kind, in list order: the user's first, then the project's. */
export function itemsOf(items: readonly Extension[], agent: ExtAgent, kind: ExtKind): Extension[] {
  const rank: Record<ExtScope, number> = { User: 0, Project: 1, Local: 2 }
  return items.filter((item) => item.agent === agent && item.kind === kind).sort((a, b) => rank[a.scope] - rank[b.scope] || a.name.localeCompare(b.name))
}

/** A key that tells one listed item from another: the same plugin may be installed for the user and for a project. */
export function itemKey(item: Pick<Extension, 'agent' | 'kind' | 'scope' | 'id'>): string {
  return `${item.agent}:${item.kind}:${item.scope}:${item.id}`
}

/** The scopes an agent has for an add, in the order a person picks them. Codex keeps everything for the user. */
export function scopesFor(agent: ExtAgent, kind: ExtKind): readonly ExtScope[] {
  if (kind === 'Marketplace' || agent === 'Codex') return ['User']
  return ['User', 'Project', 'Local']
}

/** The one line that says what an item is and where it applies. */
export function detailLine(item: Pick<Extension, 'scope' | 'detail' | 'kind'>): string {
  const where = item.scope === 'User' ? '' : SCOPE_WORDS[item.scope]
  return [item.detail, where].filter((part) => part !== '').join(' · ')
}
