import { describe, expect, it } from 'vitest'
import { APP_NAME } from '@/brand'
import { errorMessage, explainError } from './error-message'

describe('errorMessage', () => {
  it('keeps useful Tauri string errors', () => {
    expect(errorMessage('Codex app-server could not start', 'Conversation failed')).toBe('Codex app-server could not start')
  })

  it('uses Error messages', () => {
    expect(errorMessage(new Error('Codex app-server could not start'), 'Conversation failed')).toBe('Codex app-server could not start')
  })

  it('uses the fallback when the failure has no message', () => {
    expect(errorMessage({ code: 'unknown' }, 'Conversation failed')).toBe('Conversation failed')
    expect(errorMessage('  ', 'Conversation failed')).toBe('Conversation failed')
  })
})

describe('explainError', () => {
  it('names what failed as the title and keeps a failure that already reads as a sentence', () => {
    expect(explainError(new Error('Could not make a worktree for branch `dev`: its folder ~/x is already there.'), 'Could not start the chat')).toEqual({
      title: 'Could not start the chat',
      reason: 'Could not make a worktree for branch `dev`: its folder ~/x is already there.',
      details: null,
    })
  })

  it('puts a raw tool failure in plain words and keeps the raw text as details', () => {
    const raw = 'connecting to the local daemon: Connection refused (os error 111)'
    const explained = explainError(raw, 'Could not save the setting')
    expect(explained.reason).toBe(`The ${APP_NAME} service is not answering. It may still be starting; try again in a moment.`)
    expect(explained.details).toBe(raw)
  })

  it('makes an unknown raw failure one sentence and writes the home folder as ~', () => {
    const explained = explainError('fatal: /home/vox/dev/app-worktrees/dev is locked', 'Could not move the chat')
    expect(explained.reason).toBe('~/dev/app-worktrees/dev is locked.')
    expect(explained.details).toBe('fatal: /home/vox/dev/app-worktrees/dev is locked')
  })

  it('says no reason was given for a failure with no text', () => {
    expect(explainError({}, 'Could not end the session').reason).toMatch(/^No reason was given/)
  })
})
