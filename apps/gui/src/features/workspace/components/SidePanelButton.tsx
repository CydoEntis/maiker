import { IconButton } from '@/components/ui/icon-button'
import { Icon } from './glyphs'

type Props = {
  /** The side panel is on screen. */
  shown: boolean
  /** There is a session in focus whose panel can show; without one the button has nothing to open. */
  available: boolean
  /** The name with the keys that do the same. */
  tip: string
  onToggle: () => void
}

/** The title bar's one panel button: it shows and hides the side panel, which opens on the view it last showed. */
export function SidePanelButton({ shown, available, tip, onToggle }: Props) {
  return (
    <IconButton label="Side panel" tip={tip} aria-pressed={shown} disabled={!available} onClick={onToggle}>
      <Icon name="sidePanel" />
    </IconButton>
  )
}
