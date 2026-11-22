import type { ReactNode } from 'react'

/**
 * A section that folds away. The height moves as `grid-template-rows` 1fr to 0fr (a measured
 * exception to the transform-and-opacity rule, docs/PERFORMANCE.md) and the content fades; folded
 * content is `inert` and `aria-hidden`, so the keyboard and a screen reader skip it.
 */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className="mx-collapse-grid" data-open={open}>
      <div className="mx-collapse-inner" aria-hidden={open ? undefined : true} inert={!open}>{children}</div>
    </div>
  )
}
