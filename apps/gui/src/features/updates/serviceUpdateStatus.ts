import { useQuery } from '@tanstack/react-query'
import { loadDaemonUpdateStatus } from '@/api/daemon'

/** The query of whether the running service is on an older release than this app. */
export const SERVICE_STATUS_KEY = ['daemon-update-status']

/** Whether the service still runs the older release: the app's own update notice says so while it finishes. */
export function useServiceFinishing(): boolean {
  const { data } = useQuery({ queryKey: SERVICE_STATUS_KEY, queryFn: loadDaemonUpdateStatus, enabled: false, staleTime: Infinity })
  return data?.behind === true
}
