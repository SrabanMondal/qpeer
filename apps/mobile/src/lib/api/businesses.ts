import {
  BusinessView,
  type CreateBusinessInput,
  type CreateQueueBody,
  MyBusinessesResponse,
  QueueView,
  type UpdateBusinessBody,
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

/** GET /v1/me/businesses (BIZ-09, BIZ-15). */
export function listMyBusinesses(): Promise<MyBusinessesResponse> {
  return apiFetch("/v1/me/businesses", MyBusinessesResponse);
}

/** GET /v1/businesses/:id */
export function getBusiness(id: string): Promise<BusinessView> {
  return apiFetch(`/v1/businesses/${enc(id)}`, BusinessView);
}

/** POST /v1/businesses (BIZ-01). */
export function createBusiness(body: CreateBusinessInput) {
  return apiFetch("/v1/businesses", BusinessView, { method: "POST", body });
}

/** PATCH /v1/businesses/:id (BIZ-02 profile, BIZ-04 pin, BIZ-05 hours). */
export function updateBusiness(id: string, body: UpdateBusinessBody) {
  return apiFetch(`/v1/businesses/${enc(id)}`, BusinessView, {
    method: "PATCH",
    body,
  });
}

/** POST /v1/businesses/:id/deactivate or /activate (BIZ-08). */
export function setBusinessStatus(id: string, active: boolean) {
  return apiFetch(
    `/v1/businesses/${enc(id)}/${active ? "activate" : "deactivate"}`,
    BusinessView,
    { method: "POST" },
  );
}

/** POST /v1/businesses/:id/queues (BIZ-10). */
export function createQueue(businessId: string, body: CreateQueueBody) {
  return apiFetch(`/v1/businesses/${enc(businessId)}/queues`, QueueView, {
    method: "POST",
    body,
  });
}

function useUid(): string | null {
  return useAuth().user?.uid ?? null;
}

/** Stores a fresh business and marks the list stale. */
export function storeBusiness(
  queryClient: QueryClient,
  uid: string | null,
  view: BusinessView,
) {
  queryClient.setQueryData(queryKeys.business(uid, view.id), view);
  void queryClient.invalidateQueries({
    queryKey: queryKeys.myBusinesses(uid),
  });
}

export function useMyBusinesses(enabled = true) {
  const uid = useUid();
  return useQuery({
    queryKey: queryKeys.myBusinesses(uid),
    queryFn: listMyBusinesses,
    enabled: enabled && uid !== null,
  });
}

export function useBusiness(id: string) {
  const uid = useUid();
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.business(uid, id),
    queryFn: () => getBusiness(id),
    enabled: uid !== null && id.length > 0,
    // Show the list's copy at once while the detail loads.
    placeholderData: () =>
      queryClient
        .getQueryData<MyBusinessesResponse>(queryKeys.myBusinesses(uid))
        ?.items.find((b) => b.id === id),
  });
}

export function useCreateBusiness() {
  const uid = useUid();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createBusiness,
    onSuccess: (view) => storeBusiness(queryClient, uid, view),
  });
}

export function useUpdateBusiness(id: string) {
  const uid = useUid();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateBusinessBody) => updateBusiness(id, body),
    onSuccess: (view) => storeBusiness(queryClient, uid, view),
  });
}

export function useSetBusinessStatus(id: string) {
  const uid = useUid();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (active: boolean) => setBusinessStatus(id, active),
    onSuccess: (view) => storeBusiness(queryClient, uid, view),
  });
}

export function useCreateQueue(businessId: string) {
  const uid = useUid();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateQueueBody) => createQueue(businessId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.business(uid, businessId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.myBusinesses(uid),
      });
    },
  });
}
