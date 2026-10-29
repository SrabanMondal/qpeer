import {
  BusinessPaymentsResponse,
  ConfirmPaymentResponse,
  MyPaymentsResponse,
  OrderResponse,
  PriorityPreview,
  type VerifyPaymentBody,
} from "@qpeer/shared";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { ApiError, apiFetch } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { useAuth } from "@/lib/auth";
import { deviceHash } from "@/lib/device-id";

const enc = encodeURIComponent;

/** What a payment buys (the pay screen's `kind`). */
export type PayKind = "reservation" | "priority" | "upgrade";

/**
 * PRI-11: passes and upgrades carry the phone's device hash (never the raw
 * id). Without one (not Android) a pass can't be bought.
 */
function requireDeviceHash(): string {
  const hash = deviceHash();
  if (!hash) {
    throw new ApiError({
      status: 0,
      code: "no_device_id",
      message: "Priority Passes can only be bought on an Android phone.",
    });
  }
  return hash;
}

/**
 * POST /v1/queues/:id/orders (PAY-01 reservation, PRI-02 pass). An unpaid
 * order of the same user is returned again, so retrying is safe.
 */
export function createOrder(queueId: string, kind: "reservation" | "priority") {
  return apiFetch(`/v1/queues/${enc(queueId)}/orders`, OrderResponse, {
    method: "POST",
    body:
      kind === "priority"
        ? { kind, deviceHash: requireDeviceHash() }
        : { kind },
  });
}

/** POST /v1/tokens/:id/upgrade ("Skip ahead", PRI-05). */
export function createUpgradeOrder(tokenId: string) {
  return apiFetch(`/v1/tokens/${enc(tokenId)}/upgrade`, OrderResponse, {
    method: "POST",
    body: { deviceHash: requireDeviceHash() },
  });
}

/** The order for a pay screen request. */
export function orderFor(req: {
  kind: PayKind;
  queueId: string;
  tokenId?: string;
}) {
  if (req.kind === "upgrade") {
    if (!req.tokenId) {
      return Promise.reject(new ApiError({ status: 404, code: "not_found" }));
    }
    return createUpgradeOrder(req.tokenId);
  }
  return createOrder(req.queueId, req.kind);
}

/** POST /v1/payments/verify: Razorpay Checkout's success callback (PAY-03). */
export function verifyPayment(body: VerifyPaymentBody) {
  return apiFetch("/v1/payments/verify", ConfirmPaymentResponse, {
    method: "POST",
    body,
  });
}

/** GET /v1/me/payments (PAY-11). */
export function listMyPayments(cursor?: string, limit = 20) {
  const q = new URLSearchParams({ limit: String(limit) });
  if (cursor) q.set("cursor", cursor);
  return apiFetch(`/v1/me/payments?${q.toString()}`, MyPaymentsResponse);
}

/** GET /v1/businesses/:id/payments (owner, net split from the ledger). */
export function listBusinessPayments(businessId: string, cursor?: string) {
  const q = new URLSearchParams({ limit: "20" });
  if (cursor) q.set("cursor", cursor);
  return apiFetch(
    `/v1/businesses/${enc(businessId)}/payments?${q.toString()}`,
    BusinessPaymentsResponse,
  );
}

/** GET /v1/queues/:id/priority-preview (PRI-02 honest preview). */
export function getPriorityPreview(queueId: string) {
  return apiFetch(
    `/v1/queues/${enc(queueId)}/priority-preview`,
    PriorityPreview,
  );
}

function useUid(): string | null {
  return useAuth().user?.uid ?? null;
}

/** Only registered accounts have payments (anonymous → none to load). */
function useRegisteredUid(): string | null {
  const { user } = useAuth();
  return user && !user.isAnonymous ? user.uid : null;
}

export function useMyPayments() {
  const uid = useRegisteredUid();
  return useInfiniteQuery({
    queryKey: queryKeys.myPayments(uid),
    queryFn: ({ pageParam }) => listMyPayments(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: uid !== null,
  });
}

export function useBusinessPayments(businessId: string) {
  const uid = useRegisteredUid();
  return useInfiniteQuery({
    queryKey: queryKeys.businessPayments(uid, businessId),
    queryFn: ({ pageParam }) => listBusinessPayments(businessId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: uid !== null && businessId.length > 0,
  });
}

export function usePriorityPreview(queueId: string, enabled = true) {
  const uid = useUid();
  return useQuery({
    queryKey: queryKeys.priorityPreview(uid, queueId),
    queryFn: () => getPriorityPreview(queueId),
    enabled: enabled && uid !== null && queueId.length > 0,
    staleTime: 15_000,
  });
}
