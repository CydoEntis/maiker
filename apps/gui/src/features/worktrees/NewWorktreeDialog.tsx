import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { repoBranches, repoWorktrees } from '@/features/inspect/api'
import { messageOf, useRepoQuery } from '@/features/inspect/useRepoQuery'
import { nameForTask } from '@/features/workspace/model/worktreeName'
import { branchNameProblem } from './branchName'
import { WorktreeManager } from './WorktreeManager'
import { FieldError, fieldErrorProps } from '@/components/ui/feedback'
import './worktrees.css'

const BRANCH_ERROR_ID = 'mx-worktree-branch-error'

/** The picker's value for "no base branch". It holds a space, which no branch name can. */
const CURRENT_COMMIT = 'the current commit'
const CURRENT_COMMIT_LABEL = 'The current commit'
const currentCommitLabel = (branch: string | undefined) => (branch === undefined ? CURRENT_COMMIT_LABEL : `${CURRENT_COMMIT_LABEL} of ${branch}`)

type Props = {
  /** The daemon's pane number of the session the worktree is made from. */
  term: number
  repoName: string
  /** The machine the session is on; worktrees are managed on this computer only. */
  machine: number
  /** What the session is working on (its name or last prompt): the suggested name comes from it; empty gives a made-up two-word name. */
  task?: string
  /** The branch the session is on: "the current commit" is that branch's tip, and the menu says so. */
  fromBranch?: string
  /** Offered when the dialog opens from a chat that can move: the same name, but the chat continues in the new folder instead of a new session starting there. */
  move?: { blocked: string | null; run: (branch: string) => Promise<void> }
  onCreate: (branch: string, base: string | null) => Promise<void>
  onCancel: () => void
}

