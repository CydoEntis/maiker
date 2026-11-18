import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'
import { taggedAnswers } from './taggedAnswers'

/**
 * Skills, plugins, MCP servers and marketplaces of Claude Code and Codex, through this computer's daemon
 * (`Query::Extensions`). A list reads files and starts nothing. A plugin or an MCP server runs code with the person's
 * access, so an add is two calls: `previewAdd` shows what would run and returns a one-time token, and `confirmAdd`
 * runs only the add that token was given for. `confirmAdd` is called from the confirm button of the add dialog and
 * nowhere else. Every string was cleaned and cut by the daemon; it is still other people's text, so the window shows it
 * as text and never as markup.
 */

const AgentSchema = z.enum(['Claude', 'Codex'])
const ScopeSchema = z.enum(['User', 'Project', 'Local'])
const KindSchema = z.enum(['Plugin', 'McpServer', 'Skill', 'Marketplace'])

export type ExtAgent = z.infer<typeof AgentSchema>
export type ExtScope = z.infer<typeof ScopeSchema>
export type ExtKind = z.infer<typeof KindSchema>

const ItemSchema = z.object({
  agent: AgentSchema,
  kind: KindSchema,
  scope: ScopeSchema,
  id: z.string(),
  name: z.string(),
  detail: z.string(),
  enabled: z.boolean().nullable(),
})

const PreviewSchema = z.object({
  token: z.string(),
  agent: AgentSchema,
  kind: KindSchema,
  name: z.string(),
  scope: ScopeSchema,
  source: z.string(),
  runs: z.array(z.string()),
  hosts: z.array(z.string()),
})

const ReplySchema = z.union([
  z.object({ List: z.object({ items: z.array(ItemSchema), problems: z.array(z.string()).default([]) }) }),
  z.object({ Preview: PreviewSchema }),
  z.object({ Done: z.string() }),
])

const ErrorSchema = z.union([
  z.enum(['NotFound', 'AlreadyInstalled', 'NeedsConfirmation']),
  z.object({ CliMissing: AgentSchema }),
  z.object({ CliTooOld: AgentSchema }),
  z.object({ NeedsTerminal: z.string() }),
  z.object({ Invalid: z.string() }),
  z.object({ Failed: z.string() }),
])

const AnswerSchema = z.object({
  machine: z.number().int(),
  tag: z.number().int(),
  answer: z.union([z.object({ Ok: ReplySchema }), z.object({ Err: ErrorSchema })]),
})

export type Extension = z.infer<typeof ItemSchema>
export type AddPreview = z.infer<typeof PreviewSchema>
export type ExtensionList = { items: Extension[]; problems: string[] }

/** The one thing a change is aimed at: an item the daemon listed. */
export type ExtTarget = { agent: ExtAgent; kind: ExtKind; id: string; scope: ExtScope; project: string | null }

export type McpRun = { Command: { command: string; args: string[] } } | { Url: { url: string } }

/** Something to add. A plugin is `name@marketplace`, from a marketplace that is already added. */
export type ExtAdd =
  | { Plugin: { agent: ExtAgent; plugin: string; scope: ExtScope; project: string | null } }
  | { Marketplace: { agent: ExtAgent; source: string } }
  | { Mcp: { agent: ExtAgent; name: string; run: McpRun; scope: ExtScope; project: string | null } }

type Request =
  | { List: { project: string | null } }
  | { PreviewAdd: { add: ExtAdd } }
  | { Add: { token: string } }
  | { SetEnabled: { target: ExtTarget; enabled: boolean } }
  | { Remove: { target: ExtTarget } }

/** Why a request changed nothing, in the words the window shows. `terminal` is set when only the agent's terminal can do it. */
export type ExtensionFailure = { line: string; terminal: string | null }

export type ExtensionResult<T> = { ok: true; value: T } | { ok: false; failure: ExtensionFailure }

const AGENT_NAME: Record<ExtAgent, string> = { Claude: 'Claude Code', Codex: 'Codex' }

