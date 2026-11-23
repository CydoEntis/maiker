import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LOCAL_MACHINE } from '@/api/machines'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { ModalBody, ModalFoot, ModalHead } from '@/components/ui/modal'
import { Tag } from '@/components/ui/tag'
import { messageOf } from '@/features/inspect/useRepoQuery'
import type { OpenedProject } from '../model/openedProjects'
import { worktreeChoices, type WorktreeChoice } from '../model/projectWorktrees'
import type { SessionView } from '../model/session'
import { rowTitle } from '../model/sidebar'
import { readProjectWorktrees } from '../projectWorktrees'
import { Icon } from './glyphs'
import { windowRoot } from './windowRoot'

/** The worktree mark's size in a row, beside its 13.5px name. */
const ROW_ICON_PX = 16
const MISSING_TIP = 'Its folder is gone. New worktree… lists it under Other worktrees, to make again or to remove.'
/** Another machine's worktrees are not made again or removed from here, so its tip says only what is wrong. */
const MISSING_THERE_TIP = 'Its folder is gone.'

type Props = {
  /** The machine the project is on, and the project: a git repository's main checkout. */
  machine: number
  project: OpenedProject
  /** What the project's heading calls it. */
  name: string
  /** Every session the window lists, for which worktrees are in use. */
  sessions: readonly SessionView[]
  /** Opens the New worktree dialog for the project; null where the project offers none (`worktreeSourceOf`). */
  onNewWorktree: (() => void) | null
  /** Starts the new-chat draft in a worktree's folder on the project's machine. */
  onStart: (folder: string) => void
  /** Shows a session already running in a worktree. */
  onShow: (sessionId: string) => void
  onCancel: () => void
}

/** More worktrees than this and the list offers a search field. */
const SEARCH_AFTER = 6

/** Who uses a worktree, as its badge's tooltip and for a screen reader: "In use by Fix the cart and 1 more". */
function inUseWords(choice: Extract<WorktreeChoice, { kind: 'running' }>): string {
  const more = choice.others > 0 ? ` and ${String(choice.others)} more` : ''
  return `In use by ${rowTitle(choice.session)}${more}`
}

/** Whether a worktree matches what was typed: its folder name or its branch, ignoring case. */
function matches(choice: WorktreeChoice, query: string): boolean {
  const typed = query.trim().toLowerCase()
  if (typed === '') return true
  return choice.name.toLowerCase().includes(typed) || (choice.worktree.branch ?? '').toLowerCase().includes(typed)
}

function Row({ choice, missingTip, onStart, onShow }: { choice: WorktreeChoice; missingTip: string } & Pick<Props, 'onStart' | 'onShow'>) {
  const missing = choice.kind === 'missing'
  const pick = () => {
    if (choice.kind === 'running') onShow(choice.session.id)
    else if (choice.kind === 'open') onStart(choice.worktree.path)
  }
  return (
    <li>
      {/* aria-disabled rather than disabled: a missing worktree stays reachable by Tab, so its tooltip says why. */}
      <button type="button" className="mx-recent-row" aria-disabled={missing} title={missing ? missingTip : choice.worktree.path} onClick={pick}>
        <span className="mx-recent-mark"><Icon name="worktree" size={ROW_ICON_PX} /></span>
        <span className="mx-recent-text">
          <span className="mx-recent-title">{choice.name}</span>
          <span className="mx-recent-where">{choice.worktree.branch ?? 'No branch (detached)'}</span>
        </span>
        {/* A badge says it is taken; picking the row shows that session instead of starting another. */}
        {choice.kind === 'running' && <Tag tone="working" title={inUseWords(choice)} aria-label={inUseWords(choice)}>{choice.others > 0 ? `In use · ${String(choice.others + 1)}` : 'In use'}</Tag>}
        {missing && <Tag tone="err">Missing</Tag>}
      </button>
    </li>
  )
}

/** The empty list's way forward: New worktree where the project offers it, else what it takes to get there. */
function NoneYet({ name, canMake }: { name: string; canMake: boolean }) {
  const how = canMake
    ? 'Make one with New worktree….'
    : `New worktree… makes one from a session in the repository: start one in ${name} with New session first.`
  return <p role="status">{`${name} has no worktrees besides its main checkout. ${how}`}</p>
}

/**
 * A git project's linked worktrees, by folder name and branch: picking one starts a new-chat draft in its folder on the
 * project's machine, one a session already runs in shows that session instead, and one whose folder is gone cannot be
 * picked. The machine's own daemon lists them, so the project needs no session.
 */
export function OpenWorktreeDialog({ machine, project, name, sessions, onNewWorktree, onStart, onShow, onCancel }: Props) {
  const read = useQuery({ queryKey: ['project-worktrees', machine, project.folder], queryFn: () => readProjectWorktrees(machine, project.folder), retry: false })
  const dialog = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const choices = useMemo(() => (read.data?.kind === 'listed' ? worktreeChoices(read.data.worktrees, sessions, machine) : []), [read.data, sessions, machine])
  const shown = choices.filter((choice) => matches(choice, query))
  const body = () => {
    if (read.isError) {
      return (
        <p role="alert">
          {`Could not read the worktrees of ${name}: ${messageOf(read.error)} `}
          <Button variant="ghost" size="sm" onClick={() => { void read.refetch() }}>Try again</Button>
        </p>
      )
    }
    if (read.data === undefined) return <p role="status">{`Reading the worktrees of ${name}…`}</p>
    if (read.data.kind === 'not-a-repo') return <p role="status">{`${project.folder} is not in a git repository, so it has no worktrees.`}</p>
    if (choices.length === 0) return <NoneYet name={name} canMake={onNewWorktree !== null} />
    return (
      <>
        {choices.length > SEARCH_AFTER && (
          <label className="mx-search-field">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input autoFocus value={query} placeholder="Find a worktree or branch" aria-label="Find a worktree or branch" spellCheck={false} onChange={(event) => { setQuery(event.target.value) }} />
          </label>
        )}
        {shown.length === 0
          ? <p role="status" className="mx-modal-note">{`No worktree or branch matches “${query.trim()}”.`}</p>
          : (
              <ul className="mx-recent-list" aria-label={`Worktrees of ${name}`}>
                {shown.map((choice) => <Row key={choice.worktree.path} choice={choice} missingTip={machine === LOCAL_MACHINE ? MISSING_TIP : MISSING_THERE_TIP} onStart={onStart} onShow={onShow} />)}
              </ul>
            )}
      </>
    )
  }
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent unstyled asChild container={windowRoot()} aria-describedby={undefined} onOpenAutoFocus={(event) => { event.preventDefault(); dialog.current?.focus() }}>
        <div
          ref={dialog}
          tabIndex={-1}
          aria-label={`Open a worktree of ${name}`}
          className="mx-rename mx-modal mx-recent"
          onKeyDown={(event) => {
            // Radix closes on Escape; this keeps the key from reaching the app's own handlers.
            if (event.key === 'Escape') event.stopPropagation()
          }}
        >
          <ModalHead title="Open worktree" onClose={onCancel} />
          <ModalBody>
            <p className="mx-modal-note">{`The worktrees of ${name}. Picking one starts a new session in its folder; one marked In use shows its session instead.`}</p>
            {body()}
          </ModalBody>
          <ModalFoot left={<Button variant="ghost" size="lg" onClick={onCancel}>Close</Button>}>
            {onNewWorktree !== null && <Button variant="primary" size="lg" onClick={onNewWorktree}>New worktree…</Button>}
          </ModalFoot>
        </div>
      </DialogContent>
    </Dialog>
  )
}
