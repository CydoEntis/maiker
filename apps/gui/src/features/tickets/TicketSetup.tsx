import { useState, type ReactNode } from 'react'
import { SkeletonLines } from '@/components/ui/skeleton'
import { useQueryClient } from '@tanstack/react-query'
import type { TicketPlace } from '@/api/ticketLinks'
import { saveTicketKey, type KeyedProvider, type TicketKeyState } from '@/api/tickets'
import { errorMessage } from '@/lib/error-message'
import { useLinkChanges, type ProjectLink } from './model/ticketLinks'
import { parseTicketLink, planeGroupId, type PastedLink, PASTED_LINK_MAX_CHARS } from './model/pastedLink'
import { Fold } from '@/components/ui/fold'
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
export const KEY_ONCE = 'You do this once on this computer: the key is kept by the Maiker service (in its data folder, not the system keychain), used for every project, and never shown again.'

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

/** What a link must name for each source's setup, said when it names another. */
const LINK_KIND: Readonly<Record<Provider, PastedLink['kind']>> = { github: 'github', plane: 'plane', linear: 'linear' }
/** What the link is to, as each source calls it. */
const LINK_NOUN: Readonly<Record<Provider, string>> = { github: 'repository', plane: 'project', linear: 'team' }
const PASTE_EXAMPLE: Readonly<Record<Provider, string>> = {
  github: 'https://github.com/owner/name',
  plane: 'https://app.plane.so/workspace/projects/…',
  linear: 'https://linear.app/team-name/team/ENG',
}
const PASTE_HINT: Readonly<Record<Provider, string>> = {
  github: 'Any page of the repository works: its home, an issue, or the clone address.',
  plane: 'Any page of the Plane project works: copy it from the browser. It names the address, the workspace and the project.',
  linear: 'A link to the team, or to one of its issues.',
}

/** What a pasted link gives a source's setup, or why it gives nothing. */
function readFor(provider: Provider, text: string): { link: PastedLink } | { reason: string } {
  const read = parseTicketLink(text)
  if (!read.ok) return { reason: read.reason }
  if (read.link.kind !== LINK_KIND[provider]) return { reason: `That is a ${PROVIDER_LOOK[read.link.kind].name} link: paste it on the ${PROVIDER_LOOK[read.link.kind].name} tab.` }
  return { link: read.link }
}

/**
 * The first step of every source's setup: paste any link to the project, and the rest is filled from it. `suggested`
 * is a link to start the box with (the person still presses Use link); a link is only read, never opened.
 */
function PasteLink({ provider, suggested, onRead }: { provider: Provider; suggested: string; onRead: (link: PastedLink) => void }) {
  const [text, setText] = useState(suggested)
  const [note, setNote] = useState<string | null>(null)
  const name = PROVIDER_LOOK[provider].name
  const use = (typed: string) => {
    const read = readFor(provider, typed)
    if ('reason' in read) {
      setNote(read.reason)
      return
    }
    setNote(null)
    onRead(read.link)
  }
  return (
    <form className="mx-tk-setup-row" onSubmit={(event) => { event.preventDefault(); use(text) }}>
      <label className={`mx-tk-field${note === null ? '' : ' is-refused'}`}>
        <input aria-label={`Link to your ${name} ${LINK_NOUN[provider]}`} placeholder={PASTE_EXAMPLE[provider]} value={text} maxLength={PASTED_LINK_MAX_CHARS} spellCheck={false} autoComplete="off"
          onChange={(event) => { setText(event.target.value); setNote(null) }}
          onPaste={(event) => { const pasted = event.clipboardData.getData('text'); if (pasted !== '') { event.preventDefault(); setText(pasted.trim()); use(pasted) } }} />
      </label>
      <button type="submit" className="mx-tk-button is-primary" disabled={text.trim() === ''}>Use link</button>
      <span className="mx-tk-setup-hint">{PASTE_HINT[provider]}</span>
      {note !== null && <span className="mx-tk-setup-error" role="alert">{note}</span>}
    </form>
  )
}

