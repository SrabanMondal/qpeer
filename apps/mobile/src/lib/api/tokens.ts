import {
  CancelResponse,
  type JoinBody,
  MyTokensResponse,
  TokenView,
} from "@qpeer/shared";
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { apiFetch } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { useAuth } from "@/lib/auth";

const enc = encodeURIComponent;

/** POST /v1/queues/:id/join (JON-04). The location is sent once and never kept. */
export function joinQueue(queueId: string, body: JoinBody) {
  return apiFetch(`/v1/queues/${enc(queueId)}/join`, TokenView, {
    method: "POST",
    body,
  });
}

/** GET /v1/tokens/:id (TOK-01, TOK-03). */
export function getToken(id: string) {
  return apiFetch(`/v1/tokens/${enc(id)}`, TokenView);
}

/** POST /v1/tokens/:id/leave (TOK-05). */
export function leaveToken(id: string) {
  return apiFetch(`/v1/tokens/${enc(id)}/leave`, TokenView, {
    method: "POST",
  });
}

/** POST /v1/tokens/:id/cancel (paid tokens, Step 4). */
export function cancelToken(id: string) {
  return apiFetch(`/v1/tokens/${enc(id)}/cancel`, CancelResponse, {
    method: "POST",
  });
}

/** GET /v1/me/tokens?status=… (TOK-06). */
export function listMyTokens(status: "active" | "recent") {
  return apiFetch(`/v1/me/tokens?status=${status}`, MyTokensResponse);
}

function useUid(): string | null {
  return useAuth().user?.uid ?? null;
}

/** Stores a fresh token view and marks the "My tokens" lists stale. */
export function storeToken(
  queryClient: QueryClient,
  uid: string | null,
  token: TokenView,
) {
  queryClient.setQueryData(queryKeys.token(uid, token.id), token);
  void queryClient.invalidateQueries({ queryKey: queryKeys.myTokensAll(uid) });
}

export function useToken(id: string) {
  const uid = useUid();
  return useQuery({
    queryKey: queryKeys.token(uid, id),
    queryFn: () => getToken(id),
    enabled: uid !== null && id.length > 0,
    // The live socket keeps it fresh; HTTP refetches on focus/reconnect.
    staleTime: 5_000,
  });
}

export function useMyTokens(status: "active" | "recent", enabled = true) {
  const uid = useUid();
  return useQuery({
    queryKey: queryKeys.myTokens(uid, status),
    queryFn: () => listMyTokens(status),
    enabled: enabled && uid !== null,
    staleTime: 5_000,
  });
}

export function useJoinQueue(queueId: string) {
  const uid = useUid();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: JoinBody) => joinQueue(queueId, body),
    onSuccess: (token) => {
      storeToken(queryClient, uid, token);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.queue(uid, queueId),
      });
    },
  });
}

export function useLeaveToken(id: string) {
  const uid = useUid();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => leaveToken(id),
    onSuccess: (token) => storeToken(queryClient, uid, token),
  });
}
