import { useState, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/lib/error-message'
import { Icon } from './glyphs'

type Props = {
  /** The folder the clone goes into unless another is picked: where the current project lives. */
  parent: string
  /** The folder picker; absent where this window cannot browse the disk. */
  browse: (() => Promise<string | null>) | null
  /** Clones the repository into a new folder inside `parent` and gives that folder (`cloneRepository`). */
  clone: (link: string, parent: string) => Promise<string>
  onBack: () => void
  /** The clone is there: it becomes the new chat's project. */
  onCloned: (folder: string) => void
}

/**
 * The Where popover's Clone from GitHub: a GitHub link or owner/repo, the folder it goes into, and Clone. The
 * host checks the link and runs git off the UI thread; until it answers the view says it is cloning, and a failure
 * stays here with git's reason. There is no GitHub sign-in: a private repository clones with the credentials git
 * already has on this computer.
 */
export function CloneFromGitHub({ parent, browse, clone, onBack, onCloned }: Props) {
  const [link, setLink] = useState('')
  const [into, setInto] = useState(parent)
  const [cloning, setCloning] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const ready = link.trim() !== '' && into !== '' && !cloning

  const start = () => {
    if (!ready) return
    setCloning(true)
    setFailure(null)
    clone(link.trim(), into)
      .then(onCloned)
      .catch((error: unknown) => { setFailure(errorMessage(error, 'Could not clone it')) })
      .finally(() => { setCloning(false) })
  }

  const pickFolder = () => {
    if (browse === null) return
    void browse().then((chosen) => { if (chosen !== null) setInto(chosen) })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    start()
  }

  return (
    <div className="mx-clone" role="group" aria-label="Clone from GitHub">
      <div className="mx-clone-head">
        <button type="button" className="mx-clone-back" aria-label="Back" title="Back" disabled={cloning} onClick={onBack}><Icon name="chevron" size={14} /></button>
        <h3>Clone from GitHub</h3>
      </div>
      <label className="mx-clone-field">
        <input
          autoFocus
          value={link}
          placeholder="Paste a GitHub link or owner/repo"
          aria-label="GitHub repository"
          spellCheck={false}
          disabled={cloning}
          onChange={(event) => { setLink(event.target.value); setFailure(null) }}
          onKeyDown={onKeyDown}
        />
      </label>
      <div className="mx-clone-into">
        <span>Clone into</span>
        <button type="button" className="mx-clone-path" title={browse === null ? into : 'Pick another folder'} disabled={browse === null || cloning} onClick={pickFolder}>{into === '' ? 'Pick a folder' : into}</button>
      </div>
      {failure !== null && <p className="mx-clone-error" role="alert">{failure}</p>}
      <div className="mx-clone-foot">
        <span className="mx-clone-note" aria-live="polite">{cloning ? 'Cloning… a large repository takes a while.' : 'on This computer'}</span>
        <Button variant="primary" size="sm" disabled={!ready} onClick={start}>{cloning ? 'Cloning…' : 'Clone'}</Button>
      </div>
    </div>
  )
}
