import { createContext } from 'react'
import type { SubagentView } from '@/features/workspace/model/subagents'

/**
 * Opens the own chat of the helper an agents card names, or null when no running subagent matches it: the card knows a
 * helper by the title and words the agent gave it, the runtime by the task it reports.
 */
export type OpenSubagent = (title: string | null, asked: string | null) => (() => void) | null

export const OpenSubagentContext = createContext<OpenSubagent>(() => null)

/** The running subagent a card's helper is, by its title or the first line of what it was asked. */
export function subagentNamed(subagents: readonly SubagentView[], title: string | null, asked: string | null): SubagentView | null {
  const names = [title, asked].map((text) => text?.trim() ?? '').filter((text) => text !== '')
  if (names.length === 0) return null
  return subagents.find((subagent) => names.some((name) => subagent.name === name || subagent.task?.split('\n')[0]?.trim() === name)) ?? null
}
