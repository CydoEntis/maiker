import { useState } from 'react'
import { isDesktop } from '@/api/daemon'
import { APP_NAME } from '@/brand'
import { RestartServiceDialog } from './RestartServiceDialog'

/**
 * "Restart the service", for a message that says the service is too old for what was asked. It opens the usual confirm
 * and runs the usual restart, so the person never has to go and find it. Not offered outside the desktop app.
 */
export function RestartServiceButton({ className = 'mx-text-button' }: { className?: string }) {
  const [open, setOpen] = useState(false)
  if (!isDesktop()) return null
  return (
    <>
      <button type="button" className={className} onClick={() => { setOpen(true) }}>{`Restart the ${APP_NAME} service`}</button>
      {open && <RestartServiceDialog open onOpenChange={setOpen} />}
    </>
  )
}
