import { toast } from '@/lib/toast'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { AddMachinePanel } from '@/features/settings/components/AddMachinePanel'
import { KEY_TERMINAL_ATTRIBUTE } from '@/features/settings/components/KeyTerminal'
import { FixMachine } from '@/features/settings/components/FixMachine'
import type { MachineHead } from '../model/machines'
import type { AddedHow } from '@/features/settings/components/AddMachinePanel'
import type { MachinesInfo } from '@/features/settings/components/DesktopSettings'

/** What the person is told when the dialog closes, by how the machine came to be added. */
function sayAdded(name: string, how: AddedHow) {
  if (how === 'connected') toast.success(`Connected to ${name}`)
  else if (how === 'installed') toast.success(`Maiker is on ${name}`, { description: 'It connects in a moment.' })
  else toast.info(`Added ${name}`)
}

type Props = {
  machines: MachinesInfo
  onClose: () => void
  /** A machine that is not connected, to mend here instead of adding one. */
  fixing?: MachineHead | null
  /** Leaves for the fixed machine's page in Settings. */
  onOpenSettings?: () => void
}

/** Adds a remote machine over the window, or mends one that is not connected; Settings › Remote machines is where the ones added are managed. */
export function AddMachineDialog({ machines, onClose, fixing = null, onOpenSettings = onClose }: Props) {
  const title = fixing === null ? 'Add a remote machine' : `Fix ${fixing.label}`
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        unstyled
        asChild
        aria-describedby={undefined}
        // Esc is the terminal's own key while it has focus (it is a shell's key too); anywhere else in the dialog it closes it.
        onEscapeKeyDown={(event) => { if (event.target instanceof Element && event.target.closest(`[${KEY_TERMINAL_ATTRIBUTE}]`) !== null) event.preventDefault() }}
      >
        <div
          aria-label={title}
          className="mx-rename mx-addmachine"
          onKeyDown={(event) => {
            // Radix closes on Escape; this keeps the key from reaching the app's own handlers.
            if (event.key === 'Escape') event.stopPropagation()
          }}
        >
          <DialogTitle asChild><h2>{title}</h2></DialogTitle>
          {fixing === null
            ? <AddMachinePanel machines={machines} embedded onClose={onClose} onAdded={(name, how) => { sayAdded(name, how); onClose() }} />
            : <FixMachine head={fixing} machines={machines} onConnected={(name) => { sayAdded(name, 'connected'); onClose() }} onOpenSettings={onOpenSettings} />}
          <div className="mx-rename-actions">
            <button type="button" className="mx-text-button" onClick={onClose}>Close</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
