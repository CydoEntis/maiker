import type { ReactNode } from 'react'
import type { MachineHead } from '@/features/workspace/model/machines'
import { Switch } from '@/components/ui/switch'
import { foldStatusOf, maikerLine, nameOf } from '../model/machineRows'
import { Row as SettingsRow, type MachinesInfo } from './DesktopSettings'
import { Since } from './Since'
import { StatusBlock } from './StatusBlock'

type Props = {
  head: MachineHead
  sessions: number | null
  machines: MachinesInfo
  /** This computer's own Maiker version, for the Maiker row. */
  appVersion: string | null
}

/**
 * What a machine's row holds behind **More**: what is wrong in full when it failed, then plain rows. Update, Retry and
 * Remove stay on the row itself, so nothing here repeats them.
 */
export function MachineFold({ head, sessions, machines, appVersion }: Props) {
  const name = head.label
  const status = foldStatusOf(head, sessions)
  return (
    <div className="mx-rm-fold" role="group" aria-label={`More about ${nameOf(head)}`}>
      {status.tone === 'bad' && (
        <StatusBlock
          tone="bad"
          plain
          lead={<>{status.lead}{status.showsSince && head.downSince !== null && <> for <Since at={head.downSince} />.</>}</>}
          more={status.more}
          copy={status.command === null ? undefined : { text: status.command, label: 'the command', onCopy: machines.onCopyCommand }}
          raw={head.said}
        >
          {loginButtons(head, () => { machines.onRetry(name) }, () => { machines.onOpenLogin(head.machine) })}
        </StatusBlock>
      )}
      <SettingsRow label="Name" detail="What the sidebar calls it. Nothing changes on the machine.">
        <input className="mx-rm-nameinput" aria-label="Name" value={nameOf(head)} maxLength={40} spellCheck={false} onChange={(event) => { machines.onRename(name, event.target.value) }} />
      </SettingsRow>
      <SettingsRow label="Address"><span className="mx-scard-value">{head.target ?? 'Not known yet'}</span></SettingsRow>
      <SettingsRow label="Maiker"><span className="mx-rm-foldvalue">{maikerLine(head, appVersion)}</span></SettingsRow>
      <SettingsRow label="Copy to your clipboard" detail="Lets its sessions put text on your clipboard.">
        <Switch aria-label={`Allow ${name} to copy to your clipboard`} checked={head.grants.clipboard} onCheckedChange={(on) => { machines.onGrant(name, 'clipboard', on) }} />
      </SettingsRow>
      <SettingsRow label="Notifications" detail="Tells you when its sessions need you or finish.">
        <Switch aria-label={`Allow ${name} to notify you`} checked={head.grants.notices} onCheckedChange={(on) => { machines.onGrant(name, 'notices', on) }} />
      </SettingsRow>
    </div>
  )
}

/**
 * A rejected login is the one failure whose fix is not the row's own button: the row says Fix, which opens this fold,
 * so Try again lives here. Any other failure has Retry on the row already. A password or a second code is the one
 * failure a person answers in a terminal, so only it gets the terminal sign-in.
 */
function loginButtons(head: MachineHead, onTryAgain: () => void, onOpenTerminal: () => void): ReactNode {
  if (head.chip?.word !== 'needs login') return undefined
  return (
    <>
      <button type="button" className="mx-rm-primary" onClick={onTryAgain}>Try again</button>
      {head.failure === 'needs-person' && <button type="button" className="mx-rm-text" onClick={onOpenTerminal}>Open a terminal</button>}
    </>
  )
}
