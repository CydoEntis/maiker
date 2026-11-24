import type { SavedConversation } from '@/api/daemon'
import { RestartServiceButton } from '@/features/updates/RestartServiceButton'
import { ageOf, savedName, whenOf, type SavedRead } from '../model/newChatHost'

type Props = {
  read: SavedRead
  disabled: boolean
  now: number
  onPick: (saved: SavedConversation) => void
}

/** The conversations an agent saved for a folder, newest first, each by its name, the day and time it was last used and how long ago; a click resumes it. */
export function ResumeList({ read, disabled, now, onPick }: Props) {
  if (read.kind === 'none') return <p role="status">Looking for saved conversations…</p>
  if (read.kind === 'failed') return <p role="status">Could not read the saved conversations.</p>
  if (read.kind === 'older') return <p role="status">The Maiker service needs a restart to see saved conversations. <RestartServiceButton /></p>
  if (read.list.length === 0) return <p role="status">No conversation saved for this folder yet.</p>
  return (
    <ul className="mx-recent-list" aria-label="Saved conversations">
      {read.list.map((saved) => (
        <li key={saved.id}>
          <button type="button" className="mx-recent-row" aria-disabled={disabled} title={savedName(saved)} onClick={() => { if (!disabled) onPick(saved) }}>
            <span className="mx-recent-text"><span className="mx-recent-title">{savedName(saved)}</span></span>
            <span className="mx-recent-when">{whenOf(saved.last_active, now)} · {ageOf(saved.last_active, now)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
