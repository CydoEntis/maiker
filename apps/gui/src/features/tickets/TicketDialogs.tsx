import { useState, type KeyboardEvent } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Segmented, SegmentedItem } from '@/components/ui/radio-group'
import type { TicketDetail } from '@/api/tickets'
import { CHAT_AGENTS, type ChatAgent } from '@/features/workspace/model/chatView'
import { AGENT_LABEL } from '@/features/chat/modelName'
import { PROVIDER_LOOK, ticketBranch, ticketKey, ticketMessage, type Provider } from './model/tickets'

/** What starting an agent on a ticket asks for. */
export type StartChoice = { agent: ChatAgent; worktree: boolean; branch: string; message: string }

type Segment<T extends string> = { value: T; label: string }

function Segments<T extends string>({ label, value, items, onChange }: { label: string; value: T; items: ReadonlyArray<Segment<T>>; onChange: (value: T) => void }) {
  return (
    <Segmented aria-label={label} value={value} onValueChange={(next) => { const picked = items.find((item) => item.value === next); if (picked) onChange(picked.value) }}>
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
  defaultAgent: ChatAgent
  folder: string
  project: string
  /** The name of the other machine the project is on; null on this computer. A worktree is made only here. */
  machineName?: string | null
  onCancel: () => void
  onGo: (choice: StartChoice) => void
}

/**
 * Start an agent on a ticket, showing **exactly what will be sent** before anything starts:
 * Maitty's words, then the ticket's words as a separate, tinted quote. A blocked ticket warns in red; starting is
 * still allowed. Nothing starts without the button or Enter.
 */
export function StartTicketDialog({ container, provider, ticket, blockers, blockerState, defaultAgent, folder, project, machineName = null, onCancel, onGo }: StartProps) {
  const [agent, setAgent] = useState<ChatAgent>(defaultAgent)
  const remote = machineName !== null
  const [worktree, setWorktree] = useState(true)
  const key = ticketKey(ticket)
  const message = ticketMessage(ticket, provider, blockers)
  const branch = ticketBranch(key, ticket.title)
  const look = PROVIDER_LOOK[provider]
  const go = () => { onGo({ agent, worktree, branch, message: message.text }) }
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent unstyled container={container} overlayClassName="mx-tk-scrim" className="mx-tk-dialog" aria-describedby={undefined} onKeyDown={confirmOnEnter(go)}>
        <div className="mx-tk-dialog-head"><DialogTitle className="mx-tk-dialog-title">{`Start an agent on ${key}`}</DialogTitle><span className="mx-spacer" /><button type="button" className="mx-tk-x" aria-label="Cancel (Esc)" onClick={onCancel}>✕</button></div>
        <div className="mx-tk-dialog-body">
          {blockers.length > 0 && (
            <div role="alert" className="mx-tk-alert"><span className="mx-tk-glyph mx-tk-danger">✕</span><span><b>Blocked by {blockers.join(', ')}</b>, which is still {blockerState}. The agent may not be able to finish until it's done.</span></div>
          )}
          <div className="mx-tk-form">
            <span className="mx-tk-dim">Agent</span>
            <Segments label="Agent" value={agent} items={CHAT_AGENTS.map((name) => ({ value: name, label: AGENT_LABEL[name] }))} onChange={setAgent} />
            <span className="mx-tk-dim">Folder</span>
            <span className="mx-tk-folder-row"><span className="mx-tk-folder" title={folder}>{folder}</span><span className="mx-tk-dim">Matched from {project}</span></span>
            <span className="mx-tk-dim">Work in</span>
            <Segments label="Work in" value={worktree ? 'tree' : 'folder'} items={[{ value: 'tree', label: 'New worktree' }, { value: 'folder', label: 'This folder' }]} onChange={(value) => { setWorktree(value === 'tree') }} />
            <span />
            <span className="mx-tk-note">{worktree ? `Own copy on branch ${branch}${remote ? `, made on ${machineName}` : ''}. ${remote ? 'Its' : 'Your'} checkout stays as it is.` : remote ? `Edits ${machineName}'s checkout directly.` : 'Edits your checkout directly.'}</span>
          </div>
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
          <button type="button" className="mx-tk-button is-primary" onClick={go}>{`Start ${AGENT_LABEL[agent]}`}<kbd>Enter</kbd></button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
