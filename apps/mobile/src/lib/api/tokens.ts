import {
  CancelResponse,
  type JoinBody,
  MyTokensResponse,
  newerTokenView,
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
import { deviceHash } from "@/lib/device-id";
import { saveTicketView } from "@/lib/storage";

const enc = encodeURIComponent;

/**
 * POST /v1/queues/:id/join (JON-04). The location is sent once and never
 * kept. C2: the device hash (never the raw id) goes with it.
 */
export function joinQueue(queueId: string, body: JoinBody) {
  const hash = deviceHash();
  return apiFetch(`/v1/queues/${enc(queueId)}/join`, TokenView, {
    method: "POST",
    body: hash ? { ...body, deviceHash: hash } : body,
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

/**
 * Puts a token view in the cache unless the cached one is newer (higher
 * `rev`): socket messages and HTTP answers can arrive out of order, and a
 * left/ended ticket must never flip back (Step 3.5 H1). Returns the view kept.
 */
export function mergeToken(
  queryClient: QueryClient,
  uid: string | null,
  token: TokenView,
): TokenView {
  const key = queryKeys.token(uid, token.id);
  const kept = newerTokenView(queryClient.getQueryData<TokenView>(key), token);
  queryClient.setQueryData(key, kept);
  // C1: keep the latest view on the phone for offline cold starts.
  if (uid) void saveTicketView(uid, kept);
  return kept;
}

/** Stores a fresh token view and marks the "My tokens" lists stale. */
export function storeToken(
  queryClient: QueryClient,
  uid: string | null,
  token: TokenView,
) {
  mergeToken(queryClient, uid, token);
  void queryClient.invalidateQueries({ queryKey: queryKeys.myTokensAll(uid) });
}

export function useToken(id: string) {
  const uid = useUid();
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.token(uid, id),
    // A refetch that started before a leave must not undo it.
    queryFn: async () => {
      const kept = newerTokenView(
        queryClient.getQueryData<TokenView>(queryKeys.token(uid, id)),
        await getToken(id),
      );
      if (uid) void saveTicketView(uid, kept);
      return kept;
    },
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
