import { FieldError, fieldErrorProps } from '@/components/ui/feedback'
import { MOST_ADDRESS_CHARS, MOST_PATH_CHARS, type UrlForm } from './useOpenForms'
import { Icon } from '@/features/workspace/components/glyphs'

const URL_ERROR_ID = 'mx-op-url-why'

const COMPLAINTS = {
  'not-a-url': "That doesn't look like a git URL. It should end in a repository name, like github.com/owner/repo.",
  credentials: 'Leave the user name and password out of the address. Maiker never asks for them; git uses the sign-in this computer already has.',
} as const

/** Clone from URL: the address, what it reads as, and the folder it is cloned into. */
export function UrlPanel({ form, disabled, onSubmit }: { form: UrlForm; disabled: boolean; onSubmit: () => void }) {
  const { repo, complaint } = form
  return (
    <form
      id="mx-op-url"
      className="mx-op-panel"
      onSubmit={(event) => { event.preventDefault(); onSubmit() }}
    >
      <label className="mx-op-label" htmlFor="mx-op-url-field">Repository URL</label>
      <input
        id="mx-op-url-field"
        autoFocus
        placeholder="https://github.com/owner/repo"
        value={form.url}
        maxLength={MOST_ADDRESS_CHARS}
        spellCheck={false}
        disabled={disabled}
        onChange={(event) => { form.setUrl(event.target.value) }}
        {...fieldErrorProps(URL_ERROR_ID, complaint === null ? null : COMPLAINTS[complaint])}
      />
      {complaint !== null && <FieldError id={URL_ERROR_ID}>{COMPLAINTS[complaint]}</FieldError>}
      {repo !== null && (
        <p className="mx-op-preview" role="status">
          <Icon name="repo" size={13} />
          <span className="mx-op-preview-name"><strong>{repo.owner}</strong>/{repo.name}</span>
          <span className="mx-op-host">{repo.host}</span>
        </p>
      )}
      <label className="mx-op-label" htmlFor="mx-op-into">Clone into</label>
      <div className="mx-op-path">
        <span aria-hidden="true">cd</span>
        <input id="mx-op-into" value={form.folder} maxLength={MOST_PATH_CHARS} spellCheck={false} disabled={disabled || repo === null} onChange={(event) => { form.setFolder(event.target.value) }} />
      </div>
    </form>
  )
}
