import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CloneFromGitHub } from './CloneFromGitHub'

function setup(clone: (link: string, parent: string) => Promise<string>, browse: (() => Promise<string | null>) | null = null) {
  const onBack = vi.fn()
  const onCloned = vi.fn()
  render(<CloneFromGitHub parent="/home/me/code" browse={browse} clone={clone} onBack={onBack} onCloned={onCloned} />)
  return { onBack, onCloned, field: screen.getByRole('textbox', { name: 'GitHub repository' }) }
}

describe('Clone from GitHub', () => {
  it('clones what was pasted into the folder beside the project, then hands back the new folder', async () => {
    const clone = vi.fn<(link: string, parent: string) => Promise<string>>().mockResolvedValue('/home/me/code/maitty')
    const { onCloned, field } = setup(clone)
    expect(screen.getByRole('button', { name: 'Clone' })).toBeDisabled()
    expect(field).toHaveFocus()

    await userEvent.type(field, '  CydoEntis/maitty {Enter}')

    expect(clone).toHaveBeenCalledExactlyOnceWith('CydoEntis/maitty', '/home/me/code')
    expect(onCloned).toHaveBeenCalledWith('/home/me/code/maitty')
  })

  it("keeps a failure on the view with git's reason, and clears it once the link is edited", async () => {
    const clone = vi.fn<(link: string, parent: string) => Promise<string>>().mockRejectedValue(new Error('Could not clone o/r: repository not found'))
    const { onCloned, field } = setup(clone)
    await userEvent.type(field, 'o/r')
    await userEvent.click(screen.getByRole('button', { name: 'Clone' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('repository not found')
    expect(onCloned).not.toHaveBeenCalled()
    await userEvent.type(field, 'x')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says it is cloning and takes no second start until git answers', async () => {
    let finish: (folder: string) => void = () => undefined
    const clone = vi.fn<(link: string, parent: string) => Promise<string>>().mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const { field } = setup(clone)
    await userEvent.type(field, 'o/r{Enter}')

    expect(screen.getByRole('button', { name: 'Cloning…' })).toBeDisabled()
    expect(field).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
    finish('/home/me/code/r')
  })

  it('clones into another folder picked with the folder picker', async () => {
    const clone = vi.fn<(link: string, parent: string) => Promise<string>>().mockResolvedValue('/srv/r')
    const { field } = setup(clone, () => Promise.resolve('/srv'))
    await userEvent.click(screen.getByRole('button', { name: '/home/me/code' }))
    expect(await screen.findByRole('button', { name: '/srv' })).toBeInTheDocument()

    await userEvent.type(field, 'o/r{Enter}')
    expect(clone).toHaveBeenCalledWith('o/r', '/srv')
  })

  it('goes back to the choices', async () => {
    const { onBack } = setup(vi.fn())
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalled()
  })
})
