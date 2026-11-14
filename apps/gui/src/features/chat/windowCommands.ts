import type { SideAsk, SideCommand } from '@/api/daemon'
import type { InspectView } from '@/features/inspect/InspectPanel'
import type { DesktopSettingsSection } from '@/features/settings/components/DesktopSettings'
import type { SlashCommand } from './slashCommands'

/**
 * Where the window answers a Claude command itself, instead of the menu Claude Code would draw in its terminal:
 * - `settings`: one of Maitty's Settings pages.
 * - `panel`: a tab of the session's side panel.
 * - `recent`: the agent sessions closed on this computer, to reopen one with its conversation.
 * - `commands`: every command the box offers, as `/` alone lists them.
 * - `confirm`: the command still runs as Claude Code takes it, once the person says yes, since it ends or empties the
 *   session.
 * - `aside`: Claude Code answers in a card above the box, from a copy of the session the daemon never saves, so the
 *   conversation is not added to (`sideAnswer`).
 * - `note`: a card above the box that says where the thing is, for a command that only shows a web page's address.
 * - `complete`: the box is filled in, for a command that is nothing without what follows it.
 * - `rename`: the Maitty session takes the name too, and the command still goes to Claude Code, so both agree.
 */
export type WindowRoute =
  | { readonly kind: 'settings'; readonly section: DesktopSettingsSection }
  | { readonly kind: 'panel'; readonly view: InspectView }
  | { readonly kind: 'recent' }
  | { readonly kind: 'commands' }
  | { readonly kind: 'confirm'; readonly ask: ConfirmAsk }
  | { readonly kind: 'aside'; readonly title: string; readonly ask: SideAsk }
  | { readonly kind: 'note'; readonly title: string; readonly text: string }
  | { readonly kind: 'complete'; readonly text: string }
  | { readonly kind: 'rename'; readonly name: string }

export type ConfirmAsk = { readonly title: string; readonly body: string; readonly confirmLabel: string }

/** The picker's tag for a command that runs as Claude Code takes it once the person says yes. */
export const ASKS_FIRST = 'asks first'

/** The picker's tag for a command answered in a card above the box. */
export const ANSWERED_HERE = 'answered here'

/** Claude Code's side question: what follows the name is asked, and the name alone waits for it. */
const SIDE_QUESTION = 'btw'

const RENAME = 'rename'

/**
 * The card for a command only Claude Code's terminal runs, typed in a chat that has no terminal: sent, Claude Code
 * would only say it is not available here.
 */
export function terminalOnlyNote(name: string): WindowRoute {
  return note(`/${name}`, `\`/${name}\` only works in Claude Code's own terminal, and this chat has none. Start a Claude session with a terminal to use it.`)
}

const aside = (command: SideCommand, title: string): WindowRoute => ({ kind: 'aside', title, ask: { command } })
const note = (title: string, text: string): WindowRoute => ({ kind: 'note', title, text })

const END: WindowRoute = { kind: 'confirm', ask: { title: 'End this session?', body: 'Claude Code quits and the session ends. Its conversation is kept, so Recent sessions can reopen it.', confirmLabel: 'End session' } }
const BACKGROUND: WindowRoute = { kind: 'confirm', ask: { title: 'Send this session to the background?', body: 'Claude Code hands it to its own background service and leaves this pane. Maitty does not list sessions running there.', confirmLabel: 'Send to background' } }
const CLEAR: WindowRoute = { kind: 'confirm', ask: { title: 'Start a new conversation?', body: 'Claude Code starts over with empty context. The current conversation stays on disk and can be reopened.', confirmLabel: 'Clear' } }
// The Permissions page lists the commands approved for each project, the window's view of Claude Code's allow rules.
const SETTINGS_PERMISSIONS: WindowRoute = { kind: 'settings', section: 'permissions' }
const HISTORY: WindowRoute = { kind: 'panel', view: 'history' }