/** The words for an error. Nothing the agent said is repeated except the one cleaned line the daemon kept. */
export function failureOf(error: z.infer<typeof ErrorSchema>): ExtensionFailure {
  if (error === 'NotFound') return { line: 'That is not there any more. Refresh the list and try again.', terminal: null }
  if (error === 'AlreadyInstalled') return { line: 'That is already installed.', terminal: null }
  if (error === 'NeedsConfirmation') return { line: 'That add was not confirmed, or its confirmation ran out. Start it again.', terminal: null }
  if ('CliMissing' in error) return { line: `${AGENT_NAME[error.CliMissing]} is not installed on this computer, so it cannot be changed here.`, terminal: null }
  if ('CliTooOld' in error) return { line: `This version of ${AGENT_NAME[error.CliTooOld]} does not have that command. Update ${AGENT_NAME[error.CliTooOld]} and try again.`, terminal: null }
  if ('NeedsTerminal' in error) return { line: 'This one needs a terminal. Run this command in a terminal:', terminal: error.NeedsTerminal }
  if ('Invalid' in error) return { line: error.Invalid, terminal: null }
  return { line: error.Failed === '' ? 'The agent said no.' : error.Failed, terminal: null }
}

/** A command can take a minute in the daemon; the host waits that long and a little more. */
const ANSWER_MS = 95_000
const NOT_ANSWERED = 'The Maiker service did not answer in time'

const ask = taggedAnswers('extensions', AnswerSchema)

async function send(request: Request): Promise<ExtensionResult<z.infer<typeof ReplySchema>>> {
  const told = await ask((tag) => invoke('extensions', { request, tag }), ANSWER_MS, NOT_ANSWERED)
  return 'Ok' in told.answer ? { ok: true, value: told.answer.Ok } : { ok: false, failure: failureOf(told.answer.Err) }
}

const unexpected = { ok: false, failure: { line: 'The service gave an answer to another question', terminal: null } } as const

/** What is installed for the user, and for `project` (a folder on this computer) when one is given. Starts no agent. */
export async function loadExtensions(project: string | null): Promise<ExtensionResult<ExtensionList>> {
  const told = await send({ List: { project } })
  if (!told.ok) return told
  return 'List' in told.value ? { ok: true, value: told.value.List } : unexpected
}

/** What an add would run, read from files; nothing is installed. The token it carries is what `confirmAdd` needs. */
export async function previewAdd(add: ExtAdd): Promise<ExtensionResult<AddPreview>> {
  const told = await send({ PreviewAdd: { add } })
  if (!told.ok) return told
  return 'Preview' in told.value ? { ok: true, value: told.value.Preview } : unexpected
}

/**
 * Runs the add a preview was shown for, once the person clicked its confirm button. Sent once, never retried: a
 * request that was not answered in time may or may not have happened.
 */
export async function confirmAdd(token: string): Promise<ExtensionResult<string>> {
  const told = await send({ Add: { token } })
  if (!told.ok) return told
  return 'Done' in told.value ? { ok: true, value: told.value.Done } : unexpected
}

/** Turns a plugin on or off. */
export async function setPluginEnabled(target: ExtTarget, enabled: boolean): Promise<ExtensionResult<string>> {
  const told = await send({ SetEnabled: { target, enabled } })
  if (!told.ok) return told
  return 'Done' in told.value ? { ok: true, value: told.value.Done } : unexpected
}

/** Removes something the list showed. A skill's folder is deleted; the rest go through the agent's own command. */
export async function removeExtension(target: ExtTarget): Promise<ExtensionResult<string>> {
  const told = await send({ Remove: { target } })
  if (!told.ok) return told
  return 'Done' in told.value ? { ok: true, value: told.value.Done } : unexpected
}

export const AGENT_LABELS = AGENT_NAME

/** Splits a typed command line into the program and its arguments, as a person means it: spaces separate, quotes group. */
export function splitCommandLine(text: string): { command: string; args: string[] } | null {
  const words: string[] = []
  let word = ''
  let quote: string | null = null
  let started = false
  for (const char of text.trim()) {
    if (quote !== null) {
      if (char === quote) quote = null
      else word += char
    } else if (char === '"' || char === "'") {
      quote = char
      started = true
    } else if (/\s/u.test(char)) {
      if (started || word !== '') words.push(word)
      word = ''
      started = false
    } else {
      word += char
    }
  }
  if (quote !== null) return null
  if (started || word !== '') words.push(word)
  const [command, ...args] = words
  return command === undefined || command === '' ? null : { command, args }
}
