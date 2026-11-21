import type { Added } from '@/api/machines'
import { machineHeads, type RemoteMachine } from '@/features/workspace/model/machines'

const MINUTE_MS = 60_000
const DOWN_FOR = { minutes: 14 }
const ANSWER_MS = 900

type State = RemoteMachine['state']

const COUNT = { few: 2, some: 4, many: 5 }

type Entry = readonly [name: string, state: State['state'], target: string, sessions: number, extra?: Partial<State>]

const ENTRIES: readonly Entry[] = [
  ['gpu-box', 'unreachable', 'cydo@10.0.4.12', 0, { why: "Can't reach gpu-box: check the name or address, and that the machine is on (ssh: connect to host 10.0.4.12 port 22: Connection timed out).", failure: 'unreachable' }],
  ['studio-pc', 'needs-login', 'cydo@studio-pc', 0, { said: 'cydo@studio-pc: Permission denied (publickey).', why: 'studio-pc refused your key: run `ssh-copy-id cydo@studio-pc` in a terminal, then try again.', failure: 'key-refused', fix_command: 'ssh-copy-id cydo@studio-pc' }],
  ['devbox', 'needs-update', 'cydo@10.0.4.7', COUNT.few, { why: 'devbox runs an older Maiker: run `maiker machine update devbox`, then try again.', failure: 'update', fix_command: 'maiker machine update devbox' }],
  ['ec2-eu-west', 'needs-update', 'ubuntu@3.249.18.40', COUNT.few, { why: 'ec2-eu-west runs an older Maiker: run `maiker machine update ec2-eu-west`, then try again.', failure: 'update', fix_command: 'maiker machine update ec2-eu-west' }],
  ['lab-a100', 'connected', 'cydo@lab-a100.uni.edu', COUNT.many],
  ['build-01', 'connected', 'ci@build-01.lan', COUNT.some],
  ['staging', 'connected', 'deploy@staging.acme.dev', 1],
]

/** Machines in every state of the Remote machines list, for looking at it in the gallery (`#dialogs/settings-machines`). */
export const SAMPLE_HEADS = machineHeads(new Map(ENTRIES.map(([name, state, target, , extra], index): [number, RemoteMachine] => {
  const machine = index + 1
  return [machine, { state: { machine, name, state, why: null, attempt: null, since: Date.now() - DOWN_FOR.minutes * MINUTE_MS, target, ...extra }, conversations: [], heard: true, listedAt: 0 }]
}))).filter((head) => head.name !== null)

export const sampleSessions = (machine: number): number => ENTRIES.find(([name]) => name === SAMPLE_HEADS.find((head) => head.machine === machine)?.name)?.[3] ?? 0

export const SAMPLE_HOSTS = [
  { alias: 'linkables-vps', detail: 'ubuntu@40.160.103.45', added: false },
  { alias: 'pi', detail: 'cydo@192.168.1.242', added: false },
  { alias: 'server-15', detail: 'dev@100.78.214.15', added: false },
  { alias: 'homelab', detail: 'root@192.168.1.20', added: false },
]

const added = (name: string, reach: Extract<Added, { outcome: 'added' }>['reach'], version: string | null = null, installed = false): Added => ({ outcome: 'added', name, version, reach, took_ms: 18, reach_ms: 38, key: 'id_ed25519', helper_install: installed ? { installed, said: 'Installed' } : null })

/** Each host answers its own way, as in the handoff's mock; any other address connects, and 10.9.9.9 does not answer. */
export function sampleAdd(target: string, name?: string): Promise<Added> {
  const pause = (result: Added) => new Promise<Added>((resolve) => { window.setTimeout(() => { resolve(result) }, ANSWER_MS) })
  if (target === 'homelab') return pause(added('homelab', 'missing', '0.46.0', true))
  if (target === 'pi') return pause(added('pi', 'older', '0.45.2'))
  if (target === 'linkables-vps') return pause(added('linkables-vps', 'answered', '0.46.0'))
  if (target.includes('10.9.9.9')) return new Promise((_, reject) => { window.setTimeout(() => { reject(new Error('ssh: connect to host 10.9.9.9 port 22: Connection timed out')) }, ANSWER_MS) })
  return pause(added(name ?? target, 'answered', '0.46.0'))
}

const PROGRESS_DIVISOR = 3
/** The helper install of the sample hosts, climbing as the host would report it. */
export function sampleProgress(listener: (progress: { name: string; percent: number }) => void): Promise<() => void> {
  const timer = window.setTimeout(() => { listener({ name: 'homelab', percent: 60 }) }, ANSWER_MS / PROGRESS_DIVISOR)
  return Promise.resolve(() => { window.clearTimeout(timer) })
}
