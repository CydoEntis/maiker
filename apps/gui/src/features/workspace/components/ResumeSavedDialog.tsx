import { useRef, useState } from 'react'
import { windowRoot } from './windowRoot'
import { AppIcon } from './glyphs'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { ModalBody, ModalFoot, ModalHead } from '@/components/ui/modal'
import { Segmented, SegmentedItem } from '@/components/ui/radio-group'
import { nowSeconds, savedName, useSavedConversations } from '../model/newChatHost'
import type { NewSessionProject } from '../model/newSession'
import { ChipMenu } from './NewChatMenus'
import { ResumeList } from './ResumeList'

/** The agents whose saved conversations the daemon reads. */
type SavedAgent = 'claude' | 'codex'

type Props = {
  /** This computer's projects, the focused one first: where to look for saved conversations. */
  projects: readonly NewSessionProject[]
  defaultAgent: SavedAgent
  /** A start is under way, so a pick would be refused. */
  locked: boolean
  onPick: (pick: { folder: string; agent: SavedAgent; id: string; name: string; lastActive: number }) => void
  onCancel: () => void
}

/**
 * Resume a saved chat: the conversations Claude or Codex saved for a folder on this computer, newest first. Picking one
 * starts its agent in that folder with that conversation, as a new chat in the folder as it is (no worktree).
 */
export function ResumeSavedDialog({ projects, defaultAgent, locked, onPick, onCancel }: Props) {
  const [agent, setAgent] = useState<SavedAgent>(defaultAgent)
  const [folder, setFolder] = useState(projects[0]?.folder ?? '')
  const read = useSavedConversations(folder, agent)
  const project = projects.find((each) => each.folder === folder)
  const dialog = useRef<HTMLDivElement>(null)
  const [now] = useState(nowSeconds)
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent unstyled asChild container={windowRoot()} aria-describedby={undefined} onOpenAutoFocus={(event) => { event.preventDefault(); dialog.current?.focus() }}>
        <div
          ref={dialog}
          tabIndex={-1}
          aria-label="Resume a saved chat"
          className="mx-rename mx-modal mx-recent"
          onKeyDown={(event) => {
            // Radix closes on Escape; this keeps the key from reaching the app's own handlers.
            if (event.key === 'Escape') event.stopPropagation()
          }}
        >
          <ModalHead title="Resume a saved chat" onClose={onCancel} />
          <ModalBody>
          <p>The conversations an agent saved for a folder on this computer. Picking one starts the agent there with that conversation.</p>
          <div className="mx-resume-pick">
            <Segmented aria-label="Agent" value={agent} onValueChange={(next) => { if (next === 'claude' || next === 'codex') setAgent(next) }}>
              <SegmentedItem value="claude" icon={<AppIcon process="claude" size={14} />}>Claude</SegmentedItem>
              <SegmentedItem value="codex" icon={<AppIcon process="codex" size={14} />}>Codex</SegmentedItem>
            </Segmented>
            <ChipMenu side="bottom" title="Folder" label={project?.name ?? 'Choose a folder'} summary={project?.name ?? 'Choose a folder'}
              sections={[{ heading: 'Folder', items: projects.map((each) => ({ key: each.folder, label: each.name, sub: each.folder, checked: each.folder === folder, onPick: () => { setFolder(each.folder) } })) }]} />
          </div>
          {folder === '' ? <p role="status">No project on this computer yet.</p> : <ResumeList read={read} disabled={locked} now={now} onPick={(saved) => { onPick({ folder, agent, id: saved.id, name: savedName(saved), lastActive: saved.last_active }) }} />}
          </ModalBody>
          <ModalFoot>
            <Button type="button" variant="ghost" size="lg" onClick={onCancel}>Close</Button>
          </ModalFoot>
        </div>
      </DialogContent>
    </Dialog>
  )
}
