import { StatusIcon } from '@/components/ui/status-icon'

/** The mark before "Claude is starting…" and "Sending…": the running light, the one working mark the app has. */
export function WorkingMark({ agent }: { agent: string }) {
  return <span className="mx-working-mark" aria-hidden="true" data-agent={agent}><StatusIcon status="working" size={12} /></span>
}
