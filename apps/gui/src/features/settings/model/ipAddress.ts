const MAX_OCTET = 255
const IP_TEXT = /^\d{1,3}(?:\.\d{1,3}){3}$/

/** The four numbers of `text` when it is a whole IPv4 address, else null. */
export function octetsOf(text: string): string[] | null {
  const trimmed = text.trim()
  return IP_TEXT.test(trimmed) ? trimmed.split('.') : null
}

/** The address these four boxes make, or '' until each holds a number from 0 to 255. */
export function addressOfOctets(octets: readonly string[]): string {
  return octets.every((part) => part !== '' && Number(part) <= MAX_OCTET) ? octets.join('.') : ''
}
