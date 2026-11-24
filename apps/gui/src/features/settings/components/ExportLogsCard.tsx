import { useState } from 'react'
import { prepareDiagnostics, saveDiagnostics, type DiagnosticsPreview } from '@/api/diagnostics'
import { copyText } from '@/lib/clipboard'
import { toast } from '@/lib/toast'
import { Card, Row } from './DesktopSettings'

type Phase = { kind: 'idle' } | { kind: 'reading' } | { kind: 'ready'; preview: DiagnosticsPreview }

/**
 * Settings › Export logs: reads what a bundle would hold, shows it part by part and as the exact text, then saves
 * that same text where the person picks, or copies a one-line summary. The host reads the files, so it works when
 * the service is old or not running.
 */
export function ExportLogsCard() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [saving, setSaving] = useState(false)

  const prepare = () => {
    setPhase({ kind: 'reading' })
    prepareDiagnostics().then(
      (preview) => { setPhase({ kind: 'ready', preview }) },
      (error: unknown) => {
        setPhase({ kind: 'idle' })
        toast.failed('Could not read the logs', error)
      },
    )
  }
  const save = () => {
    setSaving(true)
    saveDiagnostics().then(
      (path) => { if (path !== null) toast.success('Logs saved', { description: path }) },
      (error: unknown) => { toast.failed('Could not save the logs', error) },
    ).finally(() => { setSaving(false) })
  }
  const copySummary = (summary: string) => {
    copyText(summary).then(
      () => { toast.success('Summary copied') },
      (error: unknown) => { toast.failed('Could not copy the summary', error) },
    )
  }

  return (
    <Card title="Export logs">
      <Row label="Logs for a bug report" detail="Puts versions, your system, whether the service answers, the end of the service log and its recent errors into one text file to send to the maintainer. No chats, files, settings, passwords or keys. Home folders, computer names and addresses are replaced, so look before you send.">
        <button type="button" className="mx-scard-button" disabled={phase.kind === 'reading'} onClick={prepare}>
          {phase.kind === 'reading' ? 'Reading…' : phase.kind === 'ready' ? 'Read again' : 'Preview'}
        </button>
      </Row>
      {phase.kind === 'ready' && <Preview preview={phase.preview} saving={saving} onSave={save} onCopy={copySummary} />}
    </Card>
  )
}

function Preview({ preview, saving, onSave, onCopy }: { preview: DiagnosticsPreview; saving: boolean; onSave: () => void; onCopy: (summary: string) => void }) {
  return (
    <div className="mx-export">
      <ul className="mx-export-parts" aria-label="What the file holds">
        {preview.parts.map((part) => (
          <li key={part.title} data-included={part.included}>
            <span aria-hidden="true">{part.included ? '✓' : '–'}</span>
            <span>{part.title}</span>
            <span className="mx-export-note">{part.note}</span>
          </li>
        ))}
      </ul>
      <details className="mx-export-text">
        <summary>Show the exact text</summary>
        <pre tabIndex={0} aria-label="The exact text that will be saved">{preview.text}</pre>
      </details>
      <div className="mx-mach-buttons">
        <button type="button" className="mx-scard-button" onClick={() => { onCopy(preview.summary) }}>Copy summary</button>
        <button type="button" className="mx-scard-button" disabled={saving} onClick={onSave}>{saving ? 'Saving…' : 'Save file'}</button>
      </div>
    </div>
  )
}
