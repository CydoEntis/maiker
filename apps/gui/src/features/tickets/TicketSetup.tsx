import { useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { TicketPlace } from '@/api/ticketLinks'
import { saveTicketKey, type KeyedProvider, type TicketKeyState } from '@/api/tickets'
import { errorMessage } from '@/lib/error-message'
import { useLinkChanges, type ProjectLink } from './model/ticketLinks'
import { PROVIDER_LOOK, type Provider } from './model/tickets'
import { useTicketGroups } from './useTicketData'
import './tickets.css'

/** Plane Cloud's address, the one most people use. A self-hosted Plane has its own. */
export const PLANE_CLOUD = 'https://app.plane.so'
/** Longest key or address the fields take; the daemon checks them again. */
const MOST_FIELD_CHARS = 512
/** `owner/name`, as GitHub spells a repository. */
export const REPO_SHAPE = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/
/** Said wherever a key is typed: where it goes, and that it is for every project. */
export const KEY_ONCE = 'You do this once on this computer: the key is kept by the Maitty service (in its data folder, not the system keychain), used for every project, and never shown again.'

const GROUP_WORD: Readonly<Record<'plane' | 'linear', string>> = { plane: 'project', linear: 'team' }

/** Which project the setup is for: its name, where the daemon keeps it, and the folder it resolved to. */
export type SetupProject = { name: string; place: TicketPlace }

/** Where a link is kept: for the project and its worktrees, and so for every session in it. */
function savedFor(name: string): string {
  return `Saved for ${name} and every worktree of it: every session in this project shows these tickets.`
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children?: ReactNode }) {
  return (
    <li className={`mx-tk-setup-step${done ? ' is-done' : ''}`}>
      <span className="mx-tk-setup-n" aria-hidden="true">{done ? '✓' : String(n)}</span>
      <div className="mx-tk-setup-body">
        <span className="mx-tk-setup-title">{title}</span>
        {children}
      </div>
    </li>
  )
}

/** The key form of a keyed provider, as the setup's first step. The key goes to the service and is never shown again. */
function ConnectKey({ provider, source }: { provider: KeyedProvider; source: 'plane' | 'linear' }) {
  const client = useQueryClient()
  const plane = provider === 'Plane'
  const [address, setAddress] = useState(PLANE_CLOUD)
  const [workspace, setWorkspace] = useState('')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const addressOk = !plane || /^https?:\/\/\S+$/.test(address.trim())
  const ready = key.trim() !== '' && addressOk && (!plane || workspace.trim() !== '')
  const connect = () => {
    if (!ready || busy) return
    setBusy(true)
    const failed = `Could not save the ${provider} key`
    saveTicketKey(provider, plane ? address : '', plane ? workspace : '', key).then((told) => {
      if (!told.ok) {
        setNote(told.failure.kind === 'unreachable' || told.failure.kind === 'invalid' ? `${failed}: ${told.failure.line}` : failed)
        return
      }
      setKey('')
      setNote(null)
      client.setQueryData(['tickets', 'keys'], told.value)
      void client.invalidateQueries({ queryKey: ['tickets'], predicate: (query) => query.queryKey.includes(source) })
    }, (error: unknown) => { setNote(errorMessage(error, failed)) }).finally(() => { setBusy(false) })
  }
  const where = plane ? 'Your Plane address (Plane Cloud is app.plane.so), its workspace slug, and an API key from Profile › API tokens.' : 'An API key from Linear › Settings › Security & access.'
  return (
    <form className="mx-tk-setup-form" onSubmit={(event) => { event.preventDefault(); connect() }}>
      <span className="mx-tk-setup-hint">{where}</span>
      {plane && (
        <>
          <label className={`mx-tk-field${addressOk ? '' : ' is-refused'}`}><span>Address</span>
            <input aria-label="Plane address" value={address} maxLength={MOST_FIELD_CHARS} spellCheck={false} autoComplete="off" onChange={(event) => { setAddress(event.target.value) }} />
          </label>
          <label className="mx-tk-field"><span>Workspace</span>
            <input aria-label="Plane workspace" value={workspace} maxLength={MOST_FIELD_CHARS} spellCheck={false} autoComplete="off" onChange={(event) => { setWorkspace(event.target.value) }} />
          </label>
        </>
      )}
      <label className="mx-tk-field"><span>API key</span>
        <input type="password" autoComplete="off" spellCheck={false} aria-label={`${provider} API key`} value={key} maxLength={MOST_FIELD_CHARS} onChange={(event) => { setKey(event.target.value) }} />
      </label>
      <span className="mx-tk-setup-hint">{KEY_ONCE}</span>
      <div className="mx-tk-source-actions"><button type="submit" className="mx-tk-button is-primary" disabled={!ready || busy}>Connect {provider}</button></div>
      {note !== null && <span className="mx-tk-setup-error" role="alert">{note}</span>}
    </form>
  )
}