/** ⌘⇧N: a new branch in a folder of its own next to the repo, with a session open in it. */
export function NewWorktreeDialog({ term, repoName, machine, task = '', fromBranch, move, onCreate, onCancel }: Props) {
  const [branch, setBranch] = useState('')
  const [touched, setTouched] = useState(false)
  const [base, setBase] = useState(CURRENT_COMMIT)
  const [error, setError] = useState<string | null>(null)
  // A name's problem shows once the field is left or the form is sent, never while you are still typing it.
  const [checked, setChecked] = useState(false)
  const [working, setWorking] = useState(false)
  const [moving, setMoving] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const branches = useRepoQuery(term, ['branches'], () => repoBranches(term))
  const worktrees = useRepoQuery(term, ['worktrees'], () => repoWorktrees(term))

  useEffect(() => {
    input.current?.focus()
    // The menu or shortcut that opened this may still be giving focus back; claim it once more.
    const timer = window.setTimeout(() => { input.current?.focus() }, 0)
    return () => { window.clearTimeout(timer) }
  }, [])

  // A name is offered once the taken ones are known, selected so typing replaces it; one you have started is left alone.
  const taken = useMemo(() => branches.data !== undefined && worktrees.data !== undefined
    ? [...branches.data.map((candidate) => candidate.name), ...worktrees.data.map((entry) => entry.branch)]
    : null, [branches.data, worktrees.data])
  const suggested = useRef(false)
  useEffect(() => {
    if (taken === null || touched || suggested.current) return
    suggested.current = true
    setBranch(nameForTask(task, new Set(taken)))
    const timer = window.setTimeout(() => { if (document.activeElement === input.current) input.current?.select() }, 0)
    return () => { window.clearTimeout(timer) }
  }, [taken, touched, task])

  const name = branch.trim()
  const existing = branches.data?.some((candidate) => candidate.name === name) ?? false
  const problem = checked ? branchNameProblem(name) : null
  const shown = error ?? problem

  const submit = () => {
    setChecked(true)
    if (branchNameProblem(name) !== null) {
      input.current?.focus()
      return
    }
    setWorking(true)
    setError(null)
    const run = moving && move !== undefined ? move.run(name) : onCreate(name, existing || base === CURRENT_COMMIT ? null : base)
    void run
      .catch((failure: unknown) => { setError(messageOf(failure)) })
      .finally(() => { setWorking(false) })
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent unstyled asChild container={document.querySelector<HTMLElement>('.mx-app')} aria-describedby={undefined}>
        <form
          aria-label="New worktree"
          className="mx-rename mx-wt"
          onSubmit={(event) => { event.preventDefault(); submit() }}
          onKeyDown={(event) => { if (event.key === 'Escape') event.stopPropagation() }}
        >
          <header className="mx-wt-head">
            <DialogTitle asChild><h2>New worktree</h2></DialogTitle>
            <p>A branch in its own folder under .maiker, with a session open in it.</p>
          </header>
          <div className="mx-wt-body">
            <section className="mx-wt-create" aria-label="Create">
              <h3 className="mx-wt-section">Create</h3>
              <div className="mx-wt-field">
                <label htmlFor="mx-wt-branch">Branch name</label>
                <input id="mx-wt-branch" ref={input} value={branch} placeholder="feat/my-change" spellCheck={false} autoComplete="off" {...fieldErrorProps(BRANCH_ERROR_ID, shown)} onBlur={() => { if (name !== '') setChecked(true) }} onChange={(event) => { setBranch(event.target.value); setTouched(true); setError(null) }} />
                {shown !== null && <FieldError id={BRANCH_ERROR_ID}>{shown}</FieldError>}
              </div>
              {moving ? <p className="mx-wt-note">The chat restarts in the new folder and continues the same conversation. Edits not yet committed stay in the old folder.</p> : existing
                ? <p className="mx-wt-note">That branch exists; the worktree checks it out.</p>
                : (
                  <div className="mx-wt-field">
                    <span id="mx-wt-base-label">Start from</span>
                    <Select value={base} onValueChange={setBase}>
                      <SelectTrigger aria-labelledby="mx-wt-base-label" aria-describedby="mx-wt-base-hint" className="mx-wt-base">
                        <SelectValue>{base === CURRENT_COMMIT ? currentCommitLabel(fromBranch) : base}</SelectValue>
                      </SelectTrigger>
                      <SelectContent container={document.querySelector<HTMLElement>('.mx-app')} className="mx-wt-menu">
                        <SelectItem value={CURRENT_COMMIT} text={currentCommitLabel(fromBranch)} className="min-h-8" />
                        {branches.data?.map((candidate) => <SelectItem key={candidate.name} value={candidate.name} text={candidate.name} className="mx-wt-branch min-h-8" />)}
                      </SelectContent>
                    </Select>
                    <small id="mx-wt-base-hint" className="mx-wt-hint">The new branch starts from this commit.</small>
                  </div>
                )}
              {move !== undefined && (
                <div className="mx-wt-move">
                  <div className="mx-wt-move-text">
                    <label id="mx-wt-move-label" htmlFor="mx-wt-move">Move this chat into the worktree</label>
                    <small id="mx-wt-move-hint" className="mx-wt-hint">{move.blocked ?? 'Off starts a new session there'}</small>
                  </div>
                  <Switch id="mx-wt-move" checked={moving} disabled={move.blocked !== null} aria-labelledby="mx-wt-move-label" aria-describedby="mx-wt-move-hint" onCheckedChange={setMoving} />
                </div>
              )}
            </section>
            {worktrees.data && worktrees.data.length > 1 && (
              <WorktreeManager worktrees={worktrees.data} machine={machine} repoName={repoName} onChanged={() => { void worktrees.refetch() }} />
            )}
          </div>
          <footer className="mx-wt-foot">
            <Button type="button" variant="soft" onClick={onCancel}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={working}>{working ? (moving ? 'Moving…' : 'Creating…') : moving ? 'Move chat' : 'Create worktree'}</Button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  )
}
