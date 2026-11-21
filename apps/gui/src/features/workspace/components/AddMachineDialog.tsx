import { Dialog, DialogContent } from '@/components/ui/dialog'
import { AddMachineFlow } from '@/features/settings/components/AddMachineFlow'
import type { MachineFacts } from '@/features/settings/model/addStage'
import type { MachinesInfo } from '@/features/settings/components/DesktopSettings'
import { windowRoot } from './windowRoot'

type Props = {
  machines: MachinesInfo
  onClose: () => void
  /** Leaves for Settings › Remote machines, where a host clicked in the SSH config list that is already a machine is managed. */
  onOpenSettings?: () => void
  /** Start a session on the machine just added (by its number): the Start a session button of Machine added. */
  onStartSession?: (machine: number) => void
  /** What the machine's daemon reports about itself. Nothing supplies it yet, so Machine added leaves those rows out. */
  facts?: MachineFacts
  /** The running app's version, for "Copying Maiker <version>". */
  appVersion?: string | null
}

/**
 * Adds a remote machine over the window; Settings › Remote machines is where the ones added are managed. A machine that is
 * not connected is mended where it is listed (its sidebar heading, its Settings row), never here.
 */
export function AddMachineDialog({ machines, onClose, onOpenSettings = onClose, onStartSession = onClose, facts, appVersion = null }: Props) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        unstyled
        asChild
        // Mounted in the themed window, not the body: the corners (`--r-panel`, `--r-control`) and every role colour are tokens of `.mx-app`.
        container={windowRoot()}
        aria-describedby={undefined}
      >
        <div
          className="mx-rename mx-addmachine"
          onKeyDown={(event) => {
            // Radix closes on Escape; this keeps the key from reaching the app's own handlers.
            if (event.key === 'Escape') event.stopPropagation()
          }}
        >
          <AddMachineFlow machines={machines} onClose={onClose} onStartSession={onStartSession} onOpenSettings={onOpenSettings} facts={facts} appVersion={appVersion} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
