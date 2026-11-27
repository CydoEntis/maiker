import { describe, expect, it } from 'vitest'
import { pickedText } from './selectionActions'
import type { MouseEvent } from 'react'

function mouseUpIn(html: string): { event: MouseEvent<HTMLElement>; text: Node } {
  const chat = document.createElement('div')
  chat.innerHTML = html
  document.body.append(chat)
  const text = chat.querySelector('span') as HTMLElement
  const range = document.createRange()
  range.selectNodeContents(text)
  window.getSelection()?.removeAllRanges()
  window.getSelection()?.addRange(range)
  return { event: { target: text, currentTarget: chat, clientX: 0, clientY: 0 } as unknown as MouseEvent<HTMLElement>, text }
}

describe('what a mouse release picked', () => {
  it('says whose message the selection began in', () => {
    expect(pickedText(mouseUpIn('<div class="mx-msg-user"><p><span>mine</span></p></div>').event)).toMatchObject({ text: 'mine', speaker: 'user' })
    expect(pickedText(mouseUpIn('<div class="mx-msg-agent"><p><span>theirs</span></p></div>').event)).toMatchObject({ text: 'theirs', speaker: 'agent' })
    expect(pickedText(mouseUpIn('<div class="mx-step"><span>a step</span></div>').event)).toMatchObject({ text: 'a step', speaker: null })
  })

  it('picks nothing from a collapsed selection', () => {
    window.getSelection()?.removeAllRanges()
    const chat = document.createElement('div')
    expect(pickedText({ target: chat, currentTarget: chat, clientX: 0, clientY: 0 } as unknown as MouseEvent<HTMLElement>)).toBeNull()
  })

  it('picks nothing on a release outside the chat, such as over a picture opened full size', () => {
    const { event } = mouseUpIn('<div class="mx-msg-agent"><p><span>theirs</span></p></div>')
    const viewer = document.createElement('img')
    document.body.append(viewer)
    expect(pickedText({ ...event, target: viewer })).toBeNull()
  })
})
