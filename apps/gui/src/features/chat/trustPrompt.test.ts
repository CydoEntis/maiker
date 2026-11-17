import { describe, expect, it } from 'vitest'
import { parseScreenMenu } from './screenMenu'
import { parseTrustPrompt } from './trustPrompt'

const ESC = String.fromCharCode(27)
const ENTER = String.fromCharCode(13)

// Claude's text is the shape the daemon's `asking` gives for its trust menu (crates/maitty-core/src/prompt.rs test);
// Codex's is written from its source and herdr's detection rules, not from a capture.
const CLAUDE = 'Accessing workspace:\n\n/home/vox/app\n\nQuick safety check: do you trust this folder?\n\n❯ 1. No, exit\n2. Yes, I trust this folder'
const CODEX = '> You are in /home/vox/app\n\nDo you trust the contents of this directory? Working with untrusted contents comes with higher risk of prompt injection.\n\n1. Yes, continue\n2. No, quit'

const read = (agent: string, asking: string) => {
  const menu = parseScreenMenu(asking)
  return menu === null ? null : parseTrustPrompt(agent, menu)
}

describe('the trust-this-folder question', () => {
  it('reads Claude’s, with the folder it names and a key list for each answer', () => {
    const trust = read('claude', CLAUDE)
    expect(trust?.folder).toBe('/home/vox/app')
    expect(trust?.trustKeys).toEqual([`${ESC}[B`, ENTER])
    expect(trust?.declineKeys).toEqual([ENTER])
  })

  it('reads Codex’s, where the trusting answer comes first', () => {
    const trust = read('codex', CODEX)
    expect(trust?.folder).toBe('/home/vox/app')
    expect(trust?.trustKeys).toEqual([ENTER])
    expect(trust?.declineKeys).toEqual([`${ESC}[B`, ENTER])
  })

  it('finds each answer by its words, not its place', () => {
    const swapped = read('claude', CLAUDE.replace('1. No, exit\n2. Yes, I trust this folder', '1. Yes, I trust this folder\n2. No, exit'))
    expect(swapped?.trustKeys).toEqual([ENTER])
    expect(swapped?.declineKeys).toEqual([`${ESC}[B`, ENTER])
  })

  it('does not take one agent’s question for another’s', () => {
    expect(read('codex', CLAUDE)).toBeNull()
    expect(read('claude', CODEX)).toBeNull()
    expect(read('gemini', CLAUDE)).toBeNull()
  })

  it('is no trust card when a choice was reworded, one was added, or the folder is not named', () => {
    expect(read('claude', CLAUDE.replace('Yes, I trust this folder', 'Yes, trust everything'))).toBeNull()
    expect(read('claude', `${CLAUDE}\n3. Yes, and never ask again`)).toBeNull()
    expect(read('claude', CLAUDE.replace('/home/vox/app', ''))).toBeNull()
    expect(read('codex', CODEX.replace('> You are in /home/vox/app', ''))).toBeNull()
  })

  it('refuses a folder with control characters or no sane length, so the card never shows what it cannot vouch for', () => {
    expect(read('claude', CLAUDE.replace('/home/vox/app', `/home/${ESC}[2Jvox`))).toBeNull()
    expect(read('claude', CLAUDE.replace('/home/vox/app', `/${'a'.repeat(5000)}`))).toBeNull()
  })

  it('reads a Windows folder', () => {
    expect(read('claude', CLAUDE.replace('/home/vox/app', 'C:\\Users\\vox\\app'))?.folder).toBe('C:\\Users\\vox\\app')
  })
})
