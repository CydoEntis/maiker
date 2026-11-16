import { ageOf, type SavedRead } from '../model/newChatHost'

type Props = {
  read: SavedRead
  disabled: boolean
  now: number
  onPick: (id: string) => void
}

/** The conversations an agent saved for a folder, newest first, each its first message and how long ago it was active; a click resumes it. */
export function ResumeList({ read, disabled, now, onPick }: Props) {
  if (read.kind === 'none') return <p role="status">Looking for saved conversations…</p>
  if (read.kind === 'failed') return <p role="status">Could not read the saved conversations.</p>
  if (read.kind === 'older') return <p role="status">Restart the Maitty service to see saved conversations.</p>
  if (read.list.length === 0) return <p role="status">No conversation saved for this folder yet.</p>
  return (
    <ul className="mx-recent-list" aria-label="Saved conversations">
      {read.list.map((saved) => (
        <li key={saved.id}>
          <button type="button" className="mx-recent-row" aria-disabled={disabled} title={saved.first_message} onClick={() => { if (!disabled) onPick(saved.id) }}>
            <span className="mx-recent-text"><span className="mx-recent-title">{saved.first_message}</span></span>
            <span className="mx-recent-when">{ageOf(saved.last_active, now)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
