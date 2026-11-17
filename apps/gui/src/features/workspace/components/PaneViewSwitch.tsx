import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import type { PaneView } from '../model/chatView'
import { useTipWithKeys } from '@/features/shortcuts/platform'

type Props = {
  /** The views this pane can show; the switch keeps its own order. */
  views: readonly PaneView[]
  view: PaneView
  onChange: (view: PaneView) => void
}

const ORDER: readonly PaneView[] = ['chat', 'terminal']
const WORD: Record<PaneView, string> = { chat: 'Chat', terminal: 'Terminal' }

const isView = (value: string): value is PaneView => (ORDER as readonly string[]).includes(value)

/**
 * The Chat · Terminal tabs of an agent's pane header, the chosen one underlined in the accent. Choosing a view changes
 * what the pane shows and sends nothing to the daemon: every view reads the same session.
 */
export function PaneViewSwitch({ views, view, onChange }: Props) {
  const tip = useTipWithKeys()
  const label = (value: PaneView) => tip(`${WORD[value]} view`, 'chat-toggle')
  return (
    <RadioGroup aria-label="Pane view" orientation="horizontal" value={view} onValueChange={(next) => { if (isView(next)) onChange(next) }} className="mx-view-switch" onMouseDown={(event) => { event.stopPropagation() }}>
      {ORDER.filter((value) => views.includes(value)).map((value) => (
        <RadioGroupItem key={value} value={value} aria-label={label(value)} title={label(value)} className="mx-view-option">
          {WORD[value]}
        </RadioGroupItem>
      ))}
    </RadioGroup>
  )
}
