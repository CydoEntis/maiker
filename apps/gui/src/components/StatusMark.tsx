import { StatusIcon, type StatusMarkKind } from '@/components/ui/status-icon'

/** The preview's conversation statuses. `recovery` is a conversation that stopped: it needs you, like every state with no mark of its own. */
export type StatusMarkState = 'working' | 'needs-you' | 'done' | 'idle' | 'recovery' | 'unknown'

const MARK: Record<StatusMarkState, StatusMarkKind> = {
  working: 'working', 'needs-you': 'needs', done: 'done', idle: 'idle', recovery: 'needs', unknown: 'idle',
}

/** The preview's name for the one status mark (`components/ui/status-icon.tsx`); it draws nothing of its own. */
export function StatusMark({ status, className }: { status: StatusMarkState; className?: string | undefined }) {
  return <StatusIcon status={MARK[status]} className={className} />
}
