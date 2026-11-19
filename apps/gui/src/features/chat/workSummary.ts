import type { CommandEvent, EditEvent, ItemStatus, ToolEvent } from './chatEvents'
import { shownCommandStatus } from './commandIntent'

/** A step that is folded into a run of work: anything but the to-do list, which stays in view. */
export type WorkStep = EditEvent | CommandEvent | ToolEvent

const READ_TOOL = /^(read|view|cat|open)/i
const SEARCH_TOOL = /(grep|glob|search|find|^ls$|list)/i

type Count = { readonly n: number; readonly one: string; readonly many: string }

function said({ n, one, many }: Count): string {
  return `${String(n)} ${n === 1 ? one : many}`
}

type Tally = { readonly read: number; readonly searches: number; readonly edited: number; readonly commands: number; readonly others: number }

/** What a run did, each kind counted: files once however often they were touched. */
function tally(steps: readonly WorkStep[]): Tally {
  const read = new Set<string>()
  const edited = new Set<string>()
  let searches = 0
  let commands = 0
  let others = 0
  for (const step of steps) {
    if (step.kind === 'edit') edited.add(step.file ?? step.id)
    else if (step.kind === 'command') commands += 1
    else if (READ_TOOL.test(step.name)) read.add(step.target ?? step.id)
    else if (SEARCH_TOOL.test(step.name)) searches += 1
    else others += 1
  }
  return { read: read.size, searches, edited: edited.size, commands, others }
}

/**
 * What a run of steps did, in a line: "Read 2 files, edited 3, ran 1 command". Files are counted once however
 * often they were touched. Only what the steps say is counted; a tool of no known kind is "used N tools".
 */
export function workSummary(steps: readonly WorkStep[]): string {
  const { read, searches, edited, commands, others } = tally(steps)
  const parts: string[] = []
  if (read > 0) parts.push(`read ${said({ n: read, one: 'file', many: 'files' })}`)
  if (searches > 0) parts.push(`searched ${said({ n: searches, one: 'time', many: 'times' })}`)
  // After "read 2 files" the noun is understood: "edited 3".
  if (edited > 0) parts.push(read > 0 ? `edited ${String(edited)}` : `edited ${said({ n: edited, one: 'file', many: 'files' })}`)
  if (commands > 0) parts.push(`ran ${said({ n: commands, one: 'command', many: 'commands' })}`)
  if (others > 0) parts.push(`used ${said({ n: others, one: 'tool', many: 'tools' })}`)
  const line = parts.join(', ')
  return line.charAt(0).toUpperCase() + line.slice(1)
}

/** Whether the summary is one count that already is the number of steps ("Ran 3 commands"), so "3 steps" beside it would say the same twice. */
export function summaryCountsEverything(steps: readonly WorkStep[]): boolean {
  const counts = Object.values(tally(steps)).filter((n) => n > 0)
  return counts.length === 1 && counts[0] === steps.length
}

/** The run as one status: running while any step is, failed when one failed, else how the last one ended. */
export function workStatus(steps: readonly WorkStep[]): ItemStatus {
  const statuses = steps.map((step) => (step.kind === 'command' ? shownCommandStatus(step) : step.status))
  if (statuses.includes('running')) return 'running'
  if (statuses.includes('failed')) return 'failed'
  return statuses.at(-1) ?? 'completed'
}

/**
 * Claude's built-in tools that only read or search, by their whole name. A name matched by pattern could be an MCP
 * tool that writes (`mcp__fs__search_and_replace`). Codex reads and searches through shell commands, which always show.
 */
const QUIET_TOOLS: ReadonlySet<string> = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'WebSearch', 'WebFetch', 'ToolSearch'])

/**
 * A run that can be hidden by Settings › Chat › Hide successful tool calls: every step one of `QUIET_TOOLS` that
 * completed. A command or any other tool may have changed files, so it always shows, as does an edit.
 */
export function isQuietRun(steps: readonly WorkStep[]): boolean {
  return steps.every((step) => step.kind === 'tool' && step.status === 'completed' && QUIET_TOOLS.has(step.name))
}

/** How long the run took by the daemon's own times, first start to last finish; null when it gave none. */
export function workDurationMs(steps: readonly WorkStep[]): number | null {
  const started = steps[0]?.timing.startedAtMs ?? null
  const ended = steps.at(-1)?.timing.completedAtMs ?? null
  return started === null || ended === null || ended < started ? null : ended - started
}
