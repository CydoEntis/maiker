import { keysToPick, type ScreenMenu } from './screenMenu'

/** What a "trust this folder" question needs for a card: the folder it names and the keys of each answer. */
export type TrustPrompt = {
  folder: string
  /** Sent only after a person clicks: it lets the agent work in the folder. */
  trustKeys: string[]
  declineKeys: string[]
}

/** How one agent words its trust question. Anything else, even from the same agent, is not shown as this card. */
type TrustShape = {
  question: RegExp
  /** The line that names the folder; its first group is the folder. */
  folderLine: RegExp
  trust: string
  decline: string
}

/**
 * Claude's wording is the screen the daemon's `asking` is tested against (prompt.rs). Codex's is from its own source
 * ("Do you trust the contents of this directory?", "Yes, continue", "No, quit") and is not yet checked against a
 * capture, which is why a mismatch falls back to the generic menu card instead of guessing.
 */
const SHAPES: Readonly<Record<string, TrustShape>> = {
  claude: {
    question: /do you trust this folder\?/i,
    // The folder is the next non-empty line under this heading.
    folderLine: /^Accessing workspace:[ \t]*\n(?:[ \t]*\n)*[ \t]*(.+)$/m,
    trust: 'Yes, I trust this folder',
    decline: 'No, exit',
  },
  codex: {
    question: /do you trust the contents of this directory\?/i,
    folderLine: /^>?\s*You are in\s+(.+)$/m,
    trust: 'Yes, continue',
    decline: 'No, quit',
  },
}

const FOLDER_GROUP = 1
const MAX_FOLDER_CHARS = 1000
const TWO_CHOICES = 2
const FIRST_PRINTABLE = 0x20
const DELETE = 0x7f
const LAST_C1_CONTROL = 0x9f

const hasControl = (text: string) => Array.from(text).some((char) => {
  const code = char.codePointAt(0) ?? 0
  return code < FIRST_PRINTABLE || (code >= DELETE && code <= LAST_C1_CONTROL)
})

/**
 * Reads a screen menu as the trust question of `agent`, or null when it is anything else. Each answer is found by its
 * exact words, never by its place, the folder must be named on the screen, and there must be exactly the two answers:
 * a reworded or longer menu is not one whose keys are known, so it stays a plain question the person reads.
 */
export function parseTrustPrompt(agent: string, menu: ScreenMenu): TrustPrompt | null {
  const shape = SHAPES[agent]
  if (shape === undefined || !shape.question.test(menu.question) || menu.options.length !== TWO_CHOICES) return null
  const trust = menu.options.indexOf(shape.trust)
  const decline = menu.options.indexOf(shape.decline)
  if (trust < 0 || decline < 0) return null
  const folder = shape.folderLine.exec(menu.question)?.[FOLDER_GROUP]?.trim() ?? ''
  // With the folder missing, the line that follows the heading is the question itself.
  if (folder === '' || shape.question.test(folder) || folder.length > MAX_FOLDER_CHARS || hasControl(folder)) return null
  return { folder, trustKeys: keysToPick(menu, trust), declineKeys: keysToPick(menu, decline) }
}
