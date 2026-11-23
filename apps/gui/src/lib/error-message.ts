import { z } from 'zod'
import { APP_NAME } from '@/brand'

/** The failure's own text, or `fallback` when it has none. Prefer `explainError`, which also says what was being done. */
export function errorMessage(error: unknown, fallback: string): string {
  const message = rawText(error)
  return message || fallback
}

/**
 * A failure as a person reads it (docs/CODE-STANDARDS.md#errors): `title` is what failed (the action, "Could not start
 * the chat"), `reason` why in plain words, and `details` the tool's own text, kept for Copy details when it says more
 * than the reason. A failure that already reads as a sentence is kept; a raw one (an OS error, a lower-case tool
 * message) is put in plain words where it is a known kind.
 */
export type ExplainedError = { title: string; reason: string; details: string | null; /** What the person can do about it, named as a button (`Pick another branch`); absent when there is none to offer. */ fix?: string }

/** The longest reason shown; the rest is in the details. */
const REASON_MAX = 240

/** Raw failures put in plain words, first match wins. Each says what happened and, where there is one, what to do. */
const PLAIN_REASONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/connection refused|os error 111|os error 10061|the daemon is not reachable|not connected to the daemon/i, `The ${APP_NAME} service is not answering. It may still be starting; try again in a moment.`],
  [/timed out|deadline has elapsed|took too long/i, `It took too long to answer. Try again; if it keeps happening, restart the ${APP_NAME} service in Settings.`],
  [/permission denied|os error 13|access is denied|os error 5\b/i, `${APP_NAME} is not allowed to use a file or folder it needed. Check that folder’s permissions.`],
  [/no such file or directory|os error 2\b|cannot find the (file|path)/i, 'A file or folder it needed is not there. It may have been moved or deleted.'],
  [/not a git repository/i, 'This folder is not a git repository, so there are no branches or worktrees to use.'],
  [/could not resolve host|network is unreachable|name or service not known|no route to host/i, 'The network could not be reached. Check the connection and try again.'],
  [/already exists/i, 'Something with that name is already there. Pick another name, or remove the old one first.'],
]

/** Tool output reads as raw when it names an OS error code or starts lower-case, as git, Rust and shells print. */
function looksRaw(text: string): boolean {
  return /os error \d+/i.test(text) || /^[a-z]/.test(text) || /^(fatal|error):/i.test(text)
}

/** What a failed check of an answer's shape says instead of the checker's own list of fields, which reads as code. */
export const UNREADABLE_ANSWER = `The answer came back in a form this version cannot read. Restart the ${APP_NAME} service; if it keeps happening, update ${APP_NAME}.`

function rawText(error: unknown): string {
  if (error instanceof z.ZodError) return UNREADABLE_ANSWER
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return text.trim()
}

/** A home folder written as `~`, so a reason does not spell out the person's account name. */
function shortenHome(text: string): string {
  return text.replace(/(?:\/(?:var\/)?home\/[^/\s]+|\/Users\/[^/\s]+|[A-Z]:\\Users\\[^\\\s]+)(?=[/\\\s]|$)/g, '~')
}

/** One sentence: no tool prefix, a capital first letter, a full stop, and no longer than `REASON_MAX`. */
function asSentence(text: string): string {
  const bare = text.replace(/^(fatal|error):\s*/i, '').replace(/\s+/g, ' ').trim()
  const capital = bare.charAt(0).toUpperCase() + bare.slice(1)
  const cut = capital.length > REASON_MAX ? `${capital.slice(0, REASON_MAX - 1).trimEnd()}…` : capital
  return /[.!?…]$/.test(cut) ? cut : `${cut}.`
}

export function explainError(error: unknown, action: string): ExplainedError {
  const raw = rawText(error)
  if (raw === '') return { title: action, reason: 'No reason was given. Try again; if it keeps happening, the service log says more.', details: null }
  const known = looksRaw(raw) ? PLAIN_REASONS.find(([pattern]) => pattern.test(raw))?.[1] : undefined
  const reason = known ?? asSentence(shortenHome(raw))
  return { title: action, reason, details: reason === raw ? null : raw }
}

/** Git's refusal to make a worktree where a folder already stands: `fatal: '<path>' already exists`. */
const WORKTREE_FOLDER_TAKEN = /'([^']+)' already exists/

/** The button on a worktree failure that the branch name can cure. */
export const PICK_ANOTHER_BRANCH = 'Pick another branch'

/**
 * A failed start that was making a worktree for `branch`. When the worktree's folder is already there, it says so in
 * words and offers a different branch name; any other failure is explained as `explainError` does under `action`.
 */
export function explainStartFailure(error: unknown, action: string, branch: { name: string; worktree: boolean } | null): ExplainedError {
  const raw = rawText(error)
  const taken = branch?.worktree === true ? WORKTREE_FOLDER_TAKEN.exec(raw)?.[1] : undefined
  if (branch === null || taken === undefined) return explainError(error, action)
  return {
    title: `Could not make a worktree for branch ${branch.name}`,
    reason: `Its folder ${shortenHome(taken)} is already there. Remove that folder, or pick another branch name.`,
    details: raw,
    fix: PICK_ANOTHER_BRANCH,
  }
}
