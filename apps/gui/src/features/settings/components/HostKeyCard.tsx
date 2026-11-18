import { useEffect, useState } from 'react'
import type { HostKeyReport } from '@/api/machines'
import { errorMessage } from '@/lib/error-message'

const DEFAULT_SSH_PORT = 22

/** ssh's wording when it stops on the host key: with it, the login problem is the key, not the password. */
export const HOST_KEY_WORDS = /Host key verification failed/i

/** How ssh names a key type in its own fingerprint line. */
function typeName(keyType: string): string {
  switch (keyType) {
    case 'ssh-ed25519': return 'ED25519'
    case 'ssh-rsa': return 'RSA'
    default: return keyType.startsWith('ecdsa-') ? 'ECDSA' : keyType
  }
}

type Look = { state: 'loading' } | { state: 'ready'; report: HostKeyReport } | { state: 'failed'; message: string }

type Props = {
  name: string
  inspect: (name: string) => Promise<HostKeyReport>
  trust: (name: string, fingerprint: string) => Promise<void>
  /** The terminal, for a computer that cannot fetch the key itself. */
  onOpenTerminal?: () => void
}

/**
 * A machine whose host key this computer has not seen, shown instead of ssh's yes/no question in
 * a terminal: where it is, the key and its SHA256 fingerprint as ssh prints it, and Trust or
 * Cancel. A key that has CHANGED is a warning with no Trust button.
 */
export function HostKeyCard({ name, inspect, trust, onOpenTerminal }: Props) {
  const [look, setLook] = useState<Look>({ state: 'loading' })
  const [trusting, setTrusting] = useState(false)
  const [trusted, setTrusted] = useState(false)
  const [cancelled, setCancelled] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => {
    let gone = false
    inspect(name).then(
      (report) => { if (!gone) setLook({ state: 'ready', report }) },
      (error: unknown) => { if (!gone) setLook({ state: 'failed', message: errorMessage(error, 'Could not fetch its host key') }) },
    )
    return () => { gone = true }
  }, [inspect, name])

  if (cancelled) return <p className="mx-mach-note">Not trusted. {name} stays unconnected until its host key is trusted.</p>
  if (trusted) return <p className="mx-mach-note" role="status">Trusted. Connecting to {name}…</p>
  if (look.state === 'loading') return <p className="mx-mach-note" role="status">Fetching the host key of {name}…</p>
  if (look.state === 'failed') {
    return (
      <div className="mx-mach-warn" role="alert">
        <span>Could not fetch the host key</span>
        <span className="mono">{look.message}</span>
        {onOpenTerminal && <span className="mx-mach-buttons"><button type="button" className="mx-mach-quiet" onClick={onOpenTerminal}>Open a terminal</button></span>}
      </div>
    )
  }
  const { report } = look
  const facts = (
    <>
      <span>Host</span>
      <span className="mono">{report.host}{report.port === DEFAULT_SSH_PORT ? '' : `:${String(report.port)}`}</span>
      <span>Key</span>
      <span className="mono">{typeName(report.key_type)} {report.fingerprint}</span>
    </>
  )
  if (report.status === 'trusted') {
    return <div className="mx-mach-warn" role="status"><span>Its host key is already trusted, so the host key is not what stopped the login. Read ssh&apos;s own words above.</span>{facts}</div>
  }
  if (report.status === 'changed') {
    return (
      <div className="mx-mach-warn is-danger" role="alert">
        <span><strong>The host key of {name} has changed.</strong> This can mean the machine was reinstalled, or that something is pretending to be it. Maiker will not trust a changed key.</span>
        {facts}
        <span>Key on record</span>
        <span className="mono">{report.known_fingerprint}</span>
        <span>If you know why it changed, remove the old line from known_hosts yourself (<span className="mono">ssh-keygen -R {report.host}</span>), then retry.</span>
      </div>
    )
  }
  const doTrust = () => {
    setTrusting(true)
    setProblem(null)
    trust(name, report.fingerprint).then(
      () => { setTrusted(true) },
      (error: unknown) => { setTrusting(false); setProblem(errorMessage(error, 'Could not trust the key')) },
    )
  }
  return (
    <div className="mx-mach-warn" role="group" aria-label={`Host key of ${name}`}>
      <span><strong>This computer has not seen {name} before.</strong> Check that the fingerprint matches the one on {name} before trusting it.</span>
      {facts}
      {problem !== null && <span className="mono" role="alert">{problem}</span>}
      <span className="mx-mach-buttons">
        <button type="button" className="mx-mach-go" disabled={trusting} onClick={doTrust}>{trusting ? 'Trusting…' : 'Trust this key'}</button>
        <button type="button" className="mx-mach-quiet" disabled={trusting} onClick={() => { setCancelled(true) }}>Cancel</button>
      </span>
    </div>
  )
}
