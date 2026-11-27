import { toast } from '@/lib/toast'
import { restartMachineService, updateMachine } from '@/api/machines'
import { errorMessage } from '@/lib/error-message'
import { machineLabel } from '@/data/machineNicknames'
import { UPDATE_WORDS, type UpdateAction } from './model/machines'

// The update is the command-line app's, which leads each error it prints with its own name.
const CLI_PREFIX = /^maiker: /

function lines(text: string): { title: string; description?: string } {
  const [title = '', ...rest] = text.split('\n')
  const description = rest.join('\n').trim()
  return description === '' ? { title } : { title, description }
}

/**
 * Install or update the app on a machine with one toast that says it is running and then how it
 * ended: installed, already up to date, or the update's own reason it did not (refused, a newer
 * version there, ssh could not get in, a Windows machine). `onDone` runs after a success, so the
 * machine is dialled again on its new daemon.
 */
/** How the host words a restart the far side refused (`NOT_RESTARTED_LEAD` and `NOT_RESTARTED` in `machine_update.rs`). */
const REFUSED_RESTART = /^The service on .+ was not restarted /

/** Whether an update's failure is the far side keeping its old service, which "Restart anyway" can end. */
export const isRefusedRestart = (said: string): boolean => REFUSED_RESTART.test(said)

/** How many sessions the refusal says the old service keeps (`4 open session(s)`); null when it does not say. */
function keptSessions(said: string): number | null {
  const count = /\((\d+) open session/.exec(said)?.[1]
  return count === undefined ? null : Number(count)
}

/** What a failed update can offer: `onRestartAnyway` runs, with the sessions it would end, when the old service refused to restart. */
export type UpdateFollowUps = { onDone: () => void; onRestartAnyway: (sessions: number | null) => void }

export async function runMachineUpdate(name: string, action: UpdateAction, whenIdle: boolean, { onDone, onRestartAnyway }: UpdateFollowUps): Promise<void> {
  const words = UPDATE_WORDS[action]
  // The toasts name the machine as its owner did; the command still reaches it by its own name.
  const label = machineLabel(name)
  const id = toast.progress(words.running(label))
  try {
    const result = lines(await updateMachine(name, action === 'install', whenIdle))
    toast.success(result.title, { id, ...(result.description === undefined ? {} : { description: result.description }) })
    onDone()
  } catch (error) {
    const said = errorMessage(error, 'The update did not say why.').replace(CLI_PREFIX, '')
    const restart = isRefusedRestart(said) ? { action: { label: 'Restart anyway…', onClick: () => { onRestartAnyway(keptSessions(said)) } }, duration: Infinity } : {}
    toast.error(words.failed(label), { id, description: said, ...restart })
  }
}

/** Restart the service on a machine, ending its sessions, with one toast for how it went; `onDone` dials it again. */
export async function runServiceRestart(name: string, onDone: () => void): Promise<void> {
  const label = machineLabel(name)
  const id = toast.progress(`Restarting Maiker on ${label}…`)
  try {
    await restartMachineService(name)
    toast.success(`Restarted Maiker on ${label}`, { id, description: 'Connecting to the new version.' })
    onDone()
  } catch (error) {
    toast.error(`Could not restart Maiker on ${label}`, { id, description: errorMessage(error, 'It did not say why.') })
  }
}
