import { downSentence, UPDATE_WORDS, type MachineHead, type UpdateAction } from '../model/machines'
import type { MenuEntry } from './MenuPopup'

/** What the window does for another machine from its tag. */
export type MachineActions = {
  /** Dials a machine that is not up again, by its real name. */
  onRetry: (name: string) => void
  /** Opens ssh to a machine in a terminal, for a login that needs a password or a second code. */
  onSignIn: (machine: number, name: string) => void
  /** Copies the command a down machine's sentence names. */
  onCopyCommand: (command: string) => void
  /** Asks for a name of the user's own for the machine. */
  onRename: (name: string) => void
  /** Installs or updates the app on a machine that needs it; the window asks first. */
  onUpdate: (name: string, action: UpdateAction) => void
  onSettings: () => void
  /** Shows Open a project on the machine's own folders; absent while nothing can be opened. */
  onOpenProject?: ((machine: number) => void) | undefined
}

/**
 * The menu of another machine's tag. While the machine is not up it opens with the host's sentence (ADR 0017) and the
 * fix: Retry, Copy the command the sentence names, Sign in in a terminal only for a login that needs a person, or the one
 * Install or Update when its Maiker is missing or old. A machine that is up offers Open a project on it. Rename and
 * Machine settings are always there.
 */
export function machineMenuEntries(head: MachineHead, name: string, actions: MachineActions): MenuEntry[] {
  const update = head.updateAction
  const { onOpenProject } = actions
  const command = head.fixCommand
  const fixes: MenuEntry[] = !head.down
    ? []
    : update !== null
      ? [{ label: `${UPDATE_WORDS[update].verb} Maiker`, run: () => { actions.onUpdate(name, update) } }]
      : [
          { label: 'Retry', run: () => { actions.onRetry(name) } },
          ...(command === null ? [] : [{ label: 'Copy the command', why: command, run: () => { actions.onCopyCommand(command) } }]),
          ...(head.failure === 'needs-person' ? [{ label: 'Sign in in a terminal', run: () => { actions.onSignIn(head.machine, name) } }] : []),
        ]
  return [
    ...(head.down ? [{ heading: downSentence(head) }, ...fixes, 'separator' as const] : []),
    ...(head.down || onOpenProject === undefined ? [] : [{ label: 'Open a project on this machine…', run: () => { onOpenProject(head.machine) } }, 'separator' as const]),
    { label: 'Rename…', run: () => { actions.onRename(name) } },
    { label: 'Machine settings…', run: actions.onSettings },
  ]
}
