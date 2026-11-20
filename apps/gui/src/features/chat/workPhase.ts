import type { ChatEvent } from './chatEvents'
import { relativePath } from './stepInfo'

/** What the working line says when nothing has started yet, or the agent is only reasoning. */
const THINKING = 'thinking'
const TARGET_MAX_CHARS = 48
const FIRST_LINE = 0

/** What a named tool is doing, in the words the working line uses. A tool not listed is "using <name>". */
const VERB_BY_TOOL: Readonly<Record<string, string>> = {
  Read: 'reading',
  NotebookRead: 'reading',
  Grep: 'searching',
  Glob: 'searching',
  LS: 'listing',
  WebFetch: 'fetching',
  WebSearch: 'searching the web',
}

function shortened(text: string): string {
  const line = text.split('\n')[FIRST_LINE]?.trim() ?? ''
  return line.length > TARGET_MAX_CHARS ? `${line.slice(0, TARGET_MAX_CHARS - 1)}…` : line
}

const withTarget = (verb: string, target: string | null): string => (target === null || target === '' ? verb : `${verb} ${shortened(target)}`)

/**
 * What the agent is doing right now, from the newest step still running: "reading src/app.ts",
 * "writing hello.txt", "running npm test", "thinking". Only what the history says; nothing is guessed.
 */
export function describeWork(events: readonly ChatEvent[], root: string | null): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined || !('status' in event) || event.status !== 'running') continue
    switch (event.kind) {
      case 'edit':
        return withTarget(event.change === 'add' || event.tool === 'Write' ? 'writing' : 'editing', event.file === null ? null : relativePath(event.file, root))
      case 'command':
        return withTarget('running', event.command)
      case 'tool':
        return withTarget(VERB_BY_TOOL[event.name] ?? `using ${event.name}`, event.target === null ? null : relativePath(event.target, root))
      case 'subagent':
        return withTarget('waiting on a helper', event.title)
      case 'message':
        if (event.role === 'user') continue
        return 'writing a reply'
      case 'todo':
      case 'summary':
      case 'note':
        // A checklist, a summary, or what a command printed is not something the agent is doing.
        continue
      case 'reasoning':
        // With no step running the line already says "thinking"; a thought has no phrase of its own.
        continue
    }
  }
  return THINKING
}

/**
 * How many of the person's messages hold these words, so a message just sent can be told from the same words said
 * before. Held, not equal: an agent can take two sends as one message (the first left unsent in its box), and the
 * second is still said. Whitespace does not count: a pasted message (tabs, runs of spaces, CRLF) comes back from the
 * history with other spacing, and the echo of it would otherwise stay under the message it was already read as.
 */
export function countUserMessages(events: readonly ChatEvent[], text: string): number {
  const wanted = squeezeSpace(text)
  if (wanted === '') return 0
  return events.filter((event) => event.kind === 'message' && event.role === 'user' && squeezeSpace(event.text).includes(wanted)).length
}

const squeezeSpace = (text: string): string => text.replace(/\s+/g, ' ').trim()
