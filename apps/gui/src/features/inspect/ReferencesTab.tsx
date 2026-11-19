import { repoReferences } from './api'
import { SkeletonLines } from '@/components/ui/skeleton'
import { ago, formatBytes, MS_PER_SECOND } from './format'
import { RepoError } from './RepoError'
import { useRepoQuery } from './useRepoQuery'

export function ReferencesTab({ term }: { term: number }) {
  const query = useRepoQuery(term, ['references'], () => repoReferences(term))
  if (query.isPending) return <SkeletonLines label="Reading references" className="mx-inspect-note" />
  if (query.isError) return <RepoError error={query.error} tab="references" onRetry={() => { void query.refetch() }} retrying={query.isFetching} />
  // When the list was read, so the ages stay the same until it is read again.
  const now = query.dataUpdatedAt / MS_PER_SECOND
  return (
    <div className="mx-inspect-body">
      <p className="mx-inspect-note">Every agent on this project sees these · kept on this computer, not in git</p>
      {query.data.length === 0 && (
        <>
          <h3 className="mx-inspect-file">Show agents what to build</h3>
          <p className="mx-inspect-note">Screenshots, mockups and design files agents look at before UI work. Put them in this project&apos;s <code>.maiker/references</code> folder and they show here.</p>
        </>
      )}
      <ul className="mx-inspect-list">
        {query.data.map((item) => (
          <li key={item.name} className="mx-inspect-row">
            <span className="mx-inspect-main">{item.name}</span>
            <span className="mx-inspect-meta">{item.kind} · {formatBytes(item.bytes)} · {ago(item.modified, now)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
