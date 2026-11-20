import { describe, expect, it } from 'vitest'
import { checkAddress, suggestedName, withPort } from './addressCheck'

const message = (typed: string) => {
  const result = checkAddress(typed)
  return result.ok ? null : result.message
}

describe('a typed address', () => {
  it('reads user, host and port', () => {
    expect(checkAddress('cydo@10.0.4.50:2222')).toEqual({ ok: true, user: 'cydo', host: '10.0.4.50', port: 2222 })
    expect(checkAddress('my-server.com')).toEqual({ ok: true, user: '', host: 'my-server.com', port: null })
  })

  it('says an address cannot have spaces', () => {
    expect(message('you @host')).toBe("An address can't have spaces. It looks like you@192.168.1.20.")
  })

  it('says what an address looks like when it does not parse', () => {
    const words = "That doesn't look like an address. It looks like you@192.168.1.20 or you@my-server.com."
    for (const typed of ['', '@host', 'user@', '-oProxy@host', 'host:', 'a/b']) expect(message(typed)).toBe(words)
  })

  it('says an IP address with fewer than four numbers is incomplete', () => {
    const words = 'That IP address is incomplete. It needs four numbers, like 10.0.4.12.'
    for (const typed of ['cydo@10.0.4', '10.0.4.', '10.0']) expect(message(typed)).toBe(words)
  })

  it('says an IP address with more than four numbers has too many', () => {
    expect(message('10.0.4.12.1')).toBe('That IP address has too many numbers. It needs four, like 10.0.4.12.')
  })

  it('reads a pasted user@ip, a bare IP and a config name, with the whitespace and newline around them dropped', () => {
    expect(checkAddress('dev@100.78.214.15')).toEqual({ ok: true, user: 'dev', host: '100.78.214.15', port: null })
    expect(checkAddress('  100.78.214.15\n')).toEqual({ ok: true, user: '', host: '100.78.214.15', port: null })
    expect(checkAddress('build\r\n')).toEqual({ ok: true, user: '', host: 'build', port: null })
  })

  it('says each number of an IP address goes up to 255', () => {
    expect(message('10.0.256.1')).toBe('Each number in an IP address goes up to 255.')
  })

  it('keeps ports to 1 to 65535', () => {
    expect(message('host:0')).toBe('Ports go from 1 to 65535.')
    expect(message('host:65536')).toBe('Ports go from 1 to 65535.')
    expect(checkAddress('host:65535')).toMatchObject({ ok: true, port: 65535 })
  })
})

describe('the Port box', () => {
  const ok = checkAddress('me@box.example')

  it('adds its number to the address', () => {
    expect(withPort(ok, '2222')).toMatchObject({ ok: true, port: 2222 })
    expect(withPort(ok, '  ')).toBe(ok)
  })

  it('keeps ports to 1 to 65535', () => {
    expect(withPort(ok, '70000')).toEqual({ ok: false, message: 'Ports go from 1 to 65535.' })
    expect(withPort(ok, 'abc')).toEqual({ ok: false, message: 'Ports go from 1 to 65535.' })
  })

  it('refuses a port given twice instead of picking one', () => {
    expect(withPort(checkAddress('me@box.example:22'), '2222')).toMatchObject({ ok: false })
  })

  it('leaves a problem with the address as it was', () => {
    const bad = checkAddress('10.0.4')
    expect(withPort(bad, '22')).toBe(bad)
  })
})

describe('a suggested name', () => {
  it('is the ssh alias for a host of the config', () => {
    expect(suggestedName({ alias: 'homelab' }, [])).toBe('homelab')
  })

  it('is server and the last number for a bare IP', () => {
    expect(suggestedName({ host: '10.0.4.50' }, [])).toBe('server-50')
  })

  it('is the first label of a host name', () => {
    expect(suggestedName({ host: 'my-server.com' }, [])).toBe('my-server')
  })

  it('takes the next free number when the name is used', () => {
    expect(suggestedName({ host: 'my-server.com' }, ['my-server', 'my-server-2'])).toBe('my-server-3')
  })
})
