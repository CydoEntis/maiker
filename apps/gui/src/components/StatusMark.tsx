import { StatusIcon, type StatusIconKind } from '@/components/ui/status-icon'

/** The preview's conversation statuses. `recovery` is a conversation that stopped, which `markOf` files like any other stop. */
export type StatusMarkState = 'working' | 'needs-you' | 'done' | 'idle' | 'recovery' | 'unknown'

const MARK: Record<StatusMarkState, StatusIconKind> = {
  working: 'working', 'needs-you': 'needs', done: 'done', idle: 'idle', recovery: 'error', unknown: 'unknown',
}

/** The preview's name for the one status mark (`components/ui/status-icon.tsx`); it draws nothing of its own. */
export function StatusMark({ status, named = false, className }: { status: StatusMarkState; named?: boolean; className?: string | undefined }) {
  return <StatusIcon status={MARK[status]} named={named} className={className} />
}
