import { useState, type KeyboardEvent } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { RadioGroup, RadioGroupItem, Segmented, SegmentedItem } from '@/components/ui/radio-group'
import type { TicketDetail, TicketSummary } from '@/api/tickets'
import { CHAT_AGENTS, type ChatAgent } from '@/features/workspace/model/chatView'
import { AGENT_LABEL } from '@/features/chat/modelName'
import { PROVIDER_LOOK, ticketBranch, ticketKey, ticketMessage, type Provider } from './model/tickets'

/** What starting an agent on a ticket asks for. */
export type StartChoice = { agent: ChatAgent; worktree: boolean; branch: string; message: string }

type Segment<T extends string> = { value: T; label: string }

function Segments<T extends string>({ label, value, items, onChange }: { label: string; value: T; items: ReadonlyArray<Segment<T>>; onChange: (value: T) => void }) {
  return (
    <Segmented aria-label={label} tall className="mx-tk-seg is-tall" value={value} onValueChange={(next) => { const picked = items.find((item) => item.value === next); if (picked) onChange(picked.value) }}>
      {items.map((item) => <SegmentedItem key={item.value} value={item.value}>{item.label}</SegmentedItem>)}
    </Segmented>
  )
}

/** Enter confirms a dialog unless focus is on a button (which Enter presses) or in a field. */
function confirmOnEnter(go: () => void) {
  return (event: KeyboardEvent) => {
    const tag = (event.target as HTMLElement).tagName.toLowerCase()
    if (event.key === 'Enter' && !event.shiftKey && tag !== 'button' && tag !== 'input' && tag !== 'textarea') {
      event.preventDefault()
      go()
    }
  }
}

type StartProps = {
  container: HTMLElement | null
  provider: Provider
  ticket: TicketDetail
  /** The keys of the blockers not done yet, with the state of the first. */
  blockers: readonly string[]
  blockerState: string
  /** True: the dialog sends to the chat in front, without the agent, folder and branch choices. */
  here: boolean
  defaultAgent: ChatAgent
  folder: string
  project: string
  /** The name of the other machine the project is on; null on this computer. A worktree is made only here. */
  machineName?: string | null
  onCancel: () => void
  onGo: (choice: StartChoice) => void
}

/**
 * Start an agent on a ticket (or send it to this chat), showing **exactly what will be sent** before anything starts:
 * Maitty's words, then the ticket's words as a separate, tinted quote. A blocked ticket warns in red; starting is
 * still allowed. Nothing starts without the button or Enter.
 */
