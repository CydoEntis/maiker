import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { KeyLoginReport, KeySetupResult } from '@/api/machines'
import { KeyLoginCard, PASSWORD_OFFERED } from './KeyLoginCard'

const READY: KeyLoginReport = { status: 'ready', path: '/home/me/.ssh/id_ed25519', key_type: 'ssh-ed25519', fingerprint: 'SHA256:abc' }
const PASSWORD = 'correct horse 9'

async function open(report: KeyLoginReport, setUp: (name: string, password: string, createKey: boolean) => Promise<KeySetupResult> = vi.fn()) {
  const user = userEvent.setup()
  render(<KeyLoginCard name="cody" inspect={() => Promise.resolve(report)} setUp={setUp} />)
  await user.click(screen.getByRole('button', { name: 'Set up key login' }))
  return user
}

describe('key login set up with a password once', () => {
  it('is offered only when ssh said a password login is on offer', () => {
    expect(PASSWORD_OFFERED.test('cstin@cody: Permission denied (publickey,password).')).toBe(true)
    expect(PASSWORD_OFFERED.test('Permission denied (publickey,keyboard-interactive).')).toBe(true)
    expect(PASSWORD_OFFERED.test('Permission denied (publickey).')).toBe(false)
    expect(PASSWORD_OFFERED.test('Host key verification failed.')).toBe(false)
  })

  it('sends the password once, clears the box at once, and never shows it again', async () => {
    const setUp = vi.fn().mockResolvedValue({ outcome: 'installed', added: true, fingerprint: 'SHA256:abc' })
    const user = await open(READY, setUp)
    expect(await screen.findByText(/used for this one step and then forgotten/)).toBeInTheDocument()
    const box = screen.getByLabelText('Password for cody')
    expect(box).toHaveAttribute('type', 'password')
    await user.type(box, PASSWORD)
    await user.click(screen.getAllByRole('button', { name: 'Set up key login' })[0] as HTMLElement)
    expect(setUp).toHaveBeenCalledExactlyOnceWith('cody', PASSWORD, false)
    expect(await screen.findByText(/Your key is on cody, and logging in with it works/)).toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain(PASSWORD)
  })

  it('says a wrong password plainly with the tries left, and empties the box', async () => {
    const setUp = vi.fn().mockResolvedValue({ outcome: 'wrong-password', attempts_left: 2 })
    const user = await open(READY, setUp)
    const box = await screen.findByLabelText('Password for cody')
    await user.type(box, 'nope')
    await user.click(screen.getAllByRole('button', { name: 'Set up key login' })[0] as HTMLElement)
    expect(await screen.findByText(/That password was not accepted. 2 tries left./)).toBeInTheDocument()
    expect(screen.getByLabelText('Password for cody')).toHaveValue('')
  })

  it('stops after too many wrong passwords', async () => {
    const setUp = vi.fn().mockResolvedValue({ outcome: 'stopped' })
    const user = await open(READY, setUp)
    await user.type(await screen.findByLabelText('Password for cody'), 'x')
    await user.click(screen.getAllByRole('button', { name: 'Set up key login' })[0] as HTMLElement)
    expect(await screen.findByText(/Too many wrong passwords/)).toBeInTheDocument()
    expect(screen.getByLabelText('Password for cody')).toBeDisabled()
  })

  it('asks before creating a key, and says what will be created and where', async () => {
    const setUp = vi.fn().mockResolvedValue({ outcome: 'installed', added: true, fingerprint: 'SHA256:abc' })
    const user = await open({ status: 'no-key', path: '/home/me/.ssh/id_ed25519' }, setUp)
    expect(await screen.findByText(/no passphrase/)).toBeInTheDocument()
    expect(screen.getAllByText('/home/me/.ssh/id_ed25519').length).toBeGreaterThan(0)
    await user.type(screen.getByLabelText('Password for cody'), PASSWORD)
    const go = screen.getAllByRole('button', { name: 'Set up key login' })[0] as HTMLElement
    expect(go).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /Create this key/ }))
    await user.click(go)
    expect(setUp).toHaveBeenCalledWith('cody', PASSWORD, true)
  })

  it('stops with the terminal when the key has a passphrase, and takes no password', async () => {
    await open({ status: 'encrypted', path: '/home/me/.ssh/id_ed25519' })
    expect(await screen.findByText(/has a passphrase/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Password for cody')).not.toBeInTheDocument()
  })

  it('shows exact manual steps when the machine could not be told', async () => {
    const setUp = vi.fn().mockResolvedValue({ outcome: 'manual', reason: 'Maiker could not tell what system the machine runs', steps: "echo 'ssh-ed25519 AAAA me' >> ~/.ssh/authorized_keys" })
    const user = await open(READY, setUp)
    await user.type(await screen.findByLabelText('Password for cody'), 'x')
    await user.click(screen.getAllByRole('button', { name: 'Set up key login' })[0] as HTMLElement)
    expect(await screen.findByText(/could not tell what system/)).toBeInTheDocument()
    expect(screen.getByText(/authorized_keys/)).toBeInTheDocument()
  })

  it('says it is unavailable on a computer that cannot do it', async () => {
    await open({ status: 'unavailable', reason: 'Setting up a key from a Windows computer is not supported here' })
    expect(await screen.findByText(/not supported here/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Password for cody')).not.toBeInTheDocument()
  })
})
