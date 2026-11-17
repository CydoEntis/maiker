import { AGENT_LABELS, type AddPreview } from '@/api/extensions'
import { KIND_ONE, SCOPE_WORDS } from './model'
import { ConfirmDialog } from './ConfirmDialog'

/** The sentence every add carries, whatever is added. */
export const RUNS_CODE = 'This runs code on your computer with your access.'

type Props = {
  preview: AddPreview
  /** Runs the add the preview's token was given for. Resolves with why it was not done, or null when it was. */
  onConfirm: (token: string) => Promise<string | null>
  onCancel: () => void
}

/**
 * What an add will do, read from files before anything is installed: where it comes from, where it applies, exactly what
 * it will run and who hears what you say, then the one sentence that matters. The add runs only when its confirm button
 * is clicked, and only with the token this preview was given.
 */
export function AddDialog({ preview, onConfirm, onCancel }: Props) {
  const title = `Add ${preview.name}?`
  return (
    <ConfirmDialog title={title} confirmLabel={`Add this ${KIND_ONE[preview.kind]}`} onConfirm={() => onConfirm(preview.token)} onCancel={onCancel}>
      <p><b>For</b> {AGENT_LABELS[preview.agent]}, {SCOPE_WORDS[preview.scope]}</p>
      <p><b>From</b> {preview.source}</p>
      <p><b>What it will run</b></p>
      <div className="mx-git-rule-preview" role="group" aria-label="What it will run">
        {preview.runs.map((run, at) => <pre key={at}>{run}</pre>)}
      </div>
      {preview.hosts.length > 0 && <p>Your prompts and tool results are sent to {preview.hosts.join(', ')}.</p>}
      <p><b>{RUNS_CODE}</b> Only continue if you trust where it comes from.</p>
    </ConfirmDialog>
  )
}
