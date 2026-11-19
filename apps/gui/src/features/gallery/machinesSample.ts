import type { Added, HostKeyReport } from '@/api/machines'
import { machineHeads, type RemoteMachine } from '@/features/workspace/model/machines'

const MINUTE_MS = 60_000
const DOWN_FOR = { minutes: 14 }
const ANSWER_MS = 900

type State = RemoteMachine['state']

const COUNT = { few: 2, some: 4, many: 5 }

type Entry = readonly [name: string, state: State['state'], target: string, sessions: number, extra?: Partial<State>]

const ENTRIES: readonly Entry[] = [
  ['gpu-box', 'unreachable', 'cydo@10.0.4.12', 0, { why: 'No answer from 10.0.4.12.' }],
  ['studio-pc', 'needs-login', 'cydo@studio-pc', 0, { said: 'cydo@studio-pc: Permission denied (publickey).' }],
  ['devbox', 'needs-update', 'cydo@10.0.4.7', COUNT.few, { why: 'run `maiker machine update devbox`, then retry' }],
  ['ec2-eu-west', 'needs-update', 'ubuntu@3.249.18.40', COUNT.few, { why: 'run `maiker machine update ec2-eu-west`, then retry' }],
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
  { alias: 'homelab', detail: 'cydo@192.168.1.20' },
  { alias: 'nas', detail: 'admin@nas.lan' },
  { alias: 'work-vm', detail: 'cydo@work-vm.corp' },
  { alias: 'media-pc', detail: 'cydo@media-pc.lan' },
]

const added = (name: string, reach: Extract<Added, { outcome: 'added' }>['reach'], version: string | null = null): Added => ({ outcome: 'added', name, version, reach, took_ms: 18 })

/** Each host answers its own way, as in the handoff's mock; any other address asks to be trusted, and 10.9.9.9 does not answer. */
export function sampleAdd(target: string, name?: string): Promise<Added> {
  const pause = (result: Added) => new Promise<Added>((resolve) => { window.setTimeout(() => { resolve(result) }, ANSWER_MS) })
  if (target === 'homelab') return pause(added('homelab', 'missing'))
  if (target === 'nas') return pause(added('nas', 'answered', '0.46.0'))
  if (target === 'media-pc') return pause(added('media-pc', 'older', '0.45.2'))
  if (target === 'work-vm') return pause({ outcome: 'login', name: 'work-vm', target: 'cydo@work-vm.corp', said: 'cydo@work-vm.corp: Permission denied (publickey).', command: null })
  if (target.includes('10.9.9.9')) return new Promise((_, reject) => { window.setTimeout(() => { reject(new Error('ssh: connect to host 10.9.9.9 port 22: Connection timed out')) }, ANSWER_MS) })
  return pause({ outcome: 'login', name: name ?? target, target, said: 'Host key verification failed.', command: null })
}

export const sampleHostKey = (): Promise<HostKeyReport> => Promise.resolve({ status: 'unknown', host: '10.0.4.50', port: 22, key_type: 'ssh-ed25519', fingerprint: 'SHA256:q3Vt9kQ0x1yZ8Rk4fN0b2c7mW5sPpL1aEo6hT3uJdGc' })
