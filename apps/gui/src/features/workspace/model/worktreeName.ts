import type { SessionView } from './session'

const ADJECTIVES = ['bold', 'brave', 'bright', 'calm', 'clever', 'fresh', 'keen', 'lucky', 'quiet', 'sly', 'steady', 'swift', 'tall', 'warm', 'wise', 'young'] as const
const ANIMALS = ['badger', 'crane', 'elk', 'finch', 'hare', 'heron', 'kite', 'lynx', 'marten', 'otter', 'owl', 'raven', 'robin', 'stoat', 'wren', 'yak'] as const
/** Words that say nothing about the task, so a name starts at the first one that does. */
const FILLER = new Set(['a', 'an', 'the', 'please', 'can', 'could', 'you', 'would', 'i', 'we', 'let', 'lets', 'to', 'of', 'for', 'in', 'on', 'and', 'is', 'it', 'my', 'our', 'need', 'want', 'help', 'me', 'us', 'that', 'this'])
/** A name from a task is at most this many words and characters: it is a folder name on Windows too. */
const SLUG_WORDS = 4
const SLUG_CHARS = 32
/** After this many names already in use, a number is added instead of trying again. */
const TRIES = 8

/**
 * A branch name from what a session is working on, like `fix-login-redirect`: the first line's
 * ASCII words, lowercase, filler left out, at most four words and 32 characters. Empty when the
 * text has no such words (blank, only symbols, or not in the Latin alphabet), and the caller falls
 * back to a made-up name.
 */
export function slugFromTask(task: string): string {
  const line = task.split('\n').find((text) => text.trim() !== '') ?? ''
  const words = line.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/[a-z0-9]+/g) ?? []
  const meaningful = words.filter((word) => !FILLER.has(word))
  const chosen: string[] = []
  for (const word of meaningful.length > 0 ? meaningful : words) {
    if (chosen.length === SLUG_WORDS) break
    if ([...chosen, word].join('-').length > SLUG_CHARS) {
      if (chosen.length === 0) chosen.push(word.slice(0, SLUG_CHARS))
      break
    }
    chosen.push(word)
  }
  return chosen.join('-')
}

/** `name`, or the first of `name-2`, `name-3`, … that is free. */
function freeName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name
  let suffix = 2
  while (taken.has(`${name}-${String(suffix)}`)) suffix += 1
  return `${name}-${String(suffix)}`
}

/**
 * A name for a branch nobody named: two short words, like the terminal app's worktrees. "New
 * worktree" on the New session dialog needs a branch at once, because one branch cannot be checked out
 * in two folders. Never one of `taken`.
 */
export function suggestBranchName(taken: ReadonlySet<string>, random: () => number = Math.random): string {
  const pick = (words: readonly string[]) => words[Math.min(words.length - 1, Math.floor(random() * words.length))] ?? words[0] ?? ''
  let name = ''
  for (let attempt = 0; attempt < TRIES; attempt += 1) {
    name = `${pick(ADJECTIVES)}-${pick(ANIMALS)}`
    if (!taken.has(name)) return name
  }
  return freeName(name, taken)
}

/**
 * The name for a new worktree's branch and folder: what the session is working on when that says
 * something, else a made-up two-word name. `-2`, `-3`, … when it is in use. A name the person typed
 * never comes through here.
 */
export function nameForTask(task: string, taken: ReadonlySet<string>, random: () => number = Math.random): string {
  const slug = slugFromTask(task)
  return slug === '' ? suggestBranchName(taken, random) : freeName(slug, taken)
}

/** What a session is working on, for a name: the title the conversation was given, else its last prompt. */
export function sessionTask(session: Pick<SessionView, 'name' | 'lastPrompt'>): string {
  return session.name ?? session.lastPrompt
}
