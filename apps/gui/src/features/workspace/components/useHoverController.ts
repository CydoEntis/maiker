import { useEffect, useState } from 'react'
import { HoverController } from '../model/hoverController'

/** One controller for a list, put away with it. It lives outside React state, so a hover never draws the list again. */
export function useHoverController(): HoverController {
  const [controller] = useState(() => new HoverController())
  useEffect(() => () => { controller.dispose() }, [controller])
  return controller
}
