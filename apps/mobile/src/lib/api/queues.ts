import {
  QueueInfoResponse,
  QueueView,
  type UpdateQueueBody,
} from "@qpeer/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { useAuth } from "@/lib/auth";

const enc = encodeURIComponent;

/** GET /v1/queues/:id — includes settings for owner/staff. */
export function getQueue(id: string): Promise<QueueInfoResponse> {
  return apiFetch(`/v1/queues/${enc(id)}`, QueueInfoResponse);
}

/** PATCH /v1/queues/:id (BIZ-11 rename, BIZ-12 settings). */
export function updateQueue(id: string, body: UpdateQueueBody) {
  return apiFetch(`/v1/queues/${enc(id)}`, QueueView, {
    method: "PATCH",
    body,
  });
}

/** POST /v1/queues/:id/archive (BIZ-11). */
export function archiveQueue(id: string) {
  return apiFetch(`/v1/queues/${enc(id)}/archive`, QueueView, {
    method: "POST",
  });
}

export function useQueue(id: string) {
  const uid = useAuth().user?.uid ?? null;
  return useQuery({
    queryKey: queryKeys.queue(uid, id),
    queryFn: () => getQueue(id),
    enabled: uid !== null && id.length > 0,
  });
}

/** Shared cache update for queue mutations that return a `QueueView`. */
function useQueueMutation<A>(id: string, fn: (arg: A) => Promise<QueueView>) {
  const uid = useAuth().user?.uid ?? null;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (view) => {
      queryClient.setQueryData<QueueInfoResponse>(
        queryKeys.queue(uid, id),
        (old) => (old ? { ...old, queue: view } : old),
      );
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business(uid, view.businessId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.myBusinesses(uid),
      });
    },
  });
}

export function useUpdateQueue(id: string) {
  return useQueueMutation(id, (body: UpdateQueueBody) => updateQueue(id, body));
}

export function useArchiveQueue(id: string) {
  return useQueueMutation(id, () => archiveQueue(id));
}
