import type { HostKeyReport } from '@/api/machines'
import { Button } from '@/components/ui/button'
import { forgetKeyCommand, keyTypeName, shownKey } from '../model/hostKey'
import { CopyLine } from './StatusBlock'

type Props = {
  /** A host key that is new to this computer, or one that changed. A trusted one has nothing to ask. */
  report: Exclude<HostKeyReport, { status: 'trusted' }>
  onTrust: () => void
  trusting: boolean
  /** Why trusting did not work, in the host's words. */
  problem: string | null
  onCopy: (text: string) => void
}

/**
 * The step "Check it's the right computer" when it needs the person: the key's fingerprint with **Trust and continue**, or, for
 * a key that CHANGED, no Trust at all (it can mean someone is sitting between this computer and the machine) and the command that
 * forgets the old key for the person who knows why it changed.
 */
export function HostKeyBody({ report, onTrust, trusting, problem, onCopy }: Props) {
  if (report.status === 'changed') {
    return (
      <div className="flex flex-col gap-2.5">
        <p className="m-0 text-xs text-(--fg2)">
          This can mean it was reinstalled, or that someone is intercepting the connection. Maiker will not trust a changed key. If you know why it changed, run this, then try again:
        </p>
        <CopyLine text={forgetKeyCommand(report)} label="the command that forgets the old key" onCopy={onCopy} />
        <p className="m-0 font-(family-name:--mono) text-xs break-all text-(--muted)">Now: {shownKey(report)}<br />On record: {keyTypeName(report.key_type)} · {report.known_fingerprint}</p>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2.5">
      <p className="m-0 text-xs text-(--fg2)">Trust it if you set it up yourself or got the address from someone you trust.</p>
      <CopyLine text={report.fingerprint} shown={shownKey(report)} label="the fingerprint" onCopy={onCopy} />
      {problem !== null && <p role="alert" className="m-0 text-xs text-(--err)">{problem}</p>}
      <div><Button variant="needs" disabled={trusting} onClick={onTrust}>{trusting ? 'Trusting…' : 'Trust and continue'}</Button></div>
    </div>
  )
}
