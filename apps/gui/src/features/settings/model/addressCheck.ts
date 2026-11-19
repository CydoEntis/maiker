import { hostProblem, portOf, userProblem } from './machineTarget'

/** What a typed address came to: its parts, or the words that tell the person what to fix. */
export type Address =
  | { readonly ok: true; readonly user: string; readonly host: string; readonly port: number | null }
  | { readonly ok: false; readonly message: string }

const NOT_AN_ADDRESS = "That doesn't look like an address. It looks like you@192.168.1.20 or you@my-server.com."
const OCTETS = 4
const MOST_OCTET = 255

const refuse = (message: string): Address => ({ ok: false, message })

/** A host that is only digits and dots is meant as an IPv4 address, so it is held to one. */
function ipv4Problem(host: string): string | null {
  if (!/^[\d.]+$/.test(host) || !host.includes('.')) return null
  const parts = host.split('.')
  if (parts.length !== OCTETS || parts.some((part) => part === '')) return `An IP address has 4 numbers separated by dots, like 192.168.1.20. This one has ${String(parts.filter((part) => part !== '').length)}.`
  const big = parts.find((part) => Number(part) > MOST_OCTET)
  return big === undefined ? null : `Each number in an IP address goes up to 255, and ${big} is too big.`
}

/** Reads `[user@]host[:port]` as typed, with the messages the Add machine screen gives for each way it can be wrong. */
export function checkAddress(typed: string): Address {
  const text = typed.trim()
  if (/\s/.test(text)) return refuse("An address can't have spaces in it. It looks like you@192.168.1.20.")
  if (text === '') return refuse(NOT_AN_ADDRESS)
  const at = text.lastIndexOf('@')
  const user = at < 0 ? '' : text.slice(0, at)
  const rest = at < 0 ? text : text.slice(at + 1)
  const colon = rest.indexOf(':')
  const single = colon >= 0 && colon === rest.lastIndexOf(':')
  const host = single ? rest.slice(0, colon) : rest
  const portText = single ? rest.slice(colon + 1) : ''
  if (host === '' || (at >= 0 && user === '') || userProblem(user) !== null || hostProblem(host) !== null) return refuse(NOT_AN_ADDRESS)
  const ip = ipv4Problem(host)
  if (ip !== null) return refuse(ip)
  const port = single ? portOf(portText) : null
  if (port === undefined) return refuse('Ports go from 1 to 65535.')
  if (single && port === null) return refuse(NOT_AN_ADDRESS)
  return { ok: true, user, host, port }
}

/** What to call a machine: its ssh alias, `server-<last number>` for a bare IP, else the host's first label; `-2`, `-3`… when taken. */
export function suggestedName(source: { readonly alias: string } | { readonly host: string }, taken: readonly string[]): string {
  const base = 'alias' in source ? source.alias : nameOfHost(source.host)
  if (!taken.includes(base)) return base
  let number = 2
  while (taken.includes(`${base}-${String(number)}`)) number += 1
  return `${base}-${String(number)}`
}

function nameOfHost(host: string): string {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return `server-${host.slice(host.lastIndexOf('.') + 1)}`
  return host.split('.')[0] ?? host
}