/** The key form of a keyed provider, as the setup's first step. The key goes to the service and is never shown again. */
/** Filled from `pasted` when it is first drawn; the setup draws it afresh (by its key) for each new link. */
function ConnectKey({ provider, source, pasted }: { provider: KeyedProvider; source: 'plane' | 'linear'; pasted: PastedLink | null }) {
  const client = useQueryClient()
  const plane = provider === 'Plane'
  const fromLink = pasted?.kind === 'plane' ? pasted : null
  const [address, setAddress] = useState(fromLink?.address ?? PLANE_CLOUD)
  const [workspace, setWorkspace] = useState(fromLink?.workspace ?? '')
  const [details, setDetails] = useState(false)
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
  const where = plane ? 'An API key from Plane › Profile › API tokens.' : 'An API key from Linear › Settings › Security & access.'
  // The address and workspace come from the pasted link; typing them is there for a Plane whose links are not to hand.
  const showDetails = plane && (details || fromLink === null || !addressOk)
  return (
    <form className="mx-tk-setup-form" onSubmit={(event) => { event.preventDefault(); connect() }}>
      <span className="mx-tk-setup-hint">{where}</span>
      {plane && fromLink !== null && <span className="mx-tk-setup-hint">For <b>{workspace}</b> at {address}.</span>}
      {plane && fromLink !== null && <Fold open={details} onToggle={() => { setDetails(!details) }} more="Enter the details instead" less="Hide the details" />}
      {showDetails && (
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

/**
 * The group a pasted link names among the provider's own: a Plane project by its id; a Linear team by its name when it
 * reads the same as the link's team key (the daemon's team list has no keys, so a team named otherwise is picked by hand).
 */
function matchOf(groups: readonly { id: string; name: string }[], pasted: PastedLink | null): { id: string; name: string } | undefined {
  if (pasted?.kind === 'plane' && pasted.project !== null) {
    const id = planeGroupId(pasted.project)
    return groups.find((group) => group.id.toLowerCase() === id)
  }
  if (pasted?.kind === 'linear') return groups.find((group) => group.name.trim().toUpperCase() === pasted.teamKey)
  return undefined
}

/** Step two of a keyed provider: pick the project or team this project reads, from the provider's own list. */
function PickGroup({ source, project, link, pasted }: { source: 'plane' | 'linear'; project: SetupProject; link: ProjectLink; pasted: PastedLink | null }) {
  const groups = useTicketGroups(source)
  const { save } = useLinkChanges()
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const word = GROUP_WORD[source]
  const top = (groups.data ?? []).filter((group) => group.parent === null)
  const match = matchOf(top, pasted)
  const wanted = pasted !== null && (pasted.kind === 'plane' ? pasted.project !== null : pasted.kind === 'linear')
  const pick = (id: string, name: string) => {
    setBusy(true)
    save(project.place, { ...link, [source]: { id, name } }).then((told) => {
      setNote(told.ok ? null : told.failure.kind === 'invalid' || told.failure.kind === 'unreachable' ? told.failure.line : 'Could not save the link')
    }, (error: unknown) => { setNote(errorMessage(error, 'Could not save the link')) }).finally(() => { setBusy(false) })
  }
  if (groups.isPending) return <SkeletonLines label={`Reading your ${PROVIDER_LOOK[source].name} ${word}s`} lines={4} />
  if (groups.isError) return <span className="mx-tk-setup-error" role="alert">Could not read your {word}s: {errorMessage(groups.error, 'the service did not answer')}</span>
  if (top.length === 0) return <span className="mx-tk-setup-hint">This key sees no {word}s.</span>
  return (
    <>
      {match !== undefined && (
        <div className="mx-tk-setup-row">
          <button type="button" className="mx-tk-button is-primary" disabled={busy} onClick={() => { pick(match.id, match.name) }}>Link {match.name}</button>
          <span className="mx-tk-setup-hint">The {word} your link names.</span>
        </div>
      )}
      {match === undefined && wanted && <span className="mx-tk-setup-hint" role="status">No {word} this key sees matches the link. Pick it below.</span>}
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

/** GitHub when the folder names no repository (or GitHub was turned off): paste a link to it or type it, or leave it off. */
function GitHubSetup({ project, link, off, suggested }: { project: SetupProject; link: ProjectLink; off: boolean; suggested: string }) {
  const { save } = useLinkChanges()
  const [repo, setRepo] = useState('')
  const [details, setDetails] = useState(false)
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
        <span className="mx-tk-setup-hint">There is no key to paste: Maiker reads issues with the GitHub command line's own sign-in.</span>
      </Step>
      <Step n={2} title={off ? `GitHub is off for ${project.name}` : `Paste a link to ${project.name}'s repository`} done={false}>
        <span className="mx-tk-setup-hint">{off ? 'Turn it back on to read the issues of the repository the folder pushes to, or paste a link to another.' : 'The folder has no GitHub origin.'}</span>
        <PasteLink provider="github" suggested={suggested} onRead={(pasted) => { if (pasted.kind === 'github') keep(pasted.repo) }} />
        {off && <div className="mx-tk-setup-row"><button type="button" className="mx-tk-button" onClick={() => { keep(null) }}>Use the folder's origin</button></div>}
        <Fold open={details} onToggle={() => { setDetails(!details) }} more="Enter the details instead" less="Hide the details" />
        {details && (
          <form className="mx-tk-setup-row" onSubmit={(event) => { event.preventDefault(); if (ok) keep(repo.trim()) }}>
            <label className={`mx-tk-field${repo === '' || ok ? '' : ' is-refused'}`}>
              <input aria-label={`GitHub repo for ${project.name}`} placeholder="owner/name" value={repo} maxLength={140} spellCheck={false} autoComplete="off" onChange={(event) => { setRepo(event.target.value) }} />
            </label>
            <button type="submit" className="mx-tk-button is-primary" disabled={!ok}>Use this repo</button>
          </form>
        )}
        <span className="mx-tk-setup-hint">{savedFor(project.name)}</span>
        {note !== null && <span className="mx-tk-setup-error" role="alert">{note}</span>}
      </Step>
    </ol>
  )
}

/** The props of `TicketSetup`. */
export type TicketSetupProps = {
  provider: Provider
  project: SetupProject
  link: ProjectLink
  keys: readonly TicketKeyState[] | undefined
  /**
   * A link to start the paste box with, such as one an agent suggested (feat/tk-agent opens the setup with it). It only
   * fills the box: nothing is read or saved until the person presses Use link. Any text is taken; it is checked then.
   */
  suggestedLink?: string | undefined
}

/**
 * Setting up one source for the project in front, in place of its tickets. Every source starts from a pasted link to
 * the project: GitHub then needs nothing more; Plane and Linear need a key once (for every project), and the link
 * picks the project or team this project reads (for it and its worktrees). Each step says which of the two it is.
 */
export function TicketSetup({ provider, project, link, keys, suggestedLink = '' }: TicketSetupProps) {
  const [pasted, setPasted] = useState<PastedLink | null>(null)
  if (provider === 'github') return <GitHubSetup project={project} link={link} off={link.github === ''} suggested={suggestedLink} />
  const keyed: KeyedProvider = provider === 'plane' ? 'Plane' : 'Linear'
  const name = PROVIDER_LOOK[provider].name
  const saved = keys?.find((key) => key.provider === keyed)
  const connected = saved?.set ?? false
  const word = GROUP_WORD[provider]
  // A Plane key is for one Plane and workspace: a link to another cannot be read with it.
  const elsewhere = connected && saved !== undefined && pasted?.kind === 'plane' && (pasted.address.replace(/\/+$/, '') !== saved.address.replace(/\/+$/, '') || pasted.workspace !== saved.workspace)
  return (
    <ol className="mx-tk-setup" aria-label={`Set up ${name}`}>
      <Step n={1} title={`Paste a link to your ${name} ${word}`} done={pasted !== null}>
        <PasteLink provider={provider} suggested={suggestedLink} onRead={setPasted} />
      </Step>
      <Step n={2} title={connected ? `${name} is connected on this computer` : `Connect ${name}`} done={connected}>
        {connected ? <span className="mx-tk-setup-hint">For every project. Replace or remove the key in Settings › Tickets › Accounts.</span> : <ConnectKey key={pasted?.kind === 'plane' ? `${pasted.address} ${pasted.workspace}` : ''} provider={keyed} source={provider} pasted={pasted} />}
        {elsewhere && <span className="mx-tk-setup-error" role="alert">The link is for {pasted.workspace} at {pasted.address}, but the saved key is for {saved.workspace} at {saved.address}. Replace the key in Settings › Tickets › Accounts to read it.</span>}
      </Step>
      <Step n={3} title={`Pick the ${name} ${word} for ${project.name}`} done={false}>
        {connected ? <PickGroup source={provider} project={project} link={link} pasted={elsewhere ? null : pasted} /> : <span className="mx-tk-setup-hint">After connecting, the {word} your link names is linked here.</span>}
      </Step>
    </ol>
  )
}
