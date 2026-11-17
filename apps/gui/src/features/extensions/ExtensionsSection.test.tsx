import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AddPreview, ExtAdd, ExtensionList, ExtensionResult, ExtTarget, Extension } from '@/api/extensions'
import { ExtensionsSection } from './ExtensionsSection'

const api = vi.hoisted(() => ({
  loadExtensions: vi.fn<(project: string | null) => Promise<ExtensionResult<ExtensionList>>>(),
  previewAdd: vi.fn<(add: ExtAdd) => Promise<ExtensionResult<AddPreview>>>(),
  confirmAdd: vi.fn<(token: string) => Promise<ExtensionResult<string>>>(),
  setPluginEnabled: vi.fn<(target: ExtTarget, enabled: boolean) => Promise<ExtensionResult<string>>>(),
  removeExtension: vi.fn<(target: ExtTarget) => Promise<ExtensionResult<string>>>(),
}))
vi.mock('@/api/extensions', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/extensions')>()), ...api }))

const item = (over: Partial<Extension>): Extension => ({ agent: 'Claude', kind: 'Plugin', scope: 'User', id: 'hello@local-mk', name: 'hello', detail: 'version 1.0.0', enabled: true, ...over })
const PROJECT = { name: 'shop', linkKey: ':/work/shop', folder: '/work/shop', machine: 0, machineName: null }
const REMOTE = { name: 'blog', linkKey: 'kingdom:/srv/blog', folder: '/srv/blog', machine: 1, machineName: 'kingdom' }
const PREVIEW: AddPreview = { token: 'tok123', agent: 'Claude', kind: 'McpServer', name: 'docs', scope: 'User', source: 'Typed in this window', runs: ['npx -y srv', 'It starts whenever the agent starts, as you.'], hosts: [] }

function show() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ExtensionsSection projects={[PROJECT, REMOTE]} />
    </QueryClientProvider>,
  )
}

const group = (name: string) => within(screen.getByRole('group', { name }))

afterEach(cleanup)
beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset()
  api.loadExtensions.mockResolvedValue({
    ok: true,
    value: {
      problems: [],
      items: [
        item({}),
        item({ id: 'srv', kind: 'McpServer', name: 'srv', detail: 'echo a b', enabled: null }),
        item({ id: 'notes', kind: 'Skill', name: 'Notes', detail: 'Keeps notes', enabled: null }),
        item({ agent: 'Codex', id: 'hello@local-mk', name: 'hello', detail: '', enabled: false }),
      ],
    },
  })
})

