import { Button } from '@/components/ui/button'
import { InlineNote } from '@/components/ui/feedback'
import { Progress } from '@/components/ui/progress'
import { StatusIcon } from '@/components/ui/status-icon'
import { PHASE_WORDS, type ProjectState } from './useCloneProject'

/** What the clone is doing, and what it made: a progress bar while it runs, the folder when it is ready, the reason when it was not cloned. */
export function ProjectStatus({ state, onUseExisting }: { state: ProjectState; onUseExisting: (folder: string) => void }) {
  switch (state.kind) {
    case 'idle':
      return null
    case 'cloning': {
      const { progress } = state
      return (
        <div className="mx-op-status is-cloning" role="status">
          <span className="mx-op-status-line"><StatusIcon status="working" />Cloning <strong>{state.label}</strong></span>
          <Progress label="Clone progress" {...(progress === null ? {} : { value: progress.percent })} />
          <span className="mx-op-phase">{progress === null ? 'Starting…' : `${PHASE_WORDS[progress.phase]} · ${String(progress.percent)}%`}</span>
        </div>
      )
    }
    case 'ready':
      return (
        <div className="mx-op-status is-ready" role="status">
          <span className="mx-op-status-line"><StatusIcon status="done" /><span><strong>{state.name}</strong> is ready in <code>{state.folder}</code></span></span>
        </div>
      )
    case 'problem': {
      const { problem } = state
      return (
        <InlineNote
          title="Could not clone the repository"
          reason={problem.message}
          actions={problem.kind === 'exists' && problem.folder !== undefined && problem.folder !== ''
            ? <Button variant="ghost" size="sm" onClick={() => { onUseExisting(problem.folder ?? '') }}>Use it</Button>
            : undefined}
        />
      )
    }
  }
}
