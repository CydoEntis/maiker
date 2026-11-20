import { useState } from 'react'
import type { MachineHead } from '@/features/workspace/model/machines'
import { Switch } from '@/components/ui/switch'
import { maikerLine, nameOf, pageStatusOf, stoppedOnHostKey } from '../model/machineRows'
import type { MachinesInfo } from './DesktopSettings'
import { HostKeyBlock } from './HostKeyBlock'
import { Since } from './Since'
import { StatusBlock } from './StatusBlock'
import { UpdateAsk } from './UpdateAsk'
import type { UpdateFlow } from './useUpdateFlow'

type Props = {
  head: MachineHead
  sessions: number | null
  machines: MachinesInfo
  flow: UpdateFlow
  /** This computer's own Maiker version, for the Maiker row. */
  appVersion: string | null
  /** Back to the list. */
  onBack: () => void
  onRemoved: () => void
}

/** One machine's page: its status and its fix, then plain rows. There are no section headers. */
export function MachinePage({ head, sessions, machines, flow, appVersion, onBack, onRemoved }: Props) {
  const name = head.label
  const status = pageStatusOf(head, sessions)
  const [removing, setRemoving] = useState(false)
  const busy = flow.running.has(name)
  const checking = flow.checking === name
  const asked = flow.asking?.name === name
  const hostKey = head.chip?.word === 'needs login' && stoppedOnHostKey(head)

  return (
    <section className="mx-rm-page" aria-label={name}>
      <button type="button" className="mx-rm-back" onClick={onBack}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        All machines
      </button>
      <h3 className="mx-rm-title">{nameOf(head)}</h3>
      <div className="mx-rm-status">
        {busy
          ? <StatusBlock tone="work" plain lead={head.updateAction === 'install' ? `Installing Maiker on ${name}…` : `Updating Maiker on ${name}…`} />
          : hostKey
            ? <HostKeyBlock name={name} inspect={machines.hostKey.inspect} trust={machines.hostKey.trust} onCopy={machines.onCopyCommand} plain />
            : (
              <StatusBlock
                tone={status.tone}
                plain
                lead={<>{status.lead}{status.showsSince && head.downSince !== null && <> for <Since at={head.downSince} />.</>}</>}
                more={status.more}
                copy={status.command === null ? undefined : { text: status.command, label: 'the ssh-copy-id command', onCopy: machines.onCopyCommand }}
                raw={status.action === 'retry' ? head.said : null}
              >
                {status.action === 'retry' && <button type="button" className="mx-rm-primary" onClick={() => { machines.onRetry(name) }}>{status.command === null ? 'Retry now' : 'Try again'}</button>}
                {status.command !== null && <button type="button" className="mx-rm-text" onClick={() => { machines.onOpenLogin(head.machine) }}>Open a terminal</button>}
              </StatusBlock>
            )}
      </div>
      <div className="mx-rm-rows">
        <div className="mx-rm-prow">
          <label htmlFor="mx-rm-name">Name</label>
          <input id="mx-rm-name" className="mx-rm-nameinput" value={nameOf(head)} maxLength={40} spellCheck={false} onChange={(event) => { machines.onRename(name, event.target.value) }} />
        </div>
        <div className="mx-rm-prow">
          <span className="mx-rm-k">Address</span>
          <span className="mono mx-rm-value">{head.target ?? 'Not known yet'}</span>
        </div>
        <div className="mx-rm-prow">
          <span className="mx-rm-k">Maiker</span>
          <span className="mx-rm-value">{maikerLine(head, appVersion)}</span>
          {head.updateAction !== null && !busy && (
            <button type="button" className="mx-rm-primary" disabled={checking || asked} aria-label={`${head.updateAction === 'install' ? 'Install' : 'Update'} Maiker on ${name}`} onClick={() => { flow.ask(head) }}>
              {checking ? 'Checking…' : head.updateAction === 'install' ? 'Install' : 'Update'}
            </button>
          )}
        </div>
        {asked && <UpdateAsk flow={flow} plain />}
        <div className="mx-rm-prow is-switch">
          <div className="mx-rm-ptext"><span>Copy to your clipboard</span><span>Lets its sessions put text on your clipboard.</span></div>
          <Switch aria-label={`Allow ${name} to copy to your clipboard`} checked={head.grants.clipboard} onCheckedChange={(on) => { machines.onGrant(name, 'clipboard', on) }} />
        </div>
        <div className="mx-rm-prow is-switch">
          <div className="mx-rm-ptext"><span>Notifications</span><span>Tells you when its sessions need you or finish.</span></div>
          <Switch aria-label={`Allow ${name} to notify you`} checked={head.grants.notices} onCheckedChange={(on) => { machines.onGrant(name, 'notices', on) }} />
        </div>
        <div className="mx-rm-prow">
          {removing
            ? (
              <>
                <span className="mx-rm-value">Its sessions stop showing here. Nothing on {name} is deleted.</span>
                <span className="mx-rm-pbuttons">
                  <button type="button" className="mx-rm-remove" aria-label={`Remove ${name}`} onClick={() => { void machines.onRemove(name); onRemoved() }}>Remove</button>
                  <button type="button" className="mx-rm-text" onClick={() => { setRemoving(false) }}>Cancel</button>
                </span>
              </>
            )
            : <button type="button" className="mx-rm-quiet" aria-label={`Remove ${name}…`} onClick={() => { setRemoving(true) }}>Remove {name}…</button>}
        </div>
      </div>
    </section>
  )
}
