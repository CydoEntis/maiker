import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'
import { LOCAL_MACHINE } from './machines'
import { taggedAnswers } from './taggedAnswers'

const CommandsSchema = z.array(z.object({ name: z.string(), description: z.string(), hint: z.string(), aliases: z.array(z.string()) }))
export type AgentCommandList = z.infer<typeof CommandsSchema>

const AnswerSchema = z.object({
  machine: z.number().int(),
  tag: z.number().int(),
  answer: z.union([z.object({ Ok: CommandsSchema }), z.object({ Err: z.string() })]),
})

/**
 * How long a machine has to list. Its daemon gives the agent twenty seconds to answer, and the host
 * waits for that and the time the answer takes to cross.
 */
export const AGENT_COMMANDS_ANSWER_MS = 50_000

const NOT_ANSWERED = 'The machine did not list its commands in time'
const ask = taggedAnswers('agent-commands', AnswerSchema)

/**
 * The slash commands an agent takes in a folder on a machine (this computer is machine 0): its own, and the
 * person's and the project's; empty for an agent with no list to ask for. Another machine's daemon answers for
 * its own agent, folder and account, and a machine that cannot be reached rejects with why, so nothing
 * here is ever this computer's list under another machine's name.
 */
export async function loadAgentCommands(agent: string, folder: string, machine: number = LOCAL_MACHINE): Promise<AgentCommandList> {
  if (machine === LOCAL_MACHINE) return CommandsSchema.parse(await invoke('agent_commands', { agent, folder }))
  const answered = await ask((tag) => invoke('agent_commands_on', { machine, agent, folder, tag }), AGENT_COMMANDS_ANSWER_MS, NOT_ANSWERED)
  if ('Err' in answered.answer) throw new Error(answered.answer.Err)
  return answered.answer.Ok
}
