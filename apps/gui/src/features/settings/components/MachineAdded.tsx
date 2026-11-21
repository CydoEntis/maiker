import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { StatusIcon } from '@/components/ui/status-icon'
import { Icon } from '@/features/workspace/components/glyphs'
import { loadMachineFacts } from '@/api/machineFacts'
import { factsForDisplay } from '../model/machineFacts'
import type { MachineFacts, ReachedMachine } from '../model/addStage'
import { AddMachineFrame, FrameBody, FrameFoot } from './AddMachineFrame'

type Props = {
  reached: ReachedMachine
  facts?: MachineFacts | undefined
  /** The machine's number, once the sidebar lists it; Start a session waits for it. */
  machine: number | null
  /** Saves the name (a local label) and closes. */
  onDone: (name: string) => void
  /** Saves the name, closes, and starts a session on the machine. */
  onStart: (name: string, machine: number) => void
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex min-h-[35px] items-center gap-4 border-b border-(--line) text-[13px]">
      <dt className="m-0 w-[110px] flex-none text-(--dim)">{label}</dt>
      <dd className={mono ? 'm-0 min-w-0 font-(family-name:--mono) text-xs break-all text-(--fg)' : 'm-0 min-w-0 text-(--fg)'}>{value}</dd>
    </div>
  )
}

/** "Machine added": the green line, the name (selected, so typing replaces it), what is known about the machine, and Done / Start a session. */
export function MachineAdded({ reached, facts: given, machine, onDone, onStart }: Props) {
  // Asked of the machine's own daemon once the sidebar lists it. A daemon older than protocol 119 never answers: the rows are then simply left out.
  const [asked, setAsked] = useState<MachineFacts | undefined>(undefined)
  useEffect(() => {
    if (machine === null || given !== undefined) return
    let gone = false
    loadMachineFacts(machine).then((wire) => { if (!gone) setAsked(factsForDisplay(wire)) }, () => undefined)
    return () => { gone = true }
  }, [machine, given])
  const facts = given ?? asked
  const suggested = reached.fromConfig ? reached.name : facts?.reportedName ?? reached.name
  // Until something is typed the field follows the suggestion, which can arrive after the screen does (the machine's own name).
  const [typed, setTyped] = useState<string | null>(null)
  const name = typed ?? suggested
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => { field.current?.select() }, [])
  const chosen = name.trim() === '' ? reached.name : name.trim()
  return (
    <AddMachineFrame title="Machine added" address={reached.address}>
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); onDone(chosen) }}>
        <FrameBody>
          <p role="status" className="m-0 flex items-center gap-2.5 rounded-(--r-panel) bg-[color-mix(in_oklab,var(--done)_6%,transparent)] px-3 py-2.5 text-[13px] text-(--fg2) shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--done)_25%,transparent)]">
            <StatusIcon status="done" />
            Connected. Its sessions show up in your sidebar under this name.
          </p>
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-(--fg)">
            Name
            <span className="flex h-10 items-center gap-2 rounded-(--r-control) border border-(--line2) bg-(--well) px-3 has-[:focus-visible]:border-(--field-focus)">
              <span aria-hidden="true" className="flex flex-none text-(--link)"><Icon name="server" size={15} /></span>
              <input data-bare ref={field} value={name} autoFocus autoComplete="off" spellCheck={false} className="h-full min-w-0 flex-1 bg-transparent text-sm font-medium text-(--fg) outline-none" onChange={(event) => { setTyped(event.target.value) }} />
            </span>
          </label>
          <p className="m-0 text-xs text-(--dim)">This is how it appears in the sidebar. You can rename it any time in Settings.</p>
          <dl className="m-0 flex flex-col border-t border-(--line)">
            <Detail label="Address" value={reached.address} mono />
            {facts?.system !== undefined && <Detail label="System" value={facts.system} />}
            {facts?.agents !== undefined && <Detail label="Agents found" value={facts.agents.length === 0 ? 'None yet' : facts.agents.join(', ')} />}
            {reached.helperVersion !== null && <Detail label="Maiker helper" value={reached.helperVersion} mono />}
          </dl>
        </FrameBody>
        <FrameFoot>
          <Button type="submit" variant="ghost" size="lg">Done</Button>
          <Button type="button" variant="solid" size="xl" disabled={machine === null} onClick={() => { if (machine !== null) onStart(chosen, machine) }}>Start a session</Button>
        </FrameFoot>
      </form>
    </AddMachineFrame>
  )
}
