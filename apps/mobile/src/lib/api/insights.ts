import {
  AnalyticsResponse,
  EarningsResponse,
  type InsightsRangeDays,
} from "@qpeer/shared";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { useAuth } from "@/lib/auth";

const enc = encodeURIComponent;

/** GET /v1/businesses/:id/analytics (owner and staff, INS-01…06, INS-08). */
export function getAnalytics(
  businessId: string,
  range: InsightsRangeDays,
  queueId: string | null,
) {
  const q = new URLSearchParams({ range: String(range) });
  if (queueId) q.set("queueId", queueId);
  return apiFetch(
    `/v1/businesses/${enc(businessId)}/analytics?${q.toString()}`,
    AnalyticsResponse,
  );
}

/** GET /v1/businesses/:id/earnings (owner, INS-07). */
export function getEarnings(
  businessId: string,
  range: InsightsRangeDays,
  cursor?: string,
) {
  const q = new URLSearchParams({ range: String(range), limit: "15" });
  if (cursor) q.set("cursor", cursor);
  return apiFetch(
    `/v1/businesses/${enc(businessId)}/earnings?${q.toString()}`,
    EarningsResponse,
  );
}

function useRegisteredUid(): string | null {
  const { user } = useAuth();
  return user && !user.isAnonymous ? user.uid : null;
}

export function useAnalytics(
  businessId: string | null,
  range: InsightsRangeDays,
  queueId: string | null,
) {
  const uid = useRegisteredUid();
  return useQuery({
    queryKey: queryKeys.analytics(uid, businessId ?? "", range, queueId),
    queryFn: () => getAnalytics(businessId ?? "", range, queueId),
    enabled: uid !== null && businessId !== null,
    staleTime: 60_000,
  });
}

export function useEarnings(
  businessId: string | null,
  range: InsightsRangeDays,
  enabled: boolean,
) {
  const uid = useRegisteredUid();
  return useInfiniteQuery({
    queryKey: queryKeys.earnings(uid, businessId ?? "", range),
    queryFn: ({ pageParam }) => getEarnings(businessId ?? "", range, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: enabled && uid !== null && businessId !== null,
    staleTime: 60_000,
  });
}
