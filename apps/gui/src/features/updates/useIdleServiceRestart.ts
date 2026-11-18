import { useEffect, useRef } from 'react'
import { SERVICE_IDLE_POLL_MS, type ServiceRestartStep } from './serviceRestart'

/**
 * Carries out `serviceRestartStep`: once the step is `restart` it restarts, once for each `key` (the older
 * service's version or protocol), so a restart that failed leaves the manual notice and does not loop. While the
 * step is `wait` it reads the service's state again every few seconds, so the restart happens when the last busy
 * agent finishes. `restart` is the same flow the button runs; this adds no restart path of its own.
 */
export function useIdleServiceRestart({ step, key, restart, recheck }: {
  step: ServiceRestartStep
  key: string | null
  restart: () => void
  recheck: () => void
}) {
  const tried = useRef<string | null>(null)
  const restartRef = useRef(restart)
  const recheckRef = useRef(recheck)
  useEffect(() => {
    restartRef.current = restart
    recheckRef.current = recheck
  })

  useEffect(() => {
    if (key === null || step !== 'restart' || tried.current === key) return
    tried.current = key
    restartRef.current()
  }, [step, key])

  const waiting = step === 'wait' && key !== null
  useEffect(() => {
    if (!waiting) return
    const timer = window.setInterval(() => { recheckRef.current() }, SERVICE_IDLE_POLL_MS)
    return () => { window.clearInterval(timer) }
  }, [waiting])
}
