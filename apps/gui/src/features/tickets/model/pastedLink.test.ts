import { describe, expect, it } from 'vitest'
import { parseTicketLink, PASTED_LINK_MAX_CHARS } from './pastedLink'

const ID = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const plane = (address: string, workspace: string, project: string | null) => ({ ok: true, link: { kind: 'plane', address, workspace, project } })

describe('parseTicketLink', () => {
  it('reads a self-hosted Plane project link for its address, workspace and project', () => {
    expect(parseTicketLink(`http://192.168.1.244/ideayard/projects/${ID}/issues/`)).toEqual(plane('http://192.168.1.244', 'ideayard', ID))
  })

  it('keeps Plane Cloud, a port and a path prefix in the address', () => {
    expect(parseTicketLink(`https://app.plane.so/acme/projects/${ID}/cycles?x=1`)).toEqual(plane('https://app.plane.so', 'acme', ID))
    expect(parseTicketLink(`https://pm.example.com:8443/plane/acme/projects/${ID}`)).toEqual(plane('https://pm.example.com:8443/plane', 'acme', ID))
  })

  it('reads a Plane link with no project for its workspace', () => {
    expect(parseTicketLink('https://app.plane.so/acme/')).toEqual(plane('https://app.plane.so', 'acme', null))
    expect(parseTicketLink('  http://192.168.1.244/ideayard  ')).toEqual(plane('http://192.168.1.244', 'ideayard', null))
  })

  it('reads a Linear team or issue link for the team key', () => {
    expect(parseTicketLink('https://linear.app/acme/team/ENG/active')).toEqual({ ok: true, link: { kind: 'linear', teamKey: 'ENG' } })
    expect(parseTicketLink('https://linear.app/acme/issue/eng-123/fix-login')).toEqual({ ok: true, link: { kind: 'linear', teamKey: 'ENG' } })
    expect(parseTicketLink('https://linear.app/acme/settings').ok).toBe(false)
  })

  it('reads GitHub https and ssh links for owner/name', () => {
    const repo = { ok: true, link: { kind: 'github', repo: 'CydoEntis/maiker' } }
    expect(parseTicketLink('https://github.com/CydoEntis/maiker/issues/12')).toEqual(repo)
    expect(parseTicketLink('https://github.com/CydoEntis/maiker.git')).toEqual(repo)
    expect(parseTicketLink('git@github.com:CydoEntis/maiker.git')).toEqual(repo)
    expect(parseTicketLink('https://github.com/CydoEntis').ok).toBe(false)
  })

  it('refuses anything else with a reason', () => {
    for (const text of ['', 'maiker', 'ftp://x/y', 'https://', 'https://user:pw@host/ws', 'https://host/ws/projects/not-an-id', 'https://host/projects', 'https://host/w%20s', 'http://x/\u0007', `https://h/${'a'.repeat(PASTED_LINK_MAX_CHARS)}`]) {
      const read = parseTicketLink(text)
      expect(read.ok, text).toBe(false)
      if (!read.ok) expect(read.reason).not.toBe('')
    }
  })
})
