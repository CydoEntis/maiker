import { Segmented, SegmentedItem } from '@/components/ui/radio-group'
import { Icon } from './glyphs'
import type { PaneView } from '../model/chatView'

/**
 * The window's one view, Chat or Terminal, set in Settings → General. It is the Open sessions in setting,
 * so every open session moves with it. Gemini has no chat view and stays in its terminal whatever this says.
 */
export function ViewSwitch({ view, onChange }: { view: PaneView; onChange: (view: PaneView) => void }) {
  return (
    <Segmented aria-label="View" value={view} onValueChange={(next) => { if (next === 'chat' || next === 'terminal') onChange(next) }}>
      <SegmentedItem value="chat" icon={<Icon name="chat" size={13} />}>Chat</SegmentedItem>
      <SegmentedItem value="terminal" icon={<Icon name="terminal" size={13} />}>Terminal</SegmentedItem>
    </Segmented>
  )
}
