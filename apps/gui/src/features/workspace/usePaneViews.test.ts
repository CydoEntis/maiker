import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { PaneView } from './model/chatView'
import { usePaneViews } from './usePaneViews'

describe('the view a chat was switched to by hand', () => {
  it('is kept while the default stays the same', () => {
    const { result } = renderHook(({ openIn }) => usePaneViews(openIn), { initialProps: { openIn: 'chat' as PaneView } })
    act(() => { result.current.choose('a', 'terminal') })
    expect(result.current.choices.get('a')).toBe('terminal')
  })

  it('is dropped when the default changes, so every open chat follows it', () => {
    const { result, rerender } = renderHook(({ openIn }) => usePaneViews(openIn), { initialProps: { openIn: 'chat' as PaneView } })
    act(() => { result.current.choose('a', 'terminal') })
    rerender({ openIn: 'terminal' })
    expect(result.current.choices.size).toBe(0)
  })
})
