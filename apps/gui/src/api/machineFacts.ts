import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'
import { LOCAL_MACHINE } from './machines'
import { taggedAnswers } from './taggedAnswers'

const FactsSchema = z.object({
  /** The name the computer gives itself, when it has one. */
  host_name: z.string().nullable(),
  /** `windows`, `macos` or `linux`. */
  os: z.string(),
  /** The system's own words for its version ("Windows 11 Home 24H2"), when it gives one. */
  os_version: z.string().nullable(),
  /** `x86_64` or `aarch64`. */
  arch: z.string(),
  cpu_cores: z.number().int().nonnegative(),
  /** The agent programs found on its PATH; the version is null when the program printed none. */
  agents: z.array(z.object({ name: z.string(), version: z.string().nullable() })),
})
const AnswerSchema = z.object({ machine: z.number().int(), tag: z.number().int(), answer: FactsSchema })

/** What a machine says it is. Nothing secret: no paths, no environment, no logins. */
export type MachineFacts = z.infer<typeof FactsSchema>

/** How long a machine has to answer: its daemon gives each agent program five seconds, side by side, and the answer has to cross. */
export const MACHINE_FACTS_ANSWER_MS = 40_000

const ask = taggedAnswers('machine-facts', AnswerSchema)

/**
 * What a machine is (this computer is machine 0), asked of that machine's own daemon: its system, cores, the name it
 * gives itself and the agents installed there. Rejects when the machine could not be asked or did not answer, which is
 * also what a service older than protocol 119 does.
 */
export async function loadMachineFacts(machine: number): Promise<MachineFacts> {
  const send = (tag: number) => invoke('machine_facts', machine === LOCAL_MACHINE ? { tag } : { machine, tag })
  return (await ask(send, MACHINE_FACTS_ANSWER_MS, 'The machine did not answer in time')).answer
}
