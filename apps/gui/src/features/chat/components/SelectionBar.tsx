import { Copy, Quote } from 'lucide-react'
import { WindowPortal } from '@/components/ui/portal'
import type { PickedText } from '../selectionActions'

type Props = {
  picked: PickedText
  onCopy: () => void
  /** Puts the text in the message box as a quote; absent where there is no box to put it in. */
  onQuote?: (() => void) | undefined
}

/** Half the bar's width and a margin: how close to the window's side its middle may come, so it is never cut off. */
const SIDE_ROOM_PX = 90
/** Its height and the gap above the pointer: how far down a selection at the top of the window puts it. */
const TOP_ROOM_PX = 48

/**
 * What can be done with text selected in the chat, floating where the mouse let go of it: copy it, or quote it
 * into the message box to reply to. A press on it keeps the selection, so the text it acts on stays marked.
 */
export function SelectionBar({ picked, onCopy, onQuote }: Props) {
  // Over everything, like the app's menus: drawn inside the chat it sat under code blocks and was cut off at the
  // chat's edge.
  const left = Math.min(Math.max(picked.x, SIDE_ROOM_PX), Math.max(SIDE_ROOM_PX, window.innerWidth - SIDE_ROOM_PX))
  const top = Math.max(picked.y, TOP_ROOM_PX)
  return (
    <WindowPortal container={null}>
      <div className="mx-select-bar" role="group" aria-label="Selected text" style={{ left, top }} onMouseDown={(event) => { event.preventDefault() }}>
        <button type="button" className="mx-select-action" onClick={onCopy}><Copy size={13} aria-hidden="true" />Copy</button>
        {onQuote !== undefined && <button type="button" className="mx-select-action" onClick={onQuote}><Quote size={13} aria-hidden="true" />Quote</button>}
      </div>
    </WindowPortal>
  )
}
