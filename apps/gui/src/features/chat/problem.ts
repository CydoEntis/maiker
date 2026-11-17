import type { SessionUsage } from './usageStrip'

/** From here a chat's context is nearly full: the agent will soon forget its earliest messages. */
export const CONTEXT_FULL_FROM = 95
const PERCENT_MAX = 100

/** What is wrong with a chat, if anything, as the banner over its message box says it (layout 2g). */
export type ChatProblem =
  | { kind: 'crashed'; agent: string; code: number | null; onViewLog: () => void; onRestart: (() => void) | null }
  | { kind: 'offline'; machine: string; since: number | null; onRetry: () => void }
  | { kind: 'context'; agent: string; percent: number; onCompact: () => void; /** Opens a new chat in the same folder with the summary as its first message. */ onNewWithSummary: (summary: string) => void }

/** The share of the context used when it is nearly full, else null. */
export function contextFull(usage: SessionUsage | undefined): number | null {
  const used = usage?.context
  return used === null || used === undefined || Math.round(used) < CONTEXT_FULL_FROM ? null : Math.min(PERCENT_MAX, Math.round(used))
}

const SECOND = 1000
const MINUTE = 60
const HOUR = 3600

/** "40s", "3m", "2h": how long ago a time in ms was. */
export function agoWords(since: number | null, now: number): string | null {
  if (since === null) return null
  const seconds = Math.max(0, Math.round((now - since) / SECOND))
  if (seconds < MINUTE) return `${String(seconds)}s`
  if (seconds < HOUR) return `${String(Math.floor(seconds / MINUTE))}m`
  return `${String(Math.floor(seconds / HOUR))}h`
}

/** What the codes a process is stopped with mean, in plain words. */
const KILLED: Readonly<Record<number, string>> = {
  130: 'It was interrupted',
  137: 'The system stopped it, most often because the computer ran out of memory',
  139: 'It crashed',
  143: 'Something asked it to stop',
}

/** Why the agent's process ended, as a sentence, with its exit code kept at the end for whoever reads the log. */
export function exitWords(code: number | null): string {
  if (code === null) return 'Its process ended.'
  const why = KILLED[code]
  return `${why ?? 'Its process ended with an error'} (exit code ${String(code)}).`
}
