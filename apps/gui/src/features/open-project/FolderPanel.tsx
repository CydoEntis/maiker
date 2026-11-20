import { Button } from '@/components/ui/button'
import type { FoundProject } from './useFoundProjects'
import { MOST_PATH_CHARS, type FolderForm } from './useOpenForms'

type Props = {
  form: FolderForm
  found: readonly FoundProject[]
  disabled: boolean
  /** Opens the system's folder picker at the current text; null when it is cancelled. */
  onBrowse: (current: string) => Promise<string | null>
  /** Why the typed folder cannot be opened, or null. */
  problem: string | null
  onSubmit: () => void
}

/** On this computer: the folder to open, typed or browsed to, and the git projects found nearby. */
export function FolderPanel({ form, found, disabled, onBrowse, problem, onSubmit }: Props) {
  const browse = () => { void onBrowse(form.folder).then((chosen) => { if (chosen !== null) form.setFolder(chosen) }) }
  return (
    <form id="mx-op-folder" className="mx-op-panel" onSubmit={(event) => { event.preventDefault(); onSubmit() }}>
      <label className="mx-op-label" htmlFor="mx-op-folder-field">Folder</label>
      <div className="mx-op-path">
        <span aria-hidden="true">cd</span>
        <input id="mx-op-folder-field" autoFocus value={form.folder} maxLength={MOST_PATH_CHARS} spellCheck={false} disabled={disabled} onChange={(event) => { form.setFolder(event.target.value) }} />
        <Button type="button" variant="soft" size="sm" disabled={disabled} onClick={browse}>Browse…</Button>
      </div>
      {problem !== null && <p role="alert" className="mx-op-problem">{problem}</p>}
      {found.length > 0 && (
        <>
          <span className="mx-op-label">Git projects on this computer</span>
          <ul className="mx-op-list" aria-label="Git projects on this computer">
            {found.map((project) => (
              <li key={project.path}>
                <button type="button" className="mx-op-pick" aria-pressed={form.folder === project.path} disabled={disabled} onClick={() => { form.setFolder(project.path) }}>
                  <span className="mx-op-row-text">
                    <span className="mx-op-row-name">{project.name}</span>
                    <span className="mx-op-row-meta">{project.path}</span>
                  </span>
                  <span className="mx-op-host">git · {project.branch}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </form>
  )
}
