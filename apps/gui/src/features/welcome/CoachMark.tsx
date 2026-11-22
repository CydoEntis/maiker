import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Keycaps } from '@/features/shortcuts/Keycaps'
import { useKeyOverrides, usePlatform } from '@/features/shortcuts/platform'
import { bindingFor, shortcutChords } from '@/features/workspace/model/shortcuts'
import { dismissCoachMark, useCoachMark } from './coachMarkState'
import './coach-mark.css'

type Props = {
  /** The side panel is on screen: the tip has been followed, by the button or its keys, and goes. */
  panelShown: boolean
  /** A dialog is open over the window: Esc is that dialog's, not the tip's. */
  covered: boolean
}

/**
 * The one-time tip that points at the side-panel button after the first run. It is not a dialog: it takes no focus and
 * stops no key or click. Got it, Esc (with nothing open over the window) and using the side panel each close it.
 */
export function CoachMark({ panelShown, covered }: Props) {
  const showing = useCoachMark()
  const platform = usePlatform()
  const overrides = useKeyOverrides()
  const chord = shortcutChords(bindingFor('inspect'), platform, overrides)[0]

  useEffect(() => {
    if (showing && panelShown) dismissCoachMark()
  }, [showing, panelShown])

  useEffect(() => {
    if (!showing || covered) return undefined
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') dismissCoachMark() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [showing, covered])

  if (!showing) return null
  return (
    <div className="mx-coach" role="status" aria-label="Side panel tip">
      <span>
        <b>Files, changes, terminals and pull requests</b> open in the side panel.
        {chord !== undefined && <> Press <Keycaps chord={chord} labelled /> any time.</>}
      </span>
      <Button variant="ghost" size="sm" className="self-end" onClick={dismissCoachMark}>Got it</Button>
    </div>
  )
}
