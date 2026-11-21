import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LOCAL_MACHINE } from '@/api/machines'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
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

function stateWords(choice: WorktreeChoice): string {
  if (choice.kind === 'missing') return 'Folder missing'
  if (choice.kind === 'open') return ''
  const more = choice.others > 0 ? ` and ${String(choice.others)} more` : ''
  return `In use by ${rowTitle(choice.session)}${more} · Show`
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
        <Icon name="worktree" size={ROW_ICON_PX} />
        <span className="mx-recent-text">
          <span className="mx-recent-title">{choice.name}</span>
          <span className="mx-recent-where">{choice.worktree.branch ?? 'No branch (detached)'}</span>
        </span>
        <span className="mx-recent-when">{stateWords(choice)}</span>
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
  const body = () => {
    if (read.isError) {
      return (
        <p role="alert">
          {`Could not read the worktrees of ${name}: ${messageOf(read.error)} `}
          <button type="button" className="mx-text-button" onClick={() => { void read.refetch() }}>Try again</button>
        </p>
      )
    }
    if (read.data === undefined) return <p role="status">{`Reading the worktrees of ${name}…`}</p>
    if (read.data.kind === 'not-a-repo') return <p role="status">{`${project.folder} is not in a git repository, so it has no worktrees.`}</p>
    const choices = worktreeChoices(read.data.worktrees, sessions, machine)
    if (choices.length === 0) return <NoneYet name={name} canMake={onNewWorktree !== null} />
    return (
      <ul className="mx-recent-list" aria-label={`Worktrees of ${name}`}>
        {choices.map((choice) => <Row key={choice.worktree.path} choice={choice} missingTip={machine === LOCAL_MACHINE ? MISSING_TIP : MISSING_THERE_TIP} onStart={onStart} onShow={onShow} />)}
      </ul>
    )
  }
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent unstyled asChild container={windowRoot()} aria-describedby={undefined} onOpenAutoFocus={(event) => { event.preventDefault(); dialog.current?.focus() }}>
        <div
          ref={dialog}
          tabIndex={-1}
          aria-label={`Open a worktree of ${name}`}
          className="mx-rename mx-recent"
          onKeyDown={(event) => {
            // Radix closes on Escape; this keeps the key from reaching the app's own handlers.
            if (event.key === 'Escape') event.stopPropagation()
          }}
        >
          <DialogTitle asChild><h2>Open worktree</h2></DialogTitle>
          <p>{`The worktrees of ${name}. Picking one starts a new session in its folder; one a session runs in shows that session instead.`}</p>
          {body()}
          <div className="mx-rename-actions">
            {onNewWorktree !== null && <button type="button" className="mx-text-button" onClick={onNewWorktree}>New worktree…</button>}
            <button type="button" className="mx-text-button" onClick={onCancel}>Close</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
