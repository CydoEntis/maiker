import type { CommandEvent, ItemStatus } from './chatEvents'

/**
 * A shell command read as what it does: "Search `todo` in src" rather than `rg -n todo src`. Only a few plain,
 * read-only forms are recognised, on one line and with no pipe or chaining after them; anything else is shown as
 * typed. The command itself is always one click away, in the step's card.
 */
export type CommandIntent = { readonly verb: string; readonly target: string | null; readonly search: boolean }

const SEARCHERS = new Set(['rg', 'grep', 'ag', 'ack'])
const READERS = new Set(['cat', 'head', 'tail', 'bat', 'less'])
const TEST_RUNNERS: readonly RegExp[] = [
  /^cargo (?:nextest run|test)\b/,
  /^(?:npm|pnpm|yarn|bun) (?:run )?test\b/,
  /^(?:npx |pnpm exec |pnpm )?(?:vitest|jest|playwright test)\b/,
  /^(?:python3? -m )?pytest\b/,
  /^go test\b/,
]
/** Flags that take a value of their own, so the value is not read as the pattern or file. `-n` is a count for a reader, a switch for a searcher. */
const SEARCH_VALUED = new Set(['-e', '-g', '-t', '-T', '-A', '-B', '-C', '-m', '--glob', '--type', '--max-count'])
const READ_VALUED = new Set(['-n', '-c'])
const NO_VALUED: ReadonlySet<string> = new Set()
/** `sed -n '<from>,<to>p' <file>`: the flag, the range and the file, nothing more. */
const SED_PRINT_WORDS = 3
/** A command with any of these does more than one plain thing, so it is shown as typed. */
const COMPOUND = /[|;&<>`$]|\n/

/** Splits a command into words, honouring single and double quotes. Null for one it cannot read plainly. */
function words(command: string): string[] | null {
  const found: string[] = []
  const pattern = /'([^']*)'|"((?:[^"\\]|\\.)*)"|(\S+)/g
  for (let match = pattern.exec(command); match !== null; match = pattern.exec(command)) {
    found.push(match[1] ?? match[2]?.replace(/\\(.)/g, '$1') ?? match[3] ?? '')
  }
  return found.length === 0 ? null : found
}

/** The words that are not flags (or a flag's value), in order. */
function operands(args: readonly string[], valued: ReadonlySet<string>): string[] {
  const kept: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ''
    if (arg === '--') { kept.push(...args.slice(index + 1)); break }
    if (arg.startsWith('-')) {
      if (valued.has(arg)) index += 1
      continue
    }
    kept.push(arg)
  }
  return kept
}

/** A leading `cd <folder> &&` is where the command runs, not what it does. */
function withoutCd(command: string): string {
  return command.replace(/^\s*cd\s+(?:'[^']*'|"[^"]*"|\S+)\s*&&\s*/, '').trim()
}

export function commandIntent(command: string): CommandIntent | null {
  const plain = withoutCd(command)
  if (plain === '') return null
  if (TEST_RUNNERS.some((runner) => runner.test(plain))) return { verb: 'Run tests', target: plain, search: false }
  if (COMPOUND.test(plain)) return null
  const all = words(plain)
  if (all === null) return null
  const [program = '', ...args] = all
  const rest = operands(args, SEARCHERS.has(program) ? SEARCH_VALUED : READERS.has(program) ? READ_VALUED : NO_VALUED)
  if (SEARCHERS.has(program)) {
    const [pattern, ...where] = rest
    if (pattern === undefined) return null
    return { verb: 'Search', target: where.length === 0 ? `"${pattern}"` : `"${pattern}" in ${where.join(', ')}`, search: true }
  }
  if (READERS.has(program) && rest.length > 0) return { verb: 'Read', target: rest.join(', '), search: false }
  if (program === 'sed' && args[0] === '-n') {
    const range = /^(\d+),(\d+)p$/.exec(args[1] ?? '')
    const file = args[2]
    if (range !== null && file !== undefined && args.length === SED_PRINT_WORDS) return { verb: 'Read', target: `${file} lines ${range[1] ?? ''}–${range[2] ?? ''}`, search: false }
    return null
  }
  if (program === 'ls') return { verb: 'List', target: rest.length === 0 ? 'the folder' : rest.join(', '), search: false }
  if (program === 'find') return { verb: 'Find files in', target: rest[0] ?? 'the folder', search: true }
  if (program === 'git' && rest[0] === 'status') return { verb: 'Check', target: 'git status', search: false }
  if (program === 'git' && rest[0] === 'diff') return { verb: 'Read', target: 'the git diff', search: false }
  if (program === 'git' && rest[0] === 'log') return { verb: 'Read', target: 'the git log', search: false }
  return null
}

/**
 * A search that found nothing exits 1 (`grep`, `rg`): that is an answer, not a failure, so it is shown as one that
 * finished. Any other exit, or output, keeps the command's own status.
 */
export function foundNothing(event: Pick<CommandEvent, 'command' | 'exitCode' | 'output' | 'status'>): boolean {
  return event.status === 'failed' && event.exitCode === 1 && event.output.trim() === '' && commandIntent(event.command)?.search === true
}

/** The status a command step is shown with (`foundNothing`). */
export function shownCommandStatus(event: Pick<CommandEvent, 'command' | 'exitCode' | 'output' | 'status'>): ItemStatus {
  return foundNothing(event) ? 'completed' : event.status
}