export function StartTicketDialog({ container, provider, ticket, blockers, blockerState, here, defaultAgent, folder, project, machineName = null, onCancel, onGo }: StartProps) {
  const [agent, setAgent] = useState<ChatAgent>(defaultAgent)
  const remote = machineName !== null
  const [chosenWorktree, setWorktree] = useState(true)
  const worktree = chosenWorktree && !remote
  const key = ticketKey(ticket)
  const message = ticketMessage(ticket, provider, blockers)
  const branch = ticketBranch(key, ticket.title)
  const look = PROVIDER_LOOK[provider]
  const go = () => { onGo({ agent, worktree, branch, message: message.text }) }
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent unstyled container={container} overlayClassName="mx-tk-scrim" className="mx-tk-dialog" aria-describedby={undefined} onKeyDown={confirmOnEnter(go)}>
        <div className="mx-tk-dialog-head"><DialogTitle className="mx-tk-dialog-title">{here ? `Send ${key} to this chat` : `Start an agent on ${key}`}</DialogTitle><span className="mx-spacer" /><button type="button" className="mx-tk-x" aria-label="Cancel (Esc)" onClick={onCancel}>✕</button></div>
        <div className="mx-tk-dialog-body">
          {blockers.length > 0 && (
            <div role="alert" className="mx-tk-alert"><span className="mx-tk-glyph mx-tk-danger">✕</span><span><b>Blocked by {blockers.join(', ')}</b>, which is still {blockerState}. The agent may not be able to finish until it's done.</span></div>
          )}
          {!here && (
            <div className="mx-tk-form">
              <span className="mx-tk-dim">Agent</span>
              <Segments label="Agent" value={agent} items={CHAT_AGENTS.map((name) => ({ value: name, label: AGENT_LABEL[name] }))} onChange={setAgent} />
              <span className="mx-tk-dim">Folder</span>
              <span className="mx-tk-folder-row"><span className="mx-tk-folder" title={folder}>{folder}</span><span className="mx-tk-dim">Matched from {project}</span></span>
              <span className="mx-tk-dim">Work in</span>
              {remote
                ? <span className="mx-tk-folder">This folder</span>
                : <Segments label="Work in" value={worktree ? 'tree' : 'folder'} items={[{ value: 'tree', label: 'New worktree' }, { value: 'folder', label: 'This folder' }]} onChange={(value) => { setWorktree(value === 'tree') }} />}
              <span />
              <span className="mx-tk-note">{remote ? `Edits ${machineName}'s checkout directly: a new worktree is made only on this computer.` : worktree ? `Own copy on branch ${branch}. Your checkout stays as it is.` : 'Edits your checkout directly.'}</span>
            </div>
          )}
          <div className="mx-tk-sent">
            <span className="mx-tk-section-head">Exactly what will be sent</span>
            <div className="mx-tk-sent-box">
              <div className="mx-tk-sent-lead">{message.lead}</div>
              <div className="mx-tk-sent-quote">
                <span className="mx-tk-sent-quote-head"><span className="mx-tk-mark is-small" style={{ color: look.color }}>{look.mark}</span>The ticket's words · {key}<span className="mx-spacer" /><span className="mx-tk-dim">sent as quoted text</span></span>
                <div className="mx-tk-sent-quote-text">{message.quote}</div>
              </div>
            </div>
            <span className="mx-tk-note">The agent is told the quoted part came from {look.name} and to treat it as a request to check, not as instructions.</span>
          </div>
        </div>
        <div className="mx-tk-dialog-foot">
          <button type="button" className="mx-tk-button" onClick={onCancel}>Cancel <kbd>Esc</kbd></button>
          <button type="button" className="mx-tk-button is-primary" onClick={go}>{here ? 'Send to chat' : `Start ${AGENT_LABEL[agent]}`}<kbd>Enter</kbd></button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** A chat a factory could take the tickets in: one already running a factory in this project, or a new one. */
export type FactoryTarget = { id: string; label: string; sub: string }
export const NEW_FACTORY = 'new'

type FactoryProps = {
  container: HTMLElement | null
  provider: Provider
  tickets: readonly TicketSummary[]
  /** The open blockers of each ticket by id; a ticket not in it is still being read. */
  blockersOf: (id: string) => readonly string[] | null
  targets: readonly FactoryTarget[]
  onCancel: () => void
  onGo: (target: string, tickets: readonly TicketSummary[]) => void
}

/**
 * Send to Factory: one row per ticket, a blocked one dimmed with **Blocked · send anyway** (off), which Factory chat
 * takes them (one already running in the project, or a new one), and **Send N to Factory**; with nothing left to send
 * the button says so and does nothing. The factory gets each ticket's key and link and reads the ticket itself.
 */
export function FactoryDialog({ container, provider, tickets, blockersOf, targets, onCancel, onGo }: FactoryProps) {
  const [anyway, setAnyway] = useState<ReadonlySet<string>>(() => new Set())
  const [target, setTarget] = useState(targets[0]?.id ?? NEW_FACTORY)
  const reading = tickets.some((ticket) => blockersOf(ticket.id) === null)
  const blocked = (ticket: TicketSummary) => (blockersOf(ticket.id)?.length ?? 0) > 0
  const send = tickets.filter((ticket) => !blocked(ticket) || anyway.has(ticket.id))
  const skipped = tickets.length - send.length
  const look = PROVIDER_LOOK[provider]
  const choices: FactoryTarget[] = [...targets, { id: NEW_FACTORY, label: 'New Factory chat', sub: "in the ticket's project" }]
  const go = () => { if (send.length > 0 && !reading) onGo(target, send) }
  const toggle = (id: string) => { setAnyway((now) => { const next = new Set(now); if (!next.delete(id)) next.add(id); return next }) }
  const title = tickets.length === 1 && tickets[0] !== undefined ? ticketKey(tickets[0]) : `${String(tickets.length)} tickets`
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent unstyled container={container} overlayClassName="mx-tk-scrim" className="mx-tk-dialog is-narrow" aria-describedby={undefined} onKeyDown={confirmOnEnter(go)}>
        <div className="mx-tk-dialog-head"><DialogTitle className="mx-tk-dialog-title">Send {title} to Factory</DialogTitle><span className="mx-spacer" /><button type="button" className="mx-tk-x" aria-label="Cancel (Esc)" onClick={onCancel}>✕</button></div>
        <div className="mx-tk-dialog-body">
          <div className="mx-tk-send-list">
            {tickets.map((ticket) => {
              const isBlocked = blocked(ticket)
              const on = anyway.has(ticket.id)
              return (
                <div key={ticket.id} className={`mx-tk-send-row${isBlocked && !on ? ' is-skipped' : ''}`}>
                  <span className="mx-tk-mark is-small" style={{ color: look.color }}>{look.mark}</span>
                  <span className="mx-tk-dim mx-tk-mono">{ticketKey(ticket)}</span>
                  <span className="mx-tk-send-title">{ticket.title}</span>
                  {blockersOf(ticket.id) === null && <span className="mx-tk-dim">Checking…</span>}
                  {isBlocked && (
                    <label className="mx-tk-anyway"><input type="checkbox" checked={on} onChange={() => { toggle(ticket.id) }} />Blocked · send anyway</label>
                  )}
                </div>
              )
            })}
          </div>
          {skipped > 0 && <span className="mx-tk-note is-muted">{skipped} blocked ticket{skipped === 1 ? '' : 's'} will be skipped. Tick "send anyway" to include {skipped === 1 ? 'it' : 'them'}.</span>}
          <div className="mx-tk-form">
            <span className="mx-tk-dim">Factory chat</span>
            <RadioGroup aria-label="Factory chat" className="mx-tk-targets" value={target} onValueChange={setTarget}>
              {choices.map((choice) => (
                <RadioGroupItem key={choice.id} value={choice.id} className="mx-tk-target">
                  <span className="mx-tk-target-dot">{target === choice.id ? '●' : ''}</span><span className="mx-tk-target-label">{choice.label}</span><span className="mx-tk-dim">{choice.sub}</span>
                </RadioGroupItem>
              ))}
            </RadioGroup>
          </div>
          <span className="mx-tk-note">The factory gets each ticket's key and link as `/factory run`, and reads the ticket itself. Progress shows in that chat's Work tab.</span>
        </div>
        <div className="mx-tk-dialog-foot">
          <button type="button" className="mx-tk-button" onClick={onCancel}>Cancel <kbd>Esc</kbd></button>
          <button type="button" className="mx-tk-button is-primary" aria-disabled={send.length === 0 || reading} onClick={go}>
            {reading ? 'Checking blockers…' : send.length === 0 ? 'Nothing to send' : `Send ${String(send.length)} to Factory`}<kbd>Enter</kbd>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