describe('Settings › Extensions', () => {
  it('lists each agent\'s plugins, servers, skills and marketplaces, and says when there are none', async () => {
    show()
    expect(await group('Claude Code Plugins').findByText('hello')).toBeInTheDocument()
    expect(group('Claude Code Plugins').getByText('version 1.0.0')).toBeInTheDocument()
    expect(group('Claude Code MCP servers').getByText('echo a b')).toBeInTheDocument()
    expect(group('Claude Code Skills').getByText('Keeps notes')).toBeInTheDocument()
    expect(group('Claude Code Marketplaces').getByText('None installed.')).toBeInTheDocument()
    expect(group('Codex Plugins').getByRole('switch', { name: 'Turn on hello' })).not.toBeChecked()
    expect(api.loadExtensions).toHaveBeenCalledWith(null)
  })

  it('offers only this computer\'s projects and reads the project it is asked to look at', async () => {
    const user = userEvent.setup()
    show()
    const picker = await screen.findByRole('combobox', { name: 'Project' })
    expect(within(picker).getAllByRole('option').map((option) => option.textContent)).toEqual(['Just mine', 'shop'])
    await user.selectOptions(picker, 'shop')
    await waitFor(() => { expect(api.loadExtensions).toHaveBeenLastCalledWith('/work/shop') })
  })

  it('says what could not be read instead of showing a list that looks empty', async () => {
    api.loadExtensions.mockResolvedValue({ ok: true, value: { items: [], problems: ['claude/settings.json is not valid JSON'] } })
    show()
    expect(await screen.findByText('claude/settings.json is not valid JSON. It is left as it is.')).toBeInTheDocument()
  })

  it('says the list could not be read when the service could not', async () => {
    api.loadExtensions.mockResolvedValue({ ok: false, failure: { line: 'The service did not answer', terminal: null } })
    show()
    expect(await screen.findByText(/Could not read what is installed: The service did not answer/)).toBeInTheDocument()
  })

  it('turns a plugin off for its own scope, then reads the list again', async () => {
    const user = userEvent.setup()
    api.setPluginEnabled.mockResolvedValue({ ok: true, value: 'hello@local-mk turned off' })
    show()
    await user.click(await group('Claude Code Plugins').findByRole('switch', { name: 'Turn off hello' }))
    expect(api.setPluginEnabled).toHaveBeenCalledExactlyOnceWith({ agent: 'Claude', kind: 'Plugin', id: 'hello@local-mk', scope: 'User', project: null }, false)
    expect(await screen.findByText(/hello@local-mk turned off\./)).toBeInTheDocument()
    await waitFor(() => { expect(api.loadExtensions).toHaveBeenCalledTimes(2) })
  })

  it('asks before it removes, and cancelling removes nothing', async () => {
    const user = userEvent.setup()
    show()
    await user.click(await group('Claude Code Plugins').findByRole('button', { name: 'Remove hello' }))
    const ask = screen.getByRole('dialog', { name: 'Remove hello?' })
    expect(within(ask).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.click(within(ask).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.removeExtension).not.toHaveBeenCalled()
  })

  it('removes what was confirmed, and a skill\'s words say its folder is deleted', async () => {
    const user = userEvent.setup()
    api.removeExtension.mockResolvedValue({ ok: true, value: 'notes removed' })
    show()
    await user.click(await group('Claude Code Skills').findByRole('button', { name: 'Remove Notes' }))
    const ask = screen.getByRole('dialog', { name: 'Remove Notes?' })
    expect(within(ask).getByText(/deletes the skill's folder, notes, and everything in it/)).toBeInTheDocument()
    await user.click(within(ask).getByRole('button', { name: 'Remove this skill' }))
    expect(api.removeExtension).toHaveBeenCalledExactlyOnceWith({ agent: 'Claude', kind: 'Skill', id: 'notes', scope: 'User', project: null })
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument() })
  })

  it('keeps the dialog open and says why when a removal is refused', async () => {
    const user = userEvent.setup()
    api.removeExtension.mockResolvedValue({ ok: false, failure: { line: 'That is not there any more. Refresh the list and try again.', terminal: null } })
    show()
    await user.click(await group('Claude Code MCP servers').findByRole('button', { name: 'Remove srv' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove this MCP server' }))
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('Not done. That is not there any more.')
  })
})

describe('adding', () => {
  const fillServer = async (user: ReturnType<typeof userEvent.setup>) => {
    const card = within(await screen.findByRole('region', { name: 'Add an MCP server' }))
    await user.type(card.getByRole('textbox', { name: 'Server name' }), 'docs')
    await user.type(card.getByRole('textbox', { name: 'Server command' }), 'npx -y "my srv"')
    return card
  }

  it('shows what it will run first, with Cancel under the cursor, and installs nothing until the confirm button is clicked', async () => {
    const user = userEvent.setup()
    api.previewAdd.mockResolvedValue({ ok: true, value: PREVIEW })
    api.confirmAdd.mockResolvedValue({ ok: true, value: 'docs added' })
    show()
    const card = await fillServer(user)
    await user.click(card.getByRole('button', { name: 'Review' }))

    expect(api.previewAdd).toHaveBeenCalledExactlyOnceWith({ Mcp: { agent: 'Claude', name: 'docs', run: { Command: { command: 'npx', args: ['-y', 'my srv'] } }, scope: 'User', project: null } })
    const ask = await screen.findByRole('dialog', { name: 'Add docs?' })
    expect(within(ask).getByText('npx -y srv')).toBeInTheDocument()
    expect(within(ask).getByText('This runs code on your computer with your access.')).toBeInTheDocument()
    expect(within(ask).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    // Enter and Escape never confirm.
    await user.keyboard('{Enter}')
    expect(api.confirmAdd).not.toHaveBeenCalled()

    await user.click(within(ask).getByRole('button', { name: 'Add this MCP server' }))
    expect(api.confirmAdd).toHaveBeenCalledExactlyOnceWith('tok123')
    expect(await screen.findByText(/docs added\./)).toBeInTheDocument()
  })

  it('names the host that hears the person when the server is somewhere else', async () => {
    const user = userEvent.setup()
    api.previewAdd.mockResolvedValue({ ok: true, value: { ...PREVIEW, runs: ['Connects to https://mcp.example.com/sse'], hosts: ['mcp.example.com'] } })
    show()
    const card = within(await screen.findByRole('region', { name: 'Add an MCP server' }))
    await user.type(card.getByRole('textbox', { name: 'Server name' }), 'docs')
    await user.selectOptions(card.getByRole('combobox', { name: 'How the server runs' }), 'address')
    await user.type(card.getByRole('textbox', { name: 'Server address' }), 'https://mcp.example.com/sse')
    await user.click(card.getByRole('button', { name: 'Review' }))
    expect(api.previewAdd).toHaveBeenCalledExactlyOnceWith({ Mcp: { agent: 'Claude', name: 'docs', run: { Url: { url: 'https://mcp.example.com/sse' } }, scope: 'User', project: null } })
    expect(await screen.findByText('Your prompts and tool results are sent to mcp.example.com.')).toBeInTheDocument()
  })

  it('cancelling a preview adds nothing', async () => {
    const user = userEvent.setup()
    api.previewAdd.mockResolvedValue({ ok: true, value: PREVIEW })
    show()
    const card = await fillServer(user)
    await user.click(card.getByRole('button', { name: 'Review' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.confirmAdd).not.toHaveBeenCalled()
  })

  it('needs a project picked for a project scope, and sends it with the request', async () => {
    const user = userEvent.setup()
    api.previewAdd.mockResolvedValue({ ok: true, value: PREVIEW })
    show()
    const card = within(await screen.findByRole('region', { name: 'Add a plugin' }))
    await user.type(card.getByRole('textbox', { name: 'Plugin name@marketplace' }), 'hello@local-mk')
    await user.selectOptions(card.getByRole('combobox', { name: 'Where it applies' }), 'Project')
    expect(card.getByText('Pick a project at the top for this.')).toBeInTheDocument()
    expect(card.getByRole('button', { name: 'Review' })).toBeDisabled()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Project' }), 'shop')
    await user.click(card.getByRole('button', { name: 'Review' }))
    expect(api.previewAdd).toHaveBeenCalledExactlyOnceWith({ Plugin: { agent: 'Claude', plugin: 'hello@local-mk', scope: 'Project', project: '/work/shop' } })
  })

  it('says why a preview was refused, and an open quote before it asks', async () => {
    const user = userEvent.setup()
    api.previewAdd.mockResolvedValue({ ok: false, failure: { line: 'That is not there any more. Refresh the list and try again.', terminal: null } })
    show()
    const market = within(await screen.findByRole('region', { name: 'Add a marketplace' }))
    await user.type(market.getByRole('textbox', { name: 'Marketplace source' }), 'someone/market')
    await user.click(market.getByRole('button', { name: 'Review' }))
    expect(await market.findByRole('alert')).toHaveTextContent('That is not there any more.')

    const server = within(screen.getByRole('region', { name: 'Add an MCP server' }))
    await user.type(server.getByRole('textbox', { name: 'Server name' }), 'x')
    await user.type(server.getByRole('textbox', { name: 'Server command' }), 'node "unclosed')
    await user.click(server.getByRole('button', { name: 'Review' }))
    expect(server.getByText('That command line has an open quote.')).toBeInTheDocument()
    expect(api.previewAdd).toHaveBeenCalledTimes(1)
  })
})

describe('what needs a terminal', () => {
  it('says so in plain words with the exact commands', async () => {
    show()
    const card = within(await screen.findByRole('region', { name: 'Needs a terminal' }))
    expect(card.getByText('claude mcp login <name>')).toBeInTheDocument()
    expect(card.getByText('codex mcp login <name>')).toBeInTheDocument()
    expect(card.getByText(/Claude Code asks you the first time it starts in that project/)).toBeInTheDocument()
  })
})
