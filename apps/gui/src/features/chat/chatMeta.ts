import type { SessionPermissions } from '@/api/daemon'


/** Claude's permission modes in plain words. A mode not listed is shown as it was written. */
const MODE_WORDS: Readonly<Record<string, string>> = {
  default: 'Ask before edits',
  plan: 'Plan mode',
  acceptEdits: 'Accept edits',
  auto: 'Auto',
  dontAsk: "Don't ask",
  bypassPermissions: 'Bypass permissions',
  codexReadOnly: 'Read only',
  codexAuto: 'Auto',
  codexFullAccess: 'Full access',
}

/** What each mode that can be picked does, in a line, and the few words beside its name. */
export const MODE_FACTS: Readonly<Record<string, { readonly what: string; readonly tag?: string }>> = {
  default: { what: 'Asks before it changes a file or runs a command.', tag: 'default' },
  acceptEdits: { what: 'Edits files without asking. Still asks before running commands.' },
  plan: { what: 'Reads and plans only. Changes nothing until you approve the plan.' },
  auto: { what: 'Runs what it judges safe without asking, and asks about the rest.' },
  bypassPermissions: { what: 'Never asks. Use only in a container or VM.', tag: 'sandbox only' },
  codexReadOnly: { what: 'Reads files and answers. Asks before it changes a file or runs a command.' },
  codexAuto: { what: 'Follows your Codex settings: normally it works inside the folder and asks before going outside it.', tag: 'default' },
  codexFullAccess: { what: 'Changes any file and runs any command without asking. Use only in a container or VM.', tag: 'no sandbox' },
}

/**
 * The permission mode a Claude screen is showing, from the line under its prompt ("auto mode on (shift+tab to cycle)"); `default` when it
 * shows none, and null when the screen is empty. Used to show the new mode at once after Shift+Tab, before the agent's file says it.
 */
export function modeFromScreen(screen: string): string | null {
  const text = screen.trimEnd()
  if (text === '') return null
  const tail = text.split('\n').slice(-MODE_LINES).join('\n').toLowerCase()
  if (tail.includes('bypass permissions on')) return 'bypassPermissions'
  if (tail.includes('accept edits on')) return 'acceptEdits'
  if (tail.includes('plan mode on')) return 'plan'
  if (tail.includes('auto mode on')) return 'auto'
  return 'default'
}

/** How many of a screen's last lines can hold the mode line. */
const MODE_LINES = 8

/** The modes Claude cycles through with Shift+Tab, in the order the dropdown lists them. Bypass is there only when Claude was started allowing it. */
export const PICKABLE_MODES: readonly string[] = ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions']

/** Claude's mode that reads and plans and changes nothing until the plan is approved: the message box says so. */
export const PLAN_MODE = 'plan'

/** A mode that asks about nothing: the header marks it, so it is never a quiet default. */
export const BYPASS_MODE = 'bypassPermissions'

/** The Codex mode with no sandbox and no questions. */
export const CODEX_FULL_MODE = 'codexFullAccess'

/** The modes a Codex chat can start in. Codex has no key that cycles them, so they are picked before it starts. */
export const CODEX_START_MODES: readonly string[] = ['codexReadOnly', 'codexAuto', CODEX_FULL_MODE]

/**
 * The modes a chat the daemon runs (Claude or Codex, no terminal) switches between while it runs, each with the
 * permissions it stands for (ADR 0005): the three a chat can start with, so a pick is never a posture it could not start in.
 */
export const CHAT_PERMISSION_MODES: Readonly<Record<'claude' | 'codex', readonly { readonly mode: string; readonly permissions: SessionPermissions }[]>> = {
  claude: [
    { mode: 'default', permissions: 'workspace-write' },
    { mode: PLAN_MODE, permissions: 'read-only' },
    { mode: BYPASS_MODE, permissions: 'full-access' },
  ],
  codex: [
    { mode: 'codexReadOnly', permissions: 'read-only' },
    { mode: 'codexAuto', permissions: 'workspace-write' },
    { mode: CODEX_FULL_MODE, permissions: 'full-access' },
  ],
}

/** The mode each agent starts a new chat in until another is picked: the one that puts nothing on its launch line. */
export const START_MODE: Readonly<Record<'claude' | 'codex' | 'gemini', string>> = { claude: 'default', codex: 'codexAuto', gemini: 'default' }

/**
 * What moves a running Codex to each mode: its own `/permissions` command with one of its built-in profiles and when it asks.
 * Auto is the profile Codex calls Default (works in the folder, asks for the rest).
 */
export const CODEX_MODE_COMMAND: Readonly<Record<string, string>> = {
  codexReadOnly: '/permissions :read-only --approval-policy=on-request',
  codexAuto: '/permissions :workspace --approval-policy=on-request',
  [CODEX_FULL_MODE]: '/permissions :danger-full-access --approval-policy=never',
}

/** What Codex prints when it did not take a `/permissions` command. */
export const CODEX_MODE_REFUSED = /Unknown permission profile|Usage: \/permissions|Failed to set (?:permission profile|approval policy)/

/**
 * Claude Code's own question after `/model` mid-conversation ("Switch model? … 1 Yes, switch to Opus 5.5"). Picking the
 * model in the box is the answer already, so the box answers it rather than leaving a second question in the way.
 */
export const MODEL_SWITCH_ASK = /Switch model\?[\s\S]*\b1[.)]?\s+Yes, switch\b/

/** How many of the screen's last lines the switch-model question can take up. */
const MODEL_ASK_LINES = 16

/** Whether `screen` is waiting on Claude Code's switch-model question: its last lines hold it. */
export function asksToSwitchModel(screen: string): boolean {
  return MODEL_SWITCH_ASK.test(screen.split('\n').slice(-MODEL_ASK_LINES).join('\n'))
}

/** The modes drawn in red: nothing is asked in them. */
export const DANGER_MODES: readonly string[] = [BYPASS_MODE, CODEX_FULL_MODE]

/** The mode's name where there is little room (the message box's control): the full name stays in the menu and the tooltip. */
const SHORT_MODE_WORDS: Readonly<Record<string, string>> = { 'Bypass permissions': 'Bypass' }

export function modeShortLabel(label: string | null): string | null {
  return label === null ? null : (SHORT_MODE_WORDS[label] ?? label)
}

export function modeLabel(mode: string | null): string | null {
  return mode === null ? null : (MODE_WORDS[mode] ?? mode)
}

// "claude-sonnet-5-5" and "claude-opus-4-1-20250805" are named by family and version.
const VERSIONED_MODEL = /^(?:claude-)?([a-z]+)-(\d+)-(\d+)(?:-\d{8})?$/
const CLAUDE_PREFIX = /^claude-/

export function modelLabel(model: string | null): string | null {
  if (model === null) return null
  const parts = VERSIONED_MODEL.exec(model)
  return parts === null ? model.replace(CLAUDE_PREFIX, '') : `${parts[1] ?? ''} ${parts[2] ?? ''}.${parts[3] ?? ''}`
}
