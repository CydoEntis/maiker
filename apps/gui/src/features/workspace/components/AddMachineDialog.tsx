import { useState } from 'react'
import { toast } from '@/lib/toast'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { AddMachineFlow } from '@/features/settings/components/AddMachineFlow'
import { FixMachine } from '@/features/settings/components/FixMachine'
import type { MachineFacts } from '@/features/settings/model/addStage'
import type { MachineHead } from '../model/machines'
import type { MachinesInfo } from '@/features/settings/components/DesktopSettings'
import { windowRoot } from './windowRoot'

type Props = {
  machines: MachinesInfo
  onClose: () => void
  /** A machine that is not connected, to mend here instead of adding one. */
  fixing?: MachineHead | null
  /** Leaves for the fixed machine's page in Settings. */
  onOpenSettings?: () => void
  /** Start a session on the machine just added (by its number): the Start a session button of Machine added. */
  onStartSession?: (machine: number) => void
  /** What the machine's daemon reports about itself. Nothing supplies it yet, so Machine added leaves those rows out. */
  facts?: MachineFacts
  /** The running app's version, for "Copying Maiker <version>". */
  appVersion?: string | null
}

/** Adds a remote machine over the window, or mends one that is not connected; Settings › Remote machines is where the ones added are managed. */
export function AddMachineDialog({ machines, onClose, fixing: fixingFirst = null, onOpenSettings = onClose, onStartSession = onClose, facts, appVersion = null }: Props) {
  // A machine to mend: the one the dialog was opened on, or an already-added host the person clicked in the SSH config list.
  const [fixing, setFixing] = useState(fixingFirst)
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
          {fixing === null
            ? <AddMachineFlow machines={machines} onClose={onClose} onStartSession={onStartSession} onMend={setFixing} onOpenSettings={onOpenSettings} facts={facts} appVersion={appVersion} />
            : <FixMachine head={fixing} machines={machines} onClose={onClose} onConnected={(name) => { toast.success(`Connected to ${name}`); onClose() }} onOpenSettings={onOpenSettings} />}
        </div>
      </DialogContent>
    </Dialog>
  )
}
