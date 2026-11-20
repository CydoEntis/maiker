import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROMPT_WAIT_MS, waitForPrompt } from './waitForPrompt'

describe('waiting for a new shell to be ready for typing', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('waits while the screen is blank, then until it has stopped changing', async () => {
    const screens = ['', '', 'PS C:\\Users\\me', 'PS C:\\Users\\me>']
    let reads = 0
    const read = vi.fn(() => Promise.resolve(screens[Math.min(reads++, screens.length - 1)] ?? ''))
    let ready = false
    void waitForPrompt(read).then(() => { ready = true })
    await vi.advanceTimersByTimeAsync(600)
    expect(ready).toBe(false)
    await vi.advanceTimersByTimeAsync(1200)
    expect(ready).toBe(true)
  })

  it('ignores escape sequences, so a redraw that changes no text counts as still', async () => {
    const esc = String.fromCharCode(27)
    let reads = 0
    const read = () => Promise.resolve(`${esc}[${String(reads++)}m$ `)
    let ready = false
    void waitForPrompt(read).then(() => { ready = true })
    await vi.advanceTimersByTimeAsync(1500)
    expect(ready).toBe(true)
  })

  it('gives up after a while and lets the line be typed anyway, for a shell that never says anything', async () => {
    let ready = false
    void waitForPrompt(() => Promise.resolve('')).then(() => { ready = true })
    await vi.advanceTimersByTimeAsync(PROMPT_WAIT_MS - 500)
    expect(ready).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(ready).toBe(true)
  })
})
