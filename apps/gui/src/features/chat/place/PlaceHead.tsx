/** The top of a place menu: what it is about, then one dim line of what it means. */
export function PlaceHead({ main, sub, mono = false }: { main: string; sub: string; mono?: boolean }) {
  return (
    <div className="mx-place-head">
      <span className={`mx-place-head-main${mono ? ' is-mono' : ''}`}>{main}</span>
      <span className="mx-place-head-sub">{sub}</span>
    </div>
  )
}
