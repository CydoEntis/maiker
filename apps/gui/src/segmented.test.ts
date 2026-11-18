/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Vitest hands every stylesheet to a test as an empty string, so the globs only name the files and their text is read
// from disk (as material.test.ts does).
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const files = (paths: string[]) => paths.map((path) => [path, read(path)] as const)

const outsideUi = (path: string) => !path.startsWith('./components/ui/')
const sheets = files(Object.keys(import.meta.glob('./**/*.css'))).filter(([path]) => outsideUi(path) && path !== './material.css')
const sources = files(Object.keys(import.meta.glob(['./**/*.ts', './**/*.tsx']))).filter(([path]) => outsideUi(path) && !/\.test\.tsx?$/.test(path))

// docs/UI.md, *One segmented control*: the tray with a picked choice exists once, in components/ui. A second one drifts
// (the pane header's Chat | Terminal once sat flush to its edge while the dialog's did not).
describe('the segmented control', () => {
  it('reads the files it checks', () => {
    expect(sheets.length).toBeGreaterThan(5)
    expect(sources.length).toBeGreaterThan(50)
  })

  it('is drawn only by components/ui/segmented.css', () => {
    const offenders = sheets.filter(([, css]) => /\.mx-seg(mented|-)|\.mx-[a-z-]*seg\b/.test(css.replace(/\/\*[\s\S]*?\*\//g, ''))).map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it('has no stylesheet outside components/ui paint a picked choice as a pill on a well', () => {
    const offenders = sheets.filter(([, css]) => /\[(aria-checked="true"|data-state="checked")\][^{]*\{[^}]*background:\s*var\(--m-sel\)/.test(css)).map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it('is not built from the radio primitive or a radiogroup role outside components/ui', () => {
    const offenders = sources.filter(([, code]) => /role=["']radiogroup["']|RadioGroup\b[^\n]*from 'radix-ui'|\bRadioGroup\b[^\n]*\} from 'radix-ui'/.test(code)).map(([path]) => path)
    expect(offenders).toEqual([])
  })
})
