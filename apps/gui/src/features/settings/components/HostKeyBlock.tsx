import { useEffect, useState, type ReactNode } from 'react'
import type { HostKeyReport } from '@/api/machines'
import { errorMessage } from '@/lib/error-message'
import { forgetKeyCommand, keyTypeName } from '../model/hostKey'
import { StatusBlock } from './StatusBlock'

type Look = { state: 'loading' } | { state: 'ready'; report: HostKeyReport } | { state: 'failed'; message: string }

type Props = {
  name: string
  inspect: (name: string) => Promise<HostKeyReport>
  trust: (name: string, fingerprint: string) => Promise<void>
  onCopy: (text: string) => void
  /** On a machine's page: no background. */
  plain?: boolean
  /** The way out of the block: Edit address while adding. */
  leave?: ReactNode
}

/**
 * A host key this computer has not seen, shown instead of ssh's yes/no question: the key's SHA256
 * fingerprint with Copy, and Trust and connect. A key that has CHANGED has no Trust at all, because
 * it can mean someone is sitting between this computer and the machine.
 */
export function HostKeyBlock({ name, inspect, trust, onCopy, plain = false, leave }: Props) {
  const [look, setLook] = useState<Look>({ state: 'loading' })
  const [trusting, setTrusting] = useState(false)
  const [trusted, setTrusted] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => {
    let gone = false
    inspect(name).then(
      (report) => { if (!gone) setLook({ state: 'ready', report }) },
      (error: unknown) => { if (!gone) setLook({ state: 'failed', message: errorMessage(error, 'Could not fetch its host key') }) },
    )
    return () => { gone = true }
  }, [inspect, name])

  if (trusted) return <StatusBlock tone="work" plain={plain} lead={`Linking ${name}…`} />
  if (look.state === 'loading') return <StatusBlock tone="work" plain={plain} lead={`Reaching ${name}…`} />
  if (look.state === 'failed') return <StatusBlock tone="bad" plain={plain} lead={`Couldn't read the host key of ${name}.`} raw={look.message}>{leave}</StatusBlock>
  const { report } = look
  const shown = `${keyTypeName(report.key_type)} ${report.fingerprint}`
  if (report.status === 'trusted') {
    return <StatusBlock tone="quiet" plain={plain} lead="Its host key is already trusted." more="So the host key is not what stopped the login." raw={`${report.host}:${String(report.port)}  ${shown}`}>{leave}</StatusBlock>
  }
  if (report.status === 'changed') {
    const forget = forgetKeyCommand(report)
    return (
      <StatusBlock
        tone="bad"
        plain={plain}
        lead={`${name}'s identity changed since you last connected.`}
        more="This can mean it was reinstalled, or that someone is intercepting the connection. Maiker will not trust a changed key. If you know why it changed, run this, then try again:"
        copy={{ text: forget, label: 'the command that forgets the old key', onCopy }}
        raw={`Now:       ${shown}\nOn record: ${report.known_fingerprint}`}
      >
        {leave}
      </StatusBlock>
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
    <StatusBlock
      tone="needs"
      plain={plain}
      lead={`First time connecting to ${name}.`}
      more={problem ?? 'Trust it if you set it up yourself or got the address from someone you trust.'}
      copy={{ text: report.fingerprint, label: 'the fingerprint', onCopy }}
    >
      <button type="button" className="mx-rm-primary" disabled={trusting} onClick={doTrust}>{trusting ? 'Trusting…' : 'Trust and connect'}</button>
      {leave}
    </StatusBlock>
  )
}
