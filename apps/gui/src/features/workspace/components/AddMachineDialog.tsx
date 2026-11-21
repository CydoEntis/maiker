import { Dialog, DialogContent } from '@/components/ui/dialog'
import { AddMachinePanel } from '@/features/settings/components/AddMachinePanel'
import type { MachinesInfo } from '@/features/settings/components/DesktopSettings'
import { windowRoot } from './windowRoot'

type Props = {
  machines: MachinesInfo
  onClose: () => void
  /** Leaves for Settings › Remote machines, where a host clicked in the SSH config list that is already a machine is managed. */
  onOpenSettings?: () => void
}

/**
 * Adds a remote machine over the window; it closes once the machine is in, and the sidebar lists it. Settings › Remote machines
 * is where the ones added are managed. A machine that is not connected is mended where it is listed (its sidebar heading, its
 * Settings row), never here.
 */
export function AddMachineDialog({ machines, onClose, onOpenSettings = onClose }: Props) {
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
          <AddMachinePanel machines={machines} onClose={onClose} onOpenAdded={onOpenSettings} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
