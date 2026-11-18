import { useEffect, useState } from 'react'
import type { KeyLoginReport, KeySetupResult } from '@/api/machines'
import { errorMessage } from '@/lib/error-message'

/** ssh's refusal when a password login is on offer: `Permission denied (publickey,password).` */
export const PASSWORD_OFFERED = /Permission denied \([^)]*(password|keyboard-interactive)/i

type Look = { state: 'loading' } | { state: 'ready'; report: KeyLoginReport } | { state: 'failed'; message: string }

type Props = {
  name: string
  inspect: (name: string) => Promise<KeyLoginReport>
  setUp: (name: string, password: string, createKey: boolean) => Promise<KeySetupResult>
  /** The terminal, for what the dialog cannot do. */
  onOpenTerminal?: () => void
}

/**
 * Key login set up with the account password once: the password is used for that one step to put
 * this computer's public key on the machine, and is forgotten. It is held in this component only
 * while it is typed, cleared the moment it is sent, and never shown again.
 */
export function KeyLoginCard({ name, inspect, setUp, onOpenTerminal }: Props) {
  const [look, setLook] = useState<Look>({ state: 'loading' })
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [create, setCreate] = useState(false)
  const [working, setWorking] = useState(false)
  const [result, setResult] = useState<KeySetupResult | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return undefined
    let gone = false
    inspect(name).then(
      (report) => { if (!gone) setLook({ state: 'ready', report }) },
      (error: unknown) => { if (!gone) setLook({ state: 'failed', message: errorMessage(error, 'Could not look at your key') }) },
    )
    return () => { gone = true }
  }, [inspect, name, open])

  const terminal = onOpenTerminal && <button type="button" className="mx-mach-quiet" onClick={onOpenTerminal}>Open a terminal</button>
  if (!open) {
    return (
      <div className="mx-mach-warn">
        <span>{name} takes a password. Set up key login to type it once, and connect with a key from then on.</span>
        <span className="mx-mach-buttons"><button type="button" className="mx-mach-go" onClick={() => { setOpen(true) }}>Set up key login</button></span>
      </div>
    )
  }
  if (result?.outcome === 'installed') {
    return <p className="mx-mach-note" role="status">{result.added ? 'Your key is on' : 'Your key was already on'} {name}, and logging in with it works. {name} is connecting. The password was not kept.</p>
  }
  if (look.state === 'loading') return <p className="mx-mach-note" role="status">Looking at your key…</p>
  if (look.state === 'failed') return <div className="mx-mach-warn" role="alert"><span className="mono">{look.message}</span>{terminal}</div>
  const { report } = look
  if (report.status === 'unavailable') return <div className="mx-mach-warn"><span>{report.reason}</span>{terminal}</div>
  if (report.status === 'host-key-not-trusted') return <div className="mx-mach-warn"><span>Trust the host key of {name} first. A password is never sent to a machine this computer does not trust.</span></div>
  if (report.status === 'encrypted') return <div className="mx-mach-warn"><span>Your key at <span className="mono">{report.path}</span> has a passphrase. Maiker does not handle passphrases here, so use the terminal.</span>{terminal}</div>
  if (report.status === 'blocked') return <div className="mx-mach-warn"><span>{report.reason}</span>{terminal}</div>

  const submit = () => {
    const typed = password
    setPassword('')
    setWorking(true)
    setProblem(null)
    setResult(null)
    setUp(name, typed, create).then(
      (done) => { setResult(done) },
      (error: unknown) => { setProblem(errorMessage(error, 'Could not set up the key')) },
    ).finally(() => { setWorking(false) })
  }
  const needsCreate = report.status === 'no-key'
  const stopped = result?.outcome === 'stopped'
  return (
    <form className="mx-mach-warn" aria-label={`Set up key login for ${name}`} onSubmit={(event) => { event.preventDefault(); submit() }}>
      {report.status === 'no-key'
        ? <span>You have no ssh key yet. Maiker can create an <strong>ed25519</strong> key with <strong>no passphrase</strong> at <span className="mono">{report.path}</span> (and <span className="mono">{report.path}.pub</span>). Only the public key is ever sent to {name}.</span>
        : <span>Maiker will add your public key (<span className="mono">{report.key_type} {report.fingerprint}</span>) to {name}. Only the public key is sent.</span>}
      {needsCreate && (
        <label className="mx-mach-check"><input type="checkbox" checked={create} onChange={(event) => { setCreate(event.target.checked) }} /> Create this key</label>
      )}
      <span>Your password for {name} is used for this one step and then forgotten. It is not stored anywhere.</span>
      <label className="mx-mach-field">
        <span>Password for {name}</span>
        <input type="password" aria-label={`Password for ${name}`} autoComplete="off" spellCheck={false} value={password} disabled={working || stopped} onChange={(event) => { setPassword(event.target.value) }} />
      </label>
      {result?.outcome === 'wrong-password' && <span role="alert">That password was not accepted. {result.attempts_left} {result.attempts_left === 1 ? 'try' : 'tries'} left.</span>}
      {stopped && <span role="alert">Too many wrong passwords for {name}. Maiker stopped trying; use the terminal, or restart Maiker to try again.</span>}
      {(result?.outcome === 'manual' || result?.outcome === 'not-verified') && (
        <>
          <span role="alert">{result.outcome === 'manual' ? result.reason : result.message}</span>
          <span>Do it by hand:</span>
          <span className="mono mx-mach-steps-text">{result.steps}</span>
        </>
      )}
      {problem !== null && <span className="mono" role="alert">{problem}</span>}
      <span className="mx-mach-buttons">
        <button type="submit" className="mx-mach-go" disabled={working || stopped || password === '' || (needsCreate && !create)}>{working ? 'Setting up…' : 'Set up key login'}</button>
        <button type="button" className="mx-mach-quiet" disabled={working} onClick={() => { setOpen(false); setPassword(''); setResult(null) }}>Cancel</button>
        {terminal}
      </span>
    </form>
  )
}
