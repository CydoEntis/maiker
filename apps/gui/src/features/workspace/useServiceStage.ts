import { useEffect, useRef, useState } from 'react'
import { holdToasts } from '@/lib/toast'
import { FOUND_FOR_MS, OFFLINE_AFTER_MS, serviceStageOf, type ServiceStage } from './model/serviceState'

/**
 * The window's stage with its service, from the connection it already has (`online`, the protocol `mismatch`): a lost
 * line is a blip for three seconds, then offline; once it answers again it is `found` for a moment, then `onBack` runs
 * (the Back online toast). `putOff` is Not now on the dialog: the dialog gives way to the title bar's chip until the
 * service is back. While offline the window holds its toasts; they show once it is back.
 */
export function useServiceStage({ online, mismatch, onBack }: { online: boolean; mismatch: boolean; onBack: () => void }): {
  stage: ServiceStage
  putOff: boolean
  setPutOff: (putOff: boolean) => void
} {
  const down = !online && !mismatch
  const [late, setLate] = useState(false)
  const [found, setFound] = useState(false)
  const [putOff, setPutOff] = useState(false)
  // Back after a long outage: say so (the dialog turns green, then the toast). Back after a blip: nothing to say.
  if (!down && late) {
    setLate(false)
    setFound(true)
  }
  // A protocol mismatch put off with Later is asked about again once it clears and comes back.
  if (putOff && !down && !found && !late && !mismatch) setPutOff(false)
  const back = useRef(onBack)
  useEffect(() => { back.current = onBack }, [onBack])
  useEffect(() => {
    if (!down) return undefined
    const timer = window.setTimeout(() => { setLate(true) }, OFFLINE_AFTER_MS)
    return () => { window.clearTimeout(timer) }
  }, [down])
  useEffect(() => {
    if (!found) return undefined
    const timer = window.setTimeout(() => {
      setFound(false)
      setPutOff(false)
      back.current()
    }, FOUND_FOR_MS)
    return () => { window.clearTimeout(timer) }
  }, [found])
  const offline = down && late
  useEffect(() => {
    holdToasts(offline)
    return () => { holdToasts(false) }
  }, [offline])
  return { stage: serviceStageOf({ down, late, found }), putOff, setPutOff }
}
