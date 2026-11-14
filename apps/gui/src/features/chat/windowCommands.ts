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
 */
export type WindowRoute =
  | { readonly kind: 'settings'; readonly section: DesktopSettingsSection }
  | { readonly kind: 'panel'; readonly view: InspectView }
  | { readonly kind: 'recent' }
  | { readonly kind: 'commands' }
  | { readonly kind: 'confirm'; readonly ask: ConfirmAsk }

export type ConfirmAsk = { readonly title: string; readonly body: string; readonly confirmLabel: string }

/** The picker's tag for a command that runs as Claude Code takes it once the person says yes. */
export const ASKS_FIRST = 'asks first'

const END: WindowRoute = { kind: 'confirm', ask: { title: 'End this session?', body: 'Claude Code quits and the session ends. Its conversation is kept, so Recent sessions can reopen it.', confirmLabel: 'End session' } }
const BACKGROUND: WindowRoute = { kind: 'confirm', ask: { title: 'Send this session to the background?', body: 'Claude Code hands it to its own background service and leaves this pane. Maitty does not list sessions running there.', confirmLabel: 'Send to background' } }
const CLEAR: WindowRoute = { kind: 'confirm', ask: { title: 'Start a new conversation?', body: 'Claude Code starts over with empty context. The current conversation stays on disk and can be reopened.', confirmLabel: 'Clear' } }
// The Agents page lists the commands approved for each project, the window's view of Claude Code's allow rules.
const SETTINGS_PERMISSIONS: WindowRoute = { kind: 'settings', section: 'agents' }
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
}

/**
 * The window's way to run a command typed or picked in the box: null when it goes to Claude Code as typed. A command
 * typed with something after its name goes as typed too, except one that only asks first, since the window has no
 * place for what was typed.
 */
export function windowRouteOf(name: string, args = ''): WindowRoute | null {
  const found = ROUTES[name]
  if (found === undefined) return null
  if (args.trim() !== '' && found.route.kind !== 'confirm') return null
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
