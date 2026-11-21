import type { SessionUsage } from './usageStrip'

/** From here a chat's context is nearly full: the agent will soon forget its earliest messages. */
export const CONTEXT_FULL_FROM = 95
const PERCENT_MAX = 100

/**
 * What is wrong with a chat, if anything (docs/DESIGN.md, Errors). Each comes from what the daemon reports about the
 * session (its status, its exit, its machine's link, its interrupted turn, its context use); the window never guesses.
 * - `stopped`: the agent's process exited with an error;
 * - `machine`: the machine the chat runs on stopped answering;
 * - `interrupted`: the agent was mid-turn when the service restarted;
 * - `context`: the context is nearly full (a warning that blocks nothing).
 */
export type ChatProblem =
  | { kind: 'stopped'; agent: string; code: number | null; onRestart: (() => void) | null; onViewLog: (() => void) | null }
  | { kind: 'machine'; machine: string; since: number | null; onRetry: () => void }
  | { kind: 'interrupted'; agent: string; resume: string; onRestart: () => void; onDismiss: () => void }
  | { kind: 'context'; agent: string; percent: number; onCompact: () => void; /** Opens a new chat in the same folder with the summary as its first message. */ onNewWithSummary: (summary: string) => void }

/** A problem that stops the chat: it is asked about over the chat, then kept as a line in the dock. A full context only warns. */
export function blocksChat(problem: ChatProblem): boolean {
  return problem.kind !== 'context'
}

/** Names one problem, so a new one (another exit, another outage) is asked about again after Not now. */
export function problemKey(problem: ChatProblem): string {
  switch (problem.kind) {
    case 'stopped': return `stopped:${String(problem.code)}`
    case 'machine': return `machine:${problem.machine}:${String(problem.since)}`
    case 'interrupted': return `interrupted:${problem.resume}`
    case 'context': return 'context'
  }
}

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

/** The plain exit code the reason may name; any other code stays in Copy details. */
const PLAIN_EXIT = 1

/** Why the agent's process ended, as a sentence, with its exit code kept at the end for whoever reads the log. */
export function exitWords(code: number | null): string {
  if (code === null) return 'Its process ended.'
  const why = KILLED[code]
  return `${why ?? 'Its process ended with an error'} (exit code ${String(code)}).`
}

/** What the dialog and the dock line say about a problem: a short title, one plain sentence, and the raw facts for Copy details. */
export type ProblemWords = { title: string; reason: string; line: string; details: string }

export function problemWords(problem: ChatProblem, now: number): ProblemWords {
  switch (problem.kind) {
    case 'stopped': {
      const killed = problem.code === null ? undefined : KILLED[problem.code]
      const how = killed !== undefined
        ? `${problem.agent} stopped in the middle of a step. ${killed}.`
        : `${problem.agent}${problem.code === PLAIN_EXIT ? ` exited with code ${String(PLAIN_EXIT)}` : ' exited'} in the middle of a step.`
      // A chat the daemon owns has no terminal to restart or to read (ADR 0018): its reason is the line under its box.
      const carry = problem.onRestart !== null ? 'Restart to carry on from the last message.' : problem.onViewLog !== null ? 'The terminal log has the reason.' : 'The reason is under the message box.'
      return {
        title: `${problem.agent} stopped`,
        reason: `${how} Your messages and changes are safe. ${carry}`,
        line: 'Your messages and changes are safe.',
        details: `${problem.agent} stopped. ${exitWords(problem.code)}`,
      }
    }
    case 'machine': {
      const ago = agoWords(problem.since, now)
      return {
        title: `${problem.machine} stopped answering`,
        reason: `${ago === null ? 'The connection was lost.' : `The connection was lost ${ago} ago.`} The chat is paused there and nothing is lost. Check that ${problem.machine} is on and online, then try again.`,
        line: 'The chat is paused there. Nothing is lost.',
        details: `${problem.machine} is not answering${problem.since === null ? '' : ` since ${new Date(problem.since).toISOString()}`}.`,
      }
    }
    case 'interrupted':
      return {
        title: `${problem.agent} was interrupted`,
        reason: `${problem.agent} was mid-step when the service restarted. Nothing is lost. Restart to carry on from the last message.`,
        line: 'Restart to carry on from the last message.',
        details: `${problem.agent} was interrupted by a service restart. Resume command: ${problem.resume}`,
      }
    case 'context':
      return {
        title: 'Context almost full',
        reason: `${String(problem.percent)}% used. Compact now to keep the important parts.`,
        line: `${String(problem.percent)}% used. Compact now to keep the important parts.`,
        details: `${problem.agent} context ${String(problem.percent)}% used.`,
      }
  }
}
