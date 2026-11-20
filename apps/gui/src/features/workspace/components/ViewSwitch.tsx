import { Segmented, SegmentedItem } from '@/components/ui/radio-group'
import type { PaneView } from '../model/chatView'

/**
 * The window's one view, Chat or Terminal, set in Settings → General. It is the Open sessions in setting,
 * so every open session moves with it. Gemini has no chat view and stays in its terminal whatever this says.
 */
export function ViewSwitch({ view, onChange }: { view: PaneView; onChange: (view: PaneView) => void }) {
  return (
    <Segmented aria-label="View" value={view} onValueChange={(next) => { if (next === 'chat' || next === 'terminal') onChange(next) }}>
      <SegmentedItem value="chat">Chat</SegmentedItem>
      <SegmentedItem value="terminal">Terminal</SegmentedItem>
    </Segmented>
  )
}
