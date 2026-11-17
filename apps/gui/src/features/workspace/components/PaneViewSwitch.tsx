import { Segmented, SegmentedItem } from '@/components/ui/radio-group'
import type { PaneView } from '../model/chatView'
import { useTipWithKeys } from '@/features/shortcuts/platform'
import { Icon, type IconName } from './glyphs'

type Props = {
  /** The views this pane can show; the switch keeps its own order. */
  views: readonly PaneView[]
  view: PaneView
  onChange: (view: PaneView) => void
}

const ORDER: readonly PaneView[] = ['chat', 'terminal']
const WORD: Record<PaneView, string> = { chat: 'Chat', terminal: 'Terminal' }
const MARK: Record<PaneView, IconName> = { chat: 'chatBox', terminal: 'terminalBox' }

const isView = (value: string): value is PaneView => (ORDER as readonly string[]).includes(value)

/**
 * The Chat | Terminal toggle of an agent's pane header: a folded segmented frame, each choice a 13px mark and its word.
 * Choosing a view changes what the pane shows and sends nothing to the daemon: every view reads the same session.
 */
export function PaneViewSwitch({ views, view, onChange }: Props) {
  const tip = useTipWithKeys()
  const label = (value: PaneView) => tip(`${WORD[value]} view`, 'chat-toggle')
  return (
    <Segmented aria-label="Pane view" value={view} onValueChange={(next) => { if (isView(next)) onChange(next) }} className="mx-view-switch" onMouseDown={(event) => { event.stopPropagation() }}>
      {ORDER.filter((value) => views.includes(value)).map((value) => (
        <SegmentedItem key={value} value={value} aria-label={label(value)} title={label(value)} className="mx-view-option">
          <Icon name={MARK[value]} />
          {WORD[value]}
        </SegmentedItem>
      ))}
    </Segmented>
  )
}
