import { useQuery } from '@tanstack/react-query'
import { loadLocalServiceReport } from '@/api/daemon'
import { LOCAL_SERVICE_KEY, LOCAL_SERVICE_POLL_MS } from './serviceRepair'

/** The local service's own report. `poll` reads it again every few seconds, for a page that stays open. */
export function useLocalServiceReport({ enabled = true, poll = false }: { enabled?: boolean; poll?: boolean } = {}) {
  return useQuery({
    queryKey: LOCAL_SERVICE_KEY,
    queryFn: loadLocalServiceReport,
    enabled,
    retry: false,
    staleTime: 5_000,
    refetchInterval: poll ? LOCAL_SERVICE_POLL_MS : false,
  })
}