/** Step two of a keyed provider: pick the project or team this project reads, from the provider's own list. */
function PickGroup({ source, project, link }: { source: 'plane' | 'linear'; project: SetupProject; link: ProjectLink }) {
  const groups = useTicketGroups(source)
  const { save } = useLinkChanges()
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const word = GROUP_WORD[source]
  const top = (groups.data ?? []).filter((group) => group.parent === null)
  const pick = (id: string, name: string) => {
    setBusy(true)
    save(project.place, { ...link, [source]: { id, name } }).then((told) => {
      setNote(told.ok ? null : told.failure.kind === 'invalid' || told.failure.kind === 'unreachable' ? told.failure.line : 'Could not save the link')
    }, (error: unknown) => { setNote(errorMessage(error, 'Could not save the link')) }).finally(() => { setBusy(false) })
  }
  if (groups.isPending) return <span className="mx-tk-setup-hint">Reading your {PROVIDER_LOOK[source].name} {word}s…</span>
  if (groups.isError) return <span className="mx-tk-setup-error" role="alert">Could not read your {word}s: {errorMessage(groups.error, 'the service did not answer')}</span>
  if (top.length === 0) return <span className="mx-tk-setup-hint">This key sees no {word}s.</span>
  return (
    <>
      <ul className="mx-tk-setup-groups" aria-label={`${PROVIDER_LOOK[source].name} ${word}s`}>
        {top.map((group) => (
          <li key={group.id}>
            <button type="button" className="mx-tk-setup-group" disabled={busy} onClick={() => { pick(group.id, group.name) }}>
              <span>{group.name}</span>{group.count !== null && <span className="mx-tk-dim">{String(group.count)}</span>}
            </button>
          </li>
        ))}
      </ul>
      <span className="mx-tk-setup-hint">{savedFor(project.name)}</span>
      {note !== null && <span className="mx-tk-setup-error" role="alert">{note}</span>}
    </>
  )
}

/** GitHub when the folder names no repository (or GitHub was turned off): type one, or leave it off. */
function GitHubSetup({ project, link, off }: { project: SetupProject; link: ProjectLink; off: boolean }) {
  const { save } = useLinkChanges()
  const [repo, setRepo] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const ok = REPO_SHAPE.test(repo.trim())
  const keep = (github: string | null) => {
    save(project.place, { ...link, github }).then((told) => {
      setNote(told.ok ? null : told.failure.kind === 'invalid' || told.failure.kind === 'unreachable' ? told.failure.line : 'Could not save the link')
    }, (error: unknown) => { setNote(errorMessage(error, 'Could not save the link')) })
  }
  return (
    <ol className="mx-tk-setup" aria-label="Set up GitHub">
      <Step n={1} title="GitHub uses your gh login" done>
        <span className="mx-tk-setup-hint">There is no key to paste: Maitty reads issues with the GitHub command line's own sign-in.</span>
      </Step>
      <Step n={2} title={off ? `GitHub is off for ${project.name}` : `Which repository are ${project.name}'s issues in?`} done={false}>
        <span className="mx-tk-setup-hint">{off ? 'Turn it back on to read the issues of the repository the folder pushes to, or type another.' : 'The folder has no GitHub origin. Type the repository as owner/name.'}</span>
        <form className="mx-tk-setup-row" onSubmit={(event) => { event.preventDefault(); if (ok) keep(repo.trim()) }}>
          <label className={`mx-tk-field${repo === '' || ok ? '' : ' is-refused'}`}>
            <input aria-label={`GitHub repo for ${project.name}`} placeholder="owner/name" value={repo} maxLength={140} spellCheck={false} autoComplete="off" onChange={(event) => { setRepo(event.target.value) }} />
          </label>
          <button type="submit" className="mx-tk-button is-primary" disabled={!ok}>Use this repo</button>
          {off && <button type="button" className="mx-tk-button" onClick={() => { keep(null) }}>Use the folder's origin</button>}
        </form>
        <span className="mx-tk-setup-hint">{savedFor(project.name)}</span>
        {note !== null && <span className="mx-tk-setup-error" role="alert">{note}</span>}
      </Step>
    </ol>
  )
}

/**
 * Setting up one source for the project in front, in place of its tickets: GitHub needs only a repository when the
 * folder names none; Plane and Linear need a key once (for every project) and then the project or team this project
 * reads (for it and its worktrees). Each step says which of the two it is.
 */
export function TicketSetup({ provider, project, link, keys, suggestedLink }: { provider: Provider; project: SetupProject; link: ProjectLink; keys: readonly TicketKeyState[] | undefined; suggestedLink?: string }) {
  // A link an agent suggested (`<app>_tickets_setup`): its words, shown as text; nothing is opened or saved from it.
  const suggested = suggestedLink === undefined ? null : <p className="mx-tk-setup-hint mx-tk-suggested">Your agent suggests <span className="mx-tk-suggested-link">{suggestedLink}</span></p>
  if (provider === 'github') return <>{suggested}<GitHubSetup project={project} link={link} off={link.github === ''} /></>
  const keyed: KeyedProvider = provider === 'plane' ? 'Plane' : 'Linear'
  const name = PROVIDER_LOOK[provider].name
  const connected = keys?.find((key) => key.provider === keyed)?.set ?? false
  const word = GROUP_WORD[provider]
  return (
    <>
    {suggested}
    <ol className="mx-tk-setup" aria-label={`Set up ${name}`}>
      <Step n={1} title={connected ? `${name} is connected on this computer` : `Connect ${name}`} done={connected}>
        {connected ? <span className="mx-tk-setup-hint">For every project. Replace or remove the key in Settings › Tickets › Accounts.</span> : <ConnectKey provider={keyed} source={provider} />}
      </Step>
      <Step n={2} title={`Pick the ${name} ${word} for ${project.name}`} done={false}>
        {connected ? <PickGroup source={provider} project={project} link={link} /> : <span className="mx-tk-setup-hint">After connecting, pick which {word} this project reads.</span>}
      </Step>
    </ol>
    </>
  )
}