/** What a command does in the window, by Claude Code's names for it, and the words the picker tags it with. */
const ROUTES: Readonly<Record<string, { readonly route: WindowRoute; readonly opens: string }>> = {
  permissions: { route: SETTINGS_PERMISSIONS, opens: 'Settings' },
  'allowed-tools': { route: SETTINGS_PERMISSIONS, opens: 'Settings' },
  diff: { route: { kind: 'panel', view: 'changes' }, opens: 'Changes' },
  rewind: { route: HISTORY, opens: 'History' },
  checkpoint: { route: HISTORY, opens: 'History' },
  undo: { route: HISTORY, opens: 'History' },
  resume: { route: { kind: 'recent' }, opens: 'Recent sessions' },
  help: { route: { kind: 'commands' }, opens: 'command list' },
  exit: { route: END, opens: ASKS_FIRST },
  quit: { route: END, opens: ASKS_FIRST },
  background: { route: BACKGROUND, opens: ASKS_FIRST },
  bg: { route: BACKGROUND, opens: ASKS_FIRST },
  clear: { route: CLEAR, opens: ASKS_FIRST },
  [SIDE_QUESTION]: { route: { kind: 'complete', text: `/${SIDE_QUESTION} ` }, opens: ANSWERED_HERE },
  context: { route: aside('context', 'Context'), opens: ANSWERED_HERE },
  usage: { route: aside('usage', 'Usage'), opens: ANSWERED_HERE },
  'skill-doctor': { route: aside('skill-doctor', 'Skills'), opens: ANSWERED_HERE },
  goal: { route: aside('goal', 'Goal'), opens: ANSWERED_HERE },
  advisor: { route: aside('advisor', 'Advisor'), opens: ANSWERED_HERE },
  config: { route: aside('config', 'Config'), opens: ANSWERED_HERE },
  mcp: { route: aside('mcp', 'MCP servers'), opens: ANSWERED_HERE },
  // Claude Code draws a QR code or opens a browser for these; the address is all there is to show.
  mobile: { route: note('Claude on your phone', 'Get the Claude app at [claude.ai/mobile](https://claude.ai/mobile), then sign in with the same account to see your sessions.'), opens: ANSWERED_HERE },
  'privacy-settings': { route: note('Privacy settings', 'Your privacy settings are on your account page: [claude.ai/settings/data-privacy-controls](https://claude.ai/settings/data-privacy-controls).'), opens: ANSWERED_HERE },
  artifacts: { route: note('Artifacts', 'Your published and shared artifacts are at [claude.ai/code/artifacts](https://claude.ai/code/artifacts).'), opens: ANSWERED_HERE },
}

/**
 * The window's way to run a command typed or picked in the box: null when it goes to Claude Code as typed. A command
 * typed with something after its name goes as typed too (`/goal <condition>` sets a goal, which a side answer must
 * not), except one that only asks first, and `/btw`, whose question is what follows.
 */
export function windowRouteOf(name: string, args = ''): WindowRoute | null {
  const question = args.trim()
  // Alone, Claude Code makes a name up; the daemon reads it from the transcript for a session with a terminal.
  if (name === RENAME) return question === '' ? null : { kind: 'rename', name: question }
  const found = ROUTES[name]
  if (found === undefined) return null
  if (name === SIDE_QUESTION && question !== '') return { kind: 'aside', title: 'Side question', ask: { question } }
  if (question !== '' && found.route.kind !== 'confirm') return null
  return found.route
}

/**
 * The list as the picker offers it when the window can answer commands itself: each one it answers is tagged with
 * where it goes (`opens`), and one the window answers is no longer the terminal's, so it is offered also where there is
 * no terminal.
 */
export function withWindowRoutes(commands: readonly SlashCommand[]): SlashCommand[] {
  return commands.map((command) => {
    const found = ROUTES[command.name]
    if (found === undefined) return command
    // One that only asks first still runs where Claude Code runs it.
    if (found.route.kind === 'confirm') return { ...command, opens: found.opens }
    const answered: { -readonly [K in keyof SlashCommand]: SlashCommand[K] } = { ...command, opens: found.opens }
    delete answered.terminal
    return answered
  })
}

/** A one-line command as typed, split into its name and what follows it; null for anything else. */
export function typedCommand(text: string): { name: string; args: string } | null {
  const match = /^\/([\w:-]+)(?:\s+([\s\S]*))?$/.exec(text.trim())
  if (match === null || match[1] === undefined) return null
  return { name: match[1], args: (match[2] ?? '').trim() }
}
